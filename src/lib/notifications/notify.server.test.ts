// Test broniący JEDNEJ zasady: push nie decyduje o powodzeniu meldunku.
//
// Wiersz w `notifications` jest zapisem kanonicznym — to on zapala dzwonek w
// aplikacji. Powiadomienie na urządzenie jest drugą drogą tej samej
// wiadomości i wolno mu się nie udać: urządzenie może nie być zapisane,
// klucze VAPID mogą jeszcze nie istnieć, a biblioteka wysyłki może się nie
// wczytać w danym środowisku uruchomieniowym. Gdyby którakolwiek z tych
// rzeczy wywracała `notifyOwner`, nocny job kończyłby się awarią za każdym
// razem, gdy użytkownik nie włączył powiadomień — i, co gorsza, meldunek
// zapisany chwilę wcześniej nie zostałby zgłoszony wołającemu jako zapisany.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fabryka `vi.mock` jest wynoszona na górę pliku, więc nie wolno jej sięgać
// po zmienną zadeklarowaną niżej — stąd `vi.hoisted`.
const { sendPushToOwner } = vi.hoisted(() => ({ sendPushToOwner: vi.fn() }));
vi.mock("./push.server", () => ({ sendPushToOwner }));

import { notifyOwner } from "./notify.server";

/** Klient Supabase w zakresie, którego używa notifyOwner: jeden insert. */
const dbWith = (result: { data?: { id: string }; error?: { message: string } }) =>
  ({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => result,
        }),
      }),
    }),
  }) as never;

beforeEach(() => {
  sendPushToOwner.mockReset();
});

describe("notifyOwner", () => {
  it("zwraca identyfikator meldunku, choć wysyłka na urządzenie rzuciła", async () => {
    sendPushToOwner.mockRejectedValue(new Error("web-push niedostępne"));

    const result = await notifyOwner(dbWith({ data: { id: "abc" } }), "owner-1", {
      kind: "standing_order",
      title: "Bitcoin: ruch ceny",
    });

    expect(result.id).toBe("abc");
    expect(result.error).toBeNull();
  });

  it("melduje mimo braku zapisanych urządzeń", async () => {
    sendPushToOwner.mockResolvedValue({
      sent: 0,
      pruned: 0,
      failed: 0,
      skipped: "no_subscriptions",
    });

    const result = await notifyOwner(dbWith({ data: { id: "def" } }), "owner-1", {
      kind: "standing_order",
      title: "ON Ekodiesel: cena poniżej progu",
    });

    expect(result.id).toBe("def");
    expect(result.push?.skipped).toBe("no_subscriptions");
  });

  it("nie próbuje wysyłać, gdy sam zapis meldunku się nie powiódł", async () => {
    // Powiadomienie o czymś, czego nie ma w dzwonku, byłoby meldunkiem bez
    // pokrycia: użytkownik dostaje sygnał na telefon i nie znajduje nic w
    // aplikacji.
    const result = await notifyOwner(dbWith({ error: { message: "RLS" } }), "owner-1", {
      kind: "standing_order",
      title: "cokolwiek",
    });

    expect(result.id).toBeNull();
    expect(result.error).toBe("RLS");
    expect(sendPushToOwner).not.toHaveBeenCalled();
  });

  it("domyślnym znacznikiem jest rodzaj meldunku, żeby powtórki się zastępowały", async () => {
    sendPushToOwner.mockResolvedValue({ sent: 1, pruned: 0, failed: 0, skipped: null });

    await notifyOwner(dbWith({ data: { id: "ghi" } }), "owner-1", {
      kind: "document_ready",
      title: "Dokument gotowy",
      body: "prezentacja.pptx",
    });

    expect(sendPushToOwner).toHaveBeenCalledWith(
      expect.anything(),
      "owner-1",
      expect.objectContaining({ tag: "document_ready", body: "prezentacja.pptx" }),
    );
  });
});
