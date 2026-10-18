// Memoria's deterministic archive helpers. No host APIs or model calls.
const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const lists = ['turns', 'memories', 'worldRules', 'entityStates', 'locks', 'chunkSummaries', 'arcSummaries', 'characters', 'milestones', 'items', 'dossier'];
const genericCues = new Set(['manual', 'carried', 'episode_raw', 'event', 'relationship', 'fact', 'secret', '사건', '관계', '기억']);
const knowledgeKey = m => JSON.stringify([m.visibility || 'public', normalize(m.owner)]);
export const NARRATOR_PERSPECTIVE = '__narrator__';

export function isSharedPerspective(value) {
    return ['', '__public__', NARRATOR_PERSPECTIVE].includes(value);
}

export function hasChatPerspective(store) {
    if (store.perspectiveScope === 'chat') return true;
    if (store.perspectiveScope === 'default') return false;
    // A named viewpoint belongs to its story, including choices made before scopes existed.
    return typeof store.perspective === 'string' && !isSharedPerspective(store.perspective);
}

export function resolvePerspective(store, shared) {
    return hasChatPerspective(store) || !isSharedPerspective(shared)
        ? (typeof store.perspective === 'string' ? store.perspective : '')
        : shared;
}

export function sameKnowledgeScope(a, b) {
    return (a.visibility || 'public') === (b.visibility || 'public')
        && normalize(a.owner) === normalize(b.owner);
}

/** Only direct, uncommon evidence may link a memory. Never propagate recursively. */
export function findAssociations(memories, seeds, { limit = 2, canonicalName = normalize } = {}) {
    const rows = memories.filter(m => !m.disabled);
    const cues = new Map(rows.map(m => [m.id, new Set([...(m.tags || []), ...(m.hints || [])]
        .map(normalize).filter(s => s.length >= 2 && !genericCues.has(s)))]));
    const scopes = new Map();
    for (const m of rows) {
        const key = knowledgeKey(m);
        if (!scopes.has(key)) scopes.set(key, { size: 0, frequency: new Map() });
        const scope = scopes.get(key);
        scope.size++;
        for (const term of cues.get(m.id)) scope.frequency.set(term, (scope.frequency.get(term) || 0) + 1);
    }
    const seedIds = new Set(seeds.map(s => s.m.id));
    const links = [];
    for (const m of rows) {
        if (seedIds.has(m.id) || m.pinned) continue;
        const entities = new Set((m.entities || []).map(canonicalName));
        let best = null;
        for (const seed of seeds.slice(0, 3)) {
            if (seed.score < 0.18 || !sameKnowledgeScope(m, seed.m)) continue;
            const scope = scopes.get(knowledgeKey(m));
            const shared = [...(cues.get(m.id) || [])].filter(term => cues.get(seed.m.id)?.has(term)
                && scope.frequency.get(term) <= Math.max(2, Math.ceil(scope.size * 0.12)));
            const person = (seed.m.entities || []).some(e => entities.has(canonicalName(e)));
            if (shared.length < 2 && !(shared.length && person)) continue;
            const score = Math.min(0.48, seed.score * 0.65 + Math.min(0.12, shared.length * 0.04));
            if (!best || score > best.score) best = { m, score, via: seed.m.id, cues: shared.slice(0, 3) };
        }
        if (best) links.push(best);
    }
    return links.sort((a, b) => b.score - a.score || String(a.m.id).localeCompare(String(b.m.id))).slice(0, limit);
}

export function archiveSnapshot(store) {
    const { checkpoints, ...data } = store;
    return JSON.stringify(data);
}

