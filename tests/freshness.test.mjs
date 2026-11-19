import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';
import { recallCooldown, pushRecallHistory, splitClosedLine, isEndedValue } from '../craft-engine.mjs';

async function app() {
    const a = await runtime();
    a.getStore();
    return a;
}

const withVec = (a, m) => ({ ...m, vec: a.encodeVec(a.embedText(a.memoryIndexText(m))) });

test('recall cooldown: repeats sink, a direct mention does not, and a rewrite never counts itself', () => {
    const history = [{ at: 3, ids: ['a'] }, { at: 5, ids: ['a', 'b'] }, { at: 7, ids: ['a'] }];
    assert.equal(recallCooldown([], 'a'), 1);
    assert.equal(recallCooldown(history, 'c'), 1);
    assert.ok(recallCooldown(history, 'a') < recallCooldown(history, 'b'));
    assert.ok(recallCooldown(history, 'a') < 0.4);
    assert.ok(recallCooldown(history, 'a', { echoed: true }) < recallCooldown(history, 'a'));
    assert.equal(recallCooldown(history, 'a', { direct: true }), 0.9);
    // 7번 답변을 다시 쓰는 중이면 7번에 실린 몫은 세지 않는다
    assert.ok(recallCooldown(history, 'a', { before: 6 }) > recallCooldown(history, 'a'));

    let h = pushRecallHistory([], 3, ['a', 'a']);
    h = pushRecallHistory(h, 5, ['b']);
    h = pushRecallHistory(h, 5, ['c']); // 같은 답변을 다시 받으면 갈아 끼운다
    assert.deepEqual(h, [{ at: 3, ids: ['a'] }, { at: 5, ids: ['c'] }]);
    for (let i = 6; i < 12; i++) h = pushRecallHistory(h, i, []);
    assert.equal(h.length, 4);
});

test('summary replies carry both check lines, and ended values are recognised', () => {
    const r = splitClosedLine('PLOT:\n- 강을 건넜다.\nCLOSED: o1\nSTALE: s2, m1, x9, I3');
    assert.equal(r.text, 'PLOT:\n- 강을 건넜다.');
    assert.deepEqual(r.closed, ['o1']);
    assert.deepEqual(r.stale, ['s2', 'm1', 'i3']);
    assert.deepEqual(splitClosedLine('PLOT:\n- 끝.\nSTALE: none').stale, []);
    for (const v of ['none', 'Uninjured', '없음', '다 나았다', '빈손', 'hands free', '회복됨']) assert.ok(isEndedValue(v), v);
    for (const v of ['왼팔 골절', 'holding a lantern', '등대 창고', 'none of the guards noticed']) assert.ok(!isEndedValue(v), v);
});

test('a memory injected turn after turn steps back, and returns when the user raises it', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 20;
    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '등대 근처를 걸었다', name: '여행자' });
    store.memories.push(
        withVec(a, memory('ring', { kind: 'item', summary: '아리아가 등대 계단에서 은반지를 받았다', turnIndex: 4, hints: ['은반지'], importance: 0.95 })),
        withVec(a, memory('door', { kind: 'event', summary: '등대 문이 밤새 열려 있었다', turnIndex: 5 })),
    );
    const order = async (q) => [...(await a.retrieveMemories(q, [], '')).selected.map(m => m.id)];
    const base = await order('등대');
    assert.deepEqual(base, ['door', 'ring']);

    // 앞선 세 번의 답변에 문 기억이 내리 실렸다
    for (const at of [-3, -2, -1]) a.run('noteRecallHistory')('test-chat', at, ['door']);
    assert.equal((await order('등대'))[0], 'ring', 'the repeated memory yields its place');
    assert.equal((await order('그날 문이 밤새 열려 있었지?'))[0], 'door', 'asking about it brings it straight back');

    a.getSettings().recallCooldown = false;
    assert.deepEqual(await order('등대'), base);
});

