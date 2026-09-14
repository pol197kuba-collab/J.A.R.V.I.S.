import { describe, expect, it } from "vitest";
import { isTaskReminder, notificationTone, notificationToneColor } from "./notificationKinds";

describe("notificationTone", () => {
  it("keeps document outcomes as success/danger", () => {
    expect(notificationTone("document_ready")).toBe("success");
    expect(notificationTone("document_failed")).toBe("danger");
  });

  it("never reports an approaching or missed deadline as success", () => {
    // The actual bug being guarded: the bell used to play the "access
    // granted" chime for every kind that wasn't document_failed.
    expect(notificationTone("task_due_24h")).toBe("warning");
    expect(notificationTone("task_due_1h")).toBe("warning");
    expect(notificationTone("task_overdue")).toBe("danger");
  });

  it("falls back to a non-alarming tone for unregistered kinds", () => {
    expect(notificationTone("something_new")).toBe("success");
  });

  it("maps every tone onto a token that exists in styles.css", () => {
    expect(notificationToneColor("task_overdue")).toBe("var(--destructive)");
    expect(notificationToneColor("task_due_1h")).toBe("var(--warning)");
    expect(notificationToneColor("document_ready")).toBe("var(--success)");
  });
});

describe("isTaskReminder", () => {
  it("recognises reminder kinds and nothing else", () => {
    expect(isTaskReminder("task_overdue")).toBe(true);
    expect(isTaskReminder("task_due_24h")).toBe(true);
    expect(isTaskReminder("document_ready")).toBe(false);
  });
});
