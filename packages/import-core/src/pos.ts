// ECDICT's `pos` column holds corpus frequency codes (n:96/v:4) that are
// not fit for display; the translation lines already carry reader-facing
// markers ("n. 书\nv. 预订"), so the part of speech shown to users is the
// distinct set of those markers in order. Shared by the server's lookup
// route and the extension's offline popup — one entry shape, two hosts.
export function posFromTranslation(translation: string): string | null {
  const tags: string[] = [];
  for (const line of translation.split("\n")) {
    const match = /^\s*([a-z]+)\s*\./.exec(line);
    if (!match || !match[1]) continue;
    const tag = `${match[1]}.`;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.length > 0 ? tags.join(" ") : null;
}
