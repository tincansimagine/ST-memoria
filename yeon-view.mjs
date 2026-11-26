// 인연 탭 — 관계선 위에 얹은 갈래(세 개까지) · 한마디를 관계도와 인연 카드로 보고, 사람마다의 마음 · 전환점을 한 탭에 (글을 짓기만 한다: 화면 · 저장소에 손대지 않는다)
// 인연 읽기와 전환점은 턴을 기록할 때 함께 받는다 (호출은 늘지 않는다). 「지난 기록 되짚기」만 따로 모델을 부른다 (요약 글만 읽는다)
import { GROUPS, TIE_GROUPS, TYPES_MAX, HEARTFELT, WAYS, layoutTies, rankPeople, mainGroup, sameType, cleanWord, OWN_TYPE_UNITS } from './ties-engine.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameKey = (s) => String(s || '').toLowerCase().replace(/[\s._\-'"`]+/g, '');
const fold = (s) => String(s || '').toLowerCase().replace(/[\s·・.,/\-_]+/g, '');

export const GROUP_KO = { affection: '애정', family: '가족', friendship: '우정', work: '일·학교', conflict: '대립', fealty: '위계·맹세', debt: '은혜·빚', secret: '비밀·공모', other: '그 밖' };
export const TYPE_KO = {
    lover: '연인', spouse: '부부', engaged: '약혼', flirt: '썸', pining: '짝사랑', first_love: '첫사랑', ex: '옛 연인', arranged: '정략', obsession: '집착', forbidden: '금지된 사이',
    parent_child: '부모·자식', siblings: '형제자매', twins: '쌍둥이', relatives: '친척', adoptive: '양부모·양자', step_family: '의붓가족', sworn_siblings: '의형제·의남매',
    friend: '친구', best_friend: '단짝', childhood_friend: '소꿉친구', alumni: '동창', comrade: '전우', neighbor: '이웃',
    colleague: '동료', boss: '상사·부하', senior_junior: '선후배', mentor: '스승·제자', classmate: '동급생', employer: '고용', deal: '거래', commission: '의뢰',
    rival: '라이벌', nemesis: '숙적', enemy: '원수', wary: '경계', revenge: '복수', betrayal: '배신',
    master_servant: '주종', lord_knight: '주군·기사', guardian: '보호자', contract: '계약', loyalty: '충성',
    benefactor: '은인', saved_life: '생명의 은인', indebted: '빚진 사이',
    accomplice: '공범', shared_secret: '비밀을 나눈 사이', using: '이용', alliance: '협력',
    companion: '동행', first_meeting: '첫 만남', tangled: '얽힘',
};
export const WAY_KO = { closer: '가까워짐', apart: '멀어짐', flip: '뒤집힘', heart: '마음', lot: '처지', grow: '자람' };
export const groupName = (g) => GROUP_KO[g] || g;
export const typeName = (x) => (!x?.type ? groupName(x?.group) : x.custom ? x.type : (TYPE_KO[x.type] || x.type));
const wayName = (w) => WAY_KO[w] || w;

/** 전환점 갈래의 작은 그림 (16칸) */
const WAY_D = {
    closer: 'M2 8h4.5M4.5 5.5 7 8l-2.5 2.5M14 8H9.5M11.5 5.5 9 8l2.5 2.5', apart: 'M6.5 8H2M4.5 5.5 2 8l2.5 2.5M9.5 8H14M11.5 5.5 14 8l-2.5 2.5',
    flip: 'M3 5.5h9l-2.2-2.2M13 10.5H4l2.2 2.2', heart: 'M8 13.2S3 10.2 3 6.6A2.5 2.5 0 0 1 8 5.4a2.5 2.5 0 0 1 5 1.2c0 3.6-5 6.6-5 6.6z',
    lot: 'M3 13.5V7.2L8 3l5 4.2v6.3zM6.4 13.5V9.6h3.2v3.9', grow: 'M8 14V7.5M8 9.4C5.2 9.4 4 7.6 4 5.4c2.8 0 4 1.8 4 4zM8 8.2c0-2.6 1.4-4.2 4-4.2 0 2.6-1.4 4.2-4 4.2z',
};
const wayIco = (way) => `<svg class="mm-yn-wi" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${WAY_D[way] || WAY_D.heart}"/></svg>`;
const PEN = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
const BIN = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';

