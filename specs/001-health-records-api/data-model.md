# Data Model: Health Records Digitalization API

**Feature**: 001-health-records-api
**Date**: 2026-04-03

---

## Entities

### health_records

Stores metadata for each uploaded health record file. Binary content lives in
the object store; only the storage key is persisted here.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, NOT NULL, default gen_random_uuid() | Stable public identifier |
| `patient_id` | VARCHAR(255) | NOT NULL, indexed | Opaque external identifier |
| `record_type_id` | UUID | NOT NULL, FK → record_types.id | Denies unknown types |
| `uploaded_by_user_id` | VARCHAR(255) | NOT NULL | From JWT `sub` claim |
| `file_name` | VARCHAR(512) | NOT NULL | Original client filename |
| `file_size_bytes` | BIGINT | NOT NULL, CHECK > 0 | Used for quota/monitoring |
| `mime_type` | VARCHAR(128) | NOT NULL | One of: application/pdf, image/jpeg, image/png, application/dicom |
| `storage_key` | VARCHAR(1024) | NOT NULL, UNIQUE | Object store path (never exposed to callers) |
| `idempotency_key` | VARCHAR(255) | UNIQUE, NULLABLE | Expires after 24 h; partial unique index |
| `idempotency_key_expires_at` | TIMESTAMPTZ | NULLABLE | NULL when idempotency_key is NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | Used as pagination cursor anchor |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | Updated on soft-delete |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete; excluded from default queries |

**Indexes**:
- `(patient_id, created_at DESC, id DESC)` — primary list query
- `(patient_id, record_type_id, created_at DESC, id DESC)` — filtered list
- `UNIQUE (idempotency_key) WHERE idempotency_key IS NOT NULL` — partial unique index

**Validation rules** (enforced at API boundary, not DB):
- `file_size_bytes` ≤ 52,428,800 (50 MB)
- `mime_type` ∈ {application/pdf, image/jpeg, image/png, application/dicom}

---

### record_types

Catalogue of health record categories. Seeded on first boot; extensible by
administrators.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, NOT NULL, default gen_random_uuid() | |
| `name` | VARCHAR(255) | NOT NULL, UNIQUE | Display name; case-insensitive unique index |
| `description` | TEXT | NULLABLE | Optional human-readable description |
| `is_active` | BOOLEAN | NOT NULL, default true | False = soft-deprecated |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() | |

**Indexes**:
- `UNIQUE LOWER(name)` — prevent duplicate names regardless of case

**Seed data** (applied on first boot if table is empty):

| Name | Description |
|------|-------------|
| Lab Result | Laboratory test results and pathology reports |
| Prescription | Medication prescriptions and drug orders |
| Imaging / Radiology | X-ray, MRI, CT, ultrasound, and other imaging files |
| Clinical Note | Physician or nurse notes from consultations |
| Vaccination Record | Immunization history and vaccine certificates |
| Discharge Summary | Hospital discharge documentation |
| Referral Letter | Specialist or inter-facility referral documents |
| Insurance Document | Health insurance claims, authorizations, and EOBs |

---

## Relationships

```
record_types ──< health_records
  (one record_type has many health_records; a record_type cannot be hard-deleted
   if health_records reference it)
```

---

## State Transitions

### HealthRecord lifecycle

```
[Uploaded] ──(soft-delete)──> [Deleted]
```

No other state transitions in v1. Records are immutable after upload — updates
to content require a new upload.

### RecordType lifecycle

```
[Active] ──(deprecate)──> [Inactive]
[Inactive] ──(re-activate)──> [Active]
```

Hard deletion blocked while any `health_records` row references the type.

---

## Download URL Generation

Download URLs are NOT stored in the database. They are generated on-demand by
the storage service as pre-signed object store URLs:

- TTL: 24 hours from request time
- URL contains: storage_key (opaque), expiry signature
- The `storage_key` column is never returned to callers; only the generated
  pre-signed URL is exposed

---

## Cursor-Based Pagination

The list endpoint uses a composite cursor over `(created_at, id)`:

```
cursor = base64url( JSON.stringify({ created_at: "2026-04-03T12:00:00Z", id: "<uuid>" }) )
```

Query pattern (descending order, newest first):

```sql
WHERE patient_id = $1
  AND (created_at, id) < (cursor.created_at, cursor.id)
  [AND record_type_id = $type_filter]
ORDER BY created_at DESC, id DESC
LIMIT 21  -- fetch 21, return 20, has_more = (count == 21)
```