export function validateArchive(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
        throw new Error('지원하지 않는 서고 형식입니다. Memoria JSON 파일을 확인하세요.');
    }
    const copy = JSON.parse(archiveSnapshot(value));
    for (const key of lists) {
        if (copy[key] === undefined) copy[key] = [];
        if (!Array.isArray(copy[key]) || copy[key].some(x => !x || typeof x !== 'object' || Array.isArray(x))) {
            throw new Error(`서고의 ${key} 목록이 올바르지 않습니다.`);
        }
        const ids = copy[key].map(x => x.id).filter(Boolean);
        if (new Set(ids).size !== ids.length) throw new Error(`서고의 ${key}에 중복 ID가 있습니다.`);
        if (copy[key].some(row => typeof row.id !== 'string' || !row.id)) throw new Error(`서고의 ${key}에 ID가 없는 항목이 있습니다.`);
    }
    if (!Number.isInteger(copy.turnCounter) || copy.turnCounter < 0) throw new Error('턴 번호가 올바르지 않습니다.');
    const stringFields = {
        turns: ['summary'], memories: ['summary', 'kind', 'visibility', 'owner', 'trigger', 'excerpt', 'vec', 'cvec', 'avec', 'acvec'],
        worldRules: ['scope', 'scopeName', 'key', 'value'], entityStates: ['entity', 'slot', 'value', 'owner', 'claim'],
        locks: ['kind', 'summary', 'owner', 'status'], chunkSummaries: ['text'], arcSummaries: ['text'],
        characters: ['name', 'role', 'age', 'occupation', 'appearance', 'voice'], milestones: ['title', 'summary', 'grade'],
        items: ['name', 'meaning', 'holder', 'status'], dossier: ['title'],
    };
    const arrayFields = { memories: ['entities', 'tags', 'hints'], characters: ['aliases', 'traits'], milestones: ['participants'], dossier: ['chunks'] };
    const requiredText = { memories: ['summary'], worldRules: ['key', 'value'], entityStates: ['entity', 'slot', 'value'], locks: ['kind', 'summary', 'status'], chunkSummaries: ['text'], arcSummaries: ['text'], characters: ['name'], milestones: ['title'], items: ['name'], dossier: ['title'] };
    for (const shelf of lists) for (const row of copy[shelf]) {
        for (const key of requiredText[shelf] || []) if (typeof row[key] !== 'string') throw new Error(`${shelf}.${key}가 없습니다.`);
        for (const key of shelf === 'turns' ? ['mesId', 'turnIndex', 'mesHash'] : ['chunkSummaries', 'arcSummaries'].includes(shelf) ? ['fromTurn', 'toTurn'] : []) {
            if (!Number.isFinite(row[key])) throw new Error(`${shelf}.${key}가 올바르지 않습니다.`);
        }
        if (shelf === 'dossier' && !Array.isArray(row.chunks)) throw new Error('자료실 문서의 본문이 없습니다.');
        for (const key of stringFields[shelf] || []) if (row[key] != null && typeof row[key] !== 'string') {
            throw new Error(`${shelf}.${key}는 문자열이어야 합니다.`);
        }
        for (const key of arrayFields[shelf] || []) if (row[key] != null && (!Array.isArray(row[key]) || row[key].some(x => typeof x !== 'string'))) {
            throw new Error(`${shelf}.${key}는 문자열 목록이어야 합니다.`);
        }
        for (const key of ['turnIndex', 'mesId', 'fromTurn', 'toTurn', 'firstTurn', 'updatedTurn', 'mesHash', 'importance']) {
            if (row[key] != null && !Number.isFinite(row[key])) throw new Error(`${shelf}.${key}는 숫자여야 합니다.`);
        }
        if (shelf === 'characters' && row.relationships != null && (!Array.isArray(row.relationships)
            || row.relationships.some(r => !r || typeof r.target !== 'string' || typeof r.relation !== 'string'))) {
            throw new Error('인물 관계의 형식이 올바르지 않습니다.');
        }
        if (shelf === 'memories' && row.sources != null && (!Array.isArray(row.sources)
            || row.sources.some(s => !s || typeof s.turnId !== 'string' || !Number.isFinite(s.mesHash)))) {
            throw new Error('기억 출처의 형식이 올바르지 않습니다.');
        }
    }
    if (copy.perspective != null && typeof copy.perspective !== 'string') throw new Error('기억 시점의 형식이 올바르지 않습니다.');
    if (copy.perspectiveScope != null && !['default', 'chat'].includes(copy.perspectiveScope)) throw new Error('기억·서술 방식의 적용 범위가 올바르지 않습니다.');
    if (copy.perspectiveScope === 'chat' && typeof copy.perspective !== 'string') throw new Error('이 채팅에 적용할 기억·서술 방식이 없습니다.');
    if (copy.packetPin != null && typeof copy.packetPin.text !== 'string') throw new Error('고정 장부의 형식이 올바르지 않습니다.');
    return copy;
}

/* 임베딩 벡터는 기억 본문에서 언제든 다시 계산할 수 있다. 복구 지점 크기의 대부분을
 * 차지하면서(API 임베딩은 기억 하나에 수 KB) 되살릴 가치는 없으므로 빼고 저장한다. */
const VECTOR_FIELDS = ['vec', 'cvec', 'avec', 'acvec'];

export function checkpointSnapshot(store) {
    const { checkpoints, ...data } = store;
    return JSON.stringify(data, (key, value) => (VECTOR_FIELDS.includes(key) ? undefined : value));
}

/**
 * Bounded snapshots exclude their own history; adding one never mutates archive content.
 * 한도를 넘으면 null을 돌려준다 — 예외를 던지면 초기화처럼 "서고가 너무 커서" 쓰려는
 * 탈출구까지 같이 막힌다. 복구 지점 없이 진행할지는 부르는 쪽이 정한다.
 */
