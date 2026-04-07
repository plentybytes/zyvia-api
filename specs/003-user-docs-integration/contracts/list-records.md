# Contract: GET /v1/records

**Auth required**: Yes — Bearer JWT  
**Route file**: `zyvia-api/src/routes/records.ts`  
**Service**: `record.service.ts` → `listRecords()`

## Behaviour Change Summary

| | Before (existing) | After (this feature) |
|-|-------------------|----------------------|
| `patient_id` for `patient` role | Required query param | **Optional — defaults to JWT `sub`** |
| `patient_id` for `provider` role | Required query param | Still required |
| Patient can list another user's records | Yes (risk) | **No — JWT sub always used for patient role** |

## Request

```
GET /v1/records
Authorization: Bearer <access_token>
```

**Query parameters**:

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `patient_id` | string | Only for `provider` role | For `patient` role: optional, ignored if provided |
| `record_type_id` | string (UUID) | No | Filter by document category |
| `cursor` | string | No | Pagination cursor from previous response |
| `limit` | number | No | Results per page; default 20, max 100 |

## Responses

### 200 OK — Records returned

```json
{
  "data": [
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
      "created_at": "2026-04-05T10:00:00.000Z"
    }
  ],
  "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNi0wNC0wNVQxMDowMDowMC4wMDBaIiwiaWQiOiJ1dWlkIn0",
  "has_more": true
}
```

### 401 Unauthorized

Standard RFC 7807 problem details.

### 422 Unprocessable Entity — provider called without patient_id

```json
{
  "type": "https://zyvia.api/errors/unprocessable-entity",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "patient_id is required for provider role",
  "instance": "/v1/records"
}
```

## Notes

- Patients calling `GET /v1/records` with no query params will receive their own document list.
- Results are ordered by `created_at` descending (most recent first).
- Empty result set returns `{"data": [], "next_cursor": null, "has_more": false}` — not an error.
