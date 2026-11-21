import { pool } from '../db/pool.js';
import { Clock, defaultClock } from '../clock.js';
import { getLiveCalendar } from './holiday.service.js';
import {
  businessMinutesBetween,
  computeTicketDeadlines,
  AUTO_CLOSE_WORKING_MINUTES,
  TicketPriority,
} from '../sla/engine.js';
import { appendTicketEvent } from '../audit/hashChain.js';

export async function processSlaBreaches(clock: Clock = defaultClock) {
  const calendar = await getLiveCalendar();
  const now = clock.now();

  // Find all active tickets (not closed)
  const { rows: tickets } = await pool.query(
    `SELECT id, priority, status, clock_started_at, first_response_at, resolved_at 
     FROM tickets 
     WHERE status != 'closed'`
  );

  for (const t of tickets) {
    const { rows: pauses } = await pool.query(
      `SELECT started_at, ended_at FROM sla_pauses WHERE ticket_id = $1 ORDER BY started_at ASC`,
      [t.id]
    );

    const deadlines = computeTicketDeadlines(
      t.clock_started_at,
      t.priority as TicketPriority,
      pauses,
      calendar,
      now
    );

    // 1. First reply check
    const isReplyMet = t.first_response_at !== null;
    if (!isReplyMet && now.getTime() > deadlines.replyDeadline.getTime()) {
      // Check if breach event already logged for first_reply
      const { rows: existing } = await pool.query(
        `SELECT id FROM ticket_events 
         WHERE ticket_id = $1 AND type = 'SLA_BREACHED' AND payload->>'milestone' = 'first_reply'`,
        [t.id]
      );

      if (existing.length === 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT id FROM tickets WHERE id = $1 FOR UPDATE', [t.id]);

          // Re-check inside transaction lock
          const { rows: lockedExisting } = await client.query(
            `SELECT id FROM ticket_events 
             WHERE ticket_id = $1 AND type = 'SLA_BREACHED' AND payload->>'milestone' = 'first_reply'`,
            [t.id]
          );

          if (lockedExisting.length === 0) {
            await appendTicketEvent(client, {
              ticketId: t.id,
              type: 'SLA_BREACHED',
              actorType: 'system',
              actorId: null,
              payload: {
                milestone: 'first_reply',
                deadline: deadlines.replyDeadline.toISOString(),
                breached_at: now.toISOString(),
                priority: t.priority,
              },
              timestamp: now,
            });
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Error logging first_reply SLA breach for ticket ${t.id}:`, err);
        } finally {
          client.release();
        }
      }
    }

    // 2. Resolution check
    const isResolveMet = t.status === 'resolved';
    if (!isResolveMet && now.getTime() > deadlines.resolveDeadline.getTime()) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM ticket_events 
         WHERE ticket_id = $1 AND type = 'SLA_BREACHED' AND payload->>'milestone' = 'resolution'`,
        [t.id]
      );

      if (existing.length === 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT id FROM tickets WHERE id = $1 FOR UPDATE', [t.id]);

          const { rows: lockedExisting } = await client.query(
            `SELECT id FROM ticket_events 
             WHERE ticket_id = $1 AND type = 'SLA_BREACHED' AND payload->>'milestone' = 'resolution'`,
            [t.id]
          );

          if (lockedExisting.length === 0) {
            await appendTicketEvent(client, {
              ticketId: t.id,
              type: 'SLA_BREACHED',
              actorType: 'system',
              actorId: null,
              payload: {
                milestone: 'resolution',
                deadline: deadlines.resolveDeadline.toISOString(),
                breached_at: now.toISOString(),
                priority: t.priority,
              },
              timestamp: now,
            });
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Error logging resolution SLA breach for ticket ${t.id}:`, err);
        } finally {
          client.release();
        }
      }
    }
  }
}

export async function processAutoClose(clock: Clock = defaultClock) {
  const calendar = await getLiveCalendar();
  const now = clock.now();

  const { rows: waitingTickets } = await pool.query(
    `SELECT t.id, p.id as pause_id, p.started_at 
     FROM tickets t
     JOIN sla_pauses p ON t.id = p.ticket_id AND p.ended_at IS NULL
     WHERE t.status = 'waiting_on_customer'`
  );

  for (const row of waitingTickets) {
    const elapsedMinutes = businessMinutesBetween(row.started_at, now, calendar);
    if (elapsedMinutes >= AUTO_CLOSE_WORKING_MINUTES) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: locked } = await client.query(
          `SELECT id, status FROM tickets WHERE id = $1 FOR UPDATE`,
          [row.id]
        );

        if (locked.length > 0 && locked[0].status === 'waiting_on_customer') {
          // Close open pause
          await client.query(
            `UPDATE sla_pauses SET ended_at = $1 WHERE id = $2`,
            [now, row.pause_id]
          );

          // Update ticket to closed
          await client.query(
            `UPDATE tickets SET status = 'closed', version = version + 1 WHERE id = $1`,
            [row.id]
          );

          await appendTicketEvent(client, {
            ticketId: row.id,
            type: 'AUTO_CLOSED',
            actorType: 'system',
            actorId: null,
            payload: {
              reason: 'waiting_on_customer_exceeded_5_working_days',
              elapsed_working_minutes: elapsedMinutes,
              paused_since: row.started_at,
            },
            timestamp: now,
          });

          await appendTicketEvent(client, {
            ticketId: row.id,
            type: 'STATUS_CHANGED',
            actorType: 'system',
            actorId: null,
            payload: {
              old_status: 'waiting_on_customer',
              new_status: 'closed',
            },
            timestamp: now,
          });
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error auto-closing ticket ${row.id}:`, err);
      } finally {
        client.release();
      }
    }
  }
}

export function startBackgroundJobs(intervalMs: number = 60000, clock: Clock = defaultClock) {
  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await processSlaBreaches(clock);
      await processAutoClose(clock);
    } catch (err) {
      console.error('Background job tick error:', err);
    } finally {
      isRunning = false;
    }
  };

  // Run immediately once
  tick();

  const intervalId = setInterval(tick, intervalMs);

  return {
    stop: () => clearInterval(intervalId),
    tick,
  };
}
