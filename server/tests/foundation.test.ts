import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';

describe('Phase 1: Foundation Tests', () => {
  let pool: pg.Pool;
  const app = createApp();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: config.testDatabaseUrl });
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('provides a functioning health check endpoint', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('frontdesk');
    expect(res.body.timestamp).toBeDefined();
  });

  it('has all required database tables instantiated with correct schema', async () => {
    const { rows } = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    const tables = rows.map(r => r.table_name);

    expect(tables).toContain('users');
    expect(tables).toContain('tickets');
    expect(tables).toContain('ticket_messages');
    expect(tables).toContain('internal_notes');
    expect(tables).toContain('ticket_events');
    expect(tables).toContain('sla_pauses');
    expect(tables).toContain('holidays');
    expect(tables).toContain('schema_migrations');
  });

  it('has sample holidays seeded', async () => {
    const { rows } = await pool.query('SELECT * FROM holidays ORDER BY holiday_date ASC');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const descriptions = rows.map(r => r.description);
    expect(descriptions).toContain('Christmas Day');
    expect(descriptions).toContain('Republic Day');
  });
});
