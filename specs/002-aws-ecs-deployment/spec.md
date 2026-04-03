# Feature Specification: AWS ECS Fargate Deployment

**Feature Branch**: `002-aws-ecs-deployment`
**Created**: 2026-04-03
**Status**: Draft
**Input**: User description: "deploy zyvia-api to AWS ECS Fargate with RDS PostgreSQL and S3"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Provision Infrastructure and Deploy Service (Priority: P1)

A platform engineer runs a single infrastructure-as-code command that
provisions the complete AWS environment — networking, compute, database,
storage, and load balancer — and deploys the Zyvia API container. Within
minutes the service is reachable via a public HTTPS URL, health checks pass,
and the API returns correct responses.

**Why this priority**: Nothing else works until the base infrastructure exists
and the service is running. This story alone constitutes the minimum viable
deployment.

**Independent Test**: After running the IaC apply command, hit
`GET https://<alb-dns>/v1/health` from outside the VPC and receive
`{"status": "ok"}` with HTTP 200. Hit `GET /v1/ready` and confirm both the
database and object store dependencies are reachable.

**Acceptance Scenarios**:

1. **Given** an AWS account with no existing Zyvia infrastructure, **When**
   the IaC provisioning command completes, **Then** the ALB DNS resolves,
   `GET /v1/health` returns HTTP 200, and `GET /v1/ready` returns HTTP 200
   confirming all dependencies are healthy.
2. **Given** the service is running, **When** a valid health record upload
   request is sent to `POST /v1/upload` with a real JWT, **Then** the request
   succeeds (HTTP 201), a record ID is returned, and the file is retrievable
   via `GET /v1/records/:id`.
3. **Given** the ECS task is running, **When** the container fails its
   readiness check three consecutive times, **Then** ECS replaces the task
   automatically and the ALB stops routing traffic to the unhealthy instance.
4. **Given** a deployment is in progress, **When** the new task fails its
   health check, **Then** the deployment is rolled back and the previous
   version continues serving traffic.

---

### User Story 2 - Automated CI/CD Pipeline (Priority: P2)

A developer merges a pull request to the `main` branch. Without any manual
steps, the pipeline builds a new container image, runs the full test suite,
pushes the image to the container registry, and deploys it to the ECS service.
The developer can observe the pipeline progress and is notified of success or
failure.

**Why this priority**: Manual deployments are error-prone and slow. Automated
delivery is essential before the service receives any real traffic.

**Independent Test**: Merge a trivial code change to `main` (e.g., a comment
update). Observe the pipeline run to completion without manual intervention.
Confirm the new image tag is running in ECS by checking the task definition
revision or a version endpoint.

**Acceptance Scenarios**:

1. **Given** a merged pull request to `main`, **When** the pipeline runs,
   **Then** it builds the container image, runs all test suites, and reports
   a pass/fail result — all without manual intervention.
2. **Given** a failing test suite, **When** the pipeline runs, **Then**
   the deployment step is skipped and the pipeline is marked failed; the
   previously deployed version continues running.
3. **Given** a successful build and test run, **When** the pipeline deploys,
   **Then** the new image is live in ECS within 10 minutes of the merge and
   the rollback guard (health check) is active during the transition.
4. **Given** a deployment that fails its health check post-deploy, **When**
   the pipeline detects the failure, **Then** it rolls back to the previous
   task definition revision automatically.

---

### User Story 3 - Observability and Alerting (Priority: P3)

An operations engineer can view structured request logs, monitor error rates
and latency, and receives an alert when the service becomes unhealthy or error
rates exceed acceptable thresholds — all without accessing the container
directly.

**Why this priority**: Without observability, production incidents are
invisible until users report them. This story protects the service's
reliability after it is live.

**Independent Test**: Trigger a deliberate error (e.g., send a request with
an invalid JWT) and confirm the structured log entry appears in the central
log store within 60 seconds, containing `request_id`, `status: 401`, and
`duration_ms`. Then simulate a health check failure and confirm an alert
fires within 5 minutes.

**Acceptance Scenarios**:

1. **Given** the service is running and receiving traffic, **When** any
   request is processed, **Then** a structured log entry containing
   `request_id`, `method`, `url`, `status`, and `duration_ms` appears in
   the central log store within 60 seconds.
2. **Given** the error rate exceeds 5 % of requests over a 5-minute window,
   **When** the threshold is breached, **Then** an alert is triggered and
   delivered to the on-call channel within 5 minutes.
3. **Given** the `/v1/ready` endpoint returns non-200 for more than
   2 consecutive minutes, **When** the unhealthy threshold is crossed,
   **Then** an alert fires and the ECS service attempts task replacement.
4. **Given** a new deployment completes, **When** an operator views the
   observability dashboard, **Then** they can see the deployment event
   correlated with any change in error rate or latency.

---

### Edge Cases

- What happens if the RDS instance is unavailable during initial provisioning?
  The ECS task MUST fail its readiness check and remain unhealthy; the ALB
  MUST NOT route traffic; an operator alert MUST fire.
- What if the container image push to the registry fails mid-pipeline? The
  deploy step MUST be skipped; the existing running version MUST be preserved.
- What if secrets rotation changes a database password while the service is
  running? The service MUST pick up the new credentials on next task restart
  without requiring a code change or manual deployment.
- What if the S3 bucket policy is misconfigured after provisioning? The
  `GET /v1/ready` endpoint MUST return 503 (bucket unreachable), alerting
  operators before any user traffic fails.
