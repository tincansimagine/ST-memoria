// Read-only discovery and portable backups. No model calls and no chat writes.
const shelves = ['turns', 'memories', 'chunkSummaries', 'arcSummaries', 'characters', 'worldRules', 'entityStates', 'locks', 'milestones', 'items', 'dossier', 'checkpoints'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => object(value) && Object.hasOwn(value, key);
const names = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
export const libraryKey = entry => JSON.stringify([entry.kind, String(entry.ownerId), String(entry.chatId)]);
export const ownerKey = entry => JSON.stringify([entry.kind, String(entry.ownerId)]);
export const hasRecords = entry => entry.state === 'recorded' || entry.state === 'review';

export function summarizeArchive(store, present = store !== undefined) {
    const counts = Object.fromEntries(shelves.map(key => [key, Array.isArray(store?.[key]) ? store[key].length : 0]));
    counts.summaries = counts.chunkSummaries + counts.arcSummaries;
    if (!present) return { state: 'unused', hasStore: false, counts };
    if (!object(store) || store.version !== 1 || shelves.some(key => store[key] != null && !Array.isArray(store[key]))) {
        return { state: 'review', hasStore: true, counts };
    }
    const used = shelves.some(key => counts[key] > 0) || !!store.packetPin?.text || Number(store.turnCounter) > 0;
    return { state: used ? 'recorded' : 'empty', hasStore: true, counts };
}

export function catalogEntry(target, metadata, extra = {}) {
    const base = { kind: target.kind, ownerId: String(target.ownerId), ownerName: String(target.ownerName), chatId: String(target.chatId) };
    return { ...base, key: libraryKey(base), ...summarizeArchive(metadata?.memoria, own(metadata, 'memoria')),
        updatedAt: extra.updatedAt || '', live: !!extra.live, checkedAt: Date.now() };
}

export function throwIfAborted(signal) {
    if (signal?.aborted) { const error = new Error('작업을 중단했습니다.'); error.name = 'AbortError'; throw error; }
}

export async function mapLimited(items, concurrency, worker, signal) {
    let next = 0;
    const jobs = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (!signal?.aborted) {
            const index = next++;
            if (index >= items.length) return;
            await worker(items[index], index);
        }
    });
    // Drain every worker before returning, including cancellation and failures.
    const outcomes = await Promise.allSettled(jobs);
    throwIfAborted(signal);
    const rejected = outcomes.find(x => x.status === 'rejected');
    if (rejected) throw rejected.reason;
}

export function createLibraryPost(getHeaders, fetcher = fetch) {
    return async (path, body, signal) => {
        throwIfAborted(signal);
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(cancel, 45000);
        try {
            const response = await fetcher(path, { method: 'POST', headers: getHeaders(), body: JSON.stringify(body), signal: controller.signal });
            if (!response.ok) throw new Error(`저장 데이터를 읽지 못했습니다 (HTTP ${response.status}).`);
            return await response.json();
        } catch (error) {
            throwIfAborted(signal);
            if (controller.signal.aborted) throw new Error('응답 시간이 초과되었습니다. 다시 검사해 주세요.');
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
        }
    };
}

function metadataFromChat(data, legacyMetadata) {
    if (!Array.isArray(data) || data.length === 0) throw new Error('채팅 파일이 없거나 읽을 수 없습니다.');
    if (own(data[0], 'chat_metadata')) {
        if (!object(data[0].chat_metadata)) throw new Error('채팅 메타데이터 형식을 확인해 주세요.');
        return data[0].chat_metadata;
    }
    // Older group chats keep their metadata in the group, not in the JSONL header.
    if (object(legacyMetadata)) return legacyMetadata;
    if (own(data[0], 'user_name') || own(data[0], 'character_name')) return {};
    throw new Error('채팅의 기록 저장 위치를 확인하지 못했습니다.');
}

function legacyGroupMetadata(group, chatId) {
    if (!group) return undefined;
    if (String(group.chat_id) === String(chatId) && object(group.chat_metadata)) return group.chat_metadata;
    return group.past_metadata?.[chatId];
}

