import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';

async function app() {
    const a = await runtime();
    a.getStore();
    return a;
}
const withVec = (a, m) => ({ ...m, vec: a.encodeVec(a.embedText(a.memoryIndexText(m))) });

test('a tight summary budget trims the middle eras, never the start of the story', async () => {
    const a = await app();
    const keep = a.run('keepRootsAndRecent');
    const rows = [
        { id: 'saga', saga: true, level: 'arc' }, { id: 'arc1', level: 'arc' }, { id: 'arc2', level: 'arc' },
        { id: 'c1' }, { id: 'c2' }, { id: 'c3' },
    ];
    assert.deepEqual(keep(rows, 4).map(r => r.id), ['saga', 'c1', 'c2', 'c3']);
    assert.deepEqual(keep(rows, 5).map(r => r.id), ['saga', 'arc2', 'c1', 'c2', 'c3']);
    assert.deepEqual(keep(rows, 2).map(r => r.id), ['saga', 'c3']);
    assert.deepEqual(keep(rows, 10).map(r => r.id), rows.map(r => r.id));
    const carried = [{ id: 'old', carried: true }, { id: 'a1', level: 'arc' }, { id: 'n1' }, { id: 'n2' }];
    assert.deepEqual(keep(carried, 2).map(r => r.id), ['old', 'n2']);
});

test('pruning lets go of raw turn excerpts and retired memories before the librarian\'s own', async () => {
    const a = await app();
    const key = a.run('pruneKey');
    const plain = memory('plain', { importance: 0.5, turnIndex: 3 });
    const raw = memory('raw', { importance: 0.5, turnIndex: 9, tags: ['episode_raw'] });
    const old = memory('old', { importance: 0.6, turnIndex: 9, retired: { turn: 10, now: '' } });
    assert.deepEqual([plain, raw, old].sort((x, y) => key(x) - key(y)).map(m => m.id), ['raw', 'old', 'plain']);
});

test('the one-line "now" is not read as a day; a flashback tie opens a line but never moves one', async () => {
    const a = await app();
    const clean = a.run('sanitizeExtraction');
    assert.equal(clean({ digest: 'x', now: '3일 뒤 아침, 항구' }, '', '').clockDay, null);
    assert.equal(clean({ digest: 'x', clock: 12 }, '', '').clockDay, 12);

    const x = clean({ digest: 'x', bonds: [
        { from: '아리아', to: '보라', stage: '소꿉친구', when: 'past' },
        { from: '아리아', to: '여행자', stage: '연인', when: 'dream' },
    ], memories: [{ kind: 'event', summary: '아리아와 보라가 말다툼 끝에 화해했다', closed: true, importance: 0.5 }] }, '', '');
    assert.equal(x.bonds.length, 1);
    assert.equal(x.bonds[0].backstory, true);
    assert.equal(x.offPresent, 1);
    assert.equal(x.memories[0].closed, true);

    const store = a.getStore();
    const up = a.run('upsertBond');
    const row = up(store, x.bonds[0], 5);
    assert.ok(row, 'no line on file yet — the flashback is the first the story says of them');
    assert.equal(row.log[0].stage, '소꿉친구');
    up(store, { from: '아리아', to: '보라', stage: '서먹한 사이' }, 6);
    assert.equal(up(store, { from: '아리아', to: '보라', stage: '소꿉친구', backstory: true }, 7), null);
    assert.equal(a.run('bondNow')(store.bonds[0]).stage, '서먹한 사이');
});

test('a settled incident is shown as background and its old line is dropped soon', async () => {
    const a = await app();
    const line = a.run('formatMemoryLine');
    const m = memory('fight', { summary: '아리아와 보라가 다투다 화해했다', excerpt: '다시는 안 볼 거야', turnIndex: 10, importance: 0.85, closed: true });
    assert.match(line(m, true, null, 12), /over and settled/);
    assert.match(line(m, true, null, 12), /다시는 안 볼 거야/);
    assert.doesNotMatch(line(m, true, null, 30), /다시는 안 볼 거야/, 'a core memory keeps its quote, but not a settled quarrel');
    assert.match(line({ ...m, closed: false }, true, null, 30), /다시는 안 볼 거야/);
});

test('someone called by a nickname or a title finds their memories', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 30;
    store.characters.push({ id: 'c1', name: '아리아', aliases: ['리아'] }, { id: 'c2', name: '보라', aliases: [] });
    store.bonds.push({ id: 'b1', from: '여행자', to: '보라', log: [{ turn: 1, stage: '동료', calls: '선배' }], disabled: false });
    for (let i = 0; i < 10; i++) store.memories.push(withVec(a, memory(`n${i}`, { summary: `여행자가 시장에서 ${i}번째 물건을 샀다`, turnIndex: 10 + i, entities: ['여행자'] })));
    store.memories.push(withVec(a, memory('aria', { summary: '아리아가 등대 열쇠를 숨겼다', turnIndex: 2, entities: ['아리아'] })));
    store.memories.push(withVec(a, memory('bora', { summary: '보라가 지도를 태웠다', turnIndex: 3, entities: ['보라'] })));
    const r1 = await a.retrieveMemories('리아가 그때 뭐라고 했더라', [], '');
    assert.match(r1.trace.get('aria')?.reason || '', /인물 일치/);
    const r2 = await a.retrieveMemories('선배는 왜 그랬을까', [], '');
    assert.match(r2.trace.get('bora')?.reason || '', /인물 일치/);
});

test('a merge that loses a recurring person is noticed without a model call', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push({ id: 'c1', name: '아리아', aliases: [] }, { id: 'c2', name: '보라', aliases: [] }, { id: 'c3', name: '미나', aliases: [] });
    const peopleLost = a.run('peopleLost'), lost = (...xs) => [...peopleLost(...xs)];
    const src = ['아리아와 보라가 등대에 갔다', '보라가 미나를 만났다', '아리아가 돌아왔다'];
    assert.deepEqual(lost(store, src, '아리아가 등대에서 돌아왔다'), ['보라']);
    assert.deepEqual(lost(store, src, '아리아가 등대에서 돌아왔다', '미나는 옛 친구다'), ['보라', '미나']);
    assert.deepEqual(lost(store, src, '아리아와 보라가 등대에서 돌아왔다'), []);
});

test('chunk summaries are handed the heavy facts their digests left out', async () => {
    const a = await app();
    const store = a.getStore();
    store.memories.push(memory('vow', { summary: '아리아가 보라에게 등대를 지키겠다고 맹세했다', turnIndex: 4, importance: 0.9 }));
    store.memories.push(memory('minor', { summary: '아리아가 차를 끓였다', turnIndex: 4, importance: 0.3 }));
    store.characters.push({ id: 'c1', name: '미나', aliases: [], firstTurn: 5, role: '등대지기의 딸' });
    store.bonds.push({ id: 'b1', from: '보라', to: '아리아', log: [{ turn: 1, stage: '동료', calls: '아리아 씨' }, { turn: 5, stage: '친구', calls: '리아' }], disabled: false });
    const block = a.run('keyFactsBlock')(store, 3, 6, '아리아와 보라가 등대에서 이야기했다');
    assert.match(block, /맹세했다/);
    assert.doesNotMatch(block, /차를 끓였다/);
    assert.match(block, /미나 first appears \(등대지기의 딸\)/);
    assert.match(block, /보라 now calls 아리아 리아/);
    assert.equal(a.run('keyFactsBlock')(store, 20, 25, ''), '');
});
