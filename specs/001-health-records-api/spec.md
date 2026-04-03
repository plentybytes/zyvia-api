# Feature Specification: Health Records Digitalization API

**Feature Branch**: `001-health-records-api`
**Created**: 2026-04-03
**Status**: Draft
**Input**: User description: "build a rest endpoints to manage health records digitalization include /upload, get /record add some records types"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload Health Record (Priority: P1)

A healthcare provider uploads a digital health record (document or image)
for a specific patient. The record is tagged with a type (e.g., Lab Result,
Prescription) and associated with the patient's identifier. After upload, the
provider receives a confirmation including a unique record ID.

**Why this priority**: Uploading records is the foundational capability — no
retrieval or management is possible without records in the system. This story
alone constitutes the minimum viable feature.

**Independent Test**: A provider submits a file along with a patient ID and
record type; the system accepts it and returns a record ID — fully verifiable
without any other story being implemented.

**Acceptance Scenarios**:

1. **Given** an authenticated provider with a valid patient ID, record type,
   and supported file, **When** they submit an upload request, **Then** the
   system stores the record and returns a unique record ID with HTTP 201.
2. **Given** an authenticated provider submits a file with an unsupported
   format or exceeds the maximum file size, **When** the upload is attempted,
   **Then** the system rejects the request with a descriptive error and HTTP 422.
3. **Given** an unauthenticated request, **When** any upload is attempted,
   **Then** the system returns HTTP 401.
4. **Given** a provider retries an upload with the same `Idempotency-Key`,
   **When** the first upload already succeeded, **Then** the system returns
   the original record ID without creating a duplicate (HTTP 200).

---

### User Story 2 - Retrieve Health Records (Priority: P2)

An authorized user (provider or patient) retrieves health records for a given
patient. Results can be filtered by record type and sorted by date. Individual
records can be fetched by their unique ID, returning metadata and a secure
time-limited download link for the file.

**Why this priority**: Retrieval is the second most critical capability —
it delivers value immediately after upload and supports day-to-day clinical
workflows.

**Independent Test**: Given records already seeded in the system, a caller
queries `GET /records?patient_id=X` and receives a paginated list, and
`GET /records/{id}` to retrieve a single record — testable independently of
the upload story.

**Acceptance Scenarios**:

1. **Given** a patient has existing records, **When** an authorized user
   requests records for that patient, **Then** a paginated list of record
   metadata (no file content) is returned with HTTP 200.
2. **Given** a valid record ID, **When** an authorized user requests that
   record, **Then** full metadata and a time-limited secure download link
   are returned with HTTP 200.
3. **Given** a `record_type` filter is applied, **When** the caller queries
   records, **Then** only records matching that type are returned.
4. **Given** a record ID that does not exist or belongs to a different
   patient, **When** a user requests it, **Then** the system returns HTTP 404.
5. **Given** a patient has no records, **When** their record list is
   requested, **Then** an empty list is returned with HTTP 200 (not 404).

---

### User Story 3 - Manage Record Types (Priority: P3)

An administrator views the catalogue of supported record types and can add new
ones. Healthcare providers see this catalogue when uploading, so it must
remain accurate and extensible.

**Why this priority**: Record types are reference data that enable proper
categorization. The system ships with sensible defaults; extensibility is
important but not blocking for initial delivery.

**Independent Test**: Admin calls `GET /record-types` and receives the default
catalogue; calls `POST /record-types` to add a new type and verifies it
appears in subsequent list calls — testable independently of upload or
retrieval stories.

**Acceptance Scenarios**:

1. **Given** the system is initialized with default types, **When** any
   authenticated user calls `GET /record-types`, **Then** the full catalogue
   of active record types is returned with HTTP 200.
2. **Given** an administrator submits a new record type with a unique name,
   **When** the request is processed, **Then** the type is added to the
   catalogue and returned with HTTP 201.
3. **Given** a duplicate record type name, **When** an admin tries to add it,
   **Then** the system returns HTTP 409 with a clear conflict message.
4. **Given** a non-admin user, **When** they attempt to create a record type,
   **Then** the system returns HTTP 403.
5. **Given** a record type is referenced by existing records, **When** an
   admin attempts to delete it, **Then** the system returns HTTP 409 and
   offers a soft-deprecation (mark inactive) option instead.

---

### Edge Cases

- What happens when a patient has no records? Returns an empty list with
  HTTP 200 — not a 404.
- What if the file storage service is unavailable during upload? The request
  fails with HTTP 503; no partial record is persisted.
- What if the same file is uploaded twice without an Idempotency-Key? The
  system stores it as a new record; callers must supply an Idempotency-Key to
  prevent duplicates.
- What if a record type is referenced by existing records and an admin tries
  to delete it? Deletion MUST be blocked; only soft-deprecation (marking
  inactive) is permitted.
