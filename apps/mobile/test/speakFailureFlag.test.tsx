import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SpeakFailureFlag } from "../src/speak/SpeakFailureFlag";

// The reader-facing speak failure flag (ticket 09): a missing engine and
// a failed synthesis read as two different sentences (CODING_STANDARDS,
// missing ≠ failed), the flag announces itself via role="alert", and the
// reader can dismiss it.
describe("SpeakFailureFlag", () => {
  it("a missing engine reads as no usable engine, with a way out", () => {
    const onClose = vi.fn();
    render(
      <SpeakFailureFlag
        failure={{ kind: "engine-missing" }}
        onClose={onClose}
      />
    );
    const flag = screen.getByRole("alert");
    expect(flag).toHaveTextContent("语音引擎");
    expect(flag).toHaveTextContent("无法发音");
    fireEvent.click(screen.getByRole("button", { name: "关闭发音提示" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a failed synthesis reads as a retryable failure, distinct from a missing engine", () => {
    render(
      <SpeakFailureFlag
        failure={{ kind: "synthesis-failed" }}
        onClose={vi.fn()}
      />
    );
    const flag = screen.getByRole("alert");
    expect(flag).toHaveTextContent("发音失败");
    expect(flag).toHaveTextContent("请稍后再试");
    expect(flag).not.toHaveTextContent("语音引擎");
  });
});
