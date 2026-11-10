/**
 * Memoria 보조 엔진 — 화면·실리태번에 의존하지 않는 순수 함수.
 *
 * - 대기 상한: 응답 생성을 붙잡는 작업에 시간 제한을 건다
 * - 옛 문체·금지어: 장부에서 금지 표현을 걷어내고, 반복되는 표현을 찾는다
 * - 설정 묶음: 봇·채팅마다 다른 설정을 이름 붙여 저장하고 갈아 끼운다
 * - 고정 장부: 장부의 안정 구간을 얼려 두고 달라진 줄만 따로 싣는다 (프롬프트 캐시)
 * - 활동 기록: 저절로 일어난 일을 알림 대신 기록으로 남긴다
 */

/* ------------------------------------------------------------
 * 대기 상한
 * ------------------------------------------------------------ */

/**
 * 약속이 `ms` 안에 끝나지 않으면 `fallback`으로 넘어간다. 원래 약속은 뒤에서 마저 끝난다
 * (결과가 캐시에 남아 다음 턴에 쓰인다). `ms`가 0 이하·무한이면 제한 없이 기다린다.
 * 반환: { value, timedOut }
 */
export function withDeadline(promise, ms, fallback = null) {
    const guarded = Promise.resolve(promise).then(value => ({ value, timedOut: false }));
    if (!Number.isFinite(ms)) return guarded;
    if (ms <= 0) {
        guarded.catch(() => {});
        return Promise.resolve({ value: fallback, timedOut: true });
    }
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), ms); });
    return Promise.race([guarded, timeout]).finally(() => { clearTimeout(timer); guarded.catch(() => {}); });
}

/* ------------------------------------------------------------
 * 옛 문체 · 금지어
 * ------------------------------------------------------------ */

