import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { dictionaryPathUnder, openDictionary } from "./dict/dictionary.js";
import { openDatabase } from "./database.js";
import { failInterruptedImports } from "./book-store.js";
import { drainImportTasks } from "./import/import-task.js";
import { drainChapterTranslationTasks } from "./translate/chapter-task.js";
import { attachFrontend, type CloseFrontend } from "./frontend.js";
import {
  createDeepSeekTranslator,
  deepSeekConfigFromEnv,
} from "./translate/deepseek.js";
import { findDeepSeekEnvDrift } from "./translate/env-guard.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}
const host = process.env.HOST ?? "0.0.0.0";
const sourceRoot = resolve(import.meta.dirname, "../../..");
// Source is apps/server/src; the compiled entry is .output/server.
const development = process.argv.includes("--dev");
const runtimeRoot = development
  ? sourceRoot
  : resolve(import.meta.dirname, "../..");
const database = openDatabase(
  resolve(runtimeRoot, process.env.DATABASE_PATH ?? ".data/lingualeaf.sqlite")
);
// The dictionary lives next to the book database (.data at the runtime
// root, DICTIONARY_PATH overrides). A missing file means an empty dictionary
// (lookups miss, IPA lines come out blank) until the dict:import-* scripts
// have run.
const dictionary = openDictionary(dictionaryPathUnder(runtimeRoot));
if (!dictionary.prepare("SELECT 1 FROM dict_words LIMIT 1").get()) {
  console.warn(
    "Dictionary is empty — run the dict:import-* scripts (see README) to fill the IPA line and lookup API."
  );
}
// The DeepSeek translator fills the translation line at import time. No
// API key configured means no translator: books import with empty
// translation lines until .env is set up (see README), same stance as the
// empty dictionary above.
// The .env file the launcher loaded (`--env-file-if-exists=.env` is
// CWD-relative), inspected for the two misconfiguration classes that fail
// silently later: shell values overriding the file, and glued-on non-ASCII
// bytes. Tails only — never the full key.
const envFilePath = resolve(process.cwd(), ".env");
const envFile = existsSync(envFilePath)
  ? readFileSync(envFilePath, "utf8")
  : null;
const envDrift = findDeepSeekEnvDrift(process.env, envFile);
if (envDrift.shadowed.length > 0) {
  console.warn(
    `Shell environment overrides .env for ${envDrift.shadowed.join(", ")} — ` +
      "Node --env-file does not override existing variables, so the .env values are inert."
  );
}
if (envDrift.dirty.length > 0) {
  console.warn(
    `${envDrift.dirty.join(", ")} contain non-ASCII bytes — ` +
      "an editor likely glued a comment onto the value; fix the variable or .env."
  );
}
const deepSeekConfig = deepSeekConfigFromEnv();
if (!deepSeekConfig) {
  console.warn(
    "DEEPSEEK_API_KEY is not set — imported books will have empty translation lines (see README)."
  );
} else {
  console.log(
    `DeepSeek translator: base=${deepSeekConfig.baseUrl} model=${deepSeekConfig.model} key=…${deepSeekConfig.apiKey.slice(-4)}`
  );
}
const translator = deepSeekConfig
  ? createDeepSeekTranslator(deepSeekConfig)
  : null;
const app = createApp(database, dictionary, translator);
const server = createServer(app);
let closeFrontend: CloseFrontend = async () => {};

try {
  closeFrontend = await attachFrontend(app, server, {
    development,
    runtimeRoot,
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolveListening();
    });
  });
  const address = server.address();
  console.log(
    `LinguaLeaf listening on http://${host}:${typeof address === "object" && address ? address.port : port}`
  );

  // Imports orphaned by the previous run can never resume — their task died
  // with the process. Marked failed only after the port is ours: a second
  // launch that loses the bind must not fail the first instance's active
  // imports on its way out (audit 2026-10-23).
  const interrupted = failInterruptedImports(database);
  if (interrupted > 0) {
    console.warn(
      `${interrupted} import(s) were interrupted by a restart and are marked failed on the shelf.`
    );
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 5000);
    timeout.unref();
    try {
      await closeFrontend();
      await new Promise<void>((resolveClosed, reject) => {
        server.close((error) => (error ? reject(error) : resolveClosed()));
        server.closeAllConnections();
      });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      // Running background tasks (imports, chapter translations) get a
      // grace window to land their writes before the database closes;
      // whatever misses settles as interrupted on the next startup sweep
      // (audit 2026-10-23).
      await Promise.all([
        drainImportTasks(3000),
        drainChapterTranslationTasks(3000),
      ]);
      database.close();
      dictionary.close();
      clearTimeout(timeout);
    }
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
} catch (error) {
  await closeFrontend();
  database.close();
  console.error(error);
  process.exitCode = 1;
}
