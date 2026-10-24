"""Single-user login for ImgVault.

The login is set up from Settings in the app. It is stored in `auth.json` next to
the database (e.g. /mnt/user/appdata/imgvault/db/auth.json on Unraid):

    {"username": "...", "algorithm": "pbkdf2_sha256", "iterations": 600000,
     "salt": "<hex>", "hash": "<hex>"}

Only a salted one-way hash of the password is kept; the password itself is never
written anywhere. Deleting auth.json turns the login off (the way back in if the
password is forgotten).

Sessions are a signed cookie (HMAC-SHA256) holding the username and an expiry
time. The signing key is random, kept in `.session_secret` next to the database,
and mixed with the password hash, so changing the password signs out every device.

Standard library only, so it can be tested without the rest of the backend.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
from typing import Optional

COOKIE_NAME = "imgvault_session"
# The cookie is a browser-session cookie (no lifetime), so it is dropped when the browser
# closes. This is the server-side backstop: a session older than this is rejected even if
# the browser kept the cookie.
SESSION_HOURS = int(os.environ.get("IMGVAULT_SESSION_HOURS", "12"))
SESSION_SECONDS = SESSION_HOURS * 60 * 60

PBKDF2_ITERATIONS = 600_000   # OWASP 2023 recommendation for PBKDF2-HMAC-SHA256
MIN_PASSWORD_LENGTH = 8
MAX_USERNAME_LENGTH = 64

# Brute-force protection: after MAX_FAILURES wrong attempts from one address,
# that address is locked out for LOCKOUT_SECONDS.
MAX_FAILURES = 5
LOCKOUT_SECONDS = 60

# API paths reachable without logging in
PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/auth/status", "/api/auth/logout"}


class LoginError(ValueError):
    """Invalid username/password supplied when setting up or changing the login."""


def _data_dir() -> str:
    return os.path.dirname(os.environ.get("DB_PATH", "/data/db/snapvault.db"))


def _auth_path() -> str:
    return os.path.join(_data_dir(), "auth.json")


def _secret_path() -> str:
    return os.path.join(_data_dir(), ".session_secret")


def _write_private(path: str, data: bytes):
    """Write a file readable only by its owner, atomically."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


# ---------- stored login ----------

_lock = threading.Lock()
_config_cache: Optional[dict] = None
_config_loaded = False


def _load_config() -> Optional[dict]:
    global _config_cache, _config_loaded
    with _lock:
        if not _config_loaded:
            try:
                with open(_auth_path(), "r") as f:
                    cfg = json.load(f)
                if not (isinstance(cfg, dict) and cfg.get("username") and cfg.get("hash")):
                    raise ValueError("incomplete")
                _config_cache = cfg
            except FileNotFoundError:
                _config_cache = None
            except (OSError, ValueError):
                # Damaged file: stay locked rather than silently switching the login off.
                # Nothing can match this, so nobody gets in until auth.json is deleted.
                logging.getLogger("snapvault").error(
                    "%s is unreadable; login is locked. Delete it and restart to reset.", _auth_path())
                _config_cache = {"username": "", "hash": "", "locked": True}
            _config_loaded = True
        return _config_cache


def reload_config():
    """Forget the cached login so it is re-read from disk."""
    global _config_loaded
    with _lock:
        _config_loaded = False


def auth_enabled() -> bool:
    return _load_config() is not None


def current_username() -> Optional[str]:
    cfg = _load_config()
    return (cfg["username"] or None) if cfg else None


def _hash_password(password: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)


def verify_password(password: str) -> bool:
    cfg = _load_config()
    if not cfg:
        return False
    try:
        salt = bytes.fromhex(cfg["salt"])
        expected = bytes.fromhex(cfg["hash"])
        iterations = int(cfg.get("iterations", PBKDF2_ITERATIONS))
    except (KeyError, ValueError):
        return False
    return hmac.compare_digest(_hash_password(password, salt, iterations), expected)


