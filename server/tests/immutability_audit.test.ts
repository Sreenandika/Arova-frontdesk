import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword, generateToken, AuthUser } from '../src/services/auth.service.js';
import { createPortalTicket } from '../src/services/portal.service.js';

describe('INC-0318: Immutability Triggers & Hash Chain Verification', () => {
  let pool: pg.Pool;
  const app = createApp();

  let agent: AuthUser;
  let token: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: config.testDatabaseUrl });
    await runMigrations(pool);

    const pwdHash = await hashPassword('password123');
    const u = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Audit Agent', 'audit@arvo.test', $1, 'agent')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, email, role`,
      [pwdHash]
    );
    agent = u.rows[0];
    token = generateToken(agent);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects UPDATE and DELETE on ticket_events via DB triggers', async () => {
    const { ticket } = await createPortalTicket({
      severity: 'low',
      subject: 'Trigger test ticket',
      customer_name: 'Bob',
      customer_email: 'bob@test.com',
      initial_message: 'Testing triggers',
    });

    const { rows: events } = await pool.query(
      'SELECT id FROM ticket_events WHERE ticket_id = $1 LIMIT 1',
      [ticket.id]
    );
    const eventId = events[0].id;

    // Attempt UPDATE on ticket_events
    await expect(
      pool.query(`UPDATE ticket_events SET type = 'HACKED' WHERE id = $1`, [eventId])
    ).rejects.toThrow(/append-only/i);

    // Attempt DELETE on ticket_events
    await expect(
      pool.query(`DELETE FROM ticket_events WHERE id = $1`, [eventId])
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects UPDATE and DELETE on ticket_messages and internal_notes via DB triggers', async () => {
    const { ticket } = await createPortalTicket({
      severity: 'low',
      subject: 'Message trigger test ticket',
      customer_name: 'Carol',
      customer_email: 'carol@test.com',
      initial_message: 'Customer message to test immutability',
    });

    // Add note
    await request(app)
      .post(`/api/tickets/${ticket.id}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    await request(app)
      .post(`/api/tickets/${ticket.id}/note`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Important internal note' });

    const { rows: msgs } = await pool.query(
      'SELECT id FROM ticket_messages WHERE ticket_id = $1 LIMIT 1',
      [ticket.id]
    );
    const { rows: notes } = await pool.query(
      'SELECT id FROM internal_notes WHERE ticket_id = $1 LIMIT 1',
      [ticket.id]
    );

    // Test ticket_messages immutability
    await expect(
      pool.query(`UPDATE ticket_messages SET message = 'tampered' WHERE id = $1`, [msgs[0].id])
    ).rejects.toThrow(/append-only/i);
    await expect(
      pool.query(`DELETE FROM ticket_messages WHERE id = $1`, [msgs[0].id])
    ).rejects.toThrow(/append-only/i);

    // Test internal_notes immutability
    await expect(
      pool.query(`UPDATE internal_notes SET note = 'tampered' WHERE id = $1`, [notes[0].id])
    ).rejects.toThrow(/append-only/i);
    await expect(
      pool.query(`DELETE FROM internal_notes WHERE id = $1`, [notes[0].id])
    ).rejects.toThrow(/append-only/i);
  });

  it('verifies a valid hash chain with GET /api/tickets/:id/verify', async () => {
    const { ticket } = await createPortalTicket({
      severity: 'medium',
      subject: 'Valid chain test',
      customer_name: 'Dave',
      customer_email: 'dave@test.com',
      initial_message: 'Valid chain initial message',
    });

    // Claim, reply, note, change priority
    await request(app)
      .post(`/api/tickets/${ticket.id}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    await request(app)
      .post(`/api/tickets/${ticket.id}/reply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Hello Dave' });

    await request(app)
      .post(`/api/tickets/${ticket.id}/note`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Investigating Dave problem' });

    await request(app)
      .patch(`/api/tickets/${ticket.id}/priority`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 'critical' });

    const verifyRes = await request(app)
      .get(`/api/tickets/${ticket.id}/verify`)
      .set('Authorization', `Bearer ${token}`);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.valid).toBe(true);
    expect(verifyRes.body.totalEvents).toBeGreaterThanOrEqual(4);
  });

  it('detects a tampered event row when trigger is disabled', async () => {
    const { ticket } = await createPortalTicket({
      severity: 'low',
      subject: 'Tamper test',
      customer_name: 'Eve',
      customer_email: 'eve@test.com',
      initial_message: 'Before tampering',
    });

    await request(app)
      .post(`/api/tickets/${ticket.id}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    const { rows: events } = await pool.query(
      'SELECT id, payload FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticket.id]
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    const targetEvent = events[1]; // CLAIMED event

    // Temporarily disable trigger inside test to simulate tampering
    await pool.query('ALTER TABLE ticket_events DISABLE TRIGGER trg_prevent_ticket_events_mod');

    try {
      // Modify payload maliciously without updating hash
      await pool.query(
        `UPDATE ticket_events 
         SET payload = '{"assignee_name": "MALICIOUS_IMPOSTOR"}'::jsonb 
         WHERE id = $1`,
        [targetEvent.id]
      );

      // Call verify endpoint
      const verifyRes = await request(app)
        .get(`/api/tickets/${ticket.id}/verify`)
        .set('Authorization', `Bearer ${token}`);

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.valid).toBe(false);
      expect(verifyRes.body.brokenEventId).toBe(targetEvent.id);
      expect(verifyRes.body.reason).toMatch(/Hash mismatch/i);
    } finally {
      // Re-enable trigger
      await pool.query('ALTER TABLE ticket_events ENABLE TRIGGER trg_prevent_ticket_events_mod');
    }
  });
});
