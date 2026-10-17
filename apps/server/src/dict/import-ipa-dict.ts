import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  defaultDictionaryPath,
  isSingleWordForm,
  normalizeToken,
  openDictionary,
} from "./dictionary.js";

// ipa-dict (open-dict-data/ipa-dict) lines are "word<TAB>/ipa1/, /ipa2/":
// tab-separated, transcriptions slash-wrapped, variants comma-separated.
// Multi-variant entries keep their first (most common) variant; entries that
// are not single word forms (phrases, leading apostrophes like 'bout) are
// skipped — they can never be looked up by the word tokenizer.
export function importIpaDictText(
  text: string,
  dictionary: ReturnType<typeof openDictionary>
): void {
  const insert = dictionary.prepare(
    "INSERT OR IGNORE INTO dict_ipa_us (word, ipa) VALUES (?, ?)"
  );
  dictionary.transaction(() => {
    for (const line of text.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 1) continue;
      const word = normalizeToken(line.slice(0, tab));
      if (!isSingleWordForm(word)) continue;
      const firstVariant = line
        .slice(tab + 1)
        .split(",")[0]
        ?.trim();
      if (!firstVariant) continue;
      const ipa = /^\/(.+)\/$/.exec(firstVariant)?.[1];
      if (!ipa) continue;
      insert.run(word, ipa);
    }
  })();
}

export function importIpaDictFromPaths(
  sourcePath: string,
  targetPath: string
): void {
  const dictionary = openDictionary(targetPath);
  try {
    importIpaDictText(readFileSync(sourcePath, "utf8"), dictionary);
    const count = (
      dictionary.prepare("SELECT COUNT(*) AS c FROM dict_ipa_us").get() as {
        c: number;
      }
    ).c;
    console.log(
      `ipa-dict import complete: dictionary now holds ${count} American IPA entries at ${targetPath}`
    );
  } finally {
    dictionary.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error(
      "usage: npm run dict:import-ipa-dict -- <en_US.txt> [target.sqlite]"
    );
    process.exitCode = 1;
  } else {
    importIpaDictFromPaths(
      sourcePath,
      process.argv[3] ?? defaultDictionaryPath()
    );
  }
}
