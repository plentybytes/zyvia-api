import type { RecordType } from './record-type.js';

export type MimeType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'application/dicom';

export const ALLOWED_MIME_TYPES: MimeType[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/dicom',
];

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export interface HealthRecord {
  id: string;
  patient_id: string;
  record_type_id: string;
  uploaded_by_user_id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: MimeType;
  storage_key: string;
  idempotency_key: string | null;
  idempotency_key_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface HealthRecordSummary {
  id: string;
  patient_id: string;
  record_type: RecordType;
  file_name: string;
  file_size_bytes: number;
  mime_type: MimeType;
  created_at: Date;
}

export interface HealthRecordDetail extends HealthRecordSummary {
  download_url: string;
  download_url_expires_at: Date;
}

export interface CreateRecordInput {
  patientId: string;
  recordTypeId: string;
  uploadedByUserId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: MimeType;
  fileStream: NodeJS.ReadableStream;
  idempotencyKey?: string;
}

export interface ListRecordsInput {
  patientId: string;
  recordTypeId?: string;
  cursor?: string;
  limit: number;
}

export interface ListRecordsResult {
  data: HealthRecordSummary[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface PageCursor {
  created_at: string;
  id: string;
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(encoded: string): PageCursor {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as PageCursor;
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}
