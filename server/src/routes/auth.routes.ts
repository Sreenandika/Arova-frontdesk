import { Router } from 'express';
import { z } from 'zod';
import { loginUser } from '../services/auth.service.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { user, token } = await loginUser(email, password);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ user, token });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input data', details: err.errors });
    }
    res.status(401).json({ error: err.message || 'Login failed' });
  }
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});
