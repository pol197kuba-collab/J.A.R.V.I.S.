"""Zrzuty demo v2 w ustalonych fazach (do porównania z aplikacją).
Użycie: python3 capture_demo.py <url_demo> <katalog> <szer> <wys> <d|m> <tag> <spec> [<spec> ...]
spec: stop:ułamek (np. hero:0.3, a1:0.5, modules:0.4, engage:0), login, ig0.25, ig0.5, ig0.75, corefinal.
Kolejność ma znaczenie: login → ig... → corefinal w jednym przebiegu. Wymaga Playwright i Chromium
(flagi SwiftShader pozwalają renderować WebGL bez GPU). Demo wystawia window.__jv w trybie #shot."""
import sys, asyncio
from playwright.async_api import async_playwright
A = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
async def main(url, out, w, h, m, tag, specs):
    async with async_playwright() as p:
        b = await p.chromium.launch(args=A); errs = []
        c = await b.new_context(viewport={'width': w, 'height': h}, has_touch=m, is_mobile=m)
        g = await c.new_page(); g.on('pageerror', lambda e: errs.append(str(e)))
        await g.goto(url + '#shot'); await g.wait_for_function('window.__jv', timeout=120000); await g.wait_for_timeout(700)
        st = await g.evaluate('__jv.stops.map(s=>[s.id,s.a,Math.min(s.b,1e7)])'); d = {s[0]: s for s in st}
        async def snap(n):
            await g.evaluate('for(let i=0;i<2;i++)__jv.frame()'); await g.wait_for_timeout(350)
            await g.screenshot(path=f'{out}/{tag}_{n}.png', timeout=120000)
        for s in specs:
            if s == 'login':
                await g.evaluate('document.querySelector("#engage-btn").click()'); await g.wait_for_timeout(900); await snap('login')
            elif s == 'corefinal':
                await g.evaluate('__jv.enterCore();__jv.setIg(1)'); await g.wait_for_timeout(300); await snap('corefinal')
            elif s.startswith('ig'):
                f = float(s[2:])
                await g.evaluate(f'(()=>{{if(__jv.state.mode!=="ignite")document.querySelector("#login-form").requestSubmit();__jv.setIg({f})}})()')
                await g.wait_for_timeout(1000); await snap(s)
            else:
                i, f = s.split(':'); f = float(f)
                y = d[i][1] + 200 if i == 'engage' else d[i][1] + (d[i][2] - d[i][1]) * f
                await g.evaluate(f'scrollTo({{top:{y},behavior:"instant"}})'); await g.wait_for_timeout(120); await snap(s.replace(':', '_'))
        print('ERR', errs); await b.close()
a = sys.argv
asyncio.run(main(a[1], a[2], int(a[3]), int(a[4]), a[5] == 'm', a[6], a[7:]))
