// Narzędzia agentów — forge. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Json } from "@/integrations/supabase/types";
import { type Tool, sanitizeForOrFilter } from "./shared.server";

// ---------------------------------------------------------------------------
// F.O.R.G.E. tool — generate a downloadable document (pptx/docx)
// ---------------------------------------------------------------------------

// First tool in this app that produces a FILE instead of returning
// text/data through the JSON tool-call channel: bytes go to the private
// 'generated' Storage bucket (owner-scoped paths, same idiom as
// 'documents') and the model gets back a signed download URL to hand to
// the user in chat. The heavy build libraries (pptxgenjs/docx) are
// dynamically imported so they only load when a document is actually being
// generated, not on every runtime start.

// A21: link w czacie / powiadomieniu żyje dobę. Starszy plik otwiera się
// z /documents, który przy każdym otwarciu podpisuje świeży link
// (getGeneratedFileUrlFn), więc dłuższa ważność tylko wydłużała okno, w
// którym przeklejony link daje dostęp do pliku bez logowania.
export const SIGNED_URL_TTL_SECONDS = 24 * 3600;

// ---------------------------------------------------------------------------
// queue_document_job — background Insight → Forge pipeline
// ---------------------------------------------------------------------------

// Replaces running Insight then Forge SYNCHRONOUSLY inside this same chat
// turn (the old "PIPELINE DWUETAPOWY" instruction below) for anything that
// needs real research: that made every "zrób mi prezentację o X" request
// block on both agents finishing inside one HTTP request's time budget,
// which is exactly why decks came back thin — research got cut short to fit.
// This tool only enqueues a row; the actual work runs in its own execution
// (runDocumentJobFn, src/lib/agents/documentJobs.functions.ts), fire-and-
// forgotten by the client right after this turn returns — same idiom the
// image-enrichment pass already uses. Completion (success OR failure) lands
// as a row in public.notifications, which the HUD shows via Realtime.
export const queueDocumentJob: Tool = {
  risk: "write",
  declaration: {
    name: "queue_document_job",
    description:
      "Zleć w TLE pełne przygotowanie dokumentu/prezentacji, które wymaga researchu (Insight zbierze treść, potem Forge zbuduje plik ze zdjęciami). Zwraca natychmiast — NIE czekaj na wynik w tej turze. Użyj zamiast delegate_to_agent(insight) + delegate_to_agent(forge), gdy temat wymaga zebrania faktów z internetu. Dla prostej, już znanej treści nadal deleguj bezpośrednio do forge.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Krótki tytuł dokumentu/prezentacji." },
        brief: {
          type: "string",
          description:
            "Pełne zadanie badawcze dla Insight — temat, kątem czego ma szukać, jaki format finalnie (prezentacja/dokument/PDF) i jak szczegółowy ma być wynik. WAŻNE: ten tekst dociera również do Forge (który buduje sam plik) jako jedyny opis wymagań — przepisz do niego DOSŁOWNIE każdy konkretny wymóg użytkownika (dokładna liczba slajdów/stron, styl/ton np. 'profesjonalnie, jak dla zarządu', preferowana kolorystyka lub motyw, poziom szczegółowości) zamiast streszczać je ogólnikowo. Pominięty tu wymóg nigdy nie dotrze do Forge.",
        },
      },
      required: ["title", "brief"],
    },
  },
  async execute(args, ctx) {
    const title = String(args.title ?? "")
      .trim()
      .slice(0, 200);
    const brief = String(args.brief ?? "")
      .trim()
      .slice(0, 4000);
    if (!title) return { error: "missing_title" };
    if (!brief) return { error: "missing_brief" };

    const { data, error } = await ctx.supabase
      .from("document_jobs")
      .insert({ owner_id: ctx.userId, run_id: ctx.runId, title, brief })
      .select("id")
      .single();
    if (error) {
      await ctx.logEvent("error", "tool.queue_document_job", error.message, { title } as Json);
      return { error: error.message };
    }
    await ctx.logEvent("info", "tool.queue_document_job", `queued: ${title}`, {
      job_id: data.id,
      run_id: ctx.runId,
    } as Json);
    return {
      ok: true,
      job_id: data.id,
      instruction:
        "Zadanie zostało zlecone w tle. Odpowiedz KRÓTKO, że zaczynasz nad tym pracować i dasz znać (powiadomieniem), gdy będzie gotowe — NIE opisuj treści, której jeszcze nie ma.",
    };
  },
};

