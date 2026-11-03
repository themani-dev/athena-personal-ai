import { useQuery } from "@tanstack/react-query";
import type {
  TimeseriesResponse,
  CaloriesResponse,
  TodayResponse,
  HealthMetric,
  Granularity,
} from "@/lib/health-types";
import { UnauthenticatedError } from "@/hooks/use-auth";

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** YYYY-MM-DD for today */
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM-DD for N days ago */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchTimeseries(
  metric: HealthMetric,
  from: string,
  to: string,
  granularity: Granularity,
): Promise<TimeseriesResponse> {
  const params = new URLSearchParams({ metric, from, to, granularity });
  const res = await fetch(`/api/health/timeseries?${params}`, { credentials: "same-origin" });
  if (res.status === 401) {
    throw new UnauthenticatedError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Health API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<TimeseriesResponse>;
}

async function fetchCalories(from: string, to: string): Promise<CaloriesResponse> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/health/calories?${params}`, { credentials: "same-origin" });
  if (res.status === 401) {
    throw new UnauthenticatedError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calories API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<CaloriesResponse>;
}

async function fetchHealthToday(): Promise<TodayResponse> {
  const res = await fetch("/api/health/today", { credentials: "same-origin" });
  if (res.status === 401) {
    throw new UnauthenticatedError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Health today API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<TodayResponse>;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useHealthTimeseries(
  metric: HealthMetric,
  from: string,
  to: string,
  granularity: Granularity,
) {
  return useQuery<TimeseriesResponse, Error>({
    queryKey: ["health", "timeseries", metric, from, to, granularity],
    queryFn: () => fetchTimeseries(metric, from, to, granularity),
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => !(error instanceof UnauthenticatedError) && failureCount < 1,
  });
}

export function useHealthCalories(from: string, to: string) {
  return useQuery<CaloriesResponse, Error>({
    queryKey: ["health", "calories", from, to],
    queryFn: () => fetchCalories(from, to),
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => !(error instanceof UnauthenticatedError) && failureCount < 1,
  });
}

export function useHealthToday() {
  return useQuery<TodayResponse, Error>({
    queryKey: ["health", "today"],
    queryFn: fetchHealthToday,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => !(error instanceof UnauthenticatedError) && failureCount < 1,
  });
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmtValue(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "%" || unit === "ms" || unit === "bpm" || unit === "kg") {
    return `${Math.round(value * 10) / 10} ${unit}`;
  }
  return `${Math.round(value * 10) / 10} ${unit}`;
}

export function trendLabel(trend: "up" | "down" | "flat" | "insufficient"): string {
  if (trend === "up") return "Trending up";
  if (trend === "down") return "Trending down";
  if (trend === "flat") return "Stable";
  return "Not enough data";
}

export function trendTone(
  trend: "up" | "down" | "flat" | "insufficient",
  metric: HealthMetric,
): "good" | "warning" | "neutral" {
  if (trend === "insufficient") return "neutral";
  // For metrics where higher is better: recovery, hrv, sleep_performance, sleep_efficiency
  const higherBetter: HealthMetric[] = [
    "recovery_score",
    "hrv",
    "sleep_performance",
    "sleep_efficiency",
  ];
  // For metrics where lower is better: resting_hr
  const lowerBetter: HealthMetric[] = ["resting_hr"];
  if (higherBetter.includes(metric)) {
    return trend === "up" ? "good" : trend === "down" ? "warning" : "neutral";
  }
  if (lowerBetter.includes(metric)) {
    return trend === "down" ? "good" : trend === "up" ? "warning" : "neutral";
  }
  return "neutral";
}

/** Short human label for a metric */
export function metricLabel(metric: HealthMetric): string {
  const labels: Record<HealthMetric, string> = {
    recovery_score: "Recovery",
    resting_hr: "Resting HR",
    hrv: "HRV",
    sleep_performance: "Sleep Performance",
    sleep_efficiency: "Sleep Efficiency",
    day_strain: "Day Strain",
    weight_kg: "Body Weight",
    waist_cm: "Waist",
  };
  return labels[metric];
}

/** Source label for trust/attribution line */
export function sourceLabel(source: "whoop" | "self_reported", metric: HealthMetric): string {
  if (source === "whoop") return `Device-estimated (WHOOP) · ${metricLabel(metric)}`;
  return `Self-reported · ${metricLabel(metric)}`;
}
