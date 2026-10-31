// Tells the server a reader is present so the launcher's watchdog can tell
// "closed" from "quiet" (plan.md T4 修订): POST /api/heartbeat every 10s,
// immediately on returning to visibility, and once via sendBeacon when the
// page goes away. Fire-and-forget by design — the server answers 204 with
// no body (fetchJson already returns undefined for that) and nothing
// consumes the reply; a stopping server must not surface here as a UI
// error, the watchdog owns that lifecycle.
import { fetchJson } from "./api";

const HEARTBEAT_INTERVAL_MS = 10_000;

export async function sendHeartbeat(): Promise<void> {
  await fetchJson("/api/heartbeat", { method: "POST" });
}

// Mounts the page-presence signal for the app's lifetime and returns the
// disposer (tests use it; production never does — the page going away is
// the signal).
export function startHeartbeat(): () => void {
  const ping = (): void => {
    void sendHeartbeat().catch(() => {});
  };
  const onVisible = (): void => {
    if (document.visibilityState === "visible") {
      ping();
    }
  };
  const onHide = (): void => {
    navigator.sendBeacon("/api/heartbeat", new Blob());
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onHide);
  ping();
  const timer = setInterval(ping, HEARTBEAT_INTERVAL_MS);
  return (): void => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pagehide", onHide);
  };
}
