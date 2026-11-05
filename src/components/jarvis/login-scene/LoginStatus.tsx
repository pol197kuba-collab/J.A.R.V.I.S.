import { useQueryClient } from "@tanstack/react-query";
import { pluralPl } from "./loginStatus";

/**
 * Readouts next to the 3D login reactor. Every value is real: the transport
 * comes from the page protocol, the agent count from the react-query agents
 * cache (absent before login — then no number is claimed), the biometric line
 * from whether a key has been typed.
 */
export function LoginStatus({ passwordTyped }: { passwordTyped: boolean }) {
  const queryClient = useQueryClient();
  const secure = typeof window !== "undefined" && window.location.protocol === "https:";
  const rows = queryClient.getQueryData<{ slug: string; isEnabled: boolean }[]>(["agents", "list"]);
  const ready = rows ? rows.filter((a) => a.slug !== "jarvis" && a.isEnabled).length : null;

  const items: { text: string; wait?: boolean }[] = [
    { text: secure ? "Kanał szyfrowany · HTTPS" : "Kanał lokalny · bez szyfrowania (HTTP)" },
    {
      text:
        ready === null
          ? "Macierz agentów · w gotowości"
          : `Macierz agentów · ${ready} ${pluralPl(ready, "węzeł", "węzły", "węzłów")} w gotowości`,
    },
    passwordTyped
      ? { text: "Biometria · klucz wprowadzony" }
      : { text: "Biometria · oczekuje na klucz", wait: true },
  ];

  return (
    <ul
      aria-hidden="true"
      className="font-display m-0 grid w-[min(420px,92vw)] list-none gap-[7px] p-0 text-[10px] uppercase leading-[1.3] tracking-[0.2em] text-muted-foreground max-[860px]:hidden"
    >
      {items.map((it) => (
        <li key={it.text} className="animate-fade-up flex items-center gap-2.5">
          <i
            className="h-1.5 w-1.5 animate-blink rounded-full"
            style={{
              background: it.wait ? "var(--reactor-hot)" : "var(--primary)",
              boxShadow: `0 0 8px ${it.wait ? "var(--reactor-hot)" : "var(--primary)"}`,
            }}
          />
          {it.text}
        </li>
      ))}
    </ul>
  );
}
