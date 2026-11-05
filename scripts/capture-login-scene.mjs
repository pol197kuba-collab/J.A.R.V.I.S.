// Visual-fidelity proof for the 3D login scene: pins the app's scene to the
// same phases p as docs/login-scene-prototype/reference/ and screenshots it.
// Needs the dev server (`npm run dev`: the hook window.__loginScene exists only
// in DEV) and Playwright with Chromium (software GL flags, no GPU needed).
//
//   node scripts/capture-login-scene.mjs <outDir> <width> <height> <d|m> <tag> <p1> <p2> ...
//   node scripts/capture-login-scene.mjs shots 1440 810 d desktop 0 0.1 0.2 0.3 0.5 0.7 1
//   node scripts/capture-login-scene.mjs shots 390 844 m mobile 0 0.3 1
//
// BASE_URL (default http://127.0.0.1:5173) must point at the dev server.
import { chromium } from "playwright";

const [out, w, h, m, tag, ...phases] = process.argv.slice(2);
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
await page.waitForTimeout(5000); // dev server: first load optimises dependencies
await page.getByRole("button", { name: /Engage JARVIS/i }).click({ timeout: 60000 });
await page.waitForFunction("window.__loginScene", null, { timeout: 120000 });
await page.waitForTimeout(2500);

for (const p of phases) {
  await page.evaluate(
    `(() => { __loginScene.set(${parseFloat(p)}); __loginScene.layout(); for (let i = 0; i < 2; i++) __loginScene.frame(); })()`,
  );
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${tag}_p${p}.png`, timeout: 120000 });
}
console.log("ERR", JSON.stringify(errors));
await browser.close();
