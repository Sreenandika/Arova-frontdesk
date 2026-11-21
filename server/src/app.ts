import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { defaultClock } from './clock.js';
import { authRouter } from './routes/auth.routes.js';
import { ticketRouter } from './routes/ticket.routes.js';
import { portalRouter } from './routes/portal.routes.js';
import { holidayRouter } from './routes/holiday.routes.js';
import { staffRouter } from './routes/staff.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'frontdesk',
      timestamp: defaultClock.iso(),
    });
  });

  // API Routes
  app.use('/api/auth', authRouter);
  app.use('/api/tickets', ticketRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/holidays', holidayRouter);
  app.use('/api/staff', staffRouter);

  // Static web frontend serving
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  // 404 handler for unmatched API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}