export const generateDocumentTool: Tool = {
  risk: "write",
  declaration: {
    name: "generate_document",
    description:
      "Generate a downloadable file — a presentation (pptx) or a Word document (docx) — from structured content, and return a download link. Call it ONCE with the complete, final content: a title and a list of sections, each with a heading plus paragraph text and/or bullet points. Write real content in the user's language, never placeholders. For visuals, set image_query (and hero_image_query): the subject's EXACT English name, as an encyclopedia article would title it — 'Grand Theft Auto VI', 'Warsaw Old Town' — not a description of a photo. Whenever you know the subject's official page (publisher, manufacturer, studio, store), also set image_page_url (and hero_image_page_url): that page's own preview image is the best source there is. The system verifies every candidate is actually about the subject and DROPS it otherwise, so a vague or descriptive phrase usually ends with no image at all. Skip image_query entirely for a slide where no real photo would add anything — a slide with no image reads better than one with an unrelated picture. Photos are added in the background after the file is delivered. FOR PRESENTATIONS: give every slide a `layout` chosen to fit its content — a deck where every slide is the same bullet list reads as filler. Vary them.",
    parameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["pptx", "docx"],
          description: "Output file format.",
        },
        title: { type: "string", description: "Document/presentation title." },
        subtitle: { type: "string", description: "Optional subtitle shown under the title." },
        filename: {
          type: "string",
          description: "Optional filename (without extension). Defaults to the title.",
        },
        hero_image_query: {
          type: "string",
          description:
            "NAME the title-slide subject exactly as an encyclopedia article would title it, in English: 'Grand Theft Auto VI', 'Samsung Galaxy S26 Ultra', 'Dodge Charger (LD)'. An exact name lands on the real article and its official artwork; a descriptive phrase ('Rockstar Games logo office') lands on whatever ranks nearest and gives an unrelated picture.",
        },
        hero_image_page_url: {
          type: "string",
          description:
            "BEST SOURCE OF ALL, use it whenever you know one: the URL of the subject's official page — publisher, manufacturer, store or studio (e.g. 'https://www.rockstargames.com/VI'). Its preview image is the publisher's own artwork, which no free-licence archive can provide. Give the page for THIS subject, not a homepage.",
        },
        sections: {
          type: "array",
          description:
            "Ordered sections (slides for pptx, headed sections for docx). Each needs a heading and real content: paragraph text, bullet points, or both.",
          items: {
            type: "object",
            properties: {
              heading: { type: "string", description: "Section/slide heading." },
              layout: {
                type: "string",
                enum: ["bullets", "section", "statement", "metrics", "compare", "photo"],
                description:
                  "PRESENTATIONS ONLY (ignored for docx). Pick the layout that fits THIS slide's content: 'bullets' = heading + paragraph and/or bullet points, optionally a side photo — the workhorse; 'section' = a divider opening a new part of the deck (heading + one line of context, no bullets); 'statement' = one single claim or conclusion set large, put it in `content`, no bullets; 'metrics' = 1-4 numbers with captions, fill `metrics` — use it whenever the slide is really about figures; 'compare' = two side-by-side columns, fill `columns` with exactly two — for before/after, us/them, pros/cons; 'photo' = a full-bleed photo with the heading over it, requires image_query — good for opening a part. Defaults to 'bullets'. If the data a layout needs is missing, the slide silently falls back to 'bullets', so fill the matching field.",
              },
              metrics: {
                type: "array",
                description:
                  "For layout 'metrics': 1-4 figures. Keep `value` SHORT — '42%', '3.2 mln', '17x' — it is set very large. `label` says what the number is.",
                items: {
                  type: "object",
                  properties: {
                    value: { type: "string", description: "The figure itself, max ~12 chars." },
                    label: { type: "string", description: "What this number means." },
                  },
                  required: ["value"],
                },
              },
              columns: {
                type: "array",
                description:
                  "For layout 'compare': EXACTLY two columns. Fewer than two makes the slide fall back to 'bullets'.",
                items: {
                  type: "object",
                  properties: {
                    heading: { type: "string", description: "Column heading." },
                    bullets: {
                      type: "array",
                      items: { type: "string" },
                      description: "Points in this column.",
                    },
                  },
                  required: ["heading"],
                },
              },
              content: { type: "string", description: "Paragraph text for this section." },
              bullets: {
                type: "array",
                items: { type: "string" },
                description: "Bullet points for this section.",
              },
              image_query: {
                type: "string",
                description:
                  "NAME the subject of this slide's photo exactly, in English, as an encyclopedia article would title it — not a description. 'Vice City' beats 'Vice City neon skyline at night'; a descriptive phrase lands on whatever ranks nearest and gives an unrelated picture. Max 4 sections get an image, so pick the most important. Omit it when no real photo would add anything — a slide with no image reads better than one with the wrong picture, and the system WILL drop an image it cannot confirm is on topic.",
              },
              image_page_url: {
                type: "string",
                description:
                  "The official page for THIS slide's subject, when you know it (publisher, manufacturer, store, studio). Its preview image is the publisher's own artwork and beats every other source — use it whenever you can.",
              },
            },
            required: ["heading"],
          },
        },
      },
      required: ["format", "title", "sections"],
    },
  },
  async execute(args, ctx) {
    const { normalizeDocSpec, buildDocument, CONTENT_TYPES, specHasImagePrompts, blocksOf } =
      await import("../forgeDocument.server");
    const normalized = normalizeDocSpec(args);
    if (!normalized.ok) {
      await ctx.logEvent("warn", "tool.generate_document", `rejected: ${normalized.error}`, {
        run_id: ctx.runId,
      } as Json);
      return { error: normalized.error };
    }
    const spec = normalized.spec;

    // Build the file TEXT-ONLY and return it immediately. Image generation is
    // slow + 503-prone and used to blow the server-function budget inline;
    // it now runs as a separate enrichment pass (enrichDocumentImagesFn),
    // kicked by the client after this returns. NO_IMAGES = the default arg.
    let bytes: Uint8Array;
    try {
      bytes = await buildDocument(spec);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.logEvent(
        "error",
        "tool.generate_document",
        `build failed (${spec.format}): ${msg}`,
        {
          run_id: ctx.runId,
        } as Json,
      );
      // NIE PONAWIAĆ. Budowa pliku nie zależy od treści, którą przysłał
      // model — składanie bajtów albo działa, albo jest zepsute po stronie
      // systemu. Bez tego zdania model traktował błąd jak podpowiedź „popraw
      // i spróbuj jeszcze raz" i wywoływał narzędzie w kółko: pięć prób
      // budowy na jedno zlecenie, każda po pełnej turze modelu, wszystkie
      // skazane na ten sam wynik. Za każdą z nich płaci użytkownik.
      return {
        error: `build_failed: ${msg}`,
        retryable: false,
        instruction:
          "Awaria po stronie systemu, nie treści. NIE wywołuj tego narzędzia ponownie " +
          "i nie zmieniaj treści — to nic nie da. Zakończ i napisz krótko, że budowa " +
          "pliku nie powiodła się z przyczyn technicznych.",
      };
    }

    const path = `${ctx.userId}/${crypto.randomUUID()}/${spec.filename}`;
    const { error: uploadErr } = await ctx.supabase.storage
      .from("generated")
      .upload(path, bytes, { contentType: CONTENT_TYPES[spec.format] });
    if (uploadErr) {
      await ctx.logEvent("error", "tool.generate_document", `upload failed: ${uploadErr.message}`, {
        run_id: ctx.runId,
        path,
      } as Json);
      return { error: `storage_upload_failed: ${uploadErr.message}` };
    }

    const { data: signed, error: signErr } = await ctx.supabase.storage
      .from("generated")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: spec.filename });
    if (signErr || !signed?.signedUrl) {
      await ctx.logEvent(
        "error",
        "tool.generate_document",
        `signed url failed: ${signErr?.message ?? "no url"}`,
        { run_id: ctx.runId, path } as Json,
      );
      return { error: `signed_url_failed: ${signErr?.message ?? "unknown"}` };
    }

    // Podgląd prezentacji NIE jest już osobnym plikiem. Wcześniej renderowało
    // się ją do PDF-a i to jego pokazywał <iframe>, bo przeglądarka nie umie
    // .pptx. Kosztowało to drugi pełny render przy każdym pliku, trzymanie
    // dwóch obiektów w storage i utrzymywanie renderera PDF wyłącznie po to.
    // Teraz podgląd rysuje slajdy w Reakcie wprost z `spec` (zapisywanego
    // niżej i tak), tym samym motywem co plik — więc jest szybszy, zawsze
    // aktualny i pokazuje dokładnie to, co poszło do pliku.

    // Does the spec ask for any graphics? If so, mark it 'pending' so
    // enrichment can rebuild the exact same document with images. The spec
    // itself is stored either way — it's also M.E.T.R.I.C.'s only source of
    // text content for read_generated_file, independent of the image pass.
    const wantsImages = specHasImagePrompts(spec);
    const documentId = crypto.randomUUID();
    const { error: idxErr } = await ctx.supabase.from("generated_files").insert({
      id: documentId,
      user_id: ctx.userId,
      filename: spec.filename,
      format: spec.format,
      storage_path: path,
      size_bytes: bytes.byteLength,
      title: spec.title,
      section_count: blocksOf(spec).length,
      image_count: 0,
      image_status: wantsImages ? "pending" : "none",
      spec: spec as unknown as Json,
      run_id: ctx.runId,
    });
    if (idxErr) {
      await ctx.logEvent(
        "warn",
        "tool.generate_document",
        `archive index failed: ${idxErr.message}`,
        {
          run_id: ctx.runId,
        } as Json,
      );
    }

    await ctx.logEvent(
      "info",
      "tool.generate_document",
      `${spec.format} generated: ${spec.filename} (${bytes.byteLength} bytes, ${blocksOf(spec).length} sections, images ${wantsImages ? "pending" : "none"})`,
      { run_id: ctx.runId, path, size_bytes: bytes.byteLength } as Json,
    );
    return {
      ok: true,
      format: spec.format,
      filename: spec.filename,
      sections: blocksOf(spec).length,
      size_bytes: bytes.byteLength,
      download_url: signed.signedUrl,
      link_valid_days: 7,
      // Non-null document_id + images_pending tells the runtime to hand the
      // client an enrichment job (see runtime.server.ts / ChatPanel).
      document_id: documentId,
      images_pending: wantsImages && !idxErr,
      instruction: wantsImages
        ? "Do NOT copy download_url into your reply — the system appends it automatically. Summarize what was generated and mention the file is ready now, with graphics being added in the background."
        : "Do NOT copy download_url into your reply — the system appends it automatically. Just summarize what was generated.",
    };
  },
};

