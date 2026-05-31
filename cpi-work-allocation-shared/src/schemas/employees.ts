import { z } from 'zod';

export const UserRoleSchema = z.enum([
  'Employee',
  'Manager',
  'Finance',
  'Admin',
]);

/**
 * One or more roles per user. Multi-role is the norm — e.g. an IT
 * Director who is also an Admin, or a Department Head who is also a
 * Manager and an Employee. Order is not semantic; permissions are the
 * UNION of the listed roles. Use `primaryRole(roles)` to derive a
 * single canonical role for ID prefixing or landing-page selection.
 *
 * Strict deduplication + min(1) — the empty case is meaningless (a
 * user with no roles can't see anything) and duplicates are noise.
 */
export const UserRolesSchema = z
  .array(UserRoleSchema)
  .min(1, 'At least one role is required')
  .transform((roles) => Array.from(new Set(roles)));

export const CreateEmployeeSchema = z.object({
  id: z.string().optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  // Password is optional: authentication is OTP-only (a 6-digit code
  // emailed to the user), so the password column on User is now
  // effectively a placeholder satisfied by a server-generated random
  // value when no value is supplied. The preprocess maps "" → undefined
  // BEFORE the inner schema runs; the inner schema itself is
  // `.optional()` so undefined is the accepted absence-marker. Wrapping
  // `.optional()` OUTSIDE the preprocess wouldn't work — Zod checks
  // optionality against the original input, not the transformed value.
  password: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.string().min(6).optional(),
  ),
  roles: UserRolesSchema,
  team: z.string().min(1),
  managerId: z.string().nullable().optional(),
  jobTitle: z.string().min(1),
});

export const UpdateEmployeeSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  // Same `"" → undefined` preprocess as CreateEmployeeSchema so an
  // edit form that leaves the password input blank passes validation
  // (no password update; existing hash retained).
  password: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.string().min(6).optional(),
  ),
  roles: UserRolesSchema.optional(),
  team: z.string().min(1).optional(),
  managerId: z.string().nullable().optional(),
  jobTitle: z.string().min(1).optional(),
});

export type UserRole = z.infer<typeof UserRoleSchema>;
export type UserRoles = z.infer<typeof UserRolesSchema>;
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeSchema>;

/**
 * Highest-to-lowest privilege ordering. Used purely to derive a single
 * canonical role from a multi-role array — for the ID prefix on new
 * users, for the post-login landing page, and for any other spot that
 * legitimately needs ONE role instead of the set.
 *
 * The ordering reflects reach, not seniority:
 *   - Admin manages the whole directory
 *   - Finance sees cross-company financials
 *   - Manager sees their direct reports
 *   - Employee sees only their own work
 */
const ROLE_PRIVILEGE_ORDER: readonly UserRole[] = [
  'Admin',
  'Finance',
  'Manager',
  'Employee',
];

/**
 * Pick the highest-privilege role from a user's role set. Defaults to
 * 'Employee' for the empty-array case (which shouldn't happen given
 * UserRolesSchema's min(1), but defensive — better to render a safe
 * default than to crash on a corrupted record).
 */
export function primaryRole(roles: readonly UserRole[] | null | undefined): UserRole {
  if (!roles || roles.length === 0) return 'Employee';
  for (const candidate of ROLE_PRIVILEGE_ORDER) {
    if (roles.includes(candidate)) return candidate;
  }
  return 'Employee';
}

/**
 * Check whether a user has any of the allowed roles. The natural
 * permission predicate for multi-role users — "does this user wear
 * any of these hats?"
 */
export function hasAnyRole(
  userRoles: readonly UserRole[] | null | undefined,
  allowed: readonly UserRole[],
): boolean {
  if (!userRoles || userRoles.length === 0) return false;
  return userRoles.some((r) => allowed.includes(r));
}
