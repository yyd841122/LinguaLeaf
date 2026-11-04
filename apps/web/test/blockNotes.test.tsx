import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  AnnotatedBlockView,
  type AnnotatedBlock,
} from "@lingualeaf/reading-model/react";

it.each(["sentence", "code", "raw", "image"] as const)(
  "renders both note states on %s and emits the actual button",
  (kind) => {
    const block: AnnotatedBlock =
      kind === "sentence"
        ? { kind, text: "Read this.", position: 4, ipaSlots: null }
        : { kind, text: "Read this.", position: 4 };
    const click = vi.fn();
    const { container, rerender } = render(
      <AnnotatedBlockView
        block={block}
        statusOf={() => null}
        showIpa
        showTranslation
      />
    );
    expect(
      screen.queryByRole("button", { name: "写笔记" })
    ).not.toBeInTheDocument();
    rerender(
      <AnnotatedBlockView
        block={block}
        statusOf={() => null}
        showIpa
        showTranslation
        note={{ exists: false, onClick: click }}
      />
    );
    const button = screen.getByRole("button", { name: "写笔记" });
    fireEvent.click(button);
    expect(click).toHaveBeenCalledWith(button);
    expect(container.querySelector("[data-position]")).not.toHaveClass(
      "has-note"
    );
    rerender(
      <AnnotatedBlockView
        block={block}
        statusOf={() => null}
        showIpa
        showTranslation
        note={{ exists: true, onClick: click }}
      />
    );
    expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
      "has-note"
    );
    expect(container.querySelector("[data-position]")).toHaveClass("has-note");
  }
);
