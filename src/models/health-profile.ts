export interface HealthProfile {
  id: string;
  user_id: string;
  date_of_birth: string; // YYYY-MM-DD
  height_cm: number;
  weight_kg: number;
  created_at: Date;
  updated_at: Date;
}

export interface HealthProfileWithBmi extends HealthProfile {
  age_years: number;
  bmi: number;
}
