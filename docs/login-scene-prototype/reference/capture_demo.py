"""Zrzuty referencyjne demo (i do porównania z aplikacją).
Użycie: python3 capture_demo.py <plik_html_z_#shot> <katalog_wyjścia> <szer> <wys> <d|m> <tag> <p1> <p2> ...
Wymaga Playwright + Chromium. Flagi SwiftShader pozwalają renderować WebGL bez GPU.
Demo wystawia window.__f (tryb #shot); aplikacja ma wystawić analogiczny hak tylko w DEV."""
import sys, asyncio
from playwright.async_api import async_playwright
A = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
async def main(url, out, w, h, m, tag, ps):
    async with async_playwright() as p:
        b = await p.chromium.launch(args=A); errs = []
        c = await b.new_context(viewport={'width': w, 'height': h}, has_touch=m, is_mobile=m)
        g = await c.new_page()
        g.on('pageerror', lambda e: errs.append(str(e)))
        await g.goto(url + '#shot'); await g.wait_for_function('window.__f', timeout=120000); await g.wait_for_timeout(600)
        for s in ps:
            await g.evaluate(f'(()=>{{__f.st.dir=1;__f.st.hold=true;__f.set({float(s)});__f.layout();for(let i=0;i<2;i++)__f.frame();}})()')
            await g.wait_for_timeout(450)
            await g.screenshot(path=f'{out}/{tag}_p{s}.png', timeout=120000)
        print('ERR', errs); await b.close()
url, out, w, h, m, tag = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5] == 'm', sys.argv[6]
asyncio.run(main(url, out, w, h, m, tag, sys.argv[7:]))
