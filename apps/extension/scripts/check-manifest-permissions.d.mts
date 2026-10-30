// Type surface for the manifest-permission gate, which is a plain .mjs
// script (scripts/ is outside the typecheck program) but gets imported by
// test/checkManifestPermissions.test.ts.
export interface ManifestLike {
  permissions?: string[];
}

export interface SourceFileInput {
  path: string;
  text: string;
}

export function reconcilePermissions(args: {
  manifest: ManifestLike;
  files: SourceFileInput[];
}): { offenders: string[]; used: string[] };
