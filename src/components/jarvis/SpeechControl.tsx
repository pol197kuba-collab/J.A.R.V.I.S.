// Pasek „J.A.R.V.I.S. mówi” — pojawia się tylko podczas czytania na głos.
// Przerwij zatrzymuje bieżącą odpowiedź (i kolejkę), Wycisz wyłącza głos na
// stałe (włącza się go z powrotem ikoną głośnika w czacie). Esc też przerywa.
// Na telefonie wisi nad dokiem, na komputerze u dołu na środku.

import { useEffect } from "react";
import { Square, VolumeX } from "lucide-react";
import { setVoiceMuted, speakCancel } from "@/lib/audio/speak";
import { useSpeaking } from "@/lib/audio/useSpeech";

export function SpeechControl() {
  const speaking = useSpeaking();

  useEffect(() => {
    if (!speaking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") speakCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speaking]);

  if (!speaking) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border border-primary/40 bg-background/90 py-1 pr-1 pl-3 shadow-[0_0_24px_-6px_color-mix(in_oklab,var(--primary)_60%,transparent)] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in bottom-[calc(96px+env(safe-area-inset-bottom))] md:bottom-6"
    >
      <span aria-hidden className="mr-1 flex h-3 items-end gap-[2px]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-full w-[2px] origin-bottom bg-primary/80"
            style={{ animation: `wave-bar ${0.5 + i * 0.12}s ease-in-out ${i * 0.07}s infinite` }}
          />
        ))}
      </span>
      <span className="font-display mr-1 text-[10px] uppercase tracking-[0.2em] text-primary">
        Mówię
      </span>
      <button
        type="button"
        onClick={() => speakCancel()}
        title="Przerwij czytanie (Esc)"
        className="font-display flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-foreground transition hover:bg-primary/15"
      >
        <Square className="h-3 w-3 fill-current" />
        Przerwij
      </button>
      <button
        type="button"
        onClick={() => setVoiceMuted(true)}
        title="Wyłącz czytanie na głos (włączysz ikoną głośnika w czacie)"
        className="font-display flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition hover:bg-primary/15 hover:text-foreground"
      >
        <VolumeX className="h-3.5 w-3.5" />
        Wycisz
      </button>
    </div>
  );
}
