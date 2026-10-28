// The two posix path operations the EPUB front half needs, as pure string
// functions: the browser has no node:path and the import chain must bundle
// there (ADR-0006). Semantics mirror node's path.posix for the shapes EPUB
// container paths take (relative package paths, relative hrefs, "." and
// ".." segments); the epub chain's tests pin the behavior on both sides of
// the move.
export function dirname(path: string): string {
  // Trailing slashes do not make a final segment ("a/b/" → "a").
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") return path.startsWith("/") ? "/" : ".";
  const cut = trimmed.lastIndexOf("/");
  if (cut === -1) return ".";
  return cut === 0 ? "/" : trimmed.slice(0, cut);
}

export function join(...segments: string[]): string {
  const joined = segments.filter((segment) => segment !== "").join("/");
  const absolute = joined.startsWith("/");
  const out: string[] = [];
  for (const segment of joined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Pop a real segment; a leading ".." survives on relative paths and
      // is dropped above an absolute root, exactly as node clamps it.
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else if (!absolute) {
        out.push("..");
      }
      continue;
    }
    out.push(segment);
  }
  const joined2 = (absolute ? "/" : "") + out.join("/");
  return joined2 === "" ? "." : joined2;
}
