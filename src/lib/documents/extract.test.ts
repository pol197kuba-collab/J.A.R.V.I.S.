import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  columnIndex,
  decodeXmlEntities,
  detectDelimiter,
  extractDocx,
  extractOdt,
  extractXlsx,
  parseCsv,
  SHEET_TEXT_ROWS,
  tablesToText,
} from "./extract";

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe("decodeXmlEntities", () => {
  it("dekoduje nazwane i liczbowe encje", () => {
    expect(decodeXmlEntities("a &amp; b &lt;c&gt; &#261;&#x17C;")).toBe("a & b <c> ąż");
  });
});

describe("extractDocx", () => {
  it("akapity w liniach, tabele z komórkami „ | ”, encje i tabulatory", () => {
    const doc = `<w:document><w:body>
      <w:p><w:r><w:t>Jakub &amp; Marvel</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Kwota:</w:t><w:tab/><w:t>120 zł</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Rok</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Wynik</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>2026</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>12%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
    const text = extractDocx(zip({ "word/document.xml": doc }));
    expect(text).toContain("Jakub & Marvel");
    expect(text).toContain("Kwota:\t120 zł");
    expect(text).toBe("Jakub & Marvel\nKwota:\t120 zł\nRok | Wynik\n2026 | 12%");
  });

  it("nie-ZIP albo ZIP bez document.xml → czytelny błąd", () => {
    expect(() => extractDocx(strToU8("to nie zip"))).toThrow(/ZIP/);
    expect(() => extractDocx(zip({ "a.txt": "x" }))).toThrow(/docx/);
  });
});

describe("extractOdt", () => {
  it("akapity, nagłówki, wielokrotne spacje", () => {
    const xml = `<office:document-content><office:body><office:text>
      <text:h>Tytuł</text:h><text:p>Ala<text:s text:c="2"/>ma kota</text:p>
    </office:text></office:body></office:document-content>`;
    expect(extractOdt(zip({ "content.xml": xml }))).toBe("Tytuł\nAla  ma kota");
  });
});

describe("extractXlsx", () => {
  it("arkusze po nazwach, wspólne napisy, liczby, puste komórki", () => {
    const files = {
      "xl/workbook.xml": `<workbook><sheets><sheet name="Wydatki" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>Kategoria</t></si><si><t>Kwota</t></si><si><r><t>Pa</t></r><r><t>liwo</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>250.5</v></c></row>
        <row r="4"><c r="A4" t="inlineStr"><is><t>Jedzenie</t></is></c><c r="B4"><v>99</v></c></row>
      </sheetData></worksheet>`,
    };
    const t = extractXlsx(zip(files));
    expect(t).toEqual([
      {
        name: "Wydatki",
        rows: [["Kategoria", "Kwota"], ["Paliwo", "", "250.5"], [], ["Jedzenie", "99"]],
      },
    ]);
  });

  it("columnIndex", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA10")).toBe(26);
  });
});

describe("CSV", () => {
  it("wykrywa średnik (polski Excel) i obsługuje cudzysłowy", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a,b")).toBe(",");
    expect(parseCsv('\uFEFFnazwa;opis\r\nMarvel;"pies; spaniel ""Marvel"""\r\n')).toEqual([
      ["nazwa", "opis"],
      ["Marvel", 'pies; spaniel "Marvel"'],
    ]);
  });
});

describe("tablesToText", () => {
  it("nagłówek + pierwsze wiersze, dopisek przy dużym arkuszu", () => {
    const rows = [
      ["a", "b"],
      ...Array.from({ length: SHEET_TEXT_ROWS + 5 }, (_, i) => [`${i}`, "x"]),
    ];
    const text = tablesToText([{ name: "S", rows }]);
    expect(text.startsWith(`Arkusz: S (${rows.length} wierszy × 2 kolumn)\na | b`)).toBe(true);
    expect(text).toContain("i jeszcze 6 wierszy");
  });
});
