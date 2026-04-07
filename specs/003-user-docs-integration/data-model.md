# Data Model: User Identity Integration with Health Record Document Storage

**Feature**: 003-user-docs-integration  
**Date**: 2026-04-05

---

## No New Entities

This feature introduces no new database tables or migrations. The existing schema already supports all required functionality:

| Table | Role in this feature |
|-------|---------------------|
| `users` (from feature 001) | Provides the authenticated user identity; `users.id` becomes `patient_id` for patient uploads |
| `health_records` (existing) | `patient_id` already stores the owner; `uploaded_by_user_id` stores the uploader — both will be `request.user.sub` for patient self-uploads |
| `record_types` (existing) | Unchanged — still used for categorising documents |

---

## Existing Entity: health_records (unchanged)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Unchanged |
| `patient_id` | VARCHAR(255) | **Integration point**: for patient uploads, this will now always equal `users.id` from the JWT |
| `record_type_id` | UUID FK → record_types.id | Unchanged |
| `uploaded_by_user_id` | VARCHAR(255) | For patient self-uploads: equals `patient_id`; for provider uploads: equals the provider's user ID |
| `file_name` | VARCHAR(512) | Unchanged |
| `file_size_bytes` | BIGINT | Unchanged |
| `mime_type` | VARCHAR(128) | Unchanged — allowed types: PDF, JPEG, PNG, DICOM |
| `storage_key` | VARCHAR(1024) UNIQUE | Unchanged |
| `idempotency_key` | VARCHAR(255) nullable | Unchanged |
| `idempotency_key_expires_at` | TIMESTAMP nullable | Unchanged — 24h TTL |
| `created_at` | TIMESTAMP | Unchanged |
| `updated_at` | TIMESTAMP | Unchanged |
| `deleted_at` | TIMESTAMP nullable | Unchanged — soft delete |

---

## Identity Mapping After Integration

```
users.id (registered via POST /v1/auth/register)
    │
    └── JWT token claim: { sub: users.id, role: 'patient' }
              │
              └── POST /v1/upload (patient role)
                        │
                        ├── patient_id    = request.user.sub = users.id
                        └── uploaded_by_user_id = request.user.sub = users.id
```

For providers:
```
JWT token claim: { sub: provider_users.id, role: 'provider' }
    │
    └── POST /v1/upload (provider role)
              │
              ├── patient_id    = form field `patient_id` (explicitly provided)
              └── uploaded_by_user_id = request.user.sub (the provider)
```
