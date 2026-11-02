import { useCallback, useMemo, useState } from "react";
import type { Owner, OwnerTicket } from "./useOwner.js";

export type SettleOutcome<T> =
  { ok: true; value: T; fresh: boolean } | { ok: false; fresh: boolean };

export type SettleHooks<T> = {
  // 落页应用先于票裁决(GLOSSARY 落回裁决的显式变体「先落页、后验陈旧」,
  // popup-status-backedge 决策 3):成功即调恰一次,陈旧也调;缺省 no-op。
  onLanded?: (value: T) => void;
  // 凭票的本地应用:仅新鲜成功,清旗之后调恰一次;缺省 no-op。两个钩子
  // 互不回退——缺省同钩会让普通站在验票前应用一次、新鲜成功再应用一次。
  onFresh?: (value: T) => void;
  // 外携票据三态:省略 = owner.mark()(铸于 op 起点);传票 = 凭它裁决;
  // 显式 null = 照发 op、旗与回调全不写(flushSave 的「照发保存、反馈
  // 不落」契约,settle-channel 02 启用)。
  ticket?: OwnerTicket | null;
};

export type SettleChannel = {
  // 唯一失败旗;裁决写入全通道只有两处:新鲜失败→true,新鲜成功→false。
  // 意图侧清旗不归通道:run 从不在开始自动清旗(逐 tick 清会让轮询的
  // outage 闪烁),调用方在 arm 处显式 clear()。
  readonly failed: boolean;
  clear: () => void;
  // 照发 op,永不因票据状态拒发——裁决只管落回,不管发送(flushSave 的
  // 「票据空也照发保存」前提)。op 的拒绝永不穿透(吞进裁决,凭 outcome
  // 分支);hook 同步抛出按调用方自身缺陷 reject,已发生的裁决写入不回滚。
  run: <T>(op: Promise<T>, hooks?: SettleHooks<T>) => Promise<SettleOutcome<T>>;
};

// 落回裁决通道(spec: .scratch/settle-channel/)— the settling scaffold the
// sessions used to hand-roll, once: a stale round never speaks (its success
// is discarded, and so is its failure), a fresh failure raises the flag, a
// fresh success clears it and applies. Built ON the owner token
// (GLOSSARY 属主令牌), never instead of it: run mints at the op's start,
// and invalidation stays the caller's explicit move — run must not
// invalidate implicitly, or the double-click's losing 409 could never
// speak before the winning 202 lands.
export function useSettle(owner: Owner): SettleChannel {
  const [failed, setFailed] = useState(false);

  const clear = useCallback(() => setFailed(false), []);

  const run = useCallback(
    <T>(op: Promise<T>, hooks?: SettleHooks<T>): Promise<SettleOutcome<T>> => {
      const external = hooks?.ticket;
      const ticket: OwnerTicket | null =
        external === undefined ? owner.mark() : external;
      return op.then(
        (value): SettleOutcome<T> => {
          // Success sequence, fixed order: landed once (stale or not),
          // then the verdict, then — only fresh — the flag clears and
          // fresh applies once.
          if (ticket === null) return { ok: true, value, fresh: false };
          hooks?.onLanded?.(value);
          const fresh = !ticket.stale();
          if (fresh) {
            setFailed(false);
            hooks?.onFresh?.(value);
          }
          return { ok: true, value, fresh };
        },
        (): SettleOutcome<T> => {
          if (ticket === null) return { ok: false, fresh: false };
          const fresh = !ticket.stale();
          if (fresh) setFailed(true);
          return { ok: false, fresh };
        }
      );
    },
    [owner]
  );

  // run/clear stay referentially stable across renders (the Owner is
  // useMemo-stable), so effects may depend on them; the channel object
  // itself follows the flag, as state should.
  return useMemo(() => ({ failed, clear, run }), [failed, clear, run]);
}
