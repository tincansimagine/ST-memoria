/**
 * Memoria 이야기 보기 — 서고를 그림으로 그린다. 문자열(HTML·SVG)만 만들고 화면은 건드리지 않는다.
 * 좁은 화면(휴대폰)을 기준으로 짠다: 모든 그림은 폭에 맞춰 줄어들고, 읽는 방향은 세로다.
 *
 * - 지금: 장면·이야기 속 시간·숫자 몇 개
 * - 맥박: 턴마다의 무게를 막대로 — 이야기가 어디서 뛰었는지 한눈에
 * - 흐름: 요약을 줄기 위의 카드로 — 언제·무슨 일·무엇이 바뀌었나·무엇이 남았나
 * - 연표: 위에서 아래로 흐르는 노선도 — 줄은 인물(장소), 정거장은 사건
 * - 관계: 인물은 점, 관계선은 화살표, 감정선은 계단
 * - 표: 정렬·검색·내보내기
 */

import { importanceStars, parseRecord } from './scene-engine.mjs';

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const clip = (s, n) => { const t = String(s ?? ''); return [...t].length > n ? `${[...t].slice(0, n - 1).join('')}…` : t; };
const starsText = (v) => '★'.repeat(importanceStars(v));

/* ------------------------------------------------------------
 * 지금
 * ------------------------------------------------------------ */

/** model: { place, when, present: [이름], tiles: [{ value, label }] } */
export function heroHtml(model) {
    const present = (model.present || []).slice(0, 6).map(n => `<span class="mmv-who">${esc(n)}</span>`).join('');
    const tiles = (model.tiles || []).map(t => `<div class="mmv-tile"><b>${esc(t.value)}</b><span>${esc(t.label)}</span></div>`).join('');
    return `<div class="mmv-hero">
        <div class="mmv-hero-now">
            <span class="mmv-hero-label">지금</span>
            <strong>${esc(model.place || '장면이 아직 기록되지 않았어요')}</strong>
            ${model.when ? `<span class="mmv-hero-when">${esc(model.when)}</span>` : ''}
            ${present ? `<div class="mmv-hero-who">${present}</div>` : ''}
        </div>
        <div class="mmv-tiles">${tiles}</div>
    </div>`;
}

/* ------------------------------------------------------------
 * 맥박
 * ------------------------------------------------------------ */

/**
 * turns: [{ turnIndex, importance, summary, failed }]
 * spans: [{ fromTurn, toTurn, level }] — 요약이 덮은 구간 (구간마다 색을 번갈아 칠한다)
 * marks: 전환점이 있는 턴 번호들
 * 그림은 언제나 폭을 꽉 채운다. 턴이 많으면 이웃한 턴을 한 막대로 묶어(그 안의 가장 무거운 턴) 막대 수를 줄인다.
 */