async function readMetadata(target, { post, signal, live, group }) {
    throwIfAborted(signal);
    const current = live?.(target);
    if (current) return { metadata: current.metadata, updatedAt: current.updatedAt, live: true };
    const data = await post(target.kind === 'group' ? '/api/chats/group/get' : '/api/chats/get',
        target.kind === 'group' ? { id: target.chatId } : { avatar_url: target.ownerId, file_name: target.chatId }, signal);
    throwIfAborted(signal);
    return { metadata: metadataFromChat(data, legacyGroupMetadata(group, target.chatId)), updatedAt: data.at(-1)?.send_date || '' };
}

/** Per-owner batches keep a 700-character library from opening every chat at once. */
export async function scanLibrary({ characters, post, signal, live, liveTarget, onProgress = () => {} }) {
    const entries = new Map();
    const errors = [];
    const progress = { ownersDone: 0, ownersTotal: 0, chatsDone: 0, phase: 'starting' };
    let groups = [];
    let lastNotification = 0;
    const notify = (force = false) => {
        if (!force && Date.now() - lastNotification < 120) return;
        lastNotification = Date.now();
        onProgress({ ...progress, entries: [...entries.values()], errors: [...errors] });
    };
    const record = (target, metadata, extra) => {
        const current = live?.(target);
        const row = catalogEntry(target, current?.metadata || metadata, current ? { ...current, live: true } : extra);
        entries.set(row.key, row);
    };
    const failure = (target, error) => {
        errors.push({ ...target, message: error.message || String(error) });
        if (target.chatId) {
            const row = catalogEntry(target, undefined);
            entries.set(row.key, { ...row, state: 'error', error: error.message || String(error) });
        }
    };
    try {
        try {
            groups = await post('/api/groups/all', {}, signal);
            if (!Array.isArray(groups)) throw new Error('그룹 목록 형식을 확인하지 못했습니다.');
        } catch (error) {
            throwIfAborted(signal);
            groups = [];
            failure({ kind: 'group', ownerId: '', ownerName: '그룹 목록' }, error);
        }
        const owners = [
            ...characters.filter(c => c?.avatar && c.avatar !== 'none').map(c => ({ kind: 'character', ownerId: c.avatar, ownerName: c.name || c.avatar, card: c })),
            ...groups.map(g => ({ kind: 'group', ownerId: String(g.id), ownerName: g.name || String(g.id), group: g })),
        ];
        const unique = [...new Map(owners.map(o => [ownerKey(o), o])).values()];
        progress.ownersTotal = unique.length;
        progress.phase = 'scanning';
        notify(true);
        await mapLimited(unique, 3, async owner => {
            try {
                if (owner.kind === 'group') {
                    const ids = [...new Set([...(owner.group.chats || []), owner.group.chat_id].filter(Boolean).map(String))];
                    for (const chatId of ids) {
                        throwIfAborted(signal);
                        const target = { ...owner, chatId };
                        try {
                            // A migrated chat header takes precedence over any leftover legacy metadata.
                            const source = await readMetadata(target, { post, signal, live, group: owner.group });
                            record(target, source.metadata, source);
                        } catch (error) { throwIfAborted(signal); failure({ kind: owner.kind, ownerId: owner.ownerId, ownerName: owner.ownerName, chatId }, error); }
                        progress.chatsDone++;
                        notify();
                    }
                } else {
                    const result = await post('/api/characters/chats', { avatar_url: owner.ownerId, metadata: true }, signal);
                    if (result?.error) {
                        // The host uses this response for a character with no chat directory as well as read errors.
                        if (owner.card.chat_size != null && Number(owner.card.chat_size) === 0) return;
                        throw new Error('채팅 목록을 확인하지 못했습니다. 기록 없음으로 처리하지 않았습니다.');
                    }
                    if (!Array.isArray(result) && !object(result)) throw new Error('채팅 목록 형식이 올바르지 않습니다.');
                    // Preview endpoints may silently omit unreadable files. Reconcile with the
                    // lightweight directory listing so those files receive an explicit read error.
                    const inventory = await post('/api/characters/chats', { avatar_url: owner.ownerId, simple: true }, signal);
                    if (inventory?.error || (!Array.isArray(inventory) && !object(inventory))) throw new Error('채팅 파일 목록을 대조하지 못했습니다. 다시 검사해 주세요.');
                    const listed = new Map(Object.values(inventory).map(info => [info?.file_name, info]));
                    for (const info of Object.values(result)) listed.set(info?.file_name, info);
                    for (const info of listed.values()) {
                        throwIfAborted(signal);
                        if (!info?.file_name) throw new Error('이름 없는 채팅 항목을 확인해 주세요.');
                        const target = { ...owner, chatId: String(info.file_name).replace(/\.jsonl$/i, '') };
                        try {
                            const source = object(info.chat_metadata)
                                ? { metadata: info.chat_metadata, updatedAt: info.last_mes }
                                : await readMetadata(target, { post, signal, live });
                            record(target, source.metadata, source);
                        } catch (error) { throwIfAborted(signal); failure({ kind: owner.kind, ownerId: owner.ownerId, ownerName: owner.ownerName, chatId: target.chatId }, error); }
                        progress.chatsDone++;
                        notify();
                    }
                }
            } catch (error) {
                throwIfAborted(signal);
                failure({ kind: owner.kind, ownerId: owner.ownerId, ownerName: owner.ownerName }, error);
            } finally {
                progress.ownersDone++;
                notify();
            }
        }, signal);
        progress.phase = errors.length ? 'partial' : 'complete';
    } catch (error) {
        if (signal?.aborted) progress.phase = 'cancelled';
        else { failure({ ownerName: '전체 검사' }, error); progress.phase = 'partial'; }
    }
    // Include a new/current chat whose latest archive has not reached disk yet.
    if (liveTarget) {
        const current = live?.(liveTarget);
        if (current && own(current.metadata, 'memoria')) record(liveTarget, current.metadata, { ...current, live: true });
    }
    notify(true);
    return { schema: 1, at: Date.now(), ...progress, entries: [...entries.values()], errors };
}

