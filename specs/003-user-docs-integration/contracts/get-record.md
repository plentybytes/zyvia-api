# Contract: GET /v1/records/:id

**Auth required**: Yes — Bearer JWT  
**Route file**: `zyvia-api/src/routes/records.ts`  
**Service**: `record.service.ts` → `getRecordById()`

## Behaviour Change Summary

No functional change for `patient`-role users — the route already uses `request.user.sub` as the patient ID for access control. This contract documents the expected behaviour post-integration for completeness.

## Request

```
GET /v1/records/:id
Authorization: Bearer <access_token>
```

**Path parameters**:

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string (UUID) | Yes | The document record ID |

## Responses

### 200 OK — Record detail returned

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "patient_id": "user-uuid",
  "record_type": {
    "id": "type-uuid",
    "name": "lab-result",
    "description": "Laboratory test results",
    "is_active": true,
    "created_at": "2026-01-01T00:00:00.000Z"
  },
  "file_name": "blood-test.pdf",
  "file_size_bytes": 204800,
  "mime_type": "application/pdf",
  "created_at": "2026-04-05T10:00:00.000Z",
  "download_url": "https://storage.example.com/signed-url?...",
  "download_url_expires_at": "2026-04-06T10:00:00.000Z"
}
```

### 401 Unauthorized — Missing or invalid token

Standard RFC 7807 problem details.

### 403 Forbidden — Administrator access attempt

```json
{
  "type": "https://zyvia.api/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "Administrators cannot access patient records",
  "instance": "/v1/records/550e8400-..."
}
```

### 404 Not Found — Record doesn't exist or belongs to another user

```json
{
  "type": "https://zyvia.api/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Record not found",
  "instance": "/v1/records/550e8400-..."
}
```

> A 404 is returned (not 403) when a user attempts to access another user's record — prevents confirming whether a record ID exists.

## Notes

- The `download_url` is a time-limited pre-authorized link; it expires after 24 hours.
- Patients can only access their own records. Providers can access any patient's record by ID.
- No change to this endpoint's logic — documented here for completeness.
