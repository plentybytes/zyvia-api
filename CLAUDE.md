# zyvia-api Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-05

## Active Technologies
- TypeScript 5.4 (CDK infrastructure code); Node.js 20 LTS + aws-cdk-lib ^2.140, constructs ^10, (002-aws-ecs-deployment)
- RDS PostgreSQL 16 (db.t4g.medium, single-AZ v1); (002-aws-ecs-deployment)
- Node.js 20 LTS, TypeScript 5.4 + Fastify 4 (HTTP), @fastify/multipart (file upload), (001-health-records-api)
- argon2 (argon2id password hashing), @anthropic-ai/sdk (Claude claude-sonnet-4-6 AI), (001-user-auth-medical-profile)
- TypeScript 5.5 / Node.js 20 LTS + Fastify 4.28, Knex 3.1, Zod 3.23, @fastify/jwt (existing — no new dependencies) (003-user-docs-integration)
- PostgreSQL 16 — no schema changes (003-user-docs-integration)

## Project Structure

```text
src/
├── config/index.ts          # Zod-validated env vars
├── db/
│   ├── connection.ts        # Knex client
│   ├── knexfile.ts          # Knex config
│   ├── migrations/          # 001_record_types, 002_health_records, 003_users, 004_health_profiles, 005_refresh_tokens, 006_medical_queries
│   └── seeds/               # 001_record_types (8 defaults)
├── middleware/
│   ├── auth.ts              # JWT verify, requireAuth, requireAdmin, assertPatientAccess
│   └── error-handler.ts     # RFC 7807 Problem Details
├── models/
│   ├── health-record.ts     # HealthRecord types + cursor encode/decode
│   ├── record-type.ts       # RecordType types
│   ├── user.ts              # User, UserPublic, UserRole
│   ├── health-profile.ts    # HealthProfile, HealthProfileWithBmi
│   └── medical-query.ts     # MedicalQuery, AiMedicalResponse, MedicalQueryWithResponse
├── routes/
│   ├── health.ts            # GET /v1/health, GET /v1/ready
│   ├── records.ts           # POST /v1/upload, GET /v1/records, GET /v1/records/:id
│   ├── record-types.ts      # GET/POST /v1/record-types, PATCH /v1/record-types/:id
│   ├── auth.ts              # POST /v1/auth/register|login|refresh|logout
│   ├── profile.ts           # GET/PATCH /v1/profile
│   └── medical.ts           # POST /v1/medical/query
├── services/
│   ├── record.service.ts    # createRecord, listRecords, getRecordById
│   ├── record-type.service.ts
│   ├── storage.service.ts   # S3/MinIO wrapper + presigned URLs
│   ├── auth.service.ts      # registerUser, verifyCredentials, token management
│   ├── health-profile.service.ts  # getProfile, updateProfile
│   ├── medical.service.ts   # submitQuery
│   └── ai.service.ts        # generateMedicalResponse (Claude API)
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

## Environment Variables (Required)

- `ANTHROPIC_API_KEY` — Required for AI medical responses (set in `.env`)
- `JWT_PRIVATE_KEY_PATH` — Required for token signing (was optional, now mandatory)

## Recent Changes
- 003-user-docs-integration: Added TypeScript 5.5 / Node.js 20 LTS + Fastify 4.28, Knex 3.1, Zod 3.23, @fastify/jwt (existing — no new dependencies)
- 001-user-auth-medical-profile: Added argon2, @anthropic-ai/sdk; auth routes (/v1/auth/*), profile (/v1/profile), medical (/v1/medical/query); migrations 003–006
- 002-aws-ecs-deployment: Added TypeScript 5.4 (CDK infrastructure code); Node.js 20 LTS + aws-cdk-lib ^2.140, constructs ^10,

<!-- MANUAL ADDITIONS START -->
## Patient Identity Auto-Linking (003-user-docs-integration)

- `POST /v1/upload`: For `patient` role, `patient_id` is derived from JWT `sub` automatically — do NOT pass `patient_id` in form data. For `provider` role, `patient_id` is still required as a form field.
- `GET /v1/records`: For `patient` role, `patient_id` query param is optional and silently ignored if provided — always scoped to JWT `sub`. For `provider` role, `patient_id` is still required as a query param (422 if missing).
- `GET /v1/records/:id`: No change — was already correctly scoped by JWT `sub` for patients.
<!-- MANUAL ADDITIONS END -->
