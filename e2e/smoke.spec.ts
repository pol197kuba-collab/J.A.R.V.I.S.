import { expect, test } from "@playwright/test";

// Every screen of the app, in the current UI mode (project metadata) and
// viewport (project). See playwright.config.ts for what this does and doesn't
// cover. Keep ROUTES in sync with src/routes when a page is added.
const ROUTES = [
  "/",
  "/agent-hub",
  "/agent-hub/jarvis",
  "/commands",
  "/documents",
  "/feed",
  "/jarvis",
  "/notes",
  "/paliwa",
  "/rynki",
  "/schema",
  "/settings",
  "/situation-room",
  "/sub-systems",
  "/system-logs",
  "/tasks",
  "/town",
  "/vision",
];

// The dummy backend refuses every request — those failures are expected.
const NOISE =
  /Failed to fetch|ERR_CONNECTION_REFUSED|localhost:54321|status of (401|403|404|500)|NetworkError|net::ERR|AbortError|WebSocket|realtime|Failed to load resource/i;

/** A signed-in session the client accepts without asking the server. */
function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 86_400;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: "e2e", exp, role: "authenticated" })}.sig`;
  return {
    access_token: jwt,
    refresh_token: "e2e",
    token_type: "bearer",
    expires_in: 86_400,
    expires_at: exp,
    user: {
      id: "e2e",
      aud: "authenticated",
      role: "authenticated",
      email: "e2e@jarvis.local",
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

test("every screen renders cleanly", async ({ page }, testInfo) => {
  const mode = String(testInfo.project.metadata.mode ?? "hud");
  await page.addInitScript(
    ([session, uiMode]) => {
      localStorage.setItem("sb-localhost-auth-token", JSON.stringify(session));
      localStorage.setItem("jarvis.uiMode", uiMode);
    },
    [fakeSession(), mode] as const,
  );

  let current = "boot";
  const issues: Record<string, string[]> = {};
  const add = (msg: string) => {
    const list = (issues[current] ??= []);
    if (!list.includes(msg)) list.push(msg);
  };
  page.on("pageerror", (e) => add(`uncaught: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.text())) add(`console: ${m.text().slice(0, 200)}`);
  });

  // Boot once (the ENGAGE screen), then move between screens in-app — a full
  // reload would replay the boot sequence for every route.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // The button renders before React hydrates (cold dev-server compile) and
  // an early click can bounce back to the boot screen, so keep engaging
  // until the dashboard's <main> is actually up.
  const engage = page.getByText(/ENGAGE/i).first();
  await expect(async () => {
    if (await engage.isVisible()) await engage.click({ timeout: 5_000 });
    const skip = page.getByText(/skip|pomiń/i).first();
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 180_000 });

  for (const route of ROUTES) {
    current = route;
    await page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    }, route);
    await page.waitForTimeout(2_500);

    const found = await page.evaluate(() => {
      const out: string[] = [];
      const de = document.documentElement;
      const overflow = Math.max(
        de.scrollWidth - de.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
      );
      if (overflow > 2) out.push(`page scrolls sideways by ${overflow}px`);
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || cs.display === "none" || cs.visibility === "hidden") continue;
        const scrolls =
          (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
          (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1);
        if (scrolls && cs.scrollbarWidth !== "none" && el.offsetWidth - el.clientWidth > 0) {
          const cls = String(el.className).split(" ").slice(0, 4).join(".");
          out.push(`visible scrollbar on <${el.tagName.toLowerCase()} .${cls}> — add no-scrollbar`);
        }
      }
      return { path: location.pathname, out };
    });
    if (found.path !== route) add(`ended on ${found.path}`);
    for (const msg of found.out) add(msg);
  }

  expect(issues, "screens with problems").toEqual({});
});
