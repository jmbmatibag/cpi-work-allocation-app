# cpi-work-allocation-shared

Shared Zod schemas and inferred types for the CPI Work Allocation api + frontend.

## Why

Phase 3.5 of the rollout plan: one source of truth for request/response shapes
so the backend validates and the frontend types stay aligned automatically.

## Layout

```
src/
  schemas/
    allocations.ts
    auth.ts
    common.ts
    employees.ts
    journal.ts
    settings.ts
  index.ts          // re-exports everything
```

## Consumption

Both `cpi-work-allocation-api` and `cpi-work-allocation-frontend` install this
package via a `file:` dependency:

```json
"cpi-work-allocation-shared": "file:../cpi-work-allocation-shared"
```

Build before consumers can import: `npm run build`.

For active development, run `npm run watch` in this package; consumers see
updates after their own dev servers reload.

## Adding a schema

1. Add to `src/schemas/<topic>.ts`.
2. Re-export from `src/index.ts`.
3. `npm run build`.
4. In consuming projects, `npm install` (only needed when fields change in
   `package.json`, not for code edits — but a rebuild here is always required).
