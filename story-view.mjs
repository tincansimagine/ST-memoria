/**
 * Memoria 이야기 보기 — 서고를 그림으로 그린다. 문자열(HTML·SVG)만 만들고 화면은 건드리지 않는다.
 *
 * - 맥박: 턴마다의 무게를 막대로 — 이야기가 어디서 뛰었는지 한눈에
 * - 흐름: 요약을 줄기 위의 카드로 — 언제·무슨 일·무엇이 바뀌었나·무엇이 남았나
 * - 연표: 가로는 작중 시간, 세로는 인물(장소) 줄, 점은 사건
 * - 표: 정렬·검색되는 연표
 * - 관계도: 인물은 점, 관계선은 화살표
 */

import { importanceStars, parseRecord } from './scene-engine.mjs';

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const clip = (s, n) => { const t = String(s ?? ''); return [...t].length > n ? `${[...t].slice(0, n - 1).join('')}…` : t; };
const starsText = (v) => '★'.repeat(importanceStars(v));

/* ------------------------------------------------------------
 * 맥박
 * ------------------------------------------------------------ */

/**
 * turns: [{ turnIndex, importance, summary, failed }]
 * spans: [{ fromTurn, toTurn, level }] — 요약이 덮은 구간 (구간마다 색을 번갈아 칠한다)
 * marks: 전환점이 있는 턴 번호들
 */
export function pulseSvg(turns, { spans = [], marks = [] } = {}) {
    const list = [...(turns || [])].sort((a, b) => a.turnIndex - b.turnIndex);
    if (!list.length) return '';
    // 턴이 적을 때는 막대를 굵게 — 화면 폭을 대략 채운다
    const bw = Math.max(3, Math.min(14, Math.floor(330 / list.length) - 2));
    const gap = bw > 3 ? 2 : 1;
    const H = 56;
    const top = 12;
    const W = list.length * (bw + gap);
    const spanOf = (n) => spans.findIndex(s => n >= s.fromTurn && n <= s.toTurn);
    const markSet = new Set(marks);
    const bars = list.map((t, i) => {
        const v = Math.max(0.08, Math.min(1, t.importance ?? 0.4));
        const h = Math.round(6 + v * (H - top - 6));
        const x = i * (bw + gap);
        const si = spanOf(t.turnIndex);
        const tone = si < 0 ? 'raw' : spans[si].level === 'arc' ? 'arc' : (si % 2 ? 'b' : 'a');
        const star = markSet.has(t.turnIndex) ? `<text class="mmv-pulse-star" x="${x + bw / 2}" y="9" text-anchor="middle">★</text>` : '';
        return `${star}<rect class="mmv-pulse-bar mmv-pulse-bar--${tone}${v >= 0.75 ? ' is-peak' : ''}${t.failed ? ' is-failed' : ''}" data-turn="${t.turnIndex}" x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="${Math.min(2, bw / 2)}"><title>${esc(clip(t.summary || `t${t.turnIndex}`, 140))}</title></rect>`;
    }).join('');
    return `<svg class="mmv-pulse" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="턴별 이야기 무게">${bars}</svg>`;
}

/* ------------------------------------------------------------
 * 흐름
 * ------------------------------------------------------------ */

const LEVEL_LABEL = { arc: '연대기', chunk: '챕터', carried: '이전 채팅' };

/**
 * nodes: [{ id, level, fromTurn, toTurn, text, carried, carriedFrom, marks: [{ title }], open }]
 * 카드의 클래스·data 속성은 기존 요약 카드와 같다 — 편집·삭제·다시 만들기 버튼이 그대로 동작한다.
 */
