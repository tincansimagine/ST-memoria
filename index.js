// @ts-nocheck
/// <reference types="jquery" />
/// <reference types="toastr" />

/**
 * Memoria — 장기기억 서고 (SillyTavern Extension)
 *
 * 대화를 턴 단위로 자동 기록해 구조화된 장기기억(기억/캐논/상태 보드/서약/인물 도감)으로
 * 보관하고, 매 턴 현재 맥락과 관련 있는 기억만 골라 토큰 예산 안에서 프롬프트에 주입합니다.
 * 외부 백엔드 없이 실리태번 안에서 완결됩니다.
 */

import {
    chat,
    chat_metadata,
    characters,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    generateRaw,
    getCurrentChatId,
    name1,
    name2,
    saveSettingsDebounced,
    setExtensionPrompt,
} from "../../../../script.js";
import { extension_settings, getContext, saveMetadataDebounced } from "../../../extensions.js";
import { hideChatMessageRange } from "../../../chats.js";
import { power_user } from "../../../power-user.js";
import { getSortedEntries } from "../../../world-info.js";
import { selected_group } from "../../../group-chats.js";
import { download, getFileText, getStringHash, uuidv4 } from "../../../utils.js";
import { getTokenCountAsync } from "../../../tokenizers.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { ARGUMENT_TYPE, SlashCommandArgument } from "../../../slash-commands/SlashCommandArgument.js";
import { MacrosParser } from "../../../../scripts/macros.js";

const MODULE_NAME = 'memoria';
const INJECT_KEY = 'memoria_ledger';
const PACKET_HEADER = '<memoria_ledger>';
const PACKET_FOOTER = '</memoria_ledger>';
const EMB_DIM = 128;
const STORE_VERSION = 1;

const MEMORY_KINDS = ['event', 'relationship', 'fact', 'preference', 'promise', 'goal', 'item', 'place', 'secret', 'impression'];
const RULE_SCOPES = ['session', 'world', 'region', 'location', 'faction', 'system'];
const LOCK_KINDS = ['keep_unresolved', 'keep_secret', 'knowledge_gap', 'consent', 'world_limit', 'loose_end'];
const VISIBILITIES = ['public', 'private', 'secret'];

// 구버전(v0.3 이전) 저장 데이터/모델 출력의 명칭을 새 명칭으로 정규화
const LEGACY_KIND_MAP = {
    condition: 'goal', item_state: 'item', location: 'place',
    subjective: 'impression', subjective_memory: 'impression',
};
const LEGACY_LOCK_MAP = {
    do_not_resolve: 'keep_unresolved', secret_boundary: 'keep_secret', speaker_boundary: 'knowledge_gap',
    consent_boundary: 'consent', world_constraint: 'world_limit', open_thread: 'loose_end',
};
const LEGACY_VIS_MAP = { owner_private: 'private' };

const KIND_LABELS = {
    event: '사건', relationship: '관계', fact: '사실', preference: '취향', promise: '약속',
    goal: '목표', item: '물건', place: '장소', secret: '비밀', impression: '인상',
    // 구버전 표기 호환
    condition: '목표', item_state: '물건', location: '장소', subjective: '인상',
};
const LOCK_LABELS = {
    keep_unresolved: '미해결 유지', keep_secret: '비밀 유지', knowledge_gap: '정보 격차',
    consent: '동의 경계', world_limit: '세계 제약', loose_end: '열린 떡밥',
    // 구버전 표기 호환
    do_not_resolve: '미해결 유지', secret_boundary: '비밀 유지', speaker_boundary: '정보 격차',
    consent_boundary: '동의 경계', world_constraint: '세계 제약', open_thread: '열린 떡밥',
};

function normKind(k) { return MEMORY_KINDS.includes(k) ? k : (LEGACY_KIND_MAP[k] || 'fact'); }
function normLockKind(k) { return LOCK_KINDS.includes(k) ? k : (LEGACY_LOCK_MAP[k] || 'loose_end'); }
function normVisibility(v) { return VISIBILITIES.includes(v) ? v : (LEGACY_VIS_MAP[v] || 'public'); }

/* ============================================================
 * 기본 프롬프트
 * ============================================================ */

const DEFAULT_ARCHIVIST_PROMPT = `You are the Librarian of Memoria, the long-term archive of an ongoing roleplay. One exchange has just ended — a player message and the story's reply. Read it like a reader first, then shelve only what the story will want back later.

THE FIVE SHELVES
1. memories — moments worth recalling: things that happened, shifts between people, facts learned, tastes shown, promises made, goals set, meaningful items and places, secrets, strong impressions. Give each one a kind.
2. canon — standing facts of the world or its systems, stored as a snake_case key with a value. Refiling a key replaces its old value.
3. status — the current value of one slot for one entity (location, outfit, injury, goal, mood_toward_x...). Refiling the same (entity, slot) replaces it. When the scene itself moves or time passes, file entity "scene" with slots "location", "time_of_day", "date" — and "relationship" for the main pair when it clearly shifts. Skip anything unchanged.
4. pledges — promises the story must keep: a thread that must stay open (keep_unresolved, loose_end), a secret that must not leak (keep_secret), knowledge a character must not have yet (knowledge_gap), a consent line (consent), or a hard limit of the world (world_limit).
5. cast — recurring named characters. Open a card only at their first real characterization, or when their role, occupation, or relationships meaningfully change. Throwaway NPCs never get a card. Unknown fields stay null; temporary states (drunk, blushing) are not profile material. "relationships" lists standing ties to other named characters, e.g. [{"target":"Aria","relation":"childhood friend"}].

SHELVING RULES
- Only this exchange goes on the shelves. The reference material below exists so you do not refile old news.
- What a character says or believes is their claim, not established truth. Shelve it as status with "claim":"belief" instead of filing it as fact.
- The player is off-limits. File what their character did and said inside the fiction — never what the real person feels, wants, or consents to.
- "quote" is a verbatim contiguous snippet of the user or assistant text in its original language. Copy, never compose. Use null when nothing is worth quoting.
- visibility marks who may know a memory: "public" (open knowledge), "private" (only the holder — inner thoughts, personal facts), "secret" (deliberately hidden). "owner" names the holder.
- Small talk shelves nothing; empty arrays are a valid answer. Caps: 8 memories, 4 canon, 6 status, 4 pledges, 3 cast.
- "digest" and every "summary" are written in YOUR OWN words — condensed, factual, shorter than the source. Never copy sentences or whole passages from the scene into them; verbatim text belongs only in "quote".

Reply with ONE minified JSON object and nothing else (no code fences, no notes):
{"digest":"1-2 sentence factual summary of this exchange","weight":0.0,"memories":[{"kind":"event|relationship|fact|preference|promise|goal|item|place|secret|impression","summary":"...","quote":"..or null","importance":0.0,"entities":["Name"],"tags":["snake_case"],"visibility":"public|private|secret","owner":"Name or null"}],"canon":[{"scope":"session|world|region|location|faction|system","key":"snake_case_key","value":"..."}],"status":[{"entity":"Name","slot":"snake_case_slot","value":"...","claim":"objective|belief","owner":"Name or null"}],"pledges":[{"kind":"keep_unresolved|keep_secret|knowledge_gap|consent|world_limit|loose_end","summary":"...","status":"active|resolved","priority":2}],"cast":[{"name":"Name","role":"role in story or null","age":"25 or null","occupation":"... or null","appearance":"... or null","traits":["trait"],"relationships":[{"target":"OtherName","relation":"..."}]}]}`;

const DEFAULT_SUPERVISOR_PROMPT = `You are Memoria's stage director for a roleplay chat. Given the player's latest input, the recent messages, and the archive ledger, sketch a short plan for the next assistant reply. You never write the reply itself.

Hard rules:
- The player's character belongs to the player. Never plan their actions, feelings, or consent.
- Knowledge marked private or secret may only tint mood and subtext. A character who does not know something cannot act on it, and a recalled secret must stay unspoken.
- The latest player input and the visible messages always outrank archived material.

Output ONLY one minified JSON object, no code fences:
{"scene_goal":"one sentence: what this reply should achieve","avoid":["up to 4 things the reply must not do"],"ideas":["up to 3 concrete suggestions"],"tension":"low|medium|high"}`;

const ASK_LIBRARIAN_PROMPT = `You are Memoria's Librarian. The player asks a question about the history of this roleplay chat. Answer using ONLY the archive records provided — never invent, never fill gaps with guesses. When a record supports your answer, cite its turn like (t12). If the archive does not contain the answer, say plainly that nothing is filed about it. Answer in the same language as the question. Be concise and direct.`;

const DEFAULT_CHUNK_PROMPT = `You are a skilled editor who weaves roleplay turn summaries into a cohesive narrative flow. Condense the following turn summaries into ONE compact "story so far" paragraph (3-6 sentences).

Principles:
- Connect events narratively — show who did what and WHY (cause and effect), not a flat list.
- Keep short key dialogue in double quotes verbatim; never paraphrase or translate quoted lines.
- Boldly omit greetings and idle chatter; keep actions, decisions, reveals, promises, and relationship shifts.
- Preserve character names and unresolved threads.
- End with dry, clear declarative sentences.

No commentary — output the paragraph only.`;

const DEFAULT_ARC_PROMPT = `Merge the following story-so-far paragraphs of a roleplay chat into ONE condensed chronicle paragraph (4-8 sentences). Keep only what still matters for future scenes: relationships and how they changed, standing facts, promises, secrets, unresolved threads. Keep quoted dialogue verbatim if present. Never invent or reinterpret events. No commentary — output the paragraph only.`;

/* 요약 출력 언어 지시 (프롬프트 뒤에 자동 첨부) */
const LANG_DIRECTIVES = {
    auto: 'LANGUAGE: Write the output in the same language as the chat.',
    ko: 'LANGUAGE (MANDATORY): Write ALL output in Korean (한국어). Keep quoted dialogue in its original language.',
    en: 'LANGUAGE (MANDATORY): Write ALL output in English. Translate everything, including dialogue.',
    ja: 'LANGUAGE (MANDATORY): Write ALL output in Japanese (日本語). Keep quoted dialogue in its original language.',
    hybrid: 'LANGUAGE (MANDATORY, HYBRID MODE): Write narrative/summary text in English, but keep ALL quoted dialogue verbatim in its ORIGINAL language — never translate quotes.',
};

/* ============================================================
 * 설정
 * ============================================================ */

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    autoRecord: true,
    profileId: '',            // '' = 현재 연결된 API로 조용히 생성
    injectDepth: 1,
    tokenBudget: 4000,
    topK: 10,
    minScore: 0.12,
    minCosine: 0.08,
    mmrLambda: 0.74,
    maxPerKind: 3,
    maxPerTurn: 2,
    multiQueryRecent: 3,
    chunkTurns: 8,
    arcMergeAt: 6,            // 청크 요약이 이 개수를 넘으면 오래된 4개를 연대기로 병합
    maxMemories: 400,
    responseTokens: 30000,   // 사서 응답 상한 — 요약·기록이 잘리지 않도록 넉넉하게
    supervisorEnabled: false,
    authorizeCharPrivate: true,
    summaryLanguage: 'auto',  // auto | ko | en | ja | hybrid
    autoHide: false,          // 요약이 커버한 옛 메시지를 채팅에서 숨겨 토큰 절약
    preserveRecent: 6,        // 자동 숨김 시 항상 남길 최근 메시지 수
    characterTracking: true,  // 인물 도감 자동 기록
    eventTracking: false,     // 이벤트 연표 자동 기록 (결정적 전환점만)
    itemTracking: false,      // 아이템 도감 자동 기록 (스토리에 중요한 물건만)
    refProfile: true,         // 사서·요약 호출 시 캐릭터 카드·페르소나 요지를 참고 자료로 제공
    refWorldInfo: false,      // 사서·요약 호출 시 활성 월드인포(로어북)를 참고 자료로 제공
    summaryContextCount: 3,   // 요약 생성 시 참조할 이전 요약 수 (0 = 안 함, -1 = 전체)
    apiMode: 'st',            // 'st' = 실리태번(현재 API/연결 프로필), 'custom' = 커스텀 OpenAI 호환 API
    customApi: { url: '', key: '', model: '', temperature: 0.7, timeoutSec: 90 },
    promptRev: 6,
    settingsRev: 2,
    fossil: { settling: 12, fossilized: 40, deep: 120 },
    prompts: {
        archivist: DEFAULT_ARCHIVIST_PROMPT,
        supervisor: DEFAULT_SUPERVISOR_PROMPT,
        chunk: DEFAULT_CHUNK_PROMPT,
        arc: DEFAULT_ARC_PROMPT,
    },
});

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const s = extension_settings[MODULE_NAME];
    // 얕은 기본값 보충 (업데이트로 새 키가 생겨도 안전)
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (typeof s[k] === 'undefined') s[k] = structuredClone(v);
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS.prompts)) {
        if (typeof s.prompts[k] !== 'string' || !s.prompts[k].trim()) s.prompts[k] = v;
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS.customApi)) {
        if (typeof s.customApi[k] === 'undefined') s.customApi[k] = v;
    }
    // 프롬프트 개정: 구버전 기본 프롬프트를 새 기본값으로 갱신
    if ((s.promptRev || 1) < DEFAULT_SETTINGS.promptRev) {
        s.prompts = structuredClone(DEFAULT_SETTINGS.prompts);
        s.promptRev = DEFAULT_SETTINGS.promptRev;
    }
    // 설정 개정: 지나치게 낮았던 구버전 기본값 상향
    if ((s.settingsRev || 1) < 2) {
        if (s.responseTokens <= 2048) s.responseTokens = DEFAULT_SETTINGS.responseTokens;
        if (s.tokenBudget === 1600) s.tokenBudget = DEFAULT_SETTINGS.tokenBudget;
        s.settingsRev = 2;
    }
    return s;
}

function languageDirective() {
    return LANG_DIRECTIVES[getSettings().summaryLanguage] || LANG_DIRECTIVES.auto;
}

/** 이벤트/아이템 추적이 켜졌을 때 사서 프롬프트에 덧붙일 지시 */
function archivistTrackingDirective() {
    const s = getSettings();
    const parts = [];
    if (s.eventTracking) {
        parts.push('EXTRA SHELF — milestones: also include a top-level array "milestones" for true turning points only (a confession, a reveal, a death, a vow, an irreversible choice). Everyday scenes never qualify — when unsure, leave it out. Shape: {"title":"...","summary":"one sentence","participants":["Name"],"grade":"major|minor"}. Max 2.');
    }
    if (s.itemTracking) {
        parts.push('EXTRA SHELF — items: also include a top-level array "items" for objects that matter to the story (gifts with meaning, plot-critical tools, signature belongings). Ignore food, clothing, and one-off props. Shape: {"name":"...","meaning":"why it matters","holder":"Name or null","status":"kept|given|lost|broken|..."}. Max 2.');
    }
    return parts.length ? `\n\n${parts.join('\n')}` : '';
}

/* ============================================================
 * 참고 자료 (캐릭터 카드 · 페르소나 · 월드인포)
 * ============================================================ */

