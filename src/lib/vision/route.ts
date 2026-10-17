// Vision AR (S4.2) — what a confirmed scan becomes outside vision_scans.
// Pure text shaping; saveScan (scan.functions.ts) does the writes.

import type { DocumentScan, Fridge } from "./modes";

/** The scanned document as Markdown for the RAG pipeline. */
export function documentMarkdown(d: DocumentScan, day: string): string {
  return [
    `# ${d.title}`,
    `_${d.docType} · zeskanowano ${day} (Vision)_`,
    d.summary ? `## Streszczenie\n\n${d.summary}` : "",
    d.text ? `## Tekst\n\n${d.text}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The fridge as a note: what's inside and what to cook from it. */
export function fridgeNote(f: Fridge, day: string): { title: string; body: string } {
  const title = f.recipe ? `Przepis: ${f.recipe.title}` : `Lodówka ${day}`;
  const body = [
    f.products.length ? `W lodówce (${day}):\n${f.products.map((p) => `- ${p}`).join("\n")}` : "",
    f.recipe
      ? `${f.recipe.title}:\n${f.recipe.steps.map((st, i) => `${i + 1}. ${st}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { title, body };
}
