"""Single-user login for ImgVault.

Configured with two environment variables:
    IMGVAULT_USERNAME
    IMGVAULT_PASSWORD

If either is missing, login is switched off and the app behaves exactly as before.

Sessions are a signed cookie (HMAC-SHA256) holding the username and an expiry time.
The signing key is generated once and kept in the database folder, so sessions
survive container restarts. Changing the password logs out every existing session.

Standard library only, so it can be tested without the rest of the backend.
"""
import base64
import hashlib
import hmac
import os
import secrets
import threading
import time
from typing import Optional

COOKIE_NAME = "imgvault_session"
SESSION_DAYS = int(os.environ.get("IMGVAULT_SESSION_DAYS", "30"))
SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60

# Brute-force protection: after MAX_FAILURES wrong attempts from one address,
# that address is locked out for LOCKOUT_SECONDS.
MAX_FAILURES = 5
LOCKOUT_SECONDS = 60

# API paths reachable without logging in
PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/auth/status", "/api/auth/logout"}


def _username() -> str:
    return os.environ.get("IMGVAULT_USERNAME", "")


def _password() -> str:
    return os.environ.get("IMGVAULT_PASSWORD", "")


def auth_enabled() -> bool:
    return bool(_username() and _password())


# ---------- signing key ----------

_key_lock = threading.Lock()
_key_cache: Optional[bytes] = None


def _secret_path() -> str:
    db_path = os.environ.get("DB_PATH", "/data/db/snapvault.db")
    return os.path.join(os.path.dirname(db_path), ".session_secret")


def _signing_key() -> bytes:
    """Random key stored next to the database, mixed with the password so that
    changing the password invalidates all existing sessions."""
    global _key_cache
    with _key_lock:
        if _key_cache is None:
            path = _secret_path()
            try:
                with open(path, "rb") as f:
                    _key_cache = f.read()
            except FileNotFoundError:
                _key_cache = secrets.token_bytes(32)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(_key_cache)
        base = _key_cache
    return hashlib.sha256(base + b"|" + _password().encode()).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ---------- sessions ----------

def create_session(now: Optional[float] = None) -> str:
    expires = int((now or time.time()) + SESSION_SECONDS)
    payload = f"{_username()}|{expires}".encode()
    sig = hmac.new(_signing_key(), payload, hashlib.sha256).digest()
    return f"{_b64(payload)}.{_b64(sig)}"


def verify_session(token: Optional[str], now: Optional[float] = None) -> bool:
    if not token or "." not in token:
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
    if not hmac.compare_digest(username.encode(), _username().encode()):
        return False
    return (now or time.time()) < expires_at


# ---------- credential check with rate limiting ----------

_failures: dict[str, tuple[int, float]] = {}  # address -> (failure count, locked until)
_fail_lock = threading.Lock()


def seconds_locked(address: str, now: Optional[float] = None) -> int:
    now = now or time.time()
    with _fail_lock:
        _, locked_until = _failures.get(address, (0, 0.0))
    return max(0, int(locked_until - now + 0.999))


def check_credentials(address: str, username: str, password: str, now: Optional[float] = None) -> bool:
    """Constant-time check of username and password, recording failures per address."""
    now = now or time.time()
    ok_user = hmac.compare_digest(username.encode(), _username().encode())
    ok_pass = hmac.compare_digest(password.encode(), _password().encode())
    ok = ok_user and ok_pass and auth_enabled()
    with _fail_lock:
        if ok:
            _failures.pop(address, None)
        else:
            count, _ = _failures.get(address, (0, 0.0))
            count += 1
            locked_until = now + LOCKOUT_SECONDS if count >= MAX_FAILURES else 0.0
            _failures[address] = (0 if locked_until else count, locked_until)
    return ok


def is_public_path(path: str) -> bool:
    return not path.startswith("/api/") or path in PUBLIC_PATHS
