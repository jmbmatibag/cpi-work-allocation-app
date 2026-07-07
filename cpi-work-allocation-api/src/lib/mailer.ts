import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// ---------------------------------------------------------------------------
// Transport factory
// ---------------------------------------------------------------------------

function buildTransport(): Transporter {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      // SMTP_SECURE=false → STARTTLS on port 587 (Office 365 requirement)
      secure: SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: {
        // Office 365 presents a valid cert; reject invalid ones in production.
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });
  }

  // No SMTP configured — fall back to JSON transport (logs to console).
  return nodemailer.createTransport({ jsonTransport: true });
}

const transporter = buildTransport();
const FROM = process.env.SMTP_FROM ?? '"CPI Work Allocation" <no-reply@cpi.com.ph>';
const isReal = Boolean(process.env.SMTP_HOST);

// ---------------------------------------------------------------------------
// SMTP throttling (bulk sends)
// ---------------------------------------------------------------------------

/**
 * Max concurrent SMTP sends per chunk. Office 365 / Outlook rejects a flood
 * of simultaneous connections with `432 4.3.2 Concurrent connections limit
 * exceeded` (the ceiling is ~3 concurrent connections per authenticated
 * mailbox), so keep this small. Any bulk sender MUST route through
 * `processInBatches` with these limits rather than blasting the whole list.
 * Override via env for tenants with a different threshold.
 */
export const EMAIL_BATCH_SIZE = Number(process.env.EMAIL_BATCH_SIZE) || 3;

/** Pause between chunks (ms) to stay under the per-minute connection rate. */
export const EMAIL_BATCH_DELAY_MS = Number(process.env.EMAIL_BATCH_DELAY_MS) || 1500;

// ---------------------------------------------------------------------------
// Startup connectivity check (non-fatal — caller decides what to do)
// ---------------------------------------------------------------------------

