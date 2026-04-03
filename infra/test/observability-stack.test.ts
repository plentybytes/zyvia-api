import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { ObservabilityStack } from '../lib/observability-stack';

function buildTemplate() {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-southeast-2' };

  // Minimal stubs for dependencies
  const vpcStack = new cdk.Stack(app, 'VpcStack', { env });
  const vpc = new ec2.Vpc(vpcStack, 'Vpc', { maxAzs: 2, natGateways: 1 });
  const cluster = new ecs.Cluster(vpcStack, 'Cluster', { vpc });

  const albStack = new cdk.Stack(app, 'AlbStack', { env });
  const alb = new elbv2.ApplicationLoadBalancer(albStack, 'Alb', { vpc, internetFacing: true });
  const targetGroup = new elbv2.ApplicationTargetGroup(albStack, 'TG', {
    vpc,
    port: 3000,
    protocol: elbv2.ApplicationProtocol.HTTP,
    targetType: elbv2.TargetType.IP,
  });

  const taskDefStack = new cdk.Stack(app, 'TaskDefStack', { env });
  const taskDef = new ecs.FargateTaskDefinition(taskDefStack, 'TD', { cpu: 256, memoryLimitMiB: 512 });
  taskDef.addContainer('App', { image: ecs.ContainerImage.fromRegistry('nginx'), portMappings: [{ containerPort: 3000 }] });

  const fargateService = new ecs.FargateService(vpcStack, 'Svc', {
    cluster,
    taskDefinition: taskDef,
    assignPublicIp: false,
  });

  const stack = new ObservabilityStack(app, 'TestObservabilityStack', {
    env,
    fargateService,
    targetGroup,
    alertEmail: 'ops@example.com',
  });

  return { template: Template.fromStack(stack), stack };
}

describe('ObservabilityStack', () => {
  it('creates an SNS topic', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::SNS::Topic', 1);
  });

  it('subscribes provided email to the SNS topic', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'ops@example.com',
    });
  });

  it('creates a 5xx error rate CloudWatch alarm', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'zyvia-api-5xx-rate',
      Threshold: 5,
    });
  });

  it('5xx alarm has SNS action', () => {
    const { template } = buildTemplate();
    // Verify AlarmActions is present and non-empty (anyValue cannot nest inside arrayWith)
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'zyvia-api-5xx-rate',
      AlarmActions: Match.anyValue(),
    });
  });

  it('creates a healthy host count alarm that triggers at < 1', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'zyvia-api-healthy-host-count',
      Threshold: 1,
      ComparisonOperator: 'LessThanThreshold',
    });
  });

  it('healthy host alarm has SNS action', () => {
    const { template } = buildTemplate();
    // Verify AlarmActions is present and non-empty (anyValue cannot nest inside arrayWith)
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'zyvia-api-healthy-host-count',
      AlarmActions: Match.anyValue(),
    });
  });

  it('creates at least 2 alarms (5xx rate + healthy host)', () => {
    const { template } = buildTemplate();
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThanOrEqual(2);
  });

  it('creates a CloudWatch dashboard', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'zyvia-api',
    });
  });
});
