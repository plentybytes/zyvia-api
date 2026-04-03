# zyvia-api Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-03

## Active Technologies

- Node.js 20 LTS, TypeScript 5.4 + Fastify 4 (HTTP), @fastify/multipart (file upload), (001-health-records-api)

## Project Structure

```text
src/
├── config/index.ts          # Zod-validated env vars
├── db/
│   ├── connection.ts        # Knex client
│   ├── knexfile.ts          # Knex config
│   ├── migrations/          # 001_record_types, 002_health_records
│   └── seeds/               # 001_record_types (8 defaults)
├── middleware/
│   ├── auth.ts              # JWT verify, requireAuth, requireAdmin, assertPatientAccess
│   └── error-handler.ts     # RFC 7807 Problem Details
├── models/
│   ├── health-record.ts     # HealthRecord types + cursor encode/decode
│   └── record-type.ts       # RecordType types
├── routes/
│   ├── health.ts            # GET /v1/health, GET /v1/ready
│   ├── records.ts           # POST /v1/upload, GET /v1/records, GET /v1/records/:id
│   └── record-types.ts      # GET/POST /v1/record-types, PATCH /v1/record-types/:id
├── services/
│   ├── record.service.ts    # createRecord, listRecords, getRecordById
│   ├── record-type.service.ts
│   └── storage.service.ts   # S3/MinIO wrapper + presigned URLs
└── app.ts                   # Fastify bootstrap
tests/
├── contract/                # HTTP-level tests (mocked services)
├── integration/             # Real DB + MinIO tests
└── unit/                    # Pure logic tests
scripts/
└── dev-token.ts             # Generate dev JWT (npm run dev:token -- --role provider --sub id)
```

## Commands

```bash
npm run dev              # Start dev server (port 3000)
npm test                 # All tests
npm run test:unit        # Unit tests only (no Docker needed)
npm run test:contract    # Contract/HTTP tests (no Docker needed)
npm run test:integration # Integration tests (requires docker compose up -d)
npm run db:migrate       # Run Knex migrations
npm run db:seed          # Seed 8 default record types
npm run dev:token -- --generate-keys  # Generate dev RSA key pair
npm run dev:token -- --role provider --sub id  # Get test JWT
npm run lint             # ESLint
```

## Environment Setup

1. `cp .env.example .env`
2. `docker compose up -d`
3. `npm run dev:token -- --generate-keys`
4. `npm run db:migrate && npm run db:seed`
5. `npm run dev`

## Code Style

Node.js 20 LTS, TypeScript 5.4 + Fastify 4: strict TypeScript, no `any`,
RFC 7807 errors throughout, JWT RS256 auth, S3-compatible storage

## Recent Changes

- 001-health-records-api: Added Node.js 20 LTS, TypeScript 5.4 + Fastify 4 (HTTP), @fastify/multipart (file upload),

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
