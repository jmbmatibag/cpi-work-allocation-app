import 'dotenv/config';
import { createApp } from './app.js';
import { startCleanupScheduler } from './lib/cleanup.js';
import { startReminderScheduler } from './lib/reminderScheduler.js';
import { verifySmtp } from './lib/mailer.js';

const required = ['JWT_SECRET', 'DATABASE_URL', 'CORS_ORIGIN'] as const;
for (const k of required) {
  if (!process.env[k]) throw new Error(`Missing required env: ${k}`);
}
if (process.env.JWT_SECRET!.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 chars');
}

const app = createApp();
const port = Number(process.env.PORT) || 4000;

app.listen(port, async () => {
  console.log(`API listening on http://localhost:${port}`);

  // In PM2 cluster mode each worker receives a NODE_APP_INSTANCE env var
  // ('0', '1', …). Run schedulers only in the primary worker (instance 0)
  // to prevent duplicate emails and overlapping cleanup jobs when multiple
  // workers share the same database. In fork mode (or plain `node`) the
  // variable is absent, which also passes the check.
  const isPrimary =
    process.env.NODE_APP_INSTANCE === undefined ||
    process.env.NODE_APP_INSTANCE === '0';
  if (isPrimary) {
    startCleanupScheduler();
    startReminderScheduler();
  }

  const smtp = await verifySmtp();
  if (smtp.ok) {
    console.log('[mailer] SMTP connection verified — live email delivery active');
  } else {
    console.warn(`[mailer] SMTP not available: ${smtp.error}`);
  }
});
