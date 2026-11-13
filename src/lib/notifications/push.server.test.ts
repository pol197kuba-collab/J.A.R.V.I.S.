import { describe, it, expect, vi } from "vitest";
import { makeDb } from "@/lib/agents/runtime.testkit";

// W8 (etap 6b): briefing wysłał push o 05:00:48, a telefon pokazał go około
// 07:30. Push szedł z domyślnym priorytetem „normal”, który Android w trybie
// oszczędzania baterii (Doze) odkłada. Meldunki J.A.R.V.I.S. (briefing,
// alert o korku, gotowy dokument) mają przyjść od razu — priorytet „high”
// i ograniczony czas życia, żeby nieaktualny meldunek nie przyszedł po dobie.
const sendNotification = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: vi.fn(),
    setVapidDetails: vi.fn(),
    sendNotification,
  },
}));

describe("sendPushToOwner", () => {
  it("wysyła z priorytetem high i TTL", async () => {
    const { db } = makeDb((table) => {
      if (table === "push_subscriptions")
        return {
          data: [{ id: "s1", endpoint: "https://push.test/1", p256dh: "p", auth: "a" }],
          error: null,
        };
      if (table === "user_secrets")
        return {
          data: { vapid_public_key: "pub", vapid_private_key: "priv", vapid_subject: "https://x" },
          error: null,
        };
      return undefined;
    });
    const { sendPushToOwner, PUSH_TTL_SECONDS } = await import("./push.server");
    const res = await sendPushToOwner(db, "u1", { title: "Briefing", body: "…" });
    expect(res.sent).toBe(1);
    const options = sendNotification.mock.calls[0][2] as Record<string, unknown>;
    expect(options).toMatchObject({ urgency: "high", TTL: PUSH_TTL_SECONDS });
  });
});