export function pulseSvg(turns, { spans = [], marks = [], maxBars = 90 } = {}) {
    const list = [...(turns || [])].sort((a, b) => a.turnIndex - b.turnIndex);
    if (!list.length) return '';
    const per = Math.max(1, Math.ceil(list.length / maxBars));
    const groups = [];
    for (let i = 0; i < list.length; i += per) {
        const part = list.slice(i, i + per);
        groups.push(part.reduce((best, t) => ((t.importance ?? 0.4) > (best.importance ?? 0.4) ? t : best), part[0]));
        groups[groups.length - 1] = { ...groups[groups.length - 1], members: part.map(t => t.turnIndex) };
    }
    const W = 1000;
    const H = 64;
    const top = 14;
    const slot = W / groups.length;
    const bw = Math.min(26, slot * 0.72);
    const spanOf = (n) => spans.findIndex(s => n >= s.fromTurn && n <= s.toTurn);
    const markSet = new Set(marks);
    const bars = groups.map((t, i) => {
        const v = Math.max(0.08, Math.min(1, t.importance ?? 0.4));
        const h = Math.round(6 + v * (H - top - 6));
        const x = i * slot + (slot - bw) / 2;
        const si = spanOf(t.turnIndex);
        const tone = si < 0 ? 'raw' : spans[si].level === 'arc' ? 'arc' : (si % 2 ? 'b' : 'a');
        const star = t.members.some(n => markSet.has(n)) ? `<rect class="mmv-pulse-star" x="${x}" y="2" width="${bw}" height="5" rx="2"/>` : '';
        // 손가락으로 누르기 쉽게, 막대가 놓인 칸 전체가 눌린다
        return `<g class="mmv-pulse-bar mmv-pulse-bar--${tone}${v >= 0.75 ? ' is-peak' : ''}${t.failed ? ' is-failed' : ''}" data-turn="${t.turnIndex}">
            <rect class="mmv-pulse-hit" x="${i * slot}" y="0" width="${slot}" height="${H}"/>${star}
            <rect class="mmv-pulse-fill" x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="3"/>
            <title>${esc(clip(t.summary || `t${t.turnIndex}`, 140))}</title>
        </g>`;
    }).join('');
    return `<svg class="mmv-pulse" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="턴별 이야기 무게">${bars}</svg>`;
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
                    <span class="mmv-card-top"><span class="mmv-tag mmv-tag--${level}">${LEVEL_LABEL[level]}</span><small>${range}</small><span class="memoria__mem-actions">${actions}</span></span>
                    <span class="mmv-when">${esc(title)}</span>
                </summary>
                ${beats ? `<ul class="mmv-beats">${beats}</ul>` : ''}
                ${marks || shifts || open ? `<div class="mmv-chips">${marks}${shifts}${open}</div>` : ''}
            </details>
        </li>`;
    }).join('');
    return `<ol class="mmv-flow">${items}</ol>`;
}

/* ------------------------------------------------------------
 * 연표 — 위에서 아래로 흐르는 노선도
 * ------------------------------------------------------------ */

/**
 * layout: layoutTimelineGraph()의 결과 (lanes, points, bands).
 * 줄(인물·장소)마다 색이 있고, 사건은 그 줄 위의 정거장이다. 여러 인물이 함께한 사건은 가로로 이어진다.
 * 세로로 읽으므로 휴대폰에서 그냥 스크롤하면 된다. dim: 검색에 안 맞아 흐리게 보일 id, open: 펼친 id
 */
export function railHtml(layout, { dim = new Set(), open = '' } = {}) {
    const { lanes, points, bands } = layout;
    if (!points.length || !lanes.length) return '';
    const n = lanes.length;
    const legend = lanes.map((l, i) => `<span class="mmv-legend" style="--mmv-lane:${i}"><i></i>${esc(clip(l, 10))}</span>`).join('');
    const bandAt = new Map(bands.map(b => [b.from, b.label]));
    const rows = points.map((p) => {
        const r = p.row;
        const stars = importanceStars(r.importance);
        const first = p.lanes[0];
        const last = p.lanes[p.lanes.length - 1];
        const cells = lanes.map((_, i) => `<span class="mmv-cell${p.lanes.includes(i) ? ' is-on' : ''}" style="--mmv-lane:${i}"></span>`).join('');
        const link = last > first ? `<span class="mmv-link" style="--mmv-from:${first};--mmv-span:${last - first}"></span>` : '';
        const cls = `mmv-stop${stars >= 4 ? ' is-major' : ''}${r.star ? ' is-star' : ''}${r.hidden ? ' is-hidden' : ''}${dim.has(r.id) ? ' is-dim' : ''}${open === r.id ? ' is-open' : ''}`;
        const meta = [r.when, r.where, r.people.join(', ')].filter(Boolean).map(esc).join(' · ');
        const band = bandAt.has(p.x) && bandAt.get(p.x) ? `<li class="mmv-day"><span class="mmv-rail" style="--mmv-lanes:${n}">${lanes.map((_, i) => `<span class="mmv-cell" style="--mmv-lane:${i}"></span>`).join('')}</span><b>${esc(bandAt.get(p.x))}</b></li>` : '';
        return `${band}<li class="${cls}" data-id="${esc(r.id)}" tabindex="0" role="button">
            <span class="mmv-rail" style="--mmv-lanes:${n}">${cells}${link}</span>
            <span class="mmv-stop-body">
                <span class="mmv-stop-text">${r.star ? '★ ' : ''}${esc(r.text)}</span>
                <span class="mmv-stop-meta">${meta ? `<span>${meta}</span>` : ''}<span class="mmv-stars">${starsText(r.importance)}</span>${r.mesId >= 0 ? `<button type="button" class="mmv-jump" data-mes="${r.mesId}">#${r.mesId}</button>` : ''}</span>
            </span>
        </li>`;
    }).join('');
    return `<div class="mmv-legends">${legend}</div><ol class="mmv-line" style="--mmv-lanes:${n}">${rows}</ol>`;
}

/* ------------------------------------------------------------
 * 표
 * ------------------------------------------------------------ */

export function tableHtml(rows, { sort = 'order', desc = false } = {}) {
    const th = (key, label) => `<th${key ? ` data-sort="${key}" class="is-sortable${sort === key ? ' is-sorted' : ''}"` : ''}>${label}${sort === key ? (desc ? ' ▼' : ' ▲') : ''}</th>`;
    const body = rows.map(r => `<tr data-id="${esc(r.id)}"${r.star ? ' class="is-star"' : ''}>
        <td class="mmv-num">${r.order}</td>
        <td class="mmv-when-cell"><span${r.whenCarried ? ' class="is-carried"' : ''}>${esc(r.when)}</span><small${r.whereCarried ? ' class="is-carried"' : ''}>${esc(r.where)}</small></td>
        <td class="mmv-text"><span>${esc(r.text)}</span>${r.people.length ? `<small>${esc(r.people.join(', '))}</small>` : ''}</td>
        <td class="mmv-stars-cell"><span class="mmv-stars">${'★'.repeat(importanceStars(r.importance))}</span>${r.mesId >= 0 ? `<button type="button" class="mmv-jump" data-mes="${r.mesId}">#${r.mesId}</button>` : ''}</td>
    </tr>`).join('');
    return `<div class="mmv-table-wrap"><table class="mmv-table">
        <thead><tr>${th('order', '#')}${th('when', '언제 · 어디')}${th('', '무슨 일')}${th('importance', '★')}</tr></thead>
        <tbody>${body || '<tr><td colspan="4" class="mmv-none">맞는 줄이 없어요</td></tr>'}</tbody>
    </table></div>`;
}

/* ------------------------------------------------------------
 * 관계도
 * ------------------------------------------------------------ */

/**
 * bonds: [{ id, from, to, stage, steps }] — steps는 지나온 단계 수
 * 인물을 원 위에 놓고, 관계선을 휘어진 화살표로 잇는다 (A→B와 B→A는 서로 다른 쪽으로 휜다).
 */
let mapSeq = 0;

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
    // 화살촉 id는 그림마다 따로 — 숨겨진 탭의 그림에 있는 것을 가리키면 화살촉이 그려지지 않는다
    const arrowId = `mmv-arrow-${++mapSeq}`;
    // 그림을 인물들이 놓인 만큼만 잡는다 (세 명일 때 아래가 휑하지 않게)
    const ys = [...pos.values()].map(p => p.y);
    const xs = [...pos.values()].map(p => p.x);
    const pad = NODE + 18;
    const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];
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
            <path class="mmv-edge-line" d="M${sx},${sy} Q${mx},${my} ${ex},${ey}" marker-end="url(#${arrowId})"/>
            ${picked === b.id || bonds.length <= 3 ? `<text x="${(sx + 2 * mx + ex) / 4}" y="${(sy + 2 * my + ey) / 4}" text-anchor="middle" dy="-4">${esc(clip(b.stage, 9))}</text>` : ''}
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
    return `<svg class="mmv-map" viewBox="${box.map(n => Math.round(n)).join(' ')}" style="max-width:${Math.round(box[2])}px" role="img" aria-label="관계도">
        <defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z"/></marker></defs>
        ${edges}${nodes}
    </svg>`;
}

/**
 * 관계선 카드들 — 감정선이 지나온 길을 계단으로.
 * bonds: [{ id, from, to, log }], picked: 강조할 id, focus: 이 인물이 얽힌 것만
 */
export function bondCardsHtml(bonds, { picked = '', focus = '' } = {}) {
    const list = (bonds || []).filter(b => !focus || b.from === focus || b.to === focus);
    if (!list.length) return '<div class="mmv-detail is-empty">관계선이 아직 없어요</div>';
    return `<div class="mmv-bonds">${list.map((bond) => {
        const steps = [];
        for (const e of bond.log || []) if (steps[steps.length - 1]?.stage !== e.stage) steps.push(e);
        const now = bond.log[bond.log.length - 1] || {};
        const stairs = steps.map((st, i) => `<li class="${i === steps.length - 1 ? 'is-now' : ''}" style="--mmv-step:${i}"><b>${esc(st.stage)}</b>${st.basis ? `<small>${esc(st.basis)}</small>` : ''}</li>`).join('');
        const extra = [now.calls ? `<span class="mmv-chip">부르는 말 · ${esc(now.calls)}</span>` : '', now.unsaid ? `<span class="mmv-chip mmv-chip--open">말하지 못한 것 · ${esc(now.unsaid)}</span>` : ''].join('');
        return `<section class="mmv-bond${picked === bond.id ? ' is-picked' : ''}" data-id="${esc(bond.id)}">
            <h5>${esc(bond.from)} <span class="mmv-arrow">→</span> ${esc(bond.to)}</h5>
            <ol class="mmv-stairs">${stairs}</ol>
            ${extra ? `<div class="mmv-chips">${extra}</div>` : ''}
        </section>`;
    }).join('')}</div>`;
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
