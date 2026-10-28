import { useEffect, useRef, useState } from "react";
import { useOwner } from "./useOwner";

// The one follower for server-side background tasks (spec:
// .scratch/task-follower/spec.md): while `active`, re-asks `fetchTick` on
// an interval and hands each fresh result to `onTick`. The rules the shelf's
// import poll and the reading page's translation poll used to hand-roll live
// here now, once: the first tick lands after intervalMs (the trigger's own
// response patches first), a failed tick never touches page data, a landed
// tick clears the outage, and a tick that was in flight when invalidate()
// fired is discarded — a snapshot from before a mutation must not patch over
// it (the resurrected-row bug class from the 2026-10-23 audit).

export type TaskFollower = {
  // Set when the latest tick failed, cleared when one lands. Rendering it
  // is the page's call: both pages gate the notice on their own active
  // fact (hasImporting / translating) — "a retry loop's last state must
  // not outlive its credibility" (CODING_STANDARDS).
  outage: boolean;
  // Discards any tick in flight from this moment. Destructive mutations
  // call it (the shelf: upload and delete) so a stale response cannot
  // resurrect what the mutation just removed.
  invalidate: () => void;
};

export function useTaskFollower<T>(options: {
  active: boolean;
  fetchTick: () => Promise<T>;
  onTick: (data: T) => void;
  intervalMs: number;
}): TaskFollower {
  const { active, fetchTick, onTick, intervalMs } = options;
  const [outage, setOutage] = useState(false);
  const owner = useOwner();

  // The interval re-arms only on active/intervalMs; the callbacks ride
  // refs so a page re-render (new inline closures) never resets the
  // cadence — the latest closure wins at tick time.
  const fetchTickRef = useRef(fetchTick);
  fetchTickRef.current = fetchTick;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!active) return;
    // A fresh follow starts clean: an outage from a previous follow must
    // not leak across a teardown/re-arm (a route change does both).
    setOutage(false);
    let cancelled = false;
    const interval = window.setInterval(() => {
      const ticket = owner.mark();
      fetchTickRef
        .current()
        .then((data) => {
          if (cancelled || ticket.stale()) return;
          setOutage(false);
          onTickRef.current(data);
        })
        .catch(() => {
          // Keep the page as-is; the next tick retries. But say so — a
          // frozen progress label alone would hide the outage. A stale
          // round never speaks: its success is discarded, and so is its
          // failure — the next fresh tick re-asks within one interval.
          if (!cancelled && !ticket.stale()) setOutage(true);
        });
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active, intervalMs, owner]);

  return { outage, invalidate: owner.invalidate };
}
