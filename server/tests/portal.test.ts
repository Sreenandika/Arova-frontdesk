import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword, generateToken, AuthUser } from '../src/services/auth.service.js';
import { ControllableClock } from '../src/clock.js';
import { createPortalTicket, getPortalTicketByToken, portalCustomerReply } from '../src/services/portal.service.js';
import { claimTicket, updateTicketStatus } from '../src/services/ticket.service.js';

describe('Portal API & Lifecycle Transitions', () => {
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
       VALUES ('Portal Tester', 'tester@arvo.test', $1, 'agent')
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

  it('allows customer to create ticket and view it via public token', async () => {
    const res = await request(app)
      .post('/api/portal/tickets')
      .send({
        severity: 'critical',
        subject: 'Cannot login to billing portal',
        customer_name: 'Frank Miller',
        customer_email: 'frank@example.com',
        initial_message: 'Getting error 500 when logging into billing',
      });

    expect(res.status).toBe(201);
    expect(res.body.ticket).toBeDefined();
    expect(res.body.ticket.number).toMatch(/^FD-\d{4}$/);
    expect(res.body.ticket.public_token).toBeDefined();
    expect(res.body.ticket.priority).toBe('critical');

    // View ticket via public_token
    const viewRes = await request(app).get(`/api/portal/tickets/${res.body.ticket.public_token}`);
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.ticket.subject).toBe('Cannot login to billing portal');
    expect(viewRes.body.messages.length).toBe(1);
    expect(viewRes.body.messages[0].message).toContain('Getting error 500');
  });

  it('resumes SLA clock and changes status to open when customer replies to waiting_on_customer ticket', async () => {
    const testClock = new ControllableClock('2026-11-16T10:00:00+05:30'); // Monday 10:00

    // 1. Create ticket
    const { ticket } = await createPortalTicket(
      {
        severity: 'medium',
        subject: 'Hardware failure',
        customer_name: 'Grace Hopper',
        customer_email: 'grace@example.com',
        initial_message: 'Router won’t power on',
      },
      testClock
    );

    // 2. Agent claims ticket and sets status to waiting_on_customer at 11:00
    testClock.advanceHours(1);
    await claimTicket(ticket.id, agent, testClock);
    await updateTicketStatus(ticket.id, 'waiting_on_customer', agent, testClock);

    // Verify status is waiting_on_customer and open pause exists
    const detailBefore = await getPortalTicketByToken(ticket.public_token, testClock);
    expect(detailBefore?.ticket.status).toBe('waiting_on_customer');

    const { rows: pauses } = await pool.query(
      'SELECT * FROM sla_pauses WHERE ticket_id = $1 AND ended_at IS NULL',
      [ticket.id]
    );
    expect(pauses.length).toBe(1);

    // 3. Customer replies 2 hours later
    testClock.advanceHours(2);
    await portalCustomerReply(ticket.public_token, 'I tried replacing the power cable', testClock);

    // Verify ticket returned to open and pause ended
    const detailAfter = await getPortalTicketByToken(ticket.public_token, testClock);
    expect(detailAfter?.ticket.status).toBe('open');

    const { rows: closedPauses } = await pool.query(
      'SELECT * FROM sla_pauses WHERE ticket_id = $1 AND ended_at IS NOT NULL',
      [ticket.id]
    );
    expect(closedPauses.length).toBe(1);
    expect(closedPauses[0].ended_at).toBeDefined();
  });

  it('handles customer reopen: allowed within 5 working days, refused and linked after 5 working days', async () => {
    const testClock = new ControllableClock('2026-11-16T10:00:00+05:30'); // Monday 10:00

    const { ticket } = await createPortalTicket(
      {
        severity: 'low',
        subject: 'Password reset',
        customer_name: 'Hank Pym',
        customer_email: 'hank@example.com',
        initial_message: 'Please reset my password',
      },
      testClock
    );

    await claimTicket(ticket.id, agent, testClock);
    // Resolve on Monday 18:00
    testClock.setTime('2026-11-16T18:00:00+05:30');
    await updateTicketStatus(ticket.id, 'resolved', agent, testClock);

    // Test 1: Reopen after 1 working day (Tuesday 18:00) -> Allowed!
    testClock.setTime('2026-11-17T18:00:00+05:30');
    const viewAllowed = await getPortalTicketByToken(ticket.public_token, testClock);
    expect(viewAllowed?.canReopen).toBe(true);

    const reopenRes = await request(app)
      .post(`/api/portal/tickets/${ticket.public_token}/reopen`)
      .send();
    expect(reopenRes.status).toBe(200);
    expect(reopenRes.body.reopened).toBe(true);

    // Re-resolve
    await updateTicketStatus(ticket.id, 'resolved', agent, testClock);

    // Test 2: Advance by 6 working days (exceeds 5 working days)
    // Tuesday 17th -> Wed 18th (1d), Thu 19th (2d), Fri 20th (3d), Mon 23rd (4d), Tue 24th (5d), Wed 25th is holiday, Thu 26th (6d)
    testClock.setTime('2026-11-26T18:30:00+05:30');

    // Attempt reopen: must be refused and create a new linked ticket!
    const viewRefused = await getPortalTicketByToken(ticket.public_token, testClock);
    expect(viewRefused?.canReopen).toBe(false);

    // Direct service call to verify refusal and linked ticket generation
    const { portalCustomerReopen } = await import('../src/services/portal.service.js');
    const refusedRes = await portalCustomerReopen(ticket.public_token, testClock);

    expect(refusedRes.reopened).toBe(false);
    expect(refusedRes.newTicket).toBeDefined();
    expect(refusedRes.newTicket.parent_ticket_id).toBe(ticket.id);
    expect(refusedRes.newTicket.number).toMatch(/^FD-\d{4}$/);
  });
});
