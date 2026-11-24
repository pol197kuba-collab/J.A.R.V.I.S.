// Ikona głośnika w nagłówku czatu: czytanie odpowiedzi na głos wł. / wył.

import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { setVoiceMuted } from "@/lib/audio/speak";
import { useVoiceMuted } from "@/lib/audio/useSpeech";

export function VoiceMuteToggle({ className }: { className?: string }) {
  const muted = useVoiceMuted();
  const label = muted ? "Włącz czytanie odpowiedzi na głos" : "Wyłącz czytanie odpowiedzi na głos";
  return (
    <button
      type="button"
      onClick={() => setVoiceMuted(!muted)}
      aria-pressed={!muted}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-primary/10",
        muted ? "text-muted-foreground" : "text-primary",
        className,
      )}
    >
      {muted ? (
        <VolumeX className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : (
        <Volume2 className="h-3.5 w-3.5" strokeWidth={1.5} />
      )}
    </button>
  );
}
