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
            outdated: [{ tag: 'm1', now: '열쇠는 강바닥에 가라앉았다', said: '강물 속으로 가라앉았다' }, { tag: 'm2' }, { tag: 'm9', now: '없는 꼬리표', said: '강물' }, { tag: 'm3', now: '박하차를 싫어하게 됐다', said: '지어낸 글귀' }] });
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

test('figures that appear nowhere in the source are caught; counted single digits are not', async () => {
    const { ungroundedFigures } = await import('../craft-engine.mjs');
    const source = '[t4 · 3월 12일] 보라가 1,200골드를 빌렸다. 두 사람이 남았다.';
    assert.deepEqual(ungroundedFigures('- 3월 12일, 보라가 1200골드를 빌렸다. 2명이 남았다.', source), []);
    assert.deepEqual(ungroundedFigures('- 3월 21일, 보라가 1,500골드를 빌렸다.', source), ['21', '1500']);
});

test('a summary with an invented figure is rewritten once, and flagged only if it stays wrong', async () => {
    const a = await app();
    const store = a.getStore();
    const settings = a.getSettings();
    settings.chunkTurns = 3; settings.consolidateEvery = 0; settings.arcConsolidateEvery = 0;
    store.turnCounter = 3;
    store.turns = [1, 2, 3].map(n => ({ id: `t${n}`, mesId: n, mesHash: n, turnIndex: n, summary: n === 2 ? '보라가 1200골드를 빌렸다.' : `${n}번째 일이 있었다.`, importance: 0.5 }));
    const replies = ['PLOT:\n- 보라가 1500골드를 빌렸다.', 'PLOT:\n- 보라가 1200골드를 빌렸다.'];
    const asked = [];
    a.context.generateRaw = async ({ prompt }) => { asked.push(prompt[0].content); return replies[asked.length - 1]; };
    assert.equal(await a.run('maybeSummarizeChunk')(store), 1);
    assert.equal(asked.length, 2);
    assert.match(asked[1], /appear nowhere in the material above \(1500\)/);
    assert.match(store.chunkSummaries[0].text, /1200골드/);
    assert.equal(store.chunkSummaries[0].unverified, undefined);

    // 숫자가 다 맞으면 다시 부르지 않는다
    store.turnCounter = 6;
    store.turns.push(...[4, 5, 6].map(n => ({ id: `t${n}`, mesId: n, mesHash: n, turnIndex: n, summary: `${n}번째 일이 있었다.`, importance: 0.5 })));
    asked.length = 0; replies[0] = 'PLOT:\n- 조용한 날들이 이어졌다.';
    await a.run('maybeSummarizeChunk')(store);
    assert.equal(asked.length, 1);
});

test('an unreadable batch is split and refiled, so one bad scene does not fail the run', async () => {
    const a = await app();
    const chat = a.context.chat;
    for (let i = 0; i < 4; i++) chat.push({ is_user: true, mes: '행동', name: '여행자' }, { is_user: false, mes: `아리아가 ${i}번째로 대답했다. 바람이 불었고 파도 소리가 들렸다.${i === 2 ? ' 문제 장면.' : ''}`, name: '아리아' });
    let calls = 0;
    a.context.generateRaw = async ({ prompt }) => {
        calls++;
        const body = prompt[0].content;
        if (body.includes('문제 장면')) return '죄송하지만 이 내용은 도와드릴 수 없습니다.';
        const n = (body.match(/<exchange n=/g) || []).length;
        return n ? JSON.stringify({ digests: Array.from({ length: n }, (_, i) => ({ n: i + 1, digest: `${i + 1}번째 요약.` })) })
            : JSON.stringify({ digest: '한 턴 요약.', memories: [] });
    };
    a.run('setTimeout = (fn) => { fn(); return 0; }'); // 재시도 사이의 기다림을 건너뛴다
    assert.equal(await a.run('commitTurns')([1, 3, 5, 7]), true);
    const store = a.getStore();
    assert.equal(store.turns.length, 4);
    assert.deepEqual([...store.turns.map(t => Boolean(t.failed))], [false, false, true, false], 'only the scene the model refused is left to retry');
    assert.ok(calls <= 12);
});

test('muted words keep matching memories out of recall without deleting them', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 20;
    a.context.chat.push({ is_user: true, mes: '항구', name: '여행자' });
    store.memories.push(withVec(a, memory('crab', { summary: '항구 식당에서 조개구이를 먹었다', turnIndex: 3 })), withVec(a, memory('boat', { summary: '항구 부두에서 배를 탔다', turnIndex: 4 })));
    const ids = async () => [...(await a.retrieveMemories('항구', [], '')).selected.map(m => m.id)].sort();
    assert.deepEqual(await ids(), ['boat', 'crab']);
    store.recallMute = ['조개구이'];
    assert.deepEqual(await ids(), ['boat']);
    assert.equal(store.memories.length, 2);
});

