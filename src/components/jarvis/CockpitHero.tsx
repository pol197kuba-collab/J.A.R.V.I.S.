// Kokpit startowy — the dynamic hero that replaced the static "SYSTEM
// OPERATIONAL / WELCOME" banner. Forward-looking on purpose: what's waiting
// for you right now (overdue/upcoming tasks, files ready to download,
// unread notifications), not what already happened — that's the Living
// Feed's job (/feed) and System Pulse's job (stats below this hero).
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Clock, FileDown, Bell, MessageSquare, Rss, StickyNote } from "lucide-react";
import { getCockpit, type CockpitTask } from "@/lib/dashboard/dashboard.functions";
import { useHudNavigate } from "./TransitionContext";
import { cn } from "@/lib/utils";

function TaskLine({ task, urgent }: { task: CockpitTask; urgent?: boolean }) {
  return (
    <li className="flex min-w-0 items-center gap-2 py-0.5">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: urgent ? "var(--destructive)" : "var(--primary)" }}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/85">
        {task.title}
      </span>
      {task.dueAt && (
        <span
          className="shrink-0 font-mono text-[10px]"
          style={{ color: urgent ? "var(--destructive)" : "var(--muted-foreground)" }}
        >
          {new Date(task.dueAt).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}
        </span>
      )}
    </li>
  );
}

function ColumnLabel({ icon: Icon, children }: { icon: typeof Clock; children: ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      {children}
    </p>
  );
}

export function CockpitHero() {
  const { go } = useHudNavigate();
  const fetchCockpit = useServerFn(getCockpit);
  const { data: cockpit } = useQuery({
    queryKey: ["dashboard", "cockpit"],
    queryFn: () => fetchCockpit(),
    refetchInterval: 20_000,
  });

  const actions = [
    { label: "Otwórz czat", icon: MessageSquare, to: "/jarvis" },
    { label: "Feed", icon: Rss, to: "/feed" },
    { label: "Notatki", icon: StickyNote, to: "/notes" },
    {
      label: cockpit ? `Powiadomienia (${cockpit.unreadNotifications})` : "Powiadomienia",
      icon: Bell,
      to: "/jarvis",
    },
  ] as const;

  return (
    <div className="relative space-y-4">
      <div className="space-y-2">
        <p className="font-display text-[10px] uppercase tracking-[0.4em] text-primary/70">
          ▸ Stark Industries · Operating System
        </p>
        <h1 className="font-display text-3xl font-bold leading-tight tracking-[0.14em] text-foreground">
          CO CZEKA NA CIEBIE
          <span className="mt-1 block text-xl tracking-[0.2em] text-primary/90">
            WITAJ, PANIE SŁAWIŃSKI
          </span>
        </h1>
      </div>

      {!cockpit ? (
        <p className="font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          ▸ Ładowanie kokpitu…
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 @[480px]:grid-cols-2 @[860px]:grid-cols-3">
          <div>
            <ColumnLabel icon={AlertTriangle}>
              Zaległe {cockpit.overdueTasks.length > 0 && `(${cockpit.overdueTasks.length})`}
            </ColumnLabel>
            {cockpit.overdueTasks.length === 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground/60">brak zaległości</p>
            ) : (
              <ul>
                {cockpit.overdueTasks.map((t) => (
                  <TaskLine key={t.id} task={t} urgent />
                ))}
              </ul>
            )}
          </div>

          <div>
            <ColumnLabel icon={Clock}>Najbliższe zadania</ColumnLabel>
            {cockpit.upcomingTasks.length === 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground/60">brak otwartych zadań</p>
            ) : (
              <ul>
                {cockpit.upcomingTasks.map((t) => (
                  <TaskLine key={t.id} task={t} />
                ))}
              </ul>
            )}
          </div>

          <div>
            <ColumnLabel icon={FileDown}>Ostatnie pliki</ColumnLabel>
            {cockpit.recentFiles.length === 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground/60">
                nic jeszcze nie powstało
              </p>
            ) : (
              <ul className="space-y-0.5">
                {cockpit.recentFiles.map((f) => (
                  <li key={f.id} className="min-w-0">
                    {f.downloadUrl ? (
                      <a
                        href={f.downloadUrl}
                        className="block truncate font-mono text-xs text-primary/90 hover:text-primary hover:underline"
                      >
                        {f.title ?? f.filename}
                      </a>
                    ) : (
                      <span className="block truncate font-mono text-xs text-foreground/70">
                        {f.title ?? f.filename}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => go(a.to)}
            className={cn(
              "font-display flex items-center gap-1.5 border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[9px] uppercase tracking-widest text-primary/85 transition hover:border-primary hover:bg-primary/15 hover:text-primary",
            )}
          >
            <a.icon className="h-3 w-3" strokeWidth={1.75} />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
