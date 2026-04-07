# Implementation Plan: User Identity Integration with Health Record Document Storage

**Branch**: `003-user-docs-integration` | **Date**: 2026-04-05 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `zyvia-api/specs/003-user-docs-integration/spec.md`

## Summary

Wire the new user registration/auth system (feature 001) into the existing health record document routes. Today the upload and list endpoints require the client to pass a `patient_id` explicitly. After this change, `patient`-role users get their `patient_id` derived automatically from their JWT (`request.user.sub`). No new database tables, no new migrations — this is a focused behaviour change to two existing route handlers in `zyvia-api/src/routes/records.ts`.

## Technical Context

**Language/Version**: TypeScript 5.5 / Node.js 20 LTS  
**Primary Dependencies**: Fastify 4.28, Knex 3.1, Zod 3.23, @fastify/jwt (existing — no new dependencies)  
**Storage**: PostgreSQL 16 — no schema changes  
**Testing**: Vitest 2.0 — unit / contract / integration  
**Target Platform**: REST API (existing)  
**Project Type**: web-service  
**Performance Goals**: No change from existing targets  
**Constraints**: Backward compatible for `provider`-role callers who still pass `patient_id`; `patient`-role callers must not need to pass it  
**Scale/Scope**: Route-level change only — no new tables, no new services

## Constitution Check

Constitution file is an unfilled template — no project-specific gates defined. No violations.

## Project Structure

### Documentation (this feature)

```text
zyvia-api/specs/003-user-docs-integration/
├── plan.md              # This file
├── research.md          # Technical decisions (Phase 0)
├── data-model.md        # Entity context (no new entities)
├── contracts/           # Updated API contracts
│   ├── upload.md
│   ├── list-records.md
│   └── get-record.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code

```text
zyvia-api/
└── src/
    └── routes/
        └── records.ts    # MODIFY: derive patient_id from JWT for patient role
tests/
└── contract/
    └── records.test.ts   # MODIFY: update/add tests for new patient flow
```

**Structure Decision**: No new files required. Single targeted modification to `routes/records.ts` + test updates.

## Complexity Tracking

> No Constitution violations to justify.
