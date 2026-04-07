# Contract: POST /v1/upload

**Auth required**: Yes — Bearer JWT  
**Route file**: `zyvia-api/src/routes/records.ts`  
**Service**: `record.service.ts` → `createRecord()`

## Behaviour Change Summary

| | Before (existing) | After (this feature) |
|-|-------------------|----------------------|
| `patient_id` for `patient` role | Required form field | **Derived from JWT `sub` automatically** |
| `patient_id` for `provider` role | Required form field | Still required in form field |
| Patient can set arbitrary `patient_id` | Yes (risk) | **No — silently overridden by JWT sub** |

## Request

```
POST /v1/upload
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**Form fields**:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `record_type_id` | string (UUID) | Yes | Must reference an active record type |
| `patient_id` | string | Only for `provider` role | Ignored for `patient` role (overridden by JWT) |
| file | binary | Yes | PDF, JPEG, PNG, or DICOM; max 50 MB |

**Headers** (optional):

| Header | Notes |
|--------|-------|
| `Idempotency-Key` | Optional string; if provided, prevents duplicate records within 24h |

## Responses

### 201 Created — Upload successful

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-04-05T10:00:00.000Z"
}
```

### 200 OK — Idempotent duplicate (same key submitted again)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-04-05T10:00:00.000Z"
}
```

### 401 Unauthorized — Missing or invalid token

```json
{
  "type": "https://zyvia.api/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Invalid or missing authorization token",
  "instance": "/v1/upload"
}
```

### 413 Payload Too Large — File exceeds 50 MB

```json
{
  "type": "https://zyvia.api/errors/payload-too-large",
  "title": "Payload Too Large",
  "status": 413,
  "detail": "File exceeds 50 MB size limit",
  "instance": "/v1/upload"
}
```

### 422 Unprocessable Entity — Invalid file type or missing fields

```json
{
  "type": "https://zyvia.api/errors/unprocessable-entity",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "Unsupported file type: text/plain. Allowed: application/pdf, image/jpeg, image/png, application/dicom",
  "instance": "/v1/upload"
}
```

### 503 Service Unavailable — Object store unreachable

```json
{
  "type": "https://zyvia.api/errors/service-unavailable",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "Object store unavailable",
  "instance": "/v1/upload"
}
```

## Notes

- For `patient`-role users: `patient_id` in the form data is ignored. The patient is always the owner of their own uploaded documents.
- For `provider`-role users: `patient_id` must be provided in the form data and is used as the document owner.
- Administrators cannot upload documents (403).
