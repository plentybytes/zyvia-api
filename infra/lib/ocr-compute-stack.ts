import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface OcrComputeStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly publicSubnets: ec2.ISubnet[];
  readonly privateSubnets: ec2.ISubnet[];
  readonly albSecurityGroup: ec2.ISecurityGroup;
  /** Shared ECS cluster (same 'zyvia' cluster as zyvia-api) */
  readonly cluster: ecs.ICluster;
  /** Existing SNS alert topic from the observability stack */
  readonly alertTopic: sns.ITopic;
  readonly imageTag: string;
}

/**
 * CDK stack for the zyvia-ocr ECS Fargate service.
 *
 * Additive only — does NOT modify any existing zyvia-api stacks.
 * Shares the same VPC, ECS cluster, and SNS alert topic.
 */
export class OcrComputeStack extends cdk.Stack {
  public readonly fargateService: ecs.FargateService;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: OcrComputeStackProps) {
    super(scope, id, props);

    const {
      vpc,
      publicSubnets,
      privateSubnets,
      albSecurityGroup,
      cluster,
      alertTopic,
      imageTag,
    } = props;

    // ── Secrets ─────────────────────────────────────────────────────────────
    const paddleOcrUrlSecret = new secretsmanager.Secret(this, 'PaddleOcrUrl', {
      secretName: 'zyvia/paddle-ocr-url',
      description: 'External PaddleOCR service base URL',
    });

    const paddleOcrApiKeySecret = new secretsmanager.Secret(this, 'PaddleOcrApiKey', {
      secretName: 'zyvia/paddle-ocr-api-key',
      description: 'External PaddleOCR service API key (if auth required)',
    });

    // Anthropic API key is shared with zyvia-api — reference existing secret
    const anthropicApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'AnthropicApiKey', 'zyvia/anthropic-api-key',
    );

    // ── ECR Repository ───────────────────────────────────────────────────────
    const repository = new ecr.Repository(this, 'OcrEcrRepository', {
      repositoryName: 'zyvia-ocr',
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10, description: 'Keep last 10 images' }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Security Group (OCR ECS tasks) ───────────────────────────────────────
    const ocrEcsSecurityGroup = new ec2.SecurityGroup(this, 'OcrEcsSg', {
      vpc,
      description: 'zyvia-ocr ECS tasks — allows port 8080 from ALB only',
    });
    ocrEcsSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(8080));

    // ── CloudWatch Log Group ─────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'OcrLogGroup', {
      logGroupName: '/zyvia/ocr',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── IAM Roles ────────────────────────────────────────────────────────────
    const executionRole = new iam.Role(this, 'OcrExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    paddleOcrUrlSecret.grantRead(executionRole);
    paddleOcrApiKeySecret.grantRead(executionRole);
    anthropicApiKeySecret.grantRead(executionRole);

    const taskRole = new iam.Role(this, 'OcrTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS task role for zyvia-ocr — Secrets Manager read',
    });
    paddleOcrUrlSecret.grantRead(taskRole);
    paddleOcrApiKeySecret.grantRead(taskRole);
    anthropicApiKeySecret.grantRead(taskRole);

    // ── Task Definition ──────────────────────────────────────────────────────
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'OcrTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1536, // Java JVM needs more than Node.js
      taskRole,
      executionRole,
    });

    taskDefinition.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
      portMappings: [{ containerPort: 8080 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'zyvia-ocr',
        logGroup,
      }),
      environment: {
        PORT: '8080',
        SPRING_PROFILES_ACTIVE: 'prod',
      },
      secrets: {
        PADDLE_OCR_BASE_URL: ecs.Secret.fromSecretsManager(paddleOcrUrlSecret),
        PADDLE_OCR_API_KEY: ecs.Secret.fromSecretsManager(paddleOcrApiKeySecret),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicApiKeySecret),
      },
      // Allow 30s for JVM startup before health checks begin
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:8080/v1/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
    });

    // ── ALB + Target Group ───────────────────────────────────────────────────
    const ocrAlb = new elbv2.ApplicationLoadBalancer(this, 'OcrAlb', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnets: publicSubnets },
      securityGroup: albSecurityGroup,
    });

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'OcrTargetGroup', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/v1/health',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: cdk.Duration.seconds(30),
      },
    });

    ocrAlb.addListener('OcrHttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [
        elbv2.ListenerCertificate.fromArn(
          this.node.tryGetContext('acmCertificateArn') as string ??
          `arn:aws:acm:${this.region}:${this.account}:certificate/PLACEHOLDER`,
        ),
      ],
      defaultTargetGroups: [this.targetGroup],
    });

    ocrAlb.addListener('OcrHttpRedirectListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // ── Fargate Service ──────────────────────────────────────────────────────
    this.fargateService = new ecs.FargateService(this, 'OcrFargateService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
      securityGroups: [ocrEcsSecurityGroup],
      vpcSubnets: { subnets: privateSubnets },
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      serviceName: 'zyvia-ocr',
    });

    this.fargateService.attachToApplicationTargetGroup(this.targetGroup);

    const scaling = this.fargateService.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 10 });
    scaling.scaleOnCpuUtilization('OcrCpuScaling', { targetUtilizationPercent: 70 });
    scaling.scaleOnMemoryUtilization('OcrMemoryScaling', { targetUtilizationPercent: 70 });

    // ── CloudWatch Alarms ─────────────────────────────────────────────────────
    const snsAction = new cloudwatchActions.SnsAction(alertTopic);

    new cloudwatch.Alarm(this, 'OcrHttp5xxAlarm', {
      alarmName: 'zyvia-ocr-5xx-rate',
      metric: new cloudwatch.MathExpression({
        expression: '(m1 / m2) * 100',
        usingMetrics: {
          m1: new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_5XX_Count',
            dimensionsMap: { TargetGroup: this.targetGroup.targetGroupFullName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          m2: new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: { TargetGroup: this.targetGroup.targetGroupFullName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, 'OcrHealthyHostAlarm', {
      alarmName: 'zyvia-ocr-healthy-host-count',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HealthyHostCount',
        dimensionsMap: { TargetGroup: this.targetGroup.targetGroupFullName },
        statistic: 'Minimum',
        period: cdk.Duration.seconds(60),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, 'OcrCpuAlarm', {
      alarmName: 'zyvia-ocr-cpu-high',
      metric: this.fargateService.metricCpuUtilization({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 85,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'OcrAlbDnsName', {
      value: ocrAlb.loadBalancerDnsName,
      description: 'OCR service ALB DNS — set as OCR_ALB_DNS_NAME in GitHub Actions',
    });

    new cdk.CfnOutput(this, 'OcrEcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR repository URI — set as OCR_ECR_REPOSITORY in GitHub Actions',
    });
  }
}