export function filterLibrary(entries, { query = '', filter = 'recorded', sort = 'recent' } = {}) {
    const words = query.normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter(e => {
        const text = `${e.ownerName} ${e.ownerId} ${e.chatId}`.normalize('NFKC').toLocaleLowerCase();
        if (!words.every(word => text.includes(word))) return false;
        if (filter === 'recorded') return hasRecords(e);
        if (filter === 'summaries') return e.counts.summaries > 0;
        if (filter === 'empty') return e.state === 'empty';
        if (filter === 'errors') return e.state === 'error' || e.state === 'review';
        return true;
    }).sort((a, b) => {
        if (sort === 'summaries' && a.counts.summaries !== b.counts.summaries) return b.counts.summaries - a.counts.summaries;
        if (sort === 'memories' && a.counts.memories !== b.counts.memories) return b.counts.memories - a.counts.memories;
        if (sort === 'recent') {
            const time = value => typeof value === 'number' ? value : Date.parse(value) || 0;
            const delta = time(b.updatedAt) - time(a.updatedAt);
            if (delta) return delta;
        }
        return names.compare(a.ownerName, b.ownerName) || names.compare(a.chatId, b.chatId) || names.compare(a.key, b.key);
    });
}

export function libraryTotals(entries) {
    const used = entries.filter(hasRecords);
    return { owners: new Set(used.map(ownerKey)).size, chats: used.length,
        summaries: used.reduce((n, e) => n + e.counts.summaries, 0), memories: used.reduce((n, e) => n + e.counts.memories, 0) };
}

export async function readLibraryExport(entry, { post, signal, live }) {
    let group;
    if (entry.kind === 'group' && !live?.(entry)) {
        const groups = await post('/api/groups/all', {}, signal);
        if (!Array.isArray(groups)) throw new Error('그룹 목록을 읽지 못했습니다.');
        group = groups.find(g => String(g.id) === entry.ownerId);
        if (!group) throw new Error('그룹이 삭제되었거나 이름이 바뀌었습니다. 다시 검사해 주세요.');
    }
    const source = await readMetadata(entry, { post, signal, live, group });
    if (!own(source.metadata, 'memoria')) throw new Error('현재 이 채팅에 메모리아 서고가 없습니다. 다시 검사해 주세요.');
    return { type: 'memoria-export', version: 1, exportedAt: new Date().toISOString(), chatId: entry.chatId,
        source: { kind: entry.kind, ownerId: entry.ownerId, ownerName: entry.ownerName }, store: source.metadata.memoria };
}