// ---------------------------------------------------------------------------
// open_document — find a previously generated file and open its in-app preview
// ---------------------------------------------------------------------------

// Companion to generate_document: lets the user say "otwórz prezentację o
// samsungu" and have JARVIS locate the matching file in the generated_files
// archive and open its preview, instead of only being able to CREATE files.
// Discriminated result:
//   - found 0  → nothing matched (model tells the user, offers to generate)
//   - found 1  → `open: {id, filename}` — runtime.server.ts lifts this into
//                AgentRunResult.openDocument and the client opens the preview
//   - found >1 → `candidates: [...]` — the model lists them and asks which;
//                the follow-up call passes `file_id` to disambiguate.
export const openDocumentTool: Tool = {
  risk: "read",
  declaration: {
    name: "open_document",
    description:
      "Find a document/presentation the user previously generated (in the F.O.R.G.E. archive) and open its preview in the app. Use when the user asks to OPEN / SHOW / display an existing file (e.g. 'otwórz prezentację o samsungu', 'pokaż mój raport'), NOT when they ask to create a new one. Pass `query` with the topic/title words. If a previous call returned multiple candidates, call again with `file_id` set to the chosen one.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Topic/title words to match against generated files (in the user's language).",
        },
        file_id: {
          type: "string",
          description:
            "Exact id of a file to open — use to pick one of the candidates a previous call returned.",
        },
      },
    },
  },
  async execute(args, ctx) {
    const fileId = String(args.file_id ?? "").trim();
    const query = String(args.query ?? "").trim();

    // Direct pick by id (disambiguation follow-up).
    if (fileId) {
      const { data, error } = await ctx.supabase
        .from("generated_files")
        .select("id, filename, format, title")
        .eq("user_id", ctx.userId)
        .eq("id", fileId)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { found: 0, message: "Nie znaleziono pliku o tym identyfikatorze." };
      await ctx.logEvent("info", "tool.open_document", `open by id: ${data.filename}`, {
        run_id: ctx.runId,
      } as Json);
      return { found: 1, open: { id: data.id, filename: data.filename }, file: data };
    }

    if (!query) return { error: "empty_query" };

    // Per-WORD matching, not whole-phrase: an ILIKE on the full query
    // ("samsungu s26 ultra") never matches a title like "Samsung Galaxy S26
    // Ultra" — a word sits between the terms and Polish inflection differs
    // ("samsungu" vs "samsung"). Instead: split into tokens (>=3 chars), OR
    // an ILIKE per token, then rank rows in code by how many tokens they
    // actually contain so the best match wins and near-misses still surface.
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => sanitizeForOrFilter(t))
      .filter((t) => t.length >= 3)
      .slice(0, 8);

    let rows: Array<{
      id: string;
      filename: string;
      format: string;
      title: string | null;
      created_at: string;
    }> = [];
    if (tokens.length > 0) {
      const orExpr = tokens
        .flatMap((t) => [`filename.ilike.%${t}%`, `title.ilike.%${t}%`])
        .join(",");
      const { data, error } = await ctx.supabase
        .from("generated_files")
        .select("id, filename, format, title, created_at")
        .eq("user_id", ctx.userId)
        .or(orExpr)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return { error: error.message };
      // Rank by token-hit count (desc), then recency (query already sorted
      // desc, so a stable sort keeps newer first among ties).
      rows = (data ?? [])
        .map((r) => {
          const hay = `${r.title ?? ""} ${r.filename}`.toLowerCase();
          return { r, score: tokens.filter((t) => hay.includes(t)).length };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((x) => x.r);
    }

    if (rows.length === 0) {
      await ctx.logEvent("info", "tool.open_document", `no match: ${query}`, {
        run_id: ctx.runId,
      } as Json);
      return {
        found: 0,
        message: `Nie znalazłem żadnego wygenerowanego pliku pasującego do „${query}".`,
      };
    }
    if (rows.length === 1) {
      const f = rows[0];
      await ctx.logEvent("info", "tool.open_document", `open: ${f.filename}`, {
        run_id: ctx.runId,
      } as Json);
      return { found: 1, open: { id: f.id, filename: f.filename }, file: f };
    }

    await ctx.logEvent("info", "tool.open_document", `${rows.length} candidates: ${query}`, {
      run_id: ctx.runId,
    } as Json);
    return {
      found: rows.length,
      candidates: rows.map((f) => ({
        file_id: f.id,
        filename: f.filename,
        title: f.title,
        format: f.format,
        created_at: f.created_at,
      })),
      instruction:
        "Multiple files match. Ask the user which one (mention title/format/date), then call open_document again with the chosen file_id.",
    };
  },
};

// Full catalog of tool *implementations* known to this codebase. This array
// is the only place `execute` logic lives — it never shrinks based on DB
// state, so a disabled tool's code stays available (just unreachable via the
// declarations sent to the model). Slugs here MUST match `public.tools.slug`
// rows; keep the two in sync by hand (see supabase/migrations for the seed).
