import { useState, type FormEvent } from "react";
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/hooks/use-auth";

/**
 * Login gate for the Athena dashboard. Rendered instead of the dashboard
 * whenever the session is missing/expired. Posts to /api/login (session
 * cookie set server-side) and asks the parent to re-check auth status.
 */
export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    login.mutate(
      { username: username.trim(), password },
      {
        onSuccess: () => {
          setPassword("");
          onSuccess();
        },
      },
    );
  };

  return (
    <main
      className="os-shell"
      style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />
      <section className="glass-card" style={{ width: "min(360px, 90vw)", padding: "2rem" }}>
        <div
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}
        >
          <ShieldCheck size={20} className="good-text" />
          <div>
            <strong style={{ display: "block", fontSize: "1.05rem" }}>Athena</strong>
            <span style={{ fontSize: "0.78rem", opacity: 0.6 }}>Sign in to continue</span>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <Label htmlFor="athena-username">Username</Label>
            <Input
              id="athena-username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={login.isPending}
              autoFocus
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <Label htmlFor="athena-password">Password</Label>
            <Input
              id="athena-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={login.isPending}
            />
          </div>

          {login.isError && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.4rem",
                fontSize: "0.8rem",
                color: "var(--color-destructive, #f87171)",
              }}
            >
              <AlertCircle size={14} style={{ marginTop: "0.1rem", flexShrink: 0 }} />
              <span>{login.error.message}</span>
            </div>
          )}

          <Button type="submit" disabled={login.isPending || !username.trim() || !password}>
            {login.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <p style={{ marginTop: "1.25rem", fontSize: "0.72rem", opacity: 0.5, textAlign: "center" }}>
          Health, schedule, and email data stay private until you sign in.
        </p>
      </section>
    </main>
  );
}
