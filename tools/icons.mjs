// 서고의 아이콘을 가는 선 그림으로 — Font Awesome 의 굵은 글꼴 아이콘(<i class="fa-solid fa-…">) 자리에 같은 뜻의 선 그림을 가면(mask)으로 씌운다.
// 마크업과 이벤트는 그대로 두고 그림만 바꾼다. style.css 끝의 ⟦icons⟧ 덩어리를 다시 짓는다:  node tools/icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';

/** 선 그림 (24칸 · 선 굵기 1.7 · 둥근 끝) */
export const PATHS = {
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    eyeoff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7', plus: 'M12 5v14M5 12h14', refresh: 'M20 11a8 8 0 1 0-2.3 6.3M20 4v7h-7',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
    sparkle: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
    lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3', unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2', chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
    sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4', feather: 'M20 4c-7 0-13 6-13 13v3h3c7 0 13-6 13-13V4zM4 20L14 10M9 15h5',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 8h7',
    mark: 'M7 3h10v18l-5-4-5 4z', star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z',
    sprout: 'M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 15c0-3 2.5-5 6.5-5 0 3-2.5 5-6.5 5z', anchor: 'M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 8v13M8 12h8M4 13a8 8 0 0 0 16 0',
    quote: 'M5 17c2-1 3-3 3-5H5V7h5v5c0 3-2 5-4 6zM14 17c2-1 3-3 3-5h-3V7h5v5c0 3-2 5-4 6z', merge: 'M6 4v16M6 12c6 0 6-6 12-6M15 3l3 3-3 3',
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7M22 21a7 7 0 0 0-4-6.3', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    mask: 'M3 8c3-2 6-2 9 0 3-2 6-2 9 0 0 6-3 9-6 9-1.5 0-2-1-3-1s-1.5 1-3 1c-3 0-6-3-6-9z', glass: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9',
    copy: 'M9 9h11v11H9zM5 15V4h11', import: 'M12 3v12M7 10l5 5 5-5M4 21h16', upload: 'M12 15V3M7 8l5-5 5 5M4 21h16', check: 'M5 12l5 5L20 7', more: 'M5 12h.01M12 12h.01M19 12h.01',
    stop: 'M7 7h10v10H7z', send: 'M4 12l16-8-6 16-3-7z', panel: 'M4 4h16v16H4zM9 4v16', note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
    warn: 'M12 3l10 18H2zM12 10v5M12 18v.5', place: 'M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    volume: 'M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6', snow: 'M12 2v20M3.5 7l17 10M20.5 7l-17 10M9 4l3 3 3-3M9 20l3-3 3 3', shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5', x: 'M6 6l12 12M18 6L6 18', plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4', bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
    constel: 'M6.2 16.8l3.9-3.4M12.4 12.9l4.4 1.6M11.6 10.4l1.1-3.9M5 16.3a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM11 9.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM18.2 13.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM13.2 3.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z',
    folder: 'M3 6h6l2 2h10v11H3z', heart: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z',
};
/** Font Awesome 이름 → 선 그림 */
export const FA = {
    trash: 'trash', pen: 'edit', 'pen-to-square': 'edit', signature: 'edit', eye: 'eye', 'eye-slash': 'eyeoff', 'magnifying-glass': 'search', thumbtack: 'pin', 'thumbtack-slash': 'pin',
    plus: 'plus', 'file-circle-plus': 'plus', 'heart-circle-plus': 'plus', 'user-plus': 'plus', undo: 'refresh', 'rotate-left': 'refresh', rotate: 'refresh', 'arrows-rotate': 'refresh', repeat: 'refresh',
    'clock-rotate-left': 'clock', clock: 'clock', link: 'link', 'wand-magic-sparkles': 'sparkle', lock: 'lock', 'lock-open': 'unlock', 'comment-dots': 'chat', sliders: 'sliders', feather: 'feather',
    globe: 'globe', language: 'globe', 'book-open': 'book', book: 'book', 'book-bookmark': 'book', bookmark: 'mark', star: 'star', seedling: 'sprout', anchor: 'anchor', 'quote-left': 'quote',
    'code-merge': 'merge', 'user-group': 'users', 'people-arrows': 'users', 'user-secret': 'mask', mask: 'mask', 'id-card': 'user', 'hourglass-half': 'glass', 'hourglass-end': 'glass', copy: 'copy',
    download: 'import', 'file-import': 'import', 'file-export': 'upload', 'floppy-disk': 'import', check: 'check', 'circle-check': 'check', 'list-check': 'check', 'spell-check': 'check',
    ellipsis: 'more', stop: 'stop', 'paper-plane': 'send', 'gauge-high': 'panel', brain: 'sparkle', scroll: 'note', 'scale-balanced': 'check', 'screwdriver-wrench': 'gear',
    'triangle-exclamation': 'warn', 'circle-info': 'bell', 'location-dot': 'place', 'calendar-day': 'cal', 'volume-xmark': 'volume', snowflake: 'snow', shuffle: 'shuffle', 'layer-group': 'layers',
    broom: 'sparkle', eraser: 'x', coins: 'star', 'plug-circle-check': 'plug', 'diagram-project': 'constel', 'folder-open': 'folder', heart: 'heart', 'circle-xmark': 'x', xmark: 'x',
};
const START = '/* ⟦icons:start⟧ — tools/icons.mjs 가 짓는 덩어리입니다. 손으로 고치지 말고 node tools/icons.mjs 를 돌리세요. */';
const END = '/* ⟦icons:end⟧ */';
const uri = (d) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='${d}'/></svg>`).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/')}")`;
const SCOPE = ['#memoria_settings', '#memoria_tie_picker'];
export function buildIcons() {
    const names = Object.keys(FA);
    const sel = (suffix = '') => SCOPE.flatMap(s => names.map(n => `${s} .fa-${n}${suffix}`)).join(',\n');
    const lines = [START,
        `${sel('::before')} {\n    content: "" !important; display: inline-block; width: 1.12em; height: 1.12em; vertical-align: -0.2em;\n    background: currentColor; -webkit-mask: var(--mm-ico) center / contain no-repeat; mask: var(--mm-ico) center / contain no-repeat;\n}`,
        ...names.map(n => `${SCOPE.map(s => `${s} .fa-${n}`).join(', ')} { --mm-ico: ${uri(PATHS[FA[n]])}; }`),
        END];
    return lines.join('\n');
}
const file = new URL('../style.css', import.meta.url);
const css = readFileSync(file, 'utf8');
const base = css.includes(START) ? css.slice(0, css.indexOf(START)).trimEnd() + (css.includes(END) ? css.slice(css.indexOf(END) + END.length) : '') : css.trimEnd();
writeFileSync(file, base.trimEnd() + '\n\n' + buildIcons() + '\n');
console.log('아이콘', Object.keys(FA).length);
