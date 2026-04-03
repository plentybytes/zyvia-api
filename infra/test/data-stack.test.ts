import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DataStack } from '../lib/data-stack';

function buildTemplate() {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-southeast-2' };

  // Minimal VPC for dependency injection
  const vpcStack = new cdk.Stack(app, 'VpcStack', { env });
  const vpc = new ec2.Vpc(vpcStack, 'Vpc', { maxAzs: 2, natGateways: 1 });
  const rdsSecurityGroup = new ec2.SecurityGroup(vpcStack, 'RdsSG', { vpc });

  const stack = new DataStack(app, 'TestDataStack', {
    env,
    vpc,
    privateSubnets: vpc.privateSubnets,
    rdsSecurityGroup,
  });

  return { template: Template.fromStack(stack), stack };
}

describe('DataStack', () => {
  it('creates a PostgreSQL 16 RDS instance', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: Match.stringLikeRegexp('^16'),
      DBInstanceClass: 'db.t4g.medium',
    });
  });

  it('places RDS in a private subnet group', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBSubnetGroupName: Match.anyValue(),
    });
  });

  it('enables storage encryption', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      StorageEncrypted: true,
    });
  });

  it('enables deletion protection', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DeletionProtection: true,
    });
  });

  it('creates a Secrets Manager secret for DB credentials', () => {
    const { template } = buildTemplate();
    // At least the RDS master user secret
    const secrets = template.findResources('AWS::SecretsManager::Secret');
    expect(Object.keys(secrets).length).toBeGreaterThanOrEqual(1);
  });

  it('creates a secret for JWT public key', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: Match.stringLikeRegexp('jwt'),
    });
  });

  it('creates a secret for the database URL', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: Match.stringLikeRegexp('database-url'),
    });
  });
});
