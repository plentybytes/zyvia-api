# Feature Specification: Dev Auth Bypass and Patient Access Controls

**Feature Branch**: `003-dev-auth-patient-access`  
**Created**: 2026-04-04  
**Status**: Draft  
**Input**: User description: "disable auth in dev, patient can only upload and get to view records"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer works without authentication tokens (Priority: P1)

A developer running the API locally can call any endpoint without providing a JWT token.
When the server is in development mode, all requests are treated as authenticated with a
configurable default identity (a test patient) so the developer can exercise the full API
without obtaining or rotating tokens.

**Why this priority**: Removing the token friction for local development is the single
biggest productivity improvement — every other local workflow depends on it.

**Independent Test**: Start the server in development mode and call the records list endpoint
with no `Authorization` header. The request succeeds and returns a (possibly empty) list.

**Acceptance Scenarios**:

1. **Given** the server is running in development mode, **When** a request is made to any protected endpoint with no `Authorization` header, **Then** the request succeeds as if authenticated with the dev identity
2. **Given** the server is running in development mode, **When** a request is made with a valid JWT token, **Then** the token is still accepted (bypass is additive, not disruptive)
3. **Given** the server is running in production mode, **When** a request is made with no `Authorization` header, **Then** the request is rejected with an authentication error
4. **Given** the server is running in development mode, **When** the server starts, **Then** a visible warning is logged stating that authentication is disabled

---

### User Story 2 - Patient is restricted to uploading and viewing their own records (Priority: P2)

A patient authenticated with a patient-role token can upload new health records and retrieve
their own records (list and individual). Patients cannot modify or delete records, cannot
access other patients' records, and cannot manage record types.

**Why this priority**: Tightening patient permissions closes an access control gap — patients
should only have the minimum access needed for their use case.

**Independent Test**: Authenticate as a patient and attempt four actions: upload a record
(succeeds), list own records (succeeds), view own record by ID (succeeds), create a record
type (rejected). All four outcomes are verifiable with a single patient token.

**Acceptance Scenarios**:

1. **Given** a patient is authenticated, **When** they upload a health record, **Then** the record is saved and associated with their identity
2. **Given** a patient is authenticated, **When** they list health records, **Then** only their own records are returned
3. **Given** a patient is authenticated, **When** they retrieve a specific record by ID that belongs to them, **Then** the record details are returned
4. **Given** a patient is authenticated, **When** they attempt to retrieve a record belonging to a different patient, **Then** the request is rejected
5. **Given** a patient is authenticated, **When** they attempt to create or update a record type, **Then** the request is rejected

---

### Edge Cases

- What happens when the dev bypass identity tries to access a specific record by ID? (The dev identity has a fixed patient ID; only records belonging to that ID are accessible)
- What happens if the server is accidentally started in development mode in a cloud environment? (Auth bypass must activate only on `NODE_ENV=development`; any other value keeps auth enforced)
- What happens when a patient calls an endpoint that does not exist for their role? (A clear, consistent error is returned — not a silent failure or data leak)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST bypass JWT verification for all protected endpoints when `NODE_ENV` is `development`
- **FR-002**: When auth is bypassed, the request MUST be treated as authenticated with a fixed development identity: role `patient`, patient ID `dev-patient-001`
- **FR-003**: Auth bypass MUST be inactive when `NODE_ENV` is any value other than `development` (including unset)
- **FR-004**: When auth bypass is active, the system MUST emit a clearly visible warning at startup indicating that authentication is disabled
- **FR-005**: Patient role MUST be permitted to upload health records
- **FR-006**: Patient role MUST be permitted to list their own health records
- **FR-007**: Patient role MUST be permitted to retrieve a single health record by ID, only if it belongs to them
- **FR-008**: Patient role MUST NOT be permitted to access record type management endpoints (create, update)
- **FR-009**: Patient role MUST NOT be permitted to access records belonging to other patients
- **FR-010**: Provider and administrator role permissions MUST remain unchanged

### Key Entities

- **Dev Identity**: A synthetic authenticated user injected when auth is bypassed; fixed attributes: role `patient`, patient ID `dev-patient-001`
- **Patient Permission Set**: The complete list of allowed actions for the patient role — upload record, list own records, view own record by ID

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can successfully call all patient-accessible endpoints locally with zero authentication setup — no token generation, no key files required
- **SC-002**: 100% of patient-role requests to non-permitted endpoints are rejected before any business logic executes
- **SC-003**: Auth bypass is provably inactive when the environment is not development — verifiable by automated test without deploying
- **SC-004**: All existing provider and administrator test scenarios continue to pass without modification

## Assumptions

- Development mode is identified exclusively by `NODE_ENV=development`; no other flag or config key is used
- The dev identity patient ID (`dev-patient-001`) does not need to exist in the database — requests returning empty results are acceptable in dev
- Provider permissions (access to authorised patients' records) are not changed by this feature
- Administrator permissions (record type management) are not changed by this feature
- This feature applies only to the local development server; it is out of scope for any shared, staging, or cloud environment
