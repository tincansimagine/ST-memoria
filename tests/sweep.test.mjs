import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';

const STORY = 'PLOT:\n- 보라가 인장 반지를 보고 아리아가 왕녀임을 알아챘다.\n- 아리아는 여행자를 믿고 등대 열쇠를 맡겼다.\n- 둘은 항구로 떠났다.';

async function app() {
    const a = await runtime();
    const store = a.getStore();
    a.getSettings().chunkTurns = 500;
    const chat = a.context.chat;
    for (let n = 1; n <= 60; n++) {
        chat.push({ is_user: true, mes: `${n}번째 행동`, name: '여행자' }, { is_user: false, mes: `아리아의 ${n}번째 대답이다. 바람이 불었다.`, name: '아리아' });
        store.turns.push({ id: `t${n}`, mesId: chat.length - 1, mesHash: a.mesHashOf(chat[chat.length - 1]), turnIndex: n, summary: `${n}번째 일.`, importance: 0.5 });
    }
    store.turnCounter = 60;
    store.chunkSummaries.push({ id: 'c1', fromTurn: 1, toTurn: 40, text: STORY });
    store.summaryCursor = 40;
    return a;
}
const lock = (id, kind, summary, turnIndex, extra = {}) => ({ id, kind, summary, status: 'active', priority: 2, turnIndex, createdTurn: turnIndex, ...extra });
const rule = (id, key, value, turnIndex, extra = {}) => ({ id, scope: 'world', key, value, turnIndex, valueTurn: turnIndex, createdTurn: turnIndex, hist: [], ...extra });
/** 프롬프트에서 그 글이 든 줄의 꼬리표를 찾는다 */
const tagOf = (body, text) => (body.split('\n').find(l => l.includes(text))?.match(/^\[([pk]\d+)\]/) || [])[1];

