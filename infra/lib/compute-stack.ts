import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly publicSubnets: ec2.ISubnet[];
  readonly privateSubnets: ec2.ISubnet[];
  readonly albSecurityGroup: ec2.ISecurityGroup;
  readonly ecsSecurityGroup: ec2.ISecurityGroup;
  readonly databaseUrlSecret: secretsmanager.ISecret;
  readonly jwtPublicKeySecret: secretsmanager.ISecret;
  readonly healthRecordsBucket: s3.IBucket;
  readonly imageTag: string;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly fargateService: ecs.FargateService;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const {
      vpc,
      publicSubnets,
      privateSubnets,
      albSecurityGroup,
      ecsSecurityGroup,
      databaseUrlSecret,
      jwtPublicKeySecret,
      healthRecordsBucket,
      imageTag,
    } = props;

    // ECR private repository
    const repository = new ecr.Repository(this, 'EcrRepository', {
      repositoryName: 'zyvia-api',
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep last 10 images',
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ECS cluster with Container Insights
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'zyvia',
      containerInsights: true,
    });

    // CloudWatch log group
    const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
      logGroupName: '/zyvia/api',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Task role — application-level AWS permissions
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS task role for zyvia-api — S3 access + Secrets Manager read',
    });
    healthRecordsBucket.grantReadWrite(taskRole);
    databaseUrlSecret.grantRead(taskRole);
    jwtPublicKeySecret.grantRead(taskRole);

    // Execution role — ECS control plane permissions (pull image, push logs, read secrets)
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
      description: 'ECS task execution role — image pull + CloudWatch logs',
    });
    databaseUrlSecret.grantRead(executionRole);
    jwtPublicKeySecret.grantRead(executionRole);

    // Task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole,
      executionRole,
    });

    taskDefinition.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'zyvia-api',
        logGroup,
      }),
      environment: {
        PORT: '3000',
        NODE_ENV: 'production',
        OBJECT_STORE_BUCKET: healthRecordsBucket.bucketName,
        OBJECT_STORE_REGION: this.region,
        OBJECT_STORE_ENDPOINT: `https://s3.${this.region}.amazonaws.com`,
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(databaseUrlSecret),
        JWT_PUBLIC_KEY: ecs.Secret.fromSecretsManager(jwtPublicKeySecret),
      },
    });

    // ALB (internet-facing)
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnets: publicSubnets },
      securityGroup: albSecurityGroup,
    });

    // Target group
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/v1/health',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: cdk.Duration.seconds(30),
      },
    });

    // HTTP listener — HTTP-only deployment (no TLS termination at ALB)
    this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.targetGroup],
    });

    // Fargate service
    this.fargateService = new ecs.FargateService(this, 'FargateService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 2,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: { subnets: privateSubnets },
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
    });

    // Register service with target group
    this.fargateService.attachToApplicationTargetGroup(this.targetGroup);

    // Auto-scaling
    const scaling = this.fargateService.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 10 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });
    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 70,
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
      description: 'ALB DNS name — use for smoke tests and GitHub Actions ALB_DNS_NAME variable',
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR repository URI — set as ECR_REPOSITORY in GitHub Actions',
    });

    new cdk.CfnOutput(this, 'EcsClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS cluster name — set as ECS_CLUSTER in GitHub Actions',
    });

    new cdk.CfnOutput(this, 'EcsFargateServiceName', {
      value: this.fargateService.serviceName,
      description: 'ECS service name — set as ECS_SERVICE in GitHub Actions',
    });
  }
}
