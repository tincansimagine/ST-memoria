import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeArchive, catalogEntry, libraryKey, scanLibrary, libraryTotals, filterLibrary, readLibraryExport, buildLibraryBackup, storedZip, createLibraryPost } from '../library-engine.mjs';
import { readLibraryCache } from '../library-ui.mjs';
import { validateArchive } from '../archive-engine.mjs';
import { libraryCharacters, libraryFixturePost, fictionalArchive } from './library-fixture.mjs';
import { runtime } from './runtime.mjs';

const target = { kind: 'character', ownerId: 'aria.png', ownerName: '아리아', chatId: '첫 대화' };
const entry = (store = fictionalArchive(), overrides = {}) => catalogEntry({ ...target, ...overrides }, { memoria: store });
const scan = opts => scanLibrary({ characters: libraryCharacters, post: libraryFixturePost, ...opts });

test('distinguishes never used, initialized empty, records, checkpoint-only and unknown archives', () => {
    assert.equal(summarizeArchive(undefined, false).state, 'unused');
    assert.equal(summarizeArchive({ version: 1, memories: [] }).state, 'empty');
    assert.equal(summarizeArchive(fictionalArchive()).counts.summaries, 1);
    assert.equal(summarizeArchive({ version: 1, checkpoints: [{ data: '{}' }] }).state, 'recorded');
    assert.equal(summarizeArchive(null, true).state, 'review');
    assert.equal(summarizeArchive({ version: 99, memories: {} }).state, 'review');
});

test('finds old and new group storage, multiple chats and duplicate bot names without opening chats', async () => {
    const paths = [];
    const result = await scan({ post: (path, body) => { paths.push(path); return libraryFixturePost(path, body); } });
    assert.equal(result.phase, 'partial');
    assert.equal(result.entries.length, 31);
    assert.equal(result.entries.filter(e => e.kind === 'group' && e.state === 'recorded').length, 3);
    assert.equal(libraryTotals(result.entries).owners, 5);
    assert.equal(libraryTotals(result.entries).chats, 29);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].ownerName, /확인/);
    assert.equal(result.entries.filter(e => e.ownerName === '아리아').length, 5);
    assert.equal(new Set(result.entries.map(e => e.key)).size, result.entries.length);
    assert.ok(paths.every(p => ['/api/groups/all', '/api/characters/chats', '/api/chats/group/get'].includes(p)));
    assert.equal(paths.filter(p => p === '/api/chats/group/get').length, 3);
});

test('older character API fallback reads headers; unreadable chats stay errors and current archive wins', async () => {
    const liveTarget = { ...target, chatId: 'live' };
    const post = async path => {
        if (path === '/api/groups/all') return [];
        if (path === '/api/characters/chats') return { 0: { file_name: 'old.jsonl' }, 1: { file_name: 'missing.jsonl' } };
        return path === '/api/chats/get' ? [] : assert.fail(path);
    };
    const result = await scanLibrary({ characters: [libraryCharacters[0]], post: (p, b) => b.file_name === 'old' ? [{ chat_metadata: { memoria: fictionalArchive(2) } }] : post(p, b),
        liveTarget, live: e => e.chatId === 'live' ? { metadata: { memoria: fictionalArchive(7) } } : null });
    assert.equal(result.phase, 'partial');
    assert.equal(result.entries.find(e => e.chatId === 'old').counts.memories, 2);
    assert.equal(result.entries.find(e => e.chatId === 'missing').state, 'error');
    assert.equal(result.entries.find(e => e.chatId === 'live').counts.memories, 7);
    assert.ok(result.entries.find(e => e.chatId === 'live').live);
});

test('700 bots are scanned in bounded batches without simultaneous full-library reads', async () => {
    let active = 0, peak = 0, reads = 0;
    const result = await scanLibrary({ characters: Array.from({ length: 700 }, (_, i) => ({ name: `봇 ${i}`, avatar: `${i}.png` })), post: async (path, body) => {
        if (path === '/api/groups/all') return [];
        assert.equal(path, '/api/characters/chats'); assert.ok(body.metadata || body.simple);
        active++; peak = Math.max(peak, active); reads++;
        await new Promise(resolve => setTimeout(resolve, 0));
        active--; return [{ file_name: 'story.jsonl', chat_metadata: { memoria: fictionalArchive(1) } }];
    } });
    assert.equal(result.phase, 'complete'); assert.equal(reads, 1400); assert.equal(active, 0); assert.ok(peak <= 3);
    assert.equal(result.entries.length, 700); assert.equal(libraryTotals(result.entries).owners, 700);
});

