import { useCallback, useMemo, useRef } from "react";

export type OwnerTicket = { stale: () => boolean };
export type Owner = { mark: () => OwnerTicket; invalidate: () => void };

// 陈旧异步响应不得写状态 (spec: .scratch/owner-token/spec.md).
// Mark at the async start; check the ticket before writing state. The key
// follows the latest render, and invalidate discards all earlier tickets.
export function useOwner(...parts: unknown[]): Owner {
  const currentPartsRef = useRef(parts);
  currentPartsRef.current = parts;
  const versionRef = useRef(0);

  const mark = useCallback((): OwnerTicket => {
    const capturedParts = currentPartsRef.current;
    const version = versionRef.current;
    return {
      stale: () =>
        version !== versionRef.current ||
        capturedParts.length !== currentPartsRef.current.length ||
        capturedParts.some(
          (part, index) => !Object.is(part, currentPartsRef.current[index])
        ),
    };
  }, []);

  const invalidate = useCallback(() => {
    versionRef.current += 1;
  }, []);

  // Effects can depend on the owner without restarting on every render.
  return useMemo(() => ({ mark, invalidate }), [mark, invalidate]);
}
