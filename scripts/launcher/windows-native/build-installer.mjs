#!/usr/bin/env node
// Packager for the Windows-native installer (Inno Setup wizard exe).
// Runs inside WSL on the packaging machine; Windows-side steps (ISCC) are
// invoked through /mnt/c interop. Produces dist/LinguaLeaf-setup-<version>.exe
// from: the HEAD source snapshot (git archive — .env/.data/node_modules are
// untracked and never included), the freshly built .output, and a portable
// Node.js win-x64 runtime. See .scratch/windows-native-installer/spec.md.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
).version;
const NODE_VERSION = "v24.21.0";
const NODE_ZIP_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;
// Stable across versions so a newer setup exe upgrades the same install.
const APP_ID = "12E2BBE6-B08D-44F5-AC85-959F6899D40B";
// ISCC.exe is a Windows binary: the payload must live on a Windows-visible
// path. Public is writable without admin.
const STAGE = "/mnt/c/Users/Public/lingualeaf-installer";
const CACHE = "/tmp/lingualeaf-installer-cache";
const ISCC_CANDIDATES = [
  "/mnt/c/Program Files/Inno Setup 6/ISCC.exe",
  "/mnt/c/Program Files (x86)/Inno Setup 6/ISCC.exe",
];

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(
      `build-installer: ${cmd} ${args.join(" ")} failed (exit ${r.status})`
    );
    process.exit(r.status ?? 1);
  }
};

const download = (url, dest) => {
  const r = spawnSync("curl", ["-fL", "--noproxy", "*", "-o", dest, url], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`build-installer: curl ${url} failed`);
    process.exit(r.status ?? 1);
  }
};

const toWin = (p) =>
  p.replace(/^\/mnt\/([a-z])/i, (_, drive) => `${drive.toUpperCase()}:`);

fs.rmSync(STAGE, { recursive: true, force: true });
fs.rmSync(path.join(ROOT, "dist"), { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, "payload/app"), { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });

console.log(
  "==> npm run build (root chain: file-script, export-style, typecheck, packages, web, server, extension)"
);
run("npm", ["run", "build"], { cwd: ROOT });

console.log("==> git archive HEAD -> payload/app");
const tarPath = path.join(STAGE, "source.tar");
run("git", ["archive", "--format=tar", "--output", tarPath, "HEAD"], {
  cwd: ROOT,
});
run("tar", ["-xf", tarPath, "-C", path.join(STAGE, "payload/app")]);
fs.rmSync(tarPath, { force: true });

console.log("==> copy .output (platform-neutral build artifacts)");
fs.cpSync(path.join(ROOT, ".output"), path.join(STAGE, "payload/app/.output"), {
  recursive: true,
});
// The two workspace packages ship their dist\ (gitignored, so absent from
// the git archive): the target machine's production install skips lifecycle
// scripts, so nothing there can rebuild them — the server imports them at
// runtime through the workspace symlinks.
for (const pkg of ["reading-model", "import-core"]) {
  fs.cpSync(
    path.join(ROOT, "packages", pkg, "dist"),
    path.join(STAGE, "payload/app/packages", pkg, "dist"),
    { recursive: true }
  );
}

console.log("==> launcher scripts + README");
for (const name of [
  "start-lingualeaf.bat",
  "stop-lingualeaf.bat",
  "README-install.txt",
]) {
  fs.copyFileSync(
    path.join(ROOT, "scripts/launcher/windows-native", name),
    path.join(STAGE, "payload/app", name)
  );
}

const nodeZip = path.join(CACHE, `node-${NODE_VERSION}-win-x64.zip`);
if (!fs.existsSync(nodeZip) || fs.statSync(nodeZip).size < 20 * 1024 * 1024) {
  console.log(`==> download ${NODE_ZIP_URL}`);
  download(NODE_ZIP_URL, nodeZip);
} else {
  console.log(`==> node zip cached: ${nodeZip}`);
}
console.log("==> extract portable runtime -> payload/app/runtime");
const nodeRaw = path.join(STAGE, "node-raw");
fs.rmSync(nodeRaw, { recursive: true, force: true });
fs.mkdirSync(nodeRaw, { recursive: true });
// unzip is not installed everywhere; python3's zipfile module is stdlib.
run("python3", ["-I", "-m", "zipfile", "-e", nodeZip, nodeRaw]);
const extracted = fs
  .readdirSync(nodeRaw)
  .find((name) => name.startsWith(`node-${NODE_VERSION}-win-x64`));
if (!extracted) {
  console.error("build-installer: unexpected node zip layout");
  process.exit(1);
}
fs.renameSync(
  path.join(nodeRaw, extracted),
  path.join(STAGE, "payload/app/runtime")
);
fs.rmSync(nodeRaw, { recursive: true, force: true });

const iss = `[Setup]
AppId={{${APP_ID}}}
AppName=LinguaLeaf
AppVersion=${VERSION}
AppVerName=LinguaLeaf ${VERSION}
DefaultDirName={localappdata}\\Programs\\LinguaLeaf
PrivilegesRequired=lowest
Compression=lzma2/max
SolidCompression=yes
OutputDir=${toWin(STAGE)}/out
OutputBaseFilename=LinguaLeaf-setup-${VERSION}
DisableProgramGroupPage=yes
CloseApplications=no

[Messages]
FinishedLabel=安装完成。%n%n重要:安装包不含个人数据。首次启动前,请把旧电脑的 .env 文件和 .data 文件夹拷入安装目录(数据不在安装包里,升级重装也不会丢)。%n%n详细步骤见安装目录里的 README-install.txt。%n%n双击桌面「LinguaLeaf」即可启动;首次启动需联网约 1 分钟。

[Files]
Source: "${toWin(STAGE)}/payload/app/*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autodesktop}\\LinguaLeaf"; Filename: "{app}\\start-lingualeaf.bat"; Comment: "启动 LinguaLeaf 阅读器"
Name: "{autoprograms}\\LinguaLeaf\\启动 LinguaLeaf"; Filename: "{app}\\start-lingualeaf.bat"
Name: "{autoprograms}\\LinguaLeaf\\停止 LinguaLeaf"; Filename: "{app}\\stop-lingualeaf.bat"
Name: "{autoprograms}\\LinguaLeaf\\安装说明"; Filename: "{app}\\README-install.txt"

[Run]
Filename: "{app}\\start-lingualeaf.bat"; Description: "立即启动 LinguaLeaf(首次启动需联网约 1 分钟)"; Flags: postinstall unchecked
`;
const issPath = path.join(STAGE, "installer.iss");
// BOM is required: without it ISCC reads the file as ANSI and the Chinese
// [Messages]/[Icons] strings garble.
fs.writeFileSync(issPath, "﻿" + iss);

const iscc = ISCC_CANDIDATES.find((p) => fs.existsSync(p));
if (!iscc) {
  console.error(
    "build-installer: ISCC.exe not found. Install Inno Setup 6 first:\n" +
      "  https://jrsoftware.org/isdl.php (silent: innosetup-6.x.x.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART)"
  );
  process.exit(1);
}
console.log("==> ISCC compile");
run(iscc, [toWin(issPath)]);

const exeName = `LinguaLeaf-setup-${VERSION}.exe`;
const built = path.join(STAGE, "out", exeName);
fs.copyFileSync(built, path.join(ROOT, "dist", exeName));
console.log(
  `==> done: dist/${exeName} (${(fs.statSync(path.join(ROOT, "dist", exeName)).size / 1024 / 1024).toFixed(1)} MB)`
);
