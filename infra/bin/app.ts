#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { StorageStack } from '../lib/storage-stack';
import { ComputeStack } from '../lib/compute-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { OcrComputeStack } from '../lib/ocr-compute-stack';
import * as sns from 'aws-cdk-lib/aws-sns';

const app = new cdk.App();

const account = app.node.tryGetContext('account') as string | undefined;
const region = (app.node.tryGetContext('region') as string | undefined) ?? 'ap-southeast-2';
const imageTag = (app.node.tryGetContext('imageTag') as string | undefined) ?? 'latest';
const alertEmail = (app.node.tryGetContext('alertEmail') as string | undefined) ?? '';

const env: cdk.Environment = { account, region };

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
  imageTag,
});

const observability = new ObservabilityStack(app, 'ZyviaObservability', {
  env,
  fargateService: compute.fargateService,
  targetGroup: compute.targetGroup,
  alertEmail,
});

// ── zyvia-ocr: OCR microservice (additive — does not modify zyvia-api stacks) ─
const ocrCompute = new OcrComputeStack(app, 'ZyviaOcrCompute', {
  env,
  vpc: network.vpc,
  publicSubnets: network.publicSubnets,
  privateSubnets: network.privateSubnets,
  albSecurityGroup: network.albSecurityGroup,
  cluster: compute.cluster,
  alertTopic: sns.Topic.fromTopicArn(app, 'AlertTopic', observability.alertTopicArn),
  imageTag,
});
void ocrCompute;

// Suppress unused variable warning — stacks register themselves with the CDK app
void observability;

// cdk-nag: apply AWS Solutions security checks to all stacks
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Intentional suppressions (documented with rationale)
NagSuppressions.addStackSuppressions(
  network,
  [
    {
      id: 'AwsSolutions-VPC7',
      reason: 'VPC Flow Logs omitted for v1 cost optimisation — add before production use',
    },
  ],
);

NagSuppressions.addStackSuppressions(
  network,
  [
    {
      id: 'AwsSolutions-EC23',
      reason: 'ALB SG intentionally allows 0.0.0.0/0 on 443 — public-facing load balancer',
    },
  ],
);
