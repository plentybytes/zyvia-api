# Infrastructure Model: AWS ECS Fargate Deployment

**Feature**: 002-aws-ecs-deployment
**Date**: 2026-04-03

This document describes the AWS resources, their relationships, and the
configuration constraints that govern them. It is the infrastructure
equivalent of a data model for an application feature.

---

## Resource Inventory

### NetworkStack

| Resource | Type | Key Configuration |
|----------|------|-------------------|
| `ZyviaVpc` | VPC | CIDR 10.0.0.0/16; 2 AZs; 2 public + 2 private subnets; 1 NAT Gateway |
| `PublicSubnet-1a` | Subnet | 10.0.0.0/24; AZ-a; route to Internet Gateway |
| `PublicSubnet-1b` | Subnet | 10.0.64.0/24; AZ-b; route to Internet Gateway |
| `PrivateSubnet-1a` | Subnet | 10.0.128.0/24; AZ-a; route to NAT Gateway |
| `PrivateSubnet-1b` | Subnet | 10.0.192.0/24; AZ-b; route to NAT Gateway |
| `AlbSecurityGroup` | Security Group | Inbound: 443 (0.0.0.0/0), 80 (0.0.0.0/0); Outbound: all |
| `EcsSecurityGroup` | Security Group | Inbound: 3000 from AlbSecurityGroup only; Outbound: all |
| `RdsSecurityGroup` | Security Group | Inbound: 5432 from EcsSecurityGroup only; Outbound: none |

---

### DataStack

| Resource | Type | Key Configuration |
|----------|------|-------------------|
| `ZyviaDb` | RDS PostgreSQL 16 | db.t4g.medium; single-AZ; private subnet group; encrypted (aws/rds); backup 7 days; deletion protection enabled |
| `DbSubnetGroup` | DB Subnet Group | PrivateSubnet-1a + PrivateSubnet-1b |
| `DbSecret` | Secrets Manager Secret | JSON: `{username, password, host, port, dbname}`; auto-rotation via RDS rotation lambda (30-day cycle) |
| `DatabaseUrlSecret` | Secrets Manager Secret | Constructed `DATABASE_URL` string; updated by rotation lambda |
| `JwtPublicKeySecret` | Secrets Manager Secret | PEM string of RS256 public key; manually populated post-deploy |

---

### StorageStack

| Resource | Type | Key Configuration |
|----------|------|-------------------|
| `HealthRecordsBucket` | S3 Bucket | SSE-S3 encryption; versioning enabled; public access blocked (all 4 settings); lifecycle: transition to IA after 90 days |
| `BucketPolicy` | S3 Bucket Policy | Allow `s3:GetObject`, `s3:PutObject` only from ECS task IAM role; deny all public access |

---

### ComputeStack

| Resource | Type | Key Configuration |
|----------|------|-------------------|
| `ZyviaEcrRepo` | ECR Repository | Private; image scan on push; lifecycle: keep last 10 images |
| `ZyviaCluster` | ECS Cluster | Container Insights enabled |
| `ZyviaTaskDefinition` | Fargate Task Definition | 0.5 vCPU / 1 GB RAM; `node:20-alpine` image from ECR; port 3000; secrets injected from Secrets Manager |
| `ZyviaTaskRole` | IAM Role | Policies: `s3:GetObject`+`s3:PutObject` on HealthRecordsBucket; `secretsmanager:GetSecretValue` on DB + JWT secrets; `logs:CreateLogStream`+`logs:PutLogEvents` |
| `ZyviaExecutionRole` | IAM Role | `AmazonECSTaskExecutionRolePolicy` + `secretsmanager:GetSecretValue` (for secret injection at task start) |
| `ZyviaFargateService` | ECS Service | Min 2 / max 10 tasks; rolling deploy (min 50 % healthy, max 200 %); circuit breaker + rollback enabled |
| `ZyviaAlb` | Application Load Balancer | Internet-facing; in public subnets; AlbSecurityGroup |
| `HttpsListener` | ALB Listener | Port 443; default → ZyviaTargetGroup |
| `HttpRedirectListener` | ALB Listener | Port 80; redirect to HTTPS |
| `ZyviaTargetGroup` | Target Group | Protocol HTTP; port 3000; health check: `GET /v1/health`; healthy threshold 2; unhealthy threshold 3; interval 30 s |
| `CpuScalingPolicy` | Application Auto Scaling | Target 70 % CPU; scale-out cooldown 60 s; scale-in cooldown 300 s |
| `MemoryScalingPolicy` | Application Auto Scaling | Target 70 % memory; same cooldowns |