test('light tasks and summaries can use their own model', async () => {
    const a = await app();
    const settings = a.getSettings();
    settings.apiMode = 'custom';
    Object.assign(settings.customApi, { url: 'https://example.test/v1', model: 'main', lightModel: 'cheap', reasoningEffort: 'low' });
    const sent = [];
    a.context.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        sent.push(body);
        if (body.reasoning_effort && body.model === 'cheap') return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: { message: 'unknown field reasoning_effort' } }) };
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) };
    };
    const call = a.run('callAuxLLM');
    await call('s', 'u', {});
    await call('s', 'u', { task: 'summary' });
    await call('s', 'u', { task: 'light' });
    await call('s', 'u', { task: 'light' });
    assert.deepEqual(sent.map(b => [b.model, b.reasoning_effort ?? null]),
        [['main', 'low'], ['main', 'low'], ['cheap', 'low'], ['cheap', null], ['cheap', null]],
        'a model that rejects the reasoning setting is retried without it, and not asked again');
});

test('a summary that drops a pivotal turn is rewritten once with the turn named', async () => {
    const a = await app();
    const store = a.getStore();
    const settings = a.getSettings();
    settings.chunkTurns = 3; settings.consolidateEvery = 0; settings.arcConsolidateEvery = 0;
    store.turnCounter = 3;
    store.turns = [
        { id: 't1', mesId: 1, mesHash: 1, turnIndex: 1, summary: '두 사람이 시장을 구경했다.', importance: 0.4 },
        { id: 't2', mesId: 2, mesHash: 2, turnIndex: 2, summary: '보라가 아리아에게 편지의 발신인이 자신이라고 고백했다.', importance: 0.9 },
        { id: 't3', mesId: 3, mesHash: 3, turnIndex: 3, summary: '저녁을 먹고 숙소로 돌아왔다.', importance: 0.4 },
    ];
    const replies = ['PLOT:\n- 두 사람이 시장을 구경하고 저녁을 먹은 뒤 숙소로 돌아왔다.', 'PLOT:\n- 시장을 구경했다.\n- 보라가 아리아에게 편지의 발신인이 자신이라고 고백했다.\n- 숙소로 돌아왔다.'];
    const asked = [];
    a.context.generateRaw = async ({ prompt }) => { asked.push(prompt[0].content); return replies[asked.length - 1]; };
    await a.run('maybeSummarizeChunk')(store);
    assert.equal(asked.length, 2);
    assert.match(asked[1], /left out pivotal turns marked ★[\s\S]*발신인이 자신이라고 고백/);
    assert.match(store.chunkSummaries[0].text, /고백했다/);
    assert.equal(store.chunkSummaries[0].unverified, undefined);
});

test('a status value with an invented figure is not filed; the scene clock and grounded figures are', async () => {
    const a = await app();
    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '상점에 들어갔다', name: '여행자' }, { is_user: false, mes: '아리아는 지갑에서 은화 30닢을 꺼내 계산대에 올려놓았다. 주인은 고개를 끄덕였다.', name: '아리아' });
    a.context.generateRaw = async () => JSON.stringify({ digest: '아리아가 은화를 냈다.', memories: [],
        status: [{ entity: '아리아', slot: 'money', value: '은화 470닢 남음' }, { entity: '아리아', slot: 'paid', value: '은화 30닢' }, { entity: 'scene', slot: 'date', value: '12일째' }] });
    a.getSettings().recordBatch = 1;
    a.getSettings().chunkTurns = 50;
    assert.equal(await a.run('commitTurns')([1]), true);
    const slots = [...a.getStore().entityStates.map(s => `${s.entity}.${s.slot}`)].sort();
    assert.deepEqual(slots, ['scene.date', '아리아.paid']);
});

test('usage is counted per task and resets with the day', async () => {
    const { noteUsage, usageTotals, roughTokens } = await import('../craft-engine.mjs');
    assert.equal(roughTokens('가나다 abcd'), 4);
    let u = noteUsage(null, 'record', '가'.repeat(100), '나'.repeat(10), '2026-01-01');
    u = noteUsage(u, 'light', 'abcd'.repeat(10), '', '2026-01-01');
    assert.deepEqual(usageTotals(u), { calls: 2, in: 110, out: 10 });
    u = noteUsage(u, 'record', '가', '나', '2026-01-02');
    assert.deepEqual(usageTotals(u), { calls: 1, in: 1, out: 1 });
});
