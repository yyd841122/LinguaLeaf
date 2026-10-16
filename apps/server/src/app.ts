import express from 'express';
import type Database from 'better-sqlite3';

export function createApp(database: Database.Database) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_request, response) => {
    database.prepare('SELECT 1').get();
    response.json({ status: 'ok' });
  });

  // Keep unknown API requests out of the frontend's SPA fallback.
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found' });
  });

  return app;
}