/** 줄바꿈·쉼표로 나눈 금지 표현 목록. 한 글자짜리는 받지 않는다 (글 전체가 구멍 난다). */
export function parsePhraseList(raw) {
    const seen = new Set();
    const out = [];
    for (const piece of String(raw ?? '').split(/[\n,，、]+/)) {
        const phrase = piece.replace(/\s+/g, ' ').trim();
        const key = phrase.toLowerCase();
        if ([...phrase].length < 2 || seen.has(key)) continue;
        seen.add(key);
        out.push(phrase);
    }
    return out.sort((a, b) => b.length - a.length); // 긴 표현부터 — 짧은 것이 긴 것을 반토막 내지 않게
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const phraseRegexCache = new Map();
function phraseRegex(phrases) {
    const key = phrases.join('\u0001');
    if (!phraseRegexCache.has(key)) {
        if (phraseRegexCache.size > 8) phraseRegexCache.clear();
        // 표현 안의 공백은 어떤 공백(줄바꿈 포함)과도 맞는다
        const body = phrases.map(p => escapeRegex(p).replace(/ /g, '\\s+')).join('|');
        phraseRegexCache.set(key, body ? new RegExp(body, 'giu') : null);
    }
    return phraseRegexCache.get(key);
}

export function hasPhrase(text, phrases) {
    const rx = phrases?.length ? phraseRegex(phrases) : null;
    if (!rx) return false;
    rx.lastIndex = 0;
    return rx.test(String(text ?? ''));
}

/** 금지 표현을 걷어내고 그 자리에 남은 군더더기(겹친 공백, 문장부호 앞 공백)를 정리한다 */
export function stripPhrases(text, phrases) {
    const src = String(text ?? '');
    const rx = phrases?.length ? phraseRegex(phrases) : null;
    if (!rx || !src) return src;
    rx.lastIndex = 0;
    if (!rx.test(src)) return src;
    rx.lastIndex = 0;
    return src
        // 줄 맨 앞에서 걷어냈으면 뒤따르는 공백도 함께 (들여쓰기는 건드리지 않는다)
        .replace(rx, (m, ...rest) => {
            const off = rest[rest.length - 2];
            const all = rest[rest.length - 1];
            return off === 0 || all[off - 1] === '\n' ? '\u0000' : '';
        })
        .replace(/\u0000[ \t]*/g, '')
        .replace(/(\S)[ \t]{2,}/g, '$1 ')
        .replace(/[ \t]+([,.!?…。、，！？])/g, '$1')
        .replace(/([(\[“‘「『])[ \t]+/g, '$1');
}

/**
 * 여러 답변에 되풀이된 표현 찾기 — 모델이 자기 최근 답변을 보고 같은 말을 또 쓰는 고리의 재료.
 * 단어 1~4개짜리 조각을 "몇 개의 답변에 나왔는지"로 센다 (한 답변 안의 반복은 한 번).
 * 흔한 조사·기능어, 인물 이름, 더 긴 표현에 그대로 포함되는 짧은 조각은 뺀다.
 */
export function findRepeatedPhrases(replies, { minShare = 0.2, minReplies = 3, max = 24, names = [] } = {}) {
    const docs = (replies || []).map(r => String(r ?? '')).filter(r => r.trim());
    if (docs.length < minReplies) return [];
    const need = Math.max(minReplies, Math.ceil(docs.length * minShare));
    const nameSet = new Set(names.map(n => String(n || '').toLowerCase()).filter(Boolean));
    const isName = (w) => {
        const lw = w.toLowerCase();
        if (nameSet.has(lw)) return true;
        for (const n of nameSet) if (n.length >= 2 && lw.startsWith(n) && lw.length - n.length <= 2) return true; // 이름+조사
        return false;
    };
    const counts = new Map(); // key → { phrase, docs }
    for (const doc of docs) {
        const seen = new Set();
        for (const sentence of doc.split(/[\n.!?…。！？"“”「」『』]+/)) {
            const words = sentence.match(/[\p{L}\p{N}'’]+/gu) || [];
            for (let n = 1; n <= 4; n++) {
                for (let i = 0; i + n <= words.length; i++) {
                    const slice = words.slice(i, i + n);
                    const phrase = slice.join(' ');
                    const letters = phrase.replace(/\s/g, '');
                    // 한 단어짜리는 충분히 길고 특징적일 때만 (조사·짧은 기능어 배제)
                    if (n === 1 && [...letters].length < 3) continue;
                    if (n === 1 && /^[a-z]+$/i.test(letters) && letters.length < 7) continue;
                    if ([...letters].length < 4) continue;
                    // 이름으로 시작하거나 끝나는 조각은 안쪽 조각이 대신 잡는다 ("아리아는 웃었다" → "웃었다")
                    if (isName(slice[0]) || isName(slice[n - 1])) continue;
                    const key = phrase.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const row = counts.get(key);
                    if (row) row.docs++;
                    else counts.set(key, { phrase, docs: 1, words: n });
                }
            }
        }
    }
    let rows = [...counts.values()].filter(r => r.docs >= need);
    // 더 긴 표현이 거의 같은 횟수로 나오면 짧은 조각은 그 일부일 뿐이다
    rows.sort((a, b) => b.words - a.words || b.docs - a.docs);
    const kept = [];
    for (const r of rows) {
        const lower = ` ${r.phrase.toLowerCase()} `;
        if (kept.some(k => ` ${k.phrase.toLowerCase()} `.includes(lower) && k.docs >= r.docs * 0.8)) continue;
        kept.push(r);
    }
    // 한 단어짜리는 흔한 낱말이 많이 걸리므로 문턱을 한 단계 더 높인다
    const strong = kept.filter(r => r.words > 1 || r.docs >= Math.max(need + 1, Math.ceil(docs.length * (minShare + 0.1))));
    strong.sort((a, b) => b.docs - a.docs || b.words - a.words || a.phrase.localeCompare(b.phrase));
    return strong.slice(0, max).map(r => ({ phrase: r.phrase, count: r.docs, total: docs.length }));
}

/* ------------------------------------------------------------
 * 설정 묶음
 * ------------------------------------------------------------ */

/**
 * 묶음에 담지 않는 설정 — 모든 채팅 공통이어야 하는 것.
 * 켜기/끄기 스위치, API 키가 든 연결 설정, 임베딩(채팅마다 바뀌면 색인을 계속 다시 만든다),
 * 프롬프트와 개정 번호(업데이트 이전 로직이 관리), 계정 공통 서술 방식, 묶음 자체.
 */
export const BUNDLE_EXCLUDED = Object.freeze([
    'enabled', 'customApi', 'embedApi', 'prompts', 'promptRev', 'promptOutdated', 'settingsRev',
    'defaultPerspective', 'bundles', 'bundleByOwner', 'activeBundle', 'bundleBase', 'noticed',
]);

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function bundleKeys(defaults) {
    return Object.keys(defaults).filter(k => !BUNDLE_EXCLUDED.includes(k));
}

/** 지금 설정에서 묶음에 들어갈 값만 뽑는다 */
export function pickBundleValues(settings, defaults) {
    const out = {};
    for (const k of bundleKeys(defaults)) if (settings[k] !== undefined) out[k] = clone(settings[k]);
    return out;
}

function applyValues(settings, values, defaults) {
    for (const k of bundleKeys(defaults)) {
        if (values && values[k] !== undefined) settings[k] = clone(values[k]);
    }
}

/** 이 채팅에 적용할 묶음 이름: 채팅에 붙인 것 → 캐릭터(그룹)에 붙인 것 → 없음 */
export function resolveBundleName(settings, { chatBundle = '', ownerKey = '' } = {}) {
    const bundles = settings.bundles || {};
    if (chatBundle && bundles[chatBundle]) return chatBundle;
    const owned = ownerKey ? settings.bundleByOwner?.[ownerKey] : '';
    return owned && bundles[owned] ? owned : '';
}

/**
 * 적용 중인 묶음을 `name`으로 바꾼다 ('' = 기본 설정).
 * 살아 있는 설정 객체에는 항상 "지금 적용 중인 값"이 들어 있고, 묶음이 적용된 동안의
 * 기본 설정은 `bundleBase`에 맡아 둔다. 그래서 설정 패널에서 바꾼 값은 저절로 적용 중인
 * 묶음의 것이 되고, 기본 설정은 건드려지지 않는다.
 * 반환: 실제로 바뀌었는지 여부.
 */
export function switchBundle(settings, name, defaults) {
    if (!settings.bundles || typeof settings.bundles !== 'object') settings.bundles = {};
    const target = name && settings.bundles[name] ? name : '';
    const active = settings.activeBundle && settings.bundles[settings.activeBundle] ? settings.activeBundle : '';
    if (settings.activeBundle && !active) {
        // 적용 중이던 묶음이 지워졌다 — 맡아 둔 기본 설정으로 돌아간다
        if (settings.bundleBase) applyValues(settings, settings.bundleBase, defaults);
        settings.bundleBase = null;
        settings.activeBundle = '';
    }
    if (active) settings.bundles[active] = pickBundleValues(settings, defaults); // 그동안 바꾼 값을 묶음에 저장
    if (active === target) return false;
    if (active) {
        applyValues(settings, settings.bundleBase || {}, defaults);
        settings.bundleBase = null;
    }
    if (target) {
        settings.bundleBase = pickBundleValues(settings, defaults);
        applyValues(settings, settings.bundles[target], defaults);
    }
    settings.activeBundle = target;
    return true;
}

/** 지금 설정을 새 묶음으로 저장 (같은 이름이면 덮어쓴다) */
export function saveBundle(settings, name, defaults) {
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean) return '';
    if (!settings.bundles || typeof settings.bundles !== 'object') settings.bundles = {};
    settings.bundles[clean] = pickBundleValues(settings, defaults);
    return clean;
}

export function deleteBundle(settings, name, defaults) {
    if (!settings.bundles?.[name]) return false;
    if (settings.activeBundle === name) switchBundle(settings, '', defaults);
    delete settings.bundles[name];
    for (const [owner, bound] of Object.entries(settings.bundleByOwner || {})) {
        if (bound === name) delete settings.bundleByOwner[owner];
    }
    return true;
}

/** 이름 바꾸기 — 캐릭터(그룹)에 붙인 것은 새 이름으로 따라간다 */
export function renameBundle(settings, from, to) {
    const clean = String(to ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean || clean === from || !settings.bundles?.[from] || settings.bundles[clean]) return '';
    settings.bundles[clean] = settings.bundles[from];
    delete settings.bundles[from];
    if (settings.activeBundle === from) settings.activeBundle = clean;
    for (const [owner, bound] of Object.entries(settings.bundleByOwner || {})) {
        if (bound === from) settings.bundleByOwner[owner] = clean;
    }
    return clean;
}

export function exportBundle(settings, name, defaults) {
    const values = settings.activeBundle === name ? pickBundleValues(settings, defaults) : settings.bundles?.[name];
    if (!values) return '';
    return JSON.stringify({ memoriaBundle: 1, name, values }, null, 2);
}

/** 묶음 파일 읽기 — 아는 설정 키만, 기본값과 같은 종류의 값만 받는다 */
export function parseBundleFile(text, defaults) {
    let data;
    try { data = JSON.parse(String(text ?? '').replace(/^﻿/, '')); } catch { return null; }
    if (!data || data.memoriaBundle !== 1 || !data.values || typeof data.values !== 'object') return null;
    const values = {};
    for (const k of bundleKeys(defaults)) {
        const v = data.values[k];
        if (v === undefined) continue;
        const d = defaults[k];
        const sameKind = d === null ? true : Array.isArray(d) ? Array.isArray(v) : typeof v === typeof d;
        if (sameKind) values[k] = clone(v);
    }
    const name = String(data.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return Object.keys(values).length ? { name: name || '가져온 묶음', values } : null;
}

/* ------------------------------------------------------------
 * 고정 장부 (프롬프트 캐시)
 * ------------------------------------------------------------ */

/**
 * 얼려 둔 안정 구간과 지금의 안정 구간을 항목 단위로 비교한다.
 * entries: [{ id, sec, line }]
 * 반환: { changed: 바뀌었거나 새로 생긴 항목들, removed: 사라진 항목 수 }
 */
export function diffStableEntries(frozen, current) {
    const before = new Map((frozen || []).map(e => [e.id, e.line]));
    const now = new Set();
    const changed = [];
    for (const e of current || []) {
        now.add(e.id);
        if (before.get(e.id) !== e.line) changed.push(e);
    }
    let removed = 0;
    for (const id of before.keys()) if (!now.has(id)) removed++;
    return { changed, removed };
}

/**
 * 얼려 둔 장부를 새로 떠야 하는가.
 * 사라진 항목은 "달라진 줄"로 표현할 수 없고, 달라진 줄이 너무 많으면 장부가 낡은 것이다.
 */
export function shouldRefreeze(freeze, { chatId, key, level, turn, diff, maxDelta = 14, maxTurns = 24 }) {
    if (!freeze || freeze.chatId !== chatId || freeze.key !== key) return 'new';
    if (level > freeze.level) return 'budget';
    if (diff.removed > 0) return 'removed';
    if (diff.changed.length > maxDelta) return 'drift';
    if (maxTurns > 0 && turn - freeze.turn >= maxTurns) return 'age';
    return '';
}

/* ------------------------------------------------------------
 * 활동 기록
 * ------------------------------------------------------------ */

export function createActivityLog(limit = 120) {
    const rows = [];
    return {
        add(kind, text, at = Date.now()) {
            const last = rows[rows.length - 1];
            // 같은 일이 연달아 일어나면 줄을 늘리지 않고 횟수만 센다
            if (last && last.kind === kind && last.text === text) { last.count = (last.count || 1) + 1; last.at = at; return last; }
            const row = { kind, text: String(text ?? ''), at, count: 1 };
            rows.push(row);
            if (rows.length > limit) rows.splice(0, rows.length - limit);
            return row;
        },
        list() { return [...rows].reverse(); },
        clear() { rows.length = 0; },
        get size() { return rows.length; },
    };
}

/* ------------------------------------------------------------
 * 함께 쓰면 기억이 두 번 들어가는 다른 확장
 * ------------------------------------------------------------ */

const RIVAL_PATTERNS = [
    [/messagesummarize|qvink/i, 'Qvink Memory (MessageSummarize)'],
    [/cairn/i, 'Cairn'],
    [/rememory/i, 'ReMemory'],
    [/memory-?books?/i, 'Memory Books'],
];

/** 켜져 있는 확장 이름 목록에서 다른 장기기억 확장을 찾는다 */
export function findRivalExtensions(names, disabled = []) {
    const off = new Set((disabled || []).map(String));
    const found = [];
    for (const raw of names || []) {
        const name = String(raw);
        if (off.has(name) || /memoria/i.test(name)) continue;
        const hit = RIVAL_PATTERNS.find(([rx]) => rx.test(name.replace(/^third-party\//, '')));
        if (hit && !found.includes(hit[1])) found.push(hit[1]);
    }
    return found;
}

/* ------------------------------------------------------------
 * 떡밥(미해결 서약) 관리 — 끝난 일이 "미해결"로 남아 계속 실리지 않게
 * ------------------------------------------------------------ */

export const THREAD_KINDS = Object.freeze(['keep_unresolved', 'loose_end', 'foreshadow']);

/**
 * 요약 응답 끝의 "CLOSED: o2, o5" 줄을 떼어 낸다.
 * 요약을 만드는 호출이 그 구간을 통째로 읽으므로, 어떤 떡밥이 풀렸는지도 그때 함께 묻는다
 * (호출을 따로 쓰지 않는다). 반환: { text: 요약 본문, closed: 닫힌 꼬리표들 }
 */
export function splitClosedLine(raw) {
    const closed = [];
    const text = String(raw ?? '').replace(/^[ \t]*CLOSED[ \t]*[:：](.*)$/gim, (m, rest) => {
        for (const tag of String(rest).toLowerCase().match(/\bo\d{1,2}\b/g) || []) if (!closed.includes(tag)) closed.push(tag);
        return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    return { text, closed };
}

/**
 * 오래 손대지 않은 떡밥을 잠재운다 (지우지 않는다 — 서고에 남고, 다시 언급되면 깨어난다).
 * 사용자가 직접 적은 것과 최우선(P1)은 건드리지 않는다. 반환: 잠재운 개수.
 */
export function sleepStaleThreads(locks, turnNow, after = 60) {
    if (!(after > 0)) return 0;
    let slept = 0;
    for (const l of locks || []) {
        if (l.status !== 'active' || l.manual || !THREAD_KINDS.includes(l.kind) || (l.priority ?? 2) <= 1) continue;
        if (turnNow - (l.turnIndex || 0) < after) continue;
        l.status = 'dormant';
        l.sleptTurn = turnNow;
        slept++;
    }
    return slept;
}

/**
 * 이번 턴에 실을 서약 고르기.
 * 비밀·동의 경계·세계 제약처럼 늘 지켜야 하는 것은 그대로 싣고, 떡밥은 지금 장면과 닿아 있거나
 * 최근 것이거나 최우선일 때만 싣는다 — 무관한 옛 떡밥이 매 턴 자리를 차지하면 모델이 억지로 꺼낸다.
 * overlap(a, b): 두 글의 겹침(0~1)
 */
export function pickPledges(locks, { turnNow = 0, sceneText = '', overlap = () => 0, cap = 8, threadCap = 4, fresh = 24 } = {}) {
    const active = (locks || []).filter(l => l.status === 'active').sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
    const standing = active.filter(l => !THREAD_KINDS.includes(l.kind));
    const threads = active.filter(l => THREAD_KINDS.includes(l.kind)).map((l) => {
        const age = turnNow - (l.turnIndex || 0);
        const near = sceneText ? overlap(l.summary, sceneText) : 0;
        const keep = (l.priority ?? 2) <= 1 || age <= fresh || near >= 0.34;
        return { l, keep, rank: ((l.priority ?? 2) <= 1 ? 2 : 0) + near * 2 + Math.max(0, 1 - age / 80) };
    }).filter(x => x.keep).sort((a, b) => b.rank - a.rank).slice(0, threadCap).map(x => x.l);
    return [...standing, ...threads].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)).slice(0, cap);
}

/** 요약 레코드에서 OPEN 줄을 뗀다 — 옛 요약의 "미해결"은 그 뒤에 풀렸을 수 있고, 지금의 미해결은 서약이 추적한다 */
export function stripOpenLines(text) {
    const out = [];
    let skipping = false;
    for (const line of String(text ?? '').split('\n')) {
        if (/^\s*OPEN\s*[:：]/i.test(line)) { skipping = true; continue; }
        if (skipping && /^\s*(?:WHEN|PLOT|SHIFTS)\s*[:：]/i.test(line)) skipping = false;
        if (!skipping) out.push(line);
    }
    return out.join('\n').trim();
}
