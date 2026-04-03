---
description: "Task list for AWS ECS Fargate Deployment"
---

# Tasks: AWS ECS Fargate Deployment

**Input**: Design documents from `specs/002-aws-ecs-deployment/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, infrastructure-model.md ✅,
  contracts/cdk-stack-interface.md ✅, contracts/pipeline-contract.md ✅, quickstart.md ✅

**Tests**: TDD enforced per constitution (Principle III). CDK unit tests using
`@aws-cdk/assertions` written first and confirmed failing before stack
implementation begins.

**Organization**: Tasks grouped by user story. US1 (infrastructure) MUST
complete before US2 (pipeline) or US3 (observability) can be independently
validated.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = Infrastructure, US2 = CI/CD Pipeline, US3 = Observability

---

## Phase 1: Setup (CDK Project Initialization)

**Purpose**: Bootstrap the `infra/` CDK project and add the `Dockerfile` so
subsequent phases have a working build foundation.

- [x] T001 Create `infra/` directory and initialize CDK TypeScript app: `package.json` with `aws-cdk-lib ^2.140`, `constructs ^10`, `vitest`, CDK CLI; `tsconfig.json`; `infra/bin/` and `infra/lib/` and `infra/test/` directories
- [x] T002 Create `infra/cdk.json` with app entry `"app": "npx ts-node bin/app.ts"`, CDK feature flags, and default context keys: `account`, `region` (`ap-southeast-2`), `imageTag` (`latest`), `alertEmail` (`""`)
- [x] T003 [P] Add vitest config `infra/vitest.config.ts` and npm test script `"test": "vitest run"` to `infra/package.json`
- [x] T004 [P] Create multi-stage `Dockerfile` at repo root: `builder` stage (`node:20-alpine`) compiles TypeScript to `dist/`; `runner` stage copies `dist/` and production `node_modules` only; exposes port 3000; sets `NODE_ENV=production`
- [x] T005 [P] Create `.github/workflows/` directory; add placeholder `deploy.yml` with `on: push` trigger (content filled in US2 phase)

**Checkpoint**: `cd infra && npm install && npm test` runs without errors (no
tests yet, but runner is configured). `docker build -t zyvia-api:test .` at
repo root completes successfully.

---

## Phase 2: Foundational (Shared Infrastructure Entry Point)

**Purpose**: The CDK app entry point that composes all stacks MUST exist
before any stack can be deployed or tested against the full dependency graph.

- [x] T006 Create `infra/bin/app.ts` — CDK app entry point per `contracts/cdk-stack-interface.md`; instantiate NetworkStack → DataStack + StorageStack (parallel) → ComputeStack → ObservabilityStack; pass cross-stack outputs as props per contract; read `imageTag` and `alertEmail` from CDK context
- [x] T007 [P] Create `infra/lib/oidc-role.ts` — reusable CDK construct that creates the GitHub Actions OIDC IAM role with the trust policy from `contracts/pipeline-contract.md`; condition restricts to `repo:<org>/zyvia-api:ref:refs/heads/main`; export role ARN as CfnOutput

**Checkpoint**: `cd infra && npx cdk ls` lists all 5 stack names without
TypeScript compilation errors.

---

## Phase 3: User Story 1 — Provision Infrastructure and Deploy Service (Priority: P1) 🎯 MVP

**Goal**: A platform engineer runs `cdk deploy` and within 30 minutes the
complete AWS environment is running. `GET /v1/health` returns 200 from the
ALB DNS; `GET /v1/ready` confirms DB and S3 are reachable.

**Independent Test**: `curl -f https://<ALB_DNS>/v1/health` returns HTTP 200
with `{"status":"ok"}` — verifiable without CI/CD or observability in place.

### CDK Unit Tests for US1 (Write first — MUST FAIL before implementation)

