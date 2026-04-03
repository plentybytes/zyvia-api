# Implementation Plan: AWS ECS Fargate Deployment

**Branch**: `002-aws-ecs-deployment` | **Date**: 2026-04-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/002-aws-ecs-deployment/spec.md`

## Summary

Provision the complete AWS production environment for Zyvia API using AWS CDK
(TypeScript): VPC with public/private subnets across 2 AZs, ECS Fargate
cluster, ALB with HTTPS, RDS PostgreSQL 16 in a private subnet, S3 bucket for
health record files, Secrets Manager for all runtime secrets, CloudWatch logs
and alarms, and a GitHub Actions CI/CD pipeline that builds → tests → pushes →
migrates → deploys on every merge to `main` with automatic rollback on health
check failure.

## Technical Context

**Language/Version**: TypeScript 5.4 (CDK infrastructure code); Node.js 20 LTS
**Primary Dependencies**: aws-cdk-lib ^2.140, constructs ^10,
  @aws-cdk/aws-ecs-patterns, GitHub Actions (CI/CD runner), AWS CLI v2
**Storage**: RDS PostgreSQL 16 (db.t4g.medium, single-AZ v1);
  S3 (standard storage class, SSE-S3 encryption)
**Testing**: CDK `assertions` module (snapshot + fine-grained unit tests);
  smoke test via `curl /v1/health` post-deploy
**Target Platform**: AWS single region (ap-southeast-2 default; configurable
  via CDK context)
**Project Type**: Infrastructure-as-code + CI/CD pipeline
**Performance Goals**: Deploy pipeline completes ≤ 10 min from merge to live;
  ALB target group health check passes within 60 s of new task start
**Constraints**: ECS tasks in private subnets only; no Lambda; all secrets via
  Secrets Manager; ALB terminates TLS; rolling deploy, min 1 healthy task at
  all times
**Scale/Scope**: 2 Fargate tasks (0.5 vCPU / 1 GB RAM each) at launch;
  auto-scale to 10 tasks at 70 % CPU/memory; single AWS region for v1

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. API-First Design | No new API endpoints; this feature provisions infrastructure for the existing versioned API | ✅ PASS |
| II. Contract-First Development | CDK stack interfaces and pipeline contracts documented in `/contracts/` before implementation begins | ✅ PASS |
| III. Test-First | CDK unit tests (`assertions`) written before stack code; smoke test defined before pipeline wiring | ✅ PASS |
| IV. Security by Default | All secrets in Secrets Manager; ECS in private subnets; S3 public access blocked; ALB enforces HTTPS redirect; least-privilege IAM task role | ✅ PASS |
| V. Observability & Simplicity | CloudWatch log groups for all tasks; 5xx and health alarms; `/v1/ready` wired to ALB; YAGNI — no Multi-AZ or multi-region in v1 | ✅ PASS |
| Deployment Principle | ECS Fargate explicitly chosen; Lambda excluded by constitution; IaC mandatory (CDK); Secrets Manager injection; ALB health check on `/v1/health` | ✅ PASS |

**Post-design re-check**: All gates pass after infrastructure model and
contracts defined — see bottom of plan.

## Project Structure

### Documentation (this feature)

```text
specs/002-aws-ecs-deployment/
├── plan.md                     # This file
├── research.md                 # Phase 0 output
├── infrastructure-model.md     # Phase 1 output (AWS resource model)
├── quickstart.md               # Phase 1 output
├── contracts/
│   ├── cdk-stack-interface.md  # CDK stack props + cross-stack outputs
│   └── pipeline-contract.md    # GitHub Actions pipeline stages + contracts
└── tasks.md                    # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
Dockerfile                      # Multi-stage container image (node:20-alpine)
.dockerignore                   # Already exists

infra/
├── bin/
│   └── app.ts                  # CDK app entry point; instantiates all stacks
├── lib/
│   ├── network-stack.ts        # VPC, public/private subnets, NAT gateway, SGs
│   ├── data-stack.ts           # RDS PostgreSQL, DB subnet group, Secrets Manager
│   ├── storage-stack.ts        # S3 bucket, bucket policy, CORS
│   ├── compute-stack.ts        # ECR repo, ECS cluster, Fargate service, ALB,
│   │                           # task definition, auto-scaling, Secrets Manager
│   │                           # injection, IAM task role
│   └── observability-stack.ts  # CloudWatch log groups, metric alarms, dashboard
├── test/
│   ├── network-stack.test.ts
│   ├── data-stack.test.ts
│   ├── storage-stack.test.ts
│   ├── compute-stack.test.ts
│   └── observability-stack.test.ts
├── cdk.json                    # CDK app config + context (region, account)
└── package.json                # CDK + vitest dependencies

.github/
└── workflows/
    └── deploy.yml              # GitHub Actions: build → test → push → migrate → deploy
```

**Structure Decision**: Separate CDK stacks per concern with explicit
cross-stack references. Stacks can be updated independently (e.g., adjust
auto-scaling in compute-stack without touching the network layer). GitHub
Actions for CI/CD — no AWS CodePipeline, keeping all pipeline logic in the
repository alongside the application code.

## Complexity Tracking

> No constitution violations — table not required.
