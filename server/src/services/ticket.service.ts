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
import { appendTicketEvent, verifyTicketEvents } from '../audit/hashChain.js';
import { AuthUser } from './auth.service.js';

export interface TicketListFilter {
  tab?: 'mine' | 'unassigned' | 'late' | 'waiting' | 'open' | 'all';
  userId?: string;
}

export async function listTickets(filter: TicketListFilter, clock: Clock = defaultClock) {
  const calendar = await getLiveCalendar();
  const now = clock.now();

  let querySql = `
    SELECT t.*, u.name as assignee_name, u.email as assignee_email
    FROM tickets t
    LEFT JOIN users u ON t.assignee_id = u.id
  `;
  const params: any[] = [];

  if (filter.tab === 'mine' && filter.userId) {
    querySql += ` WHERE t.assignee_id = $1 AND t.status != 'closed'`;
    params.push(filter.userId);
  } else if (filter.tab === 'unassigned') {
    querySql += ` WHERE t.assignee_id IS NULL AND t.status != 'closed'`;
  } else if (filter.tab === 'waiting') {
    querySql += ` WHERE t.status = 'waiting_on_customer'`;
  } else if (filter.tab === 'open') {
    querySql += ` WHERE t.status IN ('open', 'waiting_on_customer')`;
  }

  querySql += ` ORDER BY t.created_at DESC`;

  const { rows: tickets } = await pool.query(querySql, params);

  // Fetch all pauses for these tickets
  const ticketIds = tickets.map(t => t.id);
  const pausesByTicket: Record<string, Array<{ started_at: Date; ended_at: Date | null }>> = {};

  if (ticketIds.length > 0) {
    const { rows: pauses } = await pool.query(
      `SELECT ticket_id, started_at, ended_at FROM sla_pauses WHERE ticket_id = ANY($1::uuid[])`,
      [ticketIds]
    );
    for (const p of pauses) {
      if (!pausesByTicket[p.ticket_id]) {
        pausesByTicket[p.ticket_id] = [];
      }
      pausesByTicket[p.ticket_id].push(p);
    }
  }

  // Compute SLAs for each ticket
  const enriched = tickets.map(t => {
    const ticketPauses = pausesByTicket[t.id] || [];
    const deadlines = computeTicketDeadlines(
      t.clock_started_at,
      t.priority as TicketPriority,
      ticketPauses,
      calendar,
      now
    );

    const isReplyMet = t.first_response_at !== null;
    const isResolveMet = t.status === 'resolved' || t.status === 'closed';

    const isReplyLate = !isReplyMet && now.getTime() > deadlines.replyDeadline.getTime();
    const isResolveLate = !isResolveMet && now.getTime() > deadlines.resolveDeadline.getTime();
    const isLate = isReplyLate || isResolveLate;

    // Remaining business minutes
    const remainingReplyMinutes = isReplyMet
      ? 0
      : businessMinutesBetween(now, deadlines.replyDeadline, calendar);
    const remainingResolveMinutes = isResolveMet
      ? 0
      : businessMinutesBetween(now, deadlines.resolveDeadline, calendar);

    return {
      ...t,
      deadlines,
      isReplyMet,
      isResolveMet,
      isReplyLate,
      isResolveLate,
      isLate,
      remainingReplyMinutes,
      remainingResolveMinutes,
    };
  });

  if (filter.tab === 'late') {
    return enriched.filter(t => t.isLate);
  }

  return enriched;
}