export function addCheckpoint(store, label, id, now = Date.now()) {
    const data = checkpointSnapshot(store);
    const bytes = new TextEncoder().encode(data).length;
    if (bytes > 3 * 1024 * 1024) return null;
    const point = { id, label: String(label).slice(0, 100), at: now, turn: store.turnCounter, bytes, data };
    const points = [point, ...(store.checkpoints || [])].slice(0, 3);
    let total = bytes;
    store.checkpoints = points.filter((p, i) => i === 0 || (total += p.bytes || new TextEncoder().encode(p.data).length) <= 6 * 1024 * 1024);
    return point;
}

export function archiveChanges(before, after) {
    const changes = [];
    const describe = (shelf, item) => {
        switch (shelf) {
            case 'characters': return [item.name, ...['role', 'age', 'occupation', 'appearance', 'voice'].map((key, i) => item[key] ? `${['역할', '나이', '직업', '외모', '말투'][i]}: ${item[key]}` : ''),
                `별칭: ${(item.aliases || []).join(', ')}`, `특성: ${(item.traits || []).join(', ')}`,
                `관계: ${(item.relationships || []).map(r => `${r.target} — ${r.relation}`).join(', ')}`, `고정: ${!!item.locked} · 비활성: ${!!item.disabled}`].filter(Boolean).join('\n');
            case 'memories': return `${item.summary}\n${item.kind || 'fact'} · ${item.visibility || 'public'}${item.owner ? ` (${item.owner})` : ''}${item.pinned ? ' · 고정' : ''}${item.disabled ? ' · 비활성' : ''}`;
            case 'entityStates': return `${item.entity}.${item.slot} = ${item.value}${item.claim === 'belief' ? ` (${item.owner || '미상'}의 믿음)` : ''}`;
            case 'worldRules': return `${item.scopeName || item.scope || 'world'} · ${item.key} = ${item.value}`;
            case 'locks': return `${item.summary}\n${item.kind} · ${item.status} · 우선순위 ${item.priority ?? 2}`;
            case 'items': return `${item.name} · 소유: ${item.holder || '미상'} · 상태: ${item.status || '미상'}\n${item.meaning || ''}`;
            case 'dossier': return `${item.title}\n${(item.chunks || []).join('\n\n')}`;
            default: return String(item.summary || item.text || item.title || '');
        }
    };
    const comparable = item => JSON.stringify(item, (key, value) =>
        ['vec', 'cvec', 'avec', 'acvec', 'shown', 'echoes', 'coldRun'].includes(key) ? undefined : value);
    for (const shelf of lists) {
        const old = new Map((before[shelf] || []).map(x => [x.id, x]));
        const next = new Map((after[shelf] || []).map(x => [x.id, x]));
        for (const [id, item] of old) {
            if (!next.has(id)) changes.push({ shelf, id, type: 'removed', before: describe(shelf, item), after: '' });
            else if (comparable(item) !== comparable(next.get(id))) changes.push({ shelf, id, type: 'changed', before: describe(shelf, item), after: describe(shelf, next.get(id)), importanceBefore: item.importance, importanceAfter: next.get(id).importance });
        }
        for (const [id, item] of next) if (!old.has(id)) changes.push({ shelf, id, type: 'added', before: '', after: describe(shelf, item) });
    }
    for (const [key, label] of [['perspective', '기억·서술 방식'], ['perspectiveScope', '방식 적용 범위'], ['packetPin', '고정 장부']]) {
        const value = store => key === 'packetPin' ? store[key]?.text || '(없음)'
            : key === 'perspectiveScope' ? (hasChatPerspective(store) ? '이 채팅만 따로 설정' : '공통 기본값 사용')
            : store[key] === NARRATOR_PERSPECTIVE ? '소설·풀사칭 (모든 인물 참고)'
            : store[key] === '__public__' ? '공개 기억만' : store[key] || '자동';
        if (value(before) !== value(after)) changes.push({ shelf: 'archive', id: key, type: 'changed', before: `${label}: ${value(before)}`, after: `${label}: ${value(after)}` });
    }
    return changes;
}

export function packetSections(text) {
    const sections = [];
    let current = { name: '안내·지식 경계', chars: 0 };
    for (const line of String(text).split('\n')) {
        if (line.startsWith('## ')) { sections.push(current); current = { name: line.slice(3).split(' (')[0].split(' —')[0], chars: 0 }; }
        current.chars += line.length + 1;
    }
    sections.push(current);
    return sections.filter(s => s.chars > 1);
}
