import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { attachFrontend } from './frontend.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535');
}
const host = process.env.HOST ?? '0.0.0.0';
const projectRoot = resolve(import.meta.dirname, '../../..');
// Source is apps/server/src; the compiled entry is .output/server.
const root = process.argv.includes('--dev') ? projectRoot : resolve(import.meta.dirname, '../..');
const database = openDatabase(resolve(root, process.env.DATABASE_PATH ?? '.data/lingualeaf.sqlite'));
const app = createApp(database);
const server = createServer(app);
let closeFrontend: () => Promise<void> = async () => {};

try {
  closeFrontend = await attachFrontend(app, server, {
    development: process.argv.includes('--dev'),
    projectRoot: root,
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolveListening();
    });
  });
  const address = server.address();
  console.log(`LinguaLeaf listening on http://${host}:${typeof address === 'object' && address ? address.port : port}`);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 5000);
    timeout.unref();
    try {
      await closeFrontend();
      await new Promise<void>((resolveClosed, reject) => {
        server.close((error) => error ? reject(error) : resolveClosed());
        server.closeAllConnections();
      });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      database.close();
      clearTimeout(timeout);
    }
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
} catch (error) {
  await closeFrontend();
  database.close();
  console.error(error);
  process.exitCode = 1;
}
