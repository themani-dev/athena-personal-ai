/**
 * HealthTab — Health tab for the Athena dashboard.
 *
 * Three collapsible category sections (horizontal tabs):
 *   [Health Metrics]        — WHOOP timeseries with 7-day avg threshold lines
 *   [Physical Measurements] — weight_kg, waist_cm with config target thresholds
 *                             (threshold line hidden when target === 0)
 *   [Nutrition]             — daily kcal + protein with config target thresholds
 *                             (threshold line hidden when target === 0)
 *
 * First category is expanded by default; others are collapsed.
 * No weekly view. No outbound calls. No logging of health values.
 *
 * All values labelled as device-estimated (WHOOP) or self-reported (food/measurements).
 * No medical advice or diagnosis wording anywhere.
 */

import { useState, useCallback } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  HeartPulse,
  MoonStar,
  Zap,
  Scale,
  UtensilsCrossed,
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  RefreshCw,
  Ruler,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  useHealthTimeseries,
  useHealthCalories,
  daysAgo,
  todayStr,
  fmtValue,
  trendLabel,
  trendTone,
  metricLabel,
  sourceLabel,
} from "@/hooks/use-health";
import type {
  HealthMetric,
  Granularity,
  RangePreset,
  DateRange,
  TimeseriesResponse,
  CaloriesResponse,
} from "@/lib/health-types";

