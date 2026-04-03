import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { ComputeStack } from '../lib/compute-stack';

function buildTemplate() {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-southeast-2' };

  const vpcStack = new cdk.Stack(app, 'VpcStack', { env });
  const vpc = new ec2.Vpc(vpcStack, 'Vpc', { maxAzs: 2, natGateways: 1 });
  const albSg = new ec2.SecurityGroup(vpcStack, 'AlbSg', { vpc });
  const ecsSg = new ec2.SecurityGroup(vpcStack, 'EcsSg', { vpc });

  const secretsStack = new cdk.Stack(app, 'SecretsStack', { env });
  const databaseUrlSecret = new secretsmanager.Secret(secretsStack, 'DbUrl');
  const jwtPublicKeySecret = new secretsmanager.Secret(secretsStack, 'JwtKey');

  const storageStack = new cdk.Stack(app, 'StorageStack', { env });
  const healthRecordsBucket = new s3.Bucket(storageStack, 'Bucket');

  const stack = new ComputeStack(app, 'TestComputeStack', {
    env,
    vpc,
    publicSubnets: vpc.publicSubnets,
    privateSubnets: vpc.privateSubnets,
    albSecurityGroup: albSg,
    ecsSecurityGroup: ecsSg,
    databaseUrlSecret,
    jwtPublicKeySecret,
    healthRecordsBucket,
    imageTag: 'latest',
  });

  return { template: Template.fromStack(stack), stack };
}

describe('ComputeStack', () => {
  it('creates a Fargate task definition', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RequiresCompatibilities: Match.arrayWith(['FARGATE']),
      NetworkMode: 'awsvpc',
    });
  });

  it('container exposes port 3000', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          PortMappings: Match.arrayWith([
            Match.objectLike({ ContainerPort: 3000 }),
          ]),
        }),
      ]),
    });
  });

  it('Fargate service assigns no public IP', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ECS::Service', {
      NetworkConfiguration: Match.objectLike({
        AwsvpcConfiguration: Match.objectLike({
          AssignPublicIp: 'DISABLED',
        }),
      }),
    });
  });

  it('ALB listener is on port 443', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
    });
  });

  it('HTTP listener on 80 redirects to 443', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
      DefaultActions: Match.arrayWith([
        Match.objectLike({
          Type: 'redirect',
          RedirectConfig: Match.objectLike({ Protocol: 'HTTPS', StatusCode: 'HTTP_301' }),
        }),
      ]),
    });
  });

  it('target group health check uses /v1/health path', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/v1/health',
    });
  });

  it('DATABASE_URL is injected from Secrets Manager (not plaintext)', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'DATABASE_URL' }),
          ]),
        }),
      ]),
    });
  });

  it('JWT_PUBLIC_KEY is injected from Secrets Manager (not plaintext)', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'JWT_PUBLIC_KEY' }),
          ]),
        }),
      ]),
    });
  });

  it('task role has S3 permissions on the health records bucket', () => {
    const { template } = buildTemplate();
    // CDK grantReadWrite uses wildcard forms like s3:GetObject*, s3:PutObject
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['s3:PutObject']),
          }),
        ]),
      }),
    });
  });

  it('auto-scaling minimum is 2 tasks', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: 2,
    });
  });

  it('auto-scaling maximum is 10 tasks', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MaxCapacity: 10,
    });
  });
});
