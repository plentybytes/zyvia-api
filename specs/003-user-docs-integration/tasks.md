# Tasks: User Identity Integration with Health Record Document Storage

**Input**: Design documents from `zyvia-api/specs/003-user-docs-integration/`  
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Organization**: Tasks are grouped by user story. This is a targeted change — the entire implementation fits in one existing file (`routes/records.ts`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup

**Purpose**: No new dependencies or migrations needed. Confirm understanding of existing route before modifying.

- [x] T001 Read `zyvia-api/src/routes/records.ts` in full and confirm: (1) `POST /v1/upload` requires `patient_id` as a form field today; (2) `GET /v1/records` requires `patient_id` as a query param today; (3) `GET /v1/records/:id` already uses `request.user.sub` for patient access control

**Checkpoint**: Clear understanding of current `patient_id` handling before making changes

---

## Phase 2: Foundational (Blocking Prerequisites)

No foundational work needed — no new tables, no new models, no new services. Proceed directly to user story implementation.

---

## Phase 3: User Story 1 — Registered User Uploads a Health Document (Priority: P1) 🎯 MVP

**Goal**: A `patient`-role user can call `POST /v1/upload` without providing a `patient_id` form field. Their registered identity (JWT `sub`) is automatically used as the document owner.

**Independent Test**: Register a user → login → call `POST /v1/upload` with a valid file and `record_type_id` but NO `patient_id` field → verify 201 response and document appears in `GET /v1/records`.

### Implementation

- [x] T002 [US1] Modify `POST /v1/upload` in `zyvia-api/src/routes/records.ts`: remove `patient_id` from required form field validation; after parsing fields, add role-based logic — if `request.user.role === 'patient'`, set `patientId = request.user.sub` (ignore any form-supplied `patient_id`); if `request.user.role === 'provider'`, use `fields.patient_id?.value` as before (still required, still UUID-validated); pass the derived `patientId` to `recordService.createRecord()`
- [x] T003 [US1] Write contract test in `zyvia-api/tests/contract/records.test.ts` (create if missing) — test: patient calls `POST /v1/upload` without `patient_id` field → 201; test: patient calls `POST /v1/upload` with a `patient_id` field that differs from their JWT sub → 201, but the stored `patient_id` equals JWT sub (not the form value)

**Checkpoint**: A registered patient can upload a document with no patient_id in the form. The document is owned by their account.

---

## Phase 4: User Story 2 — Registered User Views Their Document List (Priority: P2)

**Goal**: A `patient`-role user can call `GET /v1/records` with no query parameters and receive their own document list. The `patient_id` query param is optional for patients and automatically derived from their JWT.

**Independent Test**: Login as a patient → call `GET /v1/records` with no query params → verify only that user's documents are returned and response is 200 (not 422).

### Implementation

- [x] T004 [US2] Modify `GET /v1/records` in `zyvia-api/src/routes/records.ts`: update `ListQuerySchema` to make `patient_id` optional (`z.string().min(1).max(255).optional()`); after parsing, add role-based logic — if `request.user.role === 'patient'`, set `patient_id = request.user.sub` (ignore any query-supplied `patient_id`); if `request.user.role === 'provider'`, require `patient_id` — if not supplied by a provider, return 422 `"patient_id is required for provider role"`; pass derived `patient_id` to `recordService.listRecords()`; remove the now-unnecessary `assertPatientAccess` call (patients are always scoped to their own JWT sub, providers can list any patient's records)
- [x] T005 [US2] Add contract tests in `zyvia-api/tests/contract/records.test.ts` — test: patient calls `GET /v1/records` with no query params → 200 with data array; test: patient calls `GET /v1/records?patient_id=other-uuid` → 200 but results scoped to JWT sub, not the supplied param; test: provider calls `GET /v1/records` with no `patient_id` → 422; test: empty document list returns `{"data": [], "next_cursor": null, "has_more": false}` and not an error

**Checkpoint**: Patients can list their own documents with zero query params. Providers still require `patient_id`.

---

## Phase 5: User Story 3 — Registered User Views a Specific Document (Priority: P3)

**Goal**: Verify `GET /v1/records/:id` already correctly scopes access by JWT sub for patients. No code change expected — this phase confirms the existing implementation satisfies the user story.

**Independent Test**: Upload a document as Patient A → login as Patient B → attempt `GET /v1/records/:id` with Patient A's document ID → verify 404 (not 403, to prevent ID enumeration).

### Implementation

- [x] T006 [US3] Read `zyvia-api/src/routes/records.ts` `GET /v1/records/:id` handler and `zyvia-api/src/services/record.service.ts` `getRecordById()` — confirm: for `patient` role, `patientId = request.user.sub` is passed; `getRecordById` returns 404 when `row.patient_id !== patientId`; if these are already correct, no code change needed — document verification result in a code comment

**Checkpoint**: Cross-user document access is blocked. GET /v1/records/:id behaviour confirmed correct.

---

## Phase 6: User Story 4 — Idempotent Upload (Priority: P4)

**Goal**: Verify that idempotent uploads work with the new patient identity flow (same file, same idempotency key, same patient → one record created). No code change expected — this phase confirms `Idempotency-Key` header still works end-to-end.

**Independent Test**: Login as patient → upload with `Idempotency-Key: test-key-1` → upload same file again with `Idempotency-Key: test-key-1` → verify second call returns 200 (not 201) with the same record ID.

### Implementation

- [x] T007 [US4] Add contract test in `zyvia-api/tests/contract/records.test.ts` — test: patient uploads with `Idempotency-Key: abc` → 201; same patient uploads same file with `Idempotency-Key: abc` again → 200 with same `id`; confirm `isIdempotentDuplicate` logic in service still works with auto-derived `patientId`

**Checkpoint**: Idempotent upload works correctly with the auto-derived patient identity.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T008 [P] Run `npm run test:unit` in `zyvia-api/` and verify all existing unit tests still pass after route changes
- [x] T009 [P] Run TypeScript check `npx tsc --noEmit` in `zyvia-api/` and resolve any type errors from route modifications
- [x] T010 Update `zyvia-api/CLAUDE.md` — add note: `POST /v1/upload` and `GET /v1/records` auto-derive `patient_id` from JWT for `patient` role; `patient_id` is only required in request for `provider` role

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **US1 (Phase 3)**: Depends on Phase 1 confirmation
- **US2 (Phase 4)**: Depends on Phase 3 (both modify `records.ts` — must be sequential)
- **US3 (Phase 5)**: Depends on Phase 4 (read-only verification — can follow US2)
- **US4 (Phase 6)**: Can run after Phase 3 (uses upload endpoint)
- **Polish (Phase 7)**: Depends on Phases 3–6

### Critical Sequencing Note

T002 and T004 both modify `zyvia-api/src/routes/records.ts`. They **must run sequentially** — complete T002 (upload change) before starting T004 (list change). They touch different route handlers within the same file.

### Parallel Opportunities

- T003 and T004 can overlap if the developer writes the test while another starts the list change
- T008 and T009 can run in parallel in Phase 7

---

## Parallel Example: Phase 7 (Polish)

```
# Launch in parallel after all story phases complete:
T008: npm run test:unit
T009: npx tsc --noEmit
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Read and understand records.ts (T001)
2. Complete Phase 3: Modify upload route (T002) + add test (T003)
3. **STOP and VALIDATE**: Patient can upload without patient_id form field — this is the most impactful change
4. Continue to Phase 4 for list scoping

### Incremental Delivery

1. T001 → Understand current code
2. T002 → Upload auto-linking (patient_id no longer needed in form)
3. T003 → Verify upload change with contract test
4. T004 → List auto-scoping (patient_id no longer needed in query)
5. T005 → Verify list change with contract tests
6. T006 → Confirm record detail already works
7. T007 → Confirm idempotency still works
8. T008, T009 → Clean build and tests

---

## Notes

- **[P]** tasks = different concerns, safe to run in parallel
- T002 and T004 are in the same file — do not run concurrently
- US3 and US4 are verification-only — likely no code changes needed
- Total estimated code change: ~20 lines in `records.ts`, ~40 lines of new tests
