# Auth Behaviour Contract

**Feature**: 003-dev-auth-patient-access  
**Date**: 2026-04-04

Documents the authentication and authorisation behaviour for all protected
endpoints, including the development-mode bypass.

---

## Authentication Modes

### Production Mode (`NODE_ENV` ≠ `development`)

All protected endpoints require a valid JWT bearer token in the
`Authorization` header.

```
Authorization: Bearer <JWT>
```

Missing or invalid tokens → `401 Unauthorized` (RFC 7807 Problem Details).

### Development Mode (`NODE_ENV=development`)

JWT verification is bypassed. Requests with **no** `Authorization` header
are treated as authenticated with the **dev identity**:

| Field | Value |
|-------|-------|
| `sub` (user ID / patient ID) | `dev-patient-001` |
| `role` | `patient` |

Requests that **do** include a valid `Authorization: Bearer <JWT>` header are
still verified normally — the bypass is additive.

A startup warning is emitted:

```json
{ "level": 40, "msg": "⚠ AUTHENTICATION DISABLED — running in development mode (NODE_ENV=development)" }
```

---

## Patient Permission Matrix

| Endpoint | Patient role | Reason |
|----------|-------------|--------|
| `POST /v1/upload` | ✅ Allowed — own `patient_id` only | Core use case |
| `GET /v1/records?patient_id=` | ✅ Allowed — own `patient_id` only | Core use case |
| `GET /v1/records/:id` | ✅ Allowed — own records only | Core use case |
| `GET /v1/record-types` | ✅ Allowed — read-only | Required to choose type on upload |
| `POST /v1/record-types` | ❌ 403 Forbidden | Admin-only operation |
| `PATCH /v1/record-types/:id` | ❌ 403 Forbidden | Admin-only operation |

### Cross-patient Access

A patient attempting to access another patient's records receives:

- `POST /v1/upload` with mismatched `patient_id` → `403 Forbidden`
- `GET /v1/records?patient_id=<other>` → `403 Forbidden`
- `GET /v1/records/:id` for a record owned by another patient → `404 Not Found`

`404` (rather than `403`) is used for the by-ID case to avoid confirming
that the record exists.

---

## Provider Permission Matrix (unchanged)

| Endpoint | Provider role |
|----------|--------------|
| `POST /v1/upload` | ✅ Any `patient_id` |
| `GET /v1/records?patient_id=` | ✅ Any `patient_id` |
| `GET /v1/records/:id` | ✅ Any record |
| `GET /v1/record-types` | ✅ Read-only |
| `POST /v1/record-types` | ❌ 403 |
| `PATCH /v1/record-types/:id` | ❌ 403 |

---

## Administrator Permission Matrix (unchanged)

| Endpoint | Administrator role |
|----------|--------------------|
| `POST /v1/upload` | ❌ 403 |
| `GET /v1/records?patient_id=` | ❌ 403 |
| `GET /v1/records/:id` | ❌ 403 |
| `GET /v1/record-types` | ✅ Read + inactive types |
| `POST /v1/record-types` | ✅ Create |
| `PATCH /v1/record-types/:id` | ✅ Update |

---

## Error Responses

All auth/authz failures use RFC 7807 Problem Details:

```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Invalid or missing authorization token",
  "instance": "/v1/records"
}
```

```json
{
  "type": "about:blank",
  "title": "Forbidden",
  "status": 403,
  "detail": "Patients can only access their own records",
  "instance": "/v1/records"
}
```
