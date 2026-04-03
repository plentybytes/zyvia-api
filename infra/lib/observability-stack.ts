import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  /** Concrete FargateService — needed for metricCpuUtilization / metricMemoryUtilization */
  readonly fargateService: ecs.FargateService;
  /** Concrete ApplicationTargetGroup — needed for targetGroupFullName CloudWatch dimension */
  readonly targetGroup: elbv2.ApplicationTargetGroup;
  readonly alertEmail: string;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly alertTopicArn: string;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { fargateService, targetGroup, alertEmail } = props;

    // SNS topic for all alarms
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'zyvia-alerts',
      displayName: 'Zyvia API Alerts',
    });

    if (alertEmail) {
      alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));
    }

    const snsAction = new cloudwatchActions.SnsAction(alertTopic);

    // 5xx error rate alarm (ALB target group level)
    const http5xxAlarm = new cloudwatch.Alarm(this, 'Http5xxAlarm', {
      alarmName: 'zyvia-api-5xx-rate',
      alarmDescription: 'HTTP 5xx error rate from ECS target group > 5% over 5 minutes',
      metric: new cloudwatch.MathExpression({
        expression: '(m1 / m2) * 100',
        usingMetrics: {
          m1: new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_5XX_Count',
            dimensionsMap: {
              TargetGroup: targetGroup.targetGroupFullName,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          m2: new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: {
              TargetGroup: targetGroup.targetGroupFullName,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    http5xxAlarm.addAlarmAction(snsAction);

    // Healthy host count alarm
    const healthyHostAlarm = new cloudwatch.Alarm(this, 'HealthyHostCountAlarm', {
      alarmName: 'zyvia-api-healthy-host-count',
      alarmDescription: 'ALB target group healthy host count dropped below 1',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HealthyHostCount',
        dimensionsMap: {
          TargetGroup: targetGroup.targetGroupFullName,
        },
        statistic: 'Minimum',
        period: cdk.Duration.seconds(60),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    healthyHostAlarm.addAlarmAction(snsAction);

    // ECS CPU utilization alarm
    const cpuAlarm = new cloudwatch.Alarm(this, 'CpuAlarm', {
      alarmName: 'zyvia-api-cpu-high',
      alarmDescription: 'ECS service CPU utilization > 85% for 5 minutes',
      metric: fargateService.metricCpuUtilization({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 85,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    cpuAlarm.addAlarmAction(snsAction);

    // CloudWatch dashboard
    new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'zyvia-api',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Request Count',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/ApplicationELB',
                metricName: 'RequestCount',
                dimensionsMap: { TargetGroup: targetGroup.targetGroupFullName },
                statistic: 'Sum',
                period: cdk.Duration.minutes(1),
              }),
            ],
          }),
          new cloudwatch.GraphWidget({
            title: '5xx Error Rate (%)',
            left: [
              new cloudwatch.MathExpression({
                expression: '(m1 / m2) * 100',
                usingMetrics: {
                  m1: new cloudwatch.Metric({
                    namespace: 'AWS/ApplicationELB',
                    metricName: 'HTTPCode_Target_5XX_Count',
                    dimensionsMap: { TargetGroup: targetGroup.targetGroupFullName },
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(1),
                  }),
                  m2: new cloudwatch.Metric({
                    namespace: 'AWS/ApplicationELB',
                    metricName: 'RequestCount',
                    dimensionsMap: { TargetGroup: targetGroup.targetGroupFullName },
                    statistic: 'Sum',
                    period: cdk.Duration.minutes(1),
                  }),
                },
                period: cdk.Duration.minutes(1),
              }),
            ],
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'ECS CPU Utilization (%)',
            left: [
              fargateService.metricCpuUtilization({
                period: cdk.Duration.minutes(1),
                statistic: 'Average',
              }),
            ],
          }),
          new cloudwatch.GraphWidget({
            title: 'ECS Memory Utilization (%)',
            left: [
              fargateService.metricMemoryUtilization({
                period: cdk.Duration.minutes(1),
                statistic: 'Average',
              }),
            ],
          }),
        ],
      ],
    });

    this.alertTopicArn = alertTopic.topicArn;

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'SNS alert topic ARN — subscribe Slack/PagerDuty webhooks here',
    });
  }
}
