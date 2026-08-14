// Visible half of the background-job notification system. A background
// document job (documentJobs.functions.ts) inserts a row into
// public.notifications on completion — success OR failure, never silent —
// and this component picks it up over Supabase Realtime the instant it
// lands, regardless of what screen the user is on.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { audio } from "@/lib/audio/AudioEngine";
import {
  listNotifications,
  markAllNotificationsRead,
  type AppNotification,
} from "@/lib/notifications/notifications.functions";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function NotificationBell() {
  const qc = useQueryClient();
  const fetchNotifications = useServerFn(listNotifications);
  const markAllRead = useServerFn(markAllNotificationsRead);
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => fetchNotifications({ data: { limit: 30 } }),
    // Realtime below is the primary path — this is only a safety net for a
    // missed websocket event (tab was asleep, brief reconnect, etc.).
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel("notifications-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const row = payload.new as { kind: string; title: string; body: string | null };
          qc.invalidateQueries({ queryKey: ["notifications", "list"] });
          const failed = row.kind === "document_failed";
          toast(row.title, { description: row.body ?? undefined });
          if (failed) audio.playAccessDenied();
          else audio.playAccessGranted();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && unreadCount > 0) {
      markAllRead().then(() => qc.invalidateQueries({ queryKey: ["notifications", "list"] }));
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Powiadomienia"
          className="font-display group relative flex items-center gap-1.5 border border-primary/50 bg-primary/[0.08] px-2 py-1 text-[10px] uppercase tracking-[0.3em] text-primary shadow-[0_0_12px_-4px_var(--primary)] transition portrait:h-6 portrait:w-6 portrait:justify-center portrait:px-0 portrait:py-0 landscape:max-md:px-1.5 landscape:max-md:py-0.5 landscape:max-md:text-[8px] short:px-1.5 short:py-0.5 short:text-[8px]"
        >
          <Bell
            strokeWidth={1.75}
            className="h-3.5 w-3.5 portrait:h-3 portrait:w-3 landscape:max-md:h-3 landscape:max-md:w-3 short:h-3 short:w-3"
          />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--destructive)] px-1 font-mono text-[8px] leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 border-primary/30 bg-black/90 p-0 backdrop-blur-xl"
      >
        <div className="border-b border-primary/20 px-3 py-2 font-display text-[10px] uppercase tracking-[0.25em] text-primary/80">
          Powiadomienia
        </div>
        <div className="no-scrollbar max-h-80 min-h-0 overflow-y-auto overflow-x-hidden">
          {notifications.length === 0 ? (
            <p className="px-3 py-4 font-mono text-[10px] uppercase tracking-widest text-white/40">
              brak powiadomień
            </p>
          ) : (
            notifications.map((n) => <NotificationRow key={n.id} notification={n} />)
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({ notification }: { notification: AppNotification }) {
  const failed = notification.kind === "document_failed";
  const payload =
    notification.payload &&
    typeof notification.payload === "object" &&
    !Array.isArray(notification.payload)
      ? (notification.payload as Record<string, unknown>)
      : undefined;
  const downloadUrl = typeof payload?.download_url === "string" ? payload.download_url : undefined;

  return (
    <div
      className={
        "min-w-0 border-b border-primary/10 px-3 py-2 last:border-b-0" +
        (notification.read ? " opacity-60" : "")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className="min-w-0 flex-1 truncate font-display text-[11px] uppercase tracking-wide"
          style={{ color: failed ? "var(--destructive)" : "var(--success)" }}
        >
          {notification.title}
        </p>
        <span className="shrink-0 font-mono text-[9px] text-white/30">
          {timeOf(notification.createdAt)}
        </span>
      </div>
      {notification.body && (
        <p className="mt-1 min-w-0 break-words text-[11px] leading-snug text-white/70">
          {notification.body}
        </p>
      )}
      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-mono text-[10px] uppercase tracking-wide text-primary underline underline-offset-2"
        >
          Pobierz plik
        </a>
      )}
    </div>
  );
}
