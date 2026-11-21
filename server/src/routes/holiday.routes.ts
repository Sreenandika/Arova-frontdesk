import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { getAllHolidays, addHoliday, removeHoliday } from '../services/holiday.service.js';

export const holidayRouter = Router();

holidayRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const holidays = await getAllHolidays();
    res.json({ holidays });
  } catch (err) {
    next(err);
  }
});

const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  description: z.string().min(1),
  is_sample: z.boolean().optional(),
});

holidayRouter.post('/', requireAuth, requireRole(['manager']), async (req, res, next) => {
  try {
    const { date, description, is_sample } = holidaySchema.parse(req.body);
    const holiday = await addHoliday(date, description, is_sample ?? false);
    res.status(201).json({ holiday });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    next(err);
  }
});

holidayRouter.delete('/:id', requireAuth, requireRole(['manager']), async (req, res, next) => {
  try {
    const success = await removeHoliday(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Holiday not found' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
