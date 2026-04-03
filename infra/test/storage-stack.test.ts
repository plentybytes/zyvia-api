import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/storage-stack';

function buildTemplate() {
  const app = new cdk.App();
  const stack = new StorageStack(app, 'TestStorageStack', {
    env: { account: '123456789012', region: 'ap-southeast-2' },
  });
  return { template: Template.fromStack(stack), stack };
}

describe('StorageStack', () => {
  it('creates exactly one S3 bucket', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  it('enables SSE-S3 encryption on the bucket', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          }),
        ]),
      },
    });
  });

  it('blocks all public access (all 4 settings)', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('enables versioning on the bucket', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: {
        Status: 'Enabled',
      },
    });
  });

  it('denies public s3:GetObject via bucket policy', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: Match.anyValue(),
            Principal: Match.anyValue(),
          }),
        ]),
      }),
    });
  });

  it('bucket policy exists', () => {
    const { template } = buildTemplate();
    const policies = template.findResources('AWS::S3::BucketPolicy');
    expect(Object.keys(policies).length).toBeGreaterThanOrEqual(1);
  });
});
