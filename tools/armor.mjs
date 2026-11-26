// 서고의 단추 · 고르기 · 입력칸 갑옷 — style.css 끝에 붙는 한 덩어리를 다시 짓는다.
//
// 실리태번 테마 가운데 button · .menu_button · select · input 에 !important 로 바탕 · 테두리 · 둥근 모서리 · 그림자를 입히는 것이 있다.
// 그러면 서고 쪽 규칙(보통 세기)이 져서, 탭 · 숫자 칸 · 인연 칩 · 고치기 단추가 테마의 회색 상자로 바뀐다.
// 여기서는 style.css 에서 "누르는 것 · 고르는 것 · 쓰는 칸"을 겨누는 규칙만 골라, 생김새를 정하는 칸(바탕 · 테두리 · 글자 · 여백 · 크기)에
// !important 를 붙인 사본을 서고 범위(#memoria_settings · #memoria_tie_picker)로 좁혀 끝에 붙인다. 원래 규칙은 그대로 둔다.
// 놓임새(display · position · flex · grid · 순서 · 보이기)는 건드리지 않는다 — jQuery 의 보이기/숨기기 · [hidden] 을 막지 않게.
//
//   node tools/armor.mjs          style.css 의 갑옷을 다시 짓는다
//   node tools/armor.mjs --check  갑옷이 최신인지 본다 (테스트가 부른다)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const START = '/* ⟦armor:start⟧ — tools/armor.mjs 가 짓는 덩어리입니다. 손으로 고치지 말고 위쪽 규칙을 고친 뒤 node tools/armor.mjs 를 돌리세요. */';
const END = '/* ⟦armor:end⟧ */';

