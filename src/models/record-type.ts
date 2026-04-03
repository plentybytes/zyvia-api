export interface RecordType {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RecordTypeRow extends RecordType {}

export interface CreateRecordTypeInput {
  name: string;
  description?: string;
}

export interface UpdateRecordTypeInput {
  description?: string;
  is_active?: boolean;
}