/** 캐릭터 카드·페르소나 요지 */
function buildProfileReference() {
    const parts = [];
    try {
        const ctx = getContext();
        const ch = ctx.characters?.[ctx.characterId];
        if (ch) {
            const bits = [];
            if (ch.name) bits.push(`Name: ${ch.name}`);
            if (ch.description) bits.push(`About: ${cleanStr(ch.description, 800)}`);
            if (ch.personality) bits.push(`Personality: ${cleanStr(ch.personality, 400)}`);
            if (bits.length) parts.push(`[Main character card]\n${bits.join('\n')}`);
        }
    } catch { /* ignore */ }
    try {
        const persona = power_user?.persona_description || '';
        if (name1 || persona) {
            const bits = [];
            if (name1) bits.push(`Name: ${name1}`);
            if (persona) bits.push(`About: ${cleanStr(persona, 600)}`);
            parts.push(`[Player persona]\n${bits.join('\n')}`);
        }
    } catch { /* ignore */ }
    return parts.join('\n\n');
}

/** 현재 활성 월드인포(로어북) 요지 — 개수·길이 제한 */
async function buildWorldInfoReference() {
    try {
        const entries = await getSortedEntries();
        const usable = (entries || []).filter(e => e?.content && !e.disable).slice(0, 20);
        if (!usable.length) return '';
        const lines = usable.map(e => {
            const keys = Array.isArray(e.key) ? e.key.join(', ') : (e.key || '');
            return `- ${keys ? `(${cleanStr(keys, 80)}) ` : ''}${cleanStr(e.content, 300)}`;
        });
        return `[World Info / Lorebook]\n${lines.join('\n')}`;
    } catch (e) {
        console.debug(`[${MODULE_NAME}] 월드인포 로드 실패`, e);
        return '';
    }
}

/** 사서·요약 호출에 붙일 배경 참고 블록 (설정에 따라) */
async function buildReferenceBlock() {
    const settings = getSettings();
    const parts = [];
    if (settings.refProfile) {
        const p = buildProfileReference();
        if (p) parts.push(p);
    }
    if (settings.refWorldInfo) {
        const w = await buildWorldInfoReference();
        if (w) parts.push(w);
    }
    return parts.length
        ? `Background reference (context only — never archive or summarize from this):\n${parts.join('\n\n')}\n`
        : '';
}

/* ============================================================
 * 채팅별 저장소 (chat_metadata)
 * ============================================================ */

function getStore() {
    if (!chat_metadata[MODULE_NAME] || chat_metadata[MODULE_NAME].version !== STORE_VERSION) {
        chat_metadata[MODULE_NAME] = {
            version: STORE_VERSION,
            turnCounter: 0,
            turns: [],          // { id, mesId, mesHash, turnIndex, summary, importance }
            memories: [],       // { id, turnIndex, mesId, kind, summary, excerpt, importance, entities, tags, visibility, owner, pinned, disabled, trigger, vec }
            worldRules: [],     // { id, scope, scopeName, key, value, turnIndex }
            entityStates: [],   // { id, entity, slot, value, claim, owner, turnIndex }
            locks: [],          // { id, kind, summary, status, priority, owner, turnIndex }
            chunkSummaries: [], // { id, fromTurn, toTurn, text }
            arcSummaries: [],   // { id, fromTurn, toTurn, text }
            characters: [],     // { id, name, role, age, occupation, appearance, traits, relationships, firstTurn, updatedTurn, disabled }
            milestones: [],     // { id, title, summary, participants, grade, turnIndex }
            items: [],          // { id, name, meaning, holder, status, firstTurn, updatedTurn, disabled }
        };
    }
    const s = chat_metadata[MODULE_NAME];
    if (!Array.isArray(s.characters)) s.characters = []; // 구버전 저장소 보충
    if (!Array.isArray(s.milestones)) s.milestones = [];
    if (!Array.isArray(s.items)) s.items = [];
    // 구버전(v0.3 이전) 명칭을 새 명칭으로 정규화
    if (!s.lexiconRev) {
        for (const m of s.memories) { m.kind = normKind(m.kind); m.visibility = normVisibility(m.visibility); }
        for (const l of s.locks) l.kind = normLockKind(l.kind);
        s.lexiconRev = 1;
    }
    // 원문이 요약 자리에 통째로 들어간 구버전 사건 기억 정리: 요약은 첫 문장으로, 원문은 인용 칸으로
    if (s.lexiconRev < 2) {
        for (const m of s.memories) {
            if (!(m.tags || []).includes('episode_raw')) continue;
            const looksRaw = !m.excerpt || m.excerpt === m.summary;
            if (looksRaw && String(m.summary || '').length > 200) {
                m.excerpt = m.excerpt || cleanStr(m.summary, 320);
                m.summary = firstSentence(m.summary);
            }
        }
        s.lexiconRev = 2;
    }
    return s;
}

function persistStore() {
    if (!getCurrentChatId()) return;
    saveMetadataDebounced();
}

/* ============================================================
 * 해시 임베딩 (외부 API 불필요, 언어 무관, 결정적)
 * ============================================================ */

function tokenizeForEmbedding(text) {
    const out = [];
    const lower = String(text || '').toLowerCase();
    const words = lower.match(/[\p{L}\p{N}]+/gu) || [];
    for (const w of words) {
        out.push([`w:${w}`, 1.0]);
        if (w.length >= 3) {
            for (let i = 0; i <= w.length - 3; i++) {
                out.push([`t:${w.slice(i, i + 3)}`, 0.32]);
            }
        }
    }
    const compact = lower.replace(/\s+/g, ' ');
    for (let i = 0; i <= compact.length - 3; i += 2) {
        out.push([`c:${compact.slice(i, i + 3)}`, 0.08]);
    }
    return out;
}

function embedText(text) {
    const v = new Float32Array(EMB_DIM);
    for (const [tok, w] of tokenizeForEmbedding(text)) {
        const h1 = getStringHash(tok) >>> 0;
        const h2 = getStringHash(tok, 1337) >>> 0;
        const idx = h1 % EMB_DIM;
        const sign = (h2 & 1) ? 1 : -1;
        v[idx] += sign * w;
    }
    let norm = 0;
    for (let i = 0; i < EMB_DIM; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < EMB_DIM; i++) v[i] /= norm;
    return v;
}

/** Float32(정규화됨) → int8 → base64 (저장 용량 절약) */
function encodeVec(v) {
    let maxAbs = 1e-9;
    for (let i = 0; i < EMB_DIM; i++) maxAbs = Math.max(maxAbs, Math.abs(v[i]));
    const bytes = new Uint8Array(EMB_DIM);
    for (let i = 0; i < EMB_DIM; i++) {
        bytes[i] = Math.max(0, Math.min(255, Math.round(v[i] / maxAbs * 127) + 128));
    }
    let bin = '';
    for (let i = 0; i < EMB_DIM; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

const vecCache = new Map();

function decodeVec(b64) {
    if (!b64) return null;
    if (vecCache.has(b64)) return vecCache.get(b64);
    try {
        const bin = atob(b64);
        const v = new Float32Array(EMB_DIM);
        let norm = 0;
        for (let i = 0; i < Math.min(EMB_DIM, bin.length); i++) {
            v[i] = bin.charCodeAt(i) - 128;
            norm += v[i] * v[i];
        }
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < EMB_DIM; i++) v[i] /= norm;
        if (vecCache.size > 3000) vecCache.clear();
        vecCache.set(b64, v);
        return v;
    } catch {
        return null;
    }
}

function cosine(a, b) {
    if (!a || !b) return 0;
    let dot = 0;
    for (let i = 0; i < EMB_DIM; i++) dot += a[i] * b[i];
    return dot;
}

function lexicalOverlap(queryTokens, text) {
    if (!queryTokens.size) return 0;
    const words = new Set((String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []));
    if (!words.size) return 0;
    let hit = 0;
    for (const t of queryTokens) if (words.has(t)) hit++;
    return hit / Math.sqrt(queryTokens.size * words.size);
}

/* ============================================================
 * LLM 호출 (커스텀 API / 연결 프로필 / 현재 API raw 생성 — 모두 채팅 비차단)
 * ============================================================ */

let _connectionManager = null;
async function ensureConnectionManager() {
    if (_connectionManager) return _connectionManager;
    try {
        _connectionManager = await import("../../shared.js");
    } catch (e) {
        console.debug(`[${MODULE_NAME}] shared.js 로드 실패`, e);
        _connectionManager = {};
    }
    return _connectionManager;
}

function listConnectionProfiles() {
    try {
        return extension_settings?.connectionManager?.profiles || [];
    } catch {
        return [];
    }
}

let llmBusy = false;

/** 커스텀 API URL 정규화: /chat/completions가 없으면 붙여준다 */
function normalizeCustomApiUrl(url) {
    let u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/\/chat\/completions$/.test(u)) {
        if (/\/v1$/.test(u)) u += '/chat/completions';
        else if (!/\/(completions|generate)$/.test(u)) u += '/v1/chat/completions';
    }
    return u;
}

