import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './runtime.mjs';

async function app() {
    const a = await runtime();
    a.getSettings().recordBatch = 1;
    a.getSettings().storyClock = false;
    a.run('setTimeout = (fn) => { fn(); return 0; }');
    return a;
}
const said = (a, user, reply) => { a.context.chat.push({ is_user: true, mes: user, name: '여행자' }, { is_user: false, mes: reply, name: '아리아' }); return a.context.chat.length - 1; };

test('flashbacks and dreams are filed as memories but never move the present', async () => {
    const a = await app();
    const x = a.run('sanitizeExtraction')({
        digest: 'x', memories: [{ kind: 'event', summary: '어릴 적 아리아는 등대에서 길을 잃었다', when: 'flashback', importance: 0.5 }],
        status: [{ entity: '아리아', slot: 'location', value: '어린 시절의 등대', when: 'past' }, { entity: '아리아', slot: 'mood', value: '차분함' }],
        bonds: [{ from: '아리아', to: '여행자', stage: '낯선 사이', when: 'dream' }],
        settled: [{ tag: 'p1', how: '약속을 깼다', outcome: 'betrayed', said: '약속' }],
    }, '', '');
    assert.equal(x.memories[0].when, 'past');
    assert.equal(x.entityStates.length, 1);
    assert.equal(x.bonds.length, 0);
    assert.equal(x.offPresent, 2);
    assert.equal(x.settledOutcome.p1, 'broken');
});

test('a status or secret whose evidence is not in the text is dropped; one with real evidence stays', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push({ id: 'c1', name: '미나', aliases: [] });
    const id = said(a, '등대 문을 두드린다.', '아리아는 왼손에 붕대를 감은 채 문을 열었다. "미나한테는 말하지 마." 그녀가 속삭였다.');
    a.context.generateRaw = async () => JSON.stringify({
        digest: '아리아가 다친 손으로 문을 열었다.', weight: 0.5, time_passed: '0',
        status: [
            { entity: '아리아', slot: 'injury', value: '왼손 부상', said: '왼손에 붕대를 감은 채' },
            { entity: '아리아', slot: 'holding', value: '은반지', said: '은반지를 꼭 쥐었다' },
        ],
        memories: [
            { kind: 'secret', summary: '아리아는 손을 다친 일을 숨긴다', visibility: 'secret', owner: '아리아', importance: 0.7, said: '미나한테는 말하지 마', keep_from: ['미나'], unaware: ['미나', '여행자'] },
            { kind: 'secret', summary: '아리아는 사실 왕녀다', visibility: 'secret', owner: '아리아', importance: 0.9, said: '나는 왕녀다' },
            { kind: 'event', summary: '어릴 적 아리아는 이 등대에서 다쳤다', importance: 0.4, when: 'past' },
        ],
    });
    await a.run('commitTurns')([id]);
    assert.deepEqual([...store.entityStates.map(s => s.slot)].sort(), ['injury']);
    const secrets = store.memories.filter(m => m.kind === 'secret');
    assert.equal(secrets.length, 1, 'the made-up secret is not filed');
    assert.deepEqual([...secrets[0].keepFrom], ['미나']);
    const line = a.run('formatMemoryLine')(secrets[0], true, null, store.turnCounter);
    assert.match(line, /being kept from 미나/);
    const past = store.memories.find(m => m.when === 'past');
    assert.ok(past);
    assert.match(a.run('formatMemoryLine')(past, true, null, store.turnCounter), /flashback, not the present/);
});

