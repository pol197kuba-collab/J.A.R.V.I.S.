// Visible half of the background-job notification system. A background
// document job (documentJobs.functions.ts) inserts a row into
// public.notifications on completion — success OR failure, never silent —
// and this component picks it up over Supabase Realtime the instant it
// lands, regardless of what screen the user is on.
import { useEffect, useRef, useState, type TouchEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, X } from "lucide-react";
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
  deleteNotification,
  type AppNotification,
} from "@/lib/notifications/notifications.functions";

// How far (px) a swipe-left has to travel before release counts as "delete"
// rather than snapping back — short enough to feel responsive on a phone,
// long enough that a vertical scroll inside the dropdown doesn't misfire it.
const SWIPE_DELETE_THRESHOLD = 64;
// Hard cap on how far the row can be dragged, so the revealed red "delete"
// backing never overshoots into visibly empty space past its own width.
const SWIPE_MAX_DRAG = 96;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function NotificationBell() {
  const qc = useQueryClient();
  const fetchNotifications = useServerFn(listNotifications);
  const markAllRead = useServerFn(markAllNotificationsRead);
  const deleteNotif = useServerFn(deleteNotification);
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

  // Optimistic removal — the row disappears immediately (swipe/tap already
  // animated it out), and only rolls back by refetching if the delete
  // itself failed server-side.
  const handleDelete = (id: string) => {
    qc.setQueryData<AppNotification[]>(["notifications", "list"], (old) =>
      (old ?? []).filter((n) => n.id !== id),
    );
    deleteNotif({ data: { id } }).catch(() => {
      qc.invalidateQueries({ queryKey: ["notifications", "list"] });
    });
  };

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
            notifications.map((n) => (
              <NotificationRow key={n.id} notification={n} onDelete={() => handleDelete(n.id)} />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({
  notification,
  onDelete,
}: {
  notification: AppNotification;
  onDelete: () => void;
}) {
  const failed = notification.kind === "document_failed";
  const payload =
    notification.payload &&
    typeof notification.payload === "object" &&
    !Array.isArray(notification.payload)
      ? (notification.payload as Record<string, unknown>)
      : undefined;
  const downloadUrl = typeof payload?.download_url === "string" ? payload.download_url : undefined;

  // Swipe-left-to-delete (mobile): tracks the raw touch delta rather than
  // reading e.target — a dropdown-menu content area can intercept touch
  // targets in ways that make per-element hit-testing unreliable, but the
  // start/current X coordinates are always accurate regardless of what's
  // under the finger.
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  // Once a gesture commits to horizontal (swipe) or vertical (scroll), it
  // stays committed for the rest of that touch — otherwise a diagonal
  // finger movement could fight the dropdown's own vertical scrolling.
  const axisLock = useRef<"x" | "y" | null>(null);

  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    axisLock.current = null;
    setDragging(true);
  };
  const onTouchMove = (e: TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!axisLock.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axisLock.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axisLock.current !== "x") return;
    // Only swipe LEFT reveals delete — clamp positive drag to 0 so the row
    // can't be dragged rightward off-screen.
    setDragX(Math.max(-SWIPE_MAX_DRAG, Math.min(0, dx)));
  };
  const onTouchEnd = () => {
    setDragging(false);
    if (dragX <= -SWIPE_DELETE_THRESHOLD) {
      onDelete();
    } else {
      setDragX(0);
    }
    touchStartX.current = null;
    touchStartY.current = null;
    axisLock.current = null;
  };

  return (
    <div className="relative min-w-0 overflow-hidden border-b border-primary/10 last:border-b-0">
      {/* Red "delete" backing revealed as the row swipes left. */}
      <div className="absolute inset-0 flex items-center justify-end bg-[color:var(--destructive)]/80 px-3">
        <X className="h-4 w-4 text-white" strokeWidth={2} />
      </div>
      <div
        className="relative min-w-0 bg-[color:var(--surface-0,black)] px-3 py-2 group/notif"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : "transform 200ms ease-out",
          opacity: notification.read ? 0.6 : 1,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
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
          <button
            type="button"
            aria-label="Usuń powiadomienie"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="shrink-0 rounded p-0.5 text-white/30 opacity-0 transition hover:text-white/80 group-hover/notif:opacity-100 focus-visible:opacity-100 portrait:opacity-100"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
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
    </div>
  );
}
