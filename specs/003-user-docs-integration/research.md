# Research: User Identity Integration with Health Record Document Storage

**Feature**: 003-user-docs-integration  
**Date**: 2026-04-05  
**Status**: Complete — all decisions resolved

---

## Decision 1: Where to Derive patient_id — Route vs Service

- **Decision**: Derive `patient_id` from `request.user.sub` in the route handler, before calling the service
- **Rationale**: `record.service.ts` is already correct — it accepts `patientId` as input and stores it. The service has no knowledge of HTTP or JWT. Adding JWT awareness to the service would violate separation of concerns. The route is the right place to translate JWT identity into the `patientId` field passed to the service.
- **Alternatives considered**: Adding a `useCallerAsPatient` flag to the service input — unnecessary complexity; the route already has all the information needed

---

## Decision 2: Backward Compatibility for Provider Role

- **Decision**: For `provider`-role users, continue to accept an optional `patient_id` in request body/query. For `patient`-role users, ignore any `patient_id` in the request and always use `request.user.sub`.
- **Rationale**: Providers upload documents on behalf of their patients — they legitimately need to specify which patient a record belongs to. Patients are always uploading for themselves. Silently ignoring a patient-provided `patient_id` prevents privilege escalation (a patient cannot upload a record attributed to another user by passing a different ID).
- **Alternatives considered**: Making `patient_id` required for all roles — breaks the user experience for patients; making it optional for all roles without role-based logic — creates security risk where a patient could set any `patient_id`

---

## Decision 3: What to Do with `uploaded_by_user_id`

- **Decision**: For patient uploads, `uploaded_by_user_id` = `patient_id` = `request.user.sub`. The same field can remain the uploader ID.
- **Rationale**: When a patient uploads their own document, they are both the patient and the uploader. The existing service already accepts both fields separately — no change needed.
- **Alternatives considered**: Adding a separate `owner_id` vs `uploader_id` distinction — not required at this scope

---

## Decision 4: GET /v1/records — Remove Required patient_id Query Param for Patients

- **Decision**: Make `patient_id` optional in the `GET /v1/records` query schema. If the caller is a `patient`, derive `patient_id` from `request.user.sub`. If the caller is a `provider`, require `patient_id` to be provided.
- **Rationale**: Patients should be able to call `GET /v1/records` with no query parameters and see their own documents. This is the natural self-service experience. Providers still need to specify which patient's records to fetch.
- **Alternatives considered**: Adding a separate `/v1/my/records` endpoint for patients — adds URL complexity without benefit; the role-based derivation is simpler and doesn't require new routing

---

## Decision 5: assertPatientAccess Middleware — Keep or Simplify

- **Decision**: Keep `assertPatientAccess` for the `GET /v1/records/:id` and `POST /v1/upload` flows, but call it with the derived `patient_id` (not a client-supplied one for patients)
- **Rationale**: `assertPatientAccess` correctly enforces that patients can only access records where `request.user.sub === patientId`. Since we now always derive `patientId = request.user.sub` for patients, `assertPatientAccess` becomes a no-op safety check for patients (always passes). It still provides value for providers accessing records. Removing it would be a security regression.
- **Alternatives considered**: Removing `assertPatientAccess` entirely — too risky; simplifying to a single `if (user.role === 'administrator') reject` check — functionally equivalent but loses the helper's consistency
