import crypto from 'node:crypto';
import pg from 'pg';
import { pool } from '../db/pool.js';
import { Clock, defaultClock } from '../clock.js';
import { getLiveCalendar } from './holiday.service.js';
import {
  businessMinutesBetween,
  computeTicketDeadlines,
  REOPEN_WINDOW_WORKING_MINUTES,
  TicketPriority,
} from '../sla/engine.js';
import { appendTicketEvent } from '../audit/hashChain.js';

export interface CreatePortalTicketInput {
  severity: 'critical' | 'medium' | 'low';
  subject: string;
  customer_name: string;
  customer_email: string;
  initial_message: string;
}

export function formatTicketNumber(seq: number): string {
  return `FD-${seq.toString().padStart(4, '0')}`;
}

export async function createPortalTicket(
  input: CreatePortalTicketInput,
  clock: Clock = defaultClock,
  customPool?: pg.Pool
) {
  const targetPool = customPool || pool;
  const client = await targetPool.connect();

  try {
    await client.query('BEGIN');

    const seqRes = await client.query("SELECT nextval('ticket_number_seq') as seq");
    const ticketNumber = formatTicketNumber(parseInt(seqRes.rows[0].seq, 10));
    const publicToken = crypto.randomBytes(16).toString('hex');
    const now = clock.now();

    const insertTicketSql = `
      INSERT INTO tickets (
        number, subject, customer_name, customer_email,
        priority, status, version, public_token,
        clock_started_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'open', 1, $6, $7, $7)
      RETURNING *
    `;

    const ticketRes = await client.query(insertTicketSql, [
      ticketNumber,
      input.subject,
      input.customer_name,
      input.customer_email,
      input.severity,
      publicToken,
      now,
    ]);

    const ticket = ticketRes.rows[0];

    // Lock ticket row for event sequencing
    await client.query('SELECT id FROM tickets WHERE id = $1 FOR UPDATE', [ticket.id]);

    // Insert initial customer message
    const insertMsgSql = `
      INSERT INTO ticket_messages (
        ticket_id, sender_type, sender_name, message, created_at
      ) VALUES ($1, 'customer', $2, $3, $4)
      RETURNING *
    `;
    const msgRes = await client.query(insertMsgSql, [
      ticket.id,
      input.customer_name,
      input.initial_message,
      now,
    ]);

    // Append TICKET_CREATED event
    await appendTicketEvent(client, {
      ticketId: ticket.id,
      type: 'TICKET_CREATED',
      actorType: 'customer',
      actorId: null,
      payload: {
        ticket_number: ticket.number,
        subject: ticket.subject,
        priority: ticket.priority,
        initial_message_id: msgRes.rows[0].id,
      },
      timestamp: now,
    });

    await client.query('COMMIT');
    return { ticket, message: msgRes.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getPortalTicketByToken(token: string, clock: Clock = defaultClock) {
  const { rows: ticketRows } = await pool.query(
    `SELECT id, number, subject, customer_name, customer_email,
            priority, status, public_token, clock_started_at,
            first_response_at, resolved_at, parent_ticket_id, created_at
     FROM tickets
     WHERE public_token = $1`,
    [token]
  );

  if (ticketRows.length === 0) {
    return null;
  }

  const ticket = ticketRows[0];

  // Fetch only customer-visible messages
  const { rows: messages } = await pool.query(
    `SELECT id, sender_type, sender_name, message, created_at
     FROM ticket_messages
     WHERE ticket_id = $1
     ORDER BY created_at ASC`,
    [ticket.id]
  );

  // SLA calculations
  const calendar = await getLiveCalendar();
  const { rows: pauses } = await pool.query(
    `SELECT started_at, ended_at FROM sla_pauses WHERE ticket_id = $1 ORDER BY started_at ASC`,
    [ticket.id]
  );

  const now = clock.now();
  const deadlines = computeTicketDeadlines(
    ticket.clock_started_at,
    ticket.priority as TicketPriority,
    pauses,
    calendar,
    now
  );

  let canReopen = false;
  if (ticket.status === 'resolved' && ticket.resolved_at) {
    const elapsedMinutes = businessMinutesBetween(ticket.resolved_at, now, calendar);
    canReopen = elapsedMinutes <= REOPEN_WINDOW_WORKING_MINUTES;
  }

  return {
    ticket,
    messages,
    deadlines,
    canReopen,
  };
}

export async function portalCustomerReply(
  token: string,
  message: string,
  clock: Clock = defaultClock
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ticketRows } = await client.query(
      `SELECT * FROM tickets WHERE public_token = $1 FOR UPDATE`,
      [token]
    );

    if (ticketRows.length === 0) {
      throw new Error('Ticket not found');
    }

    const ticket = ticketRows[0];

    if (ticket.status === 'closed') {
      throw new Error('This ticket is closed and cannot receive replies');
    }

    const now = clock.now();

    // Insert customer message
    const { rows: msgRows } = await client.query(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_name, message, created_at)
       VALUES ($1, 'customer', $2, $3, $4)
       RETURNING *`,
      [ticket.id, ticket.customer_name, message, now]
    );
    const newMsg = msgRows[0];

    // If waiting on customer, resume SLA clock and set status to open (Rule 3)
    if (ticket.status === 'waiting_on_customer') {
      // End active pause
      await client.query(
        `UPDATE sla_pauses 
         SET ended_at = $1 
         WHERE ticket_id = $2 AND ended_at IS NULL`,
        [now, ticket.id]
      );

      // Update ticket status to open
      await client.query(
        `UPDATE tickets 
         SET status = 'open', version = version + 1 
         WHERE id = $1`,
        [ticket.id]
      );

      await appendTicketEvent(client, {
        ticketId: ticket.id,
        type: 'RESUMED',
        actorType: 'customer',
        payload: { reason: 'customer_reply' },
        timestamp: now,
      });

      await appendTicketEvent(client, {
        ticketId: ticket.id,
        type: 'STATUS_CHANGED',
        actorType: 'customer',
        payload: { old_status: 'waiting_on_customer', new_status: 'open' },
        timestamp: now,
      });
    }

    // Record PUBLIC_REPLY_SENT event
    await appendTicketEvent(client, {
      ticketId: ticket.id,
      type: 'PUBLIC_REPLY_SENT',
      actorType: 'customer',
      payload: { message_id: newMsg.id, sender_name: ticket.customer_name },
      timestamp: now,
    });

    await client.query('COMMIT');
    return newMsg;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function portalCustomerReopen(
  token: string,
  clock: Clock = defaultClock
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ticketRows } = await client.query(
      `SELECT * FROM tickets WHERE public_token = $1 FOR UPDATE`,
      [token]
    );

    if (ticketRows.length === 0) {
      throw new Error('Ticket not found');
    }

    const ticket = ticketRows[0];

    if (ticket.status !== 'resolved') {
      throw new Error('Only resolved tickets can be reopened');
    }

    const calendar = await getLiveCalendar();
    const now = clock.now();
    const elapsedMinutes = businessMinutesBetween(ticket.resolved_at, now, calendar);

    // Rule 5: 5 working days reopen boundary
    if (elapsedMinutes > REOPEN_WINDOW_WORKING_MINUTES) {
      // Reopening refused; create a new linked ticket instead
      const seqRes = await client.query("SELECT nextval('ticket_number_seq') as seq");
      const newTicketNumber = formatTicketNumber(parseInt(seqRes.rows[0].seq, 10));
      const newPublicToken = crypto.randomBytes(16).toString('hex');

      const { rows: newTicketRows } = await client.query(
        `INSERT INTO tickets (
          number, subject, customer_name, customer_email,
          priority, status, version, public_token,
          clock_started_at, parent_ticket_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, 'open', 1, $6, $7, $8, $7)
        RETURNING *`,
        [
          newTicketNumber,
          `Follow-up: ${ticket.subject}`,
          ticket.customer_name,
          ticket.customer_email,
          ticket.priority,
          newPublicToken,
          now,
          ticket.id,
        ]
      );

      const newTicket = newTicketRows[0];

      await appendTicketEvent(client, {
        ticketId: newTicket.id,
        type: 'TICKET_CREATED',
        actorType: 'customer',
        payload: {
          ticket_number: newTicket.number,
          parent_ticket_id: ticket.id,
          reason: 'reopen_window_expired',
        },
        timestamp: now,
      });

      await client.query('COMMIT');
      return {
        reopened: false,
        reason: 'Window expired (exceeded 5 working days); created linked ticket',
        newTicket,
      };
    }

    // Reopen allowed: restart resolution clock from reopen time; first-reply counts as met
    await client.query(
      `UPDATE tickets
       SET status = 'open',
           clock_started_at = $1,
           resolved_at = NULL,
           version = version + 1
       WHERE id = $2`,
      [now, ticket.id]
    );

    await appendTicketEvent(client, {
      ticketId: ticket.id,
      type: 'REOPENED',
      actorType: 'customer',
      payload: { actor: 'customer', new_clock_started_at: now.toISOString() },
      timestamp: now,
    });

    await client.query('COMMIT');
    return { reopened: true, ticketId: ticket.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
