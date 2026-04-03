<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.1.0
Modified principles: none renamed
Added sections:
  - API Standards / Tech Stack entry filled (was TODO(TECH_STACK))
  - Deployment & Infrastructure (new section)
Removed sections: none
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ Constitution Check gates remain valid; no edits required
  - .specify/templates/spec-template.md ✅ No new mandatory sections introduced
  - .specify/templates/tasks-template.md ✅ Phase structure unaffected
  - .specify/templates/constitution-template.md ✅ Source template; not modified
  - CLAUDE.md ✅ Already reflects correct tech stack and structure
Follow-up TODOs:
  - TODO(RATIFICATION_DATE): Retained from v1.0.0. Update if formal team
    ratification occurs at a different date than 2026-04-03.
  - Deployment section documents ECS Fargate as the chosen target; a
    Dockerfile and CDK/Terraform IaC spec should be added in a follow-up
    feature to make this enforceable in CI.
-->

# Zyvia API Constitution

## Core Principles

### I. API-First Design

Every feature MUST be expressed as a first-class API contract before any
implementation begins. The API surface (endpoints, request/response shapes,
error codes) is the product; the implementation is an internal detail.

- All new capabilities MUST be exposed through versioned API endpoints.
- Breaking changes to any public endpoint MUST increment the API major version.
- Internal-only helpers that do not surface through the API MUST NOT be
  part of the public contract documentation.

**Rationale**: Treating the API as the primary deliverable keeps the team
aligned on consumer-facing behaviour and prevents internal implementation
details from leaking into the public surface.

### II. Contract-First Development

Schema and contract documents (OpenAPI / JSON Schema) MUST be authored and
reviewed before any service code is written.

- Every endpoint MUST have a corresponding OpenAPI definition committed to
  the repository.
- Request validation MUST be derived from the schema, not hand-rolled logic.
- Contract tests MUST verify that the running service matches the committed
  schema.

**Rationale**: Writing the contract first surfaces design issues cheaply,
enables parallel frontend/client development, and makes regression detection
mechanical rather than ad-hoc.

### III. Test-First (NON-NEGOTIABLE)

TDD is mandatory. The Red-Green-Refactor cycle MUST be enforced on every
feature and bug fix.

- Tests MUST be written and confirmed failing before implementation begins.
- A feature is not done until all acceptance scenarios in the spec pass.
- Unit tests cover logic; contract tests cover API shape; integration tests
  cover end-to-end flows against real infrastructure (no mocking the DB or
  external services in integration tests).
- Test coverage MUST NOT regress below the project-agreed threshold
  (default: 80 % line coverage until overridden in `init-options.json`).

**Rationale**: Tests written after the fact tend to confirm the code as
written rather than verify the intended behaviour. Upfront tests are the
only reliable specification of correctness.

### IV. Security by Default

Security controls MUST be applied at design time, not bolted on after
delivery.

- Authentication MUST be required on all endpoints except those explicitly
  documented as public.
- All user-supplied input MUST be validated against the OpenAPI schema at
  the API boundary before reaching business logic.
- Secrets MUST never be committed to the repository; use environment
  variables or a secrets manager (AWS Secrets Manager in production).
- Dependencies MUST be pinned and audited for known CVEs before merging.

**Rationale**: An API is a public attack surface. Security retrofits are
expensive and often incomplete; embedding security in every design decision
keeps the attack surface minimal by default.

### V. Observability & Simplicity

Every production code path MUST be observable, and complexity MUST be
justified.

- Structured JSON logging MUST be emitted for all requests, errors, and
  significant state changes (include `request_id`, `status`, `duration_ms`).
- Health and readiness endpoints (`/v1/health`, `/v1/ready`) MUST be
  implemented on every service and MUST be wired to the load balancer
  health check.
- YAGNI applies: implement the simplest solution that satisfies the spec.
  Abstractions that serve only hypothetical future requirements are
  prohibited.
- Every deviation from simplicity MUST be justified in the plan's
  Complexity Tracking table.

**Rationale**: Systems that cannot be observed cannot be debugged in
production. Premature abstraction creates accidental complexity that slows
every subsequent change.