export function flowHtml(nodes) {
    if (!nodes?.length) return '';
    const items = nodes.map((n) => {
        const rec = parseRecord(n.text);
        const level = n.carried ? 'carried' : n.level;
        const range = n.carried ? esc(n.carriedFrom || '') : `t${n.fromTurn}–t${n.toTurn}`;
        // 구조가 없는 옛 요약은 첫 문장이 제목 노릇을 한다 — 아래에서 되풀이하지 않는다
        const title = rec.when || rec.beats[0] || '';
        const beats = (rec.when ? rec.beats : rec.beats.slice(1)).map(b => `<li>${esc(b)}</li>`).join('');
        const marks = (n.marks || []).map(m => `<span class="mmv-chip mmv-chip--mark" title="전환점">★ ${esc(m.title)}</span>`).join('');
        const shifts = rec.shifts.map(s => `<span class="mmv-chip mmv-chip--shift" title="바뀐 것">${esc(s)}</span>`).join('');
        const open = rec.open.map(s => `<span class="mmv-chip mmv-chip--open" title="남은 것">${esc(s)}</span>`).join('');
        const actions = [
            !n.carried && n.level === 'chunk' ? '<i class="fa-solid fa-rotate memoria-summary-regen" title="다시 만들기"></i>' : '',
            '<i class="fa-solid fa-pen memoria-summary-edit" title="편집"></i>',
            '<i class="fa-solid fa-trash memoria-summary-delete" title="삭제"></i>',
        ].join('');
        return `<li class="mmv-node mmv-node--${level}">
            <span class="mmv-node-dot" aria-hidden="true"></span>
            <details class="mmv-card memoria__summary-card" data-id="${esc(n.id)}" data-level="${esc(n.level)}"${n.open ? ' open' : ''}>
                <summary>
                    <span class="mmv-tag mmv-tag--${level}">${LEVEL_LABEL[level]}</span>
                    <span class="mmv-when">${esc(title)}</span>
                    <small>${range}</small>
                    <span class="memoria__mem-actions">${actions}</span>
                </summary>
                ${beats ? `<ul class="mmv-beats">${beats}</ul>` : ''}
                ${marks || shifts || open ? `<div class="mmv-chips">${marks}${shifts}${open}</div>` : ''}
            </details>
        </li>`;
    }).join('');
    return `<ol class="mmv-flow">${items}</ol>`;
}

/* ------------------------------------------------------------
 * 연표 그래프
 * ------------------------------------------------------------ */

const COL = 38;
const LANE = 34;
const BAND = 26;

/** layout: layoutTimelineGraph()의 결과. dim: 흐리게 보일 줄 id 집합, picked: 고른 줄 id */
export function graphHtml(layout, { dim = new Set(), picked = '' } = {}) {
    const { lanes, points, bands } = layout;
    if (!points.length || !lanes.length) return '';
    const W = points.length * COL + 16;
    const H = BAND + lanes.length * LANE + 6;
    const cx = (x) => 8 + x * COL + COL / 2;
    const cy = (lane) => BAND + lane * LANE + LANE / 2;
    const bandRects = bands.map((b, i) => {
        const x = 8 + b.from * COL;
        const w = (b.to - b.from + 1) * COL;
        const fit = Math.max(2, Math.floor(w / 9));
        return `<g class="mmv-band${i % 2 ? ' is-alt' : ''}"><rect x="${x}" y="0" width="${w}" height="${H}"/><text x="${x + 6}" y="17">${esc(clip(b.label || '·', fit))}</text><title>${esc(b.label)}</title></g>`;
    }).join('');
    const laneLines = lanes.map((_, i) => `<line class="mmv-lane-line" x1="0" x2="${W}" y1="${cy(i)}" y2="${cy(i)}"/>`).join('');
    const marks = points.map((p) => {
        const r = p.row;
        const stars = importanceStars(r.importance);
        const rad = 3.5 + stars * 1.2;
        const cls = `mmv-pt${stars >= 4 ? ' is-major' : ''}${r.star ? ' is-star' : ''}${r.hidden ? ' is-hidden' : ''}${dim.has(r.id) ? ' is-dim' : ''}${picked === r.id ? ' is-picked' : ''}`;
        const link = p.lanes.length > 1 ? `<line class="mmv-pt-link" x1="${cx(p.x)}" x2="${cx(p.x)}" y1="${cy(p.lanes[0])}" y2="${cy(p.lanes[p.lanes.length - 1])}"/>` : '';
        const dots = p.lanes.map(l => `<circle cx="${cx(p.x)}" cy="${cy(l)}" r="${rad}"/>`).join('');
        return `<g class="${cls}" data-id="${esc(r.id)}" tabindex="0" role="button">${link}${dots}<title>${esc(`${r.when ? `${r.when} · ` : ''}${clip(r.text, 120)}`)}</title></g>`;
    }).join('');
    const labels = lanes.map(l => `<div class="mmv-lane-label" title="${esc(l)}">${esc(clip(l, 8))}</div>`).join('');
    return `<div class="mmv-graph">
        <div class="mmv-lane-labels" style="padding-top:${BAND}px">${labels}</div>
        <div class="mmv-graph-scroll"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="연표 그래프">${bandRects}${laneLines}${marks}</svg></div>
    </div>`;
}