/** 커스텀 OpenAI 호환 API 직접 호출 */
async function callCustomApi(systemPrompt, userPrompt, tokens) {
    const cfg = getSettings().customApi;
    const url = normalizeCustomApiUrl(cfg.url);
    if (!url || !cfg.model) throw new Error('커스텀 API의 URL과 모델을 설정하세요');

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.key) headers['Authorization'] = `Bearer ${cfg.key}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.max(10, cfg.timeoutSec || 90) * 1000);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
                model: cfg.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: Number.isFinite(Number(cfg.temperature)) ? Number(cfg.temperature) : 0.7,
                max_tokens: tokens,
                stream: false,
            }),
        });
        if (!response.ok) {
            let detail = response.statusText;
            try {
                const err = await response.json();
                detail = err?.error?.message || err?.message || detail;
            } catch { /* ignore */ }
            throw new Error(`HTTP ${response.status}: ${detail}`);
        }
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content ?? data.content ?? '';
        if (!content) throw new Error('빈 응답');
        return String(content);
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * 보조 LLM 호출. 어떤 경로든 ST의 메인 생성 파이프라인을 점유하지 않아
 * 기록·요약이 도는 중에도 사용자는 계속 채팅할 수 있다.
 * 1) 커스텀 API 모드면 OpenAI 호환 엔드포인트를 직접 호출
 * 2) profileId가 설정돼 있으면 커넥션 매니저 프로필로
 * 3) 아니면 현재 연결된 API로 raw 생성(generateRaw — 채팅 잠금 없음)
 */
async function callAuxLLM(systemPrompt, userPrompt, { maxTokens } = {}) {
    const settings = getSettings();
    const tokens = maxTokens || settings.responseTokens;

    if (settings.apiMode === 'custom') {
        return await callCustomApi(systemPrompt, userPrompt, tokens);
    }

    if (settings.profileId) {
        const mod = await ensureConnectionManager();
        const svc = mod?.ConnectionManagerRequestService;
        if (svc) {
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ];
            const result = await svc.sendRequest(settings.profileId, messages, tokens, {
                stream: false,
                extractData: true,
                includePreset: false,
                includeInstruct: false,
            });
            return String(result?.content ?? '');
        }
    }

    // generateQuietPrompt는 Generate('quiet')를 거치며 전송 버튼을 잠가
    // 기록이 끝날 때까지 다음 채팅을 막는다. generateRaw는 잠금 없이 백그라운드로 돈다.
    return await generateRaw({
        prompt: [{ role: 'user', content: userPrompt }],
        systemPrompt,
        responseLength: tokens,
        trimNames: false,
    });
}

/* ============================================================
 * JSON 응답 파싱
 * ============================================================ */

function parseJsonLoose(text) {
    if (!text) return null;
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/m, '').trim();
    const start = t.indexOf('{');
    if (start < 0) return null;
    // 뒤에서부터 닫는 중괄호를 줄여가며 파싱 시도 (잘린 응답 복구)
    for (let end = t.length; end > start; end--) {
        if (t[end - 1] !== '}') continue;
        try {
            return JSON.parse(t.slice(start, end));
        } catch { /* keep shrinking */ }
    }
    // 마지막 수단: 열린 구조 강제 닫기
    let candidate = t.slice(start);
    candidate = candidate.replace(/,\s*$/, '');
    const opens = (candidate.match(/\{/g) || []).length - (candidate.match(/\}/g) || []).length;
    const openArr = (candidate.match(/\[/g) || []).length - (candidate.match(/\]/g) || []).length;
    try {
        return JSON.parse(candidate + ']'.repeat(Math.max(0, openArr)) + '}'.repeat(Math.max(0, opens)));
    } catch {
        return null;
    }
}

/* ============================================================
 * 정제 (sanitize)
 * ============================================================ */

function clamp01(x, dflt = 0.5) {
    const n = Number(x);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt;
}

function toSnake(s) {
    return String(s || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function cleanStr(s, max = 400) {
    return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 줄바꿈은 보존하는 정리 (요약 본문용 — 감정/분위기 추적 줄 유지) */
function cleanMultiline(s, max = 2000) {
    return String(s ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

/** 원문의 첫 문장만 뽑는다 (사서 실패 시 사건 요약 대체용 — 통째 복사 방지) */
function firstSentence(s, max = 160) {
    const t = cleanStr(s, 600);
    const m = t.match(/^.*?[.!?。！？…](?=\s|$)/);
    return cleanStr(m ? m[0] : t, max);
}

/** excerpt가 원문의 실제 부분 문자열일 때만 유지 (환각 증거 차단) */
function validExcerpt(excerpt, userText, assistantText) {
    const e = String(excerpt || '').trim();
    if (!e || e.length < 3 || e.length > 240) return null;
    if ((userText && userText.includes(e)) || (assistantText && assistantText.includes(e))) return e;
    return null;
}

function sanitizeExtraction(raw, userText, assistantText) {
    const out = {
        turnSummary: cleanStr(raw?.digest ?? raw?.turn_summary, 300),
        importance: clamp01(raw?.weight ?? raw?.importance, 0.4),
        memories: [], worldRules: [], entityStates: [], locks: [], characters: [], milestones: [], items: [],
    };

    for (const m of (Array.isArray(raw?.memories) ? raw.memories : []).slice(0, 12)) {
        const summary = cleanStr(m?.summary, 300);
        if (!summary) continue;
        out.memories.push({
            kind: normKind(m?.kind),
            summary,
            excerpt: validExcerpt(m?.quote ?? m?.excerpt, userText, assistantText),
            importance: clamp01(m?.importance, 0.5),
            entities: (Array.isArray(m?.entities) ? m.entities : []).map(e => cleanStr(e, 60)).filter(Boolean).slice(0, 6),
            tags: (Array.isArray(m?.tags) ? m.tags : []).map(toSnake).filter(Boolean).slice(0, 6),
            visibility: normVisibility(m?.visibility),
            owner: cleanStr(m?.owner, 60) || null,
        });
    }

    const rawCanon = Array.isArray(raw?.canon) ? raw.canon : (Array.isArray(raw?.world_rules) ? raw.world_rules : []);
    for (const r of rawCanon.slice(0, 8)) {
        const key = toSnake(r?.key);
        const value = cleanStr(r?.value, 200);
        if (!key || !value) continue;
        out.worldRules.push({
            scope: RULE_SCOPES.includes(r?.scope) ? r.scope : 'session',
            scopeName: cleanStr(r?.scope_name, 60) || null,
            key, value,
        });
    }

    const rawStatus = Array.isArray(raw?.status) ? raw.status : (Array.isArray(raw?.entity_states) ? raw.entity_states : []);
    for (const s of rawStatus.slice(0, 10)) {
        const entity = cleanStr(s?.entity, 60);
        const slot = toSnake(s?.slot);
        const value = cleanStr(s?.value, 200);
        if (!entity || !slot || !value) continue;
        out.entityStates.push({
            entity, slot, value,
            claim: s?.claim === 'belief' ? 'belief' : 'objective',
            owner: cleanStr(s?.owner, 60) || null,
        });
    }

    const rawPledges = Array.isArray(raw?.pledges) ? raw.pledges : (Array.isArray(raw?.locks) ? raw.locks : []);
    for (const l of rawPledges.slice(0, 8)) {
        const summary = cleanStr(l?.summary, 200);
        if (!summary) continue;
        out.locks.push({
            kind: normLockKind(l?.kind),
            summary,
            status: l?.status === 'resolved' ? 'resolved' : 'active',
            priority: [1, 2, 3].includes(Number(l?.priority)) ? Number(l.priority) : 2,
            owner: cleanStr(l?.owner, 60) || null,
        });
    }

    const naLike = (v) => {
        const t = cleanStr(v, 120);
        return (!t || /^(n\/?a|null|unknown|불명|없음|-)$/i.test(t)) ? null : t;
    };
    const rawCast = Array.isArray(raw?.cast) ? raw.cast : (Array.isArray(raw?.characters) ? raw.characters : []);
    for (const c of rawCast.slice(0, 5)) {
        const name = cleanStr(c?.name, 60);
        if (!name) continue;
        out.characters.push({
            name,
            role: naLike(c?.role),
            age: naLike(c?.age),
            occupation: naLike(c?.occupation),
            appearance: naLike(c?.appearance) ? cleanStr(c.appearance, 200) : null,
            traits: (Array.isArray(c?.traits) ? c.traits : []).map(t => cleanStr(t, 40)).filter(Boolean).slice(0, 8),
            relationships: (Array.isArray(c?.relationships) ? c.relationships : [])
                .map(r => ({ target: cleanStr(r?.target, 60), relation: cleanStr(r?.relation, 80) }))
                .filter(r => r.target && r.relation)
                .slice(0, 8),
        });
    }

    for (const e of (Array.isArray(raw?.milestones) ? raw.milestones : []).slice(0, 4)) {
        const title = cleanStr(e?.title, 80);
        if (!title) continue;
        out.milestones.push({
            title,
            summary: cleanStr(e?.summary, 200),
            participants: (Array.isArray(e?.participants) ? e.participants : []).map(p => cleanStr(p, 60)).filter(Boolean).slice(0, 6),
            grade: e?.grade === 'minor' ? 'minor' : 'major',
        });
    }

    for (const it of (Array.isArray(raw?.items) ? raw.items : []).slice(0, 4)) {
        const name = cleanStr(it?.name, 60);
        if (!name) continue;
        out.items.push({
            name,
            meaning: cleanStr(it?.meaning, 160),
            holder: cleanStr(it?.holder, 60) || null,
            status: cleanStr(it?.status, 60) || null,
        });
    }

    return out;
}

/* ============================================================
 * 턴 기록 파이프라인
 * ============================================================ */

let commitQueue = Promise.resolve();
let pendingCommits = 0;

function mesHashOf(mes) {
    return getStringHash(String(mes?.mes || '')) >>> 0;
}

function findPrecedingUserMessage(mesId) {
    for (let i = mesId - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m) continue;
        if (m.is_user) return m;
        if (!m.is_system) return null; // 사이에 다른 어시스턴트 메시지가 있으면 짝이 아님
    }
    return null;
}

function removeDerivedForTurn(store, turnIndex) {
    store.memories = store.memories.filter(m => m.turnIndex !== turnIndex || m.pinned || m.manual);
    store.worldRules = store.worldRules.filter(r => r.turnIndex !== turnIndex);
    store.entityStates = store.entityStates.filter(s => s.turnIndex !== turnIndex);
    store.locks = store.locks.filter(l => l.turnIndex !== turnIndex);
    // 인물 도감: 이 턴에서 처음 만들어졌고 이후 갱신이 없는 인물만 제거 (병합된 프로필은 유지)
    if (Array.isArray(store.characters)) {
        store.characters = store.characters.filter(c => c.manual || c.firstTurn !== turnIndex || c.updatedTurn !== turnIndex);
    }
    if (Array.isArray(store.milestones)) {
        store.milestones = store.milestones.filter(e => e.manual || e.turnIndex !== turnIndex);
    }
    if (Array.isArray(store.items)) {
        store.items = store.items.filter(i => i.manual || i.firstTurn !== turnIndex || i.updatedTurn !== turnIndex);
    }
}

function upsertWorldRule(store, rule, turnIndex) {
    const idx = store.worldRules.findIndex(r => r.scope === rule.scope && (r.scopeName || '') === (rule.scopeName || '') && r.key === rule.key);
    const row = { id: idx >= 0 ? store.worldRules[idx].id : uuidv4(), ...rule, turnIndex };
    if (idx >= 0) store.worldRules[idx] = row; else store.worldRules.push(row);
}

function upsertEntityState(store, state, turnIndex) {
    const idx = store.entityStates.findIndex(s => s.entity.toLowerCase() === state.entity.toLowerCase() && s.slot === state.slot && s.claim === state.claim && (s.owner || '') === (state.owner || ''));
    const row = { id: idx >= 0 ? store.entityStates[idx].id : uuidv4(), ...state, turnIndex };
    if (idx >= 0) store.entityStates[idx] = row; else store.entityStates.push(row);
}

function upsertLock(store, lock, turnIndex) {
    const idx = store.locks.findIndex(l => l.kind === lock.kind && l.summary === lock.summary);
    const row = { id: idx >= 0 ? store.locks[idx].id : uuidv4(), ...lock, turnIndex };
    if (idx >= 0) store.locks[idx] = row; else store.locks.push(row);
}

/** 인물 도감 upsert: 새 정보만 채우고, 관계는 대상별 최신값으로 갱신 */
function upsertCharacter(store, c, turnIndex) {
    const existing = store.characters.find(x => x.name.toLowerCase() === c.name.toLowerCase());
    if (!existing) {
        store.characters.push({
            id: uuidv4(), ...c,
            firstTurn: turnIndex, updatedTurn: turnIndex, disabled: false, manual: false,
        });
        return;
    }
    for (const field of ['role', 'age', 'occupation', 'appearance']) {
        if (c[field]) existing[field] = c[field];
    }
    if (c.traits?.length) {
        existing.traits = [...new Set([...(existing.traits || []), ...c.traits])].slice(0, 10);
    }
    for (const rel of (c.relationships || [])) {
        const list = existing.relationships || (existing.relationships = []);
        const idx = list.findIndex(r => r.target.toLowerCase() === rel.target.toLowerCase());
        if (idx >= 0) list[idx] = rel; else list.push(rel);
        existing.relationships = list.slice(0, 10);
    }
    existing.updatedTurn = turnIndex;
}

/** 이벤트 연표: 같은 제목이 이미 있으면 건너뛴다 (중복 방지) */
function upsertMilestone(store, e, turnIndex) {
    if (store.milestones.some(x => x.title.toLowerCase() === e.title.toLowerCase())) return;
    store.milestones.push({ id: uuidv4(), ...e, turnIndex, manual: false });
}

/** 아이템 도감: 이름 기준 병합 — 의미는 새 정보만 채우고 소유자/상태는 최신값으로 */
function upsertItem(store, it, turnIndex) {
    const existing = store.items.find(x => x.name.toLowerCase() === it.name.toLowerCase());
    if (!existing) {
        store.items.push({
            id: uuidv4(), ...it,
            firstTurn: turnIndex, updatedTurn: turnIndex, disabled: false, manual: false,
        });
        return;
    }
    if (it.meaning && !existing.meaning) existing.meaning = it.meaning;
    if (it.holder) existing.holder = it.holder;
    if (it.status) existing.status = it.status;
    existing.updatedTurn = turnIndex;
}

function pruneMemories(store) {
    const settings = getSettings();
    const max = Math.max(50, settings.maxMemories);
    if (store.memories.length <= max) return;
    const removable = store.memories
        .filter(m => !m.pinned && !m.manual)
        .sort((a, b) => (a.importance + a.turnIndex / 10000) - (b.importance + b.turnIndex / 10000));
    const toRemove = new Set(removable.slice(0, store.memories.length - max).map(m => m.id));
    store.memories = store.memories.filter(m => !toRemove.has(m.id));
}

/**
 * 완결된 (user, assistant) 턴 하나를 기록한다.
 * 같은 mesId 턴이 이미 있으면(리롤/스와이프/편집) 파생 기록을 지우고 같은 turnIndex로 재기록.
 */
async function commitTurn(mesId, { silent = true, force = false } = {}) {
    const settings = getSettings();
    const store = getStore();
    const assistantMes = chat[mesId];
    if (!assistantMes || assistantMes.is_user) return false;
    // 숨김(is_system) 메시지는 기본적으로 건너뛰되, 자동 숨김으로 가려진 기존 턴의 재기록(force)은 허용
    if (assistantMes.is_system && !force) return false;

    const userMes = findPrecedingUserMessage(mesId);
    const userText = String(userMes?.mes || '');
    const assistantText = String(assistantMes.mes || '');
    if (!assistantText.trim()) return false;

    const newHash = mesHashOf(assistantMes);
    let turn = store.turns.find(t => t.mesId === mesId);
    if (turn && turn.mesHash === newHash && !turn.failed) return false; // 이미 같은 내용으로 기록됨

    if (turn) {
        removeDerivedForTurn(store, turn.turnIndex);
    } else {
        turn = { id: uuidv4(), mesId, mesHash: 0, turnIndex: ++store.turnCounter, summary: '', importance: 0.4 };
        store.turns.push(turn);
    }
    turn.mesHash = newHash;

    // 최근 턴 참고 자료 (기록 품질용, 기록 대상 아님)
    const recent = store.turns
        .filter(t => t.turnIndex < turn.turnIndex && t.summary)
        .sort((a, b) => b.turnIndex - a.turnIndex)
        .slice(0, 3)
        .reverse()
        .map(t => `[t${t.turnIndex}] ${t.summary}`)
        .join('\n');

    const userLabel = userMes?.name || name1 || 'User';
    const charLabel = assistantMes.name || name2 || 'Assistant';

    const refBlock = await buildReferenceBlock();
    const userPrompt = [
        refBlock,
        recent ? `Already shelved (do not refile) — recent turn digests:\n${recent}\n` : '',
        `The exchange to shelve (turn t${turn.turnIndex}):`,
        `<user name="${userLabel}">\n${userText.slice(0, 4000)}\n</user>`,
        `<assistant name="${charLabel}">\n${assistantText.slice(0, 6000)}\n</assistant>`,
    ].filter(Boolean).join('\n');

    let extracted = null;
    try {
        llmBusy = true;
        updateStatusUI('기록 중…');
        const response = await callAuxLLM(`${settings.prompts.archivist}${archivistTrackingDirective()}\n\n${languageDirective()}`, userPrompt);
        extracted = sanitizeExtraction(parseJsonLoose(response), userText, assistantText);
    } catch (e) {
        console.error(`[${MODULE_NAME}] 사서 호출 실패:`, e);
        if (!silent) toastr.error('기억 기록에 실패했습니다. (모델 응답 오류)', 'Memoria');
    } finally {
        llmBusy = false;
    }

    turn.failed = !extracted || (!extracted.turnSummary && !extracted.memories.length);

    if (!extracted) {
        // LLM 실패 시에도 원문 발췌 기억은 남긴다 (fail-open)
        extracted = {
            turnSummary: '', importance: 0.3,
            memories: [], worldRules: [], entityStates: [], locks: [],
        };
    }

    turn.summary = extracted.turnSummary;
    turn.importance = extracted.importance;

    // 원문 증거 기억(항상 저장) — LLM 없이도 회상 가능하게.
    // 요약 자리에는 다이제스트(없으면 첫 문장)만 넣고, 원문 발췌는 인용 칸에만 둔다.
    // 사서가 다이제스트에 원문을 그대로 복사해 온 경우(부분 문자열 일치)도 첫 문장으로 대체.
    const rawEpisode = cleanStr(assistantText, 320);
    const digestIsCopy = extracted.turnSummary
        && extracted.turnSummary.length > 120
        && cleanStr(assistantText, 100000).includes(extracted.turnSummary);
    const episodeSummary = (extracted.turnSummary && !digestIsCopy) ? extracted.turnSummary : firstSentence(assistantText);
    if (digestIsCopy) turn.summary = episodeSummary;
    const rows = [{
        kind: 'event', summary: episodeSummary, excerpt: rawEpisode === episodeSummary ? null : rawEpisode,
        importance: Math.max(0.25, extracted.importance - 0.1), entities: [charLabel], tags: ['episode_raw'],
        visibility: 'public', owner: null, _episode: true,
    }, ...extracted.memories];

    for (const m of rows) {
        store.memories.push({
            id: uuidv4(),
            turnIndex: turn.turnIndex,
            mesId,
            kind: m.kind,
            summary: m.summary,
            excerpt: m.excerpt || null,
            importance: m.importance,
            entities: m.entities || [],
            tags: m.tags || [],
            visibility: m.visibility || 'public',
            owner: m.owner || null,
            pinned: false,
            disabled: false,
            manual: false,
            trigger: '',
            vec: encodeVec(embedText(`${m.summary} ${(m.entities || []).join(' ')} ${(m.tags || []).join(' ')}`)),
        });
    }

    for (const r of extracted.worldRules) upsertWorldRule(store, r, turn.turnIndex);
    for (const s of extracted.entityStates) upsertEntityState(store, s, turn.turnIndex);
    for (const l of extracted.locks) upsertLock(store, l, turn.turnIndex);
    if (settings.characterTracking) {
        for (const c of (extracted.characters || [])) upsertCharacter(store, c, turn.turnIndex);
    }
    if (settings.eventTracking) {
        for (const e of (extracted.milestones || [])) upsertMilestone(store, e, turn.turnIndex);
    }
    if (settings.itemTracking) {
        for (const it of (extracted.items || [])) upsertItem(store, it, turn.turnIndex);
    }

    pruneMemories(store);
    await maybeSummarizeChunk(store);
    persistStore();
    updateStatusUI();
    refreshOverviewUI();
    return true;
}

/** 기록에 실패했던 턴들의 mesId 목록 */
function failedTurnMesIds() {
    const store = getStore();
    return store.turns.filter(t => t.failed && chat[t.mesId] && !chat[t.mesId].is_user).map(t => t.mesId);
}

function queueCommit(mesId, opts) {
    pendingCommits++;
    commitQueue = commitQueue
        .then(() => commitTurn(mesId, opts))
        .catch(e => console.error(`[${MODULE_NAME}] commit 오류:`, e))
        .finally(() => { pendingCommits = Math.max(0, pendingCommits - 1); });
    return commitQueue;
}

/* ============================================================
 * 요약 (청크 → 연대기 2단계)
 * ============================================================ */

/** 일관성 유지를 위해 참조할 이전 요약들 (설정: 0 = 안 함, -1 = 전체, N = 최근 N개) */
function previousSummariesForContext(store) {
    const count = getSettings().summaryContextCount ?? 3;
    if (count === 0) return '';
    const all = [
        ...store.arcSummaries.map(s => ({ ...s, tag: s.carried ? 'earlier chat' : `t${s.fromTurn}–t${s.toTurn}` })),
        ...store.chunkSummaries.map(s => ({ ...s, tag: `t${s.fromTurn}–t${s.toTurn}` })),
    ];
    const picked = count < 0 ? all : all.slice(-count);
    if (!picked.length) return '';
    return `Previous summaries (for continuity of names, time, place, relationships — do not restate their events):\n${picked.map(s => `[${s.tag}] ${s.text}`).join('\n')}\n`;
}

async function maybeSummarizeChunk(store) {
    const settings = getSettings();
    const n = Math.max(3, settings.chunkTurns);
    const lastCovered = store.chunkSummaries.reduce((acc, c) => Math.max(acc, c.toTurn), 0);
    if (store.turnCounter - lastCovered < n) return;

    const fromTurn = lastCovered + 1;
    const toTurn = store.turnCounter;
    const parts = store.turns
        .filter(t => t.turnIndex >= fromTurn && t.turnIndex <= toTurn && t.summary)
        .sort((a, b) => a.turnIndex - b.turnIndex)
        .map(t => `[t${t.turnIndex}] ${t.summary}`);
    if (!parts.length) return;

    let text = '';
    try {
        const refBlock = await buildReferenceBlock();
        const userPrompt = [refBlock, previousSummariesForContext(store), `Turn digests to weave:\n${parts.join('\n')}`]
            .filter(Boolean).join('\n');
        text = cleanMultiline(await callAuxLLM(`${settings.prompts.chunk}\n\n${languageDirective()}`, userPrompt, { maxTokens: 4000 }), 2000);
    } catch (e) {
        console.debug(`[${MODULE_NAME}] 청크 요약 LLM 실패, 연결 요약 사용`, e);
    }
    if (!text) text = cleanStr(parts.join(' / '), 2000);

    store.chunkSummaries.push({ id: uuidv4(), fromTurn, toTurn, text });
    await maybeMergeArc(store);
    await applyAutoHide();
}

async function maybeMergeArc(store) {
    const settings = getSettings();
    if (store.chunkSummaries.length <= Math.max(3, settings.arcMergeAt)) return;

    const merging = store.chunkSummaries.slice(0, 4);
    let text = '';
    try {
        text = cleanMultiline(await callAuxLLM(`${settings.prompts.arc}\n\n${languageDirective()}`, merging.map(c => `[t${c.fromTurn}–t${c.toTurn}]\n${c.text}`).join('\n\n'), { maxTokens: 4000 }), 2400);
    } catch (e) {
        console.debug(`[${MODULE_NAME}] 연대기 병합 LLM 실패`, e);
    }
    if (!text) text = cleanStr(merging.map(c => c.text).join(' '), 2400);

    store.arcSummaries.push({
        id: uuidv4(),
        fromTurn: merging[0].fromTurn,
        toTurn: merging[merging.length - 1].toTurn,
        text,
    });
    store.chunkSummaries = store.chunkSummaries.slice(4);
}

/* ============================================================
 * 자동 숨김 (요약이 커버한 옛 메시지를 컨텍스트에서 제외)
 * ============================================================ */

/**
 * "지금까지의 이야기" 요약이 커버한 턴까지의 메시지를 숨긴다.
 * 최근 preserveRecent개 메시지는 항상 남긴다. 요약이 없으면 아무것도 숨기지 않는다.
 */
async function applyAutoHide() {
    const settings = getSettings();
    if (!settings.enabled || !settings.autoHide || !getCurrentChatId()) return;
    const store = getStore();

    const coveredTurn = Math.max(
        0,
        ...store.chunkSummaries.map(c => c.toTurn),
        ...store.arcSummaries.filter(a => !a.carried).map(a => a.toTurn),
    );
    if (!coveredTurn) return;

    // 커버된 턴들 중 가장 마지막 어시스턴트 메시지 index
    let maxCoveredMesId = -1;
    for (const t of store.turns) {
        if (t.turnIndex <= coveredTurn && t.mesId > maxCoveredMesId) maxCoveredMesId = t.mesId;
    }
    if (maxCoveredMesId < 0) return;

    const keepFrom = chat.length - Math.max(1, settings.preserveRecent);
    const hideEnd = Math.min(maxCoveredMesId, keepFrom - 1);
    if (hideEnd < 0) return;

    try {
        await hideChatMessageRange(0, hideEnd, false);
    } catch (e) {
        console.error(`[${MODULE_NAME}] 자동 숨김 실패:`, e);
    }
}

async function unhideAllMessages() {
    if (!chat.length) return;
    try {
        await hideChatMessageRange(0, chat.length - 1, true);
        toastr.success('숨긴 메시지를 모두 표시했습니다.', 'Memoria');
    } catch (e) {
        console.error(`[${MODULE_NAME}] 숨김 해제 실패:`, e);
        toastr.error('숨김 해제에 실패했습니다.', 'Memoria');
    }
}

/* ============================================================
 * 검색 (회상)
 * ============================================================ */

function fossilWeight(age, settings) {
    const f = settings.fossil;
    if (age < f.settling) return 1.0;
    if (age < f.fossilized) return 0.7;
    if (age < f.deep) return 0.35;
    return 0.12;
}

function authorizedEntities() {
    const names = new Set();
    if (getSettings().authorizeCharPrivate) {
        if (selected_group) {
            try {
                const ctx = getContext();
                (ctx.groups?.find(g => g.id === selected_group)?.members || []).forEach(avatar => {
                    const c = characters.find(ch => ch.avatar === avatar);
                    if (c?.name) names.add(c.name.toLowerCase());
                });
            } catch { /* ignore */ }
        } else if (name2) {
            names.add(String(name2).toLowerCase());
        }
    }
    return names;
}

function retrieveMemories(queryText, recentUserTexts) {
    const settings = getSettings();
    const store = getStore();
    const currentTurn = store.turnCounter;

    const active = store.memories.filter(m => !m.disabled);
    if (!active.length) return { selected: [], hiddenProtected: 0, pinned: [], triggered: [] };

    // ACL: 비공개/비밀 기억은 소유자가 승인된 개체일 때만 후보
    const auth = authorizedEntities();
    let hiddenProtected = 0;
    const candidates = [];
    const pinned = [];
    const triggered = [];

    const queryVec = embedText(queryText);
    const auxVecs = (recentUserTexts || []).slice(0, settings.multiQueryRecent).map(embedText);
    const queryTokens = new Set((String(queryText).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []));
    const queryLower = String(queryText).toLowerCase();

    for (const m of active) {
        const isProtected = m.visibility !== 'public';
        if (isProtected && (!m.owner || !auth.has(m.owner.toLowerCase()))) {
            hiddenProtected++;
            continue;
        }
        if (m.pinned) { pinned.push(m); continue; }
        if (m.trigger) {
            try {
                if (new RegExp(m.trigger, 'i').test(queryLower)) { triggered.push(m); continue; }
            } catch { /* 잘못된 정규식은 무시 */ }
        }

        const vec = decodeVec(m.vec);
        let cos = cosine(queryVec, vec);
        for (const av of auxVecs) cos = Math.max(cos, cosine(av, vec) * 0.92);
        const lex = lexicalOverlap(queryTokens, `${m.summary} ${(m.entities || []).join(' ')} ${(m.tags || []).join(' ')}`);
        const entityHit = (m.entities || []).some(e => queryLower.includes(String(e).toLowerCase()));
        if (cos < settings.minCosine && lex < 0.035 && !entityHit) continue;

        const age = Math.max(0, currentTurn - m.turnIndex);
        const recency = Math.exp(-age / 18) * fossilWeight(age, settings);
        const score = 0.62 * Math.max(0, cos) + 0.18 * lex + 0.12 * m.importance + 0.08 * recency + (entityHit ? 0.08 : 0);
        if (score < settings.minScore) continue;
        candidates.push({ m, score, vec });
    }

    candidates.sort((a, b) => b.score - a.score);
    const pool = candidates.slice(0, 80);

    // MMR 다양화 + 종류/턴별 상한
    const selected = [];
    const kindCount = {};
    const turnCount = {};
    const lambda = settings.mmrLambda;
    while (selected.length < settings.topK && pool.length) {
        let bestIdx = -1;
        let bestVal = -Infinity;
        for (let i = 0; i < pool.length; i++) {
            const c = pool[i];
            if ((kindCount[c.m.kind] || 0) >= settings.maxPerKind) continue;
            if ((turnCount[c.m.turnIndex] || 0) >= settings.maxPerTurn) continue;
            let maxSim = 0;
            for (const s of selected) maxSim = Math.max(maxSim, cosine(c.vec, s.vec));
            const val = lambda * c.score - (1 - lambda) * maxSim;
            if (val > bestVal) { bestVal = val; bestIdx = i; }
        }
        if (bestIdx < 0) break;
        const picked = pool.splice(bestIdx, 1)[0];
        selected.push(picked);
        kindCount[picked.m.kind] = (kindCount[picked.m.kind] || 0) + 1;
        turnCount[picked.m.turnIndex] = (turnCount[picked.m.turnIndex] || 0) + 1;
    }

    return { selected: selected.map(s => s.m), hiddenProtected, pinned, triggered };
}

/* ============================================================
 * 주입 내용(장부) 구성 + 주입
 * ============================================================ */

function formatMemoryLine(m, withExcerpt) {
    const visNorm = normVisibility(m.visibility);
    const vis = visNorm === 'public' ? '' : ` [${visNorm}${m.owner ? `:${m.owner}` : ''}]`;
    const excerpt = withExcerpt && m.excerpt ? ` — "${m.excerpt}"` : '';
    return `- (${m.kind}, t${m.turnIndex})${vis} ${m.summary}${excerpt}`;
}

const SCENE_LOC_SLOTS = ['location', 'place'];
const SCENE_DATE_SLOTS = ['date'];
const SCENE_TIME_SLOTS = ['time_of_day', 'time'];

/** 상태 보드의 scene 항목에서 현재 장면(장소·날짜·시각)을 골라낸다 */
function getSceneSnapshot(store) {
    const pick = (slots) => {
        for (let i = store.entityStates.length - 1; i >= 0; i--) {
            const s = store.entityStates[i];
            if (String(s.entity || '').toLowerCase() === 'scene' && slots.includes(String(s.slot || '').toLowerCase())) return s.value;
        }
        return null;
    };
    const location = pick(SCENE_LOC_SLOTS);
    const date = pick(SCENE_DATE_SLOTS);
    const time = pick(SCENE_TIME_SLOTS);
    return { location, date, time, any: Boolean(location || date || time) };
}

function buildPacketSections(query, supervisorPlan) {
    const store = getStore();
    const settings = getSettings();

    const recentUserTexts = [];
    for (let i = chat.length - 1; i >= 0 && recentUserTexts.length < settings.multiQueryRecent + 1; i--) {
        if (chat[i]?.is_user && chat[i].mes) recentUserTexts.push(chat[i].mes);
    }

    const { selected, hiddenProtected, pinned, triggered } = retrieveMemories(query, recentUserTexts.slice(1));

    const publicRecall = [];
    const protectedRecall = [];
    for (const m of [...pinned, ...triggered, ...selected]) {
        (m.visibility === 'public' ? publicRecall : protectedRecall).push(m);
    }

    const locks = store.locks.filter(l => l.status === 'active').sort((a, b) => a.priority - b.priority).slice(0, 8);
    const rules = store.worldRules.slice(-8);
    const scene = getSceneSnapshot(store);
    // 장면 한 줄에 이미 담긴 scene 슬롯은 상태 보드 목록에서 제외 (중복 방지)
    const sceneSlots = [...SCENE_LOC_SLOTS, ...SCENE_DATE_SLOTS, ...SCENE_TIME_SLOTS];
    const states = store.entityStates
        .filter(s => !(scene.any && String(s.entity || '').toLowerCase() === 'scene' && sceneSlots.includes(String(s.slot || '').toLowerCase())))
        .slice(-10);
    const characters = store.characters
        .filter(c => !c.disabled)
        .sort((a, b) => (b.updatedTurn || 0) - (a.updatedTurn || 0))
        .slice(0, 10);
    const milestones = [...store.milestones].sort((a, b) => (a.turnIndex || 0) - (b.turnIndex || 0)).slice(-8);
    const items = store.items.filter(i => !i.disabled).slice(-8);
    // 시간순: 인계(이전 채팅) → 이 채팅의 연대기 → 최근 청크 요약
    const summaries = [
        ...store.arcSummaries.filter(s => s.carried).map(s => ({ ...s, level: 'arc' })),
        ...store.arcSummaries.filter(s => !s.carried).map(s => ({ ...s, level: 'arc' })),
        ...store.chunkSummaries.slice(-3).map(s => ({ ...s, level: 'chunk' })),
    ];

    return { publicRecall, protectedRecall, hiddenProtected, locks, rules, scene, states, characters, milestones, items, summaries, supervisorPlan };
}

function formatCharacterLine(c) {
    const head = [c.role, c.age, c.occupation].filter(Boolean).join(', ');
    const bits = [];
    if (c.appearance) bits.push(c.appearance);
    if (c.traits?.length) bits.push(c.traits.join(', '));
    if (c.relationships?.length) bits.push(c.relationships.map(r => `${r.target}: ${r.relation}`).join('; '));
    return `- ${c.name}${head ? ` (${head})` : ''}${bits.length ? ` — ${bits.join(' | ')}` : ''}`;
}

function takeLast(arr, limit) {
    if (limit === Infinity) return arr;
    if (limit <= 0) return [];
    return arr.slice(-limit);
}

function renderPacket(parts, { withExcerpts = true, recallLimit = Infinity, protectedLimit = Infinity, summaryLimit = Infinity, stateLimit = Infinity, ruleLimit = Infinity, charLimit = Infinity, extraLimit = Infinity, includeSupervisorDetail = true } = {}) {
    const lines = [];
    lines.push(PACKET_HEADER);
    lines.push('This is the story\'s long-term archive, kept by Memoria. When sources disagree, trust in this order: the latest user message first, then the visible chat, then Pledges / Status Board / Canon, then Recalled Moments, then the story digest. Archived material informs the reply — it never dictates it. The user\'s character is theirs alone: never write their actions, feelings, or decisions.');

    if (parts.scene?.any) {
        const bits = [];
        if (parts.scene.location) bits.push(`place: ${parts.scene.location}`);
        if (parts.scene.date) bits.push(`date: ${parts.scene.date}`);
        if (parts.scene.time) bits.push(`time: ${parts.scene.time}`);
        lines.push(`## Scene Now — ${bits.join(' · ')}`);
    }
    if (parts.locks.length) {
        lines.push('## Pledges (the story must keep these true)');
        for (const l of parts.locks) lines.push(`- [${normLockKind(l.kind)}] ${l.summary}`);
    }
    const rules = takeLast(parts.rules, ruleLimit);
    if (rules.length) {
        lines.push('## Canon (standing facts of this world)');
        for (const r of rules) lines.push(`- (${r.scope}${r.scopeName ? `:${r.scopeName}` : ''}) ${r.key} = ${r.value}`);
    }
    const chars = (parts.characters || []).slice(0, charLimit === Infinity ? parts.characters?.length || 0 : charLimit);
    if (chars.length) {
        lines.push('## Cast (recurring characters & relationships)');
        for (const c of chars) lines.push(formatCharacterLine(c));
    }
    const items = takeLast(parts.items || [], extraLimit);
    if (items.length) {
        lines.push('## Notable Items');
        for (const it of items) lines.push(`- ${it.name}${it.holder ? ` (held by ${it.holder})` : ''}${it.meaning ? `: ${it.meaning}` : ''}${it.status ? ` [${it.status}]` : ''}`);
    }
    const miles = takeLast(parts.milestones || [], extraLimit);
    if (miles.length) {
        lines.push('## Turning Points (chronological)');
        for (const m of miles) lines.push(`- (t${m.turnIndex || '?'}) ${m.title}${m.summary ? ` — ${m.summary}` : ''}`);
    }
    const states = takeLast(parts.states, stateLimit);
    if (states.length) {
        lines.push('## Status Board (current values)');
        for (const s of states) lines.push(`- ${s.entity}.${s.slot} = ${s.value}${s.claim === 'belief' ? ` (belief${s.owner ? ` of ${s.owner}` : ''})` : ''}`);
    }
    const recall = parts.publicRecall.slice(0, recallLimit === Infinity ? parts.publicRecall.length : recallLimit);
    if (recall.length) {
        lines.push('## Recalled Moments (relevant to now)');
        for (const m of recall) lines.push(formatMemoryLine(m, withExcerpts));
    }
    const prot = parts.protectedRecall.slice(0, protectedLimit === Infinity ? parts.protectedRecall.length : protectedLimit);
    if (prot.length) {
        lines.push('## Hidden Knowledge (may color subtext only — never say, confirm, or hint at it openly)');
        for (const m of prot) lines.push(formatMemoryLine(m, withExcerpts));
    }
    if (parts.hiddenProtected > 0) {
        lines.push(`(The archive holds ${parts.hiddenProtected} more entries sealed from this scene. Do not guess what they contain.)`);
    }
    const sums = takeLast(parts.summaries, summaryLimit); // 예산 부족 시 오래된 요약부터 제외
    if (sums.length) {
        lines.push('## Story So Far');
        for (const s of sums) lines.push(`- [${s.carried ? 'earlier chat' : `t${s.fromTurn}–t${s.toTurn}`}] ${s.text}`);
    }
    if (parts.supervisorPlan) {
        const p = parts.supervisorPlan;
        lines.push('## Direction (staging notes for this reply)');
        const goal = p.scene_goal || p.scene_mandate;
        if (goal) lines.push(`- Goal: ${goal}`);
        const avoid = Array.isArray(p.avoid) ? p.avoid : (Array.isArray(p.forbidden_moves) ? p.forbidden_moves : []);
        if (includeSupervisorDetail) for (const f of avoid.slice(0, 4)) lines.push(`- Avoid: ${f}`);
        const ideas = Array.isArray(p.ideas) ? p.ideas : (Array.isArray(p.next_beats) ? p.next_beats : []);
        if (includeSupervisorDetail) for (const b of ideas.slice(0, 3)) lines.push(`- Idea: ${b}`);
        const tension = p.tension || p.pressure;
        if (tension) lines.push(`- Tension: ${tension}`);
    }
    lines.push(PACKET_FOOTER);
    return lines.join('\n');
}