export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  if (!isReal) return { ok: false, error: 'No SMTP configuration — using console transport' };
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// OTP email
// ---------------------------------------------------------------------------

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const info = await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Your CPI Work Allocation login code',
    text: otpPlainText(code),
    html: otpHtml(code),
  });

  if (!isReal) {
    // Dev fallback: surface the OTP so developers can log in without SMTP.
    console.log(`[mailer] OTP for ${to}: ${code}  (simulated send)`);
    console.log('[mailer] Full envelope:', JSON.stringify(info, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Generic notification email (workflow events)
// ---------------------------------------------------------------------------

export async function sendNotificationEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  await transporter.sendMail({ from: FROM, to, subject, html, text });
}

/**
 * Resolve the workflow-notification recipient.
 *
 * When the assigned manager's email is missing (e.g. submitter sits at
 * the top of the reporting chain, or the manager record was created
 * without an email), fall back to `NOTIFICATION_FALLBACK_EMAIL`. This
 * prevents workflow events from silently disappearing when the org
 * graph has gaps.
 *
 * Returns `null` when no real recipient is available — callers should
 * skip the send and log instead of attempting an empty `to`.
 */
export function resolveNotificationRecipient(
  primaryEmail?: string | null,
): string | null {
  const trimmed = primaryEmail?.trim();
  if (trimmed) return trimmed;
  const fallback = process.env.NOTIFICATION_FALLBACK_EMAIL?.trim();
  return fallback && fallback.length > 0 ? fallback : null;
}

// ---------------------------------------------------------------------------
// Workflow notification templates
// ---------------------------------------------------------------------------

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

/**
 * Deep link to an employee's own Monthly Allocations workspace for a given
 * period.
 *
 * The frontend has NO `/allocations/:id` route — the Monthly Allocations
 * page lives at `/allocations` and selects the record by (current user +
 * month + year), deep-linking via `?month=&year=` query params (see
 * MonthlyAllocations.tsx). Emailing `/allocations/<ALC-id>` therefore fell
 * through to the SPA's 404 route. This builds the URL the router actually
 * understands.
 *
 * Note this is only correct for emails sent TO the owning employee
 * (approval / revision notices) — the record is resolved from the logged-in
 * user, so a manager clicking it would land on their OWN allocation. Manager
 * review happens on `/team-hub` instead.
 */
function allocationDeepLink(month: string, year: string): string {
  const params = new URLSearchParams({ month, year });
  return `${APP_URL}/allocations?${params.toString()}`;
}

export function buildSubmissionEmailHtml(
  employeeName: string,
  month: string,
  year: string,
): string {
  return notificationHtml(
    'New Allocation Submitted for Review',
    `<strong>${employeeName}</strong> has submitted their work allocation for <strong>${month} ${year}</strong> and is awaiting your review.`,
    'warning',
    // Managers review team submissions on the Team Hub, not their own
    // allocations page.
    `${APP_URL}/team-hub`,
    'Review Allocation →',
  );
}

export function buildSubmissionEmailText(
  employeeName: string,
  month: string,
  year: string,
): string {
  return `${employeeName} has submitted their ${month} ${year} work allocation for review.\n\nLog in to CPI Work Allocation to review it: ${APP_URL}/team-hub`;
}

export function buildApprovalEmailHtml(
  employeeName: string,
  month: string,
  year: string,
  // Who actually approved it. Under Peer Coverage this may be a covering
  // peer rather than the employee's direct manager, so it's injected
  // explicitly rather than assumed. Optional for backward compatibility.
  reviewerName?: string | null,
): string {
  const byReviewer = reviewerName ? ` by <strong>${reviewerName}</strong>` : '';
  return notificationHtml(
    'Your Allocation Has Been Approved',
    `Your work allocation for <strong>${month} ${year}</strong> has been reviewed and approved${byReviewer}. No further action is required.`,
    'success',
    allocationDeepLink(month, year),
    'View Allocation →',
  );
}

export function buildApprovalEmailText(
  employeeName: string,
  month: string,
  year: string,
  reviewerName?: string | null,
): string {
  const byReviewer = reviewerName ? ` by ${reviewerName}` : '';
  return `Hi ${employeeName},\n\nYour work allocation for ${month} ${year} has been approved${byReviewer}.\n\nView it at: ${allocationDeepLink(month, year)}`;
}

export function buildRevisionEmailHtml(
  employeeName: string,
  month: string,
  year: string,
  feedback?: string | null,
  // Who actually returned it (may be a covering peer under Peer Coverage).
  reviewerName?: string | null,
): string {
  const noteLabel = reviewerName ? `Note from ${reviewerName}` : 'Reviewer note';
  const feedbackBlock = feedback
    ? `<p style="margin:12px 0 0;padding:12px;background:#FEF9C3;border-left:3px solid #EAB308;border-radius:3px;font-size:13px;color:#374151;line-height:1.5;"><strong>${noteLabel}:</strong> ${feedback}</p>`
    : '';
  const byReviewer = reviewerName ? ` by <strong>${reviewerName}</strong>` : '';
  return notificationHtml(
    'Your Allocation Needs Revision',
    `Your work allocation for <strong>${month} ${year}</strong> has been returned for revision${byReviewer}. Please review the feedback below and resubmit when ready.${feedbackBlock}`,
    'error',
    allocationDeepLink(month, year),
    'Update Allocation →',
  );
}

export function buildRevisionEmailText(
  employeeName: string,
  month: string,
  year: string,
  feedback?: string | null,
  reviewerName?: string | null,
): string {
  const noteLabel = reviewerName ? `Note from ${reviewerName}` : 'Reviewer note';
  const feedbackLine = feedback ? `\n\n${noteLabel}: ${feedback}` : '';
  const byReviewer = reviewerName ? ` by ${reviewerName}` : '';
  return `Hi ${employeeName},\n\nYour work allocation for ${month} ${year} has been returned for revision${byReviewer}.${feedbackLine}\n\nUpdate it at: ${allocationDeepLink(month, year)}`;
}

export function buildSubmissionReminderEmailHtml(
  employeeName: string,
  month: string,
  year: string,
): string {
  return notificationHtml(
    'Action Required: Submit Work Allocation',
    `Hello <strong>${employeeName}</strong>, this is a reminder to submit your monthly Work Allocation for <strong>${month} ${year}</strong>. Please log in to the CPI portal to complete your submission.`,
    'warning',
    `${APP_URL}/allocations`,
    'Submit Allocation →',
  );
}

export function buildSubmissionReminderEmailText(
  employeeName: string,
  month: string,
  year: string,
): string {
  return `Hello ${employeeName},\n\nThis is a reminder to submit your monthly Work Allocation for ${month} ${year}.\n\nPlease log in to the CPI portal to complete your submission: ${APP_URL}/allocations\n\n— CPI Work Allocation`;
}

export function buildPendingReviewReminderEmailHtml(
  managerName: string,
  month: string,
  year: string,
  pendingCount: number,
  employeeNames: string[],
): string {
  const plural = pendingCount === 1 ? '' : 's';
  const employeeList = employeeNames
    .map((n) => `<li style="margin:0 0 4px;">${n}</li>`)
    .join('');
  const employeeBlock = employeeNames.length > 0
    ? `<p style="margin:12px 0 4px;font-weight:600;color:#111827;">Awaiting your review:</p>
       <ul style="margin:0 0 0 18px;padding:0;color:#374151;font-size:13px;line-height:1.6;">${employeeList}</ul>`
    : '';
  return notificationHtml(
    'Team Allocations Pending Your Review',
    `Hello <strong>${managerName}</strong>, you have <strong>${pendingCount}</strong> team work allocation${plural} pending your review for <strong>${month} ${year}</strong>. Please log in to the CPI portal to approve or return these submissions.${employeeBlock}`,
    'warning',
    `${APP_URL}/team-hub`,
    'Review Submissions →',
  );
}

export function buildPendingReviewReminderEmailText(
  managerName: string,
  month: string,
  year: string,
  pendingCount: number,
  employeeNames: string[],
): string {
  const plural = pendingCount === 1 ? '' : 's';
  const list = employeeNames.length > 0
    ? `\n\nAwaiting your review:\n${employeeNames.map((n) => `  • ${n}`).join('\n')}`
    : '';
  return `Hello ${managerName},\n\nYou have ${pendingCount} team work allocation${plural} pending your review for ${month} ${year}.${list}\n\nPlease log in to the CPI portal to approve or return these submissions: ${APP_URL}/team-hub\n\n— CPI Work Allocation`;
}

/**
 * Manual overdue-allocation reminder (Epic 2). Fired by Finance from the
 * Master Overview "Send Reminders" dialog. Unlike the automated daily
 * `buildPendingReviewReminderEmail*`, this one is explicitly framed as an
 * urgent, Finance-originated nudge about the manager's outstanding review
 * queue for the period.
 */
export function buildManualReminderEmailHtml(
  managerName: string,
  month: string,
  year: string,
  pendingCount: number,
): string {
  const countPhrase =
    pendingCount > 0
      ? `Currently, our system shows that you have <strong>${pendingCount}</strong> employee allocation${pendingCount === 1 ? '' : 's'} pending your review and approval.`
      : `Your team still has Work Allocations that are not yet fully approved.`;
  return notificationHtml(
    'Action Required: Overdue Work Allocations',
    `Hi <strong>${managerName}</strong>,
     <p style="margin:12px 0 0;">This is a reminder from the Finance team regarding the Work Allocations for <strong>${month} ${year}</strong>.</p>
     <p style="margin:12px 0 0;">${countPhrase}</p>
     <p style="margin:12px 0 0;">To ensure our billing and resource tracking remain on schedule, please log in to the CPI Work Allocation Portal as soon as possible to review and approve your team's submissions.</p>
     <p style="margin:12px 0 0;">If your team is experiencing blockers in submitting their journals, please let Finance know immediately.</p>`,
    'error',
    `${APP_URL}/team-hub`,
    'Review Team Allocations →',
  );
}

export function buildManualReminderEmailText(
  managerName: string,
  month: string,
  year: string,
  pendingCount: number,
): string {
  const countLine =
    pendingCount > 0
      ? `Currently, our system shows that you have ${pendingCount} employee allocation${pendingCount === 1 ? '' : 's'} pending your review and approval.`
      : `Your team still has Work Allocations that are not yet fully approved.`;
  return [
    `Hi ${managerName},`,
    '',
    `This is a reminder from the Finance team regarding the Work Allocations for ${month} ${year}.`,
    '',
    countLine,
    '',
    "To ensure our billing and resource tracking remain on schedule, please log in to the CPI Work Allocation Portal as soon as possible to review and approve your team's submissions.",
    '',
    `${APP_URL}/team-hub`,
    '',
    'If your team is experiencing blockers in submitting their journals, please let Finance know immediately.',
    '',
    'Thank you,',
    'CPI Finance Team',
  ].join('\n');
}

/**
 * Finance completion notice (Epic 3). Fired automatically the moment a
 * manager approves the LAST outstanding allocation for their team in a
 * period, so Finance/Admin can begin accounting/billing for that team.
 */
export function buildFinanceCompletionEmailHtml(
  managerName: string,
  month: string,
  year: string,
  approvedCount: number,
): string {
  return notificationHtml(
    'Team Allocations Fully Approved',
    `<strong>${managerName}</strong> has fully approved all Work Allocations for <strong>${month} ${year}</strong>.
     <p style="margin:12px 0 0;">All ${approvedCount} allocation${approvedCount === 1 ? '' : 's'} for this team are now approved and ready for accounting processing.</p>`,
    'success',
    `${APP_URL}/master`,
    'Open Master Overview →',
  );
}

export function buildFinanceCompletionEmailText(
  managerName: string,
  month: string,
  year: string,
  approvedCount: number,
): string {
  return [
    `${managerName} has fully approved all Work Allocations for ${month} ${year}.`,
    '',
    `All ${approvedCount} allocation${approvedCount === 1 ? '' : 's'} for this team are now approved and ready for accounting processing.`,
    '',
    `View the Master Overview: ${APP_URL}/master`,
    '',
    '— CPI Work Allocation',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Password-reset email (forgot-password flow)
// ---------------------------------------------------------------------------

/**
 * TTL for the password-reset link. Shorter than the welcome-email setup
 * link (24h) because the user already has an account and is actively
 * trying to reset their credential — a tight window limits exposure from
 * a forwarded or intercepted link.
 */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Send the password-reset email containing the one-time reset link.
 * Fired AFTER the forgot-password endpoint validates that the email
 * exists and writes a token to the DB. The token is consumed (cleared)
 * the moment the user submits the reset form.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
  const subject = 'Reset your CPI Work Allocation password';
  const info = await transporter.sendMail({
    from: FROM,
    to,
    subject,
    text: buildPasswordResetEmailText(resetUrl),
    html: buildPasswordResetEmailHtml(resetUrl),
  });

  if (!isReal) {
    console.log(`[mailer] Password-reset email for ${to}  (simulated send)`);
    console.log(`[mailer] Reset URL: ${resetUrl}`);
    console.log('[mailer] Full envelope:', JSON.stringify(info, null, 2));
  }
}

export function buildPasswordResetEmailText(resetUrl: string): string {
  return [
    'CPI Work Allocation — Password Reset',
    '',
    'You requested a password reset. Use the secure link below to choose a new password:',
    '',
    resetUrl,
    '',
    'This link is valid for 1 hour and can be used only once.',
    'If you did not request this reset, you can safely ignore this email. Your account remains secure.',
    '',
    '— CPI Work Allocation',
  ].join('\n');
}

export function buildPasswordResetEmailHtml(resetUrl: string): string {
  return notificationHtml(
    'Reset Your Password',
    `<p style="margin:0 0 12px;">We received a request to reset the password for your CPI Work Allocation account. Click the button below to choose a new password.</p>
     <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">This link is valid for <strong>1 hour</strong> and can be used only once.</p>
     <p style="margin:0;color:#6b7280;font-size:13px;">If you did not request this reset, you can safely ignore this email. Your account remains secure.</p>`,
    'warning',
    resetUrl,
    'Reset Password →',
  );
}

// ---------------------------------------------------------------------------
// Welcome / password-setup email (admin-created account)
// ---------------------------------------------------------------------------

/**
 * TTL for the password-setup link. Mirrors the value the controller
 * stamps into `passwordSetupExpiresAt` so the email body can quote a
 * stable phrasing. 24 hours is long enough to survive a delayed inbox
 * and a weekend send, short enough that an unredeemed link is not a
 * standing credential.
 */
export const PASSWORD_SETUP_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Send the welcome email containing the one-time password-setup link.
 * Fired AFTER an admin creates an account — the link is the only path
 * for the recipient to choose a password. Sign-in (POST /api/auth/login)
 * refuses accounts that haven't redeemed this link yet.
 *
 * The token in the URL is the high-entropy random value persisted to
 * `User.passwordSetupToken`. It is consumed (cleared from the DB) the
 * moment the user completes the setup form.
 */
export async function sendWelcomeEmail(
  to: string,
  employeeName: string,
  setupToken: string,
): Promise<void> {
  const subject = 'Welcome to CPI Work Allocation — set your password';
  const setupUrl = `${APP_URL}/setup-password?token=${encodeURIComponent(setupToken)}`;
  const info = await transporter.sendMail({
    from: FROM,
    to,
    subject,
    text: buildWelcomeEmailText(employeeName, to, setupUrl),
    html: buildWelcomeEmailHtml(employeeName, to, setupUrl),
  });

  if (!isReal) {
    console.log(`[mailer] Welcome / setup email for ${to}  (simulated send)`);
    console.log(`[mailer] Setup URL: ${setupUrl}`);
    console.log('[mailer] Full envelope:', JSON.stringify(info, null, 2));
  }
}

export function buildWelcomeEmailText(
  employeeName: string,
  email: string,
  setupUrl: string,
): string {
  return [
    `Hi ${employeeName},`,
    '',
    'Your CPI Work Allocation account has been created by an administrator.',
    'Before you can sign in, please choose a password using the secure link below.',
    '',
    `Login email: ${email}`,
    `Set your password: ${setupUrl}`,
    '',
    'This link is valid for 24 hours and can be used only once.',
    '',
    'Once you have set your password, sign in with:',
    `  1. Your email (${email}) and the password you just chose`,
    '  2. A one-time 6-digit code we email to this inbox (valid for 10 minutes)',
    '',
    'If you did not expect this account, you can safely ignore this email.',
    '',
    '— CPI Work Allocation',
  ].join('\n');
}

export function buildWelcomeEmailHtml(
  employeeName: string,
  email: string,
  setupUrl: string,
): string {
  const bodyHtml = `
    <p style="margin:0 0 12px;">Hi <strong>${employeeName}</strong>,</p>
    <p style="margin:0 0 12px;">Your CPI Work Allocation account has been created by an administrator. Before you can sign in, please choose a password using the secure link below.</p>
    <p style="margin:0 0 4px;"><strong>Login email:</strong> ${email}</p>
    <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">This link is valid for <strong>24 hours</strong> and can be used only once.</p>
    <p style="margin:12px 0 4px;">After setting your password, sign-in requires two steps:</p>
    <ol style="margin:0 0 12px 18px;padding:0;color:#374151;font-size:13px;line-height:1.6;">
      <li>Enter your email and password</li>
      <li>Enter the one-time 6-digit code we email to this inbox</li>
    </ol>`;
  return notificationHtml(
    'Welcome to CPI Work Allocation',
    bodyHtml,
    'info',
    setupUrl,
    'Set Your Password →',
  );
}

function notificationHtml(
  title: string,
  bodyHtml: string,
  type: 'info' | 'success' | 'warning' | 'error',
  actionUrl: string,
  actionLabel: string,
): string {
  const palette = {
    info:    { bg: '#EFF6FF', border: '#3B82F6', accent: '#1D4ED8' },
    success: { bg: '#F0FDF4', border: '#22C55E', accent: '#15803D' },
    warning: { bg: '#FFFBEB', border: '#F59E0B', accent: '#B45309' },
    error:   { bg: '#FEF2F2', border: '#EF4444', accent: '#B91C1C' },
  } as const;
  const c = palette[type];
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="520" cellspacing="0" cellpadding="0"
             style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1a3e72;padding:24px 40px;">
            <table role="presentation" cellspacing="0" cellpadding="0">
              <tr>
                <td style="vertical-align:middle;padding-right:14px;">
                  <img src="https://cpi.com.ph/wp-content/uploads/2026/05/cpi-logo.png" alt="CPI" width="44" height="44"
                       style="display:block;border-radius:4px;">
                </td>
                <td style="vertical-align:middle;">
                  <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.02em;">CPI Work Allocation</p>
                  <p style="margin:4px 0 0;color:#a8c0e8;font-size:13px;">Workflow Notification</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <div style="background:${c.bg};border-left:4px solid ${c.border};padding:16px 20px;border-radius:4px;">
              <h2 style="margin:0 0 8px;color:${c.accent};font-size:16px;font-weight:700;">${title}</h2>
              <div style="color:#374151;font-size:14px;line-height:1.6;">${bodyHtml}</div>
            </div>
            <p style="margin:24px 0 0;">
              <a href="${actionUrl}" style="display:inline-block;background:${c.accent};color:#ffffff;font-size:14px;font-weight:600;padding:10px 20px;border-radius:4px;text-decoration:none;">${actionLabel}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
              This is an automated notification from CPI Work Allocation. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function otpPlainText(code: string): string {
  return [
    'CPI Work Allocation — Login Code',
    '',
    `Your one-time code is: ${code}`,
    '',
    'This code expires in 10 minutes. Do not share it with anyone.',
    '',
    'If you did not request this code, you can safely ignore this email.',
    'Your account remains secure.',
    '',
    '— CPI Work Allocation',
  ].join('\n');
}

function otpHtml(code: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your CPI login code</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0"
               style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1a3e72;padding:24px 40px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:14px;">
                    <img src="https://cpi.com.ph/wp-content/uploads/2026/05/cpi-logo.png" alt="CPI" width="44" height="44"
                         style="display:block;border-radius:4px;">
                  </td>
                  <td style="vertical-align:middle;">
                    <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.02em;">
                      CPI Work Allocation
                    </p>
                    <p style="margin:4px 0 0;color:#a8c0e8;font-size:13px;">
                      Confidential Productivity Intelligence
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 28px;">
              <p style="margin:0 0 8px;color:#111827;font-size:16px;font-weight:600;">
                Your one-time login code
              </p>
              <p style="margin:0 0 28px;color:#6b7280;font-size:14px;line-height:1.5;">
                Use the code below to sign in to CPI Work Allocation.
                It is valid for <strong>10&nbsp;minutes</strong>.
              </p>

              <!-- OTP code block -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#f0f4ff;border:2px solid #c7d7f5;border-radius:8px;padding:18px 40px;text-align:center;">
                    <span style="font-size:36px;font-weight:700;letter-spacing:0.3em;color:#1a3e72;font-family:'Courier New',monospace;">
                      ${code}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
                For your security, never share this code with anyone — CPI staff will
                <strong>never</strong> ask you for it.
              </p>
              <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
                If you did not request this code, you can safely ignore this email.
                Your account remains secure.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
                This is an automated message from CPI Work Allocation.
                Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
