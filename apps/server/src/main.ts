import { createServer } from "node:http";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { dictionaryPathUnder, openDictionary } from "./dict/dictionary.js";
import { openDatabase } from "./database.js";
import { attachFrontend, type CloseFrontend } from "./frontend.js";

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
const app = createApp(database, dictionary);
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
