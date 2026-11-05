import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', external: [] });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const range = { 'latin': 'U+0000-00FF,U+2000-206F,U+20AC,U+2190-21FF,U+25A0-25FF,U+2600-26FF', 'latin-ext': 'U+0100-02BA,U+1E00-1EFF' };
const face = (dir, name, w, subs) => subs.map((k) => {
  const b = fs.readFileSync(`node_modules/@fontsource/${dir}/files/${dir}-${k}-${w}-normal.woff2`).toString('base64');
  return `@font-face{font-family:"${name}";font-weight:${w === 400 ? '400 700' : w};font-display:swap;src:url(data:font/woff2;base64,${b}) format("woff2");unicode-range:${range[k]}}`;
}).join('');
const css = face('share-tech-mono', 'Share Tech Mono', 400, ['latin']) + face('jetbrains-mono', 'JetBrains Mono', 400, ['latin', 'latin-ext']);
const { AGENTS, MODULES } = await import('./src/data.js');
const agents = AGENTS.map((a, i) => `<section class="stop ${i % 2 ? 'left' : 'right'}" data-stop="a${i}"><div class="pin"><article class="hud"><div class="tag"><span>Agent ${i + 2} z 6</span><i>${a.role.replace('&', '&amp;')}</i></div><h2>${a.name}</h2><p>${a.text}</p></article></div></section>`).join('\n');
const labels = AGENTS.map((a, i) => `<div class="nl" id="l-a${i}"><b>${a.name}</b><span>${a.role.replace('&', '&amp;')}</span></div>`).join('');
const modlist = MODULES.map(([n, s]) => `<li>${n}: ${s}</li>`).join('');
// ArcReactorTriangle.tsx, verbatim geometry
const tri = [0, 120, 240].map((r) => `<g transform="rotate(${r} 100 100)"><polygon points="100,46 130,98 70,98"/><polygon points="100,58 122,96 78,96" opacity=".6"/><line x1="100" y1="46" x2="100" y2="30"/></g>`).join('');
const arc = `<svg viewBox="0 0 200 200"><defs><radialGradient id="arc-core" cx="50%" cy="50%" r="50%"><stop offset="0%" style="stop-color:color-mix(in oklab,var(--primary) 12%,white)"/><stop offset="35%" style="stop-color:var(--primary)" stop-opacity=".95"/><stop offset="70%" style="stop-color:color-mix(in oklab,var(--primary) 70%,black)" stop-opacity=".5"/><stop offset="100%" style="stop-color:color-mix(in oklab,var(--primary) 35%,black)" stop-opacity="0"/></radialGradient></defs><circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" stroke-width=".6" opacity=".4"/><circle cx="100" cy="100" r="82" fill="none" stroke="currentColor" stroke-width=".6" stroke-dasharray="3 4" opacity=".6"/><circle cx="100" cy="100" r="68" fill="url(#arc-core)"/><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px currentColor)">${tri}</g><circle cx="100" cy="100" r="14" style="fill:color-mix(in oklab,var(--primary) 10%,white)"/><circle cx="100" cy="100" r="6" fill="white"/></svg>`;
const html = fs.readFileSync('src/index.html', 'utf8').replace('/*FONTS*/', () => css).replace('<!--AGENTS-->', () => agents).replace('<!--LABELS-->', () => labels).replace('<!--MODLIST-->', () => modlist).replace('<!--ARC-->', () => arc).replace('/*BUNDLE*/', () => js);
fs.writeFileSync('jarvis-landing.html', html);
fs.writeFileSync('test.html', `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${html}</body></html>`);
console.log((html.length / 1024).toFixed(0) + ' KB');