- [x] T008 [P] [US1] Write `infra/test/network-stack.test.ts` — assert VPC has 4 subnets across 2 AZs; ALB SG allows 443 inbound; ECS SG allows 3000 from ALB SG only; RDS SG allows 5432 from ECS SG only; no public IPs on ECS SG
- [x] T009 [P] [US1] Write `infra/test/data-stack.test.ts` — assert RDS instance is PostgreSQL 16; in private subnet group; `storageEncrypted: true`; `deletionProtection: true`; Secrets Manager secret exists for DB URL and JWT key
- [x] T010 [P] [US1] Write `infra/test/storage-stack.test.ts` — assert S3 bucket has SSE-S3 encryption; all 4 public-access-block settings enabled; versioning enabled; bucket policy denies public `s3:GetObject`
- [x] T011 [P] [US1] Write `infra/test/compute-stack.test.ts` — assert ECS task uses Fargate; container port 3000; no public IP on tasks; ALB listener on 443; health check path `/v1/health`; HTTP→HTTPS redirect on port 80; `DATABASE_URL` and `JWT_PUBLIC_KEY` injected from Secrets Manager (not plaintext); task role has S3 put/get permissions; auto-scaling min 2 / max 10

### Implementation for US1

- [x] T012 [US1] Create `infra/lib/network-stack.ts` — VPC (10.0.0.0/16, 2 AZs, 1 NAT Gateway); 2 public subnets (10.0.0.0/24, 10.0.64.0/24); 2 private subnets (10.0.128.0/24, 10.0.192.0/24); AlbSecurityGroup (443+80 inbound); EcsSecurityGroup (3000 from ALB only); RdsSecurityGroup (5432 from ECS only); export all as stack properties per `contracts/cdk-stack-interface.md`
- [x] T013 [US1] Create `infra/lib/data-stack.ts` — DB subnet group (private subnets); RDS PostgreSQL 16 `db.t4g.medium`, encrypted, single-AZ, 7-day backup, deletion protection; `DbSecret` (username+password JSON, auto-rotation 30d); `DatabaseUrlSecret` (constructed connection string); `JwtPublicKeySecret` (empty placeholder — populated manually); export all secrets per interface contract
- [x] T014 [US1] Create `infra/lib/storage-stack.ts` — S3 bucket `zyvia-health-records-<account>-<region>`; SSE-S3 encryption; versioning enabled; all public access blocked; lifecycle rule (transition to IA after 90 days); bucket policy: allow get+put from ECS task role only; export bucket and name per interface contract
- [x] T015 [US1] Create `infra/lib/compute-stack.ts` — ECR private repo (`zyvia-api`, scan on push, keep last 10 images); ECS Fargate cluster (Container Insights enabled); task role (S3 get+put on HealthRecordsBucket, Secrets Manager get on DB + JWT secrets, CloudWatch logs); execution role (ECSTaskExecutionRole + Secrets Manager get); task definition (0.5 vCPU / 1 GB, port 3000, secrets injection for `DATABASE_URL` + `JWT_PUBLIC_KEY`, plain env: `PORT=3000`, `NODE_ENV=production`, `OBJECT_STORE_BUCKET`, `OBJECT_STORE_REGION`); Fargate service (min 2 / max 10, circuit breaker + rollback enabled, private subnets, no public IP); ALB (internet-facing, public subnets); HTTPS listener (443 → target group); HTTP redirect (80 → 443); target group (health check `GET /v1/health`, healthy threshold 2, unhealthy 3, interval 30s); CPU + memory step-scaling (target 70 %); ALB DNS name as CfnOutput; export service + target group per interface contract
- [ ] T016 [US1] Validate US1 deployment per `quickstart.md` steps 1–6: run `cdk bootstrap`, `cdk deploy ZyviaNetwork ZyviaData ZyviaStorage ZyviaCompute`, populate JWT secret, run migrations, and confirm `GET /v1/health` returns 200 and `POST /v1/upload` succeeds end-to-end

**Checkpoint**: `cd infra && npm test` passes all T008–T011 tests. `cdk synth
ZyviaNetwork ZyviaData ZyviaStorage ZyviaCompute` produces valid CloudFormation
without errors. `GET <ALB_DNS>/v1/health` returns 200 after deployment.

---

## Phase 4: User Story 2 — Automated CI/CD Pipeline (Priority: P2)

**Goal**: A merge to `main` triggers the 5-stage GitHub Actions pipeline
(build → test → push → migrate → deploy) and the new image is live in ECS
within 10 minutes, with automatic rollback on health check failure.

**Independent Test**: Merge a trivial change to `main`; observe all 5 pipeline
stages turn green within 10 minutes; confirm the new image tag is running in
ECS — testable without US3 observability in place.

### Implementation for US2