export function backupFilename(entry, index = 0) {
    const safe = text => String(text).normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 70) || 'chat';
    return `${String(index + 1).padStart(4, '0')}_${safe(entry.ownerName)}_${safe(entry.chatId)}.json`;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(bytes) { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Standard UTF-8 ZIP, stored entries. Uses Blob parts so binary data is not copied into a giant string. */
export function storedZip(files) {
    const encoder = new TextEncoder();
    const body = [], directory = [];
    let offset = 0, directorySize = 0;
    if (files.length > 65535) throw new Error('한 번에 선택한 파일이 너무 많습니다. 나누어 백업해 주세요.');
    for (const file of files) {
        const name = encoder.encode(file.name), data = file.data instanceof Uint8Array ? file.data : encoder.encode(file.data);
        const crc = crc32(data);
        const header = new Uint8Array(30), h = new DataView(header.buffer);
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
        h.setUint16(12, 33, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
        body.push(header, name, data);
        const central = new Uint8Array(46), c = new DataView(central.buffer);
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
        c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
        c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
        directory.push(central, name); directorySize += central.length + name.length;
        offset += header.length + name.length + data.length;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
    return new Blob([...body, ...directory, end], { type: 'application/zip' });
}

export async function buildLibraryBackup(entries, { post, live, signal, onProgress = () => {}, maxBytes = 128 * 1024 * 1024, scanIncomplete = false } = {}) {
    const unique = [...new Map(entries.filter(e => e.hasStore).map(e => [e.key, e])).values()];
    const files = [], successes = [], failures = [];
    let bytes = 0;
    for (let i = 0; i < unique.length; i++) {
        throwIfAborted(signal);
        const entry = unique[i];
        let payload;
        try { payload = await readLibraryExport(entry, { post, live, signal }); }
        catch (error) {
            throwIfAborted(signal);
            failures.push({ ownerName: entry.ownerName, ownerId: entry.ownerId, chatId: entry.chatId, message: error.message });
        }
        if (payload) {
            const data = new TextEncoder().encode(JSON.stringify(payload));
            bytes += data.length;
            if (bytes > maxBytes) throw new Error('선택한 서고가 백업 한도(128MB)를 넘습니다. 선택 수를 줄여 나누어 받아 주세요. 파일은 아직 내려받지 않았습니다.');
            const file = backupFilename(entry, i);
            files.push({ name: file, data });
            successes.push({ key: entry.key, ownerName: entry.ownerName, ownerId: entry.ownerId, chatId: entry.chatId, file });
        }
        onProgress({ done: i + 1, total: unique.length, successes: successes.length, failures: failures.length, bytes });
    }
    throwIfAborted(signal);
    if (!successes.length) return { blob: null, successes, failures };
    const manifest = { type: 'memoria-library-backup', version: 1, exportedAt: new Date().toISOString(), scope: 'selected-chats', scanIncomplete, successes, failures };
    files.push({ name: 'backup-manifest.json', data: JSON.stringify(manifest, null, 2) });
    files.push({ name: '복원 안내.txt', data: `Memoria 선택 채팅 백업\n\n성공 ${successes.length}개 / 실패 ${failures.length}개\n${scanIncomplete ? '전체 검사가 끝나지 않은 상태에서 선택한 채팅만 백업했습니다.\n' : ''}\n1. ZIP을 풀어 주세요.\n2. backup-manifest.json에서 봇 이름·채팅 이름과 파일을 확인하세요.\n3. 해당 실리태번 채팅을 열고 Memoria → 도구 → 백업·복원 → 가져오기에서 번호로 시작하는 JSON 파일을 고르세요.\n4. 변경 내역을 확인한 뒤 복원하세요.\n\n이 파일은 메모리아 기억·요약·도감·복구 지점 등의 백업입니다. 대화 원문, 봇 카드, API 설정은 포함하지 않습니다.\n서고는 검사 때의 복사본이 아니라 내보내는 시점에 다시 읽었습니다.\n실패 내역은 backup-manifest.json에 포함됩니다.\n` });
    return { blob: storedZip(files), successes, failures };
}