## API Standards

These constraints govern how the Zyvia API is built and versioned.
They supplement the Core Principles with concrete technical rules.

- **Versioning**: URL-based versioning (`/v1/`, `/v2/`) MUST be used.
  Header-based versioning is not permitted (discoverability requirement).
- **Error format**: All error responses MUST use the RFC 7807
  Problem Details format (`type`, `title`, `status`, `detail`, `instance`).
- **Idempotency**: Mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`)
  MUST support an `Idempotency-Key` header where the operation is not
  naturally idempotent.
- **Pagination**: Collection endpoints returning more than a single resource
  MUST support cursor-based pagination; unbounded list responses are
  prohibited.
- **Tech stack**: Node.js 20 LTS + TypeScript 5.4 (runtime); Fastify 4
  (HTTP framework); PostgreSQL 16 via Knex (relational metadata store);
  AWS S3 / S3-compatible object store for binary file storage (MinIO
  locally). JWT RS256 bearer tokens for authentication; Zod for runtime
  schema validation.

## Deployment & Infrastructure

All production deployments MUST target AWS ECS Fargate. Serverless compute
(AWS Lambda) is explicitly excluded for any service that handles file
uploads, because API Gateway imposes a hard 6 MB request payload limit that
is incompatible with the 50 MB upload requirement.

- The canonical deployment topology is:
  `Route 53 → ALB (TLS termination) → ECS Fargate (container) → RDS PostgreSQL + S3`.
- Container images MUST be built from a minimal base (e.g., `node:20-alpine`)
  and MUST NOT include development dependencies, source maps, or secret
  material.
- Infrastructure MUST be defined as code (IaC); manual console changes to
  production resources are prohibited.
- Environment-specific secrets (DB credentials, object store keys, JWT
  private keys) MUST be injected at runtime via AWS Secrets Manager or
  AWS Systems Manager Parameter Store; they MUST NOT appear in container
  images or task definitions in plaintext.
- The ECS task MUST expose `/v1/health` and `/v1/ready` as the ALB target
  group health check path; deployments that fail the readiness check MUST
  be automatically rolled back.

**Rationale**: ECS Fargate eliminates EC2 management overhead while
supporting long-lived HTTP connections, streaming multipart uploads, and
persistent PostgreSQL connection pools — none of which are compatible with
Lambda's stateless, payload-limited execution model.

## Development Workflow

Standards for how work progresses from idea to production.

- Every feature MUST follow the speckit flow:
  `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`.
- No code MUST be merged without a passing test suite and a green CI pipeline.
- Pull requests MUST reference the spec document that drove the work.
- Database migrations MUST be reversible (down migrations required).
- Feature branches MUST be short-lived (≤ 5 working days); long-running
  branches MUST be rebased daily against `main`.
- Releases MUST use semantic versioning (`MAJOR.MINOR.PATCH`); release notes
  MUST summarise user-visible changes.

## Governance

This constitution supersedes all other written or verbal practices for the
Zyvia API project. When a conflict arises between the constitution and any
other document, the constitution prevails.

**Amendment procedure**:
1. Open a pull request with the proposed change to this file.
2. State the motivation, the impact on existing principles, and a migration
   plan for any affected artefacts.
3. Obtain approval from at least one other contributor before merging.
4. Update `LAST_AMENDED_DATE` and increment `CONSTITUTION_VERSION` per the
   semantic versioning policy below.

**Versioning policy**:
- MAJOR bump: a principle is removed, renamed, or its non-negotiable rules
  are substantially redefined in a backward-incompatible way.
- MINOR bump: a new principle or section is added, or existing guidance is
  materially expanded.
- PATCH bump: clarifications, wording improvements, or typo fixes that do
  not change the normative rules.

**Compliance**: All PRs and code reviews MUST verify compliance with the
Core Principles. Non-compliant code MUST be rejected or have a documented
exception recorded in the plan's Complexity Tracking table.

**Version**: 1.1.0 | **Ratified**: 2026-04-03 | **Last Amended**: 2026-04-03
