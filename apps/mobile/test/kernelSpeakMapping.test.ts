import { describe, expect, it } from "vitest";
import {
  KERNEL_SPEAK_VIRTUAL_ID,
  resolveKernelSpeak,
} from "../src/speak/kernel-speak";

// The virtual id maps the mobile router's one kernel-speak import to the
// kernel's built module; every other specifier passes through untouched.
// Paths are injected, so the fixture name carries no real checkout.
const KERNEL_SPEAK = "/srv/checkout/packages/reading-model/dist/speak.js";

describe("resolveKernelSpeak", () => {
  it("maps the virtual id to the kernel's built speak module", () => {
    expect(
      resolveKernelSpeak(KERNEL_SPEAK_VIRTUAL_ID, {
        kernelSpeakPath: KERNEL_SPEAK,
      })
    ).toBe(KERNEL_SPEAK);
  });

  it("passes every real specifier through", () => {
    expect(
      resolveKernelSpeak("./router.ts", { kernelSpeakPath: KERNEL_SPEAK })
    ).toBeNull();
    expect(
      resolveKernelSpeak("@lingualeaf/reading-model/react", {
        kernelSpeakPath: KERNEL_SPEAK,
      })
    ).toBeNull();
    expect(
      resolveKernelSpeak("virtual:other", { kernelSpeakPath: KERNEL_SPEAK })
    ).toBeNull();
  });
});
