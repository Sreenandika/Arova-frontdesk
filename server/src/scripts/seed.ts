import { pool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { hashPassword, AuthUser } from '../services/auth.service.js';
import { ControllableClock } from '../clock.js';
import { createPortalTicket } from '../services/portal.service.js';
import {
  claimTicket,
  sendPublicReply,
  addInternalNote,
  updateTicketStatus,
} from '../services/ticket.service.js';
import { processSlaBreaches } from '../services/background.service.js';

export async function runSeed() {
  console.log('Seeding Frontdesk database with users and demo tickets...');

  // Ensure migrations are run first
  await runMigrations();

  const pwdHash = await hashPassword('password123');

  // Seed 1 manager and 9 support agents
  const staff = [
    { name: 'Vikram Rao', email: 'manager@arvo.test', role: 'manager' },
    { name: 'Aarav Sharma', email: 'agent1@arvo.test', role: 'agent' },
    { name: 'Diya Patel', email: 'agent2@arvo.test', role: 'agent' },
    { name: 'Rohan Mehta', email: 'agent3@arvo.test', role: 'agent' },
    { name: 'Ananya Iyer', email: 'agent4@arvo.test', role: 'agent' },
    { name: 'Kabir Singh', email: 'agent5@arvo.test', role: 'agent' },
    { name: 'Pooja Nair', email: 'agent6@arvo.test', role: 'agent' },
    { name: 'Arjun Kapoor', email: 'agent7@arvo.test', role: 'agent' },
    { name: 'Neha Verma', email: 'agent8@arvo.test', role: 'agent' },
    { name: 'Aditya Joshi', email: 'agent9@arvo.test', role: 'agent' },
  ];

  const users: Record<string, AuthUser> = {};

  for (const s of staff) {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE 
       SET name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash
       RETURNING id, name, email, role`,
      [s.name, s.email, pwdHash, s.role]
    );
    users[s.email] = rows[0];
  }

  console.log(`Seeded ${Object.keys(users).length} staff members.`);

  const clock = new ControllableClock();

  // 1. One created Friday 18:00 (not late on weekend/Monday morning)
  clock.setTime('2026-11-20T18:00:00+05:30');
  const t1 = await createPortalTicket(
    {
      severity: 'low',
      subject: 'Inquiry about API rate limits on developer plan',
      customer_name: 'Priya Sundaram',
      customer_email: 'priya@techcorp.in',
      initial_message:
        'Hi Arvo team, what are the exact rate limits for your analytics endpoint on the pro plan?',
    },
    clock
  );
  console.log(`Created Ticket 1 (Friday 18:00 arrival, not late): ${t1.ticket.number}`);

  // 2. One genuinely late ticket
  clock.setTime('2026-11-17T10:00:00+05:30'); // Tuesday 10:00
  const t2 = await createPortalTicket(
    {
      severity: 'medium',
      subject: 'SSO login returning SAML verification error',
      customer_name: 'Marcus Brody',
      customer_email: 'marcus@globalfin.com',
      initial_message: 'Our whole team is locked out of single sign-on with error code SAML-403.',
    },
    clock
  );
  console.log(`Created Ticket 2 (Genuinely late): ${t2.ticket.number}`);

  // 3. One waiting on customer for several days (clock paused)
  clock.setTime('2026-11-16T11:00:00+05:30'); // Monday 11:00
  const t3 = await createPortalTicket(
    {
      severity: 'medium',
      subject: 'Webhook delivery failing intermittently',
      customer_name: 'Suresh Raina',
      customer_email: 'suresh@logistics.co',
      initial_message: 'Our endpoint receives 502 Bad Gateway once every ~50 calls.',
    },
    clock
  );
  clock.setTime('2026-11-16T13:30:00+05:30');
  await claimTicket(t3.ticket.id, users['agent1@arvo.test'], clock);
  await sendPublicReply(
    t3.ticket.id,
    'Hi Suresh, could you share the webhook payload ID and your server SSL certificate authority?',
    users['agent1@arvo.test'],
    clock
  );
  await updateTicketStatus(t3.ticket.id, 'waiting_on_customer', users['agent1@arvo.test'], clock);
  console.log(`Created Ticket 3 (Waiting on customer, paused): ${t3.ticket.number}`);

  // 4. One resolved 6 working days ago (reopen refused)
  clock.setTime('2026-11-09T10:00:00+05:30');
  const t4 = await createPortalTicket(
    {
      severity: 'low',
      subject: 'Request invoice copy for September 2026',
      customer_name: 'Elena Rostova',
      customer_email: 'elena@novatech.eu',
      initial_message: 'Please send over the PDF invoice for September.',
    },
    clock
  );
  clock.setTime('2026-11-09T14:00:00+05:30');
  await claimTicket(t4.ticket.id, users['agent2@arvo.test'], clock);
  await sendPublicReply(
    t4.ticket.id,
    'Attached is your September invoice. Thank you for choosing Arvo!',
    users['agent2@arvo.test'],
    clock
  );
  await updateTicketStatus(t4.ticket.id, 'resolved', users['agent2@arvo.test'], clock);
  console.log(`Created Ticket 4 (Resolved 6 working days ago): ${t4.ticket.number}`);

  // 5. One resolved yesterday (reopen allowed)
  clock.setTime('2026-11-19T11:00:00+05:30');
  const t5 = await createPortalTicket(
    {
      severity: 'medium',
      subject: 'Export to CSV has wrong column headers',
      customer_name: 'David Kim',
      customer_email: 'david@fintech.kr',
      initial_message: 'The transactions export includes timestamps in UTC instead of IST.',
    },
    clock
  );
  clock.setTime('2026-11-20T12:00:00+05:30');
  await claimTicket(t5.ticket.id, users['agent3@arvo.test'], clock);
  await sendPublicReply(
    t5.ticket.id,
    'We deployed a fix to format export timestamps in the tenant business timezone.',
    users['agent3@arvo.test'],
    clock
  );
  await updateTicketStatus(t5.ticket.id, 'resolved', users['agent3@arvo.test'], clock);
  console.log(`Created Ticket 5 (Resolved yesterday, reopen allowed): ${t5.ticket.number}`);

  // 6. One critical ticket
  clock.setTime('2026-11-20T16:30:00+05:30'); // Friday 16:30
  const t6 = await createPortalTicket(
    {
      severity: 'critical',
      subject: 'Payment processing gateway completely unresponsive',
      customer_name: 'Anita Desai',
      customer_email: 'anita@retailflow.com',
      initial_message:
        'All checkout payments are hanging with gateway timeout. Customers cannot check out!',
    },
    clock
  );
  clock.setTime('2026-11-20T17:00:00+05:30');
  await claimTicket(t6.ticket.id, users['manager@arvo.test'], clock);
  await sendPublicReply(
    t6.ticket.id,
    'Incident commander assigned. Engineering is rolling back release v2.4.1.',
    users['manager@arvo.test'],
    clock
  );
  console.log(`Created Ticket 6 (Critical priority): ${t6.ticket.number}`);

  // 7. One with a private team-only note
  clock.setTime('2026-11-20T11:00:00+05:30');
  const t7 = await createPortalTicket(
    {
      severity: 'medium',
      subject: 'Suspected security scan against auth endpoint',
      customer_name: 'Security Operations',
      customer_email: 'soc@securecorp.com',
      initial_message: 'We noticed unusual credential spraying from IP range 198.51.100.0/24.',
    },
    clock
  );
  clock.setTime('2026-11-20T11:30:00+05:30');
  await claimTicket(t7.ticket.id, users['agent4@arvo.test'], clock);
  await addInternalNote(
    t7.ticket.id,
    'INTERNAL REVIEW: Checked Cloudflare logs. IP 198.51.100.42 blocked at WAF layer. Threat level low.',
    users['agent4@arvo.test'],
    clock
  );
  await sendPublicReply(
    t7.ticket.id,
    'Thank you for reporting. Our security engineering team has engaged.',
    users['agent4@arvo.test'],
    clock
  );
  console.log(`Created Ticket 7 (With team-only private note): ${t7.ticket.number}`);

  // Run SLA breach check at present time
  console.log('Running initial background SLA breach audit...');
  await processSlaBreaches();

  console.log('Seed completed successfully!');
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed script failed:', err);
      process.exit(1);
    });
}
