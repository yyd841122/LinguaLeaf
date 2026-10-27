// jsdom's selector engine matches attribute values case-insensitively
// (nwsapi: [data-word="Woke"] resolves to the lowercase "woke" span; real
// browsers are case-sensitive), so an exact-name lookup goes through
// getAttribute and selectors only narrow the element set
// (CODING_STANDARDS, "Exact-name attribute assertions go through
// getAttribute").
export function dataWordEls(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>("[data-word]")];
}

export function dataWordEl(
  scope: ParentNode,
  name: string
): HTMLElement | null {
  return (
    dataWordEls(scope).find((el) => el.getAttribute("data-word") === name) ??
    null
  );
}
