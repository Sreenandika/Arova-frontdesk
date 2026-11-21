import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { ControllableClock } from '../src/clock.js';
import { createPortalTicket } from '../src/services/portal.service.js';
import { claimTicket, updateTicketStatus } from '../src/services/ticket.service.js';
import { processSlaBreaches, processAutoClose } from '../src/services/background.service.js';
import { hashPassword, AuthUser } from '../src/services/auth.service.js';

describe('Background SLA Breach & Auto-Close Processing', () => {
  let pool: pg.Pool;
  let agent: AuthUser;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: config.testDatabaseUrl });
    await runMigrations(pool);

    const pwdHash = await hashPassword('password123');
    const u = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Background Tester', 'bg@arvo.test', $1, 'agent')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, email, role`,
      [pwdHash]
    );
    agent = u.rows[0];
  });

  afterAll(async () => {
    await pool.end();
  });

  it('records an idempotent SLA_BREACHED event on first detected breach', async () => {
    // Ticket created Monday 10:00 as critical (first reply target is 2 hours -> Monday 12:00)
    const testClock = new ControllableClock('2026-11-16T10:00:00+05:30');

    const { ticket } = await createPortalTicket(
      {
        severity: 'critical',
        subject: 'SLA breach test',
        customer_name: 'Irvin',
        customer_email: 'irvin@test.com',
        initial_message: 'Immediate attention required',
      },
      testClock
    );

    // Advance clock past reply deadline (Monday 13:00)
    testClock.setTime('2026-11-16T13:00:00+05:30');

    // Run SLA breach processor first time
    await processSlaBreaches(testClock);

    const { rows: firstBreaches } = await pool.query(
      `SELECT * FROM ticket_events WHERE ticket_id = $1 AND type = 'SLA_BREACHED' AND payload->>'milestone' = 'first_reply'`,
      [ticket.id]
    );
    expect(firstBreaches.length).toBe(1);
    expect(firstBreaches[0].payload.milestone).toBe('first_reply');

    // Run again: must remain idempotent with exactly 1 breach event
    await processSlaBreaches(testClock);

    const { rows: secondBreaches } = await pool.query(
      `SELECT * FROM ticket_events WHERE ticket_id = $1 AND type = 'SLA_BREACHED' AND payload->>'milestone' = 'first_reply'`,
      [ticket.id]
    );
    expect(secondBreaches.length).toBe(1);
  });

  it('auto-closes ticket after 5 working days in waiting_on_customer', async () => {
    const testClock = new ControllableClock('2026-11-16T10:00:00+05:30'); // Monday 10:00

    const { ticket } = await createPortalTicket(
      {
        severity: 'low',
        subject: 'Auto-close test ticket',
        customer_name: 'Julia',
        customer_email: 'julia@test.com',
        initial_message: 'Question for auto-close test',
      },
      testClock
    );

    await claimTicket(ticket.id, agent, testClock);
    // Put into waiting_on_customer on Monday 11:00
    testClock.setTime('2026-11-16T11:00:00+05:30');
    await updateTicketStatus(ticket.id, 'waiting_on_customer', agent, testClock);

    // Advance clock by 3 working days (Thursday 11:00) -> not yet auto-closed
    testClock.setTime('2026-11-19T11:00:00+05:30');
    await processAutoClose(testClock);

    const { rows: midCheck } = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticket.id]);
    expect(midCheck[0].status).toBe('waiting_on_customer');

    // Advance clock past 5 working days (Monday 23rd 12:00) -> 5 working days + 1 hour
    testClock.setTime('2026-11-23T12:00:00+05:30');
    await processAutoClose(testClock);

    const { rows: closedCheck } = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticket.id]);
    expect(closedCheck[0].status).toBe('closed');

    const { rows: autoCloseEvents } = await pool.query(
      `SELECT * FROM ticket_events WHERE ticket_id = $1 AND type = 'AUTO_CLOSED'`,
      [ticket.id]
    );
    expect(autoCloseEvents.length).toBe(1);
  });
});
