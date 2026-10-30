import type { ContentItem } from "./extract-html.js";
import { buildIpaSlots, type IpaLookup } from "./ipa-line.js";
import { splitSentences } from "./sentences.js";

// The annotation dispatch both hosts share: sentence items split and pair
// each word with its IPA slot (the word-pairing truth source), while
// image/code/raw items pass through as unannotated placeholders in reading
// position. The dictionary binding stays host-side — the walk takes an
// IpaLookup (SQLite server-side, baked offline extension-side) and hands
// each block to the host's callbacks, so the server derives its SQLite
// columns (BlockRow) and the extension its UI shape (ExtBlock) from one
// dispatch instead of two same-shaped walks (ext-reuse-convergence).
export type PlainKind = "code" | "raw" | "image";

export function walkChapterBlocks<TSentence, TPlain>(
  items: ContentItem[],
  lookup: IpaLookup,
  hosts: {
    sentence: (text: string, ipaSlots: string[]) => TSentence;
    plain: (kind: PlainKind, text: string) => TPlain;
  }
): (TSentence | TPlain)[] {
  return items.flatMap((item): (TSentence | TPlain)[] =>
    item.kind === "paragraph"
      ? splitSentences(item.text).map((text) =>
          hosts.sentence(text, buildIpaSlots(lookup, text))
        )
      : [hosts.plain(item.kind, item.text)]
  );
}