export async function getTicketDetail(ticketId: string, clock: Clock = defaultClock) {
  const { rows: ticketRows } = await pool.query(
    `SELECT t.*, u.name as assignee_name, u.email as assignee_email
     FROM tickets t
     LEFT JOIN users u ON t.assignee_id = u.id
     WHERE t.id = $1`,
    [ticketId]
  );

  if (ticketRows.length === 0) return null;
  const ticket = ticketRows[0];

  // Fetch messages
  const { rows: messages } = await pool.query(
    `SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId]
  );

  // Fetch internal notes
  const { rows: notes } = await pool.query(
    `SELECT * FROM internal_notes WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId]
  );

  // Fetch pauses
  const { rows: pauses } = await pool.query(
    `SELECT * FROM sla_pauses WHERE ticket_id = $1 ORDER BY started_at ASC`,
    [ticketId]
  );

  // Fetch events
  const { rows: events } = await pool.query(
    `SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at ASC, id ASC`,
    [ticketId]
  );

  const calendar = await getLiveCalendar();
  const now = clock.now();
  const deadlines = computeTicketDeadlines(
    ticket.clock_started_at,
    ticket.priority as TicketPriority,
    pauses,
    calendar,
    now
  );

  const isReplyMet = ticket.first_response_at !== null;
  const isResolveMet = ticket.status === 'resolved' || ticket.status === 'closed';
  const isReplyLate = !isReplyMet && now.getTime() > deadlines.replyDeadline.getTime();
  const isResolveLate = !isResolveMet && now.getTime() > deadlines.resolveDeadline.getTime();

  let canReopen = false;
  if (ticket.status === 'resolved' && ticket.resolved_at) {
    const elapsedMinutes = businessMinutesBetween(ticket.resolved_at, now, calendar);
    canReopen = elapsedMinutes <= REOPEN_WINDOW_WORKING_MINUTES;
  }

  return {
    ticket,
    messages,
    notes,
    pauses,
    events,
    deadlines,
    isReplyLate,
    isResolveLate,
    isLate: isReplyLate || isResolveLate,
    canReopen,
  };
}

