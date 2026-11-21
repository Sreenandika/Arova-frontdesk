import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { startBackgroundJobs } from './services/background.service.js';

async function start() {
  try {
    console.log('Running database migrations...');
    await runMigrations();
    console.log('Migrations complete.');

    // Start in-process background ticks
    console.log('Starting background SLA and auto-close processor...');
    startBackgroundJobs(60000);

    const app = createApp();
    app.listen(config.port, () => {
      console.log(`Frontdesk server listening on port ${config.port} (${config.env})`);
    });
  } catch (err) {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  }
}

start();
