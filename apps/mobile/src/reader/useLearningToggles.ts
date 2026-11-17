import { useEffect, useState } from "react";
import type {
  LearningSettingsStore,
  LearningToggles,
} from "../store/learning-settings-store";

// 逐书学习开关 (redesign 02): the per-book toggle load + save shape both
// faces share — EPUB carries 音标+译文, PDF only 音标. Defaults are the
// old global values (on); every flip persists immediately, OUTSIDE the
// state updater (a save inside the updater double-fires under StrictMode
// — the dual-axis review's catch).
export type LearningKey = keyof LearningToggles;

export function useLearningToggles<K extends LearningKey>(
  learning: LearningSettingsStore,
  docId: string,
  keys: readonly K[]
): {
  toggles: Record<K, boolean>;
  toggle: (key: K) => void;
} {
  const initial = () =>
    Object.fromEntries(keys.map((key) => [key, true])) as Record<K, boolean>;
  const [toggles, setToggles] = useState<Record<K, boolean>>(initial);
  useEffect(() => {
    let cancelled = false;
    learning
      .load(docId)
      .then((value) => {
        if (cancelled) return;
        setToggles((current) => {
          const next = { ...current };
          for (const key of keys) next[key] = value[key];
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // keys is a face-fixed literal — a NEW array identity per render, so
    // listing it here re-ran the load on every render and spun an
    // infinite load→setState→rerender loop (the full-suite timeouts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learning, docId]);
  const toggle = (key: K) => {
    const next = !toggles[key];
    setToggles((current) => ({ ...current, [key]: next }));
    void learning.save(docId, { [key]: next });
  };
  return { toggles, toggle };
}