export async function claimTicket(
  ticketId: string,
  user: AuthUser,
  clock: Clock = defaultClock
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const now = clock.now();

    // Atomic conditional update (INC-0291)
    const updateRes = await client.query(
      `UPDATE tickets
       SET assignee_id = $1, assigned_at = $2, version = version + 1
       WHERE id = $3 AND assignee_id IS NULL
       RETURNING *`,
      [user.id, now, ticketId]
    );

    if (updateRes.rowCount === 0) {
      // Conflict: find who holds it and since when
      const { rows: current } = await client.query(
        `SELECT t.assigned_at, u.name, u.email
         FROM tickets t
         LEFT JOIN users u ON t.assignee_id = u.id
         WHERE t.id = $1`,
        [ticketId]
      );

      await client.query('ROLLBACK');

      const holder = current[0];
      return {
        success: false,
        conflict: true,
        heldBy: holder?.name || 'Another agent',
        heldSince: holder?.assigned_at ? new Date(holder.assigned_at).toISOString() : null,
      };
    }

    const updatedTicket = updateRes.rows[0];

    // Lock row for event sequence
    await client.query('SELECT id FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);

    // Append CLAIMED event
    await appendTicketEvent(client, {
      ticketId,
      type: 'CLAIMED',
      actorType: 'agent',
      actorId: user.id,
      payload: { assignee_id: user.id, assignee_name: user.name },
      timestamp: now,
    });

    await client.query('COMMIT');
    return { success: true, conflict: false, ticket: updatedTicket };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function releaseTicket(
  ticketId: string,
  user: AuthUser,
  clock: Clock = defaultClock
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: current } = await client.query(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );

    if (current.length === 0) {
      throw new Error('Ticket not found');
    }

    const ticket = current[0];

    // Only assignee or manager can release
    if (ticket.assignee_id !== user.id && user.role !== 'manager') {
      throw new Error('Only the current assignee or a manager can release this ticket');
    }

    const now = clock.now();

    const updateRes = await client.query(
      `UPDATE tickets
       SET assignee_id = NULL, assigned_at = NULL, version = version + 1
       WHERE id = $1
       RETURNING *`,
      [ticketId]
    );

    await appendTicketEvent(client, {
      ticketId,
      type: 'RELEASED',
      actorType: 'agent',
      actorId: user.id,
      payload: { released_by: user.id, previous_assignee_id: ticket.assignee_id },
      timestamp: now,
    });

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function sendPublicReply(
  ticketId: string,
  message: string,
  user: AuthUser,
  clock: Clock = defaultClock
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ticketRows } = await client.query(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );

    if (ticketRows.length === 0) {
      throw new Error('Ticket not found');
    }

    const ticket = ticketRows[0];

    // INC-0291 Rule: "Only the current assignee may send a public reply or set status. Unassigned tickets cannot be replied to."
    if (!ticket.assignee_id) {
      throw new Error('Ticket is unassigned. You must claim the ticket before sending a public reply.');
    }
    if (ticket.assignee_id !== user.id) {
      throw new Error('Only the current assignee may send a public reply.');
    }

    const now = clock.now();

    // Insert message
    const { rows: msgRows } = await client.query(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, sender_name, message, created_at)
       VALUES ($1, 'agent', $2, $3, $4, $5)
       RETURNING *`,
      [ticket.id, user.id, user.name, message, now]
    );
    const msg = msgRows[0];

    // If first response from agent, record milestone
    let isFirstResponse = false;
    if (ticket.first_response_at === null) {
      isFirstResponse = true;
      await client.query(
        `UPDATE tickets SET first_response_at = $1, version = version + 1 WHERE id = $2`,
        [now, ticket.id]
      );
    }

    await appendTicketEvent(client, {
      ticketId: ticket.id,
      type: 'PUBLIC_REPLY_SENT',
      actorType: 'agent',
      actorId: user.id,
      payload: {
        message_id: msg.id,
        sender_type: 'agent',
        is_first_response: isFirstResponse,
      },
      timestamp: now,
    });

    await client.query('COMMIT');
    return msg;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function addInternalNote(
  ticketId: string,
  note: string,
  user: AuthUser,
  clock: Clock = defaultClock
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ticketRows } = await client.query(
      `SELECT id FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );

    if (ticketRows.length === 0) {
      throw new Error('Ticket not found');
    }

    const now = clock.now();

    // Insert into internal_notes
    const { rows: noteRows } = await client.query(
      `INSERT INTO internal_notes (ticket_id, author_id, author_name, note, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ticketId, user.id, user.name, note, now]
    );
    const insertedNote = noteRows[0];

    // INC-0304: Event payloads must never contain note text (only a note id)
    await appendTicketEvent(client, {
      ticketId,
      type: 'NOTE_ADDED',
      actorType: 'agent',
      actorId: user.id,
      payload: { note_id: insertedNote.id, author_name: user.name },
      timestamp: now,
    });

    await client.query('COMMIT');
    return insertedNote;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateTicketStatus(
  ticketId: string,
  newStatus: 'open' | 'waiting_on_customer' | 'resolved' | 'closed',
  user: AuthUser,
  clock: Clock = defaultClock
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ticketRows } = await client.query(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );

    if (ticketRows.length === 0) {
      throw new Error('Ticket not found');
    }

    const ticket = ticketRows[0];
    const oldStatus = ticket.status;

    if (oldStatus === newStatus) {
      await client.query('COMMIT');
      return ticket;
    }

    // Assignee check: "Only current assignee may send a public reply or set status."
    // Managers may change status if needed (e.g. closing or resolving)
    if (ticket.assignee_id !== user.id && user.role !== 'manager') {
      throw new Error('Only the current assignee or a manager can change ticket status');
    }

    const now = clock.now();

    // If entering waiting_on_customer -> Pause SLA clock (Rule 3)
    if (newStatus === 'waiting_on_customer') {
      await client.query(
        `INSERT INTO sla_pauses (ticket_id, started_at) VALUES ($1, $2)`,
        [ticketId, now]
      );
      await appendTicketEvent(client, {
        ticketId,
        type: 'PAUSED',
        actorType: 'agent',
        actorId: user.id,
        payload: { reason: 'waiting_on_customer' },
        timestamp: now,
      });
    }

    // If leaving waiting_on_customer -> Resume SLA clock
    if (oldStatus === 'waiting_on_customer' && newStatus !== 'waiting_on_customer') {
      await client.query(
        `UPDATE sla_pauses SET ended_at = $1 WHERE ticket_id = $2 AND ended_at IS NULL`,
        [now, ticketId]
      );
      await appendTicketEvent(client, {
        ticketId,
        type: 'RESUMED',
        actorType: 'agent',
        actorId: user.id,
        payload: { reason: `status_changed_to_${newStatus}` },
        timestamp: now,
      });
    }

    let resolvedAt = ticket.resolved_at;
    if (newStatus === 'resolved') {
      resolvedAt = now;
      await appendTicketEvent(client, {
        ticketId,
        type: 'RESOLVED',
        actorType: 'agent',
        actorId: user.id,
        payload: { resolved_by: user.id },
        timestamp: now,
      });
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE tickets
       SET status = $1, resolved_at = $2, version = version + 1
       WHERE id = $3
       RETURNING *`,
      [newStatus, resolvedAt, ticketId]
    );

    await appendTicketEvent(client, {
      ticketId,
      type: 'STATUS_CHANGED',
      actorType: 'agent',
      actorId: user.id,
      payload: { old_status: oldStatus, new_status: newStatus },
      timestamp: now,
    });

    await client.query('COMMIT');
    return updatedRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateTicketPriority(
  ticketId: string,
  newPriority: TicketPriority,
  user: AuthUser,
  clock: Clock = defaultClock
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ticketRows } = await client.query(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );

    if (ticketRows.length === 0) {
      throw new Error('Ticket not found');
    }

    const ticket = ticketRows[0];
    const oldPriority = ticket.priority as TicketPriority;

    if (oldPriority === newPriority) {
      await client.query('COMMIT');
      return ticket;
    }

    const now = clock.now();
    const calendar = await getLiveCalendar();

    const { rows: pauses } = await client.query(
      `SELECT started_at, ended_at FROM sla_pauses WHERE ticket_id = $1 ORDER BY started_at ASC`,
      [ticketId]
    );

    // Rule 6: Recalculate BOTH deadlines from clock_started_at using new priority
    const oldDeadlines = computeTicketDeadlines(
      ticket.clock_started_at,
      oldPriority,
      pauses,
      calendar,
      now
    );

    const newDeadlines = computeTicketDeadlines(
      ticket.clock_started_at,
      newPriority,
      pauses,
      calendar,
      now
    );

    const { rows: updatedRows } = await client.query(
      `UPDATE tickets
       SET priority = $1, version = version + 1
       WHERE id = $2
       RETURNING *`,
      [newPriority, ticketId]
    );

    // Record PRIORITY_CHANGED event containing old/new priority and old/new deadlines
    await appendTicketEvent(client, {
      ticketId,
      type: 'PRIORITY_CHANGED',
      actorType: 'agent',
      actorId: user.id,
      payload: {
        old_priority: oldPriority,
        new_priority: newPriority,
        old_reply_deadline: oldDeadlines.replyDeadline.toISOString(),
        new_reply_deadline: newDeadlines.replyDeadline.toISOString(),
        old_resolve_deadline: oldDeadlines.resolveDeadline.toISOString(),
        new_resolve_deadline: newDeadlines.resolveDeadline.toISOString(),
      },
      timestamp: now,
    });

    await client.query('COMMIT');
    return updatedRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function agentReopenTicket(
  ticketId: string,
  user: AuthUser,
  clock: Clock = defaultClock
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ticketRows } = await client.query(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
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

    if (elapsedMinutes > REOPEN_WINDOW_WORKING_MINUTES) {
      throw new Error('Reopening refused: 5 working days have elapsed since resolution. A new linked ticket must be created.');
    }

    // Restart resolution clock from reopen time; first-reply requirement counts as already met
    const { rows: updatedRows } = await client.query(
      `UPDATE tickets
       SET status = 'open',
           clock_started_at = $1,
           resolved_at = NULL,
           version = version + 1
       WHERE id = $2
       RETURNING *`,
      [now, ticketId]
    );

    await appendTicketEvent(client, {
      ticketId,
      type: 'REOPENED',
      actorType: 'agent',
      actorId: user.id,
      payload: {
        actor: 'agent',
        agent_id: user.id,
        new_clock_started_at: now.toISOString(),
      },
      timestamp: now,
    });

    await client.query('COMMIT');
    return updatedRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function verifyTicketAudit(ticketId: string) {
  return verifyTicketEvents(pool, ticketId);
}
