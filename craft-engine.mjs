/**
 * Memoria 보조 엔진 — 화면·실리태번에 의존하지 않는 순수 함수.
 *
 * - 대기 상한: 응답 생성을 붙잡는 작업에 시간 제한을 건다
 * - 묵은 말투·삼갈 표현: 장부에서 금지 표현을 걷어내고, 반복되는 표현을 찾는다
 * - 설정 세트: 봇·채팅마다 다른 설정을 이름 붙여 저장하고 갈아 끼운다
 * - 고정 장부: 장부의 안정 구간을 얼려 두고 달라진 줄만 따로 싣는다 (프롬프트 캐시)
 * - 사서 일지: 저절로 일어난 일을 알림 대신 기록으로 남긴다
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
 * 묵은 말투 · 삼갈 표현
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
 * 설정 세트
 * ------------------------------------------------------------ */

/**
 * 세트에 담지 않는 설정 — 모든 채팅 공통이어야 하는 것.
 * 켜기/끄기 스위치, API 키가 든 연결 설정, 임베딩(채팅마다 바뀌면 색인을 계속 다시 만든다),
 * 프롬프트와 개정 번호(업데이트 이전 로직이 관리), 계정 공통 서술 방식, 세트 자체.
 */
export const BUNDLE_EXCLUDED = Object.freeze([
    'enabled', 'customApi', 'embedApi', 'prompts', 'promptRev', 'promptOutdated', 'settingsRev',
    'defaultPerspective', 'bundles', 'bundleByOwner', 'activeBundle', 'bundleBase', 'noticed', 'uiPaper',
]);

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function bundleKeys(defaults) {
    return Object.keys(defaults).filter(k => !BUNDLE_EXCLUDED.includes(k));
}

/** 지금 설정에서 세트에 들어갈 값만 뽑는다 */
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

/** 이 채팅에 적용할 세트 이름: 채팅에 붙인 것 → 캐릭터(그룹)에 붙인 것 → 없음 */
export function resolveBundleName(settings, { chatBundle = '', ownerKey = '' } = {}) {
    const bundles = settings.bundles || {};
    if (chatBundle && bundles[chatBundle]) return chatBundle;
    const owned = ownerKey ? settings.bundleByOwner?.[ownerKey] : '';
    return owned && bundles[owned] ? owned : '';
}

/**
 * 적용 중인 세트를 `name`으로 바꾼다 ('' = 기본 설정).
 * 살아 있는 설정 객체에는 항상 "지금 적용 중인 값"이 들어 있고, 세트가 적용된 동안의
 * 기본 설정은 `bundleBase`에 맡아 둔다. 그래서 설정 패널에서 바꾼 값은 저절로 적용 중인
 * 세트의 것이 되고, 기본 설정은 건드려지지 않는다.
 * 반환: 실제로 바뀌었는지 여부.
 */
export function switchBundle(settings, name, defaults) {
    if (!settings.bundles || typeof settings.bundles !== 'object') settings.bundles = {};
    const target = name && settings.bundles[name] ? name : '';
    const active = settings.activeBundle && settings.bundles[settings.activeBundle] ? settings.activeBundle : '';
    if (settings.activeBundle && !active) {
        // 적용 중이던 세트가 지워졌다 — 맡아 둔 기본 설정으로 돌아간다
        if (settings.bundleBase) applyValues(settings, settings.bundleBase, defaults);
        settings.bundleBase = null;
        settings.activeBundle = '';
    }
    if (active) settings.bundles[active] = pickBundleValues(settings, defaults); // 그동안 바꾼 값을 세트에 저장
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

/** 지금 설정을 새 세트로 저장 (같은 이름이면 덮어쓴다) */
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

/** 세트 파일 읽기 — 아는 설정 키만, 기본값과 같은 종류의 값만 받는다 */
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
    return Object.keys(values).length ? { name: name || '가져온 세트', values } : null;
}

/* ------------------------------------------------------------
 * 고정 장부 (프롬프트 캐시)
 * ------------------------------------------------------------ */

/**
 * 얼려 둔 안정 구간과 지금의 안정 구간을 항목 단위로 비교한다.
 * entries: [{ id, sec, line }]
 * stillStands(entry): 이번에는 뽑히지 않았지만 서고에 그대로 있는 항목인가 (true, 또는 지금의 줄) — 인물이 열 명을 넘는 채팅에서 누가 장면에 들어오면
 * 다른 인물 카드가 상한에 밀려 이번 목록에서 빠진다. 그 카드는 지워진 게 아니라 자리가 없었을 뿐이므로, 얼려 둔 장부의 그 줄은 그대로 맞다.
 * 반환: { changed: 바뀌었거나 새로 생긴 항목들, removed: 정말 사라진 항목 수, held: 빠졌지만 그대로 둔 항목 수 }
 */
