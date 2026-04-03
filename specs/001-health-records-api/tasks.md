---
description: "Task list for Health Records Digitalization API"
---

# Tasks: Health Records Digitalization API

**Input**: Design documents from `specs/001-health-records-api/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/openapi.yaml ✅, quickstart.md ✅

**Tests**: TDD enforced per constitution (Principle III). Contract tests written
first and confirmed failing before implementation begins. Integration tests hit
real PostgreSQL + MinIO (no mocks).

**Organization**: Tasks are grouped by user story to enable independent
implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1 = Upload, US2 = Retrieve, US3 = Record Types)

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Bootstrap the Node.js/TypeScript/Fastify project and development
infrastructure so all subsequent phases can build on a clean foundation.

- [x] T001 Initialize Node.js project: `npm init`, create `tsconfig.json`, `package.json` with Node.js 20 + TypeScript 5.4 at repo root
- [x] T002 [P] Install runtime dependencies: fastify, @fastify/multipart, @fastify/jwt, @fastify/swagger, @fastify/swagger-ui, zod, @aws-sdk/client-s3, knex, pg
- [x] T003 [P] Install dev dependencies: vitest, supertest, @types/node, tsx, eslint, prettier, dotenv
- [x] T004 Create project directory structure: `src/config/`, `src/db/migrations/`, `src/db/seeds/`, `src/models/`, `src/routes/`, `src/services/`, `src/middleware/`, `tests/contract/`, `tests/integration/`, `tests/unit/`
- [x] T005 [P] Create `docker-compose.yml` with PostgreSQL 16 and MinIO services (ports 5432, 9000, 9001)
- [x] T006 [P] Create `.env.example` with all required variables: `DATABASE_URL`, `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_BUCKET`, `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY`, `JWT_PUBLIC_KEY_PATH`, `PORT`, `NODE_ENV`
- [x] T007 [P] Configure ESLint + Prettier in `eslint.config.js` and `.prettierrc`
- [x] T008 Add npm scripts to `package.json`: `dev`, `build`, `test`, `test:contract`, `test:integration`, `test:unit`, `db:migrate`, `db:seed`, `dev:token`, `lint`

**Checkpoint**: `npm install` completes cleanly; `docker compose up -d` starts
both services; `npm run dev` (with stub app.ts) serves on port 3000.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before any user story
work begins. Includes database schema, auth middleware, error handler, app
bootstrap, and the Fastify instance.

**⚠️ CRITICAL**: No user story implementation can begin until this phase is complete.

- [x] T009 Create `src/config/index.ts` — read and validate all env vars using Zod; throw on startup if required vars are missing
- [x] T010 Create Knex config in `src/db/knexfile.ts` connecting to `DATABASE_URL`
- [x] T011 Create migration `src/db/migrations/001_create_record_types.ts` — `record_types` table per data-model.md (id UUID PK, name VARCHAR UNIQUE, description TEXT, is_active BOOLEAN, created_at, updated_at)
- [x] T012 Create migration `src/db/migrations/002_create_health_records.ts` — `health_records` table per data-model.md (all columns + partial unique index on idempotency_key + composite indexes on patient_id)
- [x] T013 Create seed `src/db/seeds/001_record_types.ts` — insert 8 default record types if table is empty (Lab Result, Prescription, Imaging/Radiology, Clinical Note, Vaccination Record, Discharge Summary, Referral Letter, Insurance Document)
- [x] T014 [P] Create TypeScript domain types in `src/models/health-record.ts` and `src/models/record-type.ts` matching data-model.md entities exactly
- [x] T015 [P] Create RFC 7807 error handler middleware in `src/middleware/error-handler.ts` — maps all errors to `{type, title, status, detail, instance}` Problem Details JSON
- [x] T016 Create JWT auth middleware in `src/middleware/auth.ts` — verify RS256 bearer token, extract `sub` and `role` claims, attach to request context; return 401 on missing/invalid token
- [x] T017 Create `src/app.ts` — instantiate Fastify with JSON schema compiler, register `@fastify/multipart`, `@fastify/jwt`, `@fastify/swagger`, error handler middleware, and all route plugins under `/v1`
- [x] T018 Create `src/routes/health.ts` — `GET /v1/health` (no auth) and `GET /v1/ready` (no auth, probe DB + MinIO) returning `{status: "ok"}` or Problem Details 503
- [x] T019 Create `scripts/dev-token.ts` — CLI helper to generate a signed RS256 dev JWT with `--role` and `--sub` flags (reads private key from `./keys/dev-private.pem`); also generate dev key pair at `./keys/`
- [x] T020 [P] Create `src/services/storage.service.ts` — thin wrapper around `@aws-sdk/client-s3`: `uploadFile(key, stream, mimeType)`, `generatePresignedUrl(key, ttlSeconds)`, `checkBucketReachable()`

**Checkpoint**: `npm run db:migrate && npm run db:seed` succeeds; `GET /v1/health`
returns 200; `GET /v1/ready` returns 200 with Docker services running.

---

## Phase 3: User Story 1 — Upload Health Record (Priority: P1) 🎯 MVP

**Goal**: An authenticated patient or provider can upload a health record file
(PDF, JPEG, PNG, DICOM ≤ 50 MB) with a patient ID and record type. The system
stores the file, persists metadata, and returns a record ID. Idempotency keys
prevent duplicate uploads on retries.

**Independent Test**: Run `npm run test:contract -- --grep "POST /v1/upload"` —
upload a test PDF with valid patient_id and record_type_id, verify HTTP 201
and a UUID in the response. Retry with same Idempotency-Key, verify HTTP 200
with same ID.

### Contract Tests for US1 (Write first — MUST FAIL before implementation)

- [x] T021 [P] [US1] Write contract test `tests/contract/upload.test.ts` — POST /v1/upload: happy path (201 + record ID), idempotency duplicate (200 + same ID), unsupported file type (422), file > 50 MB (413), missing required fields (422), unauthenticated (401), patient accessing other patient (403), inactive record_type_id (409), storage unavailable (503)

### Implementation for US1

- [x] T022 [US1] Create `src/services/record.service.ts` — `createRecord({patientId, recordTypeId, uploadedBy, file, idempotencyKey?})`: validate record type is active, stream file to object store via `storage.service.ts`, persist metadata row, return record ID; handle idempotency key collision by returning existing record
- [x] T023 [US1] Create role-based authorization guard in `src/middleware/auth.ts` — add `assertPatientAccess(requestPatientId, token)`: patients blocked if `requestPatientId !== token.sub`; providers allowed for any patient; admins blocked from record endpoints
- [x] T024 [US1] Create `src/routes/records.ts` — `POST /v1/upload`: parse multipart form (patient_id, record_type_id, file), validate file MIME type and size, call `record.service.createRecord`, return 201 or idempotency 200; include Zod request schema for Fastify validation
- [x] T025 [US1] Register records route plugin in `src/app.ts` under `/v1`

**Checkpoint**: `npm run test:contract -- --grep upload` passes all 9 scenarios.
Upload a real PDF via curl (quickstart.md US1 steps) and confirm record ID returned.

---

## Phase 4: User Story 2 — Retrieve Health Records (Priority: P2)

**Goal**: An authorized user (patient, provider) can list health records for a
patient with optional `record_type_id` filter and cursor pagination, and fetch
a single record with a time-limited pre-signed download URL.

**Independent Test**: Seed a known record via the upload endpoint (or DB seed),
then run `npm run test:contract -- --grep "GET /v1/records"`. Verify paginated
list returns correct records; single-record fetch returns pre-signed URL; 404
for unknown ID; 403 for cross-patient access.

### Contract Tests for US2 (Write first — MUST FAIL before implementation)

- [x] T026 [P] [US2] Write contract test `tests/contract/records.test.ts` — GET /v1/records: happy path list (200 + array), empty patient (200 + empty array), record_type filter, pagination cursor round-trip, unauthenticated (401), unauthorized patient (403). GET /v1/records/:id: happy path (200 + download_url), not found (404), unauthorized (403)

### Implementation for US2

- [x] T027 [US2] Extend `src/services/record.service.ts` — add `listRecords({patientId, recordTypeId?, cursor?, limit})`: build cursor-decoded SQL query (created_at + id composite), join record_types, return `{data, next_cursor, has_more}`; add `getRecordById({id, patientId})`: fetch row + call `storage.service.generatePresignedUrl` (86400s TTL)
- [x] T028 [US2] Add to `src/routes/records.ts` — `GET /v1/records`: parse and validate query params (patient_id required, record_type_id UUID optional, cursor string optional, limit 1–100 default 20), enforce auth guard, call `listRecords`; `GET /v1/records/:id`: validate UUID param, enforce auth guard, call `getRecordById`

**Checkpoint**: `npm run test:contract -- --grep records` passes. Follow
quickstart.md US2 steps — list returns uploaded record, single fetch returns
working pre-signed MinIO URL.

---

## Phase 5: User Story 3 — Manage Record Types (Priority: P3)

**Goal**: Any authenticated user can list active record types. Administrators
can add new types and soft-deprecate or re-activate existing ones. Hard
deletion of types referenced by records is blocked.

**Independent Test**: Run `npm run test:contract -- --grep "record-types"`.
Verify seeded catalogue returned on GET; admin POST creates new type (201);
duplicate name returns 409; non-admin POST returns 403; PATCH deprecates
a type; PATCH on type with records blocks hard-delete.

### Contract Tests for US3 (Write first — MUST FAIL before implementation)

- [x] T029 [P] [US3] Write contract test `tests/contract/record-types.test.ts` — GET /v1/record-types: 8 seeded types (200), include_inactive param (admin only), unauthenticated (401). POST /v1/record-types: admin creates (201), duplicate name (409), non-admin (403), missing name (422). PATCH /v1/record-types/:id: admin deprecates (200 + is_active false), admin re-activates (200 + is_active true), non-admin (403), not found (404), hard-delete attempt on referenced type (409)

### Implementation for US3

- [x] T030 [P] [US3] Create `src/services/record-type.service.ts` — `listRecordTypes({includeInactive, callerRole})`: query active types (or all if admin + includeInactive); `createRecordType({name, description})`: case-insensitive duplicate check, insert, return new row; `updateRecordType({id, patch})`: load type, apply `is_active` or `description` patch, block hard-delete if records reference it (check FK constraint or explicit count query)
- [x] T031 [US3] Create `src/routes/record-types.ts` — `GET /v1/record-types` (any authenticated caller), `POST /v1/record-types` (admin only guard), `PATCH /v1/record-types/:id` (admin only guard); validate request bodies with Zod schemas; register plugin in `src/app.ts`

**Checkpoint**: `npm run test:contract -- --grep record-types` passes all
scenarios. Follow quickstart.md US3 steps — seed catalogue visible, new type
added by admin, duplicate rejected.

---

## Phase 6: Integration Tests

**Purpose**: Verify all three user stories work end-to-end against real
PostgreSQL and MinIO. These complement contract tests with full-stack flows.

- [x] T032 [P] Write integration test `tests/integration/upload-and-retrieve.test.ts` — full US1→US2 flow: upload PDF, verify record in DB, list by patient_id, fetch by ID, verify pre-signed URL resolves against MinIO
- [x] T033 [P] Write integration test `tests/integration/record-types.test.ts` — US3 flow: admin creates type, provider uses it in upload, admin deprecates it, upload with deprecated type rejected (409), re-activate, upload succeeds again
- [x] T034 [P] Write integration test `tests/integration/idempotency.test.ts` — upload twice with same Idempotency-Key, verify single DB row; upload with same key after 24h TTL expiry, verify new record created

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, observability, and documentation finishing touches
across all stories.

- [x] T035 [P] Add structured JSON request logging to `src/middleware/` or Fastify hooks — log `request_id` (UUID per request), `method`, `url`, `status`, `duration_ms` on every response
- [x] T036 [P] Add file size limit enforcement in `src/routes/records.ts` POST /v1/upload — reject before streaming if `Content-Length` > 52,428,800 (50 MB); return Problem Details 413
- [x] T037 [P] Add idempotency key expiry cleanup: create migration `src/db/migrations/003_idempotency_key_expiry.ts` adding `idempotency_key_expires_at` column; implement cleanup query in `src/services/record.service.ts` (called on app startup or via scheduled job in a later feature)
- [x] T038 [P] Verify `@fastify/swagger` generates valid OpenAPI 3.1 output matching `contracts/openapi.yaml` — write smoke test in `tests/contract/openapi.test.ts` that fetches `/v1/docs/json` and validates against the committed spec
- [x] T039 [P] Add unit tests in `tests/unit/record.service.test.ts` and `tests/unit/record-type.service.test.ts` — cover cursor encoding/decoding, idempotency collision logic, role authorization guard
- [x] T040 Run quickstart.md validation end-to-end (all steps in order); fix any deviations found
- [x] T041 [P] Update `CLAUDE.md` with final project structure, test commands, and environment setup notes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Requires Phase 1 complete — BLOCKS all user stories
- **Phase 3 (US1 Upload)**: Requires Phase 2 complete — MVP deliverable
- **Phase 4 (US2 Retrieve)**: Requires Phase 2 complete — can start in parallel with US1 after Phase 2
- **Phase 5 (US3 Record Types)**: Requires Phase 2 complete — can start in parallel with US1/US2
- **Phase 6 (Integration)**: Requires Phase 3 + Phase 4 + Phase 5 complete
- **Phase 7 (Polish)**: Requires Phase 6 complete (or can begin incrementally)

### User Story Dependencies

- **US1 (P1)**: No dependency on US2 or US3 — independently testable
- **US2 (P2)**: Independent of US1 at implementation level; integration tests use US1 data
- **US3 (P3)**: Fully independent — record types are reference data

### Within Each User Story

- Contract tests (T021, T026, T029) MUST be written and confirmed **failing** before any implementation in that phase begins
- Models/types (T014) before services
- Services (T022, T027, T030) before route handlers
- Route handlers before integration

### Parallel Opportunities

```bash
# Phase 1 — run all [P] tasks together after T001/T004:
T002, T003, T005, T006, T007  (independent installs/configs)

