# Research: Dev Auth Bypass and Patient Access Controls

**Feature**: 003-dev-auth-patient-access  
**Date**: 2026-04-04

---

## Decision 1: Dev Bypass Implementation Approach

**Decision**: Modify `requireAuth` in `src/middleware/auth.ts` to short-circuit JWT verification when `NODE_ENV === 'development'` and inject a synthetic `AuthUser`.

**Rationale**: `requireAuth` is the single preHandler used by all protected record endpoints. A single conditional check there covers every protected route with zero duplication. Adding a separate Fastify plugin or hook would introduce indirection for a change that is purely additive to one function.

**Alternatives considered**:
- Separate Fastify `onRequest` hook registered only in dev — rejected: more indirection, harder to test in isolation
- Environment-aware Fastify plugin — rejected: over-engineered for a one-line conditional
- Separate `requireAuthDev` export — rejected: requires touching every route that uses `requireAuth`

---

## Decision 2: Dev Identity

**Decision**: `{ sub: 'dev-patient-001', role: 'patient' }` injected into `request.user` when bypass is active.

**Rationale**: Using the `patient` role means the dev bypass exercises the same code path a real patient would follow, including `assertPatientAccess` checks. Using a fixed `sub` ensures reproducible behaviour across restarts. The constant is defined once in `auth.ts` so it can be referenced in tests and documentation.

**Alternatives considered**:
- Role `provider` — rejected: providers need `patientId` query params which are more setup, defeating the ease-of-use goal
- Role `administrator` — rejected: admins cannot access patient records; would make record routes fail
- Configurable via env var — rejected: YAGNI; a fixed dev identity is documented and sufficient

---

## Decision 3: Bypass Activation Condition

**Decision**: Bypass activates only when `process.env.NODE_ENV === 'development'`. If `NODE_ENV` is unset, empty, or any other value, auth is enforced normally.

**Rationale**: Matches the existing pattern in `src/db/knexfile.ts` which also keys off `NODE_ENV`. Fail-secure: missing env var defaults to auth enforcement.

**Alternatives considered**:
- Separate `AUTH_BYPASS=true` env var — rejected: creates a second flag that could be accidentally set in non-dev environments; `NODE_ENV` already serves this purpose
- `NODE_ENV !== 'production'` — rejected: this would activate bypass in staging environments, violating FR-003

---

## Decision 4: Startup Warning

**Decision**: Add a Fastify `log.warn` call in `src/app.ts` during plugin registration, emitted before any requests are served.

**Rationale**: Fastify's structured logger produces the warning as JSON with the standard fields (`level`, `time`, `msg`), consistent with the rest of the application's observability. The warning text is unambiguous: `'⚠ AUTHENTICATION DISABLED — running in development mode (NODE_ENV=development)'`.

**Alternatives considered**:
- `console.warn` — rejected: bypasses structured logging; not visible in log aggregation pipelines
- Print in `requireAuth` on each request — rejected: noisy; one startup message is sufficient

---

## Decision 5: Patient Permission Scope — Existing Code Analysis

**Decision**: No route or service changes are required for US2. The existing `assertPatientAccess` guard already enforces all patient access restrictions correctly.

**Rationale**: Audit of existing routes:

| Endpoint | Guard | Patient behaviour |
|----------|-------|-------------------|
| `POST /v1/upload` | `requireAuth` + `assertPatientAccess(patientId, user)` | Patient can only upload to their own `patient_id` ✅ |
| `GET /v1/records` | `requireAuth` + `assertPatientAccess(patient_id, user)` | Patient sees only records where `patient_id = user.sub` ✅ |
| `GET /v1/records/:id` | `requireAuth` + inline check | Patient only retrieves records matching `user.sub` ✅ |
| `GET /v1/record-types` | `requireAuth` | Patient can read active types (needed for upload) ✅ |
| `POST /v1/record-types` | `requireAdmin` | Patient receives 403 ✅ |
| `PATCH /v1/record-types/:id` | `requireAdmin` | Patient receives 403 ✅ |

All FR-005 through FR-009 requirements are already satisfied by existing guards. US2 work is limited to verifying this with explicit contract tests that document the patient permission boundary.

---

## Decision 6: Test Coverage Plan

**Decision**: Two new test files are required:
1. `tests/unit/auth.test.ts` — unit tests for `requireAuth` covering dev bypass (env on/off, header present/absent, injected identity shape)
2. New test cases in `tests/contract/record-types.test.ts` — assert `POST /v1/record-types` and `PATCH /v1/record-types/:id` return 403 for a patient token

**Rationale**: The unit test targets the bypass logic in isolation (no Fastify overhead). The contract test targets the patient permission boundary at the HTTP level, which is the observable behaviour spec SC-002 requires to be verified.
