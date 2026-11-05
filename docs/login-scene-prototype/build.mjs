import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020' });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const range = { 'latin': 'U+0000-00FF,U+2000-206F,U+20AC,U+2190-21FF,U+25A0-25FF,U+2600-26FF', 'latin-ext': 'U+0100-02BA,U+1E00-1EFF' };
const face = (dir, name, w, subs) => subs.map((k) => {
  const b = fs.readFileSync(`node_modules/@fontsource/${dir}/files/${dir}-${k}-${w}-normal.woff2`).toString('base64');
  return `@font-face{font-family:"${name}";font-weight:${w === 400 ? '400 700' : w};font-display:swap;src:url(data:font/woff2;base64,${b}) format("woff2");unicode-range:${range[k]}}`;
}).join('');
const css = face('share-tech-mono', 'Share Tech Mono', 400, ['latin']) + face('jetbrains-mono', 'JetBrains Mono', 400, ['latin', 'latin-ext']);
const html = fs.readFileSync('src/index.html', 'utf8').replace('/*FONTS*/', () => css).replace('/*BUNDLE*/', () => js);
fs.writeFileSync('jarvis-flow.html', html);
fs.writeFileSync('test.html', `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${html}</body></html>`);
console.log((html.length / 1024).toFixed(0) + ' KB');