- What if two pipeline runs trigger simultaneously? Only one deployment MUST
  be active at a time; the second MUST queue or fail explicitly — no
  concurrent ECS deployments.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The infrastructure MUST be defined entirely as code (IaC); no
  AWS resources required for normal operation may be created or modified via
  the AWS console.
- **FR-002**: The Zyvia API container MUST run on AWS ECS Fargate in a private
  subnet; direct internet access to the container MUST be blocked.
- **FR-003**: All inbound HTTPS traffic MUST route through an Application Load
  Balancer (ALB) that terminates TLS; HTTP requests MUST be redirected to
  HTTPS.
- **FR-004**: The ALB MUST be configured to use `/v1/health` as the target
  group health check path; unhealthy tasks MUST be drained and replaced
  automatically.
- **FR-005**: The relational database (RDS PostgreSQL) MUST run in a private
  subnet with no public endpoint; only the ECS task security group MUST have
  inbound access on the database port.
- **FR-006**: Database schema migrations MUST run automatically as part of
  the deployment pipeline before the new ECS task receives traffic.
- **FR-007**: The object storage bucket (S3) MUST have public access blocked
  at the bucket policy level; all objects MUST be encrypted at rest.
- **FR-008**: All application secrets (database credentials, JWT public key,
  object store credentials) MUST be stored in a secrets manager and injected
  into the ECS task at runtime; they MUST NOT appear in plaintext in task
  definitions, container images, or IaC source files.
- **FR-009**: The CI/CD pipeline MUST build the container image, run the full
  test suite, push to the container registry, and deploy to ECS on every
  merge to `main`; any test failure MUST abort the deployment.
- **FR-010**: The pipeline MUST perform a rolling deployment with a minimum of
  one healthy task running at all times during the transition.
- **FR-011**: If a newly deployed task fails its health check within the
  deployment window, the pipeline MUST automatically roll back to the previous
  task definition revision.
- **FR-012**: Structured logs from all ECS tasks MUST be forwarded to a
  centralized log store and retained for a minimum of 90 days.
- **FR-013**: Metric alarms MUST be configured for: HTTP 5xx error rate
  > 5 % (5-minute window), task health check failures, and database
  connection errors; alarms MUST deliver notifications to an operator channel.
- **FR-014**: The deployment MUST support at minimum 2 concurrently running
  ECS tasks for high availability; auto-scaling MUST add tasks when CPU
  or memory utilization exceeds 70 % for 3 consecutive minutes.

### Key Entities

- **VPC**: Isolated network containing all Zyvia infrastructure. Has public
  subnets (ALB only) and private subnets (ECS tasks, RDS) across at least
  2 availability zones.
- **ECS Cluster / Service / Task Definition**: The compute layer. Task
  definition references the container image, resource limits, environment
  variables, and secret injection config.
- **Container Registry**: Stores versioned container images. Each pipeline
  run produces an image tagged with the Git commit SHA.
- **Application Load Balancer**: Public-facing entry point. Handles TLS
  termination, health checks, and traffic routing to ECS tasks.
- **RDS PostgreSQL Instance**: Managed relational database in a private
  subnet. Holds all health record metadata and record type catalogue.
- **S3 Bucket**: Object store for health record binary files. Accessed via
  IAM role attached to the ECS task; no static credentials used.
- **Secrets Store**: Holds all runtime secrets. Referenced by ARN in the
  task definition; secrets are never stored in environment variable
  plaintext.
- **CI/CD Pipeline**: Automated workflow triggered by a push to `main`.
  Stages: build image → test → push → migrate DB → deploy to ECS.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new developer can provision the complete production environment
  from scratch using a single command in under 30 minutes, with no manual AWS
  console steps required.
- **SC-002**: A code change merged to `main` is live in production within
  10 minutes, measured from merge time to new tasks passing health checks.
- **SC-003**: The service achieves 99.9 % uptime measured over a rolling
  30-day window, as verified by the ALB health check success rate.
- **SC-004**: Zero secrets appear in plaintext in any IaC file, container
  image layer, task definition, or CI/CD pipeline log — verified by automated
  secret scanning on every pipeline run.
- **SC-005**: 100 % of structured log entries for production requests appear
  in the central log store within 60 seconds of the request completing.
- **SC-006**: An alert fires within 5 minutes of the error rate exceeding 5 %
  or any ECS task becoming permanently unhealthy.
- **SC-007**: A failed deployment is detected and rolled back within 5 minutes
  of the health check failure threshold being crossed, with no user-visible
  downtime exceeding that window.

## Assumptions

- An AWS account is available with sufficient service quotas for ECS Fargate,
  RDS, S3, ALB, VPC, ECR, and Secrets Manager.
- A domain name or subdomain is available for TLS certificate provisioning
  (or an ACM certificate already exists); the ALB DNS name alone is
  acceptable for initial deployment.
- The CI/CD pipeline runs on GitHub Actions (the repository is hosted on
  GitHub); alternative CI systems are out of scope for this feature.
- A single AWS region deployment is sufficient for v1; multi-region
  failover is out of scope.
- The RDS instance uses single-AZ deployment for v1; Multi-AZ promotion is
  a follow-up operational task outside this feature's scope.
- The `main` branch is the sole deployment target; staging and production
  environment separation is out of scope for v1 but the IaC MUST be
  parameterised to support it in future.
- AWS CDK (TypeScript) is the chosen IaC tool, consistent with the project's
  existing TypeScript stack; Terraform is not in scope.
- IAM roles and policies follow the principle of least privilege; the ECS
  task role grants only the permissions needed for S3 access and Secrets
  Manager reads.
