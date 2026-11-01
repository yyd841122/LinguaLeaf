// ReadingView writes data-position on every block kind. Keep the read-side
// selector shared by progress restore, visible-block capture, and web tests.
export function readingBlockSelector(position?: number): string {
  const value = position === undefined ? "" : `="${position}"`;
  return `.blocks [data-position${value}]`;
}
