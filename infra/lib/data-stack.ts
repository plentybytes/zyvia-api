import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly privateSubnets: ec2.ISubnet[];
  readonly ecsSecurityGroup: ec2.ISecurityGroup;
}

export class DataStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly databaseUrlSecret: secretsmanager.ISecret;
  public readonly jwtPublicKeySecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { vpc, privateSubnets, ecsSecurityGroup } = props;

    // Create RDS security group within DataStack to avoid circular dependency
    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc,
      description: 'RDS Security Group — allows PostgreSQL from ECS on port 5433',
      allowAllOutbound: false,
    });
    rdsSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(ecsSecurityGroup.securityGroupId),
      ec2.Port.tcp(5433),
      'PostgreSQL from ECS',
    );

    const subnetGroup = new rds.SubnetGroup(this, 'DbSubnetGroup', {
      vpc,
      description: 'Subnet group for Zyvia RDS PostgreSQL (private subnets)',
      vpcSubnets: { subnets: privateSubnets },
    });

    // Master credentials stored in Secrets Manager automatically
    const dbCredentials = rds.Credentials.fromGeneratedSecret('zyvia_admin', {
      secretName: 'zyvia/db-credentials',
    });

    this.dbInstance = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      credentials: dbCredentials,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      subnetGroup,
      securityGroups: [rdsSecurityGroup],
      multiAz: true,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: true,
      databaseName: 'zyvia',
      port: 5433,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Enable automatic secret rotation every 30 days
    this.dbInstance.addRotationSingleUser({
      automaticallyAfter: cdk.Duration.days(30),
    });

    // Constructed DATABASE_URL secret (referenced by ECS task)
    this.databaseUrlSecret = new secretsmanager.Secret(this, 'DatabaseUrlSecret', {
      secretName: 'zyvia/database-url',
      description: 'PostgreSQL connection string for ECS task — populate after RDS is provisioned',
      secretStringValue: cdk.SecretValue.unsafePlainText('PLACEHOLDER — replace after first deploy'),
    });

    // JWT public key secret — populated manually before first deploy
    this.jwtPublicKeySecret = new secretsmanager.Secret(this, 'JwtPublicKeySecret', {
      secretName: 'zyvia/jwt-public-key',
      description: 'RS256 public key PEM — populate manually before first ECS deploy',
      secretStringValue: cdk.SecretValue.unsafePlainText('PLACEHOLDER — replace with PEM before first deploy'),
    });

    new cdk.CfnOutput(this, 'DbInstanceEndpoint', {
      value: this.dbInstance.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint hostname',
    });

    new cdk.CfnOutput(this, 'DatabaseUrlSecretArn', {
      value: this.databaseUrlSecret.secretArn,
      description: 'ARN of the DATABASE_URL secret in Secrets Manager',
    });
  }
}
