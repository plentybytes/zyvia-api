# Research: Health Records Digitalization API

**Feature**: 001-health-records-api
**Date**: 2026-04-03

---

## Decision 1: Language & Runtime

**Decision**: Node.js 20 LTS + TypeScript 5.4

**Rationale**:
- Excellent async I/O performance for file upload/download operations
- TypeScript gives compile-time safety for domain objects and API contracts
- Largest ecosystem of HTTP, JWT, and cloud-storage libraries
- LTS release guarantees support through 2026

**Alternatives considered**:
- Python/FastAPI — strong for data-heavy services; slower cold starts; less
  idiomatic for streaming file uploads at this scale
- Go/Gin — best raw throughput; smaller team familiarity assumed; stronger
  choice if throughput targets exceed 10k req/s (out of scope for v1)
- Java/Spring Boot — enterprise-grade; heavier runtime footprint;
  overkill for v1 scope

---

## Decision 2: HTTP Framework

**Decision**: Fastify 4

**Rationale**:
- Native JSON schema validation on every route (aligns with Contract-First
  principle — schema is the single source of truth)
- Built-in OpenAPI/Swagger plugin (`@fastify/swagger`) generates spec from
  route schemas, keeping code and contract in sync
- Benchmarks consistently faster than Express for JSON-heavy workloads
- `@fastify/multipart` handles streaming multipart uploads without buffering
  entire file in memory

**Alternatives considered**:
- Express 5 — ubiquitous; no built-in schema validation; requires separate
  OpenAPI tooling; less ergonomic for TypeScript
- Hono — ultra-light; good edge-runtime story; plugin ecosystem still maturing

---

## Decision 3: Database

**Decision**: PostgreSQL 16

**Rationale**:
- ACID compliance is non-negotiable for health record metadata (FR-006
  requires zero data loss for completed uploads)
- JSONB support for extensible metadata fields without schema migrations
- Native UUID support for record IDs
- `pg_trgm` extension enables full-text search on file names if needed later
- Knex provides type-safe migrations and a query builder without the overhead
  of a full ORM

**Alternatives considered**:
- MySQL 8 — viable; weaker JSON support; less familiar tooling in Node.js
  ecosystem
- MongoDB — flexible schema appealing for health data variety; lacks
  transactions across collections; harder to enforce referential integrity
  between records and record types

---

## Decision 4: File Storage

**Decision**: S3-compatible object store (AWS S3 in production; MinIO for
local development and integration tests)

**Rationale**:
- Binary health record files must never live in the relational DB (FR-003
  enforces 50 MB limit; DB storage would be expensive and slow)
- S3 pre-signed URLs fulfill the time-limited download link requirement
  (FR-007) without proxying file bytes through the API
- `@aws-sdk/client-s3` supports both AWS S3 and any S3-compatible endpoint
  (MinIO, Cloudflare R2), keeping local and production environments symmetric
- Server-side encryption (SSE-S3 or SSE-KMS) at rest handled by the store,
  not the application

**Alternatives considered**:
- Local filesystem — not suitable for production (no redundancy, no
  pre-signed URLs)
- Google Cloud Storage — viable; different SDK; no benefit vs S3 API for v1

---

## Decision 5: Authentication & Authorization

**Decision**: JWT bearer tokens (RS256); role claim in token payload;
  no session state in service

**Rationale**:
- Identity provider issues tokens; this service only verifies them
  (assumption in spec — auth is external)
- RS256 (asymmetric) means the public key can be embedded; no shared-secret
  distribution problem
- Role (`patient` | `provider` | `administrator`) in standard JWT claim
  `role`; patient's own ID in `sub` claim
- `@fastify/jwt` supports JWKS URI for automatic public-key rotation

**Pattern for patient-scoped access**:
- Middleware extracts `sub` (patient_id for patient role) and `role`
- Route handler enforces: patients → `patient_id === token.sub`;
  providers → patient must be in their care list (simplified for v1:
  providers can access any patient; care-scope enforcement is a Phase 2
  enhancement)

---

## Decision 6: Idempotency Key

**Decision**: `Idempotency-Key` header stored in the `health_records` table;
  database unique index on `(idempotency_key)` where not null

**Rationale**:
- Simplest correct implementation: on duplicate key violation, query and
  return the existing record (HTTP 200)
- No additional cache layer needed for v1 scale
- Keys expire after 24 hours (matching download link TTL) to prevent
  unbounded growth; a background job or DB TTL column handles cleanup

---

## Decision 7: Pagination

**Decision**: Cursor-based pagination using `created_at + id` composite
cursor, URL-safe base64-encoded

**Rationale**:
- Offset pagination degrades at high page numbers on large tables
- Cursor is stable under concurrent inserts (medical records are append-only)
- `id` tiebreaker handles records created in the same millisecond
- Response envelope: `{ data: [...], next_cursor: "...", has_more: bool }`

---

## Decision 8: DICOM File Handling

**Decision**: Accept DICOM files by MIME type validation (`application/dicom`)
and file extension (`.dcm`); store as-is without parsing; no DICOM viewer in
scope for v1

**Rationale**:
- Full DICOM parsing (patient demographics, study metadata) requires
  specialized libraries and is out of scope for v1
- Storing the raw file still satisfies FR-001 and FR-002
- A future feature can add DICOM metadata extraction as a post-upload hook

---

## Decision 9: Error Response Format

**Decision**: RFC 7807 Problem Details for all error responses

**Rationale**: Required by FR-013 and the API Standards section of the
constitution. Fastify's error handler will be wrapped to produce:

```json
{
  "type": "https://zyvia.api/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "file_type must be one of: pdf, jpeg, png, dicom",
  "instance": "/v1/upload"
}
```

---

## All NEEDS CLARIFICATION items resolved

| Item | Resolution |
|------|------------|
| Language/runtime | Node.js 20 LTS + TypeScript 5.4 |
| Framework | Fastify 4 |
| Database | PostgreSQL 16 + Knex |
| File storage | S3-compatible (AWS S3 / MinIO) |
| Auth | JWT RS256, external IdP |
| Idempotency | DB unique index on idempotency_key |
| Pagination | Cursor-based (created_at + id) |
| DICOM | Store as-is, no parsing in v1 |
| Error format | RFC 7807 Problem Details |
