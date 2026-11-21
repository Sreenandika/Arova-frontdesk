import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword, generateToken, AuthUser } from '../src/services/auth.service.js';
import { createPortalTicket } from '../src/services/portal.service.js';

describe('INC-0304: Privacy Canary & Separate Storage Security', () => {
  let pool: pg.Pool;
  const app = createApp();

  let agent: AuthUser;
  let token: string;
  const CANARY_STRING = 'CANARY-PRIVATE-9137';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: config.testDatabaseUrl });
    await runMigrations(pool);

    const pwdHash = await hashPassword('password123');
    const u = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Security Agent', 'security@arvo.test', $1, 'agent')
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

  it('ensures the private canary string never leaks to any customer-facing endpoint or export', async () => {
    // 1. Create a ticket
    const { ticket } = await createPortalTicket({
      severity: 'medium',
      subject: 'Canary isolation test',
      customer_name: 'Customer X',
      customer_email: 'x@example.com',
      initial_message: 'Public customer question',
    });

    // 2. Agent claims ticket
    await request(app)
      .post(`/api/tickets/${ticket.id}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    // 3. Agent adds internal team-only note containing CANARY-PRIVATE-9137
    const noteRes = await request(app)
      .post(`/api/tickets/${ticket.id}/note`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: `CONFIDENTIAL: Discussion containing ${CANARY_STRING} about customer` });

    expect(noteRes.status).toBe(201);

    // 4. Test Customer Portal Detail endpoint
    const portalDetail = await request(app).get(`/api/portal/tickets/${ticket.public_token}`);
    expect(portalDetail.status).toBe(200);
    const portalDetailText = JSON.stringify(portalDetail.body);
    expect(portalDetailText).not.toContain(CANARY_STRING);

    // 5. Test Customer Transcript Export endpoint
    const transcriptExport = await request(app).get(`/api/portal/tickets/${ticket.public_token}/export`);
    expect(transcriptExport.status).toBe(200);
    expect(transcriptExport.text).not.toContain(CANARY_STRING);

    // 6. Test Customer Reply response
    const portalReply = await request(app)
      .post(`/api/portal/tickets/${ticket.public_token}/reply`)
      .send({ message: 'Customer replying to thread' });
    expect(portalReply.status).toBe(200);
    const portalReplyText = JSON.stringify(portalReply.body);
    expect(portalReplyText).not.toContain(CANARY_STRING);

    // 7. Test Agent Ticket List CSV export (must contain no note bodies)
    const csvExport = await request(app)
      .get('/api/tickets/export.csv')
      .set('Authorization', `Bearer ${token}`);
    expect(csvExport.status).toBe(200);
    expect(csvExport.text).not.toContain(CANARY_STRING);

    // 8. Verify ticket_events payload does not contain the note text (only note id)
    const { rows: events } = await pool.query(
      `SELECT payload FROM ticket_events WHERE ticket_id = $1 AND type = 'NOTE_ADDED'`,
      [ticket.id]
    );
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      const payloadStr = JSON.stringify(ev.payload);
      expect(payloadStr).not.toContain(CANARY_STRING);
      expect(ev.payload.note_id).toBeDefined();
    }
  });
});