/** 이 탭의 보기 상태 (탭을 옮기거나 다시 그려도 남는다) */
export const yeonView = () => ({ map: { focus: '', pick: '', zoom: 1 }, way: '', who: '', more: 30, open: {} });
const ZOOM_MIN = 0.6, ZOOM_MAX = 3;
export const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));

/** 갈래 칩 몇 개 (빛깔은 그 무리) */
export function typeChipsHtml(types, main = true) {
    if (!types?.length) return '';
    return `<span class="mm-yn-types">${types.map((x, i) => `<span class="mm-yn-type mm-tk-${esc(x.group)}${i === 0 && main && types.length > 1 ? ' main' : ''}${x.custom ? ' own' : ''}" title="${esc(`${groupName(x.group)} · ${typeName(x)}`)}">${esc(typeName(x))}</span>`).join('')}</span>`;
}

/** 관계도 — 이름 상자와 색 선, 선 위의 짧은 인연 한마디(없으면 대표 갈래). 선의 빛깔은 대표 갈래의 무리 */
export function tieMapHtml(edges, v, { narrow = false } = {}) {
    const people = rankPeople(edges);
    if (v.focus && !people.includes(v.focus)) v.focus = '';
    const L = layoutTies(edges, { focus: v.focus, limit: narrow ? 9 : 14, width: narrow ? 340 : 480 }), [bx, by, bw, bh] = L.box, z = clampZoom(v.zoom || 1);
    if (v.pick && !L.lines.some(l => l.id === v.pick)) v.pick = '';
    const vw = bw / z, vh = bh / z, viewBox = `${Math.round(bx + (bw - vw) / 2)} ${Math.round(by + (bh - vh) / 2)} ${Math.round(vw)} ${Math.round(vh)}`;
    const chips = people.length > 2 ? `<div class="mm-tm-chips" role="group" aria-label="인물 고르기">${v.focus ? `<button type="button" class="mm-ti-chip all" data-yn-focus="${esc(v.focus)}">전체 보기</button>` : ''}${people.map(n => `<button type="button" class="mm-ti-chip${v.focus === n ? ' on' : ''}" aria-pressed="${v.focus === n}" data-yn-focus="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : '';
    const lines = L.lines.map(l => `<g class="mm-tm-edge mm-tk-${esc(l.kind || 'none')}${v.pick === l.id ? ' on' : ''}" data-yn-pick="${esc(l.id)}"><path class="mm-tm-line" d="${l.d}"/><path class="mm-tm-head" d="${l.ah}"/><path class="mm-tm-hit" d="${l.d}"/><text class="mm-tm-label" x="${l.lx}" y="${l.ly}" text-anchor="middle" dominant-baseline="central">${esc(l.label)}<title>${esc(`${l.from} → ${l.to}: ${l.full}`)}</title></text></g>`).join('');
    const nodes = L.nodes.map(n => `<g class="mm-tm-node${n.focus ? ' focus' : ''}"${people.length > 2 ? ` data-yn-focus="${esc(n.name)}"` : ''}><rect x="${n.x - n.w / 2}" y="${n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="3"/><text x="${n.x}" y="${n.y}" text-anchor="middle" dominant-baseline="central">${esc(n.text)}<title>${esc(n.name)}</title></text></g>`).join('');
    const picked = L.lines.find(l => l.id === v.pick);
    const note = v.focus ? `${esc(v.focus)}의 인연만 보는 중` : L.hidden > 0 ? `인연이 많은 사람만 그렸어요 — 나머지 ${L.hidden}명은 이름을 누르면 보여요.` : '';
    return `<div class="mm-tm">${chips}
        <div class="mm-tm-stage"><svg class="mm-tm-svg" viewBox="${viewBox}" style="aspect-ratio:${bw} / ${Math.max(60, bh)}" role="img" aria-label="관계도">${lines}${nodes}</svg></div>
        <div class="mm-tm-bar"><span class="mm-tm-note">${note}</span><span class="mm-tm-zoom" role="group" aria-label="크기">
            <button type="button" class="mm-ti-btn" data-yn-zoom="out" title="작게" aria-label="작게"${z <= ZOOM_MIN ? ' disabled' : ''}>−</button>
            <button type="button" class="mm-ti-btn wide" data-yn-zoom="fit">맞춤</button>
            <button type="button" class="mm-ti-btn" data-yn-zoom="in" title="크게" aria-label="크게"${z >= ZOOM_MAX ? ' disabled' : ''}>+</button></span></div>
        ${picked ? `<p class="mm-tm-picked mm-tk-${esc(picked.kind || 'none')}"><i class="mm-ti-swatch"></i><span><b>${esc(picked.from)}</b> → <b>${esc(picked.to)}</b></span><em>${esc(picked.full)}</em></p>` : ''}
    </div>`;
}

