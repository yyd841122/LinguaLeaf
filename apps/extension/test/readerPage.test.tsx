import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReaderPage } from "../src/reader/ReaderPage";
import { buildEpub } from "@lingualeaf/import-core/testing";

// The page meets real files, so the tests drive real bytes: the shared
// deterministic builder (import-core/testing) assembles the EPUB, planted
// on the file input the way a user's picker would.
async function fixtureFile(name: string, bytes: Uint8Array): Promise<File> {
  return new File([bytes as BlobPart], name, {
    type: "application/epub+zip",
  });
}

const SAMPLE_EPUB = () =>
  buildEpub({
    title: "Skeleton Book",
    docs: [
      {
        href: "text/one.xhtml",
        body: "<h1>Chapter One</h1><p>Words arrive on the page. A second sentence follows.</p>",
      },
      {
        href: "text/two.xhtml",
        body: "<h2>Chapter Two</h2><p>More words live here.</p>",
      },
    ],
  });

async function pickFile(file: File): Promise<void> {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  // configurable: a test re-plants files after an error phase.
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("ReaderPage — the EPUB skeleton", () => {
  it("imports a fixture EPUB and reads it chapter by chapter", async () => {
    render(<ReaderPage />);
    await pickFile(await fixtureFile("book.epub", await SAMPLE_EPUB()));

    expect(
      await screen.findByRole("heading", { name: "Skeleton Book" })
    ).toBeInTheDocument();
    // First chapter's content, sentences split per 句子块.
    expect(
      await screen.findByText("Words arrive on the page.")
    ).toBeInTheDocument();
    expect(screen.getByText("A second sentence follows.")).toBeInTheDocument();
    // The TOC knows both chapters; switching shows the other one.
    fireEvent.click(screen.getByRole("button", { name: "Chapter Two" }));
    expect(
      await screen.findByText("More words live here.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Words arrive on the page.")
    ).not.toBeInTheDocument();
  });

  it("reports a broken archive with the invalid-epub copy and keeps the entry usable", async () => {
    render(<ReaderPage />);
    const garbage = await fixtureFile(
      "broken.epub",
      new TextEncoder().encode("this is not a zip file")
    );
    await pickFile(garbage);

    expect(
      await screen.findByText("导入失败：文件无法解析，可能已损坏。")
    ).toBeInTheDocument();
    // The error is a phase, not a dead end: a good file still imports.
    await pickFile(await fixtureFile("book.epub", await SAMPLE_EPUB()));
    expect(
      await screen.findByRole("heading", { name: "Skeleton Book" })
    ).toBeInTheDocument();
  });

  it("declines non-EPUB files with the unsupported copy", async () => {
    render(<ReaderPage />);
    const pdf = await fixtureFile("paper.pdf", new Uint8Array([1, 2, 3]));
    await pickFile(pdf);

    expect(
      await screen.findByText("暂不支持这种文件——扩展阅读页当前支持 EPUB。")
    ).toBeInTheDocument();
  });
});
