// Atrapa API Gemini dla testu dymnego (etap 9). Odpowiada w kształcie
// generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
// i :embedContent — tylko tyle, ile potrzebuje przepływ czat → notatka:
//
//   1. tura z prośbą „zapisz notatkę” i narzędziem save_note → wywołanie save_note;
//   2. tura z odpowiedzią save_note → krótki tekst (MOCK_REPLY);
//   3. każda inna tura (briefing, klasyfikator…) → „OK”;
//   4. embedContent → wektor o właściwym wymiarze.
import { createServer } from "node:http";
import { EMBED_DIMS, MOCK_PORT, MOCK_REPLY, NOTE_BODY, NOTE_TITLE } from "./fixtures";

type Part = { text?: string; functionResponse?: { name?: string } };
type Body = {
  contents?: Array<{ parts?: Part[] }>;
  tools?: Array<{ functionDeclarations?: Array<{ name?: string }> }>;
};

const usage = { promptTokenCount: 10, candidatesTokenCount: 5 };
const text = (t: string) => ({
  candidates: [{ content: { role: "model", parts: [{ text: t }] }, finishReason: "STOP" }],
  usageMetadata: usage,
});

export function answer(path: string, body: Body): unknown {
  if (path.endsWith(":embedContent")) {
    return { embedding: { values: Array.from({ length: EMBED_DIMS }, (_, i) => (i % 7) / 100) } };
  }
  const parts = (body.contents ?? []).flatMap((c) => c.parts ?? []);
  if (parts.some((p) => p.functionResponse?.name === "save_note")) return text(MOCK_REPLY);
  const declared = (body.tools ?? []).flatMap((t) => t.functionDeclarations ?? []);
  // Notatka tylko na wyraźną prośbę z testu — nie przy automatycznym
  // powitaniu po zalogowaniu (ono też idzie przez agenta z narzędziami).
  const lastText =
    (body.contents ?? [])
      .at(-1)
      ?.parts?.map((p) => p.text ?? "")
      .join(" ") ?? "";
  if (declared.some((d) => d.name === "save_note") && /zapisz notatk/i.test(lastText)) {
    return {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { functionCall: { name: "save_note", args: { title: NOTE_TITLE, body: NOTE_BODY } } },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: usage,
    };
  }
  return text("OK");
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body: Body = {};
    try {
      body = raw ? (JSON.parse(raw) as Body) : {};
    } catch {
      // pusta / zła treść → odpowiedź jak dla zwykłej tury
    }
    const path = (req.url ?? "").split("?")[0];
    console.log(`[gemini-mock] ${req.method} ${path}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer(path, body)));
  });
}).listen(MOCK_PORT, "127.0.0.1", () => console.log(`[gemini-mock] :${MOCK_PORT}`));
