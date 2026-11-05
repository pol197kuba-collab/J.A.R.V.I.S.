// Visual-fidelity proof for the 3D intro (landing → login → ignition → Arc Core):
// pins the app's scene to the same frames as docs/jarvis-3d-v2/reference/ and
// screenshots them. Needs the DEV server (`npm run dev`: the hook
// window.__loginScene exists only in DEV) and Playwright + Chromium (software GL
// flags, no GPU needed). Playwright is not an app dependency: install it
// globally and run with NODE_PATH=$(npm root -g).
//
//   NODE_PATH=$(npm root -g) node scripts/capture-intro-scene.mjs <outDir> <w> <h> <d|m> <tag> <spec>...
//   specs: hero:0.3  a1:0.5  modules:0.4  engage:0  login  ig0.25  ig0.5  ig0.75  corefinal
//   e.g.   … shots 1440 810 d desktop hero:0.3 a1:0.5 modules:0.4 engage:0 login ig0.25 ig0.5 ig0.75 corefinal
//
// BASE_URL (default http://127.0.0.1:5173) must point at the dev server. Order matters
// like in the demo's capture_demo.py: login → ig… → corefinal in one run. `corefinal`
// seeds the five teammates (two of them busy) through the DEV hook so the labels show.
import { createRequire } from "node:module";

const require = createRequire(`${process.env.NODE_PATH ?? ""}/`);
const { chromium } = require("playwright");

const [out, w, h, m, tag, ...specs] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const args = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

const browser = await chromium.launch({ args });
const ctx = await browser.newContext({
  viewport: { width: +w, height: +h },
  hasTouch: m === "m",
  isMobile: m === "m",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${base}/?loginScene=1`, { waitUntil: "load" });
await page.waitForFunction("window.__loginScene", null, { timeout: 120000 });
await page.waitForTimeout(2500);
const stops = Object.fromEntries(
  (await page.evaluate("__loginScene.stops().map(s => [s.id, s.a, Math.min(s.b, 1e7)])")).map(
    (s) => [s[0], s],
  ),
);

const snap = async (name) => {
  await page.evaluate("__loginScene.frame(2)");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${tag}_${name}.png`, timeout: 120000 });
};
const demoAgents = `['shield','herald','insight','metric','forge'].map((slug, i) => ({
  slug,
  name: ['S.H.I.E.L.D.', 'H.E.R.A.L.D.', 'I.N.S.I.G.H.T.', 'M.E.T.R.I.C.', 'F.O.R.G.E.'][i],
  role: ['Security & Compliance', 'Strategy & Content', 'Deep Research', 'Performance Insights', 'Content Creation / Execution'][i],
  busy: i === 1 || i === 3,
  busySince: i === 1 || i === 3 ? new Date(Date.now() - (i === 1 ? 23 : 41) * 1000).toISOString() : null,
}))`;

for (const s of specs) {
  if (s === "login") {
    await page.evaluate(`__loginScene.setScroll(${stops.engage[1] + 200})`);
    await page.evaluate("__loginScene.frame(3)");
    await page.waitForTimeout(400);
    await page.evaluate('document.querySelector(".lp-engage-btn").click()');
    await page.waitForTimeout(1500);
    await snap("login");
  } else if (s === "corefinal") {
    await page.evaluate(`__loginScene.setAgents(${demoAgents})`);
    await page.evaluate("__loginScene.setIgnite(1)");
    await page.waitForTimeout(300);
    await snap("corefinal");
  } else if (s.startsWith("ig")) {
    await page.evaluate(`__loginScene.setIgnite(${parseFloat(s.slice(2))})`);
    await page.waitForTimeout(600);
    await snap(s);
  } else {
    const [id, f] = s.split(":");
    const y =
      id === "engage"
        ? stops[id][1] + 200
        : stops[id][1] + (stops[id][2] - stops[id][1]) * parseFloat(f);
    await page.evaluate(`__loginScene.setScroll(${y})`);
    await page.waitForTimeout(150);
    await snap(s.replace(":", "_"));
  }
}
console.log("ERR", JSON.stringify(errors));
await browser.close();
