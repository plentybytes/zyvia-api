# Research: AWS ECS Fargate Deployment

**Feature**: 002-aws-ecs-deployment
**Date**: 2026-04-03

All decisions in this feature are either mandated by the project constitution
(ECS Fargate, IaC, Secrets Manager) or derived from the existing tech stack
(TypeScript, PostgreSQL, S3). Research below records rationale and documents
alternatives considered.

---

## Decision 1: IaC Tool — AWS CDK (TypeScript)

**Decision**: AWS CDK v2 (TypeScript)

**Rationale**:
- Consistent with the project's primary language (TypeScript/Node.js 20)
- CDK provides L2/L3 constructs that encode AWS best practices by default
  (e.g., `ApplicationLoadBalancedFargateService` wires ALB + ECS + health
  checks automatically)
- CDK `assertions` module enables unit testing of CloudFormation templates
  alongside application code — satisfies Principle III (Test-First)
- Single `npm install` and familiar toolchain for the existing team

**Alternatives considered**:
- Terraform — language-agnostic, large ecosystem; rejected because it
  introduces HCL as a second language and lacks native CDK-style L3
  constructs; CDK better fits the TypeScript-first team
- AWS SAM — optimised for Lambda; excluded by constitution
- Pulumi (TypeScript) — viable; rejected to avoid an additional runtime
  dependency (Pulumi state backend) when CDK + CloudFormation is sufficient

---

## Decision 2: CI/CD Platform — GitHub Actions

**Decision**: GitHub Actions with OIDC-based AWS authentication (no long-lived
  access keys stored as secrets)

**Rationale**:
- Repository is on GitHub; Actions is the native CI/CD tool
- OIDC federation with AWS IAM eliminates static `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` secrets in GitHub — satisfies Principle IV
- AWS provides an official `aws-actions/configure-aws-credentials` action
  supporting OIDC
- Pipeline definition lives in `.github/workflows/deploy.yml` alongside
  application code — visible, version-controlled, reviewable in PRs

**Alternatives considered**:
- AWS CodePipeline — tighter AWS integration; rejected because it requires
  a separate CodePipeline stack, adds CloudFormation complexity, and
  separates pipeline definition from the application repository
- CircleCI / GitLab CI — no native advantage over Actions for a GitHub repo

---

## Decision 3: Container Image Strategy

**Decision**: Multi-stage Dockerfile (`node:20-alpine` base); image tagged
  with Git commit SHA; stored in ECR (private)

**Rationale**:
- `node:20-alpine` minimises attack surface and image size (~150 MB vs
  ~900 MB for `node:20`)
- Multi-stage build: `builder` stage compiles TypeScript; `runner` stage
  copies only `dist/` and `node_modules` (production only)
- Commit SHA tag enables exact rollback by task definition revision without
  ambiguity of `latest`
- ECR is co-located with ECS; no cross-region image pull latency; IAM-based
  auth (no Docker Hub rate limits)

---

## Decision 4: Networking Topology

**Decision**: VPC with 2 public + 2 private subnets across 2 AZs; single NAT
  Gateway (cost-optimised for v1); ALB in public subnets; ECS + RDS in private

**Rationale**:
- ECS tasks and RDS in private subnets — constitution requirement
- 2 AZs minimum for ALB (AWS requirement) and task availability
- Single NAT Gateway sufficient for v1 outbound traffic (ECR pulls, Secrets
  Manager, S3 API calls); can be upgraded to one-per-AZ for HA at extra cost
- ALB in public subnets handles all inbound; tasks have no public IPs

**Alternatives considered**:
- One NAT per AZ — higher availability; cost doubles; deferred to v2
- VPC endpoints for S3 / ECR — eliminates NAT traffic for these services;
  added to observability-stack as a future optimisation task

---

## Decision 5: RDS Configuration

**Decision**: RDS PostgreSQL 16, `db.t4g.medium`, single-AZ, encrypted at
  rest (aws/rds KMS key), automated backups 7-day retention

**Rationale**:
- `db.t4g.medium` (2 vCPU, 4 GB RAM) provides comfortable headroom for
  initial load at low cost
- Single-AZ acceptable for v1 per spec assumptions; Multi-AZ is a one-click
  upgrade when SLA requires it
- Encrypted at rest: required by the health data sensitivity of the records
- Automated backups: 7-day retention covers the most likely recovery windows
- DB credentials auto-rotated via Secrets Manager rotation lambda (built-in
  RDS rotation function)

---

## Decision 6: Secret Injection Pattern

**Decision**: Secrets Manager ARNs referenced directly in ECS task definition
  `secrets` field; ECS agent fetches values at task start

**Rationale**:
- Secrets never appear in environment variable plaintext in the task
  definition JSON — satisfies constitution Principle IV
- ECS agent caches secrets; rotation is picked up on next task restart
- Required secrets: `DATABASE_URL`, `OBJECT_STORE_ACCESS_KEY`,
  `OBJECT_STORE_SECRET_KEY`, `JWT_PUBLIC_KEY` (value, not path)
- S3 access uses the ECS task IAM role (no credentials needed)

---

## Decision 7: Auto-Scaling Policy

**Decision**: Step scaling on ECS service; scale-out at 70 % CPU or 70 %
  memory (whichever triggers first); scale-in cooldown 300 s; min 2 / max 10
  tasks

**Rationale**:
- 70 % threshold gives headroom before latency degrades
- Min 2 tasks ensures availability during scale-in events and deployment
  rolling updates
- Max 10 tasks caps runaway cost for v1; revisit based on observed traffic
- Scale-in cooldown prevents thrashing on bursty workloads

---

## Decision 8: Observability Stack

**Decision**: CloudWatch Container Insights for ECS metrics; structured logs
  via CloudWatch Logs (log group per service, 90-day retention); three alarms:
  HTTP 5xx rate > 5 % (5-min), ECS task health check failures, RDS
  connection errors; SNS topic → email/Slack via webhook

**Rationale**:
- Container Insights provides CPU, memory, and network metrics without
  custom agents
- 90-day log retention: minimum per spec FR-012
- SNS + webhook is the simplest fan-out for alert delivery without
  additional tooling (PagerDuty integration is a follow-up)

---

## Decision 9: Database Migration in Pipeline

**Decision**: Run `npm run db:migrate` as a one-off ECS task in the pipeline
  after the new image is pushed but before the new service deployment starts

**Rationale**:
- Migrations run in the same VPC/subnet as the application, using the same
  DB credentials from Secrets Manager
- Running before service swap ensures schema is ready when new tasks boot
- Uses `aws ecs run-task` with the `--overrides` flag to run a short-lived
  migration task without a service
- Migrations must remain backward-compatible (additive only) to support
  the rolling deploy overlap window

---

## All NEEDS CLARIFICATION items

None — all decisions derived from constitution, spec assumptions, and
existing implementation.