- What if a download link expires before the user accesses it? The user must
  request the record again to get a fresh link; links are valid for 24 hours.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow authenticated users to upload health record
  files associated with a specific patient ID and record type.
- **FR-002**: The system MUST accept files in PDF, JPEG, PNG, and DICOM formats
  and MUST reject all other formats with a descriptive error.
- **FR-003**: The system MUST enforce a maximum file size of 50 MB per upload
  and reject larger files before storage.
- **FR-004**: The system MUST return a unique record ID and upload timestamp
  upon successful file storage (HTTP 201).
- **FR-005**: The system MUST support an optional `Idempotency-Key` request
  header on the upload endpoint to prevent duplicate record creation on
  retried requests.
- **FR-006**: The system MUST allow authorized users to list all health records
  for a given patient with support for `record_type` filtering and
  cursor-based pagination.
- **FR-007**: The system MUST allow authorized users to retrieve a single
  record's full metadata and a time-limited (≤ 24 hours) secure download
  link by record ID.
- **FR-008**: The system MUST provide a catalogue of supported record types
  readable by any authenticated user (`GET /record-types`).
- **FR-009**: On first boot the system MUST seed the catalogue with the
  following default record types: Lab Result, Prescription,
  Imaging / Radiology, Clinical Note, Vaccination Record, Discharge Summary,
  Referral Letter, Insurance Document.
- **FR-010**: The system MUST allow administrators to add new record types
  (`POST /record-types`) with a unique name and optional description.
- **FR-011**: The system MUST prevent hard deletion of record types referenced
  by existing records; soft-deprecation (marking a type inactive) MUST be
  available as the alternative.
- **FR-012**: All endpoints MUST require authentication. Three roles are
  supported: `patient` (upload and retrieve own records only), `provider`
  (upload and retrieve records for patients in their care scope),
  `administrator` (manage record types; no direct patient record access).
  Each role MUST be enforced at the authorization layer so cross-patient
  access is impossible.
- **FR-013**: All error responses MUST conform to the RFC 7807 Problem Details
  format (`type`, `title`, `status`, `detail`, `instance`).

### Key Entities

- **HealthRecord**: Represents a stored document. Key attributes: `id`,
  `patient_id`, `record_type_id`, `uploaded_by_user_id`, `file_name`,
  `file_size_bytes`, `mime_type`, `upload_timestamp`,
  `download_url_expires_at`, `idempotency_key` (nullable).
- **RecordType**: A category label for health records. Key attributes: `id`,
  `name`, `description`, `is_active`, `created_at`. System-seeded on
  initialization; extensible by administrators.
- **Patient**: An individual whose records are managed. Represented by an
  opaque `patient_id` — this API does not own patient registration.
- **User**: An authenticated caller. Roles: `patient` (upload and retrieve
  own records only), `provider` (upload and retrieve records for authorized
  patients), `administrator` (manage record types; no direct record access).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of record uploads complete and receive a confirmation in
  under 5 seconds for files up to 10 MB under normal operating load.
- **SC-002**: Record listing and single-record retrieval complete in under
  2 seconds for patients with up to 1,000 records.
- **SC-003**: The system correctly rejects 100% of unauthenticated and
  unauthorized requests with the appropriate HTTP status and error body.
- **SC-004**: A healthcare provider can upload a record and retrieve a
  download link for it within 3 end-to-end minutes.
- **SC-005**: The record type catalogue is accurate at all times — every type
  listed as active can be used in an upload; inactive or unknown types are
  always rejected.
- **SC-006**: Zero data loss for completed uploads — every record that
  receives HTTP 201 remains retrievable until explicitly deleted.
- **SC-007**: Duplicate uploads using the same `Idempotency-Key` return the
  original record ID 100% of the time without creating duplicate entries.

## Assumptions

- Patient registration and identity management are handled by an external
  system; this API receives a `patient_id` and trusts it is valid.
- Authentication is provided by an existing identity provider (OAuth2/JWT
  bearer tokens); this feature consumes tokens but does not issue them.
- File binary storage is delegated to an object store available as
  infrastructure; the API manages metadata and secure link generation.
- Role assignment (provider vs. administrator) is managed outside this
  feature's scope.
- Patients are a first-class caller role: they can upload their own records
  AND retrieve their own records directly via the API. Providers can upload
  and retrieve records for any patient they are authorized to treat.
  Administrators manage record types but do not access patient records
  directly. Authorization rules: patients MUST only access records where
  `patient_id` matches their own identity; providers MUST only access records
  for patients within their care scope.
- Compliance audit logging (e.g., access logs required by HIPAA/GDPR) is out
  of scope for this initial iteration and will be addressed in a follow-up
  feature.
- Mobile or browser-based client support is not in scope for this feature;
  the API is consumed by server-side or trusted clinical systems.
