import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import {
  createStaffMember,
  listStaff,
  changePassword,
  resetStaffPassword,
} from '../services/staff.service.js';

export const staffRouter = Router();

// ── All routes require authentication ──────────────────────────────────────

const createStaffSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  role: z.enum(['agent', 'manager']),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

/** GET /api/staff — list all staff (manager only) */
staffRouter.get('/', requireAuth, requireRole(['manager']), async (req, res) => {
  try {
    const members = await listStaff();
    // Strip must_change_password from public response (keep it in full detail for manager)
    res.json({ staff: members });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/staff — create a new staff account (manager only) */
staffRouter.post('/', requireAuth, requireRole(['manager']), async (req: AuthenticatedRequest, res) => {
  try {
    const body = createStaffSchema.parse(req.body);
    const { member, tempPassword } = await createStaffMember(body.name, body.email, body.role);

    res.status(201).json({
      member,
      // The temp password is returned ONCE here and never stored in plain text.
      // The manager must copy it and hand it to the new staff member securely.
      tempPassword,
      notice: 'Share this temporary password with the staff member. They will be required to change it on first login. This password will not be shown again.',
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    const status = err.message.includes('already exists') ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

/** POST /api/staff/:id/reset-password — manager resets another user's password */
staffRouter.post('/:id/reset-password', requireAuth, requireRole(['manager']), async (req, res) => {
  try {
    const { tempPassword } = await resetStaffPassword(req.params.id);
    res.json({
      tempPassword,
      notice: 'Share this temporary password with the staff member. They will be required to change it on next login.',
    });
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

/** POST /api/staff/change-password — authenticated user changes their own password */
staffRouter.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await changePassword(req.user!.id, currentPassword, newPassword);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    const status = err.message.includes('incorrect') ? 401 : 400;
    res.status(status).json({ error: err.message });
  }
});
