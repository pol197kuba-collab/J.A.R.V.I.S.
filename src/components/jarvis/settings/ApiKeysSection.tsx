import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { audio } from "@/lib/audio/AudioEngine";
import {
  applyRecommendedAgentModels,
  deleteAnthropicKey,
  deleteGeminiKey,
  deleteGithubToken,
  deleteGoogleCseCredentials,
  deleteGroqKey,
  getAnthropicKeyStatus,
  getGeminiKeyStatus,
  getGithubTokenStatus,
  getGoogleCseStatus,
  getGroqKeyStatus,
  saveAnthropicKey,
  saveGeminiKey,
  saveGithubToken,
  saveGoogleCseCredentials,
  saveGroqKey,
} from "@/lib/agents/runtime.functions";
import { invalidateModelCatalog } from "@/lib/agents/models.functions";
import { MODEL_CATALOG_QUERY_KEY } from "@/lib/agents/useModelCatalog";
import { testProviderKeys, type KeyCheck } from "@/lib/system/keyCheck.functions";
import { providerInfo, type ProviderId } from "@/lib/system/providerKeys";

// Przeglądarkowa kopia klucza Gemini — czyta ją tylko czat w trybie
// „przeglądarka" (jarvisBrain.ts). Zapis klucza aktualizuje ją razem z
// serwerem, żeby oba tryby zawsze miały ten sam klucz.
const GEMINI_LS_KEY = "jarvis_gemini_api_key";
// Dawne kopie kluczy Groq/Anthropic w przeglądarce — nikt ich nie czytał,
// służyły tylko do wypełniania pola. Sprzątamy je przy wejściu.
const STALE_LS_KEYS = ["jarvis_groq_api_key", "jarvis_anthropic_api_key"];

type Stored = { state: "loading" | "linked" | "empty" | "error"; preview: string | null };

const CHECK_TONE: Record<KeyCheck["status"], string> = {
  ok: "var(--success)",
  broken: "var(--destructive)",
  unknown: "var(--warning)",
  missing: "var(--muted-foreground)",
};

const inputClass =
  "font-mono min-w-0 flex-1 border border-primary/60 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary";
const btnClass =
  "font-display shrink-0 border border-primary/60 px-3 py-2 text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20 disabled:opacity-40";

