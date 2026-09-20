import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
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
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Athena — Personal AI OS" },
      { name: "description", content: "A calm personal command center for your day, health, career, finances, and priorities." },
      { property: "og:title", content: "Athena — Personal AI OS" },
      { property: "og:description", content: "See what matters now across your life in one intelligent command center." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type ViewMode = "day" | "week" | "ambient";

const initialPriorities = [
  { id: 1, title: "Finalize Q3 proposal outline", meta: "Work · Before 11:30", state: "Action", tone: "critical" },
  { id: 2, title: "Career study — data modeling", meta: "Career · 17:00–18:30", state: "Priority", tone: "warning" },
  { id: 3, title: "Reply to 3 important emails", meta: "Email · 12 min estimated", state: "Can wait", tone: "neutral" },
];

const schedule = [
  { time: "09:00", title: "Deep work block", kind: "Focus", icon: BriefcaseBusiness, tone: "accent" },
  { time: "14:00", title: "Client strategy meeting", kind: "Important", icon: CalendarDays, tone: "critical" },
  { time: "17:00", title: "Career study session", kind: "Priority", icon: Activity, tone: "warning" },
  { time: "18:45", title: "Gym — upper body", kind: "Health", icon: Dumbbell, tone: "good" },
];

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`glass-card ${className}`}>{children}</section>;
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