# Phase 2 — after T009/T010 migrations:
T014, T015, T019, T020  (types, middleware, scripts, storage service)

# Phase 3–5 — after Phase 2:
T021 (US1 contract tests)  →  T022, T023, T024, T025
T026 (US2 contract tests)  →  T027, T028
T029 (US3 contract tests)  →  T030, T031
# US1, US2, US3 can all proceed in parallel on separate branches

# Phase 6 — after all stories:
T032, T033, T034  (independent integration test files)

# Phase 7:
T035, T036, T037, T038, T039, T041  (all independent polish tasks)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks everything)
3. Write T021 contract tests, confirm they FAIL
4. Complete Phase 3: US1 Upload
5. **STOP and VALIDATE**: `npm run test:contract -- --grep upload` all pass; curl upload works

### Incremental Delivery

1. Setup + Foundational → infra ready
2. US1 Upload → MVP: records can be stored ✅
3. US2 Retrieve → records can be fetched ✅
4. US3 Record Types → catalogue is manageable ✅
5. Integration + Polish → production-ready ✅

### Parallel Team Strategy

With multiple developers, after Phase 2 completes:
- **Dev A**: Phase 3 (US1 Upload)
- **Dev B**: Phase 4 (US2 Retrieve) — uses seeded test data
- **Dev C**: Phase 5 (US3 Record Types)

---

## Notes

- [P] tasks have no file conflicts and no dependencies on incomplete tasks
- [US*] labels trace each task to its user story for independent delivery
- Contract tests MUST be red before implementation (TDD, constitution Principle III)
- Integration tests use real Docker services — no mocking the DB or MinIO
- Commit after each phase checkpoint, not after individual tasks
- Each story phase should be demo-able independently before moving to the next
