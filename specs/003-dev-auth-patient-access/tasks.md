---
description: "Task list for Dev Auth Bypass and Patient Access Controls"
---

# Tasks: Dev Auth Bypass and Patient Access Controls

**Input**: Design documents from `specs/003-dev-auth-patient-access/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, contracts/auth-contract.md ✅

**Tests**: TDD enforced per constitution Principle III. Unit tests for the bypass
(T001) MUST be written and confirmed failing before implementation (T002, T003).
Contract tests for patient permissions (T004) document existing behaviour.

**Scope**: 2 code changes, 2 test changes — no new entities, routes, or migrations.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = Dev Auth Bypass, US2 = Patient Access Controls

---

## Phase 1: Setup

No new dependencies, no new project structure. Existing codebase has everything
required. Skip to Phase 2 (User Stories).

---

## Phase 2: User Story 1 — Developer Works Without Authentication Tokens (Priority: P1) 🎯 MVP

**Goal**: A developer starts the server with `NODE_ENV=development` and calls any
protected endpoint without an `Authorization` header. The request succeeds with the
dev identity `{ sub: 'dev-patient-001', role: 'patient' }`. A startup warning is
logged. In production mode the existing 401 behaviour is unchanged.

**Independent Test**: `NODE_ENV=development npm run dev`, then
`curl http://localhost:3000/v1/records?patient_id=dev-patient-001` — returns 200
(possibly empty array) with no token. Same request with `NODE_ENV=production` →
401. Verifiable without any database or S3 state.

### Tests for US1 (Write first — MUST FAIL before implementation)

- [x] T001 [US1] Write `tests/unit/auth.test.ts` — unit tests for `requireAuth`: (a) when `NODE_ENV=development` and no `Authorization` header, `request.user` is set to `{ sub: 'dev-patient-001', role: 'patient' }` and handler is not sent 401; (b) when `NODE_ENV=development` and a valid JWT is present, token is still verified normally; (c) when `NODE_ENV=production` and no header, handler sends 401 RFC 7807 response; (d) dev identity constant `DEV_IDENTITY` is exported from `src/middleware/auth.ts` with the correct shape

### Implementation for US1

- [x] T002 [US1] Modify `requireAuth` in `src/middleware/auth.ts` — at the start of the function, if `process.env.NODE_ENV === 'development'` and the `Authorization` header is absent, set `request.user = DEV_IDENTITY` and return (skip JWT verification); export `DEV_IDENTITY` constant `{ sub: 'dev-patient-001', role: 'patient' as UserRole }`; no changes to any other exports
- [x] T003 [P] [US1] Add dev-mode startup warning in `src/app.ts` — after Fastify instance is created and before routes are registered, add: `if (process.env.NODE_ENV === 'development') { app.log.warn('⚠ AUTHENTICATION DISABLED — running in development mode (NODE_ENV=development)') }`

**Checkpoint**: `npm run test:unit` passes T001 tests. `NODE_ENV=development npm run dev`
logs the auth warning at startup. `curl http://localhost:3000/v1/records?patient_id=dev-patient-001`
returns 200 with no `Authorization` header. Same curl with `NODE_ENV=production` returns 401.

---

## Phase 3: User Story 2 — Patient Access Controls (Priority: P2)

**Goal**: Document and verify that patient-role tokens cannot access record type
management endpoints. Code analysis (research.md Decision 5) confirms all patient
restrictions are already enforced by `requireAdmin` and `assertPatientAccess` — this
phase adds explicit contract tests that make the permission boundary observable and
regression-proof.

**Independent Test**: Generate a patient JWT (`npm run dev:token -- --role patient --sub p1`),
then `POST /v1/record-types` with that token → 403; `PATCH /v1/record-types/:id` → 403.
Verifiable without US1 being deployed.

### Tests for US2

- [x] T004 [US2] Add patient-permission tests to `tests/contract/record-types.test.ts` — add a `describe('patient role restrictions')` block with: (a) `POST /v1/record-types` with a patient token returns 403 and RFC 7807 body; (b) `PATCH /v1/record-types/:id` with a patient token returns 403 and RFC 7807 body; (c) `GET /v1/record-types` with a patient token returns 200 (patients may read active types); mock `recordTypeService` so no DB is required

**Checkpoint**: `npm run test:contract` passes. Patient token is rejected by management
endpoints with 403. `GET /v1/record-types` still works for patients.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [x] T005 [P] Run `npm test` (full suite: unit + contract) and confirm all tests pass with zero failures
- [x] T006 [P] Verify `DEV_IDENTITY` is referenced in `tests/unit/auth.test.ts` by importing from `src/middleware/auth.ts` (not hardcoded) so the test stays in sync with the implementation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 2 (US1)**: No prerequisites — can start immediately
- **Phase 3 (US2)**: Independent of US1 — can run in parallel with Phase 2
- **Phase 4 (Polish)**: Requires Phase 2 + Phase 3 complete

### User Story Dependencies

- **US1 (P1)**: Fully independent
- **US2 (P2)**: Fully independent — no dependency on US1

### Within Each User Story

- T001 (unit test) MUST be written and confirmed **failing** before T002/T003
- T002 and T003 can run in parallel (different files)
- T004 (contract tests) are expected to **pass immediately** — they verify existing behaviour

### Parallel Opportunities

```bash
# US1 and US2 are entirely independent — can run simultaneously:
Phase 2: T001 → T002 + T003
Phase 3: T004

# Within US1, after T001 is confirmed failing:
T002 (src/middleware/auth.ts) and T003 (src/app.ts) in parallel

# Polish tasks are all independent:
T005, T006
```

---

## Implementation Strategy

### MVP (User Story 1 Only)

1. Write T001 (unit tests) — confirm they FAIL
2. Implement T002 (auth bypass) + T003 (startup warning) in parallel
3. **STOP and VALIDATE**: `npm run test:unit` passes; curl without token works in dev, fails in prod

### Full Delivery

1. MVP (US1) above
2. Add T004 (patient contract tests) — expected to pass immediately
3. T005/T006 (polish validation)

---

## Notes

- T004 tests are expected to pass without any code change — they document existing `requireAdmin` behaviour
- [P] on T003 means it can be written at the same time as T002 (different files)
- `DEV_IDENTITY` must be a named export so tests can import it rather than hardcoding the constant
- No database migrations, no new routes, no new services in this feature