function Index() {
  const [view, setView] = useState<ViewMode>("day");
  const [completed, setCompleted] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const greeting = useMemo(() => {
    const hour = now.getHours();
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }, [now]);

  const askAthena = (prompt = query) => {
    if (!prompt.trim()) return;
    setQuery(prompt);
    setAnswer("Your highest-leverage move is the Q3 proposal. You have 74 focused minutes before your next commitment, with no conflicts detected.");
  };

  if (view === "ambient") {
    return (
      <main className="ambient-shell">
        <div className="ambient-glow" />
        <div className="ambient-topline"><span>Athena</span><span className="live-state"><i /> All systems normal</span></div>
        <div className="ambient-content">
          <p>{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1>{greeting}, Jordan.</h1>
          <h2>Today’s focus: Work <ArrowRight /> Study <ArrowRight /> Gym</h2>
          <div className="ambient-stats">
            <div><MoonStar /><span>Sleep</span><strong>7h 42m</strong></div>
            <div><HeartPulse /><span>Recovery</span><strong>82</strong></div>
            <div><CalendarDays /><span>Next</span><strong>Meeting at 2</strong></div>
          </div>
        </div>
        <Button variant="ghost" onClick={() => setView("day")} className="ambient-exit"><Maximize2 size={16} /> Exit display</Button>
      </main>
    );
  }

  return (
    <main className="os-shell">
      <div className="aurora aurora-one" /><div className="aurora aurora-two" />
      <div className="os-content">
        <header className="topbar">
          <div className="brand"><div className="brand-mark"><Command size={17} /></div><div><strong>Athena</strong><span>Personal AI OS</span></div></div>
          <nav className="view-switch" aria-label="Dashboard view">
            {(["day", "week", "ambient"] as ViewMode[]).map((mode) => <Button key={mode} variant="ghost" onClick={() => setView(mode)} className={view === mode ? "is-active" : ""}>{mode === "day" ? "Today" : `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`}</Button>)}
          </nav>
          <div className="system-state"><span className="live-dot" /><span>All systems normal</span><div className="avatar">JR</div></div>
        </header>

        <GlassCard className="briefing">
          <div className="brief-copy">
            <div className="eyebrow"><SunMedium size={13} /> {view === "week" ? "Weekly intelligence" : "Morning briefing"} · {now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
            <h1>{view === "week" ? "You’re moving forward." : `${greeting}, Jordan.`}</h1>
            <p>{view === "week" ? "Career momentum improved, health remained stable, and focused time increased by 2.5 hours. Spending is the only area worth watching." : "You slept well and your recovery is normal. Today is busy, but the important work fits. Your main personal priority is completing your career study session."}</p>
            <div className="focus-chain"><StatusPill tone="accent">{view === "week" ? "This week" : "Today’s focus"}</StatusPill><span>Work</span><ArrowRight /><span>Study</span><ArrowRight /><span>Gym</span></div>
          </div>
          <div className="state-stack">
            <div><MoonStar /><span>Sleep</span><strong>7h 42m</strong><StatusPill tone="good">Normal</StatusPill></div>
            <div><HeartPulse /><span>Recovery</span><strong>82 / 100</strong><StatusPill tone="good">Steady</StatusPill></div>
            <div><Zap /><span>Energy</span><strong>Good</strong><StatusPill tone="accent">+5%</StatusPill></div>
          </div>
        </GlassCard>

        <section className="command-bar">
          <div className="assistant-icon"><Sparkles size={16} /></div>
          <input aria-label="Ask Athena" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && askAthena()} placeholder="Ask Athena anything about your day…" />
          <Button variant="icon" aria-label="Use voice"><Mic size={18} /></Button>
          <Button onClick={() => askAthena()} aria-label="Send question"><Send size={16} /><span className="send-label">Ask</span></Button>
        </section>
        {answer && <div className="assistant-answer"><Sparkles size={15} /><p><strong>Athena</strong>{answer}</p><Button variant="icon" aria-label="Close answer" onClick={() => setAnswer("")}>×</Button></div>}

        <div className="dashboard-grid">
          <div className="column column-wide">
            <GlassCard>
              <div className="card-heading"><div><span className="kicker">What matters now</span><h2>Today’s priorities</h2></div><span>{initialPriorities.length - completed.length} open</span></div>
              <div className="priority-list">
                {initialPriorities.map((item) => {
                  const done = completed.includes(item.id);
                  return <button key={item.id} className={`priority-row ${done ? "completed" : ""}`} onClick={() => setCompleted((items) => done ? items.filter((id) => id !== item.id) : [...items, item.id])}><span className="check">{done ? <Check size={14} /> : `0${item.id}`}</span><span className="priority-copy"><strong>{item.title}</strong><small>{item.meta}</small></span><StatusPill tone={item.tone}>{done ? "Done" : item.state}</StatusPill><ChevronRight size={16} /></button>;
                })}
              </div>
            </GlassCard>

            <GlassCard>
              <div className="card-heading"><div><span className="kicker">Shared context</span><h2>Schedule</h2></div><span>Today</span></div>
              <div className="timeline">
                {schedule.map(({ time, title, kind, icon: Icon, tone }) => <div className="timeline-row" key={time}><time>{time}</time><span className={`timeline-icon tone-${tone}`}><Icon size={14} /></span><div><strong>{title}</strong><small>{kind}</small></div>{time === "14:00" && <StatusPill tone="critical">Attention</StatusPill>}</div>)}
              </div>
            </GlassCard>
          </div>

          <div className="column column-mid">
            <GlassCard className="insights-card">
              <div className="card-heading"><div><span className="kicker accent-text">Cross-domain intelligence</span><h2>What I noticed</h2></div><Sparkles size={18} /></div>
              <article className="insight"><div><StatusPill tone="warning">Observation</StatusPill><span>Health + Calendar</span></div><p>Your recovery has slipped over three weeks as training volume and late meetings increased.</p><div className="reason"><StatusPill>Interpretation</StatusPill><span>Higher load may be outpacing rest.</span></div></article>
              <article className="insight"><div><StatusPill tone="accent">Suggestion</StatusPill><span>Finance + Travel</span></div><p>An $840 flight lands next Friday—22% of this month’s discretionary budget.</p><Button variant="ghost" onClick={() => askAthena("How does the flight affect my budget?")}>Review impact <ArrowRight size={14} /></Button></article>
            </GlassCard>

            <GlassCard>
              <div className="card-heading"><div><span className="kicker">Goal momentum</span><h2>Career progress</h2></div><span>This week</span></div>
              <div className="progress-head"><span>Data modeling certification</span><strong>64%</strong></div>
              <div className="progress-track"><span /></div>
              <div className="tag-row"><span>+2.5h study</span><span>1 project shipped</span><span>On track</span></div>
            </GlassCard>
          </div>

          <div className="column column-narrow">
            <GlassCard><div className="card-heading"><div><span className="kicker">Live state</span><h2>Health</h2></div><HeartPulse className="good-text" size={18} /></div><div className="metric-list"><div><span>Calories</span><strong>1,980 / 2,200</strong></div><div><span>Protein</span><strong>142g</strong></div><div><span>Hydration</span><strong>1.8 / 2.5L</strong></div><div><span>Steps</span><strong>8,420</strong></div></div></GlassCard>
            <GlassCard><div className="card-heading"><div><span className="kicker">September</span><h2>Finance</h2></div><CircleDollarSign size={18} /></div><strong className="large-metric">$2,340</strong><span className="metric-change">8% less than last month</span><div className="metric-list compact"><div><span>Subscriptions</span><strong>$126</strong></div><div><span>Discretionary left</span><strong>$620</strong></div></div></GlassCard>
            <GlassCard><div className="card-heading"><div><span className="kicker">Attention</span><h2>Email</h2></div><Mail size={18} /></div><div className="mail-count"><strong>4</strong><span>of 47 require attention</span></div><p className="muted-copy">One important work email and two booking confirmations.</p></GlassCard>
          </div>
        </div>

        <footer className="trust-strip"><div><ShieldCheck size={15} /><span>AI labels facts, observations, interpretations, and suggestions.</span></div><div><Clock3 size={14} /> Updated {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></footer>
      </div>
    </main>
  );
}