// Types for the Athena dashboard API payload
// Matches api/dashboard.py build_payload() output

export interface RecoveryData {
  score: number | null;
  label: "Green" | "Yellow" | "Red" | "Unknown";
  resting_hr: number | null;
  hrv: number | null;
  spo2: number | null;
  date: string | null;
}

export interface SleepData {
  hours: number | null;
  performance_pct: number | null;
  efficiency_pct: number | null;
  disturbances: number | null;
  start: string | null;
  end: string | null;
}

export interface StrainData {
  score: number | null;
  label: "All Out" | "Strenuous" | "Moderate" | "Light" | "Rest";
  avg_hr: number | null;
  max_hr: number | null;
}

export interface WorkoutSet {
  exercise: string;
  weight_lbs: number | null;
  reps: number | null;
  sets: number;
}

export interface WorkoutData {
  title: string | null;
  date: string | null;
  sets: WorkoutSet[];
  strain: number | null;
  kilojoules: number | null;
}

export interface RecoveryTrendPoint {
  date: string;
  recovery_score: number;
}

export interface MealEntry {
  meal: string;
  description: string;
  kcal: number | null;
  protein_g: number | null;
}

export interface NutritionData {
  water_litres: number | null;
  meals: MealEntry[];
  total_kcal: number | null;
  total_protein_g: number | null;
}

export interface Insight {
  type: "observation" | "interpretation" | "suggestion";
  domain: string;
  title: string;
  body: string;
  label: "good" | "warning" | "critical" | "neutral" | "accent";
}

export interface HealthData {
  recovery: RecoveryData;
  sleep: SleepData;
  strain: StrainData;
  last_workout: WorkoutData;
  recovery_trend: RecoveryTrendPoint[];
  nutrition: NutritionData;
  insights: Insight[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
  description: string;
  all_day: boolean;
}

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  labels: string[];
}

export interface EmailSummary {
  total_unread: number;
  needs_attention: number;
  recent: EmailMessage[];
}

export interface DashboardPayload {
  generated_at: string;
  date: string;
  health: HealthData;
  calendar: CalendarEvent[];
  email: EmailSummary;
  errors: string[];
}