// ─── Shared sub-components ────────────────────────────────────────────────────

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`glass-card ${className}`}>{children}</section>;
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block rounded bg-white/10 animate-pulse ${className}`}
    >
      &nbsp;
    </span>
  );
}

// ─── Range selector ───────────────────────────────────────────────────────────

const PRESETS: { label: string; preset: RangePreset }[] = [
  { label: "7d", preset: "week" },
  { label: "30d", preset: "month" },
  { label: "Custom", preset: "custom" },
  { label: "All", preset: "all" },
];

function rangeFromPreset(preset: RangePreset, customFrom?: string, customTo?: string): DateRange {
  const to = todayStr();
  if (preset === "week") return { preset, from: daysAgo(6), to };
  if (preset === "month") return { preset, from: daysAgo(29), to };
  if (preset === "all") return { preset, from: "2000-01-01", to };
  return { preset: "custom", from: customFrom ?? daysAgo(14), to: customTo ?? to };
}

function granularityForPreset(preset: RangePreset): Granularity {
  if (preset === "week") return "day";
  if (preset === "month") return "day";
  return "week";
}

interface RangeSelectorProps {
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
}

function RangeSelector({ range, onRangeChange }: RangeSelectorProps) {
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);

  const apply = useCallback(() => {
    onRangeChange({ preset: "custom", from: customFrom, to: customTo });
  }, [customFrom, customTo, onRangeChange]);

  return (
    <div className="ht-range-bar">
      {PRESETS.map(({ label, preset }) => (
        <button
          key={preset}
          className={`ht-range-btn${range.preset === preset ? " is-active" : ""}`}
          onClick={() => {
            if (preset !== "custom") {
              onRangeChange(rangeFromPreset(preset));
            }
          }}
        >
          {label}
        </button>
      ))}
      {range.preset === "custom" && (
        <div className="ht-custom-dates">
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="ht-date-input"
            aria-label="Custom range start"
          />
          <span>–</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            max={todayStr()}
            onChange={(e) => setCustomTo(e.target.value)}
            className="ht-date-input"
            aria-label="Custom range end"
          />
          <button className="ht-range-btn is-active" onClick={apply}>
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Insight panel ─────────────────────────────────────────────────────────────

function InsightPanel({
  insight,
  metric,
  source,
  gapDays,
  daysInRange,
}: {
  insight: TimeseriesResponse["insight"] | CaloriesResponse["insight"];
  metric?: HealthMetric;
  source: "whoop" | "self_reported";
  gapDays: number;
  daysInRange: number;
}) {
  const tone = metric
    ? trendTone(insight.trend, metric)
    : insight.trend === "up"
      ? "good"
      : insight.trend === "down"
        ? "warning"
        : "neutral";
  const Icon =
    insight.trend === "up"
      ? TrendingUp
      : insight.trend === "down"
        ? TrendingDown
        : Minus;

  const changePct =
    "change_pct" in insight && insight.change_pct !== null
      ? insight.change_pct
      : null;

  return (
    <div className="ht-insight">
      <div className="ht-insight-row">
        <Icon size={13} style={{ flexShrink: 0 }} />
        <StatusPill tone={tone}>{trendLabel(insight.trend)}</StatusPill>
        {changePct !== null && (
          <span className="ht-insight-delta">
            {changePct > 0 ? "+" : ""}
            {Math.round(changePct)}% vs prev period
          </span>
        )}
      </div>
      {gapDays > 0 && (
        <div className="ht-insight-row ht-gap-notice">
          <AlertCircle size={12} />
          <span>
            {gapDays} of {daysInRange} days have no data
          </span>
        </div>
      )}
      <div className="ht-insight-source">
        <Info size={11} />
        <span>
          {metric ? sourceLabel(source, metric) : "Self-reported · Food log (Athena)"}
        </span>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ reason }: { reason: string }) {
  return (
    <div className="ht-empty">
      <Minus size={22} style={{ opacity: 0.3 }} />
      <p>{reason}</p>
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="ht-empty">
      <AlertCircle size={18} style={{ color: "var(--critical)" }} />
      <p style={{ color: "var(--critical)" }}>{message}</p>
      <button className="ht-range-btn" onClick={onRetry}>
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

// ─── Tooltip formatter ────────────────────────────────────────────────────────

const CHART_TOOLTIP_STYLE = {
  background: "rgba(10,10,20,0.92)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "6px",
  fontSize: "0.72rem",
};

// ─── Single metric chart card (Health Metrics category) ───────────────────────
// Threshold = 7-day average computed from data — drawn only when data exists.

interface MetricCardProps {
  metric: HealthMetric;
  icon: React.ReactNode;
  defaultRange?: RangePreset;
}

function MetricCard({ metric, icon, defaultRange = "week" }: MetricCardProps) {
  const [range, setRange] = useState<DateRange>(rangeFromPreset(defaultRange));
  const granularity = granularityForPreset(range.preset);

  const { data, isLoading, isError, error, refetch } = useHealthTimeseries(
    metric,
    range.from,
    range.to,
    granularity,
  );

  const chartData =
    data?.data.map((pt) => ({
      date: pt.date.slice(5),
      fullDate: pt.date,
      value: pt.value,
    })) ?? [];

  const hasData = chartData.some((pt) => pt.value !== null);
  const daysInRange =
    data != null
      ? Math.max(
          1,
          Math.round(
            (new Date(range.to).getTime() - new Date(range.from).getTime()) /
              86_400_000,
          ) + 1,
        )
      : 0;

  // 7-day rolling average of non-null values — this IS the threshold line.
  // We use period_avg as a proxy for the 7-day avg when range is 7d, otherwise
  // compute from last 7 values in the series.
  const sevenDayAvg: number | null = (() => {
    if (!data || !hasData) return null;
    const nonNull = data.data
      .slice(-7)
      .map((p) => p.value)
      .filter((v): v is number => v !== null);
    if (nonNull.length < 2) return null;
    return Math.round((nonNull.reduce((a, b) => a + b, 0) / nonNull.length) * 10) / 10;
  })();

  return (
    <GlassCard className="ht-metric-card">
      <div className="card-heading">
        <div>
          <span className="kicker">
            {data ? (data.source === "whoop" ? "WHOOP · Device-estimated" : "Self-reported") : "—"}
          </span>
          <h2>
            {icon} {metricLabel(metric)}
          </h2>
        </div>
        <div className="ht-current-val">
          {isLoading ? (
            <Skeleton className="w-16" />
          ) : data?.insight.period_avg != null ? (
            <>
              <span>{fmtValue(data.insight.period_avg, data.unit)}</span>
              <small>avg</small>
            </>
          ) : null}
        </div>
      </div>

      <RangeSelector range={range} onRangeChange={setRange} />

      <div className="ht-chart-area">
        {isLoading ? (
          <div className="ht-chart-skeleton" />
        ) : isError ? (
          <ErrorState
            message={(error as Error).message.slice(0, 80)}
            onRetry={() => void refetch()}
          />
        ) : !hasData ? (
          <EmptyState
            reason={
              metric === "weight_kg"
                ? "No weight entries yet. Body measurements will appear here once recorded."
                : "No data for this period."
            }
          />
        ) : (
          <ResponsiveContainer width="100%" height={130}>
            <LineChart
              data={chartData}
              margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.06)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) =>
                  typeof v === "number"
                    ? [fmtValue(v, data?.unit ?? ""), metricLabel(metric)]
                    : ["—", metricLabel(metric)]
                }
                labelFormatter={(l: string) => l}
              />
              {sevenDayAvg !== null && (
                <ReferenceLine
                  y={sevenDayAvg}
                  stroke="var(--warning)"
                  strokeDasharray="4 3"
                  label={{
                    value: `7d avg ${fmtValue(sevenDayAvg, data?.unit ?? "")}`,
                    position: "right",
                    fill: "var(--warning)",
                    fontSize: 9,
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--cyan)"
                strokeWidth={1.8}
                dot={false}
                activeDot={{ r: 3, fill: "var(--cyan)" }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {data && !isError && (
        <InsightPanel
          insight={data.insight}
          metric={metric}
          source={data.source}
          gapDays={data.insight.gap_days}
          daysInRange={daysInRange}
        />
      )}
    </GlassCard>
  );
}

// ─── Physical measurement card (weight or waist) ──────────────────────────────
// Threshold = config target. When target === 0, no line is drawn.

interface PhysicalCardProps {
  metric: "weight_kg" | "waist_cm";
  icon: React.ReactNode;
  targetValue: number | null; // null or 0 = not set
}

function PhysicalCard({ metric, icon, targetValue }: PhysicalCardProps) {
  const [range, setRange] = useState<DateRange>(rangeFromPreset("month"));
  const granularity = granularityForPreset(range.preset);

  const { data, isLoading, isError, error, refetch } = useHealthTimeseries(
    metric,
    range.from,
    range.to,
    granularity,
  );

  const chartData =
    data?.data.map((pt) => ({
      date: pt.date.slice(5),
      value: pt.value,
    })) ?? [];

  const hasData = chartData.some((pt) => pt.value !== null);
  const daysInRange = data != null
    ? Math.max(
        1,
        Math.round(
          (new Date(range.to).getTime() - new Date(range.from).getTime()) /
            86_400_000,
        ) + 1,
      )
    : 0;

  // Target threshold: only draw when value is set (non-null, non-zero)
  const threshold = targetValue && targetValue > 0 ? targetValue : null;

  const emptyReason =
    metric === "weight_kg"
      ? "No weight entries yet. Body measurements will appear here once recorded."
      : "No waist measurements yet. Entries will appear here once recorded.";

  return (
    <GlassCard className="ht-metric-card">
      <div className="card-heading">
        <div>
          <span className="kicker">Self-reported · Body measurements</span>
          <h2>
            {icon} {metricLabel(metric)}
          </h2>
        </div>
        <div className="ht-current-val">
          {isLoading ? (
            <Skeleton className="w-16" />
          ) : data?.insight.period_avg != null ? (
            <>
              <span>{fmtValue(data.insight.period_avg, data.unit)}</span>
              <small>avg</small>
            </>
          ) : null}
        </div>
      </div>

      {threshold === null && (
        <div className="ht-todo-notice" style={{ marginBottom: "0.25rem" }}>
          <Info size={12} />
          <span>
            Target not set — threshold line will appear once you set a target in dashboard.py.
          </span>
        </div>
      )}

      <RangeSelector range={range} onRangeChange={setRange} />

      <div className="ht-chart-area">
        {isLoading ? (
          <div className="ht-chart-skeleton" />
        ) : isError ? (
          <ErrorState
            message={(error as Error).message.slice(0, 80)}
            onRetry={() => void refetch()}
          />
        ) : !hasData ? (
          <EmptyState reason={emptyReason} />
        ) : (
          <ResponsiveContainer width="100%" height={130}>
            <LineChart
              data={chartData}
              margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.06)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={34}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) =>
                  typeof v === "number"
                    ? [fmtValue(v, data?.unit ?? ""), metricLabel(metric)]
                    : ["—", metricLabel(metric)]
                }
                labelFormatter={(l: string) => l}
              />
              {threshold !== null && (
                <ReferenceLine
                  y={threshold}
                  stroke="var(--good)"
                  strokeDasharray="4 3"
                  label={{
                    value: `Target ${fmtValue(threshold, data?.unit ?? "")}`,
                    position: "right",
                    fill: "var(--good)",
                    fontSize: 9,
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--cyan)"
                strokeWidth={1.8}
                dot={false}
                activeDot={{ r: 3, fill: "var(--cyan)" }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {data && !isError && (
        <InsightPanel
          insight={data.insight}
          metric={metric}
          source={data.source}
          gapDays={data.insight.gap_days}
          daysInRange={daysInRange}
        />
      )}
    </GlassCard>
  );
}

// ─── Calories card (Nutrition category) ──────────────────────────────────────
// Threshold = config targets. When target === 0, no line drawn.

function CaloriesCard() {
  const [range, setRange] = useState<DateRange>(rangeFromPreset("week"));

  const { data, isLoading, isError, error, refetch } = useHealthCalories(
    range.from,
    range.to,
  );

  const kcalData =
    data?.daily.map((d) => ({
      date: d.date.slice(5),
      kcal: d.kcal,
      protein_g: d.protein_g,
    })) ?? [];

  const hasKcal = kcalData.some((d) => d.kcal !== null);
  const hasProtein = kcalData.some((d) => d.protein_g !== null);

  // 0 = not set yet → no threshold line
  const targetKcal = data?.targets.daily_kcal && data.targets.daily_kcal > 0
    ? data.targets.daily_kcal
    : null;
  const targetProtein = data?.targets.daily_protein_g && data.targets.daily_protein_g > 0
    ? data.targets.daily_protein_g
    : null;

  const totalKcal = data?.summary.total_kcal;
  const totalProtein = data?.summary.total_protein_g;
  const daysWithData = data?.summary.days_with_data ?? 0;
  const daysInRange = data?.summary.days_in_range ?? 0;

  return (
    <GlassCard className="ht-calories-card">
      <div className="card-heading">
        <div>
          <span className="kicker">Self-reported · Athena food log</span>
          <h2>
            <UtensilsCrossed size={15} style={{ display: "inline", marginRight: "0.4rem" }} />
            Calories & Protein
          </h2>
        </div>
        <div className="ht-cal-summary">
          {isLoading ? (
            <Skeleton className="w-20" />
          ) : (
            <>
              {totalKcal != null && (
                <span>
                  <strong>{Math.round(totalKcal)}</strong> kcal total
                </span>
              )}
              {totalProtein != null && (
                <span>
                  <strong>{Math.round(totalProtein)}g</strong> protein
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <RangeSelector range={range} onRangeChange={setRange} />

      {/* Target notice — shown only when at least one target is unset */}
      {(targetKcal === null || targetProtein === null) && (
        <div className="ht-todo-notice">
          <Info size={12} />
          <span>
            {targetKcal === null && targetProtein === null
              ? "Calorie and protein targets not set."
              : targetKcal === null
                ? "Calorie target not set."
                : "Protein target not set."}{" "}
            <em>Set your daily targets in dashboard.py.</em>
          </span>
        </div>
      )}

      <div className="ht-chart-area">
        {isLoading ? (
          <div className="ht-chart-skeleton" />
        ) : isError ? (
          <ErrorState
            message={(error as Error).message.slice(0, 80)}
            onRetry={() => void refetch()}
          />
        ) : !hasKcal && !hasProtein ? (
          <EmptyState reason="No calorie or protein data logged for this period. Entries will appear here once added to the food log." />
        ) : (
          <div className="ht-cal-charts">
            {/* kcal chart */}
            {hasKcal && (
              <div>
                <p className="ht-chart-label">Daily kcal (self-reported)</p>
                <ResponsiveContainer width="100%" height={110}>
                  <BarChart
                    data={kcalData}
                    margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(v: any) =>
                        typeof v === "number" ? [`${Math.round(v)} kcal`, "Calories"] : ["—", "Calories"]
                      }
                    />
                    {targetKcal !== null && (
                      <ReferenceLine
                        y={targetKcal}
                        stroke="var(--warning)"
                        strokeDasharray="4 3"
                        label={{
                          value: `Target ${targetKcal}`,
                          position: "right",
                          fill: "var(--warning)",
                          fontSize: 9,
                        }}
                      />
                    )}
                    <Bar
                      dataKey="kcal"
                      fill="var(--cyan)"
                      fillOpacity={0.7}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* protein chart */}
            {hasProtein && (
              <div>
                <p className="ht-chart-label">Daily protein g (self-reported)</p>
                <ResponsiveContainer width="100%" height={110}>
                  <BarChart
                    data={kcalData}
                    margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(v: any) =>
                        typeof v === "number" ? [`${Math.round(v)}g`, "Protein"] : ["—", "Protein"]
                      }
                    />
                    {targetProtein !== null && (
                      <ReferenceLine
                        y={targetProtein}
                        stroke="var(--good)"
                        strokeDasharray="4 3"
                        label={{
                          value: `Target ${targetProtein}g`,
                          position: "right",
                          fill: "var(--good)",
                          fontSize: 9,
                        }}
                      />
                    )}
                    <Bar
                      dataKey="protein_g"
                      fill="var(--good)"
                      fillOpacity={0.65}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Current period summary counters */}
      {!isError && (
        <div className="ht-cal-counters">
          <div>
            <span>Period total kcal</span>
            <strong>{totalKcal != null ? `${Math.round(totalKcal)} kcal` : "—"}</strong>
          </div>
          <div>
            <span>Period total protein</span>
            <strong>{totalProtein != null ? `${Math.round(totalProtein)}g` : "—"}</strong>
          </div>
          <div>
            <span>Days logged</span>
            <strong>
              {daysWithData} / {daysInRange}
            </strong>
          </div>
        </div>
      )}

      {data && !isError && (
        <InsightPanel
          insight={data.insight}
          source="self_reported"
          gapDays={data.insight.gap_days}
          daysInRange={daysInRange}
        />
      )}
    </GlassCard>
  );
}

// ─── Collapsible category section ────────────────────────────────────────────

interface CategorySectionProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function CategorySection({
  id,
  label,
  icon,
  isOpen,
  onToggle,
  children,
}: CategorySectionProps) {
  return (
    <div className="ht-category-section">
      <button
        className={`ht-category-tab${isOpen ? " is-open" : ""}`}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`ht-cat-${id}`}
      >
        <span className="ht-cat-icon">{icon}</span>
        <span className="ht-cat-label">{label}</span>
        {isOpen
          ? <ChevronDown size={14} className="ht-cat-chevron" />
          : <ChevronRight size={14} className="ht-cat-chevron" />}
      </button>
      {isOpen && (
        <div id={`ht-cat-${id}`} className="ht-category-body">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Main HealthTab export ────────────────────────────────────────────────────

export function HealthTab() {
  // First category open by default, others collapsed.
  const [openCategory, setOpenCategory] = useState<string>("health-metrics");

  function toggle(id: string) {
    setOpenCategory((prev) => (prev === id ? "" : id));
  }

  return (
    <div className="ht-shell">
      {/* ── Health Metrics ──────────────────────────────────────── */}
      <CategorySection
        id="health-metrics"
        label="Health Metrics"
        icon={<HeartPulse size={15} />}
        isOpen={openCategory === "health-metrics"}
        onToggle={() => toggle("health-metrics")}
      >
        <div className="ht-grid">
          <MetricCard
            metric="recovery_score"
            icon={<HeartPulse size={13} style={{ display: "inline", marginRight: "0.3rem" }} />}
          />
          <MetricCard
            metric="resting_hr"
            icon={<HeartPulse size={13} style={{ display: "inline", marginRight: "0.3rem" }} />}
          />
          <MetricCard
            metric="hrv"
            icon={<HeartPulse size={13} style={{ display: "inline", marginRight: "0.3rem" }} />}
          />
          <MetricCard
            metric="sleep_performance"
            icon={<MoonStar size={13} style={{ display: "inline", marginRight: "0.3rem" }} />}
          />
          <MetricCard
            metric="sleep_efficiency"
            icon={<MoonStar size={13} style={{ display: "inline", marginRight: "0.3rem" }} />}
          />
          <MetricCard
            metric="day_strain"
            icon={<Zap size={13} style={{ display: "inline", marginRight: "0.3rem" }} />}
          />
        </div>
      </CategorySection>

      {/* ── Physical Measurements ────────────────────────────────── */}
      <CategorySection
        id="physical-measurements"
        label="Physical Measurements"
        icon={<Scale size={15} />}
        isOpen={openCategory === "physical-measurements"}
        onToggle={() => toggle("physical-measurements")}
      >
        <div className="ht-grid ht-grid-2col">
          {/* target = 0 means not set — PhysicalCard will not draw threshold line */}
          <PhysicalCard
            metric="weight_kg"
            icon={<Scale size={13} style={{ display: "inline", marginRight: "0.3rem" }} />}
            targetValue={0}
          />
          <PhysicalCard
            metric="waist_cm"
            icon={<Ruler size={13} style={{ display: "inline", marginRight: "0.3rem" }} />}
            targetValue={0}
          />
        </div>
      </CategorySection>

      {/* ── Nutrition ────────────────────────────────────────────── */}
      <CategorySection
        id="nutrition"
        label="Nutrition"
        icon={<UtensilsCrossed size={15} />}
        isOpen={openCategory === "nutrition"}
        onToggle={() => toggle("nutrition")}
      >
        <CaloriesCard />
      </CategorySection>
    </div>
  );
}
