import { useEffect, useRef, useState } from "react";
import { Pencil, Check } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { cn } from "@/lib/utils";
import { MAX_HEARTS, saveDogName, type DogMood } from "./dogMood";
import type { DogAction, TownDog } from "./townDog";

const ACTIONS: { action: DogAction; label: string }[] = [
  { action: "pet", label: "Pogłaszcz" },
  { action: "fetch", label: "Aport" },
  { action: "treat", label: "Smakołyk" },
  { action: "call", label: "Do mnie" },
  { action: "sleep", label: "Spać" },
];

/** The spaniel's card: portrait, name, mood, today's counters and the buttons. */
export function CompanionPanel({
  dog,
  name,
  onRename,
  mood,
  index,
}: {
  dog: TownDog | null;
  name: string;
  onRename: (name: string) => void;
  mood: DogMood;
  index: number;
}) {
  const portraitRef = useRef<HTMLCanvasElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    if (dog && portraitRef.current) dog.drawPortrait(portraitRef.current);
  }, [dog]);

  const commit = () => {
    const next = draft.trim().slice(0, 16) || name;
    saveDogName(next);
    onRename(next);
    setEditing(false);
  };
  const full = Math.floor(mood.hearts);
  const half = mood.hearts - full >= 0.5;

  return (
    <HudPanel index={index} title="TOWARZYSZ" tone="quiet">
      <div className="flex items-center gap-3 p-4 @max-[420px]:p-3">
        <canvas
          ref={portraitRef}
          width={64}
          height={64}
          aria-hidden
          className="h-16 w-16 shrink-0 border-2 border-border bg-background"
          style={{ imageRendering: "pixelated" }}
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
            >
              <input
                id="dog-name"
                autoFocus
                value={draft}
                maxLength={16}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Imię psa"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none"
              />
              <button type="submit" aria-label="Zapisz imię" className="p-1 text-primary">
                <Check className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="font-display truncate text-base">{name}</h2>
              <button
                type="button"
                onClick={() => {
                  setDraft(name);
                  setEditing(true);
                }}
                aria-label="Zmień imię"
                className="p-1 text-muted-foreground hover:text-primary"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Cocker spaniel · 1 rok · Twój towarzysz</p>
          <p
            className="mt-1 text-sm"
            aria-label={`Humor: ${mood.hearts.toFixed(1)} na ${MAX_HEARTS}`}
          >
            {Array.from({ length: MAX_HEARTS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "mr-0.5",
                  i < full
                    ? "text-destructive"
                    : i === full && half
                      ? "text-destructive/50"
                      : "text-muted-foreground/40",
                )}
              >
                ♥
              </span>
            ))}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-3 @max-[420px]:px-3">
        {ACTIONS.map((a) => (
          <button
            key={a.action}
            type="button"
            disabled={!dog}
            onClick={() => void dog?.interact(a.action)}
            className="font-display rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground @max-[420px]:px-3">
        Dziś: {mood.pets}× głaskanie · {mood.fetches}× aport · {mood.treats}× smakołyk. Kliknij psa
        na mapie, żeby go pogłaskać.
      </p>
    </HudPanel>
  );
}