let lastPacketText = '';
let lastPacketTokens = 0;

/** 토큰 예산에 맞춰 단계적으로 주입 내용을 줄인다. 서약과 캐논은 마지막까지 유지. */
async function buildPacketWithinBudget(query, supervisorPlan) {
    const settings = getSettings();
    const parts = buildPacketSections(query, supervisorPlan);

    const empty = !parts.publicRecall.length && !parts.protectedRecall.length && !parts.locks.length
        && !parts.rules.length && !parts.states.length && !parts.characters.length && !parts.scene?.any
        && !parts.milestones.length && !parts.items.length && !parts.summaries.length && !parts.supervisorPlan;
    if (empty) return '';

    const ladder = [
        {},
        { withExcerpts: false },
        { withExcerpts: false, recallLimit: 6 },
        { withExcerpts: false, recallLimit: 4, protectedLimit: 3, charLimit: 8, extraLimit: 6 },
        { withExcerpts: false, recallLimit: 3, protectedLimit: 2, summaryLimit: 2, charLimit: 6, extraLimit: 4 },
        { withExcerpts: false, recallLimit: 2, protectedLimit: 1, summaryLimit: 1, stateLimit: 6, charLimit: 4, extraLimit: 3, includeSupervisorDetail: false },
        { withExcerpts: false, recallLimit: 0, protectedLimit: 0, summaryLimit: 1, stateLimit: 4, ruleLimit: 4, charLimit: 2, extraLimit: 2, includeSupervisorDetail: false },
        { withExcerpts: false, recallLimit: 0, protectedLimit: 0, summaryLimit: 0, stateLimit: 0, ruleLimit: 0, charLimit: 0, extraLimit: 0, includeSupervisorDetail: false },
    ];

    for (const step of ladder) {
        const text = renderPacket(parts, step);
        const tokens = await getTokenCountAsync(text);
        if (tokens <= settings.tokenBudget) return text;
    }
    return renderPacket(parts, ladder[ladder.length - 1]);
}