/** 고른 사건의 자세한 내용 */
export function detailHtml(row) {
    if (!row) return '<div class="mmv-detail is-empty">점이나 줄을 누르면 여기에 내용이 보여요</div>';
    const meta = [row.when, row.where, row.people.join(', ')].filter(Boolean).map(esc).join(' · ');
    return `<div class="mmv-detail">
        <div class="mmv-detail-head"><span class="mmv-stars">${starsText(row.importance)}</span>${meta ? `<span>${meta}</span>` : ''}${row.mesId >= 0 ? `<button type="button" class="mmv-jump" data-mes="${row.mesId}">#${row.mesId}</button>` : ''}</div>
        <p>${esc(row.text)}</p>
    </div>`;
}

/* ------------------------------------------------------------
 * 표
 * ------------------------------------------------------------ */

export function tableHtml(rows, { sort = 'order', desc = false } = {}) {
    const th = (key, label) => `<th${key ? ` data-sort="${key}" class="is-sortable${sort === key ? ' is-sorted' : ''}"` : ''}>${label}${sort === key ? (desc ? ' ▼' : ' ▲') : ''}</th>`;
    const body = rows.map(r => `<tr data-id="${esc(r.id)}"${r.star ? ' class="is-star"' : ''}>
        <td class="mmv-num">${r.order}</td>
        <td${r.whenCarried ? ' class="is-carried"' : ''}>${esc(r.when)}</td>
        <td${r.whereCarried ? ' class="is-carried"' : ''}>${esc(r.where)}</td>
        <td>${esc(r.people.join(', '))}</td>
        <td class="mmv-text">${esc(r.text)}</td>
        <td class="mmv-stars">${starsText(r.importance)}</td>
        <td>${r.mesId >= 0 ? `<button type="button" class="mmv-jump" data-mes="${r.mesId}">#${r.mesId}</button>` : ''}</td>
    </tr>`).join('');
    return `<div class="mmv-table-wrap"><table class="mmv-table">
        <thead><tr>${th('order', '#')}${th('when', '시간')}${th('where', '장소')}${th('', '인물')}${th('', '내용')}${th('importance', '중요도')}${th('', '')}</tr></thead>
        <tbody>${body || '<tr><td colspan="7" class="mmv-none">맞는 줄이 없어요</td></tr>'}</tbody>
    </table></div>`;
}

/* ------------------------------------------------------------
 * 관계도
 * ------------------------------------------------------------ */

/**
 * bonds: [{ id, from, to, stage, steps }] — steps는 지나온 단계 수
 * 인물을 원 위에 놓고, 관계선을 휘어진 화살표로 잇는다 (A→B와 B→A는 서로 다른 쪽으로 휜다).
 */
export function bondMapSvg(bonds, { picked = '', focus = '' } = {}) {
    const names = [];
    for (const b of bonds || []) for (const n of [b.from, b.to]) if (!names.includes(n)) names.push(n);
    if (names.length < 2) return '';
    const S = 340;
    const c = S / 2;
    const R = names.length === 2 ? 96 : Math.min(124, 70 + names.length * 9);
    const pos = new Map(names.map((n, i) => {
        const a = names.length === 2 ? (i ? 0 : Math.PI) : (-Math.PI / 2 + (i * 2 * Math.PI) / names.length);
        return [n, { x: c + R * Math.cos(a), y: c + R * Math.sin(a) }];
    }));
    const NODE = 20;
    const edges = bonds.map((b) => {
        const p = pos.get(b.from);
        const q = pos.get(b.to);
        const dx = q.x - p.x, dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        // 오른쪽으로 살짝 휘게 — 반대 방향 줄과 겹치지 않는다
        const bend = Math.max(24, Math.min(50, len * 0.3));
        const mx = (p.x + q.x) / 2 - uy * bend;
        const my = (p.y + q.y) / 2 + ux * bend;
        const sx = p.x + ux * NODE, sy = p.y + uy * NODE;
        const ex = q.x - ux * (NODE + 5), ey = q.y - uy * (NODE + 5);
        const off = focus && b.from !== focus && b.to !== focus;
        return `<g class="mmv-edge${picked === b.id ? ' is-picked' : ''}${off ? ' is-dim' : ''}" data-id="${esc(b.id)}" tabindex="0" role="button">
            <path class="mmv-edge-hit" d="M${sx},${sy} Q${mx},${my} ${ex},${ey}"/>
            <path class="mmv-edge-line" d="M${sx},${sy} Q${mx},${my} ${ex},${ey}" marker-end="url(#mmv-arrow)"/>
            <text x="${(sx + 2 * mx + ex) / 4}" y="${(sy + 2 * my + ey) / 4}" text-anchor="middle" dy="-4">${esc(clip(b.stage, 9))}</text>
            <title>${esc(`${b.from} → ${b.to}: ${b.stage}`)}</title>
        </g>`;
    }).join('');
    const nodes = names.map((n) => {
        const p = pos.get(n);
        return `<g class="mmv-person${focus === n ? ' is-picked' : ''}${focus && focus !== n && !bonds.some(b => (b.from === focus && b.to === n) || (b.to === focus && b.from === n)) ? ' is-dim' : ''}" data-name="${esc(n)}" tabindex="0" role="button">
            <circle cx="${p.x}" cy="${p.y}" r="${NODE}"/>
            <text x="${p.x}" y="${p.y}" text-anchor="middle" dy="0.35em">${esc(clip(n, 4))}</text>
            <title>${esc(n)}</title>
        </g>`;
    }).join('');
    return `<svg class="mmv-map" viewBox="0 0 ${S} ${S}" role="img" aria-label="관계도">
        <defs><marker id="mmv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z"/></marker></defs>
        ${edges}${nodes}
    </svg>`;
}

/** 관계선 하나가 지나온 길 — 계단처럼 */
export function bondStepsHtml(bond) {
    if (!bond) return '<div class="mmv-detail is-empty">화살표를 누르면 지나온 길이 보여요</div>';
    const steps = [];
    for (const e of bond.log || []) if (steps[steps.length - 1]?.stage !== e.stage) steps.push(e);
    const now = bond.log[bond.log.length - 1] || {};
    const stairs = steps.map((s, i) => `<li class="${i === steps.length - 1 ? 'is-now' : ''}" style="--mmv-step:${i}"><b>${esc(s.stage)}</b>${s.basis ? `<small>${esc(s.basis)}</small>` : ''}</li>`).join('');
    const extra = [now.calls ? `<span class="mmv-chip">부르는 말 · ${esc(now.calls)}</span>` : '', now.unsaid ? `<span class="mmv-chip mmv-chip--open">말하지 못한 것 · ${esc(now.unsaid)}</span>` : ''].join('');
    return `<div class="mmv-detail">
        <div class="mmv-detail-head"><b>${esc(bond.from)} → ${esc(bond.to)}</b></div>
        <ol class="mmv-stairs">${stairs}</ol>
        ${extra ? `<div class="mmv-chips">${extra}</div>` : ''}
    </div>`;
}

/* ------------------------------------------------------------
 * 상태창 기록
 * ------------------------------------------------------------ */

/** history: [{ mesId, when, place, weather }] — 최신이 위 */
export function statusListHtml(history) {
    if (!history?.length) return '<div class="mmv-detail is-empty">읽은 상태창이 아직 없어요</div>';
    return `<ol class="mmv-status">${history.map(h => `<li>
        <button type="button" class="mmv-jump" data-mes="${h.mesId}">#${h.mesId}</button>
        <span class="mmv-status-when">${esc(h.when || '—')}</span>
        <span>${esc([h.place, h.weather].filter(Boolean).join(' · '))}</span>
    </li>`).join('')}</ol>`;
}
