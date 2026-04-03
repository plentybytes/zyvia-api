import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GitHubOidcRoleProps {
  /** GitHub org/user name, e.g. "myorg" */
  readonly githubOrg: string;
  /** GitHub repository name, e.g. "zyvia-api" */
  readonly githubRepo: string;
  /** Branch that is allowed to assume this role (default: "main") */
  readonly branch?: string;
}

/**
 * Creates a GitHub Actions OIDC IAM role that allows the CI/CD pipeline to
 * authenticate to AWS without static credentials.
 */
export class GitHubOidcRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubOidcRoleProps) {
    super(scope, id);

    const { githubOrg, githubRepo, branch = 'main' } = props;

    // GitHub OIDC provider (already exists in the account after first bootstrap)
    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubProvider',
      `arn:aws:iam::${cdk.Stack.of(this).account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${githubOrg}/${githubRepo}:ref:refs/heads/${branch}`,
        },
      }),
      description: `GitHub Actions OIDC role for ${githubOrg}/${githubRepo} (${branch})`,
    });

    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: this.role.roleArn,
      description: 'IAM role ARN for GitHub Actions OIDC — set as AWS_DEPLOY_ROLE_ARN in repo secrets',
      exportName: 'GitHubActionsRoleArn',
    });
  }
}
