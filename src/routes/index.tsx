import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Command,
  Dumbbell,
  HeartPulse,
  Mail,
  Maximize2,
  Mic,
  MoonStar,
  Send,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Zap,
  RefreshCw,
  AlertTriangle,
  Droplets,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  useDashboard,
  formatTime,
  formatEventDate,
  recoveryTone,
  sleepTone,
} from "@/hooks/use-dashboard";
import type { CalendarEvent, Insight } from "@/lib/dashboard-types";

export const Route = createFileRoute("/")(
  (
    {
      head: () => ({
        meta: [
          { title: "Athena — Personal AI OS" },
          {
            name: "description",
            content:
              "A calm personal command center for your day, health, career, finances, and priorities.",
          },
          { property: "og:title", content: "Athena — Personal AI OS" },
          {
            property: "og:description",
            content: "See what matters now across your life in one intelligent command center.",
          },
          { property: "og:type", content: "website" },
          { name: "twitter:card", content: "summary_large_image" },
        ],
      }),
      component: Index,
    } as Parameters<typeof createFileRoute>
  )[1],
);

type ViewMode = "day" | "week" | "ambient";

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`glass-card ${className}`}>{children}</section>;
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-block rounded bg-white/10 animate-pulse ${className}`}>&nbsp;</span>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const time = event.all_day ? "All day" : formatTime(event.start);
  const title = event.title.toLowerCase();
  const tone =
    title.includes("due") || title.includes("payment") || title.includes("deadline")
      ? "critical"
      : title.includes("meeting") || title.includes("interview") || title.includes("call")
        ? "warning"
        : "accent";

  return (
    <div className="timeline-row">
      <time>{time}</time>
      <span className={`timeline-icon tone-${tone}`}>
        <CalendarDays size={14} />
      </span>
      <div>
        <strong>{event.title}</strong>
        <small>{formatEventDate(event.start)}</small>
      </div>
      {tone === "critical" && <StatusPill tone="critical">Attention</StatusPill>}
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const Icon =
    insight.label === "good"
      ? TrendingUp
      : insight.label === "warning" || insight.label === "critical"
        ? TrendingDown
        : Minus;
  return (
    <article className="insight">
      <div>
        <StatusPill tone={insight.label}>{insight.type}</StatusPill>
        <span>{insight.domain}</span>
      </div>
      <p>
        <strong>{insight.title}.</strong> {insight.body}
      </p>
      <div className="reason">
        <Icon size={13} style={{ opacity: 0.6 }} />
        <span style={{ opacity: 0.7, fontSize: "0.78rem" }}>Based on your WHOOP data</span>
      </div>
    </article>
  );
}

/** Mini sparkline for recovery trend */
function RecoveryChart({ data }: { data: { date: string; recovery_score: number }[] }) {
  if (data.length < 2) return null;
  const chartData = data.map((d) => ({
    score: Math.round(d.recovery_score),
    label: new Date(d.date).toLocaleDateString("en-US", { weekday: "short", day: "numeric" }),
  }));
  return (
    <ResponsiveContainer width="100%" height={72}>
      <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="recovGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis domain={[0, 100]} hide />
        <Tooltip
          contentStyle={{
            background: "rgba(10,10,20,0.85)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "6px",
            fontSize: "0.75rem",
          }}
          formatter={(v: number) => [`${v}%`, "Recovery"]}
          labelFormatter={(l: string) => l}
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          fill="url(#recovGrad)"
          dot={false}
          activeDot={{ r: 3, fill: "var(--color-accent)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Index() {
  const [view, setView] = useState<ViewMode>("day");
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [now, setNow] = useState<Date | null>(null);

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useDashboard();

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const greeting = useMemo(() => {
    const hour = now?.getHours() ?? 9;
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }, [now]);

  const currentDate =
    now?.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) ??
    "Today";
  const currentTime =
    now?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "Syncing";

  const health = data?.health;
  const recovery = health?.recovery;
  const sleep = health?.sleep;
  const strain = health?.strain;
  const workout = health?.last_workout;
  const nutrition = health?.nutrition;
  const insights = health?.insights ?? [];
  const calendar = data?.calendar ?? [];
  const email = data?.email;
  const errors = data?.errors ?? [];

  const recTone = recoveryTone(recovery?.score ?? null);
  const slpTone = sleepTone(sleep?.performance_pct ?? null);

  const sleepLabel = sleep?.hours
    ? `${Math.floor(sleep.hours)}h ${Math.round((sleep.hours % 1) * 60)}m`
    : null;

  const systemOk = !isError && errors.length === 0;

  const askAthena = (prompt = query) => {
    if (!prompt.trim()) return;
    setQuery(prompt);
    setAnswer(
      "Athena's conversation interface is coming soon. Real health and schedule data are already connected.",
    );
  };

  if (view === "ambient") {
    return (
      <main className="ambient-shell">
        <div className="ambient-glow" />
        <div className="ambient-topline">
          <span>Athena</span>
          <span className="live-state">
            <i /> {systemOk ? "All systems normal" : "Data partially unavailable"}
          </span>
        </div>
        <div className="ambient-content">
          <p>
            {now?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) ??
              "Today"}
          </p>
          <h1>{greeting}, Mani.</h1>
          <h2>
            Today's focus: Work <ArrowRight /> Study <ArrowRight /> Gym
          </h2>
          <div className="ambient-stats">
            <div>
              <MoonStar />
              <span>Sleep</span>
              <strong>{isLoading ? "…" : (sleepLabel ?? "—")}</strong>
            </div>
            <div>
              <HeartPulse />
              <span>Recovery</span>
              <strong>
                {isLoading ? "…" : recovery?.score != null ? `${recovery.score}%` : "—"}
              </strong>
            </div>
            <div>
              <Mail />
              <span>Email</span>
              <strong>
                {isLoading
                  ? "…"
                  : email?.needs_attention != null
                    ? `${email.needs_attention} need attention`
                    : "—"}
              </strong>
            </div>
          </div>
        </div>
        <Button variant="ghost" onClick={() => setView("day")} className="ambient-exit">
          <Maximize2 size={16} /> Exit display
        </Button>
      </main>
    );
  }

  return (
    <main className="os-shell">
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />
      <div className="os-content">
        {/* Top bar */}
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">
              <Command size={17} />
            </div>
            <div>
              <strong>Athena</strong>
              <span>Personal AI OS</span>
            </div>
          </div>
          <nav className="view-switch" aria-label="Dashboard view">
            {(["day", "week", "ambient"] as ViewMode[]).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                onClick={() => setView(mode)}
                className={view === mode ? "is-active" : ""}
              >
                {mode === "day" ? "Today" : `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`}
              </Button>
            ))}
          </nav>
          <div className="system-state">
            {isLoading ? (
              <span className="live-dot" style={{ background: "var(--color-accent)" }} />
            ) : isError ? (
              <AlertTriangle size={14} style={{ color: "var(--color-destructive)" }} />
            ) : (
              <span className="live-dot" />
            )}
            <span>{isLoading ? "Syncing…" : isError ? "Data error" : "Live data"}</span>
            <button
              onClick={() => refetch()}
              title="Refresh data"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                opacity: 0.6,
                padding: "0 4px",
              }}
            >
              <RefreshCw size={13} />
            </button>
            <div className="avatar">MK</div>
          </div>
        </header>

        {/* API error banner */}
        {errors.length > 0 && (
          <div className="assistant-answer" style={{ borderColor: "var(--color-destructive)" }}>
            <AlertTriangle size={15} />
            <p>
              <strong>Data warnings</strong> {errors.join(" · ")}
            </p>
          </div>
        )}

        {/* Morning briefing */}
        <GlassCard className="briefing">
          <div className="brief-copy">
            <div className="eyebrow">
              <SunMedium size={13} />
              {view === "week" ? "Weekly intelligence" : "Morning briefing"} · {currentDate}
            </div>
            <h1>{view === "week" ? "Your week at a glance." : `${greeting}, Mani.`}</h1>
            <p>
              {isLoading
                ? "Loading your data…"
                : view === "week"
                  ? "Review your health trends, schedule, and priorities across the week."
                  : recovery?.score != null
                    ? `Recovery at ${recovery.score}% (${recovery.label}).${sleep?.hours ? ` You slept ${sleepLabel}.` : ""} ${
                        strain?.label === "Light" || strain?.label === "Rest"
                          ? "Today's strain is light."
                          : `Today's strain is ${strain?.label?.toLowerCase()}.`
                      }`
                    : "Health data is syncing from WHOOP."}
            </p>
            <div className="focus-chain">
              <StatusPill tone="accent">
                {view === "week" ? "This week" : "Today's focus"}
              </StatusPill>
              <span>Work</span>
              <ArrowRight />
              <span>Study</span>
              <ArrowRight />
              <span>Gym</span>
            </div>
          </div>
          <div className="state-stack">
            <div>
              <MoonStar />
              <span>Sleep</span>
              <strong>{isLoading ? <Skeleton className="w-16" /> : (sleepLabel ?? "—")}</strong>
              <StatusPill tone={isLoading ? "neutral" : slpTone}>
                {isLoading
                  ? "…"
                  : sleep?.performance_pct != null
                    ? `${sleep.performance_pct}%`
                    : "—"}
              </StatusPill>
            </div>
            <div>
              <HeartPulse />
              <span>Recovery</span>
              <strong>
                {isLoading ? (
                  <Skeleton className="w-16" />
                ) : recovery?.score != null ? (
                  `${recovery.score} / 100`
                ) : (
                  "—"
                )}
              </strong>
              <StatusPill tone={isLoading ? "neutral" : recTone}>
                {isLoading ? "…" : (recovery?.label ?? "—")}
              </StatusPill>
            </div>
            <div>
              <Zap />
              <span>Strain</span>
              <strong>
                {isLoading ? (
                  <Skeleton className="w-16" />
                ) : strain?.score != null ? (
                  `${strain.score}`
                ) : (
                  "—"
                )}
              </strong>
              <StatusPill tone={isLoading ? "neutral" : "accent"}>
                {isLoading ? "…" : (strain?.label ?? "—")}
              </StatusPill>
            </div>
          </div>
        </GlassCard>

        {/* Command bar */}
        <section className="command-bar">
          <div className="assistant-icon">
            <Sparkles size={16} />
          </div>
          <input
            aria-label="Ask Athena"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && askAthena()}
            placeholder="Ask Athena anything about your day…"
          />
          <Button variant="icon" aria-label="Use voice">
            <Mic size={18} />
          </Button>
          <Button onClick={() => askAthena()} aria-label="Send question">
            <Send size={16} />
            <span className="send-label">Ask</span>
          </Button>
        </section>
        {answer && (
          <div className="assistant-answer">
            <Sparkles size={15} />
            <p>
              <strong>Athena</strong> {answer}
            </p>
            <Button variant="icon" aria-label="Close answer" onClick={() => setAnswer("")}>
              ×
            </Button>
          </div>
        )}

        {/* Dashboard grid */}
        <div className="dashboard-grid">
          {/* ── Wide column ── */}
          <div className="column column-wide">
            {/* Workout detail */}
            <GlassCard>
              <div className="card-heading">
                <div>
                  <span className="kicker">Hevy · Latest session</span>
                  <h2>
                    {isLoading ? <Skeleton className="w-32" /> : (workout?.title ?? "Workout")}
                  </h2>
                </div>
                <Dumbbell size={18} />
              </div>
              {isLoading ? (
                <div className="metric-list">
                  <div>
                    <span>Session</span>
                    <Skeleton className="w-24" />
                  </div>
                  <div>
                    <span>Strain</span>
                    <Skeleton className="w-16" />
                  </div>
                </div>
              ) : workout?.title ? (
                <>
                  <div className="metric-list compact" style={{ marginBottom: "0.75rem" }}>
                    <div>
                      <span>Date</span>
                      <strong>{formatEventDate(workout.date)}</strong>
                    </div>
                    <div>
                      <span>Strain</span>
                      <strong>{workout.strain != null ? `${workout.strain} / 21` : "—"}</strong>
                    </div>
                    <div>
                      <span>Output</span>
                      <strong>
                        {workout.kilojoules != null ? `${workout.kilojoules} kJ` : "—"}
                      </strong>
                    </div>
                  </div>
                  {workout.sets.length > 0 && (
                    <div style={{ overflowX: "auto" }}>
                      <table
                        style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}
                      >
                        <thead>
                          <tr style={{ opacity: 0.5, textAlign: "left" }}>
                            <th style={{ paddingBottom: "0.4rem", fontWeight: 500 }}>Exercise</th>
                            <th
                              style={{
                                paddingBottom: "0.4rem",
                                fontWeight: 500,
                                textAlign: "right",
                              }}
                            >
                              Sets
                            </th>
                            <th
                              style={{
                                paddingBottom: "0.4rem",
                                fontWeight: 500,
                                textAlign: "right",
                              }}
                            >
                              Reps
                            </th>
                            <th
                              style={{
                                paddingBottom: "0.4rem",
                                fontWeight: 500,
                                textAlign: "right",
                              }}
                            >
                              Weight
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {workout.sets.map((s, i) => (
                            <tr
                              key={i}
                              style={{
                                borderTop: "1px solid rgba(255,255,255,0.06)",
                                lineHeight: 2,
                              }}
                            >
                              <td>{s.exercise}</td>
                              <td style={{ textAlign: "right", opacity: 0.7 }}>{s.sets}</td>
                              <td style={{ textAlign: "right", opacity: 0.7 }}>{s.reps}</td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>
                                {s.weight_lbs != null ? `${s.weight_lbs} lbs` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <p className="muted-copy">No recent workout data.</p>
              )}
            </GlassCard>

            {/* Calendar / schedule */}
            <GlassCard>
              <div className="card-heading">
                <div>
                  <span className="kicker">Google Calendar</span>
                  <h2>Schedule</h2>
                </div>
                <span>Next 7 days</span>
              </div>
              <div className="timeline">
                {isLoading ? (
                  <>
                    <div className="timeline-row">
                      <Skeleton className="w-12" />
                      <Skeleton className="w-full" />
                    </div>
                    <div className="timeline-row">
                      <Skeleton className="w-12" />
                      <Skeleton className="w-3/4" />
                    </div>
                  </>
                ) : calendar.length > 0 ? (
                  calendar.map((ev) => <EventRow key={ev.id} event={ev} />)
                ) : (
                  <p className="muted-copy">No upcoming events in the next 7 days.</p>
                )}
              </div>
            </GlassCard>
          </div>

          {/* ── Mid column ── */}
          <div className="column column-mid">
            {/* Cross-domain insights — real computed observations */}
            <GlassCard className="insights-card">
              <div className="card-heading">
                <div>
                  <span className="kicker accent-text">Cross-domain intelligence</span>
                  <h2>What I noticed</h2>
                </div>
                <Sparkles size={18} />
              </div>
              {isLoading ? (
                <p className="muted-copy">Analysing your data…</p>
              ) : insights.length > 0 ? (
                insights.map((ins, i) => <InsightCard key={i} insight={ins} />)
              ) : (
                <p className="muted-copy">Nothing unusual detected today.</p>
              )}
            </GlassCard>

            {/* 14-day recovery trend chart */}
            <GlassCard>
              <div className="card-heading">
                <div>
                  <span className="kicker">WHOOP · 14-day trend</span>
                  <h2>Recovery</h2>
                </div>
                <HeartPulse size={18} />
              </div>
              {isLoading ? (
                <Skeleton className="w-full h-16" />
              ) : (health?.recovery_trend ?? []).length > 0 ? (
                <>
                  <RecoveryChart data={health!.recovery_trend} />
                  <div className="reason" style={{ marginTop: "0.5rem" }}>
                    <StatusPill tone="neutral">HRV</StatusPill>
                    <span>{recovery?.hrv != null ? `${recovery.hrv} ms` : "—"}</span>
                    <StatusPill tone="neutral">RHR</StatusPill>
                    <span>{recovery?.resting_hr != null ? `${recovery.resting_hr} bpm` : "—"}</span>
                    <StatusPill tone="neutral">SpO₂</StatusPill>
                    <span>{recovery?.spo2 != null ? `${recovery.spo2}%` : "—"}</span>
                  </div>
                  {/* Last 5 scores as pills */}
                  <div className="tag-row" style={{ marginTop: "0.6rem" }}>
                    {health!.recovery_trend.slice(-5).map((pt) => (
                      <span
                        key={pt.date}
                        title={new Date(pt.date).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      >
                        <StatusPill tone={recoveryTone(pt.recovery_score)}>
                          {Math.round(pt.recovery_score)}%
                        </StatusPill>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted-copy">No trend data available yet.</p>
              )}
            </GlassCard>

            {/* Sleep detail */}
            <GlassCard>
              <div className="card-heading">
                <div>
                  <span className="kicker">WHOOP · Last night</span>
                  <h2>Sleep</h2>
                </div>
                <MoonStar size={18} />
              </div>
              {isLoading ? (
                <Skeleton className="w-full h-8" />
              ) : (
                <>
                  <strong className="large-metric">{sleepLabel ?? "—"}</strong>
                  <span className="metric-change">
                    {sleep?.performance_pct != null
                      ? `${sleep.performance_pct}% sleep performance`
                      : "No data"}
                  </span>
                  <div className="metric-list compact" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <span>Efficiency</span>
                      <strong>
                        {sleep?.efficiency_pct != null ? `${sleep.efficiency_pct}%` : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>Disturbances</span>
                      <strong>{sleep?.disturbances ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Window</span>
                      <strong>
                        {sleep?.start && sleep?.end
                          ? `${formatTime(sleep.start)} – ${formatTime(sleep.end)}`
                          : "—"}
                      </strong>
                    </div>
                  </div>
                </>
              )}
            </GlassCard>
          </div>

          {/* ── Narrow column ── */}
          <div className="column column-narrow">
            {/* Health vitals */}
            <GlassCard>
              <div className="card-heading">
                <div>
                  <span className="kicker">Live state</span>
                  <h2>Health</h2>
                </div>
                <HeartPulse className="good-text" size={18} />
              </div>
              <div className="metric-list">
                <div>
                  <span>SpO₂</span>
                  <strong>
                    {isLoading ? (
                      <Skeleton className="w-12" />
                    ) : recovery?.spo2 != null ? (
                      `${recovery.spo2}%`
                    ) : (
                      "—"
                    )}
                  </strong>
                </div>
                <div>
                  <span>Resting HR</span>
                  <strong>
                    {isLoading ? (
                      <Skeleton className="w-12" />
                    ) : recovery?.resting_hr != null ? (
                      `${recovery.resting_hr} bpm`
                    ) : (
                      "—"
                    )}
                  </strong>
                </div>
                <div>
                  <span>Max HR</span>
                  <strong>
                    {isLoading ? (
                      <Skeleton className="w-12" />
                    ) : strain?.max_hr != null ? (
                      `${strain.max_hr} bpm`
                    ) : (
                      "—"
                    )}
                  </strong>
                </div>
                <div>
                  <span>Avg HR</span>
                  <strong>
                    {isLoading ? (
                      <Skeleton className="w-12" />
                    ) : strain?.avg_hr != null ? (
                      `${strain.avg_hr} bpm`
                    ) : (
                      "—"
                    )}
                  </strong>
                </div>
              </div>
            </GlassCard>

            {/* Email — real Gmail triage */}
            <GlassCard>
              <div className="card-heading">
                <div>
                  <span className="kicker">Gmail · Triage</span>
                  <h2>Email</h2>
                </div>
                <Mail size={18} />
              </div>
              {isLoading ? (
                <Skeleton className="w-full h-8" />
              ) : (
                <>
                  <div className="mail-count">
                    <strong>{email?.needs_attention ?? "—"}</strong>
                    <span>need attention</span>
                  </div>
                  <p className="muted-copy">
                    {email?.total_unread != null ? `${email.total_unread} total unread` : "No data"}
                    {email?.needs_attention === 0 ? " · Inbox clear" : ""}
                  </p>
                  {(email?.recent ?? []).length > 0 && (
                    <div
                      className="metric-list compact"
                      style={{ marginTop: "0.6rem", gap: "0.5rem" }}
                    >
                      {email!.recent.slice(0, 3).map((msg) => (
                        <div
                          key={msg.id}
                          style={{
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: "0.1rem",
                          }}
                        >
                          <span style={{ fontSize: "0.72rem", opacity: 0.55 }}>
                            {msg.from.replace(/<.*>/, "").trim().slice(0, 28)}
                          </span>
                          <strong style={{ fontSize: "0.78rem", lineHeight: 1.3 }}>
                            {msg.subject.slice(0, 44)}
                            {msg.subject.length > 44 ? "…" : ""}
                          </strong>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </GlassCard>

            {/* Finance — placeholder until Horus has purchase data */}
            <GlassCard>
              <div className="card-heading">
                <div>
                  <span className="kicker">Finance</span>
                  <h2>Spending</h2>
                </div>
                <CircleDollarSign size={18} />
              </div>
              <div className="mail-count">
                <strong style={{ fontSize: "1.1rem", opacity: 0.4 }}>—</strong>
                <span>connecting soon</span>
              </div>
              <p className="muted-copy" style={{ marginTop: "0.5rem" }}>
                Finance data will appear here once Horus has purchase history connected.
              </p>
            </GlassCard>

            {/* Nutrition */}
            <GlassCard>
              <div className="card-heading">
                <div>
                  <span className="kicker">Athena · Logged</span>
                  <h2>Food & Water</h2>
                </div>
                <Droplets size={18} />
              </div>
              {isLoading ? (
                <Skeleton className="w-full h-8" />
              ) : (
                <>
                  <strong className="large-metric">
                    {nutrition?.water_litres != null ? `${nutrition.water_litres}L` : "—"}
                  </strong>
                  <span className="metric-change">water today</span>
                  <div className="metric-list compact" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <span>Calories</span>
                      <strong>
                        {nutrition?.total_kcal != null
                          ? `${Math.round(nutrition.total_kcal)} kcal`
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>Protein</span>
                      <strong>
                        {nutrition?.total_protein_g != null
                          ? `${Math.round(nutrition.total_protein_g)}g`
                          : "—"}
                      </strong>
                    </div>
                  </div>
                  {(nutrition?.meals ?? []).length > 0 && (
                    <div className="tag-row" style={{ marginTop: "0.5rem" }}>
                      {nutrition!.meals.map((m, i) => (
                        <span key={i} title={m.description}>
                          {m.meal}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </GlassCard>
          </div>
        </div>

        <footer className="trust-strip">
          <div>
            <ShieldCheck size={15} />
            <span>
              Live: WHOOP · Hevy · Google Calendar · Gmail. Finance connecting soon. Labels: facts,
              observations, interpretations.
            </span>
          </div>
          <div>
            <Clock3 size={14} /> Updated{" "}
            {dataUpdatedAt
              ? new Date(dataUpdatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : currentTime}
          </div>
        </footer>
      </div>
    </main>
  );
}
