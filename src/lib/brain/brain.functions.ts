// Mózg 3D — odczyt dla strony /mozg.
//
// getBrain: najpierw brain_sync() (dokłada gwiazdy dodane od ostatniego
// przebiegu pg_cron, więc świeża notatka jest widoczna od razu), potem
// cały układ w zwięzłej postaci. Embeddingi NIE jadą do przeglądarki —
// scena potrzebuje tylko współrzędnych, a 768 liczb na gwiazdę to
// megabajty na telefonie.
//
// getBrainItem: szczegóły jednej gwiazdy dla karty (treść notatki,
// wartość wspomnienia, status dokumentu) — pobierane dopiero po tapnięciu.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logServerError } from "@/lib/system/logServerError";
import type { Json } from "@/integrations/supabase/types";
import type { BrainSourceType } from "./layout";
import { parseInsights, type BrainInsights } from "./insights";
import { parseTraceItems, type TraceItem } from "./trace";

export type BrainStar = {
  type: BrainSourceType;
  id: string;
  x: number;
  y: number;
  z: number;
  cluster: number | null;
  label: string;
  weight: number;
  createdAt: string;
  /** Dołożona między nocnymi przebiegami (pozycja z sąsiadów, nie z UMAP). */
  provisional: boolean;
};

export type BrainCluster = { id: number; name: string; x: number; y: number; z: number };

export type BrainSnapshot = {
  stars: BrainStar[];
  clusters: BrainCluster[];
  /** Ostatni pełny układ — null, gdy nocny job jeszcze nie przebiegł. */
  layout: { computedAt: string; method: string } | null;
  /** Wnioski z ostatniego nocnego przeliczenia (puste przed pierwszym z S1.3). */
  insights: BrainInsights;
};

const PAGE = 1000;
const MAX_STARS = 20_000;

export const getBrain = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrainSnapshot> => {
    const { supabase, userId } = context;

    // Best-effort: bez tego strona i tak pokaże układ, tylko bez gwiazd
    // dodanych w ostatnich minutach (dołoży je pg_cron).
    const { error: syncError } = await supabase.rpc("brain_sync");
    if (syncError) await logServerError(supabase, userId, "brain.sync", syncError);

    const stars: BrainStar[] = [];
    for (let from = 0; from < MAX_STARS; from += PAGE) {
      const { data, error } = await supabase
        .from("brain_points")
        .select(
          "source_type, source_id, x, y, z, cluster_id, label, weight, source_created_at, placed_by",
        )
        .eq("owner_id", userId)
        .order("source_id")
        .range(from, from + PAGE - 1);
      if (error) {
        await logServerError(supabase, userId, "brain.points", error);
        throw new Error(error.message);
      }
      for (const p of data ?? []) {
        stars.push({
          type: p.source_type as BrainSourceType,
          id: p.source_id,
          x: p.x,
          y: p.y,
          z: p.z,
          cluster: p.cluster_id,
          label: p.label,
          weight: p.weight,
          createdAt: p.source_created_at,
          provisional: p.placed_by === "neighbors",
        });
      }
      if (!data || data.length < PAGE) break;
    }

    const [{ data: clusters, error: clustersError }, { data: run }] = await Promise.all([
      supabase
        .from("brain_clusters")
        .select("cluster_id, name, x, y, z")
        .eq("owner_id", userId)
        .order("cluster_id"),
      supabase
        .from("brain_layout_runs")
        .select("computed_at, method, meta")
        .eq("owner_id", userId)
        .maybeSingle(),
    ]);
    if (clustersError) {
      await logServerError(supabase, userId, "brain.clusters", clustersError);
      throw new Error(clustersError.message);
    }

    return {
      stars,
      clusters: (clusters ?? []).map((c) => ({
        id: c.cluster_id,
        name: c.name,
        x: c.x,
        y: c.y,
        z: c.z,
      })),
      layout: run ? { computedAt: run.computed_at, method: run.method } : null,
      insights: parseInsights((run?.meta as { insights?: unknown } | null)?.insights),
    };
  });

export type BrainItemDetail = {
  type: BrainSourceType;
  id: string;
  title: string;
  /** Treść do karty (przycięta); null, gdy źródło zniknęło. */
  body: string | null;
  tags: string[];
  meta: string | null;
};

const ItemInput = z.object({
  type: z.enum(["memory", "note", "document"]),
  id: z.string().uuid(),
});

/** Ile znaków treści jedzie do karty — reszta jest na stronie źródła. */
const BODY_LIMIT = 1_200;
const clip = (s: string) => (s.length > BODY_LIMIT ? `${s.slice(0, BODY_LIMIT).trimEnd()}…` : s);

export const getBrainItem = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ItemInput.parse(input))
  .handler(async ({ data, context }): Promise<BrainItemDetail> => {
    const { supabase, userId } = context;
    const missing: BrainItemDetail = {
      type: data.type,
      id: data.id,
      title: "",
      body: null,
      tags: [],
      meta: null,
    };

    if (data.type === "note") {
      const { data: n, error } = await supabase
        .from("notes")
        .select("title, body, tags, source")
        .eq("owner_id", userId)
        .eq("id", data.id)
        .maybeSingle();
      if (error) await logServerError(supabase, userId, "brain.item", error, data as Json);
      if (!n) return missing;
      return { ...missing, title: n.title, body: clip(n.body), tags: n.tags ?? [], meta: n.source };
    }

    if (data.type === "memory") {
      const { data: m, error } = await supabase
        .from("memories")
        .select("key, value, tags, importance, source")
        .eq("user_id", userId)
        .eq("id", data.id)
        .maybeSingle();
      if (error) await logServerError(supabase, userId, "brain.item", error, data as Json);
      if (!m) return missing;
      return {
        ...missing,
        title: m.key?.trim() || "Wspomnienie",
        body: clip(m.value),
        tags: m.tags ?? [],
        meta: `ważność ${m.importance}/5${m.source ? ` · ${m.source}` : ""}`,
      };
    }

    const { data: d, error } = await supabase
      .from("documents")
      .select("filename, status, chunk_count, mime_type")
      .eq("user_id", userId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) await logServerError(supabase, userId, "brain.item", error, data as Json);
    if (!d) return missing;
    return {
      ...missing,
      title: d.filename,
      body: null,
      tags: [],
      meta: `${d.mime_type} · ${d.chunk_count ?? 0} fragmentów · ${d.status}`,
    };
  });

export type BrainTrace = {
  id: string;
  tool: string;
  query: string;
  items: TraceItem[];
  createdAt: string;
};

export function toBrainTrace(row: {
  id: string;
  tool: string;
  query: string;
  items: unknown;
  created_at: string;
}): BrainTrace {
  return {
    id: row.id,
    tool: row.tool,
    query: row.query,
    items: parseTraceItems(row.items),
    createdAt: row.created_at,
  };
}

/** Ostatnie ślady RAG — „skąd J.A.R.V.I.S. to wiedział”. */
export const getBrainTraces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrainTrace[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("brain_traces")
      .select("id, tool, query, items, created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) {
      await logServerError(supabase, userId, "brain.traces", error);
      throw new Error(error.message);
    }
    return (data ?? []).map(toBrainTrace);
  });
