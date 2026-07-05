import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "JARVIS // Reset Cipher" },
      { name: "description", content: "Reset your JARVIS access cipher." },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  // Supabase places a recovery session on the URL hash; SDK picks it up
  // automatically. We wait for a session to be present before submitting.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setReady(Boolean(data.session));
    });
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(error.message);
    setOk(true);
    setTimeout(() => void navigate({ to: "/" }), 1500);
  }

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-full items-center justify-center overflow-hidden bg-black text-primary">
      <div
        className="animate-grid-pan pointer-events-none absolute inset-0 opacity-30"
        style={{ backgroundImage: "var(--grid-bg)", backgroundSize: "40px 40px" }}
      />
      <form
        onSubmit={submit}
        className="hud-panel relative z-10 w-[min(420px,92vw)] space-y-4 p-6 animate-fade-up"
      >
        <div className="text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.5em] text-primary/80">
            Stark Industries // Mark VII
          </p>
          <h1 className="font-display mt-2 text-xl tracking-[0.3em] text-foreground">
            RESET CIPHER
          </h1>
        </div>

        {!ready && !ok && (
          <p className="font-display text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            Awaiting recovery link... open the reset link from your email.
          </p>
        )}

        {ok ? (
          <p className="font-display text-center text-[10px] uppercase tracking-widest text-primary">
            ✓ Cipher updated. Redirecting...
          </p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                New Cipher
              </span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-primary/40 bg-background/60 px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                Confirm Cipher
              </span>
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full border border-primary/40 bg-background/60 px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            {error && (
              <p
                className="font-display animate-blink text-center text-xs uppercase tracking-[0.4em]"
                style={{ color: "var(--destructive)" }}
              >
                ✕ {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !ready}
              className="font-display w-full cursor-pointer border border-primary/70 bg-primary/10 py-3 text-sm uppercase tracking-[0.4em] text-primary transition hover:bg-primary/20 hover:text-foreground disabled:opacity-50"
              style={{ boxShadow: "var(--glow-primary)" }}
            >
              {loading ? "▸ Updating..." : "▸ Update Cipher"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}