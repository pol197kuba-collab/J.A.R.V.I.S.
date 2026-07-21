import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Beta namespace on supabase-js; keep a local typed shim for the three methods.
type OAuthAuthz = {
  client?: { name?: string; redirect_uris?: string[] } | null;
  redirect_url?: string;
  redirect_to?: string;
  scope?: string;
};
type OAuthApi = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: OAuthAuthz | null; error: Error | null }>;
  approveAuthorization: (id: string) => Promise<{ data: OAuthAuthz | null; error: Error | null }>;
  denyAuthorization: (id: string) => Promise<{ data: OAuthAuthz | null; error: Error | null }>;
};
function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) return { needsAuth: true as const, authorizationId };
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return { needsAuth: false as const, authorizationId, details: data };
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md p-8 text-foreground">
      <h1 className="text-xl font-semibold">Could not load this authorization request</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function Consent() {
  const data = Route.useLoaderData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // If not signed in, render a compact sign-in form that re-runs the loader on success.
  if (data.needsAuth) {
    async function signIn(e: React.FormEvent) {
      e.preventDefault();
      setBusy(true);
      setError(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) {
        setError(error.message);
        return;
      }
      window.location.reload();
    }
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="font-display text-2xl tracking-widest">JARVIS // AUTHORIZE</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to approve this MCP client connection.
        </p>
        <form onSubmit={signIn} className="mt-6 space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-primary/40 bg-background px-3 py-2 font-mono text-sm"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-primary/40 bg-background px-3 py-2 font-mono text-sm"
          />
          {error && (
            <p className="text-sm" style={{ color: "var(--destructive)" }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full border border-primary/60 bg-primary/10 py-2 font-display text-xs uppercase tracking-[0.3em] text-primary hover:bg-primary/25 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data: r, error } = approve
      ? await oauthApi().approveAuthorization(data.authorizationId)
      : await oauthApi().denyAuthorization(data.authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = r?.redirect_url ?? r?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = data.details?.client?.name ?? "an app";
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="font-display text-2xl tracking-widest">CONNECT {clientName.toUpperCase()}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This lets <strong>{clientName}</strong> use JARVIS as you — read and create your tasks,
        notes, and inspect your agents.
      </p>
      {data.details?.scope && (
        <p className="mt-2 font-mono text-xs text-muted-foreground/80">
          scope: {data.details.scope}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm" style={{ color: "var(--destructive)" }}>
          {error}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="flex-1 border border-primary/60 bg-primary/15 py-2 font-display text-xs uppercase tracking-[0.3em] text-primary hover:bg-primary/30 disabled:opacity-60"
        >
          ▸ Approve
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="flex-1 border border-primary/30 bg-background py-2 font-display text-xs uppercase tracking-[0.3em] text-muted-foreground hover:bg-primary/5 disabled:opacity-60"
        >
          Deny
        </button>
      </div>
    </main>
  );
}
