/**
 * Memoria 장면 엔진 — 모델을 부르지 않고 본문에서 직접 읽어 내는 것들. 순수 함수만 둔다.
 *
 * - 상태창: 답변에 붙는 시간·날짜·장소·날씨 줄을 읽는다
 * - 막간: 롤플을 멈추고 뽑은 QR 결과(퀴즈·인터뷰·운세)를 알아본다
 * - 요약 레코드: WHEN/PLOT/SHIFTS/OPEN을 화면용 구조로 푼다
 * - 연표: 기억·전환점을 시간순 표로 만든다 (정렬·검색·내보내기)
 * - 연속성 검사: 모델이 낸 경고의 근거가 실제 본문에 있는지 가린다
 */

/* ------------------------------------------------------------
 * 상태창
 * ------------------------------------------------------------ */

const EMOJI_RX = /[\p{Extended_Pictographic}️‍]/gu;
const CLOCK_RX = /(?:\d{1,2}\s*[:：]\s*\d{2})|(?:오전|오후|새벽|아침|낮|점심|저녁|밤|자정|정오)\s*\d{0,2}\s*시?|\b\d{1,2}\s*(?:am|pm)\b|\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?/i;
const DATE_RX = /\d{1,4}\s*년|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*일\s*째|\b(?:day|d)\s*[-#]?\s*\d+\b|\d{4}[-./]\d{1,2}[-./]\d{1,2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\(\s*[월화수목금토일]\s*\)|[월화수목금토일]요일/i;
const WEATHER_RX = /-?\d{1,2}\s*(?:°|℃|도\b)|맑음|흐림|비\b|눈\b|눈발|안개|소나기|폭우|폭설|바람|구름|쌀쌀|무더|sunny|cloudy|rain|snow|fog|storm|clear|overcast/i;
const PLACE_RX = /→|->|⇒|➡|📍|🏠|🏰|🗺/;
const LABEL_RX = /^[>*_\-•·|\s]*(?:[\p{Extended_Pictographic}️‍]\s*)*([^:：\n]{1,14})\s*[:：]\s*(.+)$/u;
const LABEL_KINDS = [
    [/날짜|일자|date|day|曜|日付/i, 'date'],
    [/시간|시각|time|clock|時/i, 'time'],
    [/장소|위치|현재\s*위치|place|location|where|場所/i, 'place'],
    [/날씨|기온|weather|temp|天気/i, 'weather'],
];

const clean = (s) => String(s ?? '').replace(EMOJI_RX, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const labelKind = (label) => (LABEL_KINDS.find(([rx]) => rx.test(clean(label))) || [])[1] || '';
const splitBar = (inner) => String(inner).split(/\s*[·•|｜∙ㆍ]\s*|\s+\/\s+/).map(p => p.trim()).filter(Boolean);

function fieldsFrom(parts) {
    const when = [];
    const weather = [];
    const rest = [];
    let place = '';
    for (const raw of parts) {
        const p = clean(raw);
        if (!p) continue;
        const m = p.match(/^([^:：]{1,14})\s*[:：]\s*(.+)$/);
        const kind = m ? labelKind(m[1]) : '';
        const value = m && kind ? m[2].trim() : p;
        // "☀️ 오전 7:30"은 해 아이콘이 붙은 시간이다 — 날씨 낱말이나 기온이 있어야 날씨로 본다
        if (kind === 'date' || kind === 'time' || (!kind && (DATE_RX.test(p) || CLOCK_RX.test(p)) && !WEATHER_RX.test(p))) when.push(value);
        else if (kind === 'place' || (!kind && PLACE_RX.test(raw))) place = place ? `${place}, ${value}` : value;
        else if (kind === 'weather' || (!kind && WEATHER_RX.test(raw))) weather.push(value);
        else rest.push(value);
    }
    // 화살표가 없어도 상태창은 대개 장소를 적는다 — 숫자 없는 첫 짧은 칸
    if (!place) {
        const i = rest.findIndex(p => p.length <= 40 && !/\d/.test(p));
        if (i >= 0) place = rest.splice(i, 1)[0];
    }
    return {
        when: when.join(' ').slice(0, 80),
        place: place.replace(/\s*(?:->|⇒|➡)\s*/g, ' → ').slice(0, 80),
        weather: weather.join(', ').slice(0, 60),
    };
}

function barFromLine(line) {
    const t = line.trim().replace(/^(?:>\s*)+/, '').replace(/^[*_`#\s]+|[*_`\s]+$/g, '');
    if (t.length < 8 || t.length > 320) return null;
    if (/^["“”'‘’]/.test(t)) return null; // 대사
    const wrap = t.match(/^[[【〔「『〈(（<]\s*([\s\S]+?)\s*[\]】〕」』〉)）>]$/);
    const inner = wrap ? wrap[1] : t;
    const parts = splitBar(inner);
    if (parts.length < 2) return null;
    const has = { clock: parts.some(p => CLOCK_RX.test(p)), date: parts.some(p => DATE_RX.test(p)), weather: parts.some(p => WEATHER_RX.test(p)), place: parts.some(p => PLACE_RX.test(p)) };
    const score = Object.values(has).filter(Boolean).length;
    if (!has.clock && !has.date) return null;
    // 괄호로 감싼 줄은 두 가지, 맨 줄은 세 가지 이상 맞아야 상태창이다 (가운뎃점이 든 서술문과 구분)
    if (!(wrap ? score >= 2 : score >= 3 && parts.length >= 3)) return null;
    if (parts.some(p => p.length > 60) || (!wrap && /[.!?。]\s*$/.test(inner))) return null;
    return { raw: line.trim(), ...fieldsFrom(parts) };
}

function barFromLabels(lines, start) {
    const run = [];
    const kinds = new Set();
    let i = start;
    for (; i < lines.length && run.length < 12; i++) {
        const l = lines[i].trim();
        const m = l && l.match(LABEL_RX);
        if (!m || m[2].length > 120) break;
        run.push(l);
        const kind = labelKind(m[1]);
        if (kind) kinds.add(kind);
    }
    if (kinds.size < 2 || !(kinds.has('date') || kinds.has('time'))) return null;
    return { end: i, bar: { raw: run.join('\n'), ...fieldsFrom(run.map(l => clean(l).replace(/^[>*_\-•·|\s]+/, ''))) } };
}

/** 상태창을 읽기 좋게: 태그를 걷고 줄 단위로 */
export function plainLines(text) {
    return String(text ?? '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\s*(?:br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, '\n')
        .replace(/<[^>]{1,400}>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim());
}

/**
 * 본문 속 상태창을 순서대로 찾는다 (최대 6개).
 * mode: 'auto' | 'custom'(pattern 정규식 — 괄호로 묶은 부분을 내용으로 읽는다) | 'off'
 */
export function findStatusBars(text, { mode = 'auto', pattern = '' } = {}) {
    if (mode === 'off' || !text) return [];
    if (mode === 'custom') {
        let rx;
        try { rx = new RegExp(String(pattern || ''), 'gim'); } catch { return []; }
        if (!String(pattern || '').trim()) return [];
        const out = [];
        for (const m of String(text).matchAll(rx)) {
            if (!m[0].trim()) continue;
            const body = (m[1] ?? m[0]).trim();
            const lines = plainLines(body).filter(Boolean);
            const labelled = lines.length > 1 ? barFromLabels(lines, 0) : null;
            const fields = labelled ? labelled.bar : fieldsFrom(splitBar(lines.join(' ').replace(/^[[【〔「『〈(（]\s*|\s*[\]】〕」』〉)）]$/g, '')));
            out.push({ ...fields, raw: m[0].trim().slice(0, 320) });
            if (out.length >= 6) break;
        }
        return out;
    }
    const lines = plainLines(text);
    const out = [];
    for (let i = 0; i < lines.length && out.length < 6; i++) {
        if (!lines[i]) continue;
        const bar = barFromLine(lines[i]);
        if (bar) { out.push(bar); continue; }
        if (LABEL_RX.test(lines[i])) {
            const hit = barFromLabels(lines, i);
            if (hit) { out.push(hit.bar); i = hit.end - 1; }
        }
    }
    return out;
}

export function statusOneLine(bar) {
    return [bar?.when, bar?.place, bar?.weather].filter(Boolean).join(' · ');
}

/* ------------------------------------------------------------
 * 막간 (롤플을 멈추고 뽑은 QR 결과)
 * ------------------------------------------------------------ */

const PAUSE_RX = /\b(?:pause|stop|halt|suspend|step out of|break from|out of)\b[^.\n]{0,60}\b(?:role-?play|rp|scenario|story|narrative|fiction|character)\b|(?:롤플|롤플레이|역할극|알피|RP|시나리오|이야기|스토리)[^.\n]{0,30}(?:멈추|멈춰|중단|정지|잠시\s*멈|일시\s*정지|벗어나)/i;
const SYSTEM_MARK_RX = /<\s*system\s*>|\[\s*system|\(\s*ooc|ooc\s*:|【\s*system/i;

/** 생성 지시문이 "롤플을 멈춰라"는 문구를 담고 있는가 */
export function isPauseDirective(text) {
    return PAUSE_RX.test(String(text ?? ''));
}

/** 사용자 메시지 자체가 시스템 지시 모양의 멈춤 문구인가 (/send <System>… | /trigger) */
export function isPauseMessage(text) {
    const t = String(text ?? '');
    return SYSTEM_MARK_RX.test(t) && PAUSE_RX.test(t);
}

/* ------------------------------------------------------------
 * 요약 레코드 → 화면용 구조
 * ------------------------------------------------------------ */

const splitClauses = (s) => String(s || '').split(/\s+·\s+|\s*;\s+/).map(x => x.trim()).filter(Boolean);

/** WHEN/PLOT/SHIFTS/OPEN 레코드를 푼다. 구조가 없는 옛 요약은 문장 단위 beats로. */
export function parseRecord(text) {
    const out = { when: '', beats: [], shifts: [], open: [], structured: false };
    const src = String(text ?? '').trim();
    if (!src) return out;
    let section = '';
    for (const rawLine of src.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const label = line.match(/^(WHEN|PLOT|SHIFTS|OPEN)\s*[:：]\s*(.*)$/i);
        if (label) {
            out.structured = true;
            section = label[1].toUpperCase();
            const rest = label[2].trim();
            if (!rest) continue;
            if (section === 'WHEN') out.when = rest;
            else if (section === 'PLOT') out.beats.push(rest.replace(/^[-•*]\s*/, ''));
            else if (section === 'SHIFTS') out.shifts.push(...splitClauses(rest));
            else out.open.push(...splitClauses(rest));
            continue;
        }
        const body = line.replace(/^[-•*]\s*/, '');
        if (section === 'SHIFTS') out.shifts.push(...splitClauses(body));
        else if (section === 'OPEN') out.open.push(...splitClauses(body));
        else if (section === 'WHEN') out.when = `${out.when} ${body}`.trim();
        else out.beats.push(body);
    }
    if (!out.structured) {
        const sentences = src.replace(/\s+/g, ' ').match(/[^.!?。！？]+[.!?。！？]+["”’」』]?|[^.!?。！？]+$/g) || [src];
        out.beats = sentences.map(s => s.trim()).filter(Boolean).slice(0, 12);
    }
    return out;
}

/* ------------------------------------------------------------
 * 연표
 * ------------------------------------------------------------ */

/**
 * 서고에서 연표 줄을 만든다 — 기억(사건류)과 전환점을 턴 순서로.
 * 작중 시간·장소는 그 턴에 찍어 둔 값을 쓰고, 비어 있으면 바로 앞 줄 것을 흐리게 이어받는다(carried).
 */
export function buildTimelineRows(store, { minImportance = 0 } = {}) {
    const turnOf = new Map((store.turns || []).map(t => [t.turnIndex, t]));
    const rows = [];
    for (const m of store.memories || []) {
        if (m.disabled || (m.importance ?? 0.5) < minImportance) continue;
        if ((m.tags || []).includes('episode_raw')) continue;
        const t = turnOf.get(m.turnIndex);
        rows.push({
            id: m.id, kind: m.kind || 'event', star: false, turn: m.turnIndex || 0, mesId: t?.mesId ?? m.mesId ?? -1,
            when: t?.when || '', where: t?.where || '', people: [...(m.entities || [])],
            text: m.summary || '', importance: m.importance ?? 0.5, hidden: (m.visibility || 'public') !== 'public',
        });
    }
    for (const e of store.milestones || []) {
        const t = turnOf.get(e.turnIndex);
        rows.push({
            id: e.id, kind: 'milestone', star: true, turn: e.turnIndex || 0, mesId: t?.mesId ?? -1,
            when: t?.when || '', where: t?.where || '', people: [...(e.participants || [])],
            text: [e.title, e.summary].filter(Boolean).join(' — '), importance: e.grade === 'minor' ? 0.7 : 0.95, hidden: false,
        });
    }
    rows.sort((a, b) => a.turn - b.turn || (b.star - a.star) || b.importance - a.importance);
    let lastWhen = '';
    let lastWhere = '';
    rows.forEach((r, i) => {
        r.order = i + 1;
        if (r.when) lastWhen = r.when; else if (lastWhen) { r.when = lastWhen; r.whenCarried = true; }
        if (r.where) lastWhere = r.where; else if (lastWhere) { r.where = lastWhere; r.whereCarried = true; }
    });
    return rows;
}

/** 표 보기의 검색·거르기·정렬 */
export function filterTimelineRows(rows, { query = '', minStars = 0, sort = 'order', desc = false } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const stars = (r) => Math.max(1, Math.min(5, Math.round((r.importance ?? 0.5) * 5)));
    let out = rows.filter(r => stars(r) >= minStars
        && (!q || `${r.text} ${r.when} ${r.where} ${r.people.join(' ')}`.toLowerCase().includes(q)));
    const key = { order: r => r.order, when: r => r.order, where: r => r.where || '￿', importance: r => r.importance }[sort] || (r => r.order);
    out = [...out].sort((a, b) => {
        const ka = key(a), kb = key(b);
        const d = typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb;
        return d || a.order - b.order;
    });
    return desc ? out.reverse() : out;
}

export const importanceStars = (v) => Math.max(1, Math.min(5, Math.round((v ?? 0.5) * 5)));

export function timelineMarkdown(rows) {
    const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const head = '| 순서 | 작중 시간 | 장소 | 인물 | 내용 | 중요도 | 메시지 |\n|---|---|---|---|---|---|---|';
    return [head, ...rows.map(r => `| ${r.order} | ${cell(r.when)} | ${cell(r.where)} | ${cell(r.people.join(', '))} | ${cell(r.text)} | ${'★'.repeat(importanceStars(r.importance))} | ${r.mesId >= 0 ? `#${r.mesId}` : ''} |`)].join('\n');
}

/** CSV — 엑셀에서 한글이 깨지지 않게 BOM을 붙인다 */
export function timelineCsv(rows) {
    const cell = (s) => `"${String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const lines = [['순서', '작중 시간', '장소', '인물', '내용', '중요도', '메시지'].map(cell).join(',')];
    for (const r of rows) lines.push([r.order, r.when, r.where, r.people.join(', '), r.text, importanceStars(r.importance), r.mesId >= 0 ? `#${r.mesId}` : ''].map(cell).join(','));
    return `﻿${lines.join('\r\n')}`;
}

/**
 * 연표 그래프의 배치 — 가로는 사건 순서(작중 시간 띠로 묶음), 세로는 인물 또는 장소 줄.
 * 자주 나온 8개까지 줄을 주고 나머지는 한 줄로 모은다.
 */
export function layoutTimelineGraph(rows, { by = 'people', maxLanes = 8, other = '그 밖' } = {}) {
    const keysOf = (r) => (by === 'place' ? [r.where || '?'] : (r.people.length ? r.people : ['?']));
    const count = new Map();
    for (const r of rows) for (const k of keysOf(r)) count.set(k, (count.get(k) || 0) + 1);
    const top = [...count.entries()].filter(([k]) => k !== '?').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxLanes).map(([k]) => k);
    const hasOther = rows.some(r => keysOf(r).some(k => !top.includes(k)));
    const lanes = hasOther ? [...top, other] : top;
    const laneOf = (k) => (top.includes(k) ? top.indexOf(k) : lanes.length - 1);
    const points = rows.map((r, x) => ({ row: r, x, lanes: [...new Set(keysOf(r).map(laneOf))].sort((a, b) => a - b) }));
    // 작중 시간 띠: 같은 시간 표기가 이어지는 구간
    const bands = [];
    // 띠는 굵게 묶는다: "3일째 저녁"·"3일째 밤"은 "3일째" 한 띠 (정확한 시간은 점을 누르면 보인다)
    const coarse = (when) => { const parts = String(when || '').trim().split(/\s+/); return parts.length > 1 ? parts[0] : parts[0] || ''; };
    points.forEach((p) => {
        const label = coarse(p.row.when);
        const last = bands[bands.length - 1];
        if (last && last.label === label) last.to = p.x;
        else bands.push({ label, from: p.x, to: p.x });
    });
    return { lanes, points, bands };
}

/* ------------------------------------------------------------
 * 연속성 검사
 * ------------------------------------------------------------ */

const squash = (s) => String(s ?? '').toLowerCase().replace(/[\s"'`“”‘’「」『』《》〈〉()[\]{}…·.,!?~\-—–:;。、！？，＊*_]/g, '');

/**
 * 모델이 낸 경고를 가린다.
 * - 답변에서 인용했다는 문장이 실제 답변에 없으면 지어낸 경고다 → 버린다.
 * - 근거 문장이 보여 준 자료에 없으면 확신할 수 없다 → 걸러 두되 볼 수는 있게 남긴다.
 */
export function verifyIssues(issues, reply, context) {
    const replyN = squash(reply);
    const contextN = squash(context);
    const kept = [];
    const filtered = [];
    const seen = new Set();
    for (const raw of Array.isArray(issues) ? issues : []) {
        if (!raw || typeof raw !== 'object') continue;
        const issue = {
            quote: String(raw.quote ?? '').trim().slice(0, 240),
            evidence: String(raw.evidence ?? '').trim().slice(0, 240),
            source: String(raw.source ?? '').trim().slice(0, 40),
            problem: String(raw.problem ?? '').trim().slice(0, 300),
        };
        if (!issue.problem) continue;
        const q = squash(issue.quote);
        if (q.length < 3 || !replyN.includes(q)) continue;
        if (seen.has(q)) continue;
        seen.add(q);
        const e = squash(issue.evidence);
        if (e.length >= 4 && contextN.includes(e)) kept.push(issue);
        else filtered.push({ ...issue, why: '근거 문장을 기록·최근 대화에서 그대로 찾지 못했어요' });
    }
    return { kept: kept.slice(0, 6), filtered: filtered.slice(0, 6) };
}
