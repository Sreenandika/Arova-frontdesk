import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword, generateToken, AuthUser } from '../src/services/auth.service.js';
import { createPortalTicket } from '../src/services/portal.service.js';

describe('Agent Tickets API & Priority Recalculation', () => {
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
       VALUES ('API Agent', 'api.agent@arvo.test', $1, 'agent')
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

  it('lists tickets with tab filters and computed SLA deadlines', async () => {
    const res = await request(app)
      .get('/api/tickets?tab=all')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tickets)).toBe(true);
    if (res.body.tickets.length > 0) {
      const first = res.body.tickets[0];
      expect(first.deadlines).toBeDefined();
      expect(first.deadlines.replyDeadline).toBeDefined();
      expect(first.deadlines.resolveDeadline).toBeDefined();
      expect(typeof first.remainingReplyMinutes).toBe('number');
      expect(typeof first.remainingResolveMinutes).toBe('number');
    }
  });

  it('handles mid-ticket priority change and logs PRIORITY_CHANGED audit event', async () => {
    const { ticket } = await createPortalTicket({
      severity: 'low',
      subject: 'Priority change test',
      customer_name: 'Peter Parker',
      customer_email: 'peter@dailybugle.com',
      initial_message: 'Camera lens broken',
    });

    // Claim ticket
    await request(app)
      .post(`/api/tickets/${ticket.id}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    // Update priority to critical
    const patchRes = await request(app)
      .patch(`/api/tickets/${ticket.id}/priority`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 'critical' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.ticket.priority).toBe('critical');

    // Verify PRIORITY_CHANGED event logged
    const { rows: events } = await pool.query(
      `SELECT * FROM ticket_events WHERE ticket_id = $1 AND type = 'PRIORITY_CHANGED'`,
      [ticket.id]
    );
    expect(events.length).toBe(1);
    expect(events[0].payload.old_priority).toBe('low');
    expect(events[0].payload.new_priority).toBe('critical');
    expect(events[0].payload.old_reply_deadline).toBeDefined();
    expect(events[0].payload.new_reply_deadline).toBeDefined();
    expect(events[0].payload.old_resolve_deadline).toBeDefined();
    expect(events[0].payload.new_resolve_deadline).toBeDefined();
  });
});