/** 누르는 것 · 고르는 것 · 쓰는 칸을 가리키는 이름 (화면 코드에 실제로 쓰인 것) */
const CONTROL_CLASSES = [
    'menu_button', 'text_pole', 'memoria__tab', 'memoria__kindchip', 'memoria__filt-btn', 'memoria__source-button', 'memoria__library-launcher', 'memoria__kind-select',
    'memoria__lock-add-kind', 'memoria__lock-add-priority', 'memoria__lock-add-summary',
    'memoria-au-btn', 'memoria-au-input', 'memoria-au-link', 'memoria-au-mode', 'memoria-au-textbtn', 'memoria-gap-fill', 'memoria-checkpoint-restore',
    'memoria-conflict-ignore', 'memoria-conflict-keep', 'memoria-bundle-chat', 'memoria-bundle-owner', 'memoria-pop__lang', 'memoria-pop__person', 'memoria-source',
    'mm-link', 'mm-ti-btn', 'mm-ti-chip', 'mm-yn-btn', 'mm-yn-hrow', 'mm-yn-jump', 'mm-yn-mini', 'mm-yn-ownbtn', 'mm-yn-owngroup', 'mm-yn-pick', 'mm-yn-wf', 'mm-yn-who', 'mm-yn-whof',
    'mmv-change-kind', 'mmv-change-who', 'mmv-export', 'mmv-jump', 'mmv-person-chip', 'mmv-stars-min',
];
/** 생김새를 정하는 칸 — 이것만 !important 로 */
const LOOK = /^(background(-color|-image|-position|-size|-repeat)?|border(-(top|right|bottom|left|block|inline)(-(color|style|width))?|-(color|style|width)|-radius|-(top|bottom)-(left|right)-radius)?|box-shadow|color|filter|text-shadow|font(-(family|size|weight|style))?|letter-spacing|line-height|text-decoration(-[a-z]+)?|text-underline-offset|text-transform|text-align|padding(-[a-z]+)?|margin(-[a-z]+)?|(min-|max-)?(width|height)|appearance|-webkit-appearance|outline(-[a-z]+)?|white-space|cursor)$/;
/** 갑옷의 범위 밖에서 열리는 창 — 그쪽 규칙은 범위를 덧씌우지 않는다 */
const OWN_ROOTS = /^(#memoria_settings|#memoria_tie_picker|\.memoria-library|\.memoria__bundle-dialog|\.memoria__repeat-dialog|\.memoria-pop|\.memoria-review|body|html|:root)/;
const SCOPE = ':is(#memoria_settings, #memoria_tie_picker)';

const lastCompound = (sel) => sel.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean).pop() || '';
function targetsControl(sel) {
    const last = lastCompound(sel.replace(/::?[a-z-]+(\([^)]*\))?$/i, (m) => (/^::/.test(m) ? '' : m)));
    if (/(^|[^\w-])(button|select|textarea|input)(?![\w-])/.test(last.replace(/\.[\w-]+|#[\w-]+|\[[^\]]*\]/g, (m) => (m.startsWith('[') ? '' : ' ')))) return true;
    return CONTROL_CLASSES.some(c => new RegExp(`\\.${c.replace(/[-_]/g, '\\$&')}(?![\\w-])`).test(last));
}
function scoped(sel) {
    const s = sel.trim();
    if (/^\.mm-yn-picker(?![\w-])/.test(s)) return s.replace(/^\.mm-yn-picker/, '#memoria_tie_picker');
    if (OWN_ROOTS.test(s)) return s;
    return `${SCOPE} ${s}`;
}
/** 선택자 목록을 쉼표로 나눈다 (괄호 안의 쉼표는 두고) */
function splitSelectors(text) {
    const out = []; let depth = 0, cur = '';
    for (const ch of text) {
        if (ch === '(') depth++; else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map(s => s.trim()).filter(Boolean);
}
function declsOf(body) {
    const out = []; let depth = 0, cur = '';
    for (const ch of body) {
        if (ch === '(') depth++; else if (ch === ')') depth--;
        if (ch === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map(d => d.trim()).filter(Boolean);
}
/** 규칙 목록 (@media 안의 것은 그 조건과 함께). 주석은 미리 걷는다 */
function rulesOf(css) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, ''), rules = [];
    const walk = (s, media) => {
        let i = 0;
        while (i < s.length) {
            const open = s.indexOf('{', i);
            if (open < 0) break;
            const head = s.slice(i, open).trim();
            let depth = 1, j = open + 1;
            while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
            const body = s.slice(open + 1, j - 1);
            if (/^@media/i.test(head)) walk(body, head);
            else if (!/^@/.test(head)) rules.push({ media, selectors: splitSelectors(head), decls: declsOf(body) });
            i = j;
        }
    };
    walk(text, '');
    return rules;
}
export function buildArmor(css) {
    const base = (css.includes(START) ? css.slice(0, css.indexOf(START)) + (css.includes(END) ? css.slice(css.indexOf(END) + END.length) : '') : css).trimEnd();
    const out = [];
    for (const r of rulesOf(base)) {
        const sels = r.selectors.filter(targetsControl);
        if (!sels.length) continue;
        const decls = r.decls.filter(d => { const p = d.slice(0, d.indexOf(':')).trim().toLowerCase(); return d.includes(':') && !p.startsWith('--') && LOOK.test(p); })
            .map(d => (/!important\s*$/i.test(d) ? d : `${d} !important`));
        if (!decls.length) continue;
        const rule = `${[...new Set(sels.map(scoped))].join(', ')} { ${decls.join('; ')}; }`;
        out.push(r.media ? `${r.media} { ${rule} }` : rule);
    }
    // 테마가 서고의 단추에 덧입히는 그림자 · 무늬 · 글자 그림자는 늘 걷는다 (서고 쪽 규칙이 이것을 정하지 않은 단추도)
    const reset = `#memoria_settings .inline-drawer-content :where(button, .menu_button, select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"])), #memoria_tie_picker :where(button, select, input) { box-shadow: none !important; text-shadow: none !important; filter: none !important; text-transform: none !important; border-radius: 0 !important; margin: 0 !important; }`;
    return `${base}\n\n${START}\n${reset}\n${out.join('\n')}\n${END}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const file = new URL('../style.css', import.meta.url), css = readFileSync(file, 'utf8'), next = buildArmor(css);
    if (process.argv.includes('--check')) { if (next !== css) { console.error('style.css 의 갑옷이 낡았어요 — node tools/armor.mjs 를 돌려 주세요'); process.exit(1); } }
    else { writeFileSync(file, next); console.log(`갑옷 ${next.split('\n').length - css.split('\n').length >= 0 ? '다시 지음' : '줄어듦'}`); }
}
