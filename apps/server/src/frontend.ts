import { access } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import type { Express } from 'express';

export async function attachFrontend(
  app: Express,
  httpServer: Server,
  options: { development: boolean; projectRoot: string },
): Promise<() => Promise<void>> {
  if (options.development) {
    // Only load Vite in development; production needs no dev dependencies.
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: join(options.projectRoot, 'apps/web/vite.config.ts'),
      // Load the config in memory: the default bundling loader writes a
      // timestamped temp file into node_modules/.vite-temp, which restarts
      // the --watch'ed server process in an endless loop.
      configLoader: 'runner',
      server: { middlewareMode: true, hmr: { server: httpServer } },
    });
    app.use(vite.middlewares);
    return () => vite.close();
  }

  const publicDirectory = join(options.projectRoot, '.output/web');
  const indexFile = join(publicDirectory, 'index.html');
  await access(indexFile);
  app.use(express.static(publicDirectory));
  // Serve the app shell for browser routes, including direct chapter URLs.
  app.get(['/', '/book/:id/:chapter'], (_request, response) => {
    response.sendFile('index.html', { root: publicDirectory });
  });
  return async () => {};
}
