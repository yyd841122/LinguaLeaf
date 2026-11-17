import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderMenu } from "../src/reader/ReaderMenu";

// The summonable chrome (redesign 02): hidden by default (零常驻
// chrome — the acceptance gate), the bars carry 返回 / title /
// progress on top and the face's item row below. Panels are the face's
// own overlays — the menu only reports the selection.

afterEach(() => {
  vi.restoreAllMocks();
});

const items = [
  { key: "toc", label: "目录" },
  { key: "bookmarks", label: "书签" },
  { key: "ipa", label: "音标", active: true },
  { key: "aa", label: "Aa" },
];

describe("ReaderMenu", () => {
  it("renders nothing when the menu is hidden — the reading face carries no resident chrome", () => {
    const { container } = render(
      <ReaderMenu open={false} title="" progress="" items={items} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "返回" })).toBeNull();
  });

  it("opens with 返回, the title line, the progress and the item row", () => {
    render(
      <ReaderMenu
        open
        title="Alice · Chapter One"
        progress="12%"
        items={items}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    expect(screen.getByText("Alice · Chapter One")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    for (const item of items) {
      expect(
        screen.getByRole("button", { name: item.label })
      ).toBeInTheDocument();
    }
  });

  it("reports item selections and the back navigation, keeps toggles honest via aria-pressed", () => {
    const onBack = vi.fn();
    const onSelect = vi.fn();
    render(
      <ReaderMenu
        open
        title="t"
        progress="1%"
        items={[
          { key: "toc", label: "目录" },
          { key: "ipa", label: "音标", active: true },
        ]}
        onBack={onBack}
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    expect(onSelect).toHaveBeenCalledWith("toc");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "音标" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders the top bar before the reading flow (DNS order for screen readers)", () => {
    const { baseElement } = render(
      <ReaderMenu open title="t" progress="1%" items={items} />
    );
    const top = baseElement.querySelector(".reader-menu-top");
    const bottom = baseElement.querySelector(".reader-menu-bottom");
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(
      top!.compareDocumentPosition(bottom!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