test('a broken promise stays in the ledger for a while after it is settled', async () => {
    const a = await app();
    const store = a.getStore();
    store.locks.push({ id: 'l1', kind: 'keep_unresolved', summary: '도겸은 시온에게 거짓말하지 않겠다고 약속했다', status: 'active', priority: 2, turnIndex: 0 });
    const id = said(a, '도겸에게 묻는다.', '도겸은 시온의 눈을 피했다. "그날 나 집에 있었어." 거짓말이었다.');
    a.context.generateRaw = async () => JSON.stringify({ digest: '도겸이 거짓말을 했다.', weight: 0.6, time_passed: '0', memories: [], settled: [{ tag: 'p1', how: '도겸이 시온에게 거짓말했다', outcome: 'broken', said: '거짓말이었다' }] });
    await a.run('commitTurns')([id]);
    assert.equal(store.locks[0].status, 'resolved');
    assert.equal(store.locks[0].outcome, 'broken');
    const packet = (await a.buildPacketWithinBudget('도겸', null)).text;
    assert.match(packet, /## Broken/);
    assert.match(packet, /거짓말하지 않겠다고 약속했다/);
    a.removeDerivedForTurn(store, store.turns.at(-1).turnIndex);
    assert.equal(store.locks[0].status, 'active');
    assert.equal(store.locks[0].outcome, undefined);
});

test('swiping back to a reply that was already read reuses that answer without calling the model', async () => {
    const a = await app();
    const store = a.getStore();
    const id = said(a, '창문을 연다.', '바람이 들어와 촛불이 흔들렸다. 아리아가 고개를 들었다.');
    let calls = 0;
    a.context.generateRaw = async () => { calls++; return JSON.stringify({ digest: `기록 ${calls}`, weight: 0.4, time_passed: '0', memories: [{ kind: 'event', summary: `바람이 불었다 ${calls}`, importance: 0.4 }] }); };
    const chat = a.context.chat;
    const first = chat[id].mes;
    await a.run('commitTurns')([id]);
    assert.equal(calls, 1);
    chat[id].mes = '비가 들이쳐 바닥이 젖었다. 아리아가 창을 닫았다.';
    await a.run('commitTurns')([id]);
    assert.equal(calls, 2);
    chat[id].mes = first;
    await a.run('commitTurns')([id]);
    assert.equal(calls, 2, 'the first answer came back from the shelf');
    assert.equal(store.turns.at(-1).summary, '기록 1');
    assert.ok(store.recCache.length >= 2);
});

test('recall reads what kind of question it is and leans on the scene for a short input', async () => {
    const a = await app();
    const store = a.getStore();
    for (let i = 0; i < 3; i++) store.memories.push({ id: `m${i}`, kind: 'event', summary: `등대에서 있었던 일 ${i}`, turnIndex: 1, mesId: 1, importance: 0.5, entities: [], tags: [], hints: [], visibility: 'public', owner: null, pinned: false, disabled: false, vec: a.encodeVec(a.embedText(`등대에서 있었던 일 ${i}`)) });
    const now = await a.retrieveMemories('지금 어디야?', [], '');
    assert.equal(now.intent, 'current');
    const detail = await a.retrieveMemories('정확히 몇 개였지?', [], '');
    assert.equal(detail.intent, 'detail');
    const short = await a.retrieveMemories('응', [], '아리아가 등대 계단을 올라갔다.');
    assert.equal(short.shortQ, true);
    a.getSettings().recallTune = false;
    const off = await a.retrieveMemories('응', [], '아리아가 등대 계단을 올라갔다.');
    assert.equal(off.shortQ, false);
});

test('each reply keeps a note of the memories that were in its ledger, per swipe', async () => {
    const a = await app();
    const store = a.getStore();
    const id = said(a, '안녕', '아리아가 웃었다.');
    const diag = { sections: [{ name: 'Recalled Moments', tokens: 40 }], intent: 'current', rows: [{ id: 'm1', kind: 'event', summary: '실린 기억', included: true, reason: '문맥 유사도', score: 0.5 }, { id: 'm2', kind: 'fact', summary: '빠진 기억', included: false, excluded: '토큰 예산', score: 0.3 }] };
    assert.equal(a.run('noteShown')(store, a.context.chat[id], id, diag, 120), true);
    const e = a.run('shownFor')(store, id);
    assert.equal(e.rows.filter(r => r.inc).length, 1);
    assert.equal(e.intent, 'current');
    a.context.chat[id].swipe_id = 1;
    assert.equal(a.run('shownFor')(store, id), null, 'another swipe has its own note');
});
