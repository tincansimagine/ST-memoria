// 잊은 것 찾기의 순수한 부분 — 모델을 부르지 않는다.
// 원문이 더는 보이지 않는 옛 장면을 몇 곳 고르고, 그 장면의 사실을 서고만으로 기억하는지 모델이 돌려준 답을 읽고,
// 잊었으면 어디서 끊겼는지 가린다. 서고(store)와 채팅(chat)은 메모리아의 모양 그대로 받는다.

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** 잊은 까닭 — 까닭마다 고치는 길이 하나씩 있다 */
export const FORGOT_CAUSE = Object.freeze({
    unfiled: { label: '처음부터 안 적힘', fix: 'file', tip: '그 장면을 기록할 때 이 사실을 적지 않았어요.' },
    dropped: { label: '요약하며 빠짐', fix: 'file', tip: '턴 기록에는 있었는데 요약으로 합쳐지며 빠졌어요.' },
    unrecalled: { label: '있는데 안 떠오름', fix: 'pin', tip: '기억으로 적혀 있는데 이 일을 물었을 때 장부에 오르지 않았어요.' },
    misread: { label: '적힌 글이 어긋남', fix: 'edit', tip: '그 기억이 장부에 올랐는데도 다르게 답했어요. 기억 글이 모호하거나 틀렸을 수 있어요.' },
});

/**
 * 이번에 훑을 옛 장면을 고른다.
 * turns: 기록된 턴 [{ turnIndex, mesId, importance, star }], before: 이 메시지 번호부터는 채팅 모델이 원문을 본다 (그 앞만 고른다).
 * swept: 이미 훑은 턴 번호 — 아직 안 훑은 장면에서만 고른다 (다 훑었으면 처음부터 다시).
 * 남은 장면을 n칸으로 고르게 나눠 칸마다 가장 무거운 턴 하나 (★ · 전환점이 먼저, 같으면 칸 가운데).
 * marks: 전환점이 있는 턴 번호. 반환: { picks: [{ turnIndex, mesId }], total, fresh(새로 처음부터인가) }
 */
export function pickScenes(turns, { before = Infinity, n = 8, swept = [], marks = [] } = {}) {
    const all = (turns || []).filter(t => t && t.turnIndex > 0 && Number.isInteger(t.mesId) && t.mesId >= 0 && t.mesId < before)
        .sort((a, b) => a.turnIndex - b.turnIndex);
    const done = new Set(swept);
    let pool = all.filter(t => !done.has(t.turnIndex)), fresh = false;
    if (!pool.length && all.length) { pool = all; fresh = true; }
    const want = Math.max(1, Math.min(Math.round(Number(n) || 8), pool.length));
    const marked = new Set(marks);
    const weight = (t) => (Number(t.importance) || 0) + (t.star ? 0.4 : 0) + (marked.has(t.turnIndex) ? 0.25 : 0);
    const picks = [];
    if (pool.length) {
        for (let k = 0; k < want; k++) {
            const a = Math.floor((k * pool.length) / want), b = Math.max(a + 1, Math.floor(((k + 1) * pool.length) / want));
            const slot = pool.slice(a, b), mid = (slot.length - 1) / 2;
            let best = slot[0], bi = 0;
            slot.forEach((t, i) => { const d = weight(t) - weight(best); if (d > 1e-9 || (Math.abs(d) <= 1e-9 && Math.abs(i - mid) < Math.abs(bi - mid))) { best = t; bi = i; } });
            picks.push({ turnIndex: best.turnIndex, mesId: best.mesId });
        }
    }
    return { picks, total: all.length, fresh };
}

/** 모델의 답에서 목록을 꺼낸다 (객체에 싸여 오든 맨 배열로 오든) */
function listIn(raw, ...keys) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];
    for (const k of keys) if (Array.isArray(raw[k])) return raw[k];
    return Object.values(raw).find(Array.isArray) || [];
}
const tagNo = (v, letter) => { const m = String(v ?? '').trim().match(new RegExp(`^\\[?${letter}?\\s*(\\d+)\\]?$`, 'i')); return m ? Number(m[1]) : NaN; };