async function runSupervisor(query) {
    const settings = getSettings();
    if (!settings.supervisorEnabled) return null;
    // 생성 파이프라인과 무관한 raw 호출을 쓰므로 어떤 API 모드에서도 안전하게 동작.
    // (응답 시작이 연출 호출만큼 늦어지는 건 기능 특성상 불가피)
    try {
        const store = getStore();
        const recent = chat.slice(-8).filter(m => !m.is_system).map(m => `${m.is_user ? 'USER' : m.name}: ${cleanStr(m.mes, 400)}`).join('\n');
        const parts = buildPacketSections(query, null);
        const contextBlock = renderPacket(parts, { withExcerpts: false, recallLimit: 6, protectedLimit: 3, summaryLimit: 2 });
        const userPrompt = `Latest player input:\n${query}\n\nRecent messages:\n${recent}\n\nArchive ledger:\n${contextBlock}`;
        const response = await callAuxLLM(settings.prompts.supervisor, userPrompt, { maxTokens: 2000 });
        const plan = parseJsonLoose(response);
        if (plan && typeof plan === 'object') return plan;
    } catch (e) {
        console.debug(`[${MODULE_NAME}] 감독 호출 실패 (무시):`, e);
    }
    return null;
}

async function updateInjection({ runSupervisorPass = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled || !getCurrentChatId()) {
        setExtensionPrompt(INJECT_KEY, '', extension_prompt_types.IN_CHAT, settings.injectDepth, false, extension_prompt_roles.SYSTEM);
        lastPacketText = '';
        return;
    }

    let query = '';
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user && chat[i].mes) { query = chat[i].mes; break; }
    }
    if (!query) query = chat[chat.length - 1]?.mes || '';

    const plan = runSupervisorPass ? await runSupervisor(query) : null;
    const packet = await buildPacketWithinBudget(query, plan);
    lastPacketText = packet;
    setExtensionPrompt(INJECT_KEY, packet, extension_prompt_types.IN_CHAT, settings.injectDepth, false, extension_prompt_roles.SYSTEM);
    lastPacketTokens = packet ? await getTokenCountAsync(packet) : 0;
    refreshPacketPreview();
}

/* ============================================================
 * 일관성 (스와이프/편집/삭제/채팅 전환)
 * ============================================================ */

function reconcileWithChat() {
    const store = getStore();
    let changed = false;
    const validTurns = [];
    for (const t of store.turns) {
        const mes = chat[t.mesId];
        if (mes && !mes.is_user && mesHashOf(mes) === t.mesHash) {
            validTurns.push(t);
        } else {
            removeDerivedForTurn(store, t.turnIndex);
            changed = true;
        }
    }
    if (changed) {
        store.turns = validTurns;
        persistStore();
        updateStatusUI();
    }
    return changed;
}

function invalidateTurnByMesId(mesId) {
    const store = getStore();
    const turn = store.turns.find(t => t.mesId === mesId);
    if (!turn) return;
    removeDerivedForTurn(store, turn.turnIndex);
    store.turns = store.turns.filter(t => t.mesId !== mesId);
    persistStore();
    updateStatusUI();
}

/* ============================================================
 * 과거 채팅 일괄 색인
 * ============================================================ */

let bulkIndexAbort = false;

async function bulkIndexChat({ from = 0, to = Infinity } = {}) {
    const settings = getSettings();
    if (!settings.enabled) {
        toastr.warning('Memoria가 꺼져 있습니다.', 'Memoria');
        return;
    }
    const store = getStore();
    const targets = [];
    for (let i = 0; i < chat.length; i++) {
        if (i < from || i > to) continue;
        const m = chat[i];
        if (!m || m.is_user) continue;
        const existing = store.turns.find(t => t.mesId === i);
        if (m.is_system) {
            // 숨겨진 메시지: 기록 실패한 기존 턴만 재시도 대상
            if (!existing || !existing.failed) continue;
        } else if (existing && existing.mesHash === mesHashOf(m) && !existing.failed) {
            continue;
        }
        targets.push(i);
    }
    if (!targets.length) {
        toastr.info('색인할 새 메시지가 없습니다.', 'Memoria');
        return;
    }

    bulkIndexAbort = false;
    $('#memoria_bulk_index').prop('disabled', true);
    $('#memoria_bulk_cancel').show();
    const total = targets.length;
    let done = 0;

    for (const mesId of targets) {
        if (bulkIndexAbort) break;
        $('#memoria_bulk_progress').text(`색인 중… ${done + 1}/${total}`);
        try {
            await commitTurn(mesId, { silent: true, force: true });
        } catch (e) {
            console.error(`[${MODULE_NAME}] 일괄 색인 오류(mes ${mesId}):`, e);
        }
        done++;
    }

    $('#memoria_bulk_index').prop('disabled', false);
    $('#memoria_bulk_cancel').hide();
    $('#memoria_bulk_progress').text(bulkIndexAbort ? `중단됨 (${done}/${total})` : `완료 (${done}/${total})`);
    toastr.success(`${done}개 턴 색인 ${bulkIndexAbort ? '중단' : '완료'}`, 'Memoria');
    await updateInjection();
}

/* ============================================================
 * 서고에 질문 (기억 기반 Q&A) — Memoria 고유 기능
 * ============================================================ */

/**
 * 저장된 기억·요약·캐논만 근거로 스토리에 대한 질문에 답한다.
 * "우리 처음 만난 게 언제였지?" 같은 질문에 턴 번호를 인용해 답변.
 */
async function askLibrarian(question) {
    const q = String(question || '').trim();
    if (!q) throw new Error('질문이 비어 있습니다');
    if (!getCurrentChatId()) throw new Error('열린 채팅이 없습니다');

    const parts = buildPacketSections(q, null);
    const context = renderPacket(parts, { recallLimit: 14, protectedLimit: 5 });
    const reply = await callAuxLLM(ASK_LIBRARIAN_PROMPT, `Archive records:\n${context}\n\nPlayer's question: ${q}`, { maxTokens: 4000 });
    const answer = String(reply || '').trim();
    if (!answer) throw new Error('빈 응답');
    return answer;
}

/* ============================================================
 * 스토리 바이블 내보내기 — Memoria 고유 기능
 * ============================================================ */

/** 지금까지의 서고 전체를 사람이 읽는 마크다운 문서로 정리한다. LLM 호출 없이 즉시 생성. */
function buildStoryBible() {
    const store = getStore();
    const chatId = getCurrentChatId() || 'chat';
    const md = [];
    md.push(`# 스토리 바이블 — ${chatId}`);
    md.push(`> Memoria가 정리한 이 이야기의 기록입니다. (${new Date().toLocaleString()} · ${store.turns.length}턴 · 기억 ${store.memories.length}개)`);

    const scene = getSceneSnapshot(store);
    if (scene.any) {
        md.push(`\n**현재 장면** — ${[scene.location, scene.date, scene.time].filter(Boolean).join(' · ')}`);
    }

    const chars = store.characters.filter(c => !c.disabled);
    if (chars.length) {
        md.push('\n## 등장인물');
        for (const c of chars) {
            const head = [c.role, c.age, c.occupation].filter(Boolean).join(' · ');
            md.push(`\n### ${c.name}${head ? ` (${head})` : ''}`);
            if (c.appearance) md.push(`- 외모: ${c.appearance}`);
            if (c.traits?.length) md.push(`- 특성: ${c.traits.join(', ')}`);
            for (const r of (c.relationships || [])) md.push(`- 관계 → ${r.target}: ${r.relation}`);
        }
    }

    if (store.worldRules.length) {
        md.push('\n## 캐논 (세계 설정)');
        for (const r of store.worldRules) md.push(`- **${r.key}** = ${r.value} _(${r.scope}${r.scopeName ? `:${r.scopeName}` : ''})_`);
    }

    const activeLocks = store.locks.filter(l => l.status === 'active');
    if (activeLocks.length) {
        md.push('\n## 서약 (지켜지는 중)');
        for (const l of activeLocks) md.push(`- [${LOCK_LABELS[l.kind] || l.kind}] ${l.summary}`);
    }

    if (store.entityStates.length) {
        md.push('\n## 상태 보드');
        for (const s of store.entityStates) md.push(`- ${s.entity} · ${s.slot} = ${s.value}${s.claim === 'belief' ? ' (믿음)' : ''}`);
    }

    if (store.milestones.length) {
        md.push('\n## 주요 사건 연표');
        for (const e of [...store.milestones].sort((a, b) => (a.turnIndex || 0) - (b.turnIndex || 0))) {
            md.push(`- **t${e.turnIndex || '?'} · ${e.title}**${e.summary ? ` — ${e.summary}` : ''}${(e.participants || []).length ? ` _(${e.participants.join(', ')})_` : ''}`);
        }
    }

    if (store.items.length) {
        md.push('\n## 주요 아이템');
        for (const it of store.items.filter(i => !i.disabled)) {
            md.push(`- **${it.name}**${it.holder ? ` (소유: ${it.holder})` : ''}${it.meaning ? ` — ${it.meaning}` : ''}${it.status ? ` [${it.status}]` : ''}`);
        }
    }

    const summaries = [
        ...store.arcSummaries.map(s => ({ ...s, level: s.carried ? 'carried' : 'arc' })),
        ...store.chunkSummaries.map(s => ({ ...s, level: 'chunk' })),
    ].sort((a, b) => a.fromTurn - b.fromTurn);
    if (summaries.length) {
        md.push('\n## 지금까지의 이야기');
        for (const s of summaries) {
            md.push(`\n**${s.level === 'carried' ? `이전 채팅 (${s.carriedFrom || '인계'})` : `t${s.fromTurn}–t${s.toTurn}`}**`);
            md.push(s.text);
        }
    }

    const digests = store.turns.filter(t => t.summary).sort((a, b) => a.turnIndex - b.turnIndex);
    if (digests.length) {
        md.push('\n## 타임라인 (턴별 기록)');
        for (const t of digests) md.push(`- **t${t.turnIndex}** — ${t.summary}`);
    }

    const pinnedMems = store.memories.filter(m => m.pinned && !m.disabled);
    if (pinnedMems.length) {
        md.push('\n## 고정된 기억');
        for (const m of pinnedMems) md.push(`- (${KIND_LABELS[m.kind] || m.kind}, t${m.turnIndex}) ${m.summary}`);
    }

    return md.join('\n');
}

function exportStoryBible() {
    if (!getCurrentChatId()) {
        toastr.warning('열린 채팅이 없습니다.', 'Memoria');
        return;
    }
    const name = `memoria_bible_${String(getCurrentChatId()).replace(/[^\w-]+/g, '_')}_${Date.now()}.md`;
    download(buildStoryBible(), name, 'text/markdown');
    toastr.success('스토리 바이블을 내보냈습니다.', 'Memoria');
}

/* ============================================================
 * 백업 / 복원 / 초기화
 * ============================================================ */

