import test from 'node:test';
import assert from 'node:assert/strict';
import { findAssociations, addCheckpoint, archiveSnapshot, archiveChanges, validateArchive } from '../archive-engine.mjs';
import { runtime, memory } from './runtime.mjs';

test('associations require rare evidence, have one hop, and stay inside knowledge scope', () => {
    const seed = memory('s', { tags: ['은빛반지'], entities: ['아리아'] });
    const linked = memory('linked', { tags: ['은빛반지', '등대'], entities: ['아리아'] });
    const secondHop = memory('second', { tags: ['등대'], entities: ['아리아'] });
    const nameOnly = memory('name', { entities: ['아리아'] });
    const hidden = memory('secret', { ...linked, id: 'secret', visibility: 'secret', owner: '아리아' });
    const result = findAssociations([seed, linked, secondHop, nameOnly, hidden], [{ m: seed, score: 0.7 }]);
    assert.deepEqual(result.map(r => r.m.id), ['linked']);
    assert.deepEqual(findAssociations([seed, linked], [{ m: seed, score: 0.1 }]), []);
});

test('ubiquitous tags never link the entire cast', () => {
    const rows = Array.from({ length: 30 }, (_, n) => memory(`${n}`, { tags: ['사랑', 'manual'], entities: ['아리아'] }));
    assert.deepEqual(findAssociations(rows, [{ m: rows[0], score: 0.9 }]), []);
});

test('checkpoints are bounded, independent, non-recursive and preserve old schema', () => {
    const store = { version: 1, turnCounter: 2, memories: [memory('m')] };
    for (let n = 0; n < 5; n++) addCheckpoint(store, `p${n}`, `${n}`, n);
    assert.equal(store.checkpoints.length, 3);
    assert.equal(JSON.parse(store.checkpoints[0].data).checkpoints, undefined);
    store.memories[0].summary = '수정한 내용';
    const restored = validateArchive(JSON.parse(store.checkpoints[0].data));
    assert.equal(restored.memories[0].summary, '오래된 사건 m');
    assert.deepEqual(restored.dossier, []);
    assert.equal(archiveChanges(restored, store)[0].type, 'changed');
    assert.throws(() => validateArchive({ version: 99 }), /형식/);
    assert.throws(() => validateArchive({ ...store, memories: [memory('m'), memory('m')] }), /중복/);
});

test('oversize checkpoint fails without changing archive or evicting history', () => {
    const store = { version: 1, turnCounter: 0, memories: [] };
    addCheckpoint(store, 'small', 'a');
    store.dossier = [{ chunks: ['가'.repeat(1_100_000)] }];
    const before = JSON.stringify(store);
    assert.throws(() => addCheckpoint(store, 'large', 'b'), /3MB/);
    assert.equal(JSON.stringify(store), before);
});

test('viewpoint defaults to public in groups and resolves character aliases explicitly', async () => {
    const app = await runtime();
    const store = app.getStore();
    store.characters.push({ name: '아리아', aliases: ['Aria'] });
    app.context.selected_group = 'group';
    assert.equal(app.authorizedEntities().size, 0);
    store.perspective = '아리아';
    assert.deepEqual([...app.authorizedEntities()], ['아리아', 'aria']);
    store.memories = [memory('public', { pinned: true }), memory('a', { visibility: 'secret', owner: 'Aria', pinned: true }), memory('b', { visibility: 'secret', owner: '보라', pinned: true })];
    const result = await app.retrieveMemories('은빛반지', []);
    assert.deepEqual([...result.pinned.map(m => m.id)], ['public', 'a']);
    assert.equal(result.hiddenProtected, 1);
    app.getSettings().authorizeCharPrivate = false;
    assert.equal(app.authorizedEntities().size, 0);
});

