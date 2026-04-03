# Quickstart: AWS ECS Fargate Deployment

**Feature**: 002-aws-ecs-deployment
**Date**: 2026-04-03

Use this guide to provision the AWS infrastructure from scratch and validate
all three user stories end-to-end.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20 LTS | CDK CLI + infra code |
| AWS CLI | v2 | CDK deploy + smoke tests |
| AWS CDK CLI | ^2.140 | `npm install -g aws-cdk` |
| Docker | 24+ | Build + push container image |
| An AWS account | — | Target environment |
| Domain / ACM cert | optional | HTTPS with custom domain; ALB DNS usable without |

---

## 1. Bootstrap AWS CDK

```bash
# One-time per account/region
aws configure   # Set account + region credentials
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

---

## 2. Build and Push the Container Image

```bash
# Authenticate Docker to ECR (first deploy — before ComputeStack exists,
# create the ECR repo manually or deploy StorageStack first)
aws ecr get-login-password --region <REGION> | \
  docker login --username AWS --password-stdin <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com

# Build and push
IMAGE_TAG=$(git rev-parse --short HEAD)
docker build -t zyvia-api:${IMAGE_TAG} .
docker tag zyvia-api:${IMAGE_TAG} <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/zyvia-api:${IMAGE_TAG}
docker push <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/zyvia-api:${IMAGE_TAG}
```

---

## 3. Deploy Infrastructure Stacks

```bash
cd infra
npm install

# Deploy in dependency order
cdk deploy ZyviaNetwork
cdk deploy ZyviaData ZyviaStorage   # can run in parallel
cdk deploy ZyviaCompute -c imageTag=${IMAGE_TAG} -c alertEmail=ops@example.com
cdk deploy ZyviaObservability -c alertEmail=ops@example.com
```

> Note the ALB DNS name printed as a CloudFormation output from
> `ZyviaCompute` — you will need it for smoke tests.

---

## 4. Populate Secrets

After `ZyviaData` deploys, the JWT public key secret is created but empty.
Populate it:

```bash
# Generate dev key pair if not done already
npm run dev:token -- --generate-keys

# Store the public key in Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id zyvia/jwt-public-key \
  --secret-string "$(cat keys/dev-public.pem)"
```

For production, use a proper RSA key pair — not the dev key.

---

## 5. Run Database Migrations

```bash
# One-off ECS task using the migration override
CLUSTER=$(aws ecs list-clusters --query 'clusterArns[0]' --output text)
TASK_DEF=$(aws ecs list-task-definitions --family-prefix zyvia --query 'taskDefinitionArns[-1]' --output text)
SUBNET=$(aws ec2 describe-subnets --filters "Name=tag:Name,Values=*Private*" \
  --query 'Subnets[0].SubnetId' --output text)
SG=$(aws ec2 describe-security-groups --filters "Name=tag:Name,Values=*ecs*" \
  --query 'SecurityGroups[0].GroupId' --output text)

aws ecs run-task \
  --cluster ${CLUSTER} \
  --task-definition ${TASK_DEF} \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNET}],securityGroups=[${SG}],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"zyvia-api","command":["npm","run","db:migrate"]}]}'
```

Wait for the task to reach STOPPED state and verify exit code 0.

---

## 6. Validate US1 — Service Running and Healthy

```bash
ALB_DNS=$(aws cloudformation describe-stacks --stack-name ZyviaCompute \
  --query 'Stacks[0].Outputs[?OutputKey==`AlbDnsName`].OutputValue' --output text)

# Health check
curl -f https://${ALB_DNS}/v1/health
# Expected: {"status":"ok"}

# Readiness check (DB + S3 reachable)
curl -f https://${ALB_DNS}/v1/ready
# Expected: {"status":"ok"}

# Full upload smoke test (requires a valid JWT)
TOKEN=$(npm run dev:token -- --role provider --sub provider-001 2>/dev/null | grep Bearer)
curl -X POST https://${ALB_DNS}/v1/upload \
  -H "Authorization: ${TOKEN}" \
  -F "patient_id=smoke-test-patient" \
  -F "record_type_id=<LAB_RESULT_UUID>" \
  -F "file=@specs/002-aws-ecs-deployment/quickstart.md;type=application/pdf"
# Expected: HTTP 201 + {"id":"<uuid>","created_at":"..."}
```

---

## 7. Validate US2 — CI/CD Pipeline

1. Add the GitHub Actions variables listed in `contracts/pipeline-contract.md`
   to your repository (`Settings → Secrets and variables → Actions`).
2. Create the GitHub OIDC trust in IAM (see `contracts/pipeline-contract.md`
   trust policy).
3. Merge a trivial change to `main` (e.g., update a comment).
4. Monitor the Actions run: `Build & Test → Push Image → Migrate → Deploy →
   Smoke Test` should all show green within 10 minutes.
5. After the run, confirm the new image tag is reflected in the running ECS task:

```bash
aws ecs describe-tasks \
  --cluster ${CLUSTER} \
  --tasks $(aws ecs list-tasks --cluster ${CLUSTER} --query 'taskArns[0]' --output text) \
  --query 'tasks[0].containers[0].image'
```

---

## 8. Validate US3 — Observability

```bash
# Check logs are appearing in CloudWatch
aws logs tail /zyvia/api --follow --since 5m

# Trigger an intentional error and verify structured log entry
curl -s https://${ALB_DNS}/v1/records?patient_id=test \
  -H "Authorization: Bearer invalid-token" | jq .
# Expect: {"type":"...","status":401,...}

# Verify that log entry appears within 60 s:
aws logs filter-log-events \
  --log-group-name /zyvia/api \
  --filter-pattern '{ $.status = 401 }' \
  --start-time $(($(date +%s) - 120))000
```

---

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `cdk deploy` fails with `Bootstrap required` | CDK bootstrap not run | Run `cdk bootstrap aws://<ACCOUNT>/<REGION>` |
| Tasks failing health check | JWT public key secret empty | Populate `zyvia/jwt-public-key` via `aws secretsmanager put-secret-value` |
| Migration task exits with non-zero | DB not reachable | Verify ECS security group allows port 5432 from EcsSecurityGroup |
| `GET /v1/ready` returns 503 | S3 bucket unreachable | Verify ECS task role has `s3:HeadBucket` permission |
| ALB returns 502 | Container not listening on port 3000 | Check `PORT=3000` env var in task definition |