function exportMemory() {
    const payload = {
        type: 'memoria-export',
        version: STORE_VERSION,
        exportedAt: new Date().toISOString(),
        chatId: getCurrentChatId(),
        store: getStore(),
    };
    const name = `memoria_${String(getCurrentChatId() || 'chat').replace(/[^\w-]+/g, '_')}_${Date.now()}.json`;
    download(JSON.stringify(payload, null, 2), name, 'application/json');
    toastr.success('기억을 내보냈습니다.', 'Memoria');
}

async function importMemory(file) {
    try {
        const payload = JSON.parse(await getFileText(file));
        if (payload?.type !== 'memoria-export' || !payload.store) throw new Error('형식이 다릅니다');
        chat_metadata[MODULE_NAME] = payload.store;
        chat_metadata[MODULE_NAME].version = STORE_VERSION;
        persistStore();
        renderAllPanels();
        await updateInjection();
        toastr.success('기억을 복원했습니다.', 'Memoria');
    } catch (e) {
        console.error(`[${MODULE_NAME}] 가져오기 실패:`, e);
        toastr.error(`가져오기 실패: ${e.message}`, 'Memoria');
    }
}

/**
 * 다른 채팅의 Memoria 내보내기 파일을 "인계" 형태로 현재 채팅에 누적한다.
 * 요약(연대기·청크)은 인계 연대기로, 고정/수동 기억·캐논·서약은 그대로 이어받는다.
 * A→B→C 순으로 계속 이어갈 수 있다.
 */
async function importCarryOver(file) {
    try {
        const payload = JSON.parse(await getFileText(file));
        if (payload?.type !== 'memoria-export' || !payload.store) throw new Error('Memoria 내보내기 파일이 아닙니다');
        const src = payload.store;
        const store = getStore();
        let carriedSummaries = 0;
        let carriedMemories = 0;
        let carriedRules = 0;
        let carriedLocks = 0;

        for (const s of [...(src.arcSummaries || []), ...(src.chunkSummaries || [])]) {
            if (!s?.text) continue;
            store.arcSummaries.push({
                id: uuidv4(), fromTurn: 0, toTurn: 0, text: cleanStr(s.text, 1600),
                carried: true, carriedFrom: payload.chatId || '이전 채팅',
            });
            carriedSummaries++;
        }
        for (const m of (src.memories || [])) {
            if (!m?.summary || !(m.pinned || m.manual)) continue; // 고정/수동 기억만 인계
            store.memories.push({
                ...m,
                id: uuidv4(), turnIndex: 0, mesId: -1, manual: true,
                kind: normKind(m.kind), visibility: normVisibility(m.visibility),
                tags: [...new Set([...(m.tags || []), 'carried'])],
                vec: m.vec || encodeVec(embedText(m.summary)),
            });
            carriedMemories++;
        }
        for (const r of (src.worldRules || [])) {
            if (!r?.key || !r?.value) continue;
            upsertWorldRule(store, { scope: r.scope || 'session', scopeName: r.scopeName || null, key: r.key, value: r.value }, 0);
            carriedRules++;
        }
        for (const l of (src.locks || [])) {
            if (!l?.summary || l.status !== 'active') continue;
            upsertLock(store, { kind: normLockKind(l.kind), summary: l.summary, status: 'active', priority: l.priority || 2, owner: l.owner || null }, 0);
            carriedLocks++;
        }
        let carriedChars = 0;
        for (const c of (src.characters || [])) {
            if (!c?.name) continue;
            upsertCharacter(store, {
                name: c.name, role: c.role || null, age: c.age || null, occupation: c.occupation || null,
                appearance: c.appearance || null, traits: c.traits || [], relationships: c.relationships || [],
            }, 0);
            carriedChars++;
        }
        for (const e of (src.milestones || [])) {
            if (!e?.title) continue;
            upsertMilestone(store, { title: e.title, summary: e.summary || '', participants: e.participants || [], grade: e.grade === 'minor' ? 'minor' : 'major' }, 0);
        }
        for (const it of (src.items || [])) {
            if (!it?.name) continue;
            upsertItem(store, { name: it.name, meaning: it.meaning || '', holder: it.holder || null, status: it.status || null }, 0);
        }

        persistStore();
        renderAllPanels();
        await updateInjection();
        toastr.success(`인계 완료 — 요약 ${carriedSummaries} · 기억 ${carriedMemories} · 인물 ${carriedChars} · 캐논 ${carriedRules} · 서약 ${carriedLocks}`, 'Memoria');
    } catch (e) {
        console.error(`[${MODULE_NAME}] 인계 실패:`, e);
        toastr.error(`인계 실패: ${e.message}`, 'Memoria');
    }
}

function resetMemory() {
    delete chat_metadata[MODULE_NAME];
    getStore();
    persistStore();
    renderAllPanels();
    updateInjection();
}

/* ============================================================
 * UI
 * ============================================================ */

function fmtPct(x) { return `${Math.round(x * 100)}%`; }

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateStatusUI(activity) {
    const store = getStore();
    const settings = getSettings();
    const chatOpen = Boolean(getCurrentChatId());
    let text;
    if (!settings.enabled) text = '꺼짐';
    else if (!chatOpen) text = '채팅 없음';
    else if (activity) text = activity;
    else if (llmBusy || pendingCommits > 0) text = '기록 중…';
    else text = '대기 중';
    $('#memoria_status_state').text(text);
    const failed = store.turns.filter(t => t.failed).length;
    $('#memoria_status_counts').text(chatOpen
        ? `${store.turns.length}턴 · 기억 ${store.memories.length} · 인물 ${store.characters.length} · 캐논 ${store.worldRules.length} · 상태 ${store.entityStates.length} · 서약 ${store.locks.filter(l => l.status === 'active').length} · 요약 ${store.chunkSummaries.length + store.arcSummaries.length}${failed ? ` · ⚠ 기록 실패 ${failed} (도구→색인으로 재시도)` : ''}`
        : '캐릭터/채팅을 열면 이 채팅의 기억이 표시됩니다.');
}

function refreshPacketPreview() {
    const el = $('#memoria_packet_preview');
    if (!el.length) return;
    el.val(lastPacketText || '(주입할 내용이 없습니다 — 기억이 쌓이면 자동 생성됩니다)');
    $('#memoria_packet_tokens').text(lastPacketText
        ? `≈ ${lastPacketTokens} 토큰 / 예산 ${getSettings().tokenBudget}`
        : '');
}

function refreshOverviewUI() {
    updateStatusUI();
    refreshPacketPreview();
}

