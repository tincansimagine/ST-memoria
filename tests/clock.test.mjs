import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';

async function app() {
    const a = await runtime();
    a.getStore();
    a.getSettings().chunkTurns = 50;
    return a;
}

/** 이미 기록된 턴 n개를 깐다 (elapsed: 턴마다 흐른 일수) */
function seedTurns(a, elapsed) {
    const chat = a.context.chat;
    const store = a.getStore();
    elapsed.forEach((days, i) => {
        chat.push({ is_user: true, mes: `${i + 1}번째 행동`, name: '여행자' }, { is_user: false, mes: `아리아의 ${i + 1}번째 대답이다. 바람이 불었다.`, name: '아리아' });
        store.turns.push({ id: `t${i + 1}`, mesId: chat.length - 1, mesHash: a.mesHashOf(chat[chat.length - 1]), turnIndex: i + 1, summary: `${i + 1}번째 일.`, importance: 0.5, elapsedDays: days });
    });
    store.turnCounter = elapsed.length;
}
const addExchange = (a, text) => {
    a.context.chat.push({ is_user: true, mes: '다음 장면', name: '여행자' }, { is_user: false, mes: text, name: '아리아' });
    return a.context.chat.length - 1;
};
const total = (store) => store.turns.reduce((s, t) => s + (t.elapsedDays || 0), 0);

test('durations are read however the librarian writes them', async () => {
    const a = await app();
    const days = a.run('parseDurationDays');
    const near = (raw, want) => assert.ok(Math.abs(days(raw) - want) < 0.02, `${raw} → ${days(raw)} (want ${want})`);
    near('2mo', 60); near('2 months', 60); near('about 2 months', 60); near('two months later', 60);
    near('두 달', 60); near('2개월 후', 60); near('3주', 21); near('1d 6h', 1.25); near('a week', 7);
    near('사흘', 3); near('열흘', 10); near('보름', 15); near('일주일', 7); near('하루', 1);
    near('30m', 30 / 1440); near('6 hours', 0.25); near('3 years', 1095); near('1y', 365);
    assert.equal(days('0'), 0);
    assert.equal(days('none'), 0);
    assert.equal(days('잠시 후'), 0);
});

test('the librarian is told the day so far and answers with the day now; a skip it missed in "time_passed" still counts', async () => {
    const a = await app();
    seedTurns(a, [0, 1, 2]);
    a.getSettings().recordBatch = 1;
    let asked = '';
    a.context.generateRaw = async ({ prompt, systemPrompt }) => {
        asked = `${systemPrompt}\n${prompt[0].content}`;
        return JSON.stringify({ digest: '두 달 뒤, 아리아가 등대로 돌아왔다.', time_passed: '0', clock: { day: 64 }, memories: [] });
    };
    assert.equal(await a.run('commitTurns')([addExchange(a, '두 달이 흘렀다. 아리아는 다시 등대 문 앞에 섰다.')]), true);
    assert.match(asked, /STORY CLOCK: before this exchange the story stood at day 4/);
    const store = a.getStore();
    assert.equal(store.turns.at(-1).elapsedDays, 60, 'day 4 → day 64');
    assert.equal(a.run('storyDayBefore')(store, store.turnCounter + 1), 64);
});

test('without a day answer the written duration is used, and a day that runs backward is ignored', async () => {
    const a = await app();
    seedTurns(a, [0, 1, 2]);
    a.getSettings().recordBatch = 1;
    a.run('setTimeout = (fn) => { fn(); return 0; }');
    a.context.generateRaw = async () => JSON.stringify({ digest: '두 달 뒤의 일.', time_passed: 'about 2 months', memories: [] });
    await a.run('commitTurns')([addExchange(a, '두 달이 흘렀다. 등대는 그대로였다.')]);
    assert.equal(Math.round(a.getStore().turns.at(-1).elapsedDays), 60);

    a.context.generateRaw = async () => JSON.stringify({ digest: '옛일을 떠올렸다.', time_passed: '2h', clock: { day: 2 }, memories: [] });
    await a.run('commitTurns')([addExchange(a, '아리아는 처음 만난 날을 떠올렸다. 그날도 바람이 불었다.')]);
    assert.ok(a.getStore().turns.at(-1).elapsedDays < 0.1, 'a flashback does not move the clock');
});

test('batched recording reads a day for every exchange', async () => {
    const a = await app();
    seedTurns(a, [0, 1]);
    const ids = [addExchange(a, '그날 밤 두 사람은 모닥불을 피웠다. 불이 타올랐다.'), addExchange(a, '다음 날 아침이 밝았다. 새가 울었다.'), addExchange(a, '열흘 뒤, 항구에 배가 들어왔다. 사람들이 몰려들었다.')];
    let asked = '';
    a.context.generateRaw = async ({ systemPrompt }) => {
        asked = systemPrompt;
        return JSON.stringify({ digests: [{ n: 1, digest: '모닥불.', day: 2, time_passed: '3h' }, { n: 2, digest: '아침.', day: 3 }, { n: 3, digest: '열흘 뒤 항구.', day: 13 }], memories: [] });
    };
    assert.equal(await a.run('commitTurns')(ids), true);
    assert.match(asked, /stood at day 2[\s\S]*give every "digests" entry a "day"/);
    const last3 = a.getStore().turns.slice(-3).map(t => Math.round(t.elapsedDays * 100) / 100);
    assert.deepEqual([...last3], [0.13, 1, 10]);
});

