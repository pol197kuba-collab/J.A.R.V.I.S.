import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDocImages } from "./producer.server";
import type { DeckSpec } from "./docSpec";

// Warstwy szukania obrazu mogą odpaść z czterech różnych powodów, a do logu
// trafiało jedno zdanie: „no image resolved". Te testy pilnują, żeby w
// meldunku było CZEGO szukano i KTÓRA warstwa odpadła — bo bez tego diagnoza
// wymaga zgadywania.

const deck = (imageQuery: string): DeckSpec => ({
  format: "pptx",
  title: "Test",
  filename: "test.pptx",
  slides: [{ layout: "bullets", heading: "Slajd", imageQuery }],
});

/** Odpowiada na każdy adres tak, jak każe `routes`; reszta to 404. */
const router = (routes: Array<[RegExp, unknown]>) =>
  vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [re, body] of routes) {
      if (re.test(url)) {
        if (body === null) return { ok: false, status: 503, url } as Response;
        return {
          ok: true,
          status: 200,
          url,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }
    }
    return { ok: false, status: 404, url } as Response;
  });

const warnings = async (spec: DeckSpec): Promise<string[]> => {
  const out: string[] = [];
  await generateDocImages(spec, "klucz", (m) => void out.push(m));
  return out;
};

afterEach(() => vi.unstubAllGlobals());

describe("generateDocImages — meldunek o nieudanym szukaniu", () => {
  it("podaje ZAPYTANIE, którego szukał", async () => {
    vi.stubGlobal("fetch", router([]));
    const [warn] = await warnings(deck("silnik Pentastar V6"));
    expect(warn).toContain("silnik Pentastar V6");
  });

  it("wymienia każdą warstwę z osobna, zamiast „no image resolved”", async () => {
    vi.stubGlobal(
      "fetch",
      router([
        [/wikipedia\.org\/w\/api\.php/, { query: { search: [] } }],
        [/openverse/, { results: [] }],
        [/generativelanguage/, { candidates: [] }],
      ]),
    );
    const [warn] = await warnings(deck("Dodge Charger"));
    expect(warn).toContain("cse: pominięte");
    expect(warn).toContain("wikipedia:en brak artykułu");
    expect(warn).toContain("openverse: 0 wyników");
    expect(warn).not.toContain("no image resolved");
  });

  it("próbuje polskiej Wikipedii, gdy angielska nie zna tematu", async () => {
    // Opis obrazu ma być angielski, ale w polskim dokumencie model regularnie
    // zjeżdża na polski — a wtedy en.wikipedia i Openverse zwracają pustkę.
    const fetchMock = router([
      [/wikipedia\.org\/w\/api\.php/, { query: { search: [] } }],
      [/openverse/, { results: [] }],
      [/generativelanguage/, { candidates: [] }],
    ]);
    vi.stubGlobal("fetch", fetchMock);
    await warnings(deck("zamek w Malborku"));
    const hosts = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(hosts.some((u) => u.includes("en.wikipedia.org"))).toBe(true);
    expect(hosts.some((u) => u.includes("pl.wikipedia.org"))).toBe(true);
  });

  it("nie wywraca się, gdy ostatnia warstwa odpowie błędem", async () => {
    // Openverse rzucał wyjątkiem zamiast zwrócić null jak każda inna
    // warstwa — i zamieniał „nie znalazłem" w „zadanie się wysypało".
    vi.stubGlobal(
      "fetch",
      router([
        [/wikipedia\.org\/w\/api\.php/, { query: { search: [] } }],
        [/generativelanguage/, { candidates: [] }],
        [/openverse/, null],
      ]),
    );
    const [warn] = await warnings(deck("cokolwiek"));
    expect(warn).toContain("openverse: HTTP 503");
  });
});
