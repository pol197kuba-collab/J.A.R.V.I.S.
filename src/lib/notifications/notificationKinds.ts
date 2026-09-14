// How a notification `kind` should look and sound.
//
// `notifications.kind` is deliberately open-ended (the table's own comment:
// "document_ready | document_failed | future kinds (local jobs, tasks...)"),
// and the proactive layer is the first producer of kinds that are neither a
// success nor a failure but a *warning* — a deadline approaching. Playing
// the "access granted" chime for "your deadline passed" is the specific bug
// this module exists to prevent, so keep the mapping here rather than
// re-deriving it at each call site.
export type NotificationTone = "success" | "warning" | "danger";

const TONE_BY_KIND: Readonly<Record<string, NotificationTone>> = {
  document_ready: "success",
  document_failed: "danger",
  task_due_24h: "warning",
  task_due_1h: "warning",
  task_overdue: "danger",
};

// Unknown kinds read as "success" so a future producer that forgets to
// register here still renders as an ordinary, non-alarming notification.
export function notificationTone(kind: string): NotificationTone {
  return TONE_BY_KIND[kind] ?? "success";
}

// CSS custom properties, not Tailwind classes: these are applied inline in
// NotificationBell (the title colour is already an inline style there) and
// all three tokens exist in styles.css.
export function notificationToneColor(kind: string): string {
  switch (notificationTone(kind)) {
    case "danger":
      return "var(--destructive)";
    case "warning":
      return "var(--warning)";
    default:
      return "var(--success)";
  }
}

// True for any notification produced by a task reminder — those carry a
// `task_id` payload and are worth linking straight to /tasks.
export function isTaskReminder(kind: string): boolean {
  return kind.startsWith("task_");
}