test('the ledger says which story day it is now and how far back each thing happened', async () => {
    const a = await app();
    seedTurns(a, [0, 1, 0, 60, 0, 0]);
    const store = a.getStore();
    store.memories.push(memory('maid', { summary: '보라가 저택의 메이드로 입사했다', turnIndex: 2, pinned: true }));
    store.entityStates.push({ id: 's1', entity: '보라', slot: 'job', value: '저택의 메이드', claim: 'objective', owner: null, turnIndex: 2, createdTurn: 2 });
    store.chunkSummaries.push({ id: 'c1', fromTurn: 1, toTurn: 3, text: 'PLOT:\n- 보라가 저택에 왔다.' });
    a.getSettings().autoHide = false;
    const packet = (await a.buildPacketWithinBudget('보라', null)).text;
    assert.match(packet, /Story time has moved: the story is now on day 62/);
    assert.match(packet, /story clock: day 62 — about 2 months since the story began/);
    assert.match(packet, /day 2, ~2 months ago in-story\) 보라가 저택의 메이드로 입사했다/);
    assert.match(packet, /story days 1–2\]/);
    assert.match(packet, /보라\.job = 저택의 메이드 \(unchanged for ~2 months in-story/);
});

test('recalculating the clock asks for the day of every turn and rebuilds the gaps from the answers', async () => {
    const a = await app();
    seedTurns(a, [0, 0.2, 0, 0, 0]);
    const store = a.getStore();
    let asked = '';
    a.context.generateRaw = async ({ prompt, systemPrompt }) => {
        asked = `${systemPrompt}\n${prompt[0].content}`;
        return JSON.stringify({ t1: 1, t2: 1, t3: 2, t4: 62, t5: 61 });
    };
    await a.run('recalibrateStoryClock')({ silent: true });
    assert.match(asked, /give the STORY DAY/);
    assert.match(asked, /\(the story begins here, on day 1\)/);
    assert.deepEqual([...store.turns.map(t => t.elapsedDays)], [0, 0.2, 1, 60, 0], 'same-day hours are kept; a day that goes backward is flattened');
    assert.equal(Math.round(total(store)), 61);
});

test('whatever shape the day answer takes, it is read', async () => {
    const a = await app();
    const day = a.run('readStoryDay');
    for (const v of [64, '64', 'day 64', 'Day 64 (two months later)', '64일째', '이야기 64일차', { day: 64 }, { day: 'day 64' }, { story_day: 64 }]) assert.equal(day(v), 64, JSON.stringify(v));
    assert.ok(Number.isNaN(day(null)));
    assert.ok(Number.isNaN(day('모름')));
});

test('a reply without the clock is sent back once; the librarian\'s own "now" line goes into the ledger as written', async () => {
    const a = await app();
    seedTurns(a, [0, 1, 2]);
    a.getSettings().recordBatch = 1;
    a.run('setTimeout = (fn) => { fn(); return 0; }'); // 재시도 사이의 기다림을 건너뛴다
    const asked = [];
    a.context.generateRaw = async ({ systemPrompt }) => {
        asked.push(systemPrompt);
        return asked.length === 1
            ? JSON.stringify({ digest: '두 달 뒤, 아리아가 등대로 돌아왔다.', memories: [] })
            : JSON.stringify({ digest: '두 달 뒤, 아리아가 등대로 돌아왔다.', clock: 'Day 64', now: '초겨울 저녁, 등대를 떠난 지 두 달 뒤', memories: [] });
    };
    await a.run('commitTurns')([addExchange(a, '두 달이 흘렀다. 아리아는 다시 등대 문 앞에 섰다.')]);
    assert.equal(asked.length, 2, 'asked again because the clock was missing');
    assert.match(asked[1], /CLOCK MISSING/);
    const store = a.getStore();
    assert.equal(store.turns.at(-1).elapsedDays, 60);
    assert.equal(store.turns.at(-1).nowNote, '초겨울 저녁, 등대를 떠난 지 두 달 뒤');
    const packet = (await a.buildPacketWithinBudget('등대', null)).text;
    assert.match(packet, /when: 초겨울 저녁, 등대를 떠난 지 두 달 뒤/);

    // 두 번 다 비워 두면 추측하지 않는다 — 그대로 받고 일지에 남긴다
    asked.length = 0;
    a.context.generateRaw = async ({ systemPrompt }) => { asked.push(systemPrompt); return JSON.stringify({ digest: '열흘 뒤 항구에 배가 들어왔다.', memories: [] }); };
    await a.run('commitTurns')([addExchange(a, '열흘이 지나 항구에 배가 들어왔다. 사람들이 몰려들었다.')]);
    assert.equal(asked.length, 2);
    assert.equal(store.turns.at(-1).elapsedDays, 0, 'the code does not guess from the text');
    assert.ok(a.run('activityLog').list().some(r => /서사 시계를 적지 않았어요/.test(r.text)));
});
