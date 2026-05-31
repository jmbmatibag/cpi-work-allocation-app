import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  LoginSchema,
  VerifyOtpSchema,
  ResendOtpSchema,
  SetupPasswordSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
} from 'cpi-work-allocation-shared';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as ctrl from '../controllers/auth.js';

const router = Router();

// Login is the new step-1 endpoint (replaces /request-otp from the
// OTP-only era). Rate limited tightly because every successful call
// triggers a bcrypt + an SMTP send; we don't want a guesser exhausting
// either resource.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts.' },
});

// Resend-OTP triggers an SMTP send on every successful call. The
// per-user resend cap + hourly lockout (in the controller) is the real
// abuse control; this IP limiter is a coarse backstop against a single
// host fanning resends across many email addresses.
const resendOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code requests. Try again in 15 minutes.' },
});

// Setup-password tokens are 256 bits of entropy, so a brute-force on
// the token space is hopeless. The limiter exists only to prevent a
// confused-deputy abuser from hammering bcrypt with thousands of
// concurrent attempts.
const setupPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many setup attempts. Try again in 15 minutes.' },
});

// /refresh is hit on every access-token expiry plus reactively on 401s, so the
// limit needs to be generous. It still caps an attacker brute-forcing refresh
// cookies at well below the rate needed to be useful.
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts.' },
});

// Forgot-password is rate-limited tightly — every hit triggers a DB write and
// potentially an SMTP send; we don't want a harvester using this as an oracle.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again in 15 minutes.' },
});

// Reset-password tokens are 256 bits of entropy — brute-forcing the token space
// is impossible. The limiter exists only to prevent bcrypt hammering.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset attempts. Try again in 15 minutes.' },
});

// Change-password is an authenticated endpoint — authenticated so already rate-
// limited via access-token issuance. Extra limiter here caps bcrypt abuse
// (an attacker who somehow steals a session shouldn't be able to hammer bcrypt).
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password change attempts. Try again in 15 minutes.' },
});

router.post('/login',            loginLimiter,           validate(LoginSchema),          ctrl.login);
router.post('/verify-otp',       verifyOtpLimiter,       validate(VerifyOtpSchema),      ctrl.verifyOtp);
router.post('/resend-otp',       resendOtpLimiter,       validate(ResendOtpSchema),      ctrl.resendOtp);
router.post('/setup-password',   setupPasswordLimiter,   validate(SetupPasswordSchema),  ctrl.setupPassword);
router.post('/forgot-password',  forgotPasswordLimiter,  validate(ForgotPasswordSchema), ctrl.forgotPassword);
router.post('/reset-password',   resetPasswordLimiter,   validate(ResetPasswordSchema),  ctrl.resetPassword);
router.post('/change-password',  changePasswordLimiter,  requireAuth, validate(ChangePasswordSchema), ctrl.changePassword);
router.post('/refresh',          refreshLimiter,         ctrl.refresh);
router.get('/me',                requireAuth,            ctrl.me);
router.post('/logout',           ctrl.logout);
router.post('/logout-all',       requireAuth,            ctrl.logoutAll);

export default router;
