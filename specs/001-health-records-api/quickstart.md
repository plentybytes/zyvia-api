# Quickstart: Health Records Digitalization API

**Feature**: 001-health-records-api
**Date**: 2026-04-03

Use this guide to run the service locally and validate all three user stories
end-to-end.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20 LTS | Runtime |
| npm | 10+ | Package management |
| Docker & Docker Compose | 24+ | Local PostgreSQL + MinIO |
| curl / httpie | any | Manual endpoint testing |

---

## 1. Start Local Infrastructure

```bash
docker compose up -d
```

This starts:
- **PostgreSQL 16** on `localhost:5432` (db: `zyvia`, user: `zyvia`, pass: `zyvia`)
- **MinIO** (S3-compatible) on `localhost:9000` (API) + `localhost:9001` (console)

---

## 2. Install Dependencies

```bash
npm install
```

---

## 3. Configure Environment

Copy the example env file and adjust if needed:

```bash
cp .env.example .env
```

Minimum required values (`.env.example` ships with these defaults):

```
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://zyvia:zyvia@localhost:5432/zyvia

OBJECT_STORE_ENDPOINT=http://localhost:9000
OBJECT_STORE_BUCKET=health-records
OBJECT_STORE_ACCESS_KEY=minioadmin
OBJECT_STORE_SECRET_KEY=minioadmin

JWT_PUBLIC_KEY_PATH=./keys/dev-public.pem
```

---

## 4. Run Migrations & Seed Data

```bash
npm run db:migrate
npm run db:seed
```

This applies all Knex migrations and seeds the 8 default record types.

---

## 5. Start the Service

```bash
npm run dev
```

Service starts at `http://localhost:3000`. OpenAPI docs available at
`http://localhost:3000/v1/docs`.

---

## 6. Validate Each User Story

### US1 — Upload a Health Record

Generate a test JWT for a provider (dev helper script):

```bash
npm run dev:token -- --role provider --sub provider-001
# Prints: Bearer eyJ...
```

Upload a PDF:

```bash
curl -X POST http://localhost:3000/v1/upload \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Idempotency-Key: test-key-001" \
  -F "patient_id=patient-abc-123" \
  -F "record_type_id=<LAB_RESULT_UUID>" \
  -F "file=@/path/to/test.pdf"
```

Expected response (HTTP 201):
```json
{
  "id": "<uuid>",
  "created_at": "2026-04-03T10:00:00.000Z"
}
```

Retry the same request with the same `Idempotency-Key` → expect HTTP 200
with the same `id`.

---

### US2 — Retrieve Health Records

List records for the patient:

```bash
curl http://localhost:3000/v1/records?patient_id=patient-abc-123 \
  -H "Authorization: Bearer <TOKEN>"
```

Expected response (HTTP 200):
```json
{
  "data": [{ "id": "...", "file_name": "test.pdf", ... }],
  "next_cursor": null,
  "has_more": false
}
```

Get the individual record with download link:

```bash
curl http://localhost:3000/v1/records/<RECORD_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

Expected: `download_url` is a pre-signed MinIO URL expiring in 24 h.

---

### US3 — Manage Record Types

List all record types (any authenticated user):

```bash
curl http://localhost:3000/v1/record-types \
  -H "Authorization: Bearer <TOKEN>"
```

Expected: array of 8 seeded record types.

Add a new type (admin only):

```bash
npm run dev:token -- --role administrator --sub admin-001
# Use admin TOKEN below

curl -X POST http://localhost:3000/v1/record-types \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Mental Health Note","description":"Psychiatric and psychological assessment records"}'
```

Expected response (HTTP 201):
```json
{
  "id": "<uuid>",
  "name": "Mental Health Note",
  "description": "Psychiatric and psychological assessment records",
  "is_active": true,
  "created_at": "..."
}
```

Attempt duplicate → expect HTTP 409.

---

## 7. Run Tests

```bash
# All tests
npm test

# Contract tests only (verify OpenAPI conformance)
npm run test:contract

# Integration tests (requires running Docker infra)
npm run test:integration

# Unit tests only
npm run test:unit
```

---

## 8. Verify Observability

Check structured logs (JSON output on stdout):

```bash
npm run dev 2>&1 | jq '.request_id, .status, .duration_ms'
```

Check health endpoints:

```bash
curl http://localhost:3000/v1/health   # → {"status":"ok"}
curl http://localhost:3000/v1/ready    # → {"status":"ok"} (or 503 if DB down)
```

---

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `ECONNREFUSED 5432` | PostgreSQL not running | `docker compose up -d postgres` |
| `NoSuchBucket` from MinIO | Bucket not created | `npm run db:seed` creates the bucket |
| `JWT verification failed` | Dev key mismatch | Ensure `JWT_PUBLIC_KEY_PATH` points to the key used by `dev:token` |
| Upload returns 413 | File > 50 MB | Use a smaller test file |