function renderMemoriesPanel() {
    const store = getStore();
    const list = $('#memoria_memory_list');
    if (!list.length) return;
    const search = String($('#memoria_memory_search').val() || '').toLowerCase();
    const kindFilter = String($('#memoria_memory_kind_filter').val() || '');

    let items = [...store.memories].sort((a, b) => b.turnIndex - a.turnIndex);
    if (kindFilter) items = items.filter(m => m.kind === kindFilter);
    if (search) {
        items = items.filter(m =>
            m.summary.toLowerCase().includes(search)
            || (m.excerpt || '').toLowerCase().includes(search)
            || (m.entities || []).some(e => e.toLowerCase().includes(search))
            || (m.tags || []).some(t => t.includes(search)));
    }

    list.empty();
    if (!items.length) {
        list.append('<div class="memoria__empty">표시할 기억이 없습니다.</div>');
        return;
    }

    for (const m of items.slice(0, 200)) {
        const visNorm = normVisibility(m.visibility);
        const visIcon = visNorm === 'secret' ? 'fa-user-secret' : visNorm === 'private' ? 'fa-lock' : 'fa-globe';
        const card = $(`
            <div class="memoria__mem-card${m.disabled ? ' is-disabled' : ''}${m.pinned ? ' is-pinned' : ''}" data-id="${m.id}">
                <div class="memoria__mem-head">
                    <span class="memoria__badge memoria__badge--${m.kind}">${KIND_LABELS[m.kind] || m.kind}</span>
                    <span class="memoria__mem-turn">t${m.turnIndex}</span>
                    <i class="fa-solid ${visIcon} memoria__mem-vis" title="${visNorm}${m.owner ? ` (소유: ${escapeHtml(m.owner)})` : ''}"></i>
                    <span class="memoria__mem-imp" title="중요도">${fmtPct(m.importance)}</span>
                    <span class="memoria__mem-actions">
                        <i class="fa-solid fa-thumbtack memoria-mem-pin" title="${m.pinned ? '고정 해제' : '항상 주입(고정)'}"></i>
                        <i class="fa-solid ${m.disabled ? 'fa-eye-slash' : 'fa-eye'} memoria-mem-toggle" title="${m.disabled ? '활성화' : '비활성화'}"></i>
                        <i class="fa-solid fa-pen memoria-mem-edit" title="편집"></i>
                        <i class="fa-solid fa-trash memoria-mem-delete" title="삭제"></i>
                    </span>
                </div>
                <div class="memoria__mem-summary">${escapeHtml(m.summary)}</div>
                ${m.excerpt ? `<div class="memoria__mem-excerpt">"${escapeHtml(m.excerpt)}"</div>` : ''}
                ${(m.entities || []).length || (m.tags || []).length ? `<div class="memoria__mem-meta">${(m.entities || []).map(e => `<span class="memoria__chip">@${escapeHtml(e)}</span>`).join('')}${(m.tags || []).map(t => `<span class="memoria__chip memoria__chip--tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
            </div>
        `);
        list.append(card);
    }
}

function characterToEditText(c) {
    return [
        `역할: ${c.role || ''}`,
        `나이: ${c.age || ''}`,
        `직업: ${c.occupation || ''}`,
        `외모: ${c.appearance || ''}`,
        `특성: ${(c.traits || []).join(', ')}`,
        `관계: ${(c.relationships || []).map(r => `${r.target}=${r.relation}`).join('; ')}`,
    ].join('\n');
}

function parseCharacterEditText(text) {
    const get = (label) => {
        const m = String(text).match(new RegExp(`^${label}\\s*[:：]\\s*(.*)$`, 'm'));
        return m ? cleanStr(m[1], 200) : '';
    };
    return {
        role: get('역할') || null,
        age: get('나이') || null,
        occupation: get('직업') || null,
        appearance: get('외모') || null,
        traits: get('특성').split(',').map(t => cleanStr(t, 40)).filter(Boolean).slice(0, 10),
        relationships: get('관계').split(';')
            .map(pair => {
                const [target, ...rest] = pair.split('=');
                return { target: cleanStr(target, 60), relation: cleanStr(rest.join('='), 80) };
            })
            .filter(r => r.target && r.relation)
            .slice(0, 10),
    };
}

function renderCharactersPanel() {
    const store = getStore();
    const list = $('#memoria_characters_list');
    if (!list.length) return;
    list.empty();

    const chars = [...store.characters].sort((a, b) => (b.updatedTurn || 0) - (a.updatedTurn || 0));
    if (!chars.length) {
        list.append('<div class="memoria__empty">아직 기록된 인물이 없습니다. 대화 중 새 인물이 등장하면 자동으로 기록됩니다.</div>');
        return;
    }

    for (const c of chars) {
        const meta = [c.role, c.age, c.occupation].filter(Boolean).map(escapeHtml).join(' · ');
        list.append($(`
            <div class="memoria__char-card${c.disabled ? ' is-disabled' : ''}" data-id="${c.id}">
                <div class="memoria__char-head">
                    <strong class="memoria__char-name">${escapeHtml(c.name)}</strong>
                    ${meta ? `<span class="memoria__char-meta">${meta}</span>` : ''}
                    <span class="memoria__mem-actions">
                        <i class="fa-solid ${c.disabled ? 'fa-eye-slash' : 'fa-eye'} memoria-char-toggle" title="${c.disabled ? '주입에 포함' : '주입에서 제외'}"></i>
                        <i class="fa-solid fa-pen memoria-char-edit" title="편집"></i>
                        <i class="fa-solid fa-trash memoria-char-delete" title="삭제"></i>
                    </span>
                </div>
                ${c.appearance ? `<div class="memoria__char-line">${escapeHtml(c.appearance)}</div>` : ''}
                ${(c.traits || []).length ? `<div class="memoria__mem-meta">${c.traits.map(t => `<span class="memoria__chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                ${(c.relationships || []).length ? `<div class="memoria__mem-meta">${c.relationships.map(r => `<span class="memoria__chip memoria__chip--rel"><i class="fa-solid fa-link"></i> ${escapeHtml(r.target)}: ${escapeHtml(r.relation)}</span>`).join('')}</div>` : ''}
            </div>
        `));
    }
}

function renderItemsPanel() {
    const store = getStore();
    const list = $('#memoria_items_list');
    if (!list.length) return;
    list.empty();

    if (!store.items.length) {
        list.append(`<div class="memoria__empty">${getSettings().itemTracking
            ? '아직 기록된 아이템이 없습니다. 스토리에 중요한 물건이 등장하면 자동 기록됩니다.'
            : '설정 탭에서 "아이템 도감"을 켜면 중요한 물건이 자동 기록됩니다.'}</div>`);
        return;
    }
    for (const it of [...store.items].sort((a, b) => (b.updatedTurn || 0) - (a.updatedTurn || 0))) {
        list.append($(`
            <div class="memoria__row${it.disabled ? ' is-resolved' : ''}" data-id="${it.id}">
                <span class="memoria__row-text"><b>${escapeHtml(it.name)}</b>${it.holder ? ` <small>(${escapeHtml(it.holder)})</small>` : ''}${it.meaning ? ` — ${escapeHtml(it.meaning)}` : ''}${it.status ? ` <small>[${escapeHtml(it.status)}]</small>` : ''}</span>
                <i class="fa-solid ${it.disabled ? 'fa-eye-slash' : 'fa-eye'} memoria-item-toggle" title="${it.disabled ? '주입에 포함' : '주입에서 제외'}"></i>
                <i class="fa-solid fa-trash memoria-item-delete" title="삭제"></i>
            </div>
        `));
    }
}

function renderStatePanel() {
    const store = getStore();
    const $rules = $('#memoria_rules_list');
    const $states = $('#memoria_states_list');
    const $locks = $('#memoria_locks_list');
    if (!$rules.length) return;
    renderCharactersPanel();
    renderItemsPanel();

    $rules.empty();
    if (!store.worldRules.length) $rules.append('<div class="memoria__empty">기록된 캐논이 없습니다.</div>');
    for (const r of store.worldRules) {
        $rules.append($(`
            <div class="memoria__row" data-id="${r.id}">
                <span class="memoria__row-text"><b>${escapeHtml(r.key)}</b> = ${escapeHtml(r.value)} <small>(${escapeHtml(r.scope)}${r.scopeName ? `:${escapeHtml(r.scopeName)}` : ''} · t${r.turnIndex})</small></span>
                <i class="fa-solid fa-trash memoria-rule-delete" title="삭제"></i>
            </div>
        `));
    }

    const scene = getSceneSnapshot(store);
    const $scene = $('#memoria_scene_line');
    if (scene.any) {
        const bits = [];
        if (scene.location) bits.push(`<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(scene.location)}</span>`);
        if (scene.date) bits.push(`<span><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(scene.date)}</span>`);
        if (scene.time) bits.push(`<span><i class="fa-solid fa-clock"></i> ${escapeHtml(scene.time)}</span>`);
        $scene.html(bits.join('<i class="memoria__scene-sep">·</i>')).show();
    } else {
        $scene.hide().empty();
    }

    $states.empty();
    if (!store.entityStates.length) $states.append('<div class="memoria__empty">기록된 개체 상태가 없습니다.</div>');
    for (const s of store.entityStates) {
        $states.append($(`
            <div class="memoria__row" data-id="${s.id}">
                <span class="memoria__row-text"><b>${escapeHtml(s.entity)}.${escapeHtml(s.slot)}</b> = ${escapeHtml(s.value)} <small>(${s.claim === 'belief' ? `믿음${s.owner ? `:${escapeHtml(s.owner)}` : ''}` : '객관'} · t${s.turnIndex})</small></span>
                <i class="fa-solid fa-trash memoria-state-delete" title="삭제"></i>
            </div>
        `));
    }

    $locks.empty();
    if (!store.locks.length) $locks.append('<div class="memoria__empty">기록된 서약이 없습니다.</div>');
    for (const l of store.locks) {
        $locks.append($(`
            <div class="memoria__row${l.status === 'resolved' ? ' is-resolved' : ''}" data-id="${l.id}">
                <span class="memoria__row-text"><span class="memoria__badge memoria__badge--lock">${LOCK_LABELS[l.kind] || l.kind}</span> ${escapeHtml(l.summary)} <small>(P${l.priority} · t${l.turnIndex})</small></span>
                <i class="fa-solid ${l.status === 'resolved' ? 'fa-rotate-left' : 'fa-check'} memoria-lock-toggle" title="${l.status === 'resolved' ? '다시 활성화' : '해결됨으로 표시'}"></i>
                <i class="fa-solid fa-trash memoria-lock-delete" title="삭제"></i>
            </div>
        `));
    }
}

function renderTurnDigests() {
    const store = getStore();
    const list = $('#memoria_digest_list');
    if (!list.length) return;
    list.empty();

    const turns = store.turns.filter(t => t.summary).sort((a, b) => b.turnIndex - a.turnIndex).slice(0, 100);
    if (!turns.length) {
        list.append('<div class="memoria__empty">아직 턴 기록이 없습니다.</div>');
        return;
    }
    for (const t of turns) {
        list.append($(`
            <div class="memoria__row" data-turn="${t.turnIndex}">
                <span class="memoria__row-text"><b>t${t.turnIndex}</b> ${escapeHtml(t.summary)}${t.failed ? ' <small>⚠ 실패</small>' : ''}</span>
                <i class="fa-solid fa-pen memoria-digest-edit" title="편집"></i>
            </div>
        `));
    }
}

function renderMilestonesPanel() {
    const store = getStore();
    const list = $('#memoria_milestone_list');
    if (!list.length) return;
    list.empty();

    if (!store.milestones.length) {
        list.append(`<div class="memoria__empty">${getSettings().eventTracking
            ? '아직 기록된 사건이 없습니다. 이야기의 전환점이 생기면 자동 기록됩니다.'
            : '설정 탭에서 "이벤트 연표"를 켜면 결정적 전환점이 자동 기록됩니다.'}</div>`);
        return;
    }
    for (const e of [...store.milestones].sort((a, b) => (a.turnIndex || 0) - (b.turnIndex || 0))) {
        list.append($(`
            <div class="memoria__row" data-id="${e.id}">
                <span class="memoria__row-text"><span class="memoria__badge ${e.grade === 'major' ? 'memoria__badge--arc' : ''}">${e.grade === 'major' ? '전환점' : '사건'}</span> <b>${escapeHtml(e.title)}</b>${e.summary ? ` — ${escapeHtml(e.summary)}` : ''} <small>(t${e.turnIndex || '?'}${(e.participants || []).length ? ` · ${e.participants.map(escapeHtml).join(', ')}` : ''})</small></span>
                <i class="fa-solid fa-trash memoria-milestone-delete" title="삭제"></i>
            </div>
        `));
    }
}

function renderSummariesPanel() {
    const store = getStore();
    renderMilestonesPanel();
    renderTurnDigests();
    const list = $('#memoria_summary_list');
    if (!list.length) return;
    list.empty();

    const all = [
        ...store.arcSummaries.map(s => ({ ...s, level: 'arc' })),
        ...store.chunkSummaries.map(s => ({ ...s, level: 'chunk' })),
    ].sort((a, b) => a.fromTurn - b.fromTurn);

    if (!all.length) {
        list.append('<div class="memoria__empty">아직 요약이 없습니다. 턴이 쌓이면 자동 생성됩니다.</div>');
        return;
    }
    for (const s of all) {
        list.append($(`
            <div class="memoria__summary-card" data-id="${s.id}" data-level="${s.level}">
                <div class="memoria__summary-head">
                    <span class="memoria__badge ${s.carried ? 'memoria__badge--carried' : s.level === 'arc' ? 'memoria__badge--arc' : 'memoria__badge--chunk'}">${s.carried ? '인계' : s.level === 'arc' ? '연대기' : '요약'}</span>
                    <span>${s.carried ? escapeHtml(s.carriedFrom || '이전 채팅') : `t${s.fromTurn}–t${s.toTurn}`}</span>
                    <span class="memoria__mem-actions">
                        <i class="fa-solid fa-pen memoria-summary-edit" title="편집"></i>
                        <i class="fa-solid fa-trash memoria-summary-delete" title="삭제"></i>
                    </span>
                </div>
                <div class="memoria__summary-text">${escapeHtml(s.text)}</div>
            </div>
        `));
    }
}

function renderSettingsPanel() {
    const s = getSettings();
    $('#memoria_enabled').prop('checked', s.enabled);
    $('#memoria_auto_record').prop('checked', s.autoRecord);
    $('#memoria_supervisor').prop('checked', s.supervisorEnabled);
    $('#memoria_authorize_private').prop('checked', s.authorizeCharPrivate);
    $('#memoria_character_tracking').prop('checked', s.characterTracking);
    $('#memoria_auto_hide').prop('checked', s.autoHide);
    $('#memoria_ref_profile').prop('checked', s.refProfile);
    $('#memoria_ref_worldinfo').prop('checked', s.refWorldInfo);
    $('#memoria_event_tracking').prop('checked', s.eventTracking);
    $('#memoria_item_tracking').prop('checked', s.itemTracking);
    $('#memoria_summary_language').val(s.summaryLanguage || 'auto');
    $('#memoria_summary_context').val(s.summaryContextCount);
    $('#memoria_preserve_recent').val(s.preserveRecent);
    $('#memoria_depth').val(s.injectDepth);
    $('#memoria_budget').val(s.tokenBudget);
    $('#memoria_topk').val(s.topK);
    $('#memoria_chunk_turns').val(s.chunkTurns);
    $('#memoria_max_memories').val(s.maxMemories);
    $('#memoria_response_tokens').val(s.responseTokens);

    const $sel = $('#memoria_profile');
    $sel.empty().append('<option value="">현재 연결된 API 사용</option>');
    for (const p of listConnectionProfiles()) {
        $sel.append($('<option>').val(p.id).text(p.name || p.id));
    }
    $sel.val(s.profileId || '');

    $('#memoria_api_mode').val(s.apiMode === 'custom' ? 'custom' : 'st');
    $('#memoria_custom_url').val(s.customApi.url);
    $('#memoria_custom_key').val(s.customApi.key);
    $('#memoria_custom_model').val(s.customApi.model);
    $('#memoria_custom_temp').val(s.customApi.temperature);
    $('#memoria_custom_timeout').val(s.customApi.timeoutSec);
    $('#memoria_st_api_block').toggle(s.apiMode !== 'custom');
    $('#memoria_custom_api_block').toggle(s.apiMode === 'custom');
}

function renderPromptsPanel() {
    const s = getSettings();
    $('#memoria_prompt_archivist').val(s.prompts.archivist);
    $('#memoria_prompt_supervisor').val(s.prompts.supervisor);
    $('#memoria_prompt_chunk').val(s.prompts.chunk);
    $('#memoria_prompt_arc').val(s.prompts.arc);
}

function renderAllPanels() {
    updateStatusUI();
    refreshPacketPreview();
    renderMemoriesPanel();
    renderStatePanel();
    renderSummariesPanel();
    renderSettingsPanel();
    renderPromptsPanel();
}

/* ============================================================
 * UI 이벤트 바인딩
 * ============================================================ */

function findMemory(id) {
    return getStore().memories.find(m => m.id === id);
}

function bindUI() {
    // 탭 전환
    $('#memoria_settings').on('click', '.memoria__tab', function () {
        const tab = $(this).data('tab');
        $('#memoria_settings .memoria__tab').removeClass('is-active');
        $(this).addClass('is-active');
        $('#memoria_settings .memoria__panel').removeClass('is-active');
        $(`#memoria_settings .memoria__panel[data-panel="${tab}"]`).addClass('is-active');
        renderAllPanels();
    });

    // ── 개요
    $('#memoria_record_now').on('click', async function () {
        let lastAssistant = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i] && !chat[i].is_user && !chat[i].is_system) { lastAssistant = i; break; }
        }
        if (lastAssistant < 0) return toastr.warning('기록할 어시스턴트 메시지가 없습니다.', 'Memoria');
        toastr.info('마지막 턴을 기록합니다…', 'Memoria');
        await queueCommit(lastAssistant, { silent: false });
        await updateInjection();
        renderAllPanels();
    });

    $('#memoria_refresh_packet').on('click', async function () {
        await updateInjection();
        toastr.success('주입 내용을 다시 생성했습니다.', 'Memoria');
    });

    // ── 서고에 질문
    $('#memoria_ask_btn').on('click', async function () {
        const $btn = $(this);
        const q = String($('#memoria_ask_input').val() || '').trim();
        if (!q) return toastr.warning('질문을 입력하세요.', 'Memoria');
        $btn.addClass('disabled');
        $('#memoria_ask_answer').show().text('서고를 뒤지는 중…');
        try {
            const answer = await askLibrarian(q);
            $('#memoria_ask_answer').text(answer);
        } catch (e) {
            $('#memoria_ask_answer').text(`답변 실패: ${e.message}`);
        } finally {
            $btn.removeClass('disabled');
        }
    });
    $('#memoria_ask_input').on('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            $('#memoria_ask_btn').trigger('click');
        }
    });

    // ── 기억 브라우저
    $('#memoria_memory_search').on('input', renderMemoriesPanel);
    $('#memoria_memory_kind_filter').on('change', renderMemoriesPanel);

    $('#memoria_settings').on('click', '.memoria-mem-pin', function () {
        const m = findMemory($(this).closest('.memoria__mem-card').data('id'));
        if (!m) return;
        m.pinned = !m.pinned;
        persistStore(); renderMemoriesPanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-mem-toggle', function () {
        const m = findMemory($(this).closest('.memoria__mem-card').data('id'));
        if (!m) return;
        m.disabled = !m.disabled;
        persistStore(); renderMemoriesPanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-mem-delete', function () {
        const store = getStore();
        const id = $(this).closest('.memoria__mem-card').data('id');
        store.memories = store.memories.filter(m => m.id !== id);
        persistStore(); renderMemoriesPanel(); updateStatusUI(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-mem-edit', async function () {
        const m = findMemory($(this).closest('.memoria__mem-card').data('id'));
        if (!m) return;
        const ctx = getContext();
        const edited = await ctx.callGenericPopup('기억 내용 수정', ctx.POPUP_TYPE.INPUT, m.summary, { rows: 4 });
        if (!edited || typeof edited !== 'string') return;
        m.summary = cleanStr(edited, 300);
        m.vec = encodeVec(embedText(`${m.summary} ${(m.entities || []).join(' ')} ${(m.tags || []).join(' ')}`));
        persistStore(); renderMemoriesPanel(); updateInjection();
    });

    $('#memoria_memory_add').on('click', async function () {
        const ctx = getContext();
        const text = await ctx.callGenericPopup('추가할 기억 내용 (수동 기억은 자동 정리에서 제외됩니다)', ctx.POPUP_TYPE.INPUT, '', { rows: 4 });
        if (!text || typeof text !== 'string') return;
        const store = getStore();
        store.memories.push({
            id: uuidv4(), turnIndex: store.turnCounter, mesId: -1,
            kind: 'fact', summary: cleanStr(text, 300), excerpt: null,
            importance: 0.8, entities: [], tags: ['manual'], visibility: 'public', owner: null,
            pinned: false, disabled: false, manual: true, trigger: '',
            vec: encodeVec(embedText(text)),
        });
        persistStore(); renderMemoriesPanel(); updateStatusUI(); updateInjection();
        toastr.success('기억을 추가했습니다.', 'Memoria');
    });

    // ── 인물 도감
    $('#memoria_settings').on('click', '.memoria-char-toggle', function () {
        const store = getStore();
        const c = store.characters.find(x => x.id === $(this).closest('.memoria__char-card').data('id'));
        if (!c) return;
        c.disabled = !c.disabled;
        persistStore(); renderCharactersPanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-char-delete', function () {
        const store = getStore();
        const id = $(this).closest('.memoria__char-card').data('id');
        store.characters = store.characters.filter(c => c.id !== id);
        persistStore(); renderCharactersPanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-char-edit', async function () {
        const store = getStore();
        const c = store.characters.find(x => x.id === $(this).closest('.memoria__char-card').data('id'));
        if (!c) return;
        const ctx = getContext();
        const edited = await ctx.callGenericPopup(`${c.name} — 인물 정보 수정 (관계는 "이름=관계; 이름=관계" 형식)`, ctx.POPUP_TYPE.INPUT, characterToEditText(c), { rows: 8 });
        if (!edited || typeof edited !== 'string') return;
        Object.assign(c, parseCharacterEditText(edited));
        c.manual = true; // 사용자가 다듬은 프로필은 롤백에서 보호
        persistStore(); renderCharactersPanel(); updateInjection();
    });
    $('#memoria_character_add').on('click', async function () {
        const ctx = getContext();
        const name = await ctx.callGenericPopup('추가할 인물 이름', ctx.POPUP_TYPE.INPUT, '', { rows: 1 });
        if (!name || typeof name !== 'string') return;
        const store = getStore();
        upsertCharacter(store, {
            name: cleanStr(name, 60), role: null, age: null, occupation: null,
            appearance: null, traits: [], relationships: [],
        }, store.turnCounter);
        const created = store.characters.find(x => x.name.toLowerCase() === cleanStr(name, 60).toLowerCase());
        if (created) created.manual = true;
        persistStore(); renderCharactersPanel();
        toastr.success('인물을 추가했습니다. ✏️ 아이콘으로 상세 정보를 채워주세요.', 'Memoria');
    });

    // ── 아이템 도감 / 이벤트 연표
    $('#memoria_settings').on('click', '.memoria-item-toggle', function () {
        const store = getStore();
        const it = store.items.find(x => x.id === $(this).closest('.memoria__row').data('id'));
        if (!it) return;
        it.disabled = !it.disabled;
        persistStore(); renderItemsPanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-item-delete', function () {
        const store = getStore();
        const id = $(this).closest('.memoria__row').data('id');
        store.items = store.items.filter(i => i.id !== id);
        persistStore(); renderItemsPanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-milestone-delete', function () {
        const store = getStore();
        const id = $(this).closest('.memoria__row').data('id');
        store.milestones = store.milestones.filter(e => e.id !== id);
        persistStore(); renderMilestonesPanel(); updateInjection();
    });

    // ── 캐논/상태/서약
    $('#memoria_settings').on('click', '.memoria-rule-delete', function () {
        const store = getStore();
        const id = $(this).closest('.memoria__row').data('id');
        store.worldRules = store.worldRules.filter(r => r.id !== id);
        persistStore(); renderStatePanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-state-delete', function () {
        const store = getStore();
        const id = $(this).closest('.memoria__row').data('id');
        store.entityStates = store.entityStates.filter(s => s.id !== id);
        persistStore(); renderStatePanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-lock-delete', function () {
        const store = getStore();
        const id = $(this).closest('.memoria__row').data('id');
        store.locks = store.locks.filter(l => l.id !== id);
        persistStore(); renderStatePanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-lock-toggle', function () {
        const store = getStore();
        const id = $(this).closest('.memoria__row').data('id');
        const lock = store.locks.find(l => l.id === id);
        if (!lock) return;
        lock.status = lock.status === 'resolved' ? 'active' : 'resolved';
        persistStore(); renderStatePanel(); updateInjection();
    });

    // ── 요약
    $('#memoria_settings').on('click', '.memoria-summary-delete', function () {
        const store = getStore();
        const id = $(this).closest('.memoria__summary-card').data('id');
        store.chunkSummaries = store.chunkSummaries.filter(s => s.id !== id);
        store.arcSummaries = store.arcSummaries.filter(s => s.id !== id);
        persistStore(); renderSummariesPanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-summary-edit', async function () {
        const store = getStore();
        const id = $(this).closest('.memoria__summary-card').data('id');
        const s = store.chunkSummaries.find(x => x.id === id) || store.arcSummaries.find(x => x.id === id);
        if (!s) return;
        const ctx = getContext();
        const edited = await ctx.callGenericPopup('요약 수정', ctx.POPUP_TYPE.INPUT, s.text, { rows: 8 });
        if (!edited || typeof edited !== 'string') return;
        s.text = cleanMultiline(edited, 2400);
        persistStore(); renderSummariesPanel(); updateInjection();
    });
    $('#memoria_settings').on('click', '.memoria-digest-edit', async function () {
        const store = getStore();
        const turnIndex = Number($(this).closest('.memoria__row').data('turn'));
        const t = store.turns.find(x => x.turnIndex === turnIndex);
        if (!t) return;
        const ctx = getContext();
        const edited = await ctx.callGenericPopup(`t${turnIndex} 턴 기록 수정 (이후 요약 생성에 반영됩니다)`, ctx.POPUP_TYPE.INPUT, t.summary, { rows: 4 });
        if (!edited || typeof edited !== 'string') return;
        t.summary = cleanStr(edited, 300);
        persistStore(); renderSummariesPanel();
    });
    $('#memoria_summarize_now').on('click', async function () {
        const store = getStore();
        const lastCovered = store.chunkSummaries.reduce((acc, c) => Math.max(acc, c.toTurn), 0);
        if (store.turnCounter <= lastCovered) return toastr.info('요약할 새 턴이 없습니다.', 'Memoria');
        toastr.info('요약을 생성합니다…', 'Memoria');
        const settings = getSettings();
        const saved = settings.chunkTurns;
        settings.chunkTurns = 1; // 강제로 지금까지를 요약
        try { await maybeSummarizeChunk(store); } finally { settings.chunkTurns = saved; }
        persistStore(); renderSummariesPanel(); updateInjection();
        toastr.success('요약이 생성되었습니다.', 'Memoria');
    });

    // ── 설정
    $('#memoria_enabled').on('change', function () {
        getSettings().enabled = $(this).prop('checked');
        saveSettingsDebounced(); updateStatusUI(); updateInjection();
    });
    $('#memoria_auto_record').on('change', function () {
        getSettings().autoRecord = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#memoria_supervisor').on('change', function () {
        getSettings().supervisorEnabled = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#memoria_authorize_private').on('change', function () {
        getSettings().authorizeCharPrivate = $(this).prop('checked');
        saveSettingsDebounced(); updateInjection();
    });
    $('#memoria_character_tracking').on('change', function () {
        getSettings().characterTracking = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#memoria_auto_hide').on('change', async function () {
        const on = $(this).prop('checked');
        getSettings().autoHide = on;
        saveSettingsDebounced();
        if (on) {
            await applyAutoHide();
            toastr.info('요약이 커버한 옛 메시지를 숨겼습니다. 도구 탭에서 언제든 해제할 수 있습니다.', 'Memoria');
        }
    });
    $('#memoria_summary_language').on('change', function () {
        getSettings().summaryLanguage = String($(this).val() || 'auto');
        saveSettingsDebounced();
    });
    $('#memoria_ref_profile').on('change', function () {
        getSettings().refProfile = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#memoria_ref_worldinfo').on('change', function () {
        getSettings().refWorldInfo = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#memoria_event_tracking').on('change', function () {
        getSettings().eventTracking = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#memoria_item_tracking').on('change', function () {
        getSettings().itemTracking = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#memoria_summary_context').on('input change', function () {
        const v = Number($(this).val());
        if (!Number.isFinite(v)) return;
        getSettings().summaryContextCount = Math.max(-1, Math.min(50, Math.round(v)));
        saveSettingsDebounced();
    });
    $('#memoria_profile').on('change', function () {
        getSettings().profileId = String($(this).val() || '');
        saveSettingsDebounced();
    });
    $('#memoria_api_mode').on('change', function () {
        getSettings().apiMode = String($(this).val()) === 'custom' ? 'custom' : 'st';
        saveSettingsDebounced();
        renderSettingsPanel();
    });
    const customBind = (sel, key, isNumber = false) => {
        $(sel).on('change', function () {
            const raw = String($(this).val() || '').trim();
            getSettings().customApi[key] = isNumber ? (Number(raw) || 0) : raw;
            saveSettingsDebounced();
        });
    };
    customBind('#memoria_custom_url', 'url');
    customBind('#memoria_custom_key', 'key');
    customBind('#memoria_custom_model', 'model');
    customBind('#memoria_custom_temp', 'temperature', true);
    customBind('#memoria_custom_timeout', 'timeoutSec', true);
    $('#memoria_api_test').on('click', async function () {
        const $btn = $(this);
        $btn.addClass('disabled');
        toastr.info('연결을 테스트합니다…', 'Memoria');
        try {
            const reply = await callAuxLLM('You are a connection test. Reply with exactly: OK', 'ping', { maxTokens: 20 });
            if (String(reply).trim()) toastr.success(`연결 성공 — 응답: ${cleanStr(reply, 60)}`, 'Memoria');
            else toastr.warning('응답이 비어 있습니다. 모델 설정을 확인하세요.', 'Memoria');
        } catch (e) {
            toastr.error(`연결 실패: ${e.message}`, 'Memoria');
        } finally {
            $btn.removeClass('disabled');
        }
    });
    const numBind = (sel, key, min, max) => {
        $(sel).on('input change', function () {
            const v = Number($(this).val());
            if (!Number.isFinite(v)) return;
            getSettings()[key] = Math.max(min, Math.min(max, Math.round(v)));
            saveSettingsDebounced();
        });
    };
    numBind('#memoria_depth', 'injectDepth', 0, 20);
    numBind('#memoria_budget', 'tokenBudget', 200, 24000);
    numBind('#memoria_topk', 'topK', 1, 30);
    numBind('#memoria_chunk_turns', 'chunkTurns', 3, 40);
    numBind('#memoria_max_memories', 'maxMemories', 50, 2000);
    numBind('#memoria_response_tokens', 'responseTokens', 256, 65536);
    numBind('#memoria_preserve_recent', 'preserveRecent', 1, 50);

    // ── 프롬프트
    const promptBind = (sel, key) => {
        $(sel).on('change', function () {
            getSettings().prompts[key] = String($(this).val());
            saveSettingsDebounced();
        });
    };
    promptBind('#memoria_prompt_archivist', 'archivist');
    promptBind('#memoria_prompt_supervisor', 'supervisor');
    promptBind('#memoria_prompt_chunk', 'chunk');
    promptBind('#memoria_prompt_arc', 'arc');

    $('#memoria_settings').on('click', '.memoria-prompt-reset', function () {
        const key = $(this).data('key');
        getSettings().prompts[key] = DEFAULT_SETTINGS.prompts[key];
        saveSettingsDebounced();
        renderPromptsPanel();
        toastr.success('기본 프롬프트로 복원했습니다.', 'Memoria');
    });

    // ── 도구
    $('#memoria_bulk_index').on('click', function () {
        const from = parseInt(String($('#memoria_bulk_from').val()), 10);
        const to = parseInt(String($('#memoria_bulk_to').val()), 10);
        bulkIndexChat({
            from: Number.isFinite(from) ? Math.max(0, from) : 0,
            to: Number.isFinite(to) ? Math.max(0, to) : Infinity,
        });
    });
    $('#memoria_bulk_cancel').on('click', function () { bulkIndexAbort = true; });
    $('#memoria_unhide_all').on('click', unhideAllMessages);
    $('#memoria_bible').on('click', exportStoryBible);
    $('#memoria_export').on('click', exportMemory);
    $('#memoria_import_btn').on('click', () => $('#memoria_import_input').trigger('click'));
    $('#memoria_import_input').on('change', async function (e) {
        const file = e.target.files[0];
        if (file) await importMemory(file);
        $(this).val('');
    });
    $('#memoria_carry_btn').on('click', () => $('#memoria_carry_input').trigger('click'));
    $('#memoria_carry_input').on('change', async function (e) {
        const file = e.target.files[0];
        if (file) await importCarryOver(file);
        $(this).val('');
    });
    $('#memoria_reset').on('click', async function () {
        const ctx = getContext();
        const ok = await ctx.callGenericPopup('이 채팅의 모든 기억(기억·인물·캐논·상태·서약·요약)을 삭제합니다.\n되돌릴 수 없습니다. 계속할까요?', ctx.POPUP_TYPE.CONFIRM, '', { okButton: '전부 삭제' });
        if (ok !== ctx.POPUP_RESULT.AFFIRMATIVE && ok !== true) return;
        resetMemory();
        toastr.success('이 채팅의 기억을 초기화했습니다.', 'Memoria');
    });
}