def set_login(username: str, password: Optional[str]):
    """Create or update the login. password=None keeps the existing password."""
    global _config_cache, _config_loaded
    username = (username or "").strip()
    if not username:
        raise LoginError("Username can't be empty")
    if len(username) > MAX_USERNAME_LENGTH:
        raise LoginError(f"Username must be {MAX_USERNAME_LENGTH} characters or fewer")
    existing = _load_config()
    if password is None:
        if not existing:
            raise LoginError("A password is required")
        cfg = dict(existing, username=username)
    else:
        if len(password) < MIN_PASSWORD_LENGTH:
            raise LoginError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        salt = secrets.token_bytes(16)
        cfg = {
            "username": username,
            "algorithm": "pbkdf2_sha256",
            "iterations": PBKDF2_ITERATIONS,
            "salt": salt.hex(),
            "hash": _hash_password(password, salt, PBKDF2_ITERATIONS).hex(),
        }
    with _lock:
        _write_private(_auth_path(), json.dumps(cfg, indent=2).encode())
        _config_cache, _config_loaded = cfg, True


def remove_login():
    global _config_cache, _config_loaded
    with _lock:
        try:
            os.remove(_auth_path())
        except FileNotFoundError:
            pass
        _config_cache, _config_loaded = None, True


# ---------- sessions ----------

_key_cache: Optional[bytes] = None


def _signing_key() -> bytes:
    global _key_cache
    with _lock:
        if _key_cache is None:
            try:
                with open(_secret_path(), "rb") as f:
                    _key_cache = f.read()
            except FileNotFoundError:
                _key_cache = secrets.token_bytes(32)
                _write_private(_secret_path(), _key_cache)
        base = _key_cache
    cfg = _load_config() or {}
    # Mixing in the stored hash means a new password invalidates all old sessions
    return hashlib.sha256(base + b"|" + cfg.get("hash", "").encode()).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def create_session(now: Optional[float] = None) -> str:
    expires = int((now or time.time()) + SESSION_SECONDS)
    payload = f"{current_username() or ''}|{expires}".encode()
    sig = hmac.new(_signing_key(), payload, hashlib.sha256).digest()
    return f"{_b64(payload)}.{_b64(sig)}"


def verify_session(token: Optional[str], now: Optional[float] = None) -> bool:
    username_now = current_username()
    if not username_now or not token or "." not in token:
        return False
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _unb64(payload_b64)
        sig = _unb64(sig_b64)
    except Exception:
        return False
    expected = hmac.new(_signing_key(), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        username, expires = payload.decode().rsplit("|", 1)
        expires_at = int(expires)
    except Exception:
        return False
    if not hmac.compare_digest(username.encode(), username_now.encode()):
        return False
    return (now or time.time()) < expires_at


# ---------- credential checks with rate limiting ----------

_failures: dict[str, tuple[int, float]] = {}  # address -> (failure count, locked until)
_fail_lock = threading.Lock()


def seconds_locked(address: str, now: Optional[float] = None) -> int:
    now = now or time.time()
    with _fail_lock:
        _, locked_until = _failures.get(address, (0, 0.0))
    return max(0, int(locked_until - now + 0.999))


def _record(address: str, ok: bool, now: float):
    with _fail_lock:
        if ok:
            _failures.pop(address, None)
        else:
            count, _ = _failures.get(address, (0, 0.0))
            count += 1
            locked_until = now + LOCKOUT_SECONDS if count >= MAX_FAILURES else 0.0
            _failures[address] = (0 if locked_until else count, locked_until)


def check_credentials(address: str, username: str, password: str, now: Optional[float] = None) -> bool:
    """Check username + password for logging in, recording failures per address."""
    now = now or time.time()
    stored = current_username() or ""
    ok_user = hmac.compare_digest(username.encode(), stored.encode())
    ok_pass = verify_password(password)   # always run, so timing doesn't reveal the username
    ok = bool(stored) and ok_user and ok_pass
    _record(address, ok, now)
    return ok


def check_current_password(address: str, password: str, now: Optional[float] = None) -> bool:
    """Confirm the current password before changing or removing the login."""
    ok = verify_password(password)
    _record(address, ok, now or time.time())
    return ok


def is_public_path(path: str) -> bool:
    return not path.startswith("/api/") or path in PUBLIC_PATHS
