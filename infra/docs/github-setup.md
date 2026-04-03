# GitHub Actions Setup Guide

This guide explains how to configure GitHub Actions variables for the zyvia-api
CI/CD pipeline after the CDK stacks have been deployed.

## Prerequisites

- CDK stacks deployed: `ZyviaNetwork`, `ZyviaData`, `ZyviaStorage`, `ZyviaCompute`
- GitHub repository admin access

## Step 1: Retrieve CDK Stack Outputs

Run the following to get all required values:

```bash
cd infra

# Network stack
aws cloudformation describe-stacks --stack-name ZyviaNetwork \
  --query 'Stacks[0].Outputs' --output table

# Data stack
aws cloudformation describe-stacks --stack-name ZyviaData \
  --query 'Stacks[0].Outputs' --output table

# Storage stack
aws cloudformation describe-stacks --stack-name ZyviaStorage \
  --query 'Stacks[0].Outputs' --output table

# Compute stack
aws cloudformation describe-stacks --stack-name ZyviaCompute \
  --query 'Stacks[0].Outputs' --output table
```

## Step 2: Set GitHub Actions Variables

Navigate to your repository → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab.

Add the following **repository variables** (not secrets — no static credentials):

| Variable | Where to find the value |
|----------|------------------------|
| `AWS_ACCOUNT_ID` | Your AWS account number (12 digits) |
| `AWS_REGION` | `ap-southeast-2` (or your chosen region) |
| `AWS_DEPLOY_ROLE_ARN` | `GitHubActionsRoleArn` output from `ZyviaCompute` or OIDC role stack |
| `ECR_REPOSITORY` | `zyvia-api` (fixed name set in `ComputeStack`) |
| `ECS_CLUSTER` | `EcsClusterName` output from `ZyviaCompute` |
| `ECS_SERVICE` | `EcsFargateServiceName` output from `ZyviaCompute` |
| `ECS_TASK_DEFINITION` | Task definition family name — run `aws ecs list-task-definition-families` |
| `MIGRATION_SUBNET_ID` | Any private subnet ID from `ZyviaNetwork` |
| `MIGRATION_SECURITY_GROUP` | ECS security group ID from `ZyviaNetwork` |
| `ALB_DNS_NAME` | `AlbDnsName` output from `ZyviaCompute` |

### Quick retrieval commands

```bash
# ECS cluster name
aws ecs list-clusters --query 'clusterArns[?contains(@, `zyvia`)]' --output text

# ECS service name
aws ecs list-services --cluster zyvia --query 'serviceArns[0]' --output text | xargs -I{} aws ecs describe-services --cluster zyvia --services {} --query 'services[0].serviceName' --output text

# Task definition family
aws ecs list-task-definition-families --family-prefix Zyvia --query 'families[0]' --output text

# Private subnet ID (first one)
aws ec2 describe-subnets \
  --filters "Name=tag:aws-cdk:subnet-type,Values=Private" \
  --query 'Subnets[0].SubnetId' --output text

# ECS security group ID
aws ec2 describe-security-groups \
  --filters "Name=description,Values=*ECS Security Group*" \
  --query 'SecurityGroups[0].GroupId' --output text

# ALB DNS name
aws elbv2 describe-load-balancers \
  --query 'LoadBalancers[?contains(LoadBalancerName, `Zyvia`)].DNSName' \
  --output text
```

## Step 3: Register the GitHub OIDC Provider (first-time only)

If you haven't already registered the GitHub OIDC provider in your AWS account:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

> This is idempotent — safe to run even if already registered.

## Step 4: Verify

Push a commit to `main` and confirm:
1. Stage 1 (Build & Test) turns green
2. Stage 2 (Push Image) pushes to ECR
3. Stage 3 (Migrations) exits code 0
4. Stage 4 (Deploy) ECS service stabilises
5. Stage 5 (Smoke Test) returns `{"status":"ok"}`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `NotAuthorized` on OIDC assume | Verify `AWS_DEPLOY_ROLE_ARN` is correct and the OIDC provider is registered |
| Migration task exits non-zero | Check ECS task logs in CloudWatch `/zyvia/api` log group |
| ECS service rollback | Circuit breaker triggered — check container health check logs |
| Smoke test fails | ALB certificate may be self-signed placeholder — check ACM configuration |
