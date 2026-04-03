# Pipeline Contract: GitHub Actions CI/CD

**Feature**: 002-aws-ecs-deployment
**Date**: 2026-04-03

Defines the stages, inputs, outputs, and failure behaviour of the GitHub
Actions deployment pipeline (`.github/workflows/deploy.yml`).

---

## Trigger

```
on:
  push:
    branches: [main]
```

Only merges to `main` trigger a deployment. PRs run build + test only
(no push, no deploy).

---

## Pipeline Stages

### Stage 1 — Build & Test

| Property | Value |
|----------|-------|
| Runner | `ubuntu-latest` |
| Steps | Checkout → `npm ci` (app) → `npm run test:unit` → `npm run test:contract` |
| Failure behaviour | **Abort pipeline**; no image is built or pushed |
| Outputs | None (test results only) |

### Stage 2 — Build & Push Image

| Property | Value |
|----------|-------|
| Depends on | Stage 1 pass |
| Runner | `ubuntu-latest` |
| AWS auth | OIDC via `aws-actions/configure-aws-credentials` (no static keys) |
| Steps | Configure AWS credentials → ECR login → `docker build` (multi-stage) → `docker push` |
| Image tag | Git commit SHA (`github.sha`); also tag `latest` |
| ECR repo | `<account>.dkr.ecr.<region>.amazonaws.com/zyvia-api` |
| Failure behaviour | **Abort pipeline**; existing service continues running |
| Outputs | `IMAGE_TAG` = `github.sha` |

### Stage 3 — Run Migrations

| Property | Value |
|----------|-------|
| Depends on | Stage 2 pass |
| Runner | `ubuntu-latest` |
| AWS auth | OIDC (same role as Stage 2) |
| Steps | `aws ecs run-task` with `--overrides` to run `npm run db:migrate` as a one-off Fargate task in the private subnet; poll task until STOPPED; fail if exit code ≠ 0 |
| Timeout | 5 minutes |
| Failure behaviour | **Abort pipeline**; existing service continues running; migration failure leaves schema at previous version |
| Outputs | None |

### Stage 4 — Deploy to ECS

| Property | Value |
|----------|-------|
| Depends on | Stage 3 pass |
| Runner | `ubuntu-latest` |
| AWS auth | OIDC |
| Steps | Register new task definition revision (update `imageTag`) → `aws ecs update-service --force-new-deployment` → wait for service stability (rolling deploy) |
| Rollback | ECS circuit breaker automatically rolls back if new tasks fail health checks; pipeline also polls for `RUNNING` state and marks itself failed if rollback is detected |
| Deploy strategy | Rolling: `minimumHealthyPercent: 50`, `maximumPercent: 200` |
| Timeout | 10 minutes |
| Failure behaviour | ECS rolls back automatically; pipeline reports failure; previous version continues running |
| Outputs | Deployed image tag logged as pipeline summary |

### Stage 5 — Smoke Test

| Property | Value |
|----------|-------|
| Depends on | Stage 4 pass |
| Runner | `ubuntu-latest` |
| Steps | `curl -f https://<ALB_DNS>/v1/health` → expect HTTP 200 and `{"status":"ok"}` |
| ALB DNS | Stored as GitHub Actions variable `ALB_DNS_NAME` |
| Failure behaviour | Alert only (non-blocking for now; upgrade to blocking in v2) |
| Outputs | None |

---

## GitHub Actions Secrets & Variables

| Name | Type | Description |
|------|------|-------------|
| `AWS_ACCOUNT_ID` | Variable | AWS account number |
| `AWS_REGION` | Variable | Deployment region (e.g., `ap-southeast-2`) |
| `AWS_DEPLOY_ROLE_ARN` | Variable | IAM role ARN trusted by OIDC |
| `ECR_REPOSITORY` | Variable | ECR repository name (`zyvia-api`) |
| `ECS_CLUSTER` | Variable | ECS cluster name |
| `ECS_SERVICE` | Variable | ECS service name |
| `ECS_TASK_DEFINITION` | Variable | Task definition family name |
| `MIGRATION_SUBNET_ID` | Variable | Private subnet ID for migration task |
| `MIGRATION_SECURITY_GROUP` | Variable | ECS security group ID for migration task |
| `ALB_DNS_NAME` | Variable | ALB DNS name for smoke test |

> **No static AWS credentials are stored in GitHub Secrets.** AWS access is
> granted exclusively via OIDC token exchange.

---

## IAM Role Trust Policy (GitHub OIDC)

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
    },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": "repo:<org>/zyvia-api:ref:refs/heads/main"
    }
  }
}
```

Only pushes to `main` from the `zyvia-api` repository can assume the deploy role.

---

## PR Pipeline (build + test only)

```
on:
  pull_request:
    branches: [main]
```

Stages: Build & Test only (Stage 1). No image push, no deployment.
This gives fast feedback on PRs without consuming AWS resources.