function ApiKeyCard({
  id,
  index,
  stored,
  check,
  fields,
  onSave,
  onDelete,
  children,
}: {
  id: ProviderId;
  index: number;
  stored: Stored;
  check: KeyCheck | undefined;
  fields: { name: string; placeholder: string; secret?: boolean; initial?: string }[];
  onSave: (values: Record<string, string>) => Promise<void>;
  onDelete: () => Promise<void>;
  children?: ReactNode;
}) {
  const info = providerInfo(id);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = fields.every((f) => values[f.name]?.trim());

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      audio.playClick();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zapisać.");
    } finally {
      setBusy(false);
    }
  };

  const storedLabel =
    stored.state === "linked"
      ? `● ZAPISANY ${stored.preview ?? ""}`
      : stored.state === "error"
        ? "✕ BRAK POŁĄCZENIA"
        : stored.state === "loading"
          ? "… SPRAWDZAM"
          : "○ BRAK";

  return (
    <HudPanel index={index} title={info.label.toUpperCase()} tone="quiet" className="p-5">
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="font-mono text-[10px] uppercase tracking-widest"
            style={{ color: info.required ? "var(--warning)" : "var(--muted-foreground)" }}
          >
            {info.required ? "WYMAGANY" : "OPCJONALNY"}
          </span>
          <span
            className="font-display text-[10px] uppercase tracking-widest"
            style={{
              color:
                stored.state === "linked"
                  ? "var(--success)"
                  : stored.state === "error"
                    ? "var(--destructive)"
                    : "var(--muted-foreground)",
            }}
          >
            {storedLabel}
          </span>
        </div>

        <dl className="grid gap-1 text-xs">
          <div className="grid gap-x-3 @min-[520px]:grid-cols-[7rem_1fr]">
            <dt className="text-muted-foreground">Do czego</dt>
            <dd className="min-w-0 break-words text-foreground">{info.modules}</dd>
          </div>
          <div className="grid gap-x-3 @min-[520px]:grid-cols-[7rem_1fr]">
            <dt className="text-muted-foreground">Gdy nie działa</dt>
            <dd className="min-w-0 break-words text-foreground">{info.ifBroken}</dd>
          </div>
          <div className="grid gap-x-3 @min-[520px]:grid-cols-[7rem_1fr]">
            <dt className="text-muted-foreground">Skąd</dt>
            <dd className="font-mono min-w-0 break-words text-[11px] text-muted-foreground">
              {info.source}
            </dd>
          </div>
        </dl>

        {check && (
          <p
            className="font-mono min-w-0 break-words border-l-2 pl-2 text-[11px]"
            style={{ color: CHECK_TONE[check.status], borderColor: CHECK_TONE[check.status] }}
          >
            TEST: {check.detail}
          </p>
        )}

        <div className="flex flex-col gap-2 @min-[520px]:flex-row">
          {fields.map((f) => (
            <input
              key={f.name}
              type={f.secret === false ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={values[f.name]}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              placeholder={
                f.secret !== false && stored.state === "linked"
                  ? `${f.placeholder} (zastąpi zapisany)`
                  : f.placeholder
              }
              className={inputClass}
            />
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !complete}
              onClick={() =>
                run(async () => {
                  await onSave(
                    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])),
                  );
                  setValues((v) =>
                    Object.fromEntries(
                      fields.map((f) => [f.name, f.secret === false ? v[f.name] : ""]),
                    ),
                  );
                })
              }
              className={`${btnClass} bg-primary/20`}
            >
              {busy ? "…" : "ZAPISZ"}
            </button>
            {stored.state === "linked" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Usunąć klucz ${info.label}?`)) void run(onDelete);
                }}
                className={btnClass}
                style={{ color: "var(--destructive)" }}
              >
                USUŃ
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
            ✕ {error}
          </p>
        )}
        {children}
      </div>
    </HudPanel>
  );
}

/** Ustawienia → Klucze API: zapis, test i opis każdego klucza dostawcy. */
export function ApiKeysSection({ onGeminiLinked }: { onGeminiLinked: (linked: boolean) => void }) {
  const qc = useQueryClient();
  const dropModelCatalogCache = useServerFn(invalidateModelCatalog);
  const runKeyTest = useServerFn(testProviderKeys);
  const applyRecommended = useServerFn(applyRecommendedAgentModels);

  const fns = {
    gemini: {
      status: useServerFn(getGeminiKeyStatus),
      save: useServerFn(saveGeminiKey),
      del: useServerFn(deleteGeminiKey),
    },
    anthropic: {
      status: useServerFn(getAnthropicKeyStatus),
      save: useServerFn(saveAnthropicKey),
      del: useServerFn(deleteAnthropicKey),
    },
    groq: {
      status: useServerFn(getGroqKeyStatus),
      save: useServerFn(saveGroqKey),
      del: useServerFn(deleteGroqKey),
    },
    github: {
      status: useServerFn(getGithubTokenStatus),
      save: useServerFn(saveGithubToken),
      del: useServerFn(deleteGithubToken),
    },
  };
  const cseStatus = useServerFn(getGoogleCseStatus);
  const cseSave = useServerFn(saveGoogleCseCredentials);
  const cseDel = useServerFn(deleteGoogleCseCredentials);

  const [stored, setStored] = useState<Record<ProviderId, Stored>>(() => {
    const loading: Stored = { state: "loading", preview: null };
    return {
      gemini: loading,
      anthropic: loading,
      groq: loading,
      google_cse: loading,
      github: loading,
    };
  });
  const [cseCx, setCseCx] = useState<string | null>(null);
  const [checks, setChecks] = useState<Partial<Record<ProviderId, KeyCheck>>>({});
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [tieringMsg, setTieringMsg] = useState<string | null>(null);

  const refresh = useCallback(
    async (id: ProviderId) => {
      try {
        const s =
          id === "google_cse"
            ? await cseStatus()
            : await fns[id as Exclude<ProviderId, "google_cse">].status();
        setStored((prev) => ({
          ...prev,
          [id]: { state: s.linked ? "linked" : "empty", preview: s.preview },
        }));
        if (id === "google_cse" && "cx" in s) setCseCx((s.cx as string | null) ?? null);
        if (id === "gemini") onGeminiLinked(s.linked);
      } catch (err) {
        console.warn(`[settings] ${id} status failed`, err);
        setStored((prev) => ({ ...prev, [id]: { state: "error", preview: null } }));
      }
    },
    // useServerFn zwraca stabilne referencje — fns odtwarzany co render nie
    // jest powodem do ponownego pobierania.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    try {
      STALE_LS_KEYS.forEach((k) => window.localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    (["gemini", "anthropic", "groq", "google_cse", "github"] as const).forEach(
      (id) => void refresh(id),
    );
  }, [refresh]);

  // Zmiana klucza zmienia to, co API dostawcy w ogóle wylistuje, więc cache
  // katalogu modeli (serwerowy i klienta) idzie razem z nią.
  const refreshModelCatalog = async () => {
    try {
      await dropModelCatalogCache();
      await qc.invalidateQueries({ queryKey: MODEL_CATALOG_QUERY_KEY });
    } catch (err) {
      console.warn("[settings] model catalog refresh failed", err);
    }
  };

  const afterChange = async (id: ProviderId) => {
    setChecks((prev) => ({ ...prev, [id]: undefined }));
    await refresh(id);
    if (id === "gemini" || id === "anthropic") await refreshModelCatalog();
  };

  const mirrorGemini = (key: string | null) => {
    try {
      if (key) window.localStorage.setItem(GEMINI_LS_KEY, key);
      else window.localStorage.removeItem(GEMINI_LS_KEY);
    } catch {
      /* ignore — czat w trybie serwera i tak bierze klucz z bazy */
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestError(null);
    try {
      const result = await runKeyTest();
      setChecks(Object.fromEntries(result.map((c) => [c.provider, c])));
      audio.playClick();
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Test się nie udał.");
    } finally {
      setTesting(false);
    }
  };

  const handleApplyRecommended = async () => {
    setTieringMsg(null);
    try {
      const result = await applyRecommended();
      setTieringMsg(
        result.changed === 0
          ? "Wszyscy agenci już mają rekomendowane modele."
          : `Zmieniono ${result.changed}: ${result.changes
              .map((c) => `${c.name} → ${c.to.replace("anthropic:", "")}`)
              .join(", ")}`,
      );
    } catch (err) {
      setTieringMsg(err instanceof Error ? err.message : "Nie udało się zastosować.");
    }
  };

  const checkList = Object.values(checks).filter((c): c is KeyCheck => !!c);
  const brokenCount = checkList.filter((c) => c.status === "broken").length;

  const simpleCard = (
    id: Exclude<ProviderId, "google_cse">,
    index: number,
    placeholder: string,
    children?: ReactNode,
  ) => (
    <ApiKeyCard
      id={id}
      index={index}
      stored={stored[id]}
      check={checks[id]}
      fields={[{ name: "key", placeholder }]}
      onSave={async ({ key }) => {
        await fns[id].save({ data: { key } });
        if (id === "gemini") mirrorGemini(key);
        await afterChange(id);
      }}
      onDelete={async () => {
        await fns[id].del();
        if (id === "gemini") mirrorGemini(null);
        await afterChange(id);
      }}
    >
      {children}
    </ApiKeyCard>
  );

  return (
    <div className="space-y-6">
      <HudPanel index={1} title="STAN KLUCZY" className="p-5">
        <div className="mt-3 flex flex-col gap-3 @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-foreground">
              {checkList.length === 0
                ? "Sprawdź, czy zapisane klucze naprawdę działają."
                : brokenCount === 0
                  ? "Wszystkie zapisane klucze działają."
                  : `Nie działa: ${brokenCount}. Szczegóły przy kluczach poniżej.`}
            </p>
            <p className="text-xs text-muted-foreground">
              Klucz, który padnie w trakcie pracy, zgłosi się sam na dzwonku (raz na dobę).
            </p>
          </div>
          <button
            type="button"
            disabled={testing}
            onClick={handleTest}
            className={`${btnClass} bg-primary/20`}
          >
            {testing ? "TESTUJĘ…" : "TESTUJ KLUCZE"}
          </button>
        </div>
        {testError && (
          <p className="font-mono mt-2 text-[10px]" style={{ color: "var(--destructive)" }}>
            ✕ {testError}
          </p>
        )}
        <p className="font-mono mt-3 min-w-0 break-words border-t border-primary/20 pt-3 text-[10px] text-muted-foreground/80">
          Zadania nocne w GitHub Actions (rynki, briefing, paliwa, Mózg) używają osobnych kluczy:
          sekretów ANTHROPIC_API_KEY i GEMINI_API_KEY w repo → Settings → Secrets → Actions. Zmiana
          tutaj ich nie zmienia.
        </p>
      </HudPanel>

      {/* Poza HudPanelem — kolumny liczone od szerokości <main> (DashboardShell). */}
      <div className="grid gap-6 @min-[1100px]:grid-cols-2">
        {simpleCard("gemini", 2, "Wklej klucz Gemini…")}
        {simpleCard(
          "anthropic",
          2,
          "Wklej klucz Anthropic…",
          <div className="flex flex-col gap-2 border-t border-primary/20 pt-3 @min-[520px]:flex-row @min-[520px]:items-center @min-[520px]:justify-between">
            <p className="min-w-0 text-xs text-muted-foreground">
              Rekomendowany podział: rozumujący agenci (J.A.R.V.I.S., Insight, Metric) → Opus,
              wykonawczy (Forge, Herald, Shield) → Sonnet.
            </p>
            <button
              type="button"
              disabled={stored.anthropic.state !== "linked"}
              onClick={handleApplyRecommended}
              className={btnClass}
            >
              ZASTOSUJ
            </button>
            {tieringMsg && (
              <p className="font-mono min-w-0 break-words text-[10px] text-primary/80">
                {tieringMsg}
              </p>
            )}
          </div>,
        )}
        {simpleCard("groq", 3, "Wklej klucz Groq…")}
        <ApiKeyCard
          id="google_cse"
          index={3}
          stored={stored.google_cse}
          check={checks.google_cse}
          // key wymusza nowe pola, gdy z serwera dojdzie zapisany cx.
          key={cseCx ?? "no-cx"}
          fields={[
            { name: "key", placeholder: "Wklej klucz Custom Search…" },
            {
              name: "cx",
              placeholder: "Search Engine ID (cx)",
              secret: false,
              initial: cseCx ?? "",
            },
          ]}
          onSave={async ({ key, cx }) => {
            await cseSave({ data: { key, cx } });
            await afterChange("google_cse");
          }}
          onDelete={async () => {
            await cseDel();
            await afterChange("google_cse");
          }}
        />
        {simpleCard("github", 4, "Wklej token GitHub (ghp_… lub github_pat_…)")}
      </div>
    </div>
  );
}
