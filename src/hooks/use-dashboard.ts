import { useQuery } from "@tanstack/react-query";
import type { DashboardPayload } from "@/lib/dashboard-types";

const DASHBOARD_API = "/api/dashboard";
const REFETCH_INTERVAL_MS = 5 * 60 * 1000; // refresh every 5 minutes

async function fetchDashboard(): Promise<DashboardPayload> {
  const res = await fetch(DASHBOARD_API);
  if (!res.ok) {
    throw new Error(`Dashboard API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<DashboardPayload>;
}

export function useDashboard() {
  return useQuery<DashboardPayload, Error>({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: 2 * 60 * 1000, // data considered fresh for 2 min
    retry: 2,
  });
}

/** Format a local ISO timestamp into a readable time string */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

/** Format an ISO date/datetime into "Mon, Oct 25" style */
export function formatEventDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: !iso.includes("T00:00:00") ? "2-digit" : undefined,
      minute: !iso.includes("T00:00:00") ? "2-digit" : undefined,
    });
  } catch {
    return "—";
  }
}

/** Derive a tone from a recovery score */
export function recoveryTone(score: number | null): string {
  if (score === null) return "neutral";
  if (score >= 67) return "good";
  if (score >= 34) return "warning";
  return "critical";
}

/** Derive a tone from a sleep performance % */
export function sleepTone(pct: number | null): string {
  if (pct === null) return "neutral";
  if (pct >= 85) return "good";
  if (pct >= 70) return "accent";
  return "warning";
}