/* ============================================================
 * 슬래시 명령어 & 매크로
 * ============================================================ */

function registerCommands() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'memoria',
            helpString: 'Memoria 켜기/끄기 (on/off 생략 시 토글)',
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'on / off', typeList: [ARGUMENT_TYPE.STRING], isRequired: false })],
            callback: async (_, value) => {
                const s = getSettings();
                const v = String(value || '').toLowerCase();
                s.enabled = v === 'on' ? true : v === 'off' ? false : !s.enabled;
                saveSettingsDebounced();
                updateStatusUI();
                await updateInjection();
                return s.enabled ? 'Memoria: ON' : 'Memoria: OFF';
            },
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'memoria-remember',
            helpString: '수동으로 기억을 추가합니다. 예: /memoria-remember 아리아는 고양이 알레르기가 있다',
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '기억할 내용', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
            callback: async (_, value) => {
                const text = cleanStr(value, 300);
                if (!text) return '내용이 비어 있습니다.';
                const store = getStore();
                store.memories.push({
                    id: uuidv4(), turnIndex: store.turnCounter, mesId: -1,
                    kind: 'fact', summary: text, excerpt: null, importance: 0.8,
                    entities: [], tags: ['manual'], visibility: 'public', owner: null,
                    pinned: false, disabled: false, manual: true, trigger: '',
                    vec: encodeVec(embedText(text)),
                });
                persistStore(); updateStatusUI(); await updateInjection();
                return `기억 추가됨: ${text}`;
            },
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'memoria-search',
            helpString: '기억을 검색해 결과를 반환합니다.',
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '검색어', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
            callback: async (_, value) => {
                const { selected, pinned, triggered } = retrieveMemories(String(value || ''), []);
                const all = [...pinned, ...triggered, ...selected].slice(0, 10);
                if (!all.length) return '관련 기억이 없습니다.';
                return all.map(m => `(${m.kind}, t${m.turnIndex}) ${m.summary}`).join('\n');
            },
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'memoria-index',
            helpString: '현재 채팅의 아직 기록되지 않은 턴을 전부 색인합니다.',
            callback: async () => { bulkIndexChat(); return '일괄 색인을 시작했습니다.'; },
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'memoria-ask',
            helpString: '저장된 기억만 근거로 스토리에 대한 질문에 답합니다. 예: /memoria-ask 우리가 처음 만난 곳이 어디였지?',
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '질문', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
            callback: async (_, value) => {
                try {
                    return await askLibrarian(String(value || ''));
                } catch (e) {
                    return `답변 실패: ${e.message}`;
                }
            },
        }));
    } catch (e) {
        console.error(`[${MODULE_NAME}] 슬래시 명령어 등록 실패:`, e);
    }

    try {
        MacrosParser.registerMacro('memoria_story', () => {
            const store = getStore();
            const all = [
                ...store.arcSummaries.map(s => s.text),
                ...store.chunkSummaries.map(s => s.text),
            ];
            return all.join('\n');
        }, 'Memoria의 지금까지의 이야기 요약');
        MacrosParser.registerMacro('memoria_count', () => String(getStore().memories.length), 'Memoria에 저장된 기억 수');
    } catch (e) {
        console.debug(`[${MODULE_NAME}] 매크로 등록 실패:`, e);
    }
}

/* ============================================================
 * 이벤트 & 초기화
 * ============================================================ */

function bindEvents() {
    eventSource.on(event_types.MESSAGE_RECEIVED, async (mesId) => {
        const settings = getSettings();
        if (!settings.enabled || !settings.autoRecord) return;
        const mes = chat[mesId];
        if (!mes || mes.is_user || mes.is_system) return;
        queueCommit(mesId).then(() => updateInjection());
    });

    eventSource.on(event_types.MESSAGE_SENT, async () => {
        if (!getSettings().enabled) return;
        await updateInjection();
    });

    eventSource.on(event_types.GENERATION_STARTED, async (type, _params, dryRun) => {
        if (dryRun || type === 'quiet' || type === 'impersonate') return;
        const settings = getSettings();
        if (!settings.enabled) return;
        await updateInjection({ runSupervisorPass: settings.supervisorEnabled });
    });

    eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => {
        if (!getSettings().enabled) return;
        invalidateTurnByMesId(Number(mesId));
        updateInjection();
    });

    eventSource.on(event_types.MESSAGE_EDITED, (mesId) => {
        if (!getSettings().enabled) return;
        const id = Number(mesId);
        const mes = chat[id];
        if (mes && !mes.is_user && !mes.is_system && getSettings().autoRecord) {
            invalidateTurnByMesId(id);
            queueCommit(id).then(() => updateInjection());
        } else {
            reconcileWithChat();
            updateInjection();
        }
    });

    eventSource.on(event_types.MESSAGE_DELETED, () => {
        if (!getSettings().enabled) return;
        reconcileWithChat();
        updateInjection();
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        vecCache.clear();
        getStore();
        reconcileWithChat();
        renderAllPanels();
        updateInjection();
    });
}

jQuery(async () => {
    try {
        getSettings();
        // 설치 폴더명과 무관하게 동작하도록 import.meta.url 기준으로 템플릿을 불러온다
        const baseUrl = new URL('.', import.meta.url).href;
        const html = await $.get(`${baseUrl}templates/settings.html`);
        $('#extensions_settings2').append(html);
        bindUI();
        bindEvents();
        registerCommands();
        renderAllPanels();
        await updateInjection();
        console.log(`[${MODULE_NAME}] Memoria 초기화 완료`);
    } catch (e) {
        console.error(`[${MODULE_NAME}] 초기화 실패:`, e);
    }
});