test('the librarian retires an outdated memory in the same call; it stays out of recall until asked about, and a swipe revives it', async () => {
    const a = await app();
    const store = a.getStore();
    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '첫 장면', name: '여행자' }, { is_user: false, mes: '아리아는 창고 열쇠를 여행자에게 건넸다. "잃어버리지 마세요." 그녀는 문을 닫았다.', name: '아리아' });
    store.turns.push({ id: 't1', mesId: 1, mesHash: a.mesHashOf(chat[1]), turnIndex: 1, summary: '아리아가 창고 열쇠를 맡겼다.', importance: 0.5 });
    store.turnCounter = 1;
    store.memories.push(
        withVec(a, memory('key', { kind: 'item', summary: '여행자가 등대 창고 열쇠를 가지고 있다', turnIndex: 1, mesId: 1, entities: ['여행자'] })),
        withVec(a, memory('met', { kind: 'event', summary: '아리아가 창고 문 앞에서 열쇠를 건네며 당부했다', turnIndex: 1, mesId: 1 })),
        withVec(a, memory('tea', { kind: 'preference', summary: '아리아는 박하차를 좋아한다', turnIndex: 1, mesId: 1 })),
    );
    chat.push({ is_user: true, mes: '창고 열쇠를 강물에 던졌다', name: '여행자' }, { is_user: false, mes: '여행자가 던진 등대 창고 열쇠는 강물 속으로 가라앉았다. 아리아는 말없이 물결을 바라보았다.', name: '아리아' });
    for (let i = 0; i < 12; i++) chat.push({ is_user: true, mes: '걷는다', name: '여행자' }, { is_user: false, mes: '두 사람은 강둑을 따라 한참 걸었다. 바람이 차가웠다.', name: '아리아' });

    let asked = '';
    a.context.generateRaw = async ({ prompt, systemPrompt }) => {
        asked = `${systemPrompt}\n${prompt[0].content}`;
        return JSON.stringify({ digest: '여행자가 창고 열쇠를 강에 던져 버렸다.', weight: 0.7, time_passed: '0', memories: [],
            outdated: [{ tag: 'm1', now: '열쇠는 강바닥에 가라앉았다' }, { tag: 'm2' }, { tag: 'm9', now: '없는 꼬리표' }] });
    };
    a.getSettings().recordBatch = 1;
    a.getSettings().chunkTurns = 50;
    assert.equal(await a.run('commitTurns')([3]), true);
    assert.match(asked, /SHELF CHECK/);
    assert.match(asked, /\[m1\] \(item\) 여행자가 등대 창고 열쇠를 가지고 있다/);
    assert.doesNotMatch(asked, /박하차/, 'unrelated memories are not offered');
    assert.doesNotMatch(asked, /열쇠를 건네며 당부했다/, 'what happened stays happened');

    const key = store.memories.find(m => m.id === 'key');
    assert.deepEqual({ ...key.retired }, { turn: 2, now: '열쇠는 강바닥에 가라앉았다' });
    store.turnCounter = 14;

    a.getSettings().maxPerTurn = 3;
    const ids = async (q) => (await a.retrieveMemories(q, [], '')).selected.map(m => m.id);
    assert.ok(!(await ids('여행자가 등대로 돌아왔다')).includes('key'), 'a retired memory no longer rides along');
    assert.ok((await ids('창고 열쇠는 어디 있어?')).includes('key'), 'but it answers when asked');
    assert.match(a.run('formatMemoryLine')(key, false, null, 14), /\[no longer current — now: 열쇠는 강바닥에 가라앉았다\]/);

    a.invalidateTurnByMesId(3);
    assert.equal(store.memories.find(m => m.id === 'key').retired, undefined, 'rolling the turn back revives it');
});

test('status board: scene first, ended values fade, and absent people\'s old states wait off the page', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 60;
    a.context.chat.push({ is_user: true, mes: '보라에게 다가갔다', name: '여행자' }, { is_user: false, mes: '보라는 난간에 기대 서 있었다.', name: '보라' });
    const st = (entity, slot, value, turnIndex, extra = {}) => ({ id: `${entity}.${slot}`, entity, slot, value, claim: 'objective', owner: null, turnIndex, createdTurn: turnIndex, prev: null, prevTurn: null, ...extra });
    store.entityStates.push(
        st('보라', 'injury', '왼팔 골절', 5),
        st('민호', 'injury', '발목을 삐었다', 5),
        st('민호', 'goal', '항구로 떠난다', 58),
        st('보라', 'holding', '빈손', 40),
        st('아리아', 'injury', 'uninjured', 57),
        st('보라', 'whereabouts', '옛 숙소', 30, { expired: 48 }),
    );
    const board = (await a.buildPacketWithinBudget('보라', null)).text.match(/## Status Board[\s\S]*?(?=\n## |\n\(|<\/memoria)/)[0];
    assert.match(board, /보라\.injury = 왼팔 골절/, 'someone in the scene keeps even an old state');
    assert.doesNotMatch(board, /민호\.injury/, 'an absent person\'s old state stays off the page');
    assert.match(board, /민호\.goal/, 'a recent change still shows');
    assert.doesNotMatch(board, /빈손/, 'an ended value is not repeated forever');
    assert.match(board, /아리아\.injury = uninjured/, 'but a fresh ending is announced');
    assert.doesNotMatch(board, /옛 숙소/, 'a state the summary found stale is left out');

    // 다시 적히면 살아난다
    a.run('upsertEntityState')(store, { entity: '보라', slot: 'whereabouts', value: '옛 숙소', claim: 'objective', owner: null }, 60);
    assert.equal(store.entityStates.find(s => s.id === '보라.whereabouts').expired, undefined);
});