/**
 * 인연 탭 전체.
 * d: { bonds: [{ id, from, to, stage, read, hand }], pivots: [{ id, way, who, with, was, now, why, turn, scan, range: [a, b] | null, day }],
 *      v: yeonView(), plan: { rows, calls }, host: 무대 카드 이름 | '', tieNotes, between, narrow }
 */
export function yeonHtml(d) {
    const { bonds, pivots, v, plan, host, narrow } = d;
    const retraceRow = plan.rows ? `<div class="mm-yn-retrace"><div><b>지난 기록 되짚기</b><p>이 기능이 생기기 전의 기록이 ${plan.rows}묶음 있어요. 되짚으면 그 요약 글에서 인연의 갈래 · 한마디와 전환점을 읽어 와요. 대화 원문은 펼치지 않고, 모델은 많아야 ${plan.calls}번 불러요.</p></div>
        <div class="menu_button" id="memoria_yn_retrace" title="요약 글을 다시 읽어 인연과 전환점을 채워요 (모델 호출)"><i class="fa-solid fa-rotate"></i><span>되짚기</span></div></div>` : '';
    const stageNote = host ? `<p class="mm-yn-hint">「${esc(host)}」은(는) 무대 카드라서 관계도에 그리지 않아요. <button type="button" class="mm-link" data-yn-go="config">설정에서 바꾸기</button></p>` : '';
    const sec = (title, desc, body, extra = '') => `<div class="memoria__section mm-yn-sec"${extra}><div class="memoria__section-head"><div><h4>${title}</h4>${desc ? `<p>${desc}</p>` : ''}</div></div>${body}</div>`;
    const none = (text) => `<div class="memoria__empty">${text}</div>`;
    const where = (p) => `<span class="mm-yn-where">${p.day ? `<span>${esc(p.day)}</span>` : ''}${p.range ? `<button type="button" class="mmv-jump mm-yn-jump" data-mes="${p.range[0]}" title="그 장면으로 가기">${p.range[0] === p.range[1] ? `#${p.range[0]}` : `#${p.range[0]}~#${p.range[1]}`}</button>` : `<span>t${p.turn}</span>`}</span>`;
    const change = (p) => `<span class="mm-yn-change">${p.was ? `<s>${esc(p.was)}</s><i aria-hidden="true">→</i>` : ''}<em>${esc(p.now)}</em></span>`;
    const way = (w) => `<span class="mm-yn-way" data-way="${esc(w)}">${wayIco(w)}${wayName(w)}</span>`;

    const optSec = sec('함께 적기', '', `
        <label class="memoria__toggle-row" for="memoria_yn_tienotes"><input type="checkbox" id="memoria_yn_tienotes"${d.tieNotes ? ' checked' : ''}><span><strong>인연 · 전환점도 함께 적기</strong><small>턴을 기록하는 호출에 얹어 받아요 — 호출은 늘지 않아요.</small></span></label>
        <label class="memoria__toggle-row" for="memoria_yn_between"><input type="checkbox" id="memoria_yn_between"${d.between ? ' checked' : ''}><span><strong>장면에 함께 있는 사람들의 지금 사이를 장부에 싣기</strong><small>갈래 · 한마디와 가장 늦은 전환점을 「지금」 쪽에 몇 줄로 실어요. 모델 호출은 없어요.</small></span></label>
        ${retraceRow}${stageNote}`);

    if (!bonds.length && !pivots.length) return `<div class="mm-yn">${none('아직 그릴 인연이 없어요. 사이가 움직이는 장면이 기록되면 관계도에 하나씩 그려져요.')}${optSec}</div>`;

    // ── 관계도와 인연 카드 (두 사람마다 한 장 — 양쪽에서 본 읽기를 함께). 관계도에서 사람을 고르면 그 사람의 카드만
    const edges = bonds.map(b => ({ id: b.id, from: b.from, to: b.to, label: b.read.word || (b.read.types?.[0] ? typeName(b.read.types[0]) : b.stage), kind: mainGroup(b.read) }));
    const focus = v.map.focus;
    const pairs = new Map();
    for (const bd of bonds) {
        const f = bd.from, to = bd.to, first = focus === to ? to : focus === f ? f : f < to ? f : to, k = [f, to].sort().join('\u0001');
        let x = pairs.get(k);
        if (!x) { x = { a: first, b: first === f ? to : f }; pairs.set(k, x); }
        if (f === x.a) x.ab = bd; else x.ba = bd;
    }
    const rank = (x) => { const g = mainGroup(x.ab?.read) || mainGroup(x.ba?.read), i = GROUPS.indexOf(g); return i < 0 ? 99 : i; }; // 무리 차례 (애정 → 가족 → … → 그 밖 → 아직 읽지 않음)
    const cards = [...pairs.values()].filter(x => !focus || x.a === focus || x.b === focus).sort((x, y) => rank(x) - rank(y) || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
    const lastBetween = (a, b) => [...pivots].reverse().find(p => p.with && ((p.who === a && p.with === b) || (p.who === b && p.with === a)));
    const readRow = (b, from, to) => {
        if (!b) return '';
        const r = b.read;
        // 한 방향 = 두 줄: 위는 누가 → 누구에게(작게)와 고치기, 아래는 한마디와 갈래 칩을 한 줄에 이어서
        return `<div class="mm-yn-read"><div class="top"><span class="dir"><b>${esc(from)}</b><i aria-hidden="true">→</i><b>${esc(to)}</b></span>
            <button type="button" class="mm-yn-btn ghost" data-yn-edit="${esc(b.id)}" title="인연 고치기" aria-label="인연 고치기 — ${esc(from)} → ${esc(to)}">${PEN}</button></div>
            <div class="body">${r.word ? `<em class="word">${esc(r.word)}</em>` : '<em class="word none">아직 읽지 않음</em>'}${r.types?.length ? typeChipsHtml(r.types) : '<span class="mm-yn-tag">갈래 없음</span>'}${b.hand ? '<span class="mm-yn-tag">직접 고침</span>' : ''}</div></div>`;
    };
    const used = [...new Set(edges.map(e => e.kind))].sort((x, y) => GROUPS.indexOf(x) - GROUPS.indexOf(y));
    const nameBtn = (n) => `<button type="button" class="mm-yn-who" data-yn-focus="${esc(n)}" title="${focus === n ? '전체 보기' : `${esc(n)}의 인연만 보기`}"><b>${esc(n)}</b></button>`;
    const mapSec = bonds.length ? sec('관계도', '선의 빛깔은 대표 갈래의 무리, 선 위의 말은 인연 한마디예요(없으면 대표 갈래). 두 사람의 마음이 다르면 두 선이 따로 그려져요. 선이나 말을 누르면 전체가 보이고, 인물을 누르면 그 사람의 인연만 보여요.', `
        ${tieMapHtml(edges, v.map, { narrow })}
        ${used.length ? `<div class="mm-ti-legend">${used.map(k => `<span class="mm-tk-${esc(k || 'none')}"><i class="mm-ti-swatch"></i>${k ? groupName(k) : '갈래 없음'}</span>`).join('')}</div>` : ''}
        <div class="mm-yn-focus"><h4><span>${focus ? `${esc(focus)}의 인연` : '모든 인연'}</span><b>${cards.length}</b></h4></div>
        ${cards.length ? `<div class="mm-yn-cards">${cards.map(x => {
            const last = lastBetween(x.a, x.b), stage = (x.ab || x.ba)?.stage || '', g = mainGroup(x.ab?.read) || mainGroup(x.ba?.read);
            return `<article class="mm-yn-card mm-tk-${esc(g || 'none')}"><header>${nameBtn(x.a)}<i class="mm-yn-link" aria-hidden="true"></i>${nameBtn(x.b)}</header>
                ${stage ? `<p class="mm-yn-stage" title="관계선의 지금 단계">${esc(stage)}</p>` : ''}
                ${readRow(x.ab, x.a, x.b)}${readRow(x.ba, x.b, x.a)}
                ${last ? `<footer><div class="meta">${way(last.way)}${where(last)}</div>${change(last)}</footer>` : ''}</article>`;
        }).join('')}</div>` : none('이 사람과 이어진 인연이 아직 없어요.')}`) : '';

    // ── 마음: 사람마다 지금 마음 한 줄과 지나온 마음, 누르면 까닭이 펼쳐진다
    const byWho = new Map();
    for (const p of pivots) if (HEARTFELT.has(p.way)) { if (!byWho.has(p.who)) byWho.set(p.who, []); byWho.get(p.who).push(p); }
    const hearts = [...byWho.entries()].map(([name, rows]) => ({ name, rows: [...rows].sort((a, b) => b.turn - a.turn) })).sort((a, b) => b.rows[0].turn - a.rows[0].turn);
    const heartSec = sec('마음', '사람마다 마음이 어떻게 이어져 왔는지 한 줄로 — 오른쪽 끝의 굵은 말이 지금 마음이에요. 누르면 마음이 바뀐 까닭이 펼쳐져요.', hearts.length ? `<div class="mm-yn-hearts">${hearts.map(h => {
        const cur = h.rows[0], open = !!v.open[h.name], same = h.rows.filter(p => nameKey(p.with || '') === nameKey(cur.with || '')), trail = same.slice(0, 4).reverse();
        return `<div class="mm-yn-heart${open ? ' open' : ''}"><button type="button" class="mm-yn-hrow" aria-expanded="${open}" data-yn-heart="${esc(h.name)}"><b>${esc(h.name)}</b>
            <span class="trail" title="마음이 바뀐 것 ${h.rows.length}번">${cur.with ? `<i class="to">${esc(cur.with)}에게</i>` : ''}${same.length > trail.length ? '<i class="more">…</i>' : ''}${trail.map((p, i) => `<span class="${i === trail.length - 1 ? 'cur' : ''}">${i ? '<i aria-hidden="true">→</i>' : ''}${esc(p.now)}</span>`).join('')}</span>
            <span class="chev" aria-hidden="true"></span></button>
            ${open ? `<ol class="mm-yn-why">${h.rows.map(p => `<li><p>${way(p.way)}${p.with ? `<i>${esc(p.with)}에게</i>` : ''}${change(p)}</p><small>${p.why ? `<span>${esc(p.why)}</span>` : ''}${where(p)}</small></li>`).join('')}</ol>` : ''}</div>`;
    }).join('')}</div>` : none('아직 적힌 마음의 전환점이 없어요.'));

    // ── 전환점: 갈래 · 사람으로 거른 시간의 줄
    const people = [...new Set(pivots.flatMap(p => [p.who, p.with || '']).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (v.who && !people.includes(v.who)) v.who = '';
    const rows = pivots.filter(p => (!v.who || p.who === v.who || p.with === v.who) && (!v.way || p.way === v.way)).sort((a, b) => b.turn - a.turn);
    const wayBtn = (w) => `<button type="button" class="mm-yn-wf${v.way === w ? ' on' : ''}" data-way="${w}" data-yn-way="${w}" aria-pressed="${v.way === w}">${wayIco(w)}<span>${wayName(w)}</span></button>`;
    const turnSec = sec('전환점', '사이가 가까워지고 멀어지고 뒤집힌 순간, 한 사람의 마음 · 처지가 바뀌고 자란 순간을 최근 것부터. #번호를 누르면 그 장면으로 가요.', pivots.length ? `
        <div class="mm-yn-filter"><div class="mm-yn-ways" role="group" aria-label="갈래로 거르기">
            <span class="grp"><small>사이</small>${['closer', 'apart', 'flip'].map(wayBtn).join('')}</span>
            <span class="grp"><small>한 사람</small>${['heart', 'lot', 'grow'].map(wayBtn).join('')}</span></div>
            <select class="text_pole mm-yn-whof" aria-label="사람으로 거르기"><option value="">모든 사람</option>${people.map(n => `<option value="${esc(n)}"${v.who === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        ${rows.length ? `<div class="mm-yn-line">${rows.slice(0, v.more).map(p => `<div class="mm-yn-turn" data-way="${esc(p.way)}"><span class="mm-yn-node" aria-hidden="true"></span><div class="mm-yn-tbody">
            <div class="mm-yn-ttop">${way(p.way)}${where(p)}${p.scan ? '<span class="mm-yn-tag">되짚어 찾음</span>' : ''}<button type="button" class="mm-yn-btn del" data-yn-del="${esc(p.id)}" title="지우기" aria-label="지우기">${BIN}</button></div>
            <p class="mm-yn-tpair"><b>${esc(p.who)}</b>${p.with ? `<i>${esc(p.with)}에게</i>` : ''}</p><p>${change(p)}</p>${p.why ? `<small>${esc(p.why)}</small>` : ''}</div></div>`).join('')}</div>` : none('고른 갈래 · 사람에 맞는 전환점이 없어요.')}
        ${rows.length > v.more ? `<div class="menu_button mm-yn-more" data-yn-more="1">${rows.length - v.more}개 더 보기</div>` : ''}`
        : none(d.tieNotes ? '아직 적힌 전환점이 없어요. 새 답변을 기록할 때부터 함께 적혀요.' : '인연 · 전환점 적기가 꺼져 있어요 — 아래 「함께 적기」에서 켤 수 있어요.'));

    return `<div class="mm-yn">${mapSec}${heartSec}${turnSec}${optSec}</div>`;
}

/** 인연 고치기 창의 몸통 — 한마디와 갈래(세 개까지 · 첫 번째가 대표). 최근 고른 것이 먼저, 찾기 칸, 무리마다 묶은 칩, 목록에 없으면 「직접 쓰기」 */
export function tiePickerHtml(draft, { recent = [], query = '', ownGroup = 'other', full = false } = {}) {
    const has = (x) => draft.types.some(y => sameType(x, y));
    const q = fold(query), match = (x) => !q || fold(typeName(x)).includes(q) || fold(groupName(x.group)).includes(q) || fold(x.type || '').includes(q);
    const known = GROUPS.map(g => ({ g, list: TIE_GROUPS[g].map(type => ({ group: g, type })).filter(match) })).filter(x => x.list.length);
    const exact = known.some(x => x.list.some(y => fold(typeName(y)) === q)), ownText = cleanWord(query, OWN_TYPE_UNITS);
    const enc = (x) => esc(JSON.stringify(x));
    const chip = (x) => `<button type="button" class="mm-yn-pick mm-tk-${esc(x.group)}${has(x) ? ' on' : ''}" aria-pressed="${has(x)}" data-yn-type="${enc(x)}">${esc(typeName(x))}</button>`;
    const rec = recent.filter(match);
    return `<div class="mm-yn-chosen" aria-live="polite"><span class="mm-yn-label">갈래 · ${TYPES_MAX}개까지 (첫 번째가 대표)</span>
        ${draft.types.length ? `<span class="mm-yn-chosenlist">${draft.types.map((x, i) => `<span class="mm-yn-type mm-tk-${esc(x.group)}${i === 0 ? ' main' : ''}${x.custom ? ' own' : ''}">${i === 0 ? '<em>대표</em>' : `<button type="button" class="mm-yn-mini" title="대표로" data-yn-main="${i}">↑</button>`}<span>${esc(typeName(x))}</span><button type="button" class="mm-yn-mini" aria-label="${esc(typeName(x))} 빼기" data-yn-drop="${i}">×</button></span>`).join('')}</span>` : '<small class="mm-yn-hint">아직 고른 갈래가 없어요.</small>'}
        ${full ? `<small class="mm-yn-hint warn">${TYPES_MAX}개까지 고를 수 있어요 — 하나를 빼고 골라 주세요.</small>` : ''}</div>
        ${ownText && !exact ? `<div class="mm-yn-own"><button type="button" class="mm-yn-ownbtn" data-yn-own="${esc(ownText)}">「${esc(ownText)}」 직접 쓰기</button>
            <select class="text_pole mm-yn-owngroup" aria-label="직접 쓴 갈래를 둘 무리">${GROUPS.map(g => `<option value="${g}"${g === ownGroup ? ' selected' : ''}>${groupName(g)}</option>`).join('')}</select></div>` : ''}
        <div class="mm-yn-groups">
            ${rec.length ? `<section><h5>최근 고른 것</h5><div class="mm-yn-picks">${rec.map(chip).join('')}</div></section>` : ''}
            ${known.map(({ g, list }) => `<section><h5 class="mm-tk-${g}"><i class="mm-ti-swatch"></i>${groupName(g)}</h5><div class="mm-yn-picks">${list.map(chip).join('')}</div></section>`).join('')}
            ${!known.length && !ownText ? '<small class="mm-yn-hint">맞는 갈래가 없어요. 찾기 칸에 쓴 말을 그대로 쓸 수 있어요.</small>' : ''}
        </div>`;
}