test('cancellation drains in-flight reads and retains partial results without claiming completion', async () => {
    const controller = new AbortController(); let active = 0;
    const result = await scanLibrary({ characters: libraryCharacters, signal: controller.signal, post: async path => {
        if (path === '/api/groups/all') return [];
        active++; await new Promise(resolve => setTimeout(resolve, 5)); active--; controller.abort();
        return [{ file_name: 'x.jsonl', chat_metadata: { memoria: fictionalArchive() } }];
    } });
    assert.equal(result.phase, 'cancelled'); assert.equal(active, 0); assert.ok(result.ownersDone < libraryCharacters.length);
});

test('group-list failure and character-list failure are explicitly reported, not treated as unused', async () => {
    const result = await scanLibrary({ characters: [{ name: 'unknown', avatar: 'a.png' }], post: async path => {
        if (path === '/api/groups/all') throw new Error('offline');
        return { error: true };
    } });
    assert.equal(result.phase, 'partial'); assert.equal(result.errors.length, 2); assert.equal(result.entries.length, 0);
});

test('a file omitted by host chat previews remains visible as a failed read', async () => {
    const result = await scanLibrary({ characters: [libraryCharacters[0]], post: async (path, body) => {
        if (path === '/api/groups/all') return [];
        if (path === '/api/characters/chats') return body.simple ? [{ file_name: 'unreadable.jsonl' }] : [];
        return [];
    } });
    assert.equal(result.phase, 'partial'); assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].state, 'error'); assert.equal(result.entries[0].chatId, 'unreadable');
});

test('search combines bot/chat words and counts refer to recorded archives only', () => {
    const entries = [entry(), entry({ version: 1 }, { chatId: 'empty' }), catalogEntry({ ...target, chatId: 'unused' }, {})];
    assert.equal(filterLibrary(entries).length, 1);
    assert.equal(filterLibrary(entries, { query: '아리아 첫', filter: 'summaries' }).length, 1);
    assert.equal(filterLibrary(entries, { query: '일치하지않음' }).length, 0);
    assert.equal(filterLibrary(entries, { filter: 'empty' }).length, 1);
    assert.deepEqual(libraryTotals(entries), { owners: 1, chats: 1, summaries: 1, memories: 2 });
});

test('backups re-read fresh records, keep original data untouched and remain compatible with import', async () => {
    const original = fictionalArchive(4); original.customSetting = { retained: true };
    const before = JSON.stringify(original);
    const payload = await readLibraryExport(entry(), { post: async (path, body) => {
        assert.equal(path, '/api/chats/get'); assert.equal(body.avatar_url, target.ownerId); assert.equal(body.file_name, target.chatId);
        return [{ chat_metadata: { memoria: original } }];
    } });
    assert.equal(payload.type, 'memoria-export'); assert.equal(payload.store.memories.length, 4);
    assert.equal(validateArchive(payload.store).memories.length, 4);
    assert.equal(JSON.stringify(original), before); assert.ok(payload.store.customSetting.retained);
    const current = await readLibraryExport(entry(), { post: () => assert.fail('current archive must use live data'), live: () => ({ metadata: { memoria: fictionalArchive(9) } }) });
    assert.equal(current.store.memories.length, 9);
});

test('legacy group export refreshes metadata and verifies chat still exists', async () => {
    const group = entry(fictionalArchive(), { kind: 'group', ownerId: 'crew', ownerName: '새벽 항해단', chatId: '북쪽 항로' });
    assert.equal((await readLibraryExport(group, { post: libraryFixturePost })).store.memories.length, 3);
    await assert.rejects(() => readLibraryExport(group, { post: (p, b) => p.endsWith('/get') ? [] : libraryFixturePost(p, b) }), /없거나/);
    await assert.rejects(() => readLibraryExport(entry(), { post: async () => [{ chat_metadata: {} }] }), /서고가 없습니다/);
});

test('migrated group header wins over leftover legacy metadata', async () => {
    const result = await scanLibrary({ characters: [], post: async path => path === '/api/groups/all'
        ? [{ id: 'g', name: '그룹', chat_id: 'story', chats: ['story'], chat_metadata: { memoria: fictionalArchive(1) } }]
        : [{ chat_metadata: { memoria: fictionalArchive(6) } }] });
    assert.equal(result.phase, 'complete'); assert.equal(result.entries[0].counts.memories, 6);
});

