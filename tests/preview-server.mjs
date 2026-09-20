import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { libraryFixturePost } from './library-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Memoria · UI 검증</title>
<link rel="stylesheet" href="/style.css"><style>
:root{color-scheme:dark;--SmartThemeBodyColor:#e4ddd3;--SmartThemeBlurTintColor:#252624;--SmartThemeBorderColor:#595f56;--SmartThemeQuoteColor:#a4bea5}*{box-sizing:border-box}body{font:15px/1.55 system-ui,sans-serif;background:#191c1a;color:#e4ddd3;margin:0;padding:20px}main{max-width:620px;margin:auto}h1{font-size:18px}.fixture-note{color:#a3ada4;font-size:13px}input,textarea,select,button{font:inherit;color:inherit;background:#292d29;border:1px solid #555e53;border-radius:5px;max-width:100%;padding:6px}button,.menu_button{cursor:pointer}.menu_button{border:1px solid #555e53;border-radius:5px}textarea{width:100%}.inline-drawer-header{padding:12px 0}.disabled{pointer-events:none;opacity:.5}#toast{position:fixed;bottom:16px;right:16px;max-width:90%;background:#2f4936;padding:8px;border-radius:6px;z-index:1000}.fixture-dialog{width:min(700px,94vw);max-height:90vh;background:#252624;color:inherit;border:1px solid #66725f;border-radius:10px}.fixture-dialog::backdrop{background:#0009}.fixture-dialog footer{display:flex;gap:8px;justify-content:flex-end;margin-top:15px}
:root[data-theme="light"]{color-scheme:light;--SmartThemeBodyColor:#282828;--SmartThemeBlurTintColor:#fff;--SmartThemeBorderColor:#c5c5c5;--SmartThemeQuoteColor:#697768}
[data-theme="light"] body{background:#fafafa;color:#282828}
[data-theme="light"] .fixture-note{color:#666}
[data-theme="light"] :is(input,textarea,select,button,.fixture-dialog){background:#fff;border-color:#c5c5c5}
[data-theme="light"] .menu_button{border-color:#c5c5c5}
</style><link rel="stylesheet" href="/tests/preview-popup.css"><main><h1>Memoria · 화면 검증</h1><p class="fixture-note">가상 대화와 모의 API를 사용하는 로컬 검증 화면입니다. <a href="/?theme=light">밝은 테마</a> · <a href="/">어두운 테마</a></p><div id="extensions_settings2"></div></main><div id="toast" hidden role="status"></div>
<script src="/jquery.js"></script><script>window.toastr=Object.fromEntries(['success','info','warning','error'].map(k=>[k,(msg)=>{const el=document.getElementById('toast');el.hidden=false;el.textContent=msg}]));</script><script type="module" src="/index.js"></script></html>`;
const allowed = new Map([['/jquery.js', 'node_modules/jquery/dist/jquery.min.js'], ['/style.css', 'style.css'], ['/archive-engine.mjs', 'archive-engine.mjs'], ['/templates/settings.html', 'templates/settings.html'], ['/manifest.json', 'manifest.json'], ['/tests/mock-host.mjs', 'tests/mock-host.mjs']]);
for (const file of ['library-engine.mjs', 'library-ui.mjs', 'library-view.mjs', 'templates/library.html', 'tests/library-fixture.mjs', 'tests/preview-popup.css']) allowed.set(`/${file}`, file);
createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/thumbnail') {
            // Fictional portraits test the same image-loading route as the host, without user files.
            const hue = [...(url.searchParams.get('file') || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
            res.setHeader('Content-Type', 'image/svg+xml');
            res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="120" viewBox="0 0 100 120"><rect width="100" height="120" fill="hsl(${hue} 25% 70%)"/><ellipse cx="50" cy="118" rx="42" ry="47" fill="hsl(${hue} 25% 33%)"/><path d="M24 57Q17 13 50 12Q83 14 77 65L68 81H32Z" fill="#313139"/><ellipse cx="50" cy="49" rx="22" ry="28" fill="#ebc7ab"/><path d="M25 41Q28 10 52 17Q75 17 76 41Q55 38 43 26Q37 38 25 41" fill="#313139"/><path d="M40 49h4m13 0h4" stroke="#48362d" stroke-width="3"/><path d="M46 64q5 3 10 0" stroke="#a96d68" fill="none" stroke-width="2"/></svg>`); return;
        }
        if (url.pathname.startsWith('/api/') && req.method === 'POST') {
            let body = ''; for await (const chunk of req) body += chunk;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(await libraryFixturePost(url.pathname, JSON.parse(body || '{}')))); return;
        }
        if (url.pathname === '/') {
            const page = url.searchParams.get('theme') === 'light' ? html.replace('<html lang="ko">', '<html lang="ko" data-theme="light">') : html;
            res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); return;
        }
        if (url.pathname === '/index.js') {
            let code = await readFile(path.join(root, 'index.js'), 'utf8');
            code = code.replace(/from "[^"\n]+"/g, 'from "/tests/mock-host.mjs"');
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(code); return;
        }
        if (!allowed.has(url.pathname)) { res.writeHead(404); res.end(); return; }
        const target = allowed.get(url.pathname);
        res.setHeader('Content-Type', `${target.endsWith('.css') ? 'text/css' : target.endsWith('.html') ? 'text/html' : target.endsWith('.json') ? 'application/json' : 'text/javascript'}; charset=utf-8`);
        res.end(await readFile(path.join(root, target)));
    } catch (error) { res.writeHead(500); res.end(error.message); }
}).listen(8790, '127.0.0.1', () => console.log('Memoria fixture: http://127.0.0.1:8790'));
