import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArcReactorTriangle } from "./ArcReactorTriangle";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";

// ⚠️ DEMO GATE — NOT REAL AUTH.
// This login screen performs a plaintext, client-side credential check
// (operator name + cipher key compared against string literals below).
// The credentials ship inside the JS bundle, so any visitor can read them
// in DevTools or bypass the gate by mutating component state. Acceptable
// only because the dashboard exposes no privileged data.
// TODO: Replace with Supabase / Lovable Cloud Auth (server-validated session,
// `requireSupabaseAuth` middleware on protected server functions, and a
// proper `_authenticated` route gate) before shipping any sensitive surface.
export function StarkLogin({ onGranted }: { onGranted: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [denied, setDenied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (login.trim() === "Jacob" && password === "Slawinsky") {
      audio.playAccessGranted();
      speak("Welcome back, Mister Slawinsky. Systems are fully operational.");
      setLeaving(true);
      setTimeout(() => onGranted(), 700);
    } else {
      audio.playAccessDenied();
      setDenied(true);
      setTimeout(() => setDenied(false), 1500);
    }
  }

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

      <div className={cn("relative z-10 flex flex-col items-center gap-2 landscape:max-md:gap-0", leaving && "animate-screen-fracture")}>
        {/* Raised reactor */}
        <div className="-mb-12 landscape:max-md:-mb-6">
          <ArcReactorTriangle raised />
        </div>

        <form
          onSubmit={submit}
          className={cn(
            "hud-panel relative w-[min(420px,92vw)] space-y-4 p-6 animate-fade-up landscape:max-md:w-[min(360px,75vw)] landscape:max-md:space-y-2 landscape:max-md:p-3",
            denied && "animate-deny-pulse",
          )}
        >
          <div className="text-center">
            <p className="font-display text-[10px] uppercase tracking-[0.5em] text-primary/80 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.3em]">
              Stark Industries // Mark VII
            </p>
            <h2 className="font-display mt-2 text-xl tracking-[0.3em] text-foreground landscape:max-md:mt-0.5 landscape:max-md:text-sm landscape:max-md:tracking-[0.2em]">
              SECURE LOGIN
            </h2>
          </div>

          <label className="block space-y-1 landscape:max-md:space-y-0">
            <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
              Operator ID
            </span>
            <input
              autoFocus
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="Enter operator name"
              className="w-full border border-primary/40 bg-background/60 px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none landscape:max-md:px-2 landscape:max-md:py-1 landscape:max-md:text-xs"
            />
          </label>
          <label className="block space-y-1 landscape:max-md:space-y-0">
            <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
              Cipher Key
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-primary/40 bg-background/60 px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none landscape:max-md:px-2 landscape:max-md:py-1 landscape:max-md:text-xs"
            />
          </label>

          {denied ? (
            <p
              className="font-display animate-blink text-center text-xs uppercase tracking-[0.4em]"
              style={{ color: "var(--destructive)" }}
            >
              ✕ ACCESS DENIED
            </p>
          ) : (
            <p className="font-display text-center text-[10px] uppercase tracking-widest text-muted-foreground">
              Authorized personnel only
            </p>
          )}

          <button
            type="submit"
            className="group relative w-full font-display cursor-pointer border border-primary/70 bg-primary/10 py-3 text-sm uppercase tracking-[0.4em] text-primary transition hover:bg-primary/20 hover:text-foreground landscape:max-md:py-1.5 landscape:max-md:text-xs landscape:max-md:tracking-[0.3em]"
            style={{ boxShadow: "var(--glow-primary)" }}
          >
            <span className="absolute -left-px -top-px h-2 w-2 border-l border-t border-primary" />
            <span className="absolute -right-px -top-px h-2 w-2 border-r border-t border-primary" />
            <span className="absolute -left-px -bottom-px h-2 w-2 border-l border-b border-primary" />
            <span className="absolute -right-px -bottom-px h-2 w-2 border-r border-b border-primary" />
            ▸ Access Granted
          </button>
        </form>
      </div>
    </div>
  );
}