test('the sweep checks old pledges and canon against the story so far, takes only what the material shows, and never closes or deletes', async () => {
    const a = await app();
    const store = a.getStore();
    store.locks.push(
        lock('royal', 'keep_secret', '아리아가 왕녀라는 사실을 보라에게 숨긴다', 5),
        lock('key', 'loose_end', '사라진 금고 번호의 행방', 6),
        lock('late', 'keep_secret', '항구에서 본 배의 정체를 숨긴다', 50),
        lock('kept', 'keep_secret', '등대 지하의 문을 아무에게도 알리지 않는다', 5, { upheld: true }),
        lock('mine', 'keep_secret', '여행자가 직접 적은 비밀을 지킨다', 5, { manual: true }),
        lock('lost', 'keep_secret', '민호가 은나침반을 잃어버린 일을 아리아에게 숨긴다', 4),
        lock('plan', 'author_plan', '범인은 민호다', 3));
    store.worldRules.push(rule('r1', 'aria_trust', '아리아는 낯선 사람을 믿지 않는다', 3), rule('r2', 'harbor', '항구는 겨울에 닫힌다', 4), rule('r3', 'new', '새 규칙', 55));
    // 요약에는 없고 기억에만 남은 일 — 서약 옆에 함께 보여 준다
    store.memories.push(memory('told', { summary: '민호가 은나침반을 잃어버렸다고 아리아에게 털어놓았다', turnIndex: 30, entities: ['민호', '아리아'] }));

    let body = '';
    a.context.generateRaw = async ({ prompt, systemPrompt }) => {
        body = prompt[0].content;
        assert.match(systemPrompt, /"done"[\s\S]*"stale"/);
        return JSON.stringify({
            done: [
                { tag: tagOf(body, '왕녀라는 사실'), how: '보라가 반지를 보고 알아챘다', said: '인장 반지를 보고 아리아가 왕녀임을 알아챘다' },
                { tag: tagOf(body, '금고 번호'), how: '번호를 찾았다', said: '금고 번호를 벽에서 찾았다' },                 // 자료에 없는 글귀
                { tag: tagOf(body, '직접 적은 비밀'), how: '둘이 떠나며 끝났다', said: '둘은 항구로 떠났다' },
                { tag: tagOf(body, '은나침반'), how: '민호가 털어놓았다', said: '잃어버렸다고 아리아에게 털어놓았다' },   // 요약이 아니라 기억에 있는 글귀
            ],
            stale: [
                { tag: tagOf(body, '낯선 사람을 믿지'), now: '아리아는 여행자를 믿고 열쇠를 맡겼다', said: '여행자를 믿고 등대 열쇠를 맡겼다' },
                { tag: tagOf(body, '겨울에 닫힌다'), now: '항구는 열려 있는 것 같다', said: '둘은 항구로 떠났다' },                // 말끝을 흐린 판정
            ],
        });
    };
    const r = await a.run('auditPledges')(store);
    assert.deepEqual({ ...r }, { checked: 6, flagged: 3, stale: 1, premise: 0 });
    assert.match(body, /The story so far:\n[\s\S]*알아챘다/);
    assert.match(body, /은나침반을 잃어버린 일을 아리아에게 숨긴다\n {4}notes: 민호가 은나침반을 잃어버렸다고 아리아에게 털어놓았다/, 'the memory that touches the pledge rides along');
    for (const absent of ['항구에서 본 배', '등대 지하의 문', '범인은 민호', '새 규칙']) assert.doesNotMatch(body, new RegExp(absent), `${absent}: newer than the summary, upheld by the user, or the author's plan — not asked about`);

    const by = Object.fromEntries(store.locks.map(l => [l.id, l]));
    assert.deepEqual(['royal', 'key', 'mine', 'lost'].map(k => !!by[k].suggestResolved), [true, false, true, true]);
    assert.equal(by.royal.status, 'active', 'an opinion only — nothing is closed');
    assert.equal(by.royal.suggestTurn, null, 'not tied to a turn, so a reroll of that turn does not wipe it');
    assert.equal(by.royal.suggestHow, '보라가 반지를 보고 알아챘다');
    assert.equal(store.worldRules[0].expired, 60);
    assert.equal(store.worldRules[1].expired, undefined, 'a hedged verdict is not taken');
    assert.equal(store.worldRules.length, 3, 'nothing is deleted');
    assert.equal(store.pledgeAudit, 60);
    assert.equal(store.sweepRev, 2);

    const packet = (await a.buildPacketWithinBudget('항구', null)).text;
    const pledges = packet.split('## Pledges')[1].split('\n## ')[0];
    assert.doesNotMatch(pledges, /왕녀라는 사실|은나침반/, 'a pledge thought to be over is no longer carried');
    assert.match(pledges, /여행자가 직접 적은 비밀을 지킨다/, 'a hand-written pledge stays even with the opinion');
    assert.match(pledges, /금고 번호|등대 지하의 문/);
    assert.doesNotMatch(packet.split('## Canon')[1].split('\n## ')[0], /낯선 사람을 믿지 않는다/);
    assert.match(packet, /## Overtaken by the Story[\s\S]*\(was a standing fact\) 아리아는 낯선 사람을 믿지 않는다 — now: 아리아는 여행자를 믿고 열쇠를 맡겼다/);
});

test('the sweep runs once per chat after the first summary, then every so many turns, and can be switched off', async () => {
    const a = await app();
    const store = a.getStore();
    store.locks.push(lock('royal', 'keep_secret', '아리아가 왕녀라는 사실을 보라에게 숨긴다', 5));
    let calls = 0;
    a.context.generateRaw = async () => { calls++; return JSON.stringify({ done: [], stale: [] }); };
    const maybe = a.run('maybeAuditPledges');

    const saved = store.chunkSummaries.splice(0);
    await maybe(store);
    assert.equal(calls, 0, 'nothing to compare against before the first summary');
    store.chunkSummaries.push(...saved);
    await maybe(store);
    assert.equal(calls, 1);
    await maybe(store);
    assert.equal(calls, 1, 'not again until the interval has passed');
    store.locks[0].checkedTurn = null;
    store.turnCounter = 60 + 149;
    await maybe(store);
    assert.equal(calls, 1);
    store.turnCounter = 60 + 150;
    store.chunkSummaries[0].toTurn = 200;
    await maybe(store);
    assert.equal(calls, 2);

    // 예전 판의 훑기(서약만 봄)가 이미 돈 채팅도 캐논까지 보는 훑기를 한 번은 돈다
    delete store.sweepRev;
    await maybe(store);
    assert.equal(calls, 3);

    a.getSettings().pledgeSweepTurns = 0;
    store.turnCounter = 900;
    await maybe(store);
    assert.equal(calls, 3, '0 switches it off');

    // 볼 것이 없으면 모델을 부르지 않는다
    a.getSettings().pledgeSweepTurns = 150;
    store.locks.length = 0;
    await maybe(store);
    assert.equal(calls, 3);
    assert.equal(store.pledgeAudit, 900);
});

test('"still valid" and a pledge the story files again both bring a held-back pledge back; overtaken canon returns when the story states it again', async () => {
    const a = await app();
    const store = a.getStore();
    const up = a.run('upsertLock');
    store.locks.push(lock('royal', 'keep_secret', '아리아가 왕녀라는 사실을 보라에게 숨긴다', 5, { suggestResolved: true, suggestHow: '알아챘다' }),
        lock('gate', 'keep_secret', '북문의 열쇠를 숨긴다', 5, { upheld: true }));
    // 사서가 같은 서약을 다시 적었다 — 살아 있다는 뜻이다
    up(store, { kind: 'keep_secret', summary: '아리아가 왕녀라는 사실을 보라에게 숨긴다', status: 'active', priority: 2, owner: null }, 61);
    assert.equal(store.locks[0].suggestResolved, false);
    assert.equal(store.locks[0].turnIndex, 61);
    // 문구가 달라져 다시 적혀도 「아직 유효」 표시는 이어진다
    up(store, { kind: 'keep_secret', summary: '북문의 열쇠를 아무에게도 알리지 않고 숨긴다', status: 'active', priority: 2, owner: null }, 62);
    assert.equal(store.locks[1].upheld, true);
    assert.equal(store.locks.length, 2);

    store.worldRules.push(rule('r1', 'harbor', '항구는 겨울에 닫힌다', 4, { expired: 60, expiredNow: '항구가 다시 열렸다' }));
    a.run('upsertWorldRule')(store, { scope: 'world', key: 'harbor', value: '항구는 겨울에 닫힌다' }, 63);
    assert.equal(store.worldRules[0].expired, undefined);
    assert.equal(store.worldRules[0].expiredNow, undefined);
});

test('the sweep also holds the opening setup against the story: what the story overturned is carried as how things stand now', async () => {
    const a = await app();
    const store = a.getStore();
    // 시작 설정: 아리아는 남장을 하고 정체를 숨긴다 · 보라는 아리아를 남자로 안다
    a.run(`getContext = () => ({ characterId: 0, characters: [{ name: '아리아', description: '아리아는 남장을 하고 왕녀라는 정체를 숨긴 채 등대를 지킨다. 보라는 아리아를 남자로 알고 있다.', scenario: '보라가 등대에 새로 온다.' }] })`);
    let body = '';
    let system = '';
    a.context.generateRaw = async ({ prompt, systemPrompt }) => {
        body = prompt[0].content; system = systemPrompt;
        return JSON.stringify({ done: [], stale: [], premise: [
            { was: '아리아가 남장을 하고 정체를 숨긴다', now: '보라가 인장 반지를 보고 아리아가 왕녀임을 알아챘다 — 아리아는 더는 정체를 숨기지 않는다', said: '인장 반지를 보고 아리아가 왕녀임을 알아챘다' },
            { was: '보라는 아리아를 남자로 안다', now: '보라도 이제 안다', said: '보라가 아리아의 비밀을 퍼뜨렸다' },                 // 이야기에 없는 글귀
            { was: '등대를 지킨다', now: '등대를 떠난 듯하다', said: '둘은 항구로 떠났다' },                                                   // 말끝을 흐림
        ] });
    };
    const r = await a.run('auditPledges')(store);
    assert.equal(r.premise, 1);
    assert.match(system, /"premise"/);
    assert.match(body, /The opening setup \(written for the start of the story\):\n\[아리아\]\nDescription: 아리아는 남장을 하고/);
    assert.equal(store.premiseNotes.length, 1);

    const packet = (await a.buildPacketWithinBudget('보라', null)).text;
    const sec = packet.split('## Overtaken by the Story')[1].split('\n## ')[0];
    assert.match(sec, /where the character description or scenario reads otherwise, it describes the start of the story, not now/);
    assert.match(sec, /- \(opening setup\) 아리아가 남장을 하고 정체를 숨긴다 — now: 보라가 인장 반지를 보고 아리아가 왕녀임을 알아챘다/);

    // 틀린 것은 지우면 다시 붙지 않는다
    store.premiseDropped = ['아리아가 남장을 하고 정체를 숨긴다'];
    await a.run('auditPledges')(store);
    assert.equal(store.premiseNotes.length, 0);
});

test('the sweep waits until the story has some length, and runs again right after a past-chat index', async () => {
    const a = await app();
    const store = a.getStore();
    store.locks.push(lock('royal', 'keep_secret', '아리아가 왕녀라는 사실을 보라에게 숨긴다', 5));
    let calls = 0;
    a.context.generateRaw = async () => { calls++; return JSON.stringify({ done: [], stale: [], premise: [] }); };
    const maybe = a.run('maybeAuditPledges');
    store.turnCounter = 8;   // 색인 도중: 첫 요약이 막 생겼다
    await maybe(store);
    assert.equal(calls, 0, 'not on the first summary of an index run');
    store.turnCounter = 60;
    await maybe(store);
    assert.equal(calls, 1);
    store.turnCounter = 75;
    await maybe(store);
    assert.equal(calls, 1);
    await maybe(store, { afterIndex: true });
    assert.equal(calls, 2, 'an index that added more than ten turns gets a fresh look at the end');
    // 예전 판(시작 설정을 보지 않던 훑기)만 돈 채팅은 한 번 더 돈다
    store.sweepRev = 1;
    await maybe(store);
    assert.equal(calls, 3);
});
