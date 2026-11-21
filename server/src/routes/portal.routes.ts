import { Router } from 'express';
import { z } from 'zod';
import {
  createPortalTicket,
  getPortalTicketByToken,
  portalCustomerReply,
  portalCustomerReopen,
} from '../services/portal.service.js';

export const portalRouter = Router();

const createTicketSchema = z.object({
  severity: z.enum(['critical', 'medium', 'low']),
  subject: z.string().min(3).max(255),
  customer_name: z.string().min(1),
  customer_email: z.string().email(),
  initial_message: z.string().min(1),
});

portalRouter.post('/tickets', async (req, res, next) => {
  try {
    const data = createTicketSchema.parse(req.body);
    const result = await createPortalTicket(data);
    res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    next(err);
  }
});

portalRouter.get('/tickets/:token', async (req, res, next) => {
  try {
    const result = await getPortalTicketByToken(req.params.token);
    if (!result) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const replySchema = z.object({
  message: z.string().min(1),
});

portalRouter.post('/tickets/:token/reply', async (req, res, next) => {
  try {
    const { message } = replySchema.parse(req.body);
    const result = await portalCustomerReply(req.params.token, message);
    res.json({ message: result });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    res.status(400).json({ error: err.message });
  }
});

portalRouter.post('/tickets/:token/reopen', async (req, res, next) => {
  try {
    const result = await portalCustomerReopen(req.params.token);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

portalRouter.get('/tickets/:token/export', async (req, res, next) => {
  try {
    const result = await getPortalTicketByToken(req.params.token);
    if (!result) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const { ticket, messages } = result;

    let transcript = `TRANSCRIPT FOR TICKET ${ticket.number}\n`;
    transcript += `Subject: ${ticket.subject}\n`;
    transcript += `Customer: ${ticket.customer_name} <${ticket.customer_email}>\n`;
    transcript += `Status: ${ticket.status}\n`;
    transcript += `Priority: ${ticket.priority}\n`;
    transcript += `Created At: ${new Date(ticket.created_at).toISOString()}\n`;
    transcript += `---------------------------------------------------------\n\n`;

    for (const msg of messages) {
      const senderLabel = msg.sender_type === 'agent' ? `Support Agent (${msg.sender_name})` : `Customer (${msg.sender_name})`;
      transcript += `[${new Date(msg.created_at).toISOString()}] ${senderLabel}:\n`;
      transcript += `${msg.message}\n\n`;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ticket.number}-transcript.txt"`);
    res.send(transcript);
  } catch (err) {
    next(err);
  }
});