test('automatic packets always stay within budget including oversized pledges', async () => {
    const app = await runtime();
    const store = app.getStore();
    store.locks = [{ id: 'huge', kind: 'world_limit', summary: '가'.repeat(5000), priority: 1, status: 'active' },
        { id: 'short', kind: 'keep_secret', summary: '이름을 발설하지 않는다', priority: 2, status: 'active' }];
    for (const budget of [1, 80, 400, 2000]) {
        app.getSettings().tokenBudget = budget;
        const packet = await app.buildPacketWithinBudget('오늘', null);
        assert.ok(packet.tokens <= budget, `${packet.tokens} > ${budget}`);
        if (packet.text) assert.ok(packet.text.endsWith('</memoria_ledger>'));
        if (budget === 80) assert.match(packet.text, /이름을 발설하지 않는다/);
    }
});

test('questions and draft packet builds do not overwrite the actual injection audit', async () => {
    const app = await runtime();
    const store = app.getStore();
    store.turnCounter = 10;
    store.memories = [memory('p', { pinned: true })];
    await app.updateInjection();
    const audit = app.run('JSON.stringify(recallAudit)');
    await app.buildPacketSections('질문', null);
    assert.equal(app.run('JSON.stringify(recallAudit)'), audit);
    app.getSettings().tokenBudget = 1;
    await app.updateInjection();
    assert.equal(app.run('recallAudit.ids.length'), 0);
    assert.equal(app.run('lastPacketDiagnostics.rows[0].excluded'), '토큰 예산');
});

test('edits invalidate the five-second packet cache', async () => {
    const app = await runtime();
    app.getStore().memories = [memory('p', { pinned: true })];
    await app.updateInjection();
    app.getStore().memories[0].summary = '지금 수정한 사실';
    app.persistStore();
    await app.updateInjection();
    assert.match(app.prompts.at(-1)[1], /지금 수정한 사실/);
});

test('chat switch while counting tokens never publishes a previous chat packet', async () => {
    const app = await runtime();
    app.getStore().memories = [memory('old', { pinned: true })];
    let release;
    let started;
    const waiting = new Promise(resolve => { started = resolve; });
    app.context.getTokenCountAsync = async () => { started(); await new Promise(resolve => { release = resolve; }); return 20; };
    const pending = app.updateInjection();
    await waiting;
    app.setChat('different-chat');
    release();
    await pending;
    assert.equal(app.prompts.length, 0);
});

async function curator() {
    const app = await runtime();
    const store = app.getStore();
    store.turnCounter = 30;
    store.memories = Array.from({ length: 12 }, (_, n) => memory(`m${n + 1}`));
    app.run('callAuxLLM = async () => JSON.stringify({ merge: [], drop: ["m2"], reweight: [] });');
    return { app, store };
}

test('cancelled curator review leaves archive byte-for-byte unchanged', async () => {
    const { app, store } = await curator();
    const before = archiveSnapshot(store);
    app.run('reviewArchiveChanges = async () => false;');
    assert.equal(await app.runConsolidation(store, { review: true }), null);
    assert.equal(archiveSnapshot(store), before);
    assert.equal(store.checkpoints, undefined);
});

test('curator approval keeps a checkpoint, and stale reviews cannot overwrite an edit', async () => {
    const { app, store } = await curator();
    const before = archiveSnapshot(store);
    app.run('reviewArchiveChanges = async () => true;');
    await app.runConsolidation(store, { review: true });
    assert.equal(store.memories.length, 11);
    assert.equal(store.checkpoints[0].data, before);
    store.memories.push(memory('m13'));
    app.run('reviewArchiveChanges = async () => { getStore().memories[0].summary = "사용자 수정"; return true; };');
    await assert.rejects(app.runConsolidation(store, { review: true }), /바뀌었습니다/);
    assert.equal(store.memories[0].summary, '사용자 수정');
    assert.equal(store.checkpoints.length, 1);
});

test('curator cannot merge secret content into a public memory', async () => {
    const { app, store } = await curator();
    store.memories[1].visibility = 'secret';
    store.memories[1].owner = '아리아';
    app.run('callAuxLLM = async () => JSON.stringify({ merge: [{keep:"m1", absorb:["m2"], summary:"유출되면 안 되는 내용"}] });');
    const before = archiveSnapshot(store);
    await app.runConsolidation(store);
    assert.equal(archiveSnapshot(store), before);
});

