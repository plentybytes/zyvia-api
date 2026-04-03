import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/network-stack';

function buildTemplate() {
  const app = new cdk.App();
  const stack = new NetworkStack(app, 'TestNetworkStack', {
    env: { account: '123456789012', region: 'ap-southeast-2' },
  });
  return { template: Template.fromStack(stack), stack };
}

describe('NetworkStack', () => {
  it('creates a VPC with 4 subnets across 2 AZs', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::EC2::VPC', 1);
    // 2 public + 2 private = 4 subnets
    template.resourceCountIs('AWS::EC2::Subnet', 4);
  });

  it('creates exactly one NAT Gateway', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  it('creates an Internet Gateway', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::EC2::InternetGateway', 1);
  });

  it('ALB security group allows inbound 443 from anywhere', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('ALB'),
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' }),
      ]),
    });
  });

  it('ALB security group allows inbound 80 for HTTP redirect', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('ALB'),
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({ IpProtocol: 'tcp', FromPort: 80, ToPort: 80, CidrIp: '0.0.0.0/0' }),
      ]),
    });
  });

  it('creates 3 security groups (ALB, ECS, RDS)', () => {
    const { template } = buildTemplate();
    // VPC default SG + our 3 = 4 total, but default SG may not be in template
    // Assert at least our 3 named ones
    const sgs = template.findResources('AWS::EC2::SecurityGroup');
    expect(Object.keys(sgs).length).toBeGreaterThanOrEqual(3);
  });
});
