// Mózg 3D — tryb STRUKTURA: mapa tabel i podgląd danych.
//
// getSchemaMap: struktura z RPC brain_schema_map (bez danych).
// previewTable: kilka ostatnich wierszy jednej tabeli ZWYKŁYM zapytaniem
// użytkownika — obowiązuje RLS, więc widać wyłącznie własne wiersze.
// Ponadto: tabela musi istnieć w mapie (nie da się podać dowolnej nazwy),
// tabele z sekretami nie oddają nic, kolumny-sekrety są zakryte, a wektory
// i binaria pominięte.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logServerError } from "@/lib/system/logServerError";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  formatCell,
  isPreviewableType,
  isSecretColumn,
  SENSITIVE_TABLES,
  type SchemaMap,
} from "./structure";

export const getSchemaMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SchemaMap> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("brain_schema_map");
    if (error) {
      await logServerError(supabase, userId, "brain.schema", error);
      throw new Error(error.message);
    }
    const map = (data ?? {}) as Partial<SchemaMap>;
    return {
      tables: map.tables ?? [],
      foreign_keys: map.foreign_keys ?? [],
      generated_at: map.generated_at ?? new Date().toISOString(),
    };
  });

export type TablePreview = {
  table: string;
  /** Tabela z sekretami — tylko struktura, żadnych wierszy. */
  sensitive: boolean;
  /** Ile wierszy tej tabeli widzi użytkownik (przez RLS); null = nie udało się policzyć. */
  ownCount: number | null;
  columns: string[];
  hiddenColumns: string[];
  rows: Record<string, string>[];
  error: string | null;
};

const PreviewInput = z.object({
  table: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .max(63),
});
const PREVIEW_ROWS = 15;
const SECRET_MASK = "••••••";

export const previewTable = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PreviewInput.parse(input))
  .handler(async ({ data, context }): Promise<TablePreview> => {
    const { supabase, userId } = context;
    const empty: TablePreview = {
      table: data.table,
      sensitive: SENSITIVE_TABLES.has(data.table),
      ownCount: null,
      columns: [],
      hiddenColumns: [],
      rows: [],
      error: null,
    };
    if (empty.sensitive) return empty;

    // Tylko tabele, które naprawdę są w schemacie public.
    const { data: mapRaw, error: mapError } = await supabase.rpc("brain_schema_map");
    if (mapError) return { ...empty, error: mapError.message };
    const table = ((mapRaw ?? {}) as Partial<SchemaMap>).tables?.find((t) => t.name === data.table);
    if (!table) return { ...empty, error: "Nie ma takiej tabeli." };

    const shown = table.columns.filter((c) => isPreviewableType(c.type)).map((c) => c.name);
    const hidden = table.columns.filter((c) => !isPreviewableType(c.type)).map((c) => c.name);
    const orderBy = ["created_at", "updated_at", "computed_at"].find((c) => shown.includes(c));

    // Nazwa tabeli jest zweryfikowana z mapą powyżej. Rzutowanie, bo typy
    // klienta znają tylko tabele z types.ts, a mapa bywa nowsza.
    const name = data.table as keyof Database["public"]["Tables"];
    const { count } = await supabase.from(name).select("*", { count: "exact", head: true });
    let query = supabase.from(name).select(shown.join(",")).limit(PREVIEW_ROWS);
    if (orderBy) query = query.order(orderBy, { ascending: false });
    const { data: rows, error } = await query;
    if (error) {
      await logServerError(supabase, userId, "brain.preview", error, { table: data.table } as Json);
      return {
        ...empty,
        columns: shown,
        hiddenColumns: hidden,
        ownCount: count ?? null,
        error: error.message,
      };
    }

    return {
      ...empty,
      ownCount: count ?? null,
      columns: shown,
      hiddenColumns: hidden,
      rows: ((rows ?? []) as unknown as Record<string, unknown>[]).map((r) =>
        Object.fromEntries(
          shown.map((c) => [c, isSecretColumn(c) ? SECRET_MASK : formatCell(r[c])]),
        ),
      ),
    };
  });