test('merged memory is invalidated when an absorbed source turn is swiped', async () => {
    const { app, store } = await curator();
    store.turns = [{ id: 'turn1', mesId: 1, mesHash: 101, turnIndex: 1 }, { id: 'turn2', mesId: 3, mesHash: 103, turnIndex: 2 }];
    store.memories[1].mesId = 3;
    store.memories[1].turnIndex = 2;
    app.run('callAuxLLM = async () => JSON.stringify({ merge: [{keep:"m1", absorb:["m2"], summary:"두 사건의 기록"}] });');
    await app.runConsolidation(store);
    assert.equal(store.memories[0].sources.length, 2);
    app.removeDerivedForTurn(store, 2);
    assert.ok(!store.memories.some(m => m.id === 'm1'));
});

test('association can recall an otherwise missed memory without increasing topK', async () => {
    const app = await runtime();
    const store = app.getStore();
    store.turnCounter = 20;
    app.getSettings().topK = 2;
    store.memories = [memory('seed', { summary: 'amberportal', vec: app.encodeVec(app.embedText('amberportal')), tags: ['lighthouse-vow'], entities: ['Aria'] }),
        memory('linked', { summary: 'unspoken return', cvec: '', tags: ['lighthouse-vow'], entities: ['Aria'] }),
        memory('unrelated', { summary: 'unrelated', cvec: '', entities: ['Aria'] })];
    const result = await app.retrieveMemories('amberportal', []);
    assert.ok(result.selected.some(m => m.id === 'linked'));
    assert.equal(result.trace.get('linked').mode, 'association');
    assert.equal(result.selected.length, 2);
    app.getSettings().associativeRecall = false;
    const direct = await app.retrieveMemories('amberportal', []);
    assert.ok(!direct.selected.some(m => m.id === 'linked'));
});

test('curator input contains only one knowledge scope and no private source text', async () => {
    const { app, store } = await curator();
    store.memories.push(memory('private', { summary: 'THIS_IS_PRIVATE', visibility: 'secret', owner: '아리아' }));
    app.run('callAuxLLM = async (_, prompt) => { if (prompt.includes("THIS_IS_PRIVATE")) throw new Error("leak"); return "{}"; };');
    await app.runConsolidation(store);
    assert.equal(store.memories.length, 13);
});

test('malformed import fields fail validation before any mutation', () => {
    const base = { version: 1, turnCounter: 1, memories: [memory('m')] };
    for (const malformed of [
        { ...base, memories: [memory('m', { owner: {} })] },
        { ...base, dossier: [{ id: 'd', title: 'doc', chunks: [null] }] },
        { ...base, characters: [{ id: 'c', name: '아리아', relationships: [null] }] },
        { ...base, memories: [memory('m', { sources: [123] })] },
        { ...base, packetPin: { text: {} } },
    ]) assert.throws(() => validateArchive(malformed));
});

test('checkpoint recovery restores deleted memories and keeps a way back', async () => {
    const app = await runtime();
    const store = app.getStore();
    store.memories = [memory('manual', { manual: true, mesId: -1 })];
    addCheckpoint(store, '저장', 'p');
    store.memories = [];
    app.run('reviewArchiveChanges = async () => true; renderAllPanels = () => {};');
    await app.restoreCheckpoint('p');
    assert.equal(app.getStore().memories.length, 1);
    assert.equal(app.getStore().checkpoints[0].label, '복구 실행 전');
    assert.equal(JSON.parse(app.getStore().checkpoints[0].data).memories.length, 0);
});

test('checkpoint restoration is rejected if the chat changes during review', async () => {
    const app = await runtime();
    const store = app.getStore();
    addCheckpoint(store, '저장', 'p');
    app.context.switchChat = () => app.setChat('other');
    app.run('reviewArchiveChanges = async () => { switchChat(); return true; };');
    await assert.rejects(app.restoreCheckpoint('p'), /바뀌었습니다/);
    assert.equal(store.checkpoints.length, 1);
});
