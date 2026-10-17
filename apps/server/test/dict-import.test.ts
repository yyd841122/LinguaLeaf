import DatabaseConstructor from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDictionary } from "../src/dict/dictionary.js";
import { importEcdictDatabase } from "../src/dict/import-ecdict.js";
import { importIpaDictText } from "../src/dict/import-ipa-dict.js";

// A miniature stardict.db: the columns the importer reads, plus the data
// quirks real ECDICT data has (phrases, digit words, inflected entries with
// a 0: lemma field).
function createSourceDatabase() {
  const source = new DatabaseConstructor(":memory:");
  source.exec(`
    CREATE TABLE stardict (
      word VARCHAR(64) COLLATE NOCASE NOT NULL UNIQUE,
      phonetic VARCHAR(64),
      translation TEXT,
      exchange TEXT
    );
  `);
  const insert = source.prepare(
    "INSERT INTO stardict (word, phonetic, translation, exchange) VALUES (?, ?, ?, ?)"
  );
  const rows: Array<[string, string, string, string]> = [
    ["book", "bʊk", "n. 书\nv. 预订", "s:books/p:booked"],
    ["books", "", "n. 书（book的复数）", "1:s3/0:book"],
    ["zebra", "zebrə", "n. 斑马", ""],
    [
      "perceive",
      "pə'si:v",
      "v. 察觉",
      "d:perceived/p:perceived/3:perceives/i:perceiving",
    ],
    ["give up", "", "v. 放弃", ""],
    ["3D", "", "abbr. 三维", ""],
  ];
  for (const row of rows) insert.run(...row);
  return source;
}

describe("ECDICT importer", () => {
  let source: DatabaseConstructor.Database;
  let dictionary: ReturnType<typeof openDictionary>;

  beforeEach(() => {
    source = createSourceDatabase();
    dictionary = openDictionary(":memory:");
  });
  afterEach(() => {
    source.close();
    dictionary.close();
  });

  function words(): string[] {
    return (
      dictionary.prepare("SELECT word FROM dict_words ORDER BY word").all() as {
        word: string;
      }[]
    ).map((row) => row.word);
  }

  function inflections(): string[] {
    return (
      dictionary
        .prepare(
          "SELECT form || '=' || lemma AS pair FROM dict_inflections ORDER BY pair"
        )
        .all() as { pair: string }[]
    ).map((row) => row.pair);
  }

  it("imports single words, their phonetics, and the inflection index", () => {
    importEcdictDatabase(source, dictionary);
    expect(words()).toEqual(["book", "books", "perceive", "zebra"]);
    const book = dictionary
      .prepare("SELECT phonetic, translation FROM dict_words WHERE word = ?")
      .get("book") as { phonetic: string; translation: string };
    expect(book.phonetic).toBe("bʊk");
    expect(book.translation).toBe("n. 书\nv. 预订");
    // d: and p: both point at "perceived"; only one pair survives.
    expect(inflections()).toEqual([
      "booked=book",
      "books=book",
      "perceived=perceive",
      "perceives=perceive",
      "perceiving=perceive",
    ]);
  });

  it("is repeatable: running it again changes nothing", () => {
    importEcdictDatabase(source, dictionary);
    const wordCount = (
      dictionary.prepare("SELECT COUNT(*) AS c FROM dict_words").get() as {
        c: number;
      }
    ).c;
    const inflectionCount = (
      dictionary
        .prepare("SELECT COUNT(*) AS c FROM dict_inflections")
        .get() as { c: number }
    ).c;
    importEcdictDatabase(source, dictionary);
    expect(
      (
        dictionary.prepare("SELECT COUNT(*) AS c FROM dict_words").get() as {
          c: number;
        }
      ).c
    ).toBe(wordCount);
    expect(
      (
        dictionary
          .prepare("SELECT COUNT(*) AS c FROM dict_inflections")
          .get() as {
          c: number;
        }
      ).c
    ).toBe(inflectionCount);
  });
});

describe("ipa-dict importer", () => {
  let dictionary: ReturnType<typeof openDictionary>;

  beforeEach(() => {
    dictionary = openDictionary(":memory:");
  });
  afterEach(() => {
    dictionary.close();
  });

  function ipaRows(): Record<string, string> {
    const rows = dictionary
      .prepare("SELECT word, ipa FROM dict_ipa_us ORDER BY word")
      .all() as { word: string; ipa: string }[];
    return Object.fromEntries(rows.map((row) => [row.word, row.ipa]));
  }

  it("keeps the first American variant of single-word entries", () => {
    importIpaDictText(
      [
        "'bout\t/ˈbaʊt/",
        "gentleman\t/ˈdʒɛnəɫmən/, /ˈdʒɛntəɫmən/",
        "ice cream\t/ˌaɪs ˈkɹiːm/",
        "books\t/ˈbʊks/",
        "not an ipa line",
        "",
      ].join("\n"),
      dictionary
    );
    expect(ipaRows()).toEqual({
      books: "ˈbʊks",
      gentleman: "ˈdʒɛnəɫmən",
    });
  });

  it("is repeatable: running it again changes nothing", () => {
    const text = "books\t/ˈbʊks/\nwater\t/ˈwɔtɝ/";
    importIpaDictText(text, dictionary);
    const count = (
      dictionary.prepare("SELECT COUNT(*) AS c FROM dict_ipa_us").get() as {
        c: number;
      }
    ).c;
    importIpaDictText(text, dictionary);
    expect(
      (
        dictionary.prepare("SELECT COUNT(*) AS c FROM dict_ipa_us").get() as {
          c: number;
        }
      ).c
    ).toBe(count);
  });
});
