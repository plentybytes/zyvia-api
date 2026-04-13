# zyvia-api

Health records digitalization REST API — upload, retrieve and manage patient health records.

Deployed on AWS ECS Fargate with RDS PostgreSQL and S3.

---

## Local Development

### Prerequisites

- Node.js 20 LTS
- Docker + Docker Compose

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env

# 3. Start local services (PostgreSQL + MinIO)
docker compose up -d

# 4. Generate dev RSA key pair
npm run dev:token -- --generate-keys

# 5. Run database migrations and seed data
npm run db:migrate && npm run db:seed

# 6. Start dev server (http://localhost:3000)
npm run dev
```

### Get a test JWT
Use this same patient id "patient-001" in api input 
```bash
# Provider token 
npm run dev:token -- --role provider --sub provider-001

# Patient token
npm run dev:token -- --role patient --sub patient-001
```

### API documentation

OpenAPI docs available at `http://localhost:3000/documentation` when running in dev mode.

---

## Testing

```bash
npm test                 # All tests
npm run test:unit        # Unit tests (no Docker needed)
npm run test:contract    # Contract/HTTP tests (no Docker needed)
npm run test:integration # Integration tests (requires docker compose up -d)
```

---

## Production Deployment (AWS)

See [`infra/`](./infra/) for CDK infrastructure code.

### First-time provisioning

```bash
cd infra
npm install

# Bootstrap CDK in your AWS account (once per account/region)
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-2

# Deploy infrastructure stacks
npx cdk deploy ZyviaNetwork ZyviaData ZyviaStorage

# Populate the JWT public key secret before deploying compute
aws secretsmanager put-secret-value \
  --secret-id zyvia/jwt-public-key \
  --secret-string "$(cat keys/public.pem)"

# Deploy ECS Fargate service + ALB
npx cdk deploy ZyviaCompute

# Run initial database migrations
# (see infra/docs/github-setup.md for using the pipeline for subsequent migrations)
npm run db:migrate

# Deploy observability stack
npx cdk deploy ZyviaObservability
```

### CI/CD pipeline

Merges to `main` automatically:
1. Build and test the application
2. Push a Docker image to ECR tagged with the commit SHA
3. Run database migrations as a one-off Fargate task
4. Deploy the new image to ECS (rolling deploy with circuit breaker)
5. Smoke test `GET /v1/health`

See [`infra/docs/github-setup.md`](./infra/docs/github-setup.md) for configuring GitHub Actions variables.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_PUBLIC_KEY` | Yes | RS256 public key PEM (for token verification) |
| `OBJECT_STORE_BUCKET` | Yes | S3 bucket name for health records |
| `OBJECT_STORE_REGION` | Yes | AWS region of the S3 bucket |
| `PORT` | No | HTTP port (default: 3000) |
| `NODE_ENV` | No | `development` / `production` |

---

## Architecture

```
Internet → ALB (443/80) → ECS Fargate (port 3000) → RDS PostgreSQL 16
                                                    → S3 (health record files)
                                                    → Secrets Manager (DB URL, JWT key)
```

- **Application**: Node.js 20 + TypeScript 5.4 + Fastify 4
- **Database**: RDS PostgreSQL 16 (db.t4g.medium, encrypted, private subnet)
- **File storage**: S3 with SSE-S3 encryption, versioning, public access blocked
- **Auth**: JWT RS256 bearer tokens (external identity provider)
- **Infrastructure**: AWS CDK v2 (TypeScript), 5 stacks

---

## Specifications

- [Health Records API spec](./specs/001-health-records-api/)
- [AWS ECS Deployment spec](./specs/002-aws-ecs-deployment/)
