// Types for Health tab API endpoints
// Matches /api/health/timeseries and /api/health/calories responses

export type Granularity = "day" | "week" | "month";

export type HealthMetric =
  | "recovery_score"
  | "resting_hr"
  | "hrv"
  | "sleep_performance"
  | "sleep_efficiency"
  | "day_strain"
  | "weight_kg"
  | "waist_cm";

export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  value: number | null;
}

export interface TimeseriesResponse {
  metric: HealthMetric;
  source: "whoop" | "self_reported";
  unit: string;
  from: string;
  to: string;
  granularity: Granularity;
  data: TimeseriesPoint[];
  // Insight summary for the panel
  insight: {
    trend: "up" | "down" | "flat" | "insufficient";
    change_pct: number | null;
    period_avg: number | null;
    prev_period_avg: number | null;
    gap_days: number; // days in range with no data
  };
}

export interface CaloriesDay {
  date: string; // YYYY-MM-DD
  kcal: number | null;
  protein_g: number | null;
  entry_count: number;
}

export interface CaloriesResponse {
  from: string;
  to: string;
  source: "self_reported";
  // Config targets (TODO: owner to set real values)
  targets: {
    daily_kcal: number | null; // TODO: set your daily calorie target
    daily_protein_g: number | null; // TODO: set your daily protein target
  };
  daily: CaloriesDay[];
  summary: {
    total_kcal: number | null;
    total_protein_g: number | null;
    days_with_data: number;
    days_in_range: number;
  };
  insight: {
    trend: "up" | "down" | "flat" | "insufficient";
    change_pct: number | null;
    gap_days: number;
  };
}

// Date-range selector state
export type RangePreset = "week" | "month" | "custom" | "all";

export interface DateRange {
  preset: RangePreset;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

// /api/health/today response
export interface TodayRingEntry {
  actual: number | null;
  target: number | null;
  empty_reason?: string;
}

export interface TodayResponse {
  date: string;
  calorie_intake: TodayRingEntry;
  calorie_burn: TodayRingEntry;
  steps: TodayRingEntry;
}