test('live host integration matches both owner and chat, clones data and never initializes unused archives', async () => {
    const app = await runtime();
    app.context.characters = [{ name: '아리아', avatar: 'aria.png' }];
    app.context.getContext = () => ({ characterId: 0, groups: [{ id: 'g', name: '항해단' }] });
    const current = app.run('currentLibraryTarget()');
    assert.equal(current.ownerId, 'aria.png'); assert.equal(current.chatId, 'test-chat');
    assert.equal(app.run('liveLibraryArchive(currentLibraryTarget()).metadata.memoria'), undefined);
    assert.equal(Object.hasOwn(app.context.chat_metadata, 'memoria'), false);
    app.context.chat_metadata.memoria = fictionalArchive(3);
    app.context.target = { ...current, ownerId: 'other.png' };
    assert.equal(app.run('liveLibraryArchive(target)'), null);
    const clone = app.run('liveLibraryArchive(currentLibraryTarget())');
    clone.metadata.memoria.memories.pop();
    assert.equal(app.context.chat_metadata.memoria.memories.length, 3);
    app.context.selected_group = 'g';
    assert.equal(app.run('currentLibraryTarget().kind'), 'group');
    assert.equal(app.run('currentLibraryTarget().ownerName'), '항해단');
});

// Independently inspect standard local ZIP headers, including the published CRC-32 check vector.
function unzipStored(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer), decoder = new TextDecoder();
    const files = new Map(); let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
        assert.equal(view.getUint16(offset + 8, true), 0);
        const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
        const start = offset + 30 + nameLength + extraLength;
        files.set(decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength)), decoder.decode(bytes.slice(start, start + size)));
        offset = start + size;
    }
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
    assert.equal(view.getUint16(bytes.length - 12, true), files.size);
    return files;
}

test('UTF-8 ZIP headers, CRC and partial-success manifest preserve separate chat files', async () => {
    const vector = await storedZip([{ name: '한글.txt', data: '123456789' }]).arrayBuffer();
    assert.equal(new DataView(vector).getUint32(14, true), 0xcbf43926);
    assert.equal(unzipStored(vector).get('한글.txt'), '123456789');
    const rows = [entry(), entry(fictionalArchive(), { ownerId: 'other.png' }), entry(fictionalArchive(), { chatId: 'deleted' })];
    const result = await buildLibraryBackup([...rows, rows[0]], { scanIncomplete: true, post: async (p, b) => b.file_name === 'deleted' ? [] : [{ chat_metadata: { memoria: fictionalArchive(4) } }] });
    assert.equal(result.successes.length, 2); assert.equal(result.failures.length, 1);
    const files = unzipStored(await result.blob.arrayBuffer());
    const manifest = JSON.parse(files.get('backup-manifest.json'));
    assert.ok(manifest.scanIncomplete); assert.equal(manifest.failures[0].chatId, 'deleted');
    assert.notEqual(manifest.successes[0].file, manifest.successes[1].file);
    for (const item of manifest.successes) assert.equal(validateArchive(JSON.parse(files.get(item.file)).store).memories.length, 4);
    assert.ok(files.has('복원 안내.txt'));
});

test('cancelled, oversized and entirely failed backups never return a success download', async () => {
    const post = async () => [{ chat_metadata: { memoria: fictionalArchive() } }];
    await assert.rejects(() => buildLibraryBackup([entry()], { post, maxBytes: 1 }), /한도/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => buildLibraryBackup([entry()], { post, signal: controller.signal }), { name: 'AbortError' });
    const result = await buildLibraryBackup([entry()], { post: async () => [] });
    assert.equal(result.blob, null); assert.equal(result.failures.length, 1);
});

test('request cancellation propagates to fetch and non-OK responses are not parsed as empty archives', async () => {
    await assert.rejects(() => createLibraryPost(() => ({}), async () => ({ ok: false, status: 403 }))('/api/groups/all', {}), /403/);
    const controller = new AbortController();
    const post = createLibraryPost(() => ({ 'x-csrf-token': 'fixture' }), async (path, opts) => {
        assert.equal(opts.method, 'POST'); assert.equal(opts.headers['x-csrf-token'], 'fixture');
        controller.abort(); assert.ok(opts.signal.aborted); throw new Error('abort');
    });
    await assert.rejects(() => post('/api/groups/all', {}, controller.signal), { name: 'AbortError' });
});

test('cached results are account scoped, validated and never marked as current live data', () => {
    const row = entry(); row.live = true;
    const value = { schema: 1, at: Date.now(), phase: 'complete', entries: [row], errors: [] };
    const cached = readLibraryCache({ getItem: key => { assert.equal(key, 'memoria.libraryIndex.v1'); return JSON.stringify(value); } });
    assert.equal(cached.entries[0].live, false);
    assert.equal(readLibraryCache({ getItem: () => '{broken' }), null);
    value.entries[0].key = 'wrong identity';
    assert.equal(readLibraryCache({ getItem: () => JSON.stringify(value) }), null);
    assert.equal(readLibraryCache(undefined), null);
    assert.notEqual(libraryKey(target), libraryKey({ ...target, ownerId: 'different.png' }));
});