---

### ObservabilityStack

| Resource | Type | Key Configuration |
|----------|------|-------------------|
| `AppLogGroup` | CloudWatch Log Group | `/zyvia/api`; retention 90 days |
| `AlertTopic` | SNS Topic | Subscriber: operator email or Slack webhook (configured post-deploy) |
| `Http5xxAlarm` | CloudWatch Alarm | Metric: `HTTPCode_Target_5XX_Count`; threshold > 5 % of requests over 5 min; 1 datapoint to alarm |
| `TaskHealthAlarm` | CloudWatch Alarm | Metric: `HealthyHostCount` on target group < 1; period 60 s; 2 datapoints to alarm |
| `RdsConnectionAlarm` | CloudWatch Alarm | Metric: `DatabaseConnections` on ZyviaDb = 0; period 60 s; 2 datapoints to alarm |

---

## Cross-Stack Dependencies

```
NetworkStack
    └──> DataStack (VPC, private subnets, RdsSecurityGroup)
    └──> StorageStack (no VPC dependency; IAM only)
    └──> ComputeStack (VPC, subnets, AlbSecurityGroup, EcsSecurityGroup)
DataStack
    └──> ComputeStack (DbSecret ARN, DatabaseUrlSecret ARN)
StorageStack
    └──> ComputeStack (HealthRecordsBucket ARN for IAM task role)
ComputeStack
    └──> ObservabilityStack (ECS service name, ALB target group ARN)
```

---

## Secret Injection Map

The ECS task definition `secrets` field maps environment variable names to
Secrets Manager ARN + JSON key:

| Env Var | Source | Key |
|---------|--------|-----|
| `DATABASE_URL` | `DatabaseUrlSecret` | (full secret value) |
| `OBJECT_STORE_ACCESS_KEY` | `AwsAccessKeySecret` (or task role — preferred) | `accessKeyId` |
| `OBJECT_STORE_SECRET_KEY` | `AwsAccessKeySecret` (or task role — preferred) | `secretAccessKey` |
| `JWT_PUBLIC_KEY` | `JwtPublicKeySecret` | (full secret value) |

> **Note**: S3 access via IAM task role (no static credentials) is preferred
> and eliminates `OBJECT_STORE_ACCESS_KEY` and `OBJECT_STORE_SECRET_KEY`
> from Secrets Manager entirely. The storage service already uses
> `@aws-sdk/client-s3` which supports the default credential provider chain.

---

## Container Environment Variables (non-secret)

| Var | Value | Source |
|-----|-------|--------|
| `NODE_ENV` | `production` | Task definition plain env |
| `PORT` | `3000` | Task definition plain env |
| `OBJECT_STORE_ENDPOINT` | (empty / AWS default) | Not set in production (SDK uses regional endpoint) |
| `OBJECT_STORE_BUCKET` | `zyvia-health-records-<account>-<region>` | Task definition plain env |
| `OBJECT_STORE_REGION` | `ap-southeast-2` | Task definition plain env |

---

## Deployment State Transitions

```
[No infrastructure]
    ──(cdk bootstrap + cdk deploy NetworkStack)──>
[Network ready]
    ──(cdk deploy DataStack StorageStack)──>
[Data + Storage ready]
    ──(populate JwtPublicKeySecret manually)──>
[Secrets populated]
    ──(cdk deploy ComputeStack)──>
[Service running — smoke test /v1/health]
    ──(cdk deploy ObservabilityStack)──>
[Fully observable — alarms active]
    ──(enable GitHub Actions deploy.yml)──>
[CI/CD active — automated deployments live]
```
