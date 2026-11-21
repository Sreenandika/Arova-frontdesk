import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import {
  listTickets,
  getTicketDetail,
  claimTicket,
  releaseTicket,
  sendPublicReply,
  addInternalNote,
  updateTicketStatus,
  updateTicketPriority,
  agentReopenTicket,
  verifyTicketAudit,
} from '../services/ticket.service.js';

export const ticketRouter = Router();

// Apply auth to all agent routes
ticketRouter.use(requireAuth);

// Export CSV before :id route
ticketRouter.get('/export.csv', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tickets = await listTickets({ tab: 'all' });

    let csv = 'Number,Subject,Customer Name,Customer Email,Priority,Status,Assignee,Created At,First Response At,Resolved At\n';
    for (const t of tickets) {
      const escape = (val: any) => `"${String(val || '').replace(/"/g, '""')}"`;
      csv += [
        escape(t.number),
        escape(t.subject),
        escape(t.customer_name),
        escape(t.customer_email),
        escape(t.priority),
        escape(t.status),
        escape(t.assignee_name || 'Unassigned'),
        escape(t.created_at ? new Date(t.created_at).toISOString() : ''),
        escape(t.first_response_at ? new Date(t.first_response_at).toISOString() : ''),
        escape(t.resolved_at ? new Date(t.resolved_at).toISOString() : ''),
      ].join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets-export.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// List tickets
ticketRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tab = req.query.tab as any;
    const tickets = await listTickets({
      tab: tab || 'all',
      userId: req.user!.id,
    });
    res.json({ tickets });
  } catch (err) {
    next(err);
  }
});

// Ticket detail
ticketRouter.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const detail = await getTicketDetail(req.params.id);
    if (!detail) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// Claim ticket (INC-0291)
ticketRouter.post('/:id/claim', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await claimTicket(req.params.id, req.user!);
    if (result.conflict) {
      return res.status(409).json({
        error: `Already taken by ${result.heldBy}`,
        heldBy: result.heldBy,
        heldSince: result.heldSince,
      });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Release ticket
ticketRouter.post('/:id/release', async (req: AuthenticatedRequest, res, next) => {
  try {
    const ticket = await releaseTicket(req.params.id, req.user!);
    res.json({ ticket });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const messageSchema = z.object({
  message: z.string().min(1),
});

// Public reply
ticketRouter.post('/:id/reply', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { message } = messageSchema.parse(req.body);
    const msg = await sendPublicReply(req.params.id, message, req.user!);
    res.status(201).json({ message: msg });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    res.status(400).json({ error: err.message });
  }
});

const noteSchema = z.object({
  note: z.string().min(1),
});

// Internal note
ticketRouter.post('/:id/note', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { note } = noteSchema.parse(req.body);
    const insertedNote = await addInternalNote(req.params.id, note, req.user!);
    res.status(201).json({ note: insertedNote });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    res.status(400).json({ error: err.message });
  }
});

const statusSchema = z.object({
  status: z.enum(['open', 'waiting_on_customer', 'resolved', 'closed']),
});

// Set status
ticketRouter.patch('/:id/status', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { status } = statusSchema.parse(req.body);
    const updated = await updateTicketStatus(req.params.id, status, req.user!);
    res.json({ ticket: updated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    res.status(400).json({ error: err.message });
  }
});

const prioritySchema = z.object({
  priority: z.enum(['low', 'medium', 'critical']),
});

// Set priority
ticketRouter.patch('/:id/priority', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { priority } = prioritySchema.parse(req.body);
    const updated = await updateTicketPriority(req.params.id, priority, req.user!);
    res.json({ ticket: updated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    res.status(400).json({ error: err.message });
  }
});

// Reopen ticket
ticketRouter.post('/:id/reopen', async (req: AuthenticatedRequest, res, next) => {
  try {
    const updated = await agentReopenTicket(req.params.id, req.user!);
    res.json({ ticket: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Verify audit hash chain
ticketRouter.get('/:id/verify', async (req: AuthenticatedRequest, res, next) => {
  try {
    const verification = await verifyTicketAudit(req.params.id);
    res.json(verification);
  } catch (err) {
    next(err);
  }
});
