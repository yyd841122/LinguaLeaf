import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';

describe('HTTP API seam', () => {
  let database: Database.Database;

  beforeEach(() => {
    database = openDatabase(':memory:');
  });
  afterEach(() => {
    database.close();
  });

  it('reports a healthy server with a real SQLite connection', async () => {
    const response = await request(createApp(database)).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns an API 404 instead of the frontend HTML', async () => {
    const response = await request(createApp(database)).get('/api/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'API route not found' });
  });
});