- [x] T017 [US2] Create `.github/workflows/pr.yml` — trigger on `pull_request` to `main`; single job: checkout → `npm ci` (app root) → `npm run test:unit` → `npm run test:contract`; no AWS access, no image push, no deploy
- [x] T018 [US2] Create `.github/workflows/deploy.yml` — 5-stage pipeline per `contracts/pipeline-contract.md`: (1) build+test (`npm ci` + `test:unit` + `test:contract`); (2) build+push image to ECR (OIDC auth, tag = `github.sha`); (3) run migrations (one-off `aws ecs run-task` with `npm run db:migrate` override, poll until STOPPED, fail on non-zero exit); (4) deploy to ECS (`aws ecs update-service`, wait for stability, detect rollback and fail pipeline); (5) smoke test (`curl -f https://<ALB_DNS>/v1/health`); define all required GitHub variables per `contracts/pipeline-contract.md`
- [x] T019 [P] [US2] Create `infra/lib/oidc-role.ts` if not already created in Phase 2 — IAM role for GitHub Actions OIDC federation; trust policy from `contracts/pipeline-contract.md`; permissions: `ecr:*`, `ecs:*`, `iam:PassRole` (task execution role), `secretsmanager:GetSecretValue` (DB URL for migration task); export role ARN as CfnOutput named `GitHubActionsRoleArn`
- [x] T020 [US2] Create `infra/docs/github-setup.md` — step-by-step instructions to configure GitHub Actions variables (`AWS_ACCOUNT_ID`, `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `ECS_CLUSTER`, `ECS_SERVICE`, `ECS_TASK_DEFINITION`, `MIGRATION_SUBNET_ID`, `MIGRATION_SECURITY_GROUP`, `ECR_REPOSITORY`, `ALB_DNS_NAME`) from CDK stack outputs
- [ ] T021 [US2] Validate US2 per `quickstart.md` step 7: add GitHub variables, merge a trivial change to `main`, confirm all 5 pipeline stages complete in ≤ 10 minutes, verify new image tag in running ECS task

**Checkpoint**: `GET https://<ALB_DNS>/v1/health` returns the new image's
response within 10 minutes of a merge to `main`. A deliberately failing test
blocks the deploy (Stage 1 aborts pipeline).

---

## Phase 5: User Story 3 — Observability and Alerting (Priority: P3)

**Goal**: Operators can view structured logs within 60 seconds of requests,
receive alarms within 5 minutes of error rate > 5 % or task health failure,
and correlate deployments with metric changes.

**Independent Test**: Trigger a 401 error via an invalid JWT; confirm the
structured log entry appears in CloudWatch within 60 seconds containing
`request_id`, `status: 401`, `duration_ms` — verifiable without US2 CI/CD.

### CDK Unit Test for US3 (Write first — MUST FAIL before implementation)

- [x] T022 [P] [US3] Write `infra/test/observability-stack.test.ts` — assert CloudWatch log group `/zyvia/api` exists with 90-day retention; HTTP 5xx alarm threshold is 5 % over 5 min; HealthyHostCount alarm triggers at < 1; SNS topic exists; alarms have SNS actions

### Implementation for US3

- [x] T023 [US3] Create `infra/lib/observability-stack.ts` — CloudWatch log group `/zyvia/api` (90-day retention); Container Insights metric filter for 5xx rate (ALB `HTTPCode_Target_5XX_Count` > 5 % of `RequestCount` over 5-minute window, 1 breach to alarm); `HealthyHostCount` alarm (< 1 for 2 consecutive 60-second periods); `DatabaseConnections` alarm on RDS (= 0 for 2 periods); SNS topic with email subscription (alertEmail from CDK context); all alarms publish to SNS topic; CloudWatch dashboard with widgets: request count, 5xx rate, ECS CPU/memory, RDS connections; export SNS topic ARN as CfnOutput per `contracts/cdk-stack-interface.md`
- [ ] T024 [US3] Validate US3 per `quickstart.md` step 8: tail `/zyvia/api` CloudWatch logs; send request with invalid JWT; confirm structured log entry within 60 s; confirm alarm fires within 5 min of simulated health check failure

**Checkpoint**: `cd infra && npm test` passes T022. `cdk deploy
ZyviaObservability` succeeds. CloudWatch console shows log group, dashboard,
and 3 alarms in OK state.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Security hardening, documentation, and final validation across
all stacks.

- [x] T025 [P] Add `cdk-nag` to `infra/bin/app.ts` with `AwsSolutionsChecks` aspect applied to the CDK app; suppress any intentional rule deviations with documented justification (e.g., single NAT Gateway for v1 cost optimisation)
- [x] T026 [P] Create `README.md` at repo root documenting: project overview, local development setup (quickstart.md summary), production deployment (quickstart.md steps 1–8), environment variables reference, and links to specs
- [x] T027 Run `cd infra && npx cdk synth --all` and confirm all 5 stacks synthesize without CloudFormation template errors or cdk-nag violations
- [x] T028 [P] Run `infra/test/` full suite (`npm test`) and confirm all CDK unit tests pass with zero failures

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Requires Phase 1 complete — BLOCKS all user stories
- **Phase 3 (US1 Infrastructure)**: Requires Phase 2 — MVP deliverable; BLOCKS real validation of US2 + US3
- **Phase 4 (US2 Pipeline)**: Requires Phase 2 complete; US1 deployment recommended but pipeline code is independently writable
- **Phase 5 (US3 Observability)**: Requires Phase 2 complete; independently deployable after US1
- **Phase 6 (Polish)**: Requires Phase 3 + 4 + 5

### User Story Dependencies

- **US1 (P1)**: Fully independent — only needs CDK + AWS account
- **US2 (P2)**: Pipeline code independent; end-to-end validation requires US1 deployed
- **US3 (P3)**: ObservabilityStack independent; end-to-end alarm validation requires US1 running

### Within Each User Story

- CDK unit tests (T008–T011, T022) MUST be written and confirmed **failing** before stack implementation
- `bin/app.ts` (T006) before any stack implementation (type errors otherwise)
- NetworkStack (T012) before DataStack (T013) and ComputeStack (T015) — provides VPC + security groups
- DataStack (T013) and StorageStack (T014) can run in parallel — no mutual dependency
- ComputeStack (T015) after DataStack and StorageStack — needs secret ARNs and bucket ARN

### Parallel Opportunities

```bash
# Phase 1 — after T001/T002:
T003, T004, T005  (vitest config, Dockerfile, workflows dir)

# Phase 3 — CDK tests all independent:
T008, T009, T010, T011  (write all 4 test files in parallel)

# Phase 3 — after T008–T011 confirmed failing:
T013, T014  (DataStack and StorageStack have no mutual dependency)
# Then:
T015  (ComputeStack — needs T013 secret ARNs and T014 bucket ARN)

# Phase 4 — pipeline files independent of each other:
T017, T018  (pr.yml and deploy.yml can be authored in parallel)

# Phase 6 — all polish tasks independent:
T025, T026, T028
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: CDK project setup + Dockerfile
2. Complete Phase 2: `bin/app.ts` entry point
3. Write T008–T011 CDK tests, confirm they FAIL
4. Complete Phase 3: US1 stacks
5. **STOP and VALIDATE**: `cdk synth --all` clean; CDK tests pass; `curl /v1/health` returns 200 after deploy

### Incremental Delivery

1. Setup + Foundational → CDK project ready
2. US1 Infrastructure → API is live on AWS ✅
3. US2 CI/CD → Code changes deploy automatically ✅
4. US3 Observability → Alarms and logs active ✅
5. Polish → Security hardened, documented ✅

### Parallel Team Strategy

After Phase 2 completes:
- **Dev A**: Phase 3 (NetworkStack + DataStack + StorageStack + ComputeStack)
- **Dev B**: Phase 4 (GitHub Actions workflows + OIDC role)
- Dev B's end-to-end test waits for Dev A to deploy US1

---

## Notes

- [P] tasks have no file conflicts and no dependencies on incomplete tasks
- [US*] labels trace each task to its user story for independent delivery
- CDK unit tests (T008–T011, T022) MUST be red before stack implementation — constitution Principle III
- No static AWS credentials anywhere — OIDC only for GitHub Actions
- `cdk deploy` order: NetworkStack → DataStack + StorageStack → ComputeStack → ObservabilityStack
- Commit after each stack is implemented and its tests pass
- Populate `zyvia/jwt-public-key` in Secrets Manager manually before first `cdk deploy ZyviaCompute`
