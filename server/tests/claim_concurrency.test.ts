import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword, generateToken, AuthUser } from '../src/services/auth.service.js';
import { createPortalTicket } from '../src/services/portal.service.js';

describe('INC-0291: Atomic Claiming Concurrency & Assignee Guards', () => {
  let pool: pg.Pool;
  const app = createApp();

  let agent1: AuthUser;
  let token1: string;
  let agent2: AuthUser;
  let token2: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: config.testDatabaseUrl });
    await runMigrations(pool);

    // Create two test agents
    const pwdHash = await hashPassword('password123');
    const u1 = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Agent Alice', 'alice@arvo.test', $1, 'agent')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, email, role`,
      [pwdHash]
    );
    agent1 = u1.rows[0];
    token1 = generateToken(agent1);

    const u2 = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Agent Bob', 'bob@arvo.test', $1, 'agent')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, email, role`,
      [pwdHash]
    );
    agent2 = u2.rows[0];
    token2 = generateToken(agent2);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('handles two concurrent claims such that exactly one succeeds and one receives 409', async () => {
    // Create a new unassigned ticket
    const { ticket } = await createPortalTicket({
      severity: 'medium',
      subject: 'Double claim test subject',
      customer_name: 'Jane Doe',
      customer_email: 'jane@example.com',
      initial_message: 'Need help with setup',
    });

    // Fire two claims concurrently via Promise.all
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/tickets/${ticket.id}/claim`)
        .set('Authorization', `Bearer ${token1}`)
        .send(),
      request(app)
        .post(`/api/tickets/${ticket.id}/claim`)
        .set('Authorization', `Bearer ${token2}`)
        .send(),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const successRes = res1.status === 200 ? res1 : res2;
    const conflictRes = res1.status === 409 ? res1 : res2;

    expect(successRes.body.success).toBe(true);
    expect(conflictRes.body.error).toMatch(/Already taken by/);
    expect(conflictRes.body.heldBy).toBeDefined();
    expect(conflictRes.body.heldSince).toBeDefined();

    // Verify DB assignee
    const { rows } = await pool.query('SELECT assignee_id FROM tickets WHERE id = $1', [ticket.id]);
    expect([agent1.id, agent2.id]).toContain(rows[0].assignee_id);
  });

  it('forbids public reply on unassigned ticket', async () => {
    const { ticket } = await createPortalTicket({
      severity: 'low',
      subject: 'Unassigned reply attempt',
      customer_name: 'Alice Client',
      customer_email: 'alice.client@example.com',
      initial_message: 'Question about billing',
    });

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/reply`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ message: 'Hello from agent' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unassigned/i);
  });

  it('forbids public reply from an agent who is not the current assignee', async () => {
    const { ticket } = await createPortalTicket({
      severity: 'low',
      subject: 'Claimed by Alice',
      customer_name: 'Bob Client',
      customer_email: 'bob.client@example.com',
      initial_message: 'Question about billing',
    });

    // Agent 1 claims it
    await request(app)
      .post(`/api/tickets/${ticket.id}/claim`)
      .set('Authorization', `Bearer ${token1}`)
      .send();

    // Agent 2 attempts to send a public reply
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/reply`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ message: 'Interfering reply from agent 2' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only the current assignee/i);
  });
});
