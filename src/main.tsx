import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Apply the saved theme before anything renders, so the login page matches it too
try {
  document.documentElement.classList.toggle('dark', localStorage.getItem('imgvault-theme') !== 'light');
} catch {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById("root")!).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const { Workbox } = await import('workbox-window');
    const wb = new Workbox('/sw.js');
    wb.addEventListener('waiting', () => {
      wb.messageSkipWaiting();
    });
    await wb.register();
  });
}
