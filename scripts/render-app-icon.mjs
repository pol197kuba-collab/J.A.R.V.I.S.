// Renders public/icon-512.png FROM the 3D intro scene: the reactor front-on, the
// exact first frame the app shows on start (BootSplash → scene cross-fade). The
// same image is the PWA icon, so Android's system splash screen, the in-app boot
// splash and the scene's first frame are one picture.
//
//   npm run dev   (then, in another shell:)
//   NODE_PATH=$(npm root -g) BASE_URL=http://127.0.0.1:5173 node scripts/render-app-icon.mjs [out.png]
//
// Needs Playwright + Chromium (software GL flags; no GPU needed).
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(`${process.env.NODE_PATH ?? ""}/`);
const { chromium } = require("playwright");

const out = process.argv[2] ?? "public/icon-512.png";
const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const SIZE = 512;
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await (
  await browser.newContext({ viewport: { width: SIZE, height: SIZE } })
).newPage();
// the splash image spans the whole square; the page's DOM layers are hidden
await page.addInitScript(() => {
  const css = `[data-boot-splash-img]{width:100vw!important;max-width:none!important}
    [data-boot-splash-img]{visibility:hidden!important}
    .fixed.z-\\[200\\]{background:transparent!important}
    .lp-root{visibility:hidden!important}
    [data-login-scene] > div{opacity:0!important}`;
  document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = css;
    document.head.append(s);
  });
});
await page.goto(`${base}/?loginScene=1`, { waitUntil: "load" });
await page.waitForFunction("window.__loginScene", null, { timeout: 120000 });
await page.evaluate("__loginScene.setSplash(0)");
await page.waitForTimeout(1500);
await page.evaluate("__loginScene.layout(); __loginScene.frame(3)");
await page.waitForTimeout(600);
const shot = (await page.screenshot()).toString("base64");
// The bloom halo tints the whole square; fade everything outside the reactor's
// outer ring to black, so the icon sits on the black splash with no visible edge
// (and stays inside the maskable safe zone).
const png = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const r = c.width / 2;
  const g = x.createRadialGradient(r, r, r * 0.86, r, r, r);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,1)");
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  return c.toDataURL("image/png").split(",")[1];
}, shot);
writeFileSync(out, Buffer.from(png, "base64"));
console.log("wrote", out);
await browser.close();
