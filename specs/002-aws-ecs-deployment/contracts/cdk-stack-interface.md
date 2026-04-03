# CDK Stack Interface Contract

**Feature**: 002-aws-ecs-deployment
**Date**: 2026-04-03

Defines the props each CDK stack accepts and the outputs it exports to
dependent stacks. This contract governs how stacks are composed in
`infra/bin/app.ts`.

---

## NetworkStack

```typescript
interface NetworkStackProps extends cdk.StackProps {
  // No custom props required — all configuration is internal defaults
  // or derived from CDK context (account, region).
}

interface NetworkStackOutputs {
  vpc: ec2.Vpc;
  privateSubnets: ec2.ISubnet[];
  publicSubnets: ec2.ISubnet[];
  albSecurityGroup: ec2.SecurityGroup;
  ecsSecurityGroup: ec2.SecurityGroup;
  rdsSecurityGroup: ec2.SecurityGroup;
}
```

---

## DataStack

```typescript
interface DataStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  privateSubnets: ec2.ISubnet[];
  rdsSecurityGroup: ec2.ISecurityGroup;
}

interface DataStackOutputs {
  dbInstance: rds.DatabaseInstance;
  databaseUrlSecret: secretsmanager.ISecret;
  jwtPublicKeySecret: secretsmanager.ISecret;
}
```

---

## StorageStack

```typescript
interface StorageStackProps extends cdk.StackProps {
  // No VPC dependency — S3 is a global service accessed via IAM.
}

interface StorageStackOutputs {
  healthRecordsBucket: s3.Bucket;
  bucketName: string; // Exported as SSM parameter for task definition
}
```

---

## ComputeStack

```typescript
interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  publicSubnets: ec2.ISubnet[];
  privateSubnets: ec2.ISubnet[];
  albSecurityGroup: ec2.ISecurityGroup;
  ecsSecurityGroup: ec2.ISecurityGroup;
  databaseUrlSecret: secretsmanager.ISecret;
  jwtPublicKeySecret: secretsmanager.ISecret;
  healthRecordsBucket: s3.IBucket;
  imageTag: string; // Git commit SHA passed via CDK context: -c imageTag=<sha>
}

interface ComputeStackOutputs {
  cluster: ecs.Cluster;
  fargateService: ecs.FargateService;
  alb: elbv2.ApplicationLoadBalancer;
  targetGroup: elbv2.ApplicationTargetGroup;
  albDnsName: string; // CfnOutput for smoke testing
}
```

---

## ObservabilityStack

```typescript
interface ObservabilityStackProps extends cdk.StackProps {
  fargateService: ecs.IFargateService;
  targetGroup: elbv2.IApplicationTargetGroup;
  alertEmail: string; // CDK context: -c alertEmail=ops@example.com
}

interface ObservabilityStackOutputs {
  alertTopicArn: string; // CfnOutput for manual Slack webhook subscription
}
```

---

## CDK App Composition (`infra/bin/app.ts`)

```typescript
const network = new NetworkStack(app, 'ZyviaNetwork', { env });

const data = new DataStack(app, 'ZyviaData', {
  env,
  vpc: network.vpc,
  privateSubnets: network.privateSubnets,
  rdsSecurityGroup: network.rdsSecurityGroup,
});

const storage = new StorageStack(app, 'ZyviaStorage', { env });

const compute = new ComputeStack(app, 'ZyviaCompute', {
  env,
  vpc: network.vpc,
  publicSubnets: network.publicSubnets,
  privateSubnets: network.privateSubnets,
  albSecurityGroup: network.albSecurityGroup,
  ecsSecurityGroup: network.ecsSecurityGroup,
  databaseUrlSecret: data.databaseUrlSecret,
  jwtPublicKeySecret: data.jwtPublicKeySecret,
  healthRecordsBucket: storage.healthRecordsBucket,
  imageTag: app.node.tryGetContext('imageTag') ?? 'latest',
});

const observability = new ObservabilityStack(app, 'ZyviaObservability', {
  env,
  fargateService: compute.fargateService,
  targetGroup: compute.targetGroup,
  alertEmail: app.node.tryGetContext('alertEmail') ?? '',
});
```

---

## CDK Context Parameters

| Key | Required | Description | Example |
|-----|----------|-------------|---------|
| `imageTag` | Yes (deploy) | ECR image tag (Git commit SHA) | `abc1234` |
| `alertEmail` | Yes (observability) | SNS alarm notification recipient | `ops@example.com` |
| `account` | Yes | AWS account ID | `123456789012` |
| `region` | No | AWS region (default: `ap-southeast-2`) | `us-east-1` |