test('the summary call also retires stale standing records, with no extra call', async () => {
    const a = await app();
    const store = a.getStore();
    const settings = a.getSettings();
    settings.chunkTurns = 3; settings.consolidateEvery = 0; settings.arcConsolidateEvery = 0; settings.itemTracking = true;
    store.turnCounter = 6;
    store.summaryCursor = 3;
    store.chunkSummaries.push({ id: 'c1', fromTurn: 1, toTurn: 3, text: 'PLOT:\n- 앞선 일.' });
    store.turns = [1, 2, 3, 4, 5, 6].map(n => ({ id: `t${n}`, mesId: n, mesHash: n, turnIndex: n, summary: `${n}번째 일이 있었다.`, importance: 0.5 }));
    store.entityStates.push(
        { id: 'e1', entity: '보라', slot: 'injury', value: '왼팔 골절', claim: 'objective', owner: null, turnIndex: 2 },
        { id: 'e2', entity: '보라', slot: 'goal', value: '편지를 찾는다', claim: 'objective', owner: null, turnIndex: 5 },
    );
    store.items.push({ id: 'i1', name: '등불', meaning: '길잡이', holder: '보라', status: 'kept', firstTurn: 1, updatedTurn: 1, disabled: false, manual: false });
    store.memories.push(memory('often', { kind: 'promise', summary: '보라는 축제에 함께 가기로 했다', turnIndex: 2, shown: 4 }),
        memory('rare', { kind: 'promise', summary: '거의 불리지 않은 약속', turnIndex: 2, shown: 1 }));
    let asked = '';
    let calls = 0;
    a.context.generateRaw = async ({ prompt, systemPrompt }) => {
        calls++;
        asked = `${systemPrompt}\n${prompt[0].content}`;
        return 'PLOT:\n- 팔이 다 나았고 축제에 다녀왔다.\nSTALE: s1, i1, m1';
    };
    assert.equal(await a.run('maybeSummarizeChunk')(store), 1);
    assert.equal(calls, 1);
    assert.match(asked, /STALE CHECK[\s\S]*\[s1\] status — 보라\.injury = 왼팔 골절/);
    assert.doesNotMatch(asked, /편지를 찾는다/, 'a state written inside this stretch is not second-guessed');
    assert.doesNotMatch(asked, /거의 불리지 않은/, 'only memories that keep being recalled are reviewed');
    assert.doesNotMatch(store.chunkSummaries[1].text, /STALE/);
    assert.equal(store.entityStates[0].expired, 6);
    assert.equal(store.items[0].dormant, 6);
    assert.deepEqual({ ...store.memories[0].retired }, { turn: 6, now: '' });
    assert.equal(store.memories[1].retired, undefined);
});

test('a recalled promise that has since been kept says so', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 30;
    store.memories.push(memory('vow', { kind: 'promise', summary: '아리아가 축제에 같이 가자고 약속했다', turnIndex: 4, pinned: true }));
    store.locks.push({ id: 'l1', kind: 'keep_unresolved', summary: '아리아와 축제에 같이 가기로 한 약속', status: 'resolved', priority: 2, turnIndex: 20, createdTurn: 4, resolvedTurn: 20, resolution: 'they went to the festival together' });
    const packet = (await a.buildPacketWithinBudget('축제', null)).text;
    assert.match(packet, /축제에 같이 가자고 약속했다 \[as of then — this has since been settled: they went to the festival together\]/);
});
