// DOKUMENTY — wyciąganie tekstu i tabel z plików biurowych. Czyste
// (bez sieci i bazy), testowane w extract.test.ts.
//
// .docx / .odt / .xlsx to archiwa ZIP z XML-em w środku — rozpakowuje je
// fflate (czysty JS, działa w workerze Cloudflare). Zamiast pełnego
// parsera XML wystarczą znaczniki akapitów, komórek i wierszy: tekst ma
// trafić do wyszukiwania, a nie odtworzyć układ strony.
//
// Arkusze dają dwie rzeczy: tabele (pełne dane — do liczenia przez
// M.E.T.R.I.C.) i tekst do bazy wiedzy (nagłówek + pierwsze wiersze), żeby
// duży arkusz nie przekroczył limitu fragmentów.

import { strFromU8, unzipSync } from "fflate";

export type SheetTable = {
  /** Nazwa arkusza (dla CSV: nazwa pliku). */
  name: string;
  /** Wiersze komórek jako tekst; pierwszy wiersz to zwykle nagłówek. */
  rows: string[][];
};

/** Ile wierszy arkusza trafia do tekstu bazy wiedzy (reszta tylko do liczenia). */
export const SHEET_TEXT_ROWS = 60;
/** Twardy limit zapisanych wierszy na arkusz (pamięć i rozmiar JSON). */
export const SHEET_MAX_ROWS = 5000;
export const SHEET_MAX_COLS = 60;

// ---------- XML ----------

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");

/** Puste linie zwinięte do jednej, spacje na końcach wierszy obcięte. */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error("plik jest uszkodzony albo to nie jest dokument Office (ZIP)");
  }
}

const read = (files: Record<string, Uint8Array>, path: string): string | null =>
  files[path] ? strFromU8(files[path]) : null;

// ---------- Word (.docx) ----------

/**
 * Tekst z word/document.xml: akapity w liniach, komórki tabel rozdzielone
 * „ | ”, wiersze tabel w liniach. Tekst brany wyłącznie z <w:t> — wcięcia
 * XML i pola (instrText) nie przeciekają.
 */
export function docxXmlToText(xml: string): string {
  let out = "";
  let cellDepth = 0;
  const TOKEN =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>|<w:tc\b[^>]*>|<\/w:tc>|<\/w:tr>|<\/w:p>/g;
  for (const m of xml.matchAll(TOKEN)) {
    const tag = m[0];
    if (m[1] !== undefined) out += decodeXmlEntities(m[1]);
    else if (tag === "<w:tab/>") out += "\t";
    else if (tag.startsWith("<w:br") || tag.startsWith("<w:cr")) out += cellDepth ? " " : "\n";
    else if (tag.startsWith("<w:tc")) cellDepth++;
    else if (tag === "</w:tc>") {
      cellDepth = Math.max(0, cellDepth - 1);
      out = out.replace(/ +$/, "") + " | ";
    } else if (tag === "</w:tr>") out = out.replace(/ \| $/, "") + "\n";
    else if (tag === "</w:p>") out += cellDepth ? " " : "\n";
  }
  return tidy(out);
}

export function extractDocx(bytes: Uint8Array): string {
  const files = unzip(bytes);
  const main = read(files, "word/document.xml");
  if (main === null) throw new Error("brak word/document.xml — to nie jest plik .docx");
  // przypisy i komentarze dopisane na końcu, jeśli są
  const extra = ["word/footnotes.xml", "word/endnotes.xml"]
    .map((p) => read(files, p))
    .filter((x): x is string => x !== null)
    .map(docxXmlToText)
    .filter(Boolean);
  return tidy([docxXmlToText(main), ...extra].join("\n\n"));
}

// ---------- OpenDocument tekst (.odt) ----------

export function odtXmlToText(xml: string): string {
  // wcięcia między znacznikami to nie tekst (spacje w ODT niesie <text:s/>)
  const body = xml
    .replace(/>\s+</g, "><")
    .replace(/<text:tab\s*\/>/g, "\t")
    .replace(/<text:line-break\s*\/>/g, "\n")
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_m, n?: string) => " ".repeat(Number(n ?? 1)))
    .replace(/<\/table:table-cell>/g, " | ")
    .replace(/<\/table:table-row>/g, "\n")
    .replace(/<\/text:(p|h)>/g, "\n");
  return tidy(decodeXmlEntities(stripTags(body)).replace(/ \| \n/g, "\n"));
}

