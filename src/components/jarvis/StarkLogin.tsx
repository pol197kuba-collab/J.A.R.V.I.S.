import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ArcReactorTriangle } from "./ArcReactorTriangle";
import { audio } from "@/lib/audio/AudioEngine";
import { speakJarvis } from "@/lib/ai/jarvisBrain";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

type Mode = "signin" | "forgot";

export function StarkLogin({ onGranted }: { onGranted: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // If a session already exists (e.g. after OAuth redirect back), skip login.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        setLeaving(true);
        setTimeout(() => onGranted(), 400);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [onGranted]);

  function grant(name?: string) {
    audio.playAccessGranted();
    const hour = new Date().getHours();
    const tod =
      hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
    const who = name ? `${name} ` : "";
    void speakJarvis({
      prompt: `${who}has just authenticated into the JARVIS cockpit. Local time of day: ${tod}. Greet them personally for the very first line of the session. Action must be "none".`,
      fallbackKind: "greeting",
    });
    setLeaving(true);
    setTimeout(() => onGranted(), 700);
  }

  function deny(msg: string) {
    audio.playAccessDenied();
    setError(msg);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return deny(error.message);
        grant(data.user?.user_metadata?.display_name ?? data.user?.email ?? undefined);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) return deny(error.message);
        setInfo("Password reset link sent. Check your inbox.");
        setMode("signin");
      }
    } finally {
      setLoading(false);
    }
  }

  async function google() {
    setError(null);
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      deny(result.error.message ?? "Google sign-in failed.");
      return;
    }
    if (result.redirected) return; // full-page redirect
    grant();
  }

  const title =
    mode === "forgot" ? "RECOVER CIPHER" : "SECURE LOGIN";

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-full items-center justify-center overflow-hidden bg-black text-primary">
      <div
        className="animate-grid-pan pointer-events-none absolute inset-0 opacity-30"
        style={{ backgroundImage: "var(--grid-bg)", backgroundSize: "40px 40px" }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.95) 100%)",
        }}
      />

      <div className={cn("relative z-10 flex max-h-[100dvh] w-full flex-col items-center gap-1 px-3 sm:gap-2", leaving && "animate-screen-fracture")}>
        {/* Raised reactor */}
        <div className="-mb-10 max-md:-mb-6 landscape:max-md:-mb-6">
          <ArcReactorTriangle raised />
        </div>

        <form
          onSubmit={submit}
          className={cn(
            "hud-panel relative w-[min(420px,92vw)] space-y-3 p-4 animate-fade-up sm:space-y-4 sm:p-6 max-md:space-y-2 max-md:p-3 landscape:max-md:w-[min(360px,75vw)] landscape:max-md:space-y-1.5 landscape:max-md:p-2.5",
            error && "animate-deny-pulse",
          )}
        >
          <div className="text-center">
            <p className="font-display text-[10px] uppercase tracking-[0.5em] text-primary/80 max-md:text-[8px] max-md:tracking-[0.3em]">
              Stark Industries // Mark VII
            </p>
            <h2 className="font-display mt-1 text-lg tracking-[0.3em] text-foreground sm:mt-2 sm:text-xl max-md:text-base max-md:tracking-[0.2em]">
              {title}
            </h2>
          </div>

          <label className="block space-y-0.5 max-md:space-y-0">
            <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground max-md:text-[9px]">
              Operator Email
            </span>
            <input
              autoFocus
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@stark.industries"
              className="w-full border border-primary/40 bg-background/60 px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none max-md:px-2 max-md:py-1.5 max-md:text-xs landscape:max-md:py-1"
            />
          </label>

          {mode !== "forgot" && (
            <label className="block space-y-0.5 max-md:space-y-0">
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground max-md:text-[9px]">
                Cipher Key
              </span>
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-primary/40 bg-background/60 px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none max-md:px-2 max-md:py-1.5 max-md:text-xs landscape:max-md:py-1"
              />
            </label>
          )}

          {error ? (
            <p
              className="font-display animate-blink text-center text-xs uppercase tracking-[0.4em]"
              style={{ color: "var(--destructive)" }}
            >
              ✕ {error}
            </p>
          ) : info ? (
            <p className="font-display text-center text-[10px] uppercase tracking-widest text-primary">
              {info}
            </p>
          ) : (
            <p className="font-display text-center text-[10px] uppercase tracking-widest text-muted-foreground">
              Authorized personnel only
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="group relative w-full font-display cursor-pointer border border-primary/70 bg-primary/10 py-2.5 text-sm uppercase tracking-[0.4em] text-primary transition hover:bg-primary/20 hover:text-foreground sm:py-3 max-md:py-2 max-md:text-xs max-md:tracking-[0.3em] landscape:max-md:py-1.5"
            style={{ boxShadow: "var(--glow-primary)" }}
          >
            <span className="absolute -left-px -top-px h-2 w-2 border-l border-t border-primary" />
            <span className="absolute -right-px -top-px h-2 w-2 border-r border-t border-primary" />
            <span className="absolute -left-px -bottom-px h-2 w-2 border-l border-b border-primary" />
            <span className="absolute -right-px -bottom-px h-2 w-2 border-r border-b border-primary" />
            {loading
              ? "▸ Processing..."
              : mode === "signin"
                ? "▸ Request Access"
                : "▸ Send Recovery"}
          </button>

          {mode !== "forgot" && (
            <>
              <div className="flex items-center gap-2">
                <span className="h-px flex-1 bg-primary/20" />
                <span className="font-display text-[9px] uppercase tracking-widest text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-primary/20" />
              </div>
              <button
                type="button"
                onClick={google}
                disabled={loading}
                className="font-display w-full cursor-pointer border border-primary/40 bg-background/40 py-2.5 text-xs uppercase tracking-[0.3em] text-foreground transition hover:border-primary hover:bg-primary/10 max-md:py-2 max-md:text-[10px] landscape:max-md:py-1.5"
              >
                ▸ Continue with Google
              </button>
            </>
          )}

          <div className="flex justify-between gap-2 pt-1 text-[10px]">
            {mode === "signin" ? (
              <button
                type="button"
                onClick={() => { setMode("forgot"); setError(null); setInfo(null); }}
                className="font-display ml-auto uppercase tracking-widest text-muted-foreground hover:text-primary"
              >
                Forgot cipher?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setMode("signin"); setError(null); setInfo(null); }}
                className="font-display uppercase tracking-widest text-primary/80 hover:text-primary"
              >
                ← Back to sign in
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}