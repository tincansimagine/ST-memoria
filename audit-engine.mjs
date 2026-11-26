// 검사의 순수한 부분 — 모델을 부르지 않는다:
// 어긋난 곳의 근거 확인, 「지금」 쪽 바로잡기 메모, 요약의 범위 · 날짜 · 이름 점검과 그 자리 고치기, 채점 · 수정 답 읽기.
// 서고(store)와 채팅(chat)은 메모리아의 모양 그대로 받는다. 메시지 번호는 실리태번의 메시지 번호(#0부터)다.
import { parseRecord } from './scene-engine.mjs';
import { looksRefused } from './craft-engine.mjs';

// ════════ 설정 읽기 ════════
/** 어긋난 곳 검사 방식 — 답변마다(replyCheck)와 묶어서(batch)는 함께 켜지지 않는다: 옛 토글이 켜져 있으면 늘 답변마다 */
export const checkModeOf = (s) => (s?.replyCheck ? 'each' : s?.checkMode === 'batch' ? 'batch' : 'off');
export const checkEveryOf = (s) => { const n = Math.round(Number(s?.checkEvery)); return Number.isFinite(n) && n > 0 ? Math.max(2, Math.min(30, n)) : 5; };
export const gradeEveryOf = (s) => { const n = Math.round(Number(s?.gradeEvery)); return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(20, n)) : 3; };
/** 바로잡기 메모를 싣는 답 수 */
export const NOTE_REPLIES = 3;
export const DRIFT_KINDS = ['fact', 'knows', 'address', 'time'];

