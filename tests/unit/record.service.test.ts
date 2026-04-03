/**
 * Unit tests for record service pure logic:
 * cursor encoding/decoding, MIME type validation, idempotency.
 */
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '../../src/models/health-record.js';

describe('Cursor encoding / decoding', () => {
  it('encodes and decodes a cursor round-trip', () => {
    const original = { created_at: '2026-04-03T10:00:00.000Z', id: 'abc-123' };
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(original);
  });

  it('produces a URL-safe base64 string (no +, /, =)', () => {
    const cursor = encodeCursor({ created_at: '2026-04-03T10:00:00.000Z', id: 'abc' });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('throws on malformed cursor input', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow();
  });
});

describe('MIME type constants', () => {
  it('allows PDF, JPEG, PNG, DICOM', () => {
    expect(ALLOWED_MIME_TYPES).toContain('application/pdf');
    expect(ALLOWED_MIME_TYPES).toContain('image/jpeg');
    expect(ALLOWED_MIME_TYPES).toContain('image/png');
    expect(ALLOWED_MIME_TYPES).toContain('application/dicom');
  });

  it('does not allow GIF', () => {
    expect(ALLOWED_MIME_TYPES).not.toContain('image/gif');
  });
});

describe('File size constant', () => {
  it('is exactly 50 MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });
});
