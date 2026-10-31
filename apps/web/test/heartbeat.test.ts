import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHeartbeat } from "../src/heartbeat";

// The heartbeat is the launcher watchdog's page-presence signal: these
// tests pin the mechanics — immediate first ping, 10s cadence, a ping on
// return to visibility, one beacon on pagehide, and silence (no throw, no
// unhandled rejection) while the server is already down.
const fetchMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startHeartbeat", () => {
  it("pings immediately and then every 10s", async () => {
    const stop = startHeartbeat();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    stop();
  });

  it("pings when the page becomes visible again, not while hidden", async () => {
    const stop = startHeartbeat();
    fetchMock.mockClear();
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Drop the instance override so the prototype getter resumes.
    delete (document as { visibilityState?: unknown }).visibilityState;
    stop();
  });

  it("beacons once when the page goes away", () => {
    const beacon = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon });
    const stop = startHeartbeat();
    window.dispatchEvent(new Event("pagehide"));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]?.[0]).toBe("/api/heartbeat");
    stop();
  });

  it("keeps trying silently while the server is down", async () => {
    const stop = startHeartbeat();
    fetchMock.mockRejectedValue(new Error("server stopped"));
    await vi.advanceTimersByTimeAsync(30_000);
    // Three interval ticks after the initial ping, none of them throwing
    // to the console as an unhandled rejection (vitest would fail the test).
    expect(fetchMock).toHaveBeenCalledTimes(4);
    stop();
  });
});