export function diffStableEntries(frozen, current, stillStands = null) {
    const before = new Map((frozen || []).map(e => [e.id, e]));
    const now = new Set();
    const changed = [];
    for (const e of current || []) {
        now.add(e.id);
        if (before.get(e.id)?.line !== e.line) changed.push(e);
    }
    let removed = 0;
    let held = 0;
    for (const [id, e] of before) {
        if (now.has(id)) continue;
        // true: 얼려 둔 줄 그대로 맞다 · 글: 그 줄이 지금은 이렇게 달라졌다 (달라진 줄로 알린다) · 그 밖: 정말 사라졌다
        const v = stillStands ? stillStands(e) : false;
        if (typeof v === 'string') { if (v !== e.line) changed.push({ ...e, line: v }); held++; }
        else if (v) held++;
        else removed++;
    }
    return { changed, removed, held };
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
 * 사서 일지
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

export const THREAD_KINDS = Object.freeze(['keep_unresolved', 'loose_end', 'foreshadow', 'feeling']);
/** 숨겨야 하는 것(비밀·정보 격차) — 떡밥처럼 저절로 닫히지 않는다. 끝난 뒤에도 "지켜야 할 것"으로 남으면 모델이 옛 비밀을 지금 일처럼 꺼낸다 */
export const SECRET_KINDS = Object.freeze(['keep_secret', 'knowledge_gap']);

/**
 * 사서가 "풀린 듯"이라고 본 서약은 사용자가 확정하기 전에도 싣지 않는다 — 끝난 비밀을 확정을 기다리며 매 턴 "지킬 것"으로 싣는 쪽이 더 해롭다.
 * 지우지 않는다 (세계 탭에서 ✔로 확정하거나 「아직 유효」로 되돌린다). 직접 적은 서약과 최우선(P1)은 그대로 싣는다.
 */
export function pledgeHeldBack(l) {
    return !!l && l.status === 'active' && l.suggestResolved === true && !l.manual && (l.priority ?? 2) > 1;
}

/**
 * 요약 응답 끝의 "CLOSED: o2, o5" 줄을 떼어 낸다.
 * 요약을 만드는 호출이 그 구간을 통째로 읽으므로, 어떤 떡밥이 풀렸는지도 그때 함께 묻는다
 * (호출을 따로 쓰지 않는다). 반환: { text: 요약 본문, closed: 닫힌 꼬리표들 }
 */
export function splitClosedLine(raw) {
    const closed = [];
    const stale = [];
    const text = String(raw ?? '').replace(/^[ \t]*CLOSED[ \t]*[:：](.*)$/gim, (m, rest) => {
        for (const tag of String(rest).toLowerCase().match(/\bo\d{1,2}\b/g) || []) if (!closed.includes(tag)) closed.push(tag);
        return '';
    }).replace(/^[ \t]*STALE[ \t]*[:：](.*)$/gim, (m, rest) => {
        // "STALE: s2, m1" — 이 구간을 읽고 보니 더는 맞지 않는 상태·물건·기억 (같은 호출에 얹어 묻는다)
        for (const tag of String(rest).toLowerCase().match(/\b[smi]\d{1,2}\b/g) || []) if (!stale.includes(tag)) stale.push(tag);
        return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    return { text, closed, stale };
}

/* ------------------------------------------------------------
 * 회상 쉬어가기 — 같은 기억이 매 턴 되풀이해 실리지 않게
 *
 * 장면이 비슷하게 이어지면 검색은 매번 같은 기억을 1등으로 올린다. 모델은 장부에 실린 것을
 * "지금 중요한 것"으로 읽으므로, 이미 지나간 물건이나 일화가 답변마다 다시 불려 나온다.
 * 직전 몇 번의 답변에 실렸던 기억은 점수를 깎아 다른 기억에게 자리를 내주게 한다.
 * 지우는 것이 아니라 순서만 미루는 것이라, 사용자가 그 일을 직접 꺼내면 그대로 올라온다.
 * ------------------------------------------------------------ */

/**
 * history: 최근 답변들에 실렸던 기억 id 묶음 [{ at, ids:[...] }] (오래된 것부터)
 * before: 이 메시지 번호보다 앞선 답변에 실린 것만 센다 — 지금 다시 쓰는 답변(스와이프·재생성)이
 *         스스로를 깎아 같은 입력에 다른 장부가 나가는 일을 막는다.
 * direct: 사용자의 입력이 이 기억을 직접 가리킨다 (이름·단서·낱말이 닿음) — 거의 깎지 않는다.
 * echoed: 최근 답변이 이미 이 기억을 써먹었다 — 한 번 더 깎는다 (또 꺼낼 이유가 없다).
 * 반환: 점수에 곱할 값 (0~1]
 */
export function recallCooldown(history, id, { before = Infinity, direct = false, echoed = false, span = 3, step = 0.72 } = {}) {
    let runs = 0;
    for (const h of (history || []).filter(h => (h?.at ?? -1) < before).slice(-span)) {
        if ((h.ids || []).includes(id)) runs++;
    }
    let factor = Math.pow(step, runs);
    if (echoed && runs) factor *= 0.7;
    return direct ? Math.max(factor, 0.9) : factor;
}

/** 회상 이력에 이번 답변을 적는다 — 같은 답변을 다시 쓴 것이면 갈아 끼운다. 반환: 새 이력 */
export function pushRecallHistory(history, at, ids, keep = 4) {
    const next = (history || []).filter(h => h.at < at);
    next.push({ at, ids: [...new Set(ids || [])] });
    return next.slice(-keep);
}

/** "끝났다"는 값 — 다 나았다·빈손·없음. 잠깐 알려 주면 충분하고, 계속 싣는 것은 자리 낭비다 */
const ENDED_VALUE_RE = /^(?:none|nothing|n\/?a|no (?:injur\w*|wounds?|longer [\w ]+)|uninjured|unharmed|healed|fully (?:healed|recovered)|recovered|hands? free|empty[- ]handed|normal|fine|calm|resolved|over|ended|gone|없음|없다|해당 ?없음|무사|멀쩡\S*|회복\S*|완치\S*|다 ?나\S*|빈손|맨손|정상|평소\S*|해소\S*|끝\S*)[.!。]?$/i;
export function isEndedValue(value) {
    return ENDED_VALUE_RE.test(String(value ?? '').trim());
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
        if (turnNow - threadTouched(l) < after) continue;
        l.status = 'dormant';
        l.sleptTurn = turnNow;
        slept++;
    }
    return slept;
}

/**
 * 아주 오래 아무도 건드리지 않은 비밀·정보 격차를 잠재운다 (지우지 않는다 — 다시 언급되면 깨어나고, 세계 탭에서 깨울 수 있다).
 * 비밀은 떡밥과 달리 저절로 닫히지 않아, 그 비밀이 걸린 대목이 오래전에 끝났어도 "지켜야 할 것"으로 매 턴 실렸다.
 * 조용히 지켜지는 비밀도 있으므로 떡밥보다 훨씬 오래 기다리고, 잠재우기 전에 그사이의 기록(seenIn: [{ turn, text }] — 턴 요약·기억)을 훑는다:
 * 이야기에서 계속 오간 비밀이면 "본 턴"만 적고 그대로 둔다. 직접 적은 것과 최우선(P1)은 건드리지 않는다. kindOf: 서약 종류를 정식 이름으로. 반환: 잠재운 수
 */
export function sleepStaleSecrets(locks, turnNow, after, seenIn = [], kindOf = (k) => k) {
    if (!(after > 0)) return 0;
    let slept = 0;
    for (const l of locks || []) {
        if (l.status !== 'active' || l.manual || !SECRET_KINDS.includes(kindOf(l.kind)) || (l.priority ?? 2) <= 1) continue;
        const since = threadTouched(l);
        if (turnNow - since < after) continue;
        const text = `${l.summary} ${l.latest?.text || ''}`;
        let seen = 0;
        for (const r of seenIn) if (r.turn > since && r.turn <= turnNow && r.turn > seen && mentionsThread(text, r.text)) seen = r.turn;
        if (seen) {
            l.seenPrev = l.seenTurn ?? null;
            l.seenTurn = seen;
            if (turnNow - seen < after) continue;
        }
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
    const active = (locks || []).filter(l => l.status === 'active' && !pledgeHeldBack(l)).sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
    const standing = active.filter(l => !THREAD_KINDS.includes(l.kind));
    const threads = active.filter(l => THREAD_KINDS.includes(l.kind)).map((l) => {
        const age = turnNow - threadTouched(l);
        const near = sceneText ? overlap(`${l.summary} ${l.latest?.text || ''}`, sceneText) : 0;
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

/* ------------------------------------------------------------
 * 요약 속 숫자 검수 — 원문에 없는 숫자는 지어낸 것이다
 *
 * 요약이 틀리는 자리는 대개 숫자다: 날짜, 금액, 나이, 횟수. 문장은 그럴듯한데 숫자만 바뀌어 있으면
 * 사람도 모델도 알아채지 못하고, 그 뒤로는 그 숫자가 사실이 된다. 숫자는 글자 그대로 견줄 수 있으므로
 * 모델을 다시 부르지 않고도 가려낼 수 있다.
 * ------------------------------------------------------------ */

/** text에 나오는 숫자 가운데 source 어디에도 없는 것 (쉼표는 무시: 1,200 = 1200) */
export function ungroundedFigures(text, source) {
    const digits = (t) => (String(t ?? '').replace(/(\d),(?=\d{3})/g, '$1').match(/\d+(?:\.\d+)?/g) || []);
    const have = new Set(digits(source));
    // 한 자리 숫자는 세어서 적은 것일 수 있다("두 사람" → "2명") — 두 자리 이상과 소수만 본다
    return [...new Set(digits(text))].filter(n => n.length >= 2 && !have.has(n));
}

/* ------------------------------------------------------------
 * 쓴 만큼 보기 — 기억을 쌓는 데 오늘 얼마나 썼는지
 *
 * 기억 확장의 비용은 눈에 안 보이는 곳에서 나간다. 어떤 작업이 몇 번 불렸고 얼마나 읽고 썼는지를
 * 날짜별로 세어 두면, 묶어 기록이나 작업별 모델 같은 설정이 실제로 효과가 있었는지 볼 수 있다.
 * 토큰 수는 글자 수로 어림한다 (한글·한자·가나는 글자당 약 1토큰, 그 밖은 4글자당 1토큰).
 * ------------------------------------------------------------ */

export function roughTokens(text) {
    const s = String(text ?? '');
    const wide = (s.match(/[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
    return Math.round(wide + (s.length - wide) / 4);
}

/** usage: { day, tasks: { record: { calls, in, out }, ... } } — 날짜가 바뀌면 새로 센다. 반환: 갱신된 usage */
export function noteUsage(usage, task, input, output, day) {
    const next = usage && usage.day === day ? usage : { day, tasks: {} };
    const row = next.tasks[task] || (next.tasks[task] = { calls: 0, in: 0, out: 0 });
    row.calls += 1;
    row.in += roughTokens(input);
    row.out += roughTokens(output);
    return next;
}

export function usageTotals(usage) {
    const rows = Object.entries(usage?.tasks || {});
    return rows.reduce((a, [, r]) => ({ calls: a.calls + r.calls, in: a.in + r.in, out: a.out + r.out }), { calls: 0, in: 0, out: 0 });
}

/* ------------------------------------------------------------
 * 근거 확인 — 닫거나 물릴 때는 장면 속 글귀를 대야 한다
 *
 * 서약을 닫고 기억을 물리는 일은 되돌리기 전까지 그 일을 장부에서 지운다. 사서가 짐작으로 닫으면
 * 아직 살아 있는 떡밥이 사라진다. 그래서 장면에서 그대로 옮긴 짧은 글귀를 함께 받고, 그 글귀가
 * 실제로 원문에 있는지 글자로 확인한다. 말끝을 흐린 판정("아직", "거의", "~인 듯")도 받지 않는다.
 * ------------------------------------------------------------ */

const squashText = (t) => String(t ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

/** phrase가 source 안에 글자 그대로 있는가 (띄어쓰기·문장부호·따옴표는 무시). 너무 짧은 글귀는 근거가 못 된다 */
export function groundedIn(phrase, source, min = 4) {
    const p = squashText(phrase);
    return p.length >= min && squashText(source).includes(p);
}

const HEDGE_RE = /(아직|거의|일부|반쯤|부분적|것 ?같|듯(?:하|싶|이|$)|모양이|지도 모른|려고 ?(?:했|한다|함)|하려|기로 ?(?:했|함)|\bnot yet\b|\balmost\b|\bnearly\b|\bpartly\b|\bpartially\b|\bseems?\b|\bappears? to\b|\bmight\b|\bmay\b|\bprobably\b|\bplans? to\b|\babout to\b|\bgoing to\b)/i;
/** 끝났다고 말하면서 말끝을 흐리는가 — 그런 판정으로는 닫지 않는다 */
export function soundsHedged(text) {
    return HEDGE_RE.test(String(text ?? ''));
}

/* ------------------------------------------------------------
 * 떡밥이 마지막으로 언급된 때
 *
 * 오래 진전 없는 떡밥은 잠재운다. 그런데 "진전"을 사서가 그 떡밥을 다시 적은 때로만 재면,
 * 이야기 속에서 계속 오가는 떡밥도 사서가 다시 적지 않았다는 이유로 잠들어 버린다.
 * 매 기록마다 새 턴 요약과 떡밥을 견주어, 언급된 떡밥은 "마지막으로 본 턴"을 새로 적고
 * 잠들어 있었으면 깨운다. 모델을 부르지 않는다.
 * ------------------------------------------------------------ */

const PARTICLE_TAIL = /(으로부터|에게서|한테서|으로서|으로써|에서는|에서도|에게는|까지는|부터는|이라도|처럼|보다|까지|부터|에서|에게|한테|께서|으로|이랑|하고|이나|라도|은|는|이|가|을|를|에|의|로|과|와|도|만|랑)$/;

/** 견줄 낱말들 — 한국어는 붙은 조사를 떼고, 로마자는 짧은 낱말을 뺀다 */
export function contentWords(text) {
    const out = new Set();
    for (const raw of String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
        if (/^[a-z0-9]+$/.test(raw)) { if (raw.length >= 4) out.add(raw); continue; }
        if (/^\d+$/.test(raw)) continue;
        const stem = raw.length >= 3 ? raw.replace(PARTICLE_TAIL, '') : raw;
        if (stem.length >= 2) out.add(stem);
    }
    return out;
}

/** text가 이 떡밥을 다루는가 — 떡밥의 낱말 가운데 둘 이상, 그리고 절반 이상이 글에 있어야 한다 */
export function mentionsThread(threadText, text) {
    const words = [...contentWords(threadText)];
    if (words.length < 2) return false;
    const hay = String(text ?? '').toLowerCase();
    const hits = words.filter(w => hay.includes(w)).length;
    return hits >= 2 && hits / words.length >= 0.5;
}

/**
 * 이번 기록에서 언급된 떡밥에 "본 턴"을 적고, 잠든 떡밥은 깨운다. 되돌리기용으로 이전 값을 남긴다.
 * 반환: { seen, woke }
 */
export function noteThreadSightings(locks, text, turn) {
    let seen = 0;
    let woke = 0;
    if (!String(text ?? '').trim()) return { seen, woke };
    for (const l of locks || []) {
        // 잠든 비밀·정보 격차도 다시 언급되면 깨운다
        if (!(THREAD_KINDS.includes(l.kind) || SECRET_KINDS.includes(l.kind)) || !['active', 'dormant'].includes(l.status)) continue;
        if (!mentionsThread(`${l.summary} ${l.latest?.text || ''}`, text)) continue;
        if (l.seenTurn !== turn) { l.seenPrev = l.seenTurn ?? null; l.seenTurn = turn; seen++; }
        if (l.status === 'dormant') { l.status = 'active'; l.wokeTurn = turn; woke++; }
    }
    return { seen, woke };
}

/** 떡밥이 마지막으로 움직인 턴 — 다시 적힌 때, 언급된 때, "지금"이 바뀐 때 가운데 가장 늦은 것 */
export function threadTouched(l) {
    return Math.max(l?.turnIndex || 0, l?.seenTurn || 0, l?.latest?.turn || 0);
}

/* ------------------------------------------------------------
 * 인물 특성 — 같은 말의 다른 꼴을 한 줄로
 *
 * 사서는 카드에 이미 있는 특성을 보지 못한 채 그때그때 적는다. 그래서 "체념"과 "체념적", "다혈질"과 "불같은 다혈질",
 * "독점욕"과 "독점욕이 강한"이 한 카드에 나란히 쌓이고, 매 턴 장부에 실려 토큰만 먹는다.
 * ------------------------------------------------------------ */

/** 낱말 끝의 꼴 — "~함 · ~한 · ~적 · ~스러운 · ~성 · ~증 · ~감"을 떼면 같은 말이다 (뗀 뒤 두 글자 이상 남을 때만) */
const TRAIT_SUFFIX = /(?:스러움|스러운|스럽다|스러워|스럽게|적인|적임|하다|하게|함|한|적|성|증|감)$/;
/** 꾸미는 말 — 관형형으로 끝나거나("불같은 · 강한 · 많은") 정도를 더하는 말 */
const TRAIT_MODIFIER = /[은는운한인의던운]$/;
const TRAIT_INTENSIFIER = new Set(['매우', '아주', '몹시', '꽤', '극도로', '극도의', '지나치게', '지독한', 'very', 'extremely', 'deeply', 'highly', 'quite', 'overly', 'fiercely']);
/** 정도를 말하는 뒷말 — "자존심 강함" · "질투심이 많음" · "겁이 많은"은 앞말과 같다 */
const TRAIT_DEGREE = /^(?:강함|강한|강하다|많음|많은|많다|심함|심한|심하다|높음|높은|큼|큰|넘침|넘치는|센|셈|대단함|대단한|지나침|지나친)$/;

function traitStem(word) {
    const w = String(word).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!/[가-힣]/.test(w)) return w.replace(/(?:ness|ful|ive|ous)$/, (m) => (w.length - m.length >= 4 ? '' : m));
    const cut = w.replace(TRAIT_SUFFIX, '');
    return cut.length >= 2 ? cut : w;
}

/**
 * 특성 하나를 견줄 꼴로. key: 낱말 줄기 전부, head: 꾸밈을 뗀 머리말 ("불같은 다혈질" → 다혈질, "독점욕이 강한" → 독점욕).
 * 세 낱말 이상이거나 꾸밈 꼴이 아니면 head 는 없다 — "다정함 뒤의 냉정함" 같은 묶음은 한 낱말과 같다고 보지 않는다.
 */
export function traitShape(trait) {
    const words = String(trait ?? '').toLowerCase().split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter(Boolean);
    const key = words.map(traitStem).join(' ');
    let head = '';
    if (words.length === 1) head = traitStem(words[0]);
    else if (words.length === 2) {
        const [a, b] = words;
        if (TRAIT_INTENSIFIER.has(a) || (/[가-힣]/.test(a) && TRAIT_MODIFIER.test(a) && a.length >= 2)) head = traitStem(b);              // 불같은 다혈질 · 매우 예민함
        else if (/[가-힣]{2,}[이가]$/.test(a) && (TRAIT_MODIFIER.test(b) || /[함음]$/.test(b))) head = traitStem(a.slice(0, -1));       // 독점욕이 강한 · 질투심이 많음
        else if (TRAIT_DEGREE.test(b)) head = traitStem(a);                                                                       // 자존심 강함 · 고집 센
    }
    return { key, head };
}

/** 두 특성이 같은 말인가 */
export function sameTrait(a, b) {
    const x = traitShape(a), y = traitShape(b);
    if (!x.key || !y.key) return false;
    if (x.key === y.key) return true;
    return !!(x.head && y.head && x.head === y.head && x.head.length >= 2);
}

/**
 * 특성 목록을 합친다. 같은 말이면 한 번만 — 더 짧은 쪽을 남기고 자리는 먼저 있던 쪽 그대로(장부의 줄이 흔들리지 않게).
 * 상한을 넘으면 이번에 다시 적히지 않은 옛 것부터 뺀다 — 처음 받은 열 개가 영영 자리를 차지해 새 특성이 못 들어오던 것을 막는다.
 * 반환: 새 배열 (입력은 건드리지 않는다)
 */
export function mergeTraits(existing, incoming = [], max = 10) {
    const out = [];
    const put = (t, fresh) => {
        const text = String(t ?? '').trim();
        if (!text) return;
        const i = out.findIndex(x => sameTrait(x.text, text));
        if (i < 0) { out.push({ text, fresh }); return; }
        if ([...text].length < [...out[i].text].length) out[i].text = text;
        if (fresh) out[i].fresh = true;
    };
    for (const t of existing || []) put(t, false);
    for (const t of incoming || []) put(t, true);
    while (out.length > max) {
        const stale = out.findIndex(x => !x.fresh);
        out.splice(stale >= 0 ? stale : 0, 1);
    }
    return out.map(x => x.text);
}

/* ------------------------------------------------------------
 * 드문 낱말 회상
 *
 * "그 나침반 아직 있어?"의 "나침반"처럼 서고 전체에서 몇 번 안 나오는 낱말은, 그 낱말이 든 기억을
 * 가리키는 아주 강한 단서다. 흔한 낱말(이름, "오늘", "말했다")은 아무것도 가리키지 않는다.
 * 기억마다 그 낱말이 몇 개의 기억에 나오는지 세어, 드문 낱말이 닿은 기억을 끌어올린다.
 * ------------------------------------------------------------ */

/**
 * queryText의 낱말 가운데 docs(기억 색인 글, 소문자) 몇 개에만 나오는 드문 것들. 반환: [{ word, idf }]
 * share: 전체의 이 비율 이하에 나와야 드물다 (최소 1개). 기억이 적으면(8개 미만) 드물다는 말이 의미가 없어 빈 배열.
 */
export function rareQueryWords(queryText, docs, { share = 0.05, minDocs = 8 } = {}) {
    const n = docs.length;
    if (n < minDocs) return [];
    const limit = Math.max(1, Math.floor(n * share));
    const out = [];
    for (const word of contentWords(queryText)) {
        let df = 0;
        for (const d of docs) { if (d.includes(word) && ++df > limit) break; }
        if (df >= 1 && df <= limit) out.push({ word, idf: Math.log((n + 1) / df) });
    }
    return out;
}

/* ------------------------------------------------------------
 * 어긋난 기록 찾기 — 같은 사람에 대해 서로 다른 말을 하는 기록
 *
 * 캐논·상태·인물 카드·사실 기억은 따로 쌓이므로, "키 170cm"와 "키 165cm", "술을 마신다"와
 * "술을 마시지 않는다"가 함께 서고에 남아 둘 다 AI에게 갈 수 있다. 모델을 부르지 않고 글자로 찾는다.
 * 찾은 것은 고치지 않고 보여 주기만 한다 — 어느 쪽이 맞는지는 사용자가 고른다.
 * ------------------------------------------------------------ */

/* 한 사람에게 값이 하나뿐인 잣대 — 다르면 둘 중 하나는 틀렸다 */
const MEASURES = [
    ['age', /(\d{1,3})\s*(?:살|세(?!기)|years?[ -]old|y\/o|yo\b)/gi],
    ['height', /(\d{2,3}(?:\.\d)?)\s*(?:cm|센티(?:미터)?)/gi],
    ['weight', /(\d{2,3}(?:\.\d)?)\s*(?:kg|킬로(?:그램)?)/gi],
];
export function measuresIn(text) {
    const out = {};
    for (const [kind, re] of MEASURES) {
        for (const m of String(text ?? '').matchAll(re)) (out[kind] ||= new Set()).add(String(Number(m[1])));
    }
    return out;
}

const NEGATION_RE = /(못\s?하|못\S|않|없|아니|안\s|\bnot\b|n't\b|\bnever\b|\bno longer\b|\bcannot\b|\bwithout\b)/i;
export function negated(text) {
    return NEGATION_RE.test(String(text ?? ''));
}

/** 부정하는 말을 뗀다 — "마시지 않는다" → "마시", "cannot swim" → "swim" */
export function stripNegation(text) {
    return String(text ?? '')
        .replace(/\s*지\s*(?:않|못)\S*/g, '')
        .replace(/(^|\s)(?:안|못)\s+/g, '$1')
        .replace(/\s*(?:않|못하|없|아니)\S*/g, '')
        .replace(/\b(?:can't|cannot|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|not|never|no longer)\b/gi, ' ')
        .replace(/n't\b/gi, '');
}

const bigramsOf = (text, drop) => {
    let s = String(text ?? '').toLowerCase();
    for (const d of drop) if (d) s = s.split(d).join(' ');
    s = s.replace(/[^\p{L}\p{N}]+/gu, '');
    const g = new Set();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
};

/**
 * claims: [{ key, about, text, turn }] — about은 그 기록이 다루는 사람(정식 이름 키).
 * names: 견줄 때 빼고 볼 이름들(모든 기록에 나오므로 겹쳐도 아무 뜻이 없다). ignore: 사용자가 "둘 다 맞음"으로 넘긴 쌍.
 * 반환: [{ a, b, why }] — why: 'age' | 'height' | 'weight' | 'negation'
 */
export function findConflicts(claims, { names = [], ignore = [], perGroup = 60 } = {}) {
    const skip = new Set(ignore);
    const drop = [...new Set(names.map(n => String(n).toLowerCase()).filter(n => n.length >= 2))].sort((a, b) => b.length - a.length);
    const groups = new Map();
    for (const c of claims || []) {
        if (!c?.about || !String(c.text ?? '').trim()) continue;
        if (!groups.has(c.about)) groups.set(c.about, []);
        groups.get(c.about).push(c);
    }
    const out = [];
    const seen = new Set();
    for (const list of groups.values()) {
        const recent = list.sort((x, y) => (y.turn || 0) - (x.turn || 0)).slice(0, perGroup)
            .map(c => ({ c, m: measuresIn(c.text), neg: negated(c.text), g: bigramsOf(c.text, drop) }));
        for (let i = 0; i < recent.length; i++) {
            for (let j = i + 1; j < recent.length; j++) {
                const A = recent[i], B = recent[j];
                if (A.c.key === B.c.key) continue;
                const pair = [A.c.key, B.c.key].sort().join('|');
                if (skip.has(pair) || seen.has(pair)) continue;
                let why = '';
                for (const kind of ['age', 'height', 'weight']) {
                    const a = A.m[kind], b = B.m[kind];
                    // 한쪽에 값이 여럿이면(나이 차이, 두 사람의 키) 견주지 않는다
                    if (a?.size === 1 && b?.size === 1 && [...a][0] !== [...b][0]) { why = kind; break; }
                }
                if (!why && A.neg !== B.neg) {
                    // 부정한 쪽에서 부정하는 말을 떼어 낸 나머지가 다른 쪽에 거의 다 들어 있어야 같은 일을 두고 엇갈린 것이다
                    const [N, P] = A.neg ? [A, B] : [B, A];
                    const rest = bigramsOf(stripNegation(N.c.text), drop);
                    let hit = 0;
                    for (const x of rest) if (P.g.has(x)) hit++;
                    if (rest.size >= 2 && P.g.size >= 2 && hit / rest.size >= 0.66) why = 'negation';
                }
                if (!why) continue;
                seen.add(pair);
                out.push({ a: A.c, b: B.c, why, pair });
            }
        }
    }
    return out;
}

/* ------------------------------------------------------------
 * 거절 문구 · 숨긴 원문 되돌리기 · 원문 회상 · 표기만 다른 이름 · 서약 점검 차례 · 여러 인물을 맡는 카드
 * ------------------------------------------------------------ */
const REFUSAL_RE = new RegExp([
  "\\bi(?:'m| am)? (?:really |so |very )?sorry\\b",
  "\\bi apologi[sz]e\\b",
  "\\bi (?:can(?:'|no)?t|cannot|won'?t|will not|am unable to|am not able to|must decline to)\\b[^.\\n]{0,60}\\b(?:help|assist|continue|comply|provide|create|write|generate|summar|produce|fulfil|engage|process|do that|do this)",
  "\\b(?:unable|not able) to (?:help|assist|continue|comply|provide|create|write|generate|summar|produce|process)",
  "\\bas an ai\\b",
  "\\b(?:content|usage|safety) (?:policy|policies|guidelines?)\\b",
  "\\bi (?:must|have to) (?:decline|refuse)\\b",
  "죄송(?:하지만|합니다|해요|하나)",
  "(?:도와|요약해|작성해|생성해|제공해|진행해|계속해) ?(?:드릴|줄) ?수 ?(?:가 )?없",
  "(?:요청|내용)(?:을|은|에)[^.\\n]{0,24}(?:응할|처리할|수행할|따를) ?수 ?(?:가 )?없",
  "정책(?:상|에 따라|에 위배)",
  "申し訳(?:ありません|ございません)",
  "(?:お手伝い|対応|お応え|作成|要約)(?:する|は)?(?:こと(?:が|は))?できません",
  "(?:抱歉|对不起|很遗憾)[^。\\n]{0,24}(?:无法|不能)",
  "我(?:无法|不能)(?:协助|帮助|继续|提供|完成|生成|总结)"
].join("|"), "i");
function looksRefused(text, max = 1200) {
  const s = String(text ?? "").trim();
  return !!s && s.length <= max && REFUSAL_RE.test(s);
}
const BLOCK_ERR_RE = /content[ _-]?(?:filter|policy|management|moderation)|safety|blocked|prohibited|recitation|refus|flagged|moderation|responsible ai|harm_category|finish_?reason[^a-z]{0,6}(?:safety|content|prohibited)/i;
function looksBlocked(err) {
  const e = err;
  if (!e || e.name === "AbortError") return false;
  const s = String(e.message ?? e);
  return !/\b(?:401|403|429)\b|api[ _-]?key|unauthori|rate limit|quota|timeout|network|failed to fetch/i.test(s) && BLOCK_ERR_RE.test(s);
}
function strayHidden(flags, coveredTo, preserve) {
  const end = Math.min(coveredTo, flags.length - Math.max(1, Math.round(preserve) || 1) - 1), out = [];
  for (let i = Math.max(0, end + 1); i < flags.length; i++) if (flags[i]) out.push(i);
  return out;
}
const transcriptTerms = (text) => contentWords(text);
function pickTranscript(lines, queries, { max = 1, size = 2, minScore = 0.34, minTerms = 2, names = [], mute = [] } = {}, terms) {
  const rows = (lines || []).filter((l) => l && String(l.text || "").trim());
  if (!rows.length || max <= 0) return [];
  const drop = /* @__PURE__ */ new Set();
  for (const n2 of names) for (const w of contentWords(n2)) drop.add(w);
  const q = /* @__PURE__ */ new Set();
  for (const text of queries) for (const w of contentWords(text)) if (!drop.has(w)) q.add(w);
  if (q.size < minTerms) return [];
  const of = terms || ((l) => transcriptTerms(l.text)), sets = rows.map(of);
  const n = Math.max(1, Math.round(size)), wins = [];
  for (let a = 0; a < rows.length; a += 1) {
    let b = a;
    while (b + 1 < rows.length && b - a + 1 < n && rows[b + 1].i - rows[b].i <= 2) b++;
    const has = /* @__PURE__ */ new Set();
    for (let k = a; k <= b; k++) for (const w of q) if (sets[k].has(w)) has.add(w);
    if (has.size) wins.push({ a, b, has });
  }
  if (!wins.length) return [];
  const df = /* @__PURE__ */ new Map();
  for (const w of wins) for (const x of w.has) df.set(x, (df.get(x) || 0) + 1);
  const total = Math.max(wins.length, rows.length / n), idf = (x) => Math.log(1 + total / (df.get(x) || total));
  let mass = 0;
  for (const x of q) if (df.has(x)) mass += idf(x);
  const rareMax = Math.max(2, Math.ceil(total * 0.06)), low = (s) => String(s ?? "").toLowerCase(), muted = mute.map(low).filter((w) => w.length >= 2);
  const scored = wins.map((w) => {
    let hit = 0, rare = 0;
    for (const x of w.has) {
      hit += idf(x);
      if ((df.get(x) || 0) <= rareMax) rare++;
    }
    return { w, rare, score: mass ? hit / mass : 0 };
  }).filter((x) => x.rare >= 1 && x.w.has.size >= minTerms && x.score >= minScore).sort((x, y) => y.score - x.score || y.w.a - x.w.a);
  const out = [];
  for (const { w, score } of scored) {
    if (out.length >= max) break;
    const part = rows.slice(w.a, w.b + 1), from = part[0].i, to = part[part.length - 1].i;
    if (out.some((o) => from <= o.to + 1 && to >= o.from - 1)) continue;
    if (muted.length && muted.some((m) => part.some((l) => low(l.text).includes(m)))) continue;
    out.push({ from, to, lines: part, score, matched: [...w.has] });
  }
  return out.sort((x, y) => x.from - y.from);
}
const RR_LEAD = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const RR_MID = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const RR_TAIL = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
function romanize(text) {
  let out = "";
  for (const ch of String(text ?? "")) {
    const c = ch.codePointAt(0) - 44032;
    out += c < 0 || c > 11171 ? ch : RR_LEAD[Math.floor(c / 588)] + RR_MID[Math.floor(c % 588 / 28)] + RR_TAIL[c % 28];
  }
  return out;
}
const nameSkeleton = (name) => {
  const s = romanize(String(name ?? "").toLowerCase()).replace(/[^a-z]/g, "").replace(/ng/g, "N").replace(/ch/g, "j").replace(/sh/g, "s").replace(/[wy]/g, "").replace(/[gkq]/g, "k").replace(/[dt]/g, "t").replace(/[bpf]/g, "p").replace(/[rl]/g, "l").replace(/(.)\1+/g, "$1");
  const bones = s.replace(/[aeiou]+/g, "");
  return bones.length >= 2 ? `${bones}:${(s.match(/[aeiou]+/g) || []).length}` : "";
};
const hasHangul = (s) => /[가-힣]/.test(s), plainLatin = (s) => /[a-z]/i.test(s) && !/[^\x00-\x7fÀ-ɏ]/.test(s);
function crossScriptSame(a, b) {
  const x = String(a ?? "").trim(), y = String(b ?? "").trim();
  if (!x || !y || !(hasHangul(x) && plainLatin(y) || hasHangul(y) && plainLatin(x))) return false;
  const kx = nameSkeleton(x);
  return !!kx && kx === nameSkeleton(y);
}
function crossScriptPairs(names) {
  const out = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (crossScriptSame(names[i], names[j])) out.push([i, j]);
  return out;
}
function pickPledgesToCheck(locks, { text = "", turnNow = 0, cap = 12, near = 6 } = {}) {
  const active = (locks || []).filter((l) => l.status === "active");
  if (active.length <= cap) return active;
  const touched = (l) => Math.max(l.turn ?? 0, l.seenTurn ?? 0, l.latest?.turn ?? 0);
  const hot = active.filter((l) => turnNow - touched(l) <= 8 || !!text && mentionsThread(`${l.summary || ""} ${l.latest?.text || ""}`, text)).sort((a, b) => touched(b) - touched(a)).slice(0, Math.min(near, cap));
  const rest = active.filter((l) => !hot.includes(l)).sort((a, b) => (a.checkedTurn ?? -1) - (b.checkedTurn ?? -1) || touched(a) - touched(b)).slice(0, cap - hot.length);
  return active.filter((l) => hot.includes(l) || rest.includes(l));
}
function ensembleLabel(cardName, userName, cast, soloCard) {
  const card = String(cardName ?? "").trim(), key = (s) => String(s ?? "").toLowerCase().replace(/[\s._\-'"`]+/g, "");
  if (!soloCard || !card) return "";
  const others = cast.filter((c) => key(c.name) && key(c.name) !== key(userName));
  return others.length >= 2 && !others.some((c) => [c.name, ...c.aka || []].some((n) => key(n) === key(card))) ? card : "";
}
export {
  crossScriptPairs,
  crossScriptSame,
  ensembleLabel,
  looksBlocked,
  looksRefused,
  pickPledgesToCheck,
  pickTranscript,
  romanize,
  strayHidden,
  transcriptTerms
};