// ════════ 글 견주기 ════════
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** 띄어쓰기 · 따옴표 · 문장부호를 지우고 견준다 */
export const squashText = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s"'`“”‘’「」『』《》〈〉()[\]{}…·.,!?~\-—–:;。、！？，＊*_=→|/]/g, '');
export const auditHash = (s) => { const t = String(s ?? ''); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** 이야기 메시지인가 (내 말 · 캐릭터 답) — 숨김 표시는 자동 숨김으로 가린 것만 이야기로 친다 */
const storyMes = (m) => !!m && (!m.is_system || !!m.extra?.memoria_hidden);

// ════════ 턴 · 요약이 덮는 메시지 범위 ════════
/** 턴 번호(1부터) → 그 턴이 덮는 메시지 [처음, 끝]. 바로 앞의 내 말부터 그 답까지 */
export function turnSpans(store, chat) {
    const out = new Map();
    let prev = -1;
    for (const t of [...(store.turns || [])].sort((a, b) => a.turnIndex - b.turnIndex)) {
        const end = t.mesId;
        if (!Number.isInteger(end) || end < 0 || end >= chat.length) continue;
        let start = end;
        for (let i = end - 1; i > prev; i--) {
            const m = chat[i];
            if (!m || !storyMes(m)) continue;
            if (m.is_user) { start = i; continue; }
            break;
        }
        out.set(t.turnIndex, [start, end]);
        prev = Math.max(prev, end);
    }
    return out;
}
const spanOf = (spans, fromTurn, toTurn) => {
    let a = -1, b = -1;
    for (const [ti, r] of spans) { if (ti < fromTurn || ti > toTurn) continue; if (a < 0 || r[0] < a) a = r[0]; if (r[1] > b) b = r[1]; }
    return a >= 0 ? [a, b] : null;
};
/** 요약 칸들 — 이 채팅에서 만든 연대기와 묶음 (이어받은 것은 메시지가 없어 뺀다). 오래된 것부터 */
export function sumSecs(store, chat, spans = turnSpans(store, chat)) {
    const row = (s, level) => { const r = spanOf(spans, s.fromTurn, s.toTurn); return { s, level, from: r ? r[0] : -1, to: r ? r[1] : -1 }; };
    return [
        ...(store.arcSummaries || []).filter(a => !a.carried).map(a => row(a, 'arc')),
        ...(store.chunkSummaries || []).filter(c => !c.carried).map(c => row(c, 'chunk')),
    ].sort((x, y) => x.s.fromTurn - y.s.fromTurn);
}
/** 요약 머리의 때 · 곳 한 줄 (없으면 '') */
export const whenOf = (s) => clip(parseRecord(s?.text).when, 48);

// ════════ 근거 확인 ════════
/** 저장된 기록을 근거로 찾아볼 수 있는 줄들로 편다 — 요약 · 장면 기록이 먼저 (어디서 나온 말인지 범위까지 댈 수 있다) */
export function evidenceRows(store, chat) {
    const spans = turnSpans(store, chat), out = [];
    const add = (kind, name, bits, from = -1, to = -1) => {
        const text = bits.map(b => String(b ?? '').trim()).filter(Boolean).join('\n');
        if (text) out.push({ kind, name: clip(name, 48), text, ...(from >= 0 ? { from, to: to >= 0 ? to : from } : {}) });
    };
    for (const x of sumSecs(store, chat, spans)) add(x.level === 'arc' ? 'arc' : 'summary', whenOf(x.s), [x.s.text], x.from, x.to);
    for (const a of (store.arcSummaries || []).filter(a => a.carried)) add('arc', '', [a.text]);
    for (const t of store.turns || []) {
        const r = spans.get(t.turnIndex);
        add('scene', [t.when, t.where].filter(Boolean).join(' · '), [t.summary, t.nowNote, ...(t.beats || []).flatMap(b => [b.text, b.q])], r ? r[0] : -1, r ? r[1] : -1);
    }
    const at = (ti) => { const r = spans.get(ti); return r ? r[1] : -1; };
    for (const r of store.worldRules || []) add('canon', r.key, [`${r.key} = ${r.value}`], at(r.turnIndex));
    for (const c of store.characters || []) {
        if (c.disabled) continue;
        add('cast', c.name, [c.name, ...(c.aliases || []), c.role, c.age, c.occupation, c.appearance, c.voice, c.core, ...(c.traits || []),
            ...(c.relationships || []).map(r => `${r.target}: ${r.relation}`), ...(c.growth || []).map(g => g.text), ...(c.lines || []).map(l => l.text)], at(c.updatedTurn));
    }
    for (const b of store.bonds || []) if (!b.disabled) for (const st of b.log || []) add('bond', `${b.from} → ${b.to}`, [st.stage, st.basis, st.calls, st.unsaid], at(st.turn));
    for (const s of store.entityStates || []) if (!s.expired) add('status', `${s.entity} · ${s.slot}`, [`${s.entity}.${s.slot} = ${s.value}`], at(s.turnIndex));
    for (const p of store.locks || []) add('pledge', '', [p.summary, p.latest?.text, p.resolution], at(p.turnIndex));
    for (const m of store.memories || []) if (!m.disabled) add('memory', '', [m.summary, m.excerpt], at(m.turnIndex));
    for (const it of store.items || []) if (!it.disabled) add('item', it.name, [it.name, it.holder, it.meaning, it.status], at(it.updatedTurn ?? it.firstTurn));
    for (const e of store.milestones || []) add('item', e.title, [e.title, e.summary], at(e.turnIndex));
    return out;
}
/** 근거 문장이 든 줄 (없으면 null). 네 글자가 안 되는 근거는 확인한 것으로 치지 않는다 */
export function findEvidence(rows, evidence) {
    const e = squashText(evidence);
    if (e.length < 4) return null;
    for (const r of rows) { if (r.sq === undefined) r.sq = squashText(r.text); if (r.sq.includes(e)) return r; }
    return null;
}

const KIND_ALIAS = { fact: 'fact', facts: 'fact', knows: 'knows', knowledge: 'knows', secret: 'knows', address: 'address', speech: 'address', tone: 'address', voice: 'address', time: 'time', order: 'time', timeline: 'time', date: 'time' };
/**
 * 모델이 낸 어긋난 곳을 가린다. win: 검사한 답 [{ no(메시지 번호), h(글 해시), who, text }]
 * - 검사한 답이 아닌 번호를 짚었으면 지어낸 것이다 → 버린다.
 * - 답에서 옮겼다는 말이 그 답에 없거나, 근거 문장이 저장된 기록(없으면 보여 준 장부)에 없으면 확인하지 못한 것이다 → 남기되 ok 를 세우지 않는다.
 */
export function readFindings(raw, win, rows, shown, newId) {
    const by = new Map(win.map(w => [w.no, w])), shownSq = squashText(shown), seen = new Set(), out = [];
    for (const x of Array.isArray(raw) ? raw : []) {
        if (!x || typeof x !== 'object') continue;
        const no = Number(String(x.n ?? x.no ?? x.number ?? '').replace(/[^\d]/g, ''));
        const w = by.get(no);
        if (!w) continue;
        const text = clip(x.problem ?? x.text, 300);
        if (!text) continue;
        const quote = clip(x.quote, 240), evidence = clip(x.evidence, 300), q = squashText(quote), key = `${no}|${q || squashText(text)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const quoteOk = q.length >= 3 && squashText(w.text).includes(q);
        const row = findEvidence(rows, evidence), e = squashText(evidence), inShown = !row && e.length >= 4 && shownSq.includes(e);
        const src = row ? { kind: row.kind, ...(row.name ? { name: row.name } : {}), ...(row.from >= 0 ? { from: row.from, to: row.to } : {}) } : inShown ? { kind: 'ledger' } : null;
        out.push({ id: newId(), no, h: w.h, who: w.who, kind: KIND_ALIAS[String(x.kind ?? '').trim().toLowerCase()] || 'fact', text, quote, evidence, src, ok: quoteOk && !!src });
        if (out.length >= 12) break;
    }
    return out;
}

// ════════ 바로잡기 메모 (매 턴 바뀌는 구간에만 싣는다) ════════
/** 지금도 살아 있는 건 — 근거를 확인했고, 넘기지 않았고, 그 답이 그때 글 그대로다. hashOf(mes): 글 해시 */
export function liveFindings(report, chat, hashOf) {
    if (!report || !Array.isArray(chat)) return [];
    return (report.findings || []).filter(f => { const m = chat[f.no]; return f.ok && !f.dismissed && !!m && !m.is_user && hashOf(m) === f.h; });
}
/** 검사 뒤로 온 답 수 (검사한 마지막 답이 없어졌으면 -1) */
export function repliesSince(report, chat, hashOf) {
    if (!report || !Array.isArray(chat)) return -1;
    const last = chat[report.to];
    if (!last || last.is_user || (report.lastH && hashOf(last) !== report.lastH)) return -1;
    let n = 0;
    for (let i = report.to + 1; i < chat.length; i++) { const m = chat[i]; if (m && !m.is_user && !m.is_system && String(m.mes || '').trim()) n++; }
    return n;
}
/**
 * 「지금」 쪽에 실을 메모 줄 — 마지막 검사에서 근거를 확인한 어긋남을 기록 쪽 문장과 함께 짧게. 검사 뒤 답 keep 개가 지나면 싣지 않는다.
 * 보고서가 없거나 설정이 꺼져 있으면 빈 목록 — 장부는 한 글자도 달라지지 않는다
 */
export function driftNoteLines(audit, chat, hashOf, on, keep = NOTE_REPLIES) {
    const report = audit?.drift;
    if (!on || !report || !Array.isArray(chat)) return [];
    const since = repliesSince(report, chat, hashOf);
    if (since < 0 || since >= keep) return [];
    const live = liveFindings(report, chat, hashOf).slice(0, 4);
    if (!live.length) return [];
    return ['## Keep Consistent with the Record (a check of the latest replies found these slips — from here on follow what the record says; do not point out the correction or mention this note)',
        ...live.map(f => `- On record: "${clip(f.evidence, 200)}" — reply #${f.no} said otherwise: ${clip(f.text, 200)}`)];
}

// ════════ 요약 점검 (범위 · 날짜 · 이름) ════════
const DAY_RE = [/\bday\s*(\d{1,4})\b/gi, /(\d{1,4})\s*일\s*(?:째|차)/g, /第\s*(\d{1,4})\s*[天日]/g, /(\d{1,4})\s*日\s*目/g];
const daysSaid = (when) => { const out = []; for (const re of DAY_RE) for (const m of String(when).matchAll(re)) { const n = +m[1]; if (n >= 1) out.push(n); } return out; };
/** 턴 번호 → 며칠째 (이야기 시계가 센 날이 한 번이라도 흐른 뒤부터만 안다) */
function dayAtTurns(store) {
    const out = new Map();
    let total = 0, ever = false;
    for (const t of [...(store.turns || [])].sort((a, b) => a.turnIndex - b.turnIndex)) {
        if (t.elapsedDays) ever = true;
        out.set(t.turnIndex, ever ? Math.floor(total + 1e-6) + 1 : 0);
        total += t.elapsedDays || 0;
    }
    return out;
}
/**
 * 요약의 범위와 날짜 · 이름을 견준다 (모델 호출 없음).
 * strays: 인물 목록에 없는데 기록에 나오는 이름 · known: 인물 목록 밖에서 아는 이름 (내 캐릭터 · 캐릭터 카드) · mentions(text, names): 이름이 글에 나오는가
 * 빈 구간은 따로 찾는다(요약 탭의 「채우기」) — 여기서는 칸끼리의 어긋남만 본다
 */
export function sumChecks(store, chat, { strays = [], known = [], mentions = null } = {}) {
    const out = [], turnMax = Math.max(0, ...(store.turns || []).map(t => t.turnIndex || 0));
    const spans = turnSpans(store, chat), secs = sumSecs(store, chat, spans);
    const valid = secs.filter(x => {
        const { fromTurn: a, toTurn: b } = x.s;
        const bad = !Number.isInteger(a) || !Number.isInteger(b) || a < 1 || a > b || b > turnMax;
        if (bad) out.push({ key: `range:${x.s.id}`, type: 'range', fix: Number.isInteger(a) && a >= 1 && a <= turnMax && (b > turnMax || a > b) ? 'clamp' : '', sum: x.s.id, from: x.from, to: x.to });
        return !bad;
    });
    const sorted = (list) => list.every((s, i) => !i || list[i - 1].fromTurn <= s.fromTurn);
    if (!sorted(store.chunkSummaries || []) || !sorted((store.arcSummaries || []).filter(a => !a.carried))) out.push({ key: 'order', type: 'order', fix: 'sort' });
    for (let i = 1; i < valid.length; i++) {
        const a = valid[i - 1], b = valid[i];
        if (b.s.fromTurn > a.s.toTurn) continue;
        const r = spanOf(spans, b.s.fromTurn, Math.min(a.s.toTurn, b.s.toTurn));
        out.push({ key: `overlap:${a.s.id}:${b.s.id}`, type: 'overlap', fix: b.s.toTurn > a.s.toTurn ? 'trim' : '', sum: a.s.id, sum2: b.s.id, from: r ? r[0] : -1, to: r ? r[1] : -1 });
    }
    const dayAt = dayAtTurns(store);
    const registry = new Set([...(store.characters || []).flatMap(c => [c.name, ...(c.aliases || [])]), ...known].map(n => String(n || '').toLowerCase().replace(/[\s._\-'"`]+/g, '')).filter(Boolean));
    const stray = strays.filter(n => String(n).length >= 2 && !registry.has(String(n).toLowerCase().replace(/[\s._\-'"`]+/g, '')));
    const named = new Map();
    for (const x of valid) {
        const text = String(x.s.text || '').trim();
        const notes = (store.turns || []).filter(t => t.turnIndex >= x.s.fromTurn && t.turnIndex <= x.s.toTurn && t.summary && !t.failed);
        const size = notes.reduce((n, t) => n + String(t.summary).length, 0);
        if (!text) { out.push({ key: `empty:${x.s.id}`, type: 'empty', fix: '', sum: x.s.id, from: x.from, to: x.to }); continue; }
        if (!x.s.saga && ((text.length < 40 && notes.length >= 2) || (size >= 600 && text.length < size * 0.06))) out.push({ key: `short:${x.s.id}:${text.length}`, type: 'short', fix: '', sum: x.s.id, from: x.from, to: x.to, n: text.length });
        const when = parseRecord(text).when;
        if (when && !x.s.saga) {
            const said = daysSaid(when), onFile = [];
            for (let ti = x.s.fromTurn; ti <= x.s.toTurn; ti++) { const d = dayAt.get(ti); if (d) onFile.push(d); }
            if (said.length && onFile.length) {
                const lo = Math.min(...onFile), hi = Math.max(...onFile);
                if (said.every(d => d < lo - 1 || d > hi + 1)) out.push({ key: `date:${x.s.id}:${said[0]}:${lo}`, type: 'date', fix: '', sum: x.s.id, from: x.from, to: x.to, said: String(said[0]), real: lo === hi ? String(lo) : `${lo}–${hi}` });
            }
        }
        if (mentions) for (const n of stray) {
            if (!mentions(text, [n])) continue;
            const k = String(n).toLowerCase();
            const hit = named.get(k);
            if (hit) hit.n = (hit.n || 1) + 1;
            else if (named.size < 6) named.set(k, { key: `name:${k}`, type: 'name', fix: '', sum: x.s.id, from: x.from, to: x.to, name: n, n: 1 });
        }
    }
    out.push(...named.values());
    return out;
}

/** 점검 항목을 그 자리에서 고친다 (모델 호출 없음 · 요약 글은 건드리지 않는다). 반환: 고쳤는가 */
export function applySumFix(store, issue) {
    const turnMax = Math.max(0, ...(store.turns || []).map(t => t.turnIndex || 0));
    const all = () => [...(store.chunkSummaries || []), ...(store.arcSummaries || []).filter(a => !a.carried)];
    const byId = (id) => all().find(s => s.id === id);
    if (issue.fix === 'sort') {
        store.chunkSummaries.sort((a, b) => a.fromTurn - b.fromTurn);
        store.arcSummaries.sort((a, b) => (a.carried ? -1 : 0) - (b.carried ? -1 : 0) || a.fromTurn - b.fromTurn);
        return true;
    }
    if (issue.fix === 'clamp') {
        const s = byId(issue.sum);
        if (!s || turnMax < 1 || s.fromTurn > turnMax) return false;
        s.toTurn = Math.max(s.fromTurn, Math.min(s.toTurn >= s.fromTurn ? s.toTurn : s.fromTurn, turnMax));
        return true;
    }
    if (issue.fix === 'trim') {
        const a = byId(issue.sum), b = byId(issue.sum2);
        if (!a || !b || b.toTurn <= a.toTurn) return false;
        b.fromTurn = a.toTurn + 1;
        return true;
    }
    return false;
}

// ════════ 원문 발췌 (채점 · 수정에 보낸다) ════════
/**
 * #from ~ #to 의 메시지를 예산(글자 수) 안에서 발췌한다. focus(메시지 번호) 근처를 먼저, 나머지는 고르게.
 * 긴 메시지는 앞과 끝만 남기고 가운데를 " … " 로 줄인다. 반환: "[#131 이름] 글" 줄들 (대화 순서)
 */
export function excerptsFor(chat, from, to, budget, nameOf, clean, focus = []) {
    const pool = [];
    for (let n = Math.max(0, from); n <= to && n < chat.length; n++) {
        const m = chat[n];
        if (!m || !storyMes(m)) continue;
        const text = String(clean(m) || '').replace(/\s+/g, ' ').trim();
        if (text) pool.push({ no: n, m, text });
    }
    if (!pool.length) return [];
    const cut = (s, head, tail) => (s.length <= head + tail + 12 ? s : `${s.slice(0, head)} … ${s.slice(-tail)}`);
    const per = Math.max(160, Math.min(700, Math.floor(budget / Math.min(pool.length, 10)))), want = new Set(), near = new Set(focus.flatMap(n => [n - 1, n, n + 1]));
    for (const p of pool) if (near.has(p.no)) want.add(p.no);
    const room = Math.max(want.size, Math.floor(budget / per)), rest = pool.filter(p => !want.has(p.no)), take = Math.max(0, room - want.size);
    for (let i = 0; i < take && rest.length; i++) want.add(rest[Math.min(rest.length - 1, Math.round(i * (rest.length - 1) / Math.max(1, take - 1)))].no);
    return pool.filter(p => want.has(p.no)).map(p => `[#${p.no} ${nameOf(p.m)}] ${cut(p.text, Math.round(per * 0.65), Math.round(per * 0.35))}`);
}

// ════════ 채점 · 수정 답 읽기 ════════
const GRADE_KIND = { wrong: 'wrong', incorrect: 'wrong', error: 'wrong', missing: 'missing', omitted: 'missing', invented: 'invented', fabricated: 'invented', unsupported: 'invented' };
/** 채점 답을 읽는다 — 꼬리표(S1…)가 보낸 요약의 것이 아니면 버리고, 메시지 번호는 그 요약의 범위 안의 것만 남긴다. tags: 'S1' → { s, from, to } */
export function readGrade(raw, tags) {
    const out = [], per = new Map();
    for (const x of Array.isArray(raw) ? raw : []) {
        if (!x || typeof x !== 'object') continue;
        const sec = tags.get(String(x.sec ?? x.tag ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''));
        const kind = GRADE_KIND[String(x.kind ?? '').trim().toLowerCase()], text = clip(x.text ?? x.problem, 300);
        if (!sec || !kind || !text || (per.get(sec.s.id) || 0) >= 4) continue;
        const refs = [...new Set((Array.isArray(x.refs) ? x.refs : [x.refs]).map(r => Number(String(r ?? '').replace(/[^\d]/g, ''))).filter(n => Number.isInteger(n) && n >= sec.from && n <= sec.to && sec.from >= 0))].slice(0, 3);
        per.set(sec.s.id, (per.get(sec.s.id) || 0) + 1);
        out.push({ sum: sec.s.id, kind, text, refs });
        if (out.length >= 12) break;
    }
    return out;
}
/** 수정 답을 꼬리표별 글로 나눈다 ("=== S2 ===" 줄 아래가 그 요약의 새 글). clean(text, tag): 받을 꼴로 다듬기 */
export function readRepair(reply, clean) {
    const out = new Map(), src = String(reply ?? '').replace(/\r/g, ''), re = /^[ \t]*={2,}[ \t]*\[?(S\d+)\]?[ \t]*={2,}[ \t]*$/gim, marks = [];
    for (const m of src.matchAll(re)) marks.push({ tag: m[1].toUpperCase(), at: m.index, end: m.index + m[0].length });
    marks.forEach((k, i) => { const body = clean(src.slice(k.end, marks[i + 1]?.at ?? src.length), k.tag); if (body && !out.has(k.tag)) out.set(k.tag, body); });
    return out;
}
/** 고쳐 쓴 요약을 받아도 되는가 — 훨씬 짧아졌거나, 있던 칸(WHEN · PLOT)이 빠졌거나, 줄거리 줄이 줄었으면 받지 않는다. weak: 원래 글이 비었거나 너무 짧아 고쳐 달라고 한 요약 */
export function repairBad(before, after, weak = false) {
    const b = String(before || '').trim(), a = String(after || '').trim();
    if (!a) return 'empty';
    if (looksRefused(a) && !/(?:^|\n)\s*(?:WHEN|PLOT|SHIFTS|OPEN)\s*[:：]/i.test(a)) return 'refused';
    if (weak) return a.length >= Math.max(80, b.length) ? '' : 'shrunk';
    if (a.length < b.length * 0.7) return 'shrunk';
    const was = parseRecord(b), now = parseRecord(a);
    if (was.structured && (!now.structured || (was.when && !now.when) || (was.beats.length && now.beats.length < Math.ceil(was.beats.length * 0.7)) || (was.shifts.length >= 2 && !now.shifts.length))) return 'fields';
    return '';
}
