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
export declare const StrongPasswordSchema: z.ZodString;
/**
 * Step 1 of the two-step sign-in. Email + password are verified
 * server-side; on success the server emails a 6-digit OTP and the
 * client transitions to the OTP entry screen.
 */
export declare const LoginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
/**
 * Step 2 of the two-step sign-in — unchanged from the OTP-only era so
 * the verifyOtp controller can keep its existing logic verbatim.
 */
export declare const VerifyOtpSchema: z.ZodObject<{
    email: z.ZodString;
    code: z.ZodString;
}, z.core.$strip>;
/**
 * Body of POST /api/auth/resend-otp — re-issues a fresh login OTP during
 * an in-progress sign-in. Only the email is needed; the endpoint is
 * rate-limited server-side (per-user resend cap + hourly lockout) to
 * prevent it being used to spam an inbox.
 */
export declare const ResendOtpSchema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
/**
 * Body of POST /api/auth/setup-password — redeems the one-time link
 * that an admin-created user receives in their welcome email. Token
 * format is whatever the server emits; we just require non-empty here
 * and let the controller do the value comparison + expiry check.
 */
export declare const SetupPasswordSchema: z.ZodObject<{
    token: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
/**
 * Body of POST /api/auth/forgot-password — initiates a password reset
 * email. Always responds 200 regardless of whether the email exists so
 * callers cannot enumerate registered addresses.
 */
export declare const ForgotPasswordSchema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
/**
 * Body of POST /api/auth/reset-password — redeems the one-time link
 * emailed by the forgot-password flow. Token format is opaque; the
 * controller does the value comparison and expiry check.
 */
export declare const ResetPasswordSchema: z.ZodObject<{
    token: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
/**
 * Body of POST /api/auth/change-password — changes a logged-in user's
 * password. Requires the current password to prevent CSRF-style
 * escalation where someone physically accesses an unlocked session.
 */
export declare const ChangePasswordSchema: z.ZodObject<{
    currentPassword: z.ZodString;
    newPassword: z.ZodString;
}, z.core.$strip>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
export type ResendOtpInput = z.infer<typeof ResendOtpSchema>;
export type SetupPasswordInput = z.infer<typeof SetupPasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
//# sourceMappingURL=auth.d.ts.map