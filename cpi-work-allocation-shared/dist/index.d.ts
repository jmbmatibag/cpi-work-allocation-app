/**
 * cpi-work-allocation-shared — single source of truth for request/response shapes.
 *
 * Consumers import from the package root:
 *
 *   import { UpsertDraftSchema, type UpsertDraftInput } from 'cpi-work-allocation-shared';
 *
 * Granular subpaths are also available for tree-shaking:
 *
 *   import { RequestOtpSchema } from 'cpi-work-allocation-shared/schemas/auth';
 */
export * from './lib/reportingPeriod.js';
export * from './schemas/common.js';
export * from './schemas/auth.js';
export * from './schemas/allocations.js';
export * from './schemas/employees.js';
export * from './schemas/managers.js';
export * from './schemas/journal.js';
export * from './schemas/settings.js';
export * from './schemas/maintenance.js';
//# sourceMappingURL=index.d.ts.map