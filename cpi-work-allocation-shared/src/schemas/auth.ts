import { z } from 'zod';

/**
 * Strong-password rule applied wherever the user chooses a credential
 * (setup-password and any future password-reset flow). Mirrors the
 * checklist rendered by the frontend strength meter so the client-side
 * gate and the server-side guard agree byte-for-byte:
 *   - 8+ characters
 *   - at least one uppercase letter
 *   - at least one lowercase letter
 *   - at least one digit
 *   - at least one special character (anything that isn't [A-Za-z0-9])
 *
 * Defense-in-depth: even if the UI is bypassed, the controller refuses
 * weak passwords. Always validate at the boundary.
 */
export const StrongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a special character');

/**
 * Step 1 of the two-step sign-in. Email + password are verified
 * server-side; on success the server emails a 6-digit OTP and the
 * client transitions to the OTP entry screen.
 */
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Step 2 of the two-step sign-in.
 *
 * `rememberMe` (Epic 2) is optional and defaults to false. Because the
 * session cookie is minted HERE (not at /login), the "Remember me for 7
 * days" choice made on the credentials screen is carried through to this
 * step. When true the controller signs a 7-day token (and embeds
 * `rememberMe` in the payload so the auth middleware can exempt it from
 * server-boot invalidation); when false it keeps the strict 10-hour token.
 */
export const VerifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d{6}$/, 'Code must be 6 digits'),
  rememberMe: z.boolean().optional().default(false),
});

/**
 * Body of POST /api/auth/resend-otp — re-issues a fresh login OTP during
 * an in-progress sign-in. Only the email is needed; the endpoint is
 * rate-limited server-side (per-user resend cap + hourly lockout) to
 * prevent it being used to spam an inbox.
 */
export const ResendOtpSchema = z.object({
  email: z.string().email(),
});

/**
 * Body of POST /api/auth/setup-password — redeems the one-time link
 * that an admin-created user receives in their welcome email. Token
 * format is whatever the server emits; we just require non-empty here
 * and let the controller do the value comparison + expiry check.
 */
export const SetupPasswordSchema = z.object({
  token: z.string().min(1, 'Setup token is required'),
  password: StrongPasswordSchema,
});

/**
 * Body of POST /api/auth/forgot-password — initiates a password reset
 * email. Always responds 200 regardless of whether the email exists so
 * callers cannot enumerate registered addresses.
 */
export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

/**
 * Body of POST /api/auth/reset-password — redeems the one-time link
 * emailed by the forgot-password flow. Token format is opaque; the
 * controller does the value comparison and expiry check.
 */
export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: StrongPasswordSchema,
});

/**
 * Body of POST /api/auth/change-password — changes a logged-in user's
 * password. Requires the current password to prevent CSRF-style
 * escalation where someone physically accesses an unlocked session.
 */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: StrongPasswordSchema,
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
export type ResendOtpInput = z.infer<typeof ResendOtpSchema>;
export type SetupPasswordInput = z.infer<typeof SetupPasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