export function extractOdt(bytes: Uint8Array): string {
  const content = read(unzip(bytes), "content.xml");
  if (content === null) throw new Error("brak content.xml — to nie jest plik .odt");
  return odtXmlToText(content);
}

// ---------- Excel (.xlsx) ----------

/** „B12” → indeks kolumny 1 (A = 0). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]);
    out.push(decodeXmlEntities(parts.join("")));
  }
  return out;
}

/** Komórki jednego arkusza → wiersze tekstu (puste końcówki obcięte). */
export function sheetXmlToRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNo = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1);
    if (rowNo > SHEET_MAX_ROWS) break;
    const row: string[] = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : row.length;
      if (col >= SHEET_MAX_COLS) continue;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr")
        value = decodeXmlEntities(
          [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""),
        );
      else if (type === "b" && v !== undefined) value = v === "1" ? "PRAWDA" : "FAŁSZ";
      else if (v !== undefined) value = decodeXmlEntities(v);
      while (row.length < col) row.push("");
      row[col] = value.trim();
    }
    // wiersze z luką w numeracji (puste w Excelu) — wstawione jako puste
    while (rows.length < rowNo - 1) rows.push([]);
    rows.push(row);
  }
  return trimRows(rows);
}

function trimRows(rows: string[][]): string[][] {
  const trimmed = rows.map((r) => {
    let end = r.length;
    while (end > 0 && !r[end - 1]) end--;
    return r.slice(0, end);
  });
  let last = trimmed.length;
  while (last > 0 && trimmed[last - 1].length === 0) last--;
  let first = 0;
  while (first < last && trimmed[first].length === 0) first++;
  return trimmed.slice(first, last);
}

export function extractXlsx(bytes: Uint8Array): SheetTable[] {
  const files = unzip(bytes);
  const workbook = read(files, "xl/workbook.xml");
  if (workbook === null) throw new Error("brak xl/workbook.xml — to nie jest plik .xlsx");
  const rels = read(files, "xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const t = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && t) target.set(id, t.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const shared = sharedStrings(read(files, "xl/sharedStrings.xml"));
  const tables: SheetTable[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeXmlEntities(
      /\bname="([^"]*)"/.exec(m[1])?.[1] ?? `Arkusz${tables.length + 1}`,
    );
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1];
    const path =
      rid && target.get(rid)
        ? `xl/${target.get(rid)}`
        : `xl/worksheets/sheet${tables.length + 1}.xml`;
    const xml = read(files, path);
    if (xml === null) continue;
    const rows = sheetXmlToRows(xml, shared);
    if (rows.length > 0) tables.push({ name, rows });
  }
  return tables;
}

// ---------- CSV ----------

/** Separator z pierwszej linii: polski Excel zapisuje „;”, reszta świata „,”. */
export function detectDelimiter(firstLine: string): string {
  const counts = [";", ",", "\t"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

/** CSV z cudzysłowami („a;b” w polu, podwójny cudzysłów jako znak). */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const d = delimiter ?? detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === d) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= SHEET_MAX_ROWS) break;
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return trimRows(rows.map((r) => r.slice(0, SHEET_MAX_COLS)));
}

// ---------- tabele → tekst do bazy wiedzy ----------

/**
 * Tabele jako tekst do wyszukiwania: nazwa arkusza, rozmiar, nagłówek i
 * pierwsze SHEET_TEXT_ROWS wierszy. Przy większym arkuszu dopisek, że
 * pełne dane są do liczenia (narzędzie analyze_table).
 */
export function tablesToText(tables: readonly SheetTable[]): string {
  return tables
    .map((t) => {
      const cols = Math.max(0, ...t.rows.map((r) => r.length));
      const shown = t.rows.slice(0, SHEET_TEXT_ROWS).map((r) => r.join(" | "));
      const more =
        t.rows.length > SHEET_TEXT_ROWS
          ? `\n… i jeszcze ${t.rows.length - SHEET_TEXT_ROWS} wierszy — pełne dane dostępne do liczenia (analyze_table).`
          : "";
      return `Arkusz: ${t.name} (${t.rows.length} wierszy × ${cols} kolumn)\n${shown.join("\n")}${more}`;
    })
    .join("\n\n");
}
