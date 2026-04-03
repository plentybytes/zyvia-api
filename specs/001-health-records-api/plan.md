# Implementation Plan: Health Records Digitalization API

**Branch**: `001-health-records-api` | **Date**: 2026-04-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-health-records-api/spec.md`

## Summary

Build a REST API that allows patients, healthcare providers, and administrators
to digitally manage health records. Patients and providers can upload files
(PDF, JPEG, PNG, DICOM ≤ 50 MB) and retrieve records for authorized patients;
administrators manage the record type catalogue. The API enforces role-scoped
authorization via JWT bearer tokens, uses an object store for binary file
storage, and exposes a contract-first OpenAPI surface. The stack is Node.js 20
+ TypeScript 5 + Fastify 4, backed by PostgreSQL 16 for metadata and an
S3-compatible object store for files.

## Technical Context

**Language/Version**: Node.js 20 LTS, TypeScript 5.4
**Primary Dependencies**: Fastify 4 (HTTP), @fastify/multipart (file upload),
  @fastify/jwt (JWT verification), @fastify/swagger (OpenAPI generation),
  Zod (schema validation), @aws-sdk/client-s3 (object store), Knex (query
  builder + migrations)
**Storage**: PostgreSQL 16 (record metadata + record types), S3-compatible
  object store (file binaries)
**Testing**: Vitest (unit + integration), supertest (contract/HTTP tests)
**Target Platform**: Linux server (Docker container, 64-bit)
**Project Type**: Web service / REST API
**Performance Goals**: 95th-percentile upload ≤ 5 s for files ≤ 10 MB;
  list/get responses ≤ 2 s for patients with ≤ 1,000 records
**Constraints**: Files ≤ 50 MB; time-limited download links ≤ 24 h; JWT-based
  auth (no session state in service); RFC 7807 error format throughout
**Scale/Scope**: Initial target ~1,000 concurrent users; single-region
  deployment for v1

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. API-First Design | All capabilities exposed as versioned REST endpoints under `/v1/`; no business logic callable outside the API | ✅ PASS |
| II. Contract-First Development | OpenAPI spec authored in Phase 1 before any service code; contract tests will verify runtime conformance | ✅ PASS |
| III. Test-First | TDD enforced: contract tests written first, confirmed failing, then implementation; unit tests cover services; integration tests hit real DB | ✅ PASS |
| IV. Security by Default | JWT auth on all endpoints; role-based access (patient/provider/admin); schema validation at boundary via Zod; secrets via env vars | ✅ PASS |
| V. Observability & Simplicity | Structured JSON logging on every request (request_id, status, duration_ms); `/v1/health` and `/v1/ready` endpoints; YAGNI applied — no extra abstractions | ✅ PASS |

**Post-design re-check**: See bottom of Phase 1 — all gates still pass after
contract design.

## Project Structure

### Documentation (this feature)

```text
specs/001-health-records-api/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── openapi.yaml     # Phase 1 output — full OpenAPI 3.1 spec
└── tasks.md             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── config/              # Environment config, constants
├── db/
│   ├── migrations/      # Knex migration files
│   └── seeds/           # Record type seed data
├── models/              # TypeScript types / domain objects
├── routes/
│   ├── health.ts        # GET /v1/health, GET /v1/ready
│   ├── records.ts       # POST /v1/upload, GET /v1/records, GET /v1/records/:id
│   └── record-types.ts  # GET /v1/record-types, POST /v1/record-types
├── services/
│   ├── record.service.ts
│   ├── record-type.service.ts
│   └── storage.service.ts   # Object store abstraction
├── middleware/
│   ├── auth.ts          # JWT verification + role extraction
│   └── error-handler.ts # RFC 7807 Problem Details formatter
└── app.ts               # Fastify instance bootstrap

tests/
├── contract/            # HTTP-level tests verifying OpenAPI conformance
├── integration/         # Tests hitting real PostgreSQL + local S3 (MinIO)
└── unit/                # Pure logic tests (services, validators)
```

**Structure Decision**: Single-project layout. No frontend; no mobile client
in scope for v1. All source under `src/`; tests mirror the structure.

## Complexity Tracking

> No constitution violations — table not required.
