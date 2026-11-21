import crypto from 'node:crypto';
import pg from 'pg';

export function canonicalJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

export interface EventHashInput {
  prevHash: string;
  ticketId: string;
  type: string;
  actorType: 'agent' | 'customer' | 'system';
  actorId?: string | null;
  payload: any;
  createdAtIso: string;
}

export function computeEventHash(input: EventHashInput): string {
  const payloadStr = canonicalJson(input.payload || {});
  const actorIdStr = input.actorId || '';
  const raw = `${input.prevHash}|${input.ticketId}|${input.type}|${input.actorType}|${actorIdStr}|${payloadStr}|${input.createdAtIso}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export const GENESIS_HASH = 'GENESIS';

export async function appendTicketEvent(
  client: pg.PoolClient,
  params: {
    ticketId: string;
    type: string;
    actorType: 'agent' | 'customer' | 'system';
    actorId?: string | null;
    payload: any;
    timestamp: Date;
  }
): Promise<{ id: string; hash: string }> {
  // Query previous event for this ticket (caller should hold ticket lock FOR UPDATE)
  const { rows } = await client.query(
    `SELECT hash FROM ticket_events 
     WHERE ticket_id = $1 
     ORDER BY created_at DESC, id DESC 
     LIMIT 1`,
    [params.ticketId]
  );

  const prevHash = rows.length > 0 ? rows[0].hash : GENESIS_HASH;
  const createdAtIso = params.timestamp.toISOString();

  const hash = computeEventHash({
    prevHash,
    ticketId: params.ticketId,
    type: params.type,
    actorType: params.actorType,
    actorId: params.actorId,
    payload: params.payload,
    createdAtIso,
  });

  const insertRes = await client.query(
    `INSERT INTO ticket_events 
     (ticket_id, type, actor_type, actor_id, payload, created_at, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, hash`,
    [
      params.ticketId,
      params.type,
      params.actorType,
      params.actorId || null,
      params.payload || {},
      params.timestamp,
      prevHash,
      hash,
    ]
  );

  return insertRes.rows[0];
}

export interface VerificationResult {
  valid: boolean;
  totalEvents: number;
  brokenEventId?: string;
  reason?: string;
}

export async function verifyTicketEvents(
  clientOrPool: pg.Pool | pg.PoolClient,
  ticketId: string
): Promise<VerificationResult> {
  const { rows } = await clientOrPool.query(
    `SELECT id, ticket_id, type, actor_type, actor_id, payload, created_at, prev_hash, hash
     FROM ticket_events
     WHERE ticket_id = $1
     ORDER BY created_at ASC, id ASC`,
    [ticketId]
  );

  if (rows.length === 0) {
    return { valid: true, totalEvents: 0 };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < rows.length; i++) {
    const ev = rows[i];
    const createdAtIso = new Date(ev.created_at).toISOString();

    if (ev.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        totalEvents: rows.length,
        brokenEventId: ev.id,
        reason: `Previous hash mismatch on event ${ev.id}: expected ${expectedPrevHash}, got ${ev.prev_hash}`,
      };
    }

    const computed = computeEventHash({
      prevHash: ev.prev_hash,
      ticketId: ev.ticket_id,
      type: ev.type,
      actorType: ev.actor_type,
      actorId: ev.actor_id,
      payload: ev.payload,
      createdAtIso,
    });

    if (computed !== ev.hash) {
      return {
        valid: false,
        totalEvents: rows.length,
        brokenEventId: ev.id,
        reason: `Hash mismatch on event ${ev.id}: computed ${computed}, got ${ev.hash}`,
      };
    }

    expectedPrevHash = ev.hash;
  }

  return { valid: true, totalEvents: rows.length };
}
