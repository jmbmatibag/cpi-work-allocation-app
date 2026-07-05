import { z } from 'zod';
export declare const UserRoleSchema: z.ZodEnum<{
    Employee: "Employee";
    Manager: "Manager";
    Finance: "Finance";
    Admin: "Admin";
}>;
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
export declare const UserRolesSchema: z.ZodPipe<z.ZodArray<z.ZodEnum<{
    Employee: "Employee";
    Manager: "Manager";
    Finance: "Finance";
    Admin: "Admin";
}>>, z.ZodTransform<("Employee" | "Manager" | "Finance" | "Admin")[], ("Employee" | "Manager" | "Finance" | "Admin")[]>>;
export declare const CreateEmployeeSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    firstName: z.ZodString;
    lastName: z.ZodString;
    email: z.ZodString;
    password: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    roles: z.ZodPipe<z.ZodArray<z.ZodEnum<{
        Employee: "Employee";
        Manager: "Manager";
        Finance: "Finance";
        Admin: "Admin";
    }>>, z.ZodTransform<("Employee" | "Manager" | "Finance" | "Admin")[], ("Employee" | "Manager" | "Finance" | "Admin")[]>>;
    team: z.ZodString;
    managerId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    jobTitle: z.ZodString;
    emailNotificationsExempt: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const UpdateEmployeeSchema: z.ZodObject<{
    firstName: z.ZodOptional<z.ZodString>;
    lastName: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
    password: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    roles: z.ZodOptional<z.ZodPipe<z.ZodArray<z.ZodEnum<{
        Employee: "Employee";
        Manager: "Manager";
        Finance: "Finance";
        Admin: "Admin";
    }>>, z.ZodTransform<("Employee" | "Manager" | "Finance" | "Admin")[], ("Employee" | "Manager" | "Finance" | "Admin")[]>>>;
    team: z.ZodOptional<z.ZodString>;
    managerId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    jobTitle: z.ZodOptional<z.ZodString>;
    emailNotificationsExempt: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type UserRoles = z.infer<typeof UserRolesSchema>;
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeSchema>;
/**
 * Pick the highest-privilege role from a user's role set. Defaults to
 * 'Employee' for the empty-array case (which shouldn't happen given
 * UserRolesSchema's min(1), but defensive — better to render a safe
 * default than to crash on a corrupted record).
 */
export declare function primaryRole(roles: readonly UserRole[] | null | undefined): UserRole;
/**
 * Check whether a user has any of the allowed roles. The natural
 * permission predicate for multi-role users — "does this user wear
 * any of these hats?"
 */
export declare function hasAnyRole(userRoles: readonly UserRole[] | null | undefined, allowed: readonly UserRole[]): boolean;
//# sourceMappingURL=employees.d.ts.map