/**
 * 장면에서 뽑은 사실을 읽는다. scenes: 보낸 장면 순서대로, notes: 'N3' → { kind: 'memory', id } | { kind: 'digest' }.
 * 장면 하나에 사실 하나. 사실이나 물을 말이 비었거나 보낸 장면이 아니면 버린다.
 * 반환: [{ scene(장면 자리), fact, ask, note, src }]
 */
export function readFacts(raw, scenes, notes) {
    const out = [], used = new Set();
    for (const x of listIn(raw, 'facts', 'items')) {
        if (!x || typeof x !== 'object') continue;
        const k = tagNo(x.scene ?? x.e ?? x.id, 'S') - 1;
        const fact = clip(x.fact ?? x.a ?? x.answer, 300), ask = clip(x.ask ?? x.q ?? x.question, 240), note = clip(x.note ?? x.record, 300);
        if (!scenes[k] || used.has(k) || !fact || ask.length < 6) continue;
        used.add(k);
        const src = notes.get(String(x.held ?? x.in ?? x.source ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')) || null;
        out.push({ scene: k, fact, ask, note: note || fact, src });
    }
    return out;
}

/** 서고의 답 읽기 — 'A3' 꼬리표로 그 물음에 붙인다. 반환: Map(자리 → 답) */
export function readReplies(raw, count) {
    const out = new Map();
    for (const x of listIn(raw, 'replies', 'answers', 'items')) {
        if (!x || typeof x !== 'object') continue;
        const k = tagNo(x.id ?? x.q ?? x.n, 'A') - 1, said = clip(x.said ?? x.a ?? x.answer, 400);
        if (k >= 0 && k < count && !out.has(k)) out.set(k, said);
    }
    return out;
}

/** 견준 결과 — kept: 기억함 · blurred: 흐릿함 · wrong: 다르게 기억함 · blank: 모름 */
const JUDGE = { kept: 'kept', same: 'kept', ok: 'kept', yes: 'kept', blurred: 'blurred', partial: 'blurred', vague: 'blurred', half: 'blurred', wrong: 'wrong', different: 'wrong', no: 'wrong', blank: 'blank', unknown: 'blank', none: 'blank' };
export function readJudgments(raw, count) {
    const out = new Map();
    for (const x of listIn(raw, 'judgments', 'items')) {
        if (!x || typeof x !== 'object') continue;
        const k = tagNo(x.id ?? x.n, 'A') - 1, v = JUDGE[String(x.held ?? x.v ?? '').trim().toLowerCase()];
        if (k >= 0 && k < count && v && !out.has(k)) out.set(k, v);
    }
    return out;
}

/** 서고가 "모른다"고 했나 — 이런 답은 견줄 것도 없이 잊은 것이다 */
export function saidBlank(said) {
    const s = String(said ?? '').replace(/[\s.。!?"'“”]/g, '').toLowerCase();
    return !s || /^(모름|모르|알수없|기록에없|서고에없|없음|unknown|idonotknow|idontknow|notinthe|n\/?a)/.test(s);
}

/**
 * 잊었다면 어디서 끊겼나 (기억하고 있으면 '').
 * src: 사실을 뽑을 때 이미 그 사실을 담고 있던 기록, has(id): 그 기억이 아직 서고에 있나, seen: 그 물음에 장부에 오른 기억 id들
 */
export function forgotCause(src, held, { has = () => true, seen = new Set() } = {}) {
    if (held === 'kept') return '';
    if (src?.kind === 'memory' && has(src.id)) return seen.has(src.id) ? 'misread' : 'unrecalled';
    if (src?.kind === 'digest') return 'dropped';
    return 'unfiled';
}
