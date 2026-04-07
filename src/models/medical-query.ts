export interface HealthProfileSnapshot {
  age_years: number;
  height_cm: number;
  weight_kg: number;
  bmi: number;
}

export interface MedicalQuery {
  id: string;
  user_id: string;
  query_text: string;
  health_profile_snapshot: HealthProfileSnapshot;
  created_at: Date;
}

export interface AiMedicalResponse {
  id: string;
  query_id: string;
  response_text: string;
  disclaimer_text: string;
  created_at: Date;
}

export interface MedicalQueryWithResponse {
  query_id: string;
  response_text: string;
  disclaimer_text: string;
  created_at: Date;
  health_context: HealthProfileSnapshot;
}
