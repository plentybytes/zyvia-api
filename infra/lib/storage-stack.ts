import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class StorageStack extends cdk.Stack {
  public readonly healthRecordsBucket: s3.Bucket;
  public readonly loggingBucket: s3.Bucket;
  public readonly bucketName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 logging bucket
    this.loggingBucket = new s3.Bucket(this, 'LoggingBucket', {
      bucketName: `zyvia-access-logs-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'DeleteOldLogs',
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // Enforce HTTPS on logging bucket
    this.loggingBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyNonHttpsAccessToLogs',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [
          this.loggingBucket.bucketArn,
          this.loggingBucket.arnForObjects('*'),
        ],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      }),
    );

    this.healthRecordsBucket = new s3.Bucket(this, 'HealthRecordsBucket', {
      bucketName: `zyvia-health-records-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      serverAccessLogsBucket: this.loggingBucket,
      serverAccessLogsPrefix: 'health-records-access/',
      lifecycleRules: [
        {
          id: 'TransitionToIA',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Explicitly deny non-HTTPS access
    this.healthRecordsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyNonHttpsAccess',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [
          this.healthRecordsBucket.bucketArn,
          this.healthRecordsBucket.arnForObjects('*'),
        ],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      }),
    );

    // Explicitly deny public GetObject (defense in depth on top of BlockPublicAccess)
    this.healthRecordsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyPublicGetObject',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:GetObject'],
        resources: [this.healthRecordsBucket.arnForObjects('*')],
        conditions: {
          StringNotEquals: {
            'aws:PrincipalAccount': this.account,
          },
        },
      }),
    );

    this.bucketName = this.healthRecordsBucket.bucketName;

    new cdk.CfnOutput(this, 'HealthRecordsBucketName', {
      value: this.bucketName,
      description: 'S3 bucket name for health records — set as OBJECT_STORE_BUCKET env var',
    });
  }
}
