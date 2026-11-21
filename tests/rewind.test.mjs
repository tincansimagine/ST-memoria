import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runtime } from './runtime.mjs';

async function app() {
    const a = await runtime();
    a.getStore();
    a.getSettings().recordBatch = 1;
    a.getSettings().chunkTurns = 50;
    a.getSettings().itemTracking = true;
    return a;
}

/** 턴마다 무엇이 바뀌는지 — 위치는 1·3·5턴, 물건 주인은 2·4·6턴, 관계는 3·5턴, 캐논은 2·5턴 */
const PLAN = {
    1: { status: [{ entity: '아리아', slot: 'location', value: '등대' }], cast: [{ name: '아리아', relationships: [{ target: '보라', relation: '낯선 사람' }] }], canon: [{ key: 'king', value: '왕은 살아 있다' }], items: [{ name: '나침반', holder: '아리아', status: 'kept' }] },
    2: { canon: [{ key: 'king', value: '왕이 병들었다' }], items: [{ name: '나침반', holder: '보라', status: 'given' }] },
    3: { status: [{ entity: '아리아', slot: 'location', value: '시장' }], cast: [{ name: '아리아', relationships: [{ target: '보라', relation: '친구' }] }] },
    4: { items: [{ name: '나침반', holder: '민호', status: 'given' }] },
    5: { status: [{ entity: '아리아', slot: 'location', value: '왕궁' }], cast: [{ name: '아리아', relationships: [{ target: '보라', relation: '원수' }] }], canon: [{ key: 'king', value: '왕이 죽었다' }] },
    6: { items: [{ name: '나침반', holder: '아리아', status: 'lost' }] },
};

async function playSixTurns(a) {
    const chat = a.context.chat;
    let n = 0;
    a.context.generateRaw = async () => JSON.stringify({ digest: `${n}번째 일.`, memories: [{ kind: 'event', summary: `${n}번째 사건이 일어났다`, importance: 0.5 }], ...PLAN[n] });
    for (n = 1; n <= 6; n++) {
        chat.push({ is_user: true, mes: `${n}번째 행동`, name: '여행자' }, { is_user: false, mes: `아리아가 ${n}번째로 대답했다. 바람이 ${n}번 불었다.`, name: '아리아' });
        assert.equal(await a.run('commitTurns')([chat.length - 1]), true);
    }
}

const loc = (store) => store.entityStates.find(s => s.slot === 'location')?.value;
const king = (store) => store.worldRules.find(r => r.key === 'king')?.value;
const compass = (store) => store.items.find(i => i.name === '나침반');
const rel = (store) => store.characters.find(c => c.name === '아리아')?.relationships?.find(r => r.target === '보라')?.relation;

test('branching back to an earlier turn restores every value as it was then, however often it changed after', async () => {
    const a = await app();
    await playSixTurns(a);
    const store = a.getStore();
    assert.equal(loc(store), '왕궁');
    assert.equal(king(store), '왕이 죽었다');
    assert.equal(compass(store).holder, '아리아');
    assert.equal(compass(store).status, 'lost');
    assert.equal(rel(store), '원수');

    // 4턴 뒤에서 분기: 메시지 8개(교환 4개)만 남는다
    a.context.chat.length = 8;
    a.run('reconcileWithChat')();

    assert.equal(store.turns.length, 4);
    assert.equal(loc(store), '시장', 'location as of turn 4 (set at 3), not the palace from turn 5');
    assert.equal(king(store), '왕이 병들었다', 'canon as of turn 4');
    assert.equal(compass(store).holder, '민호', 'the compass is with 민호 at turn 4');
    assert.equal(compass(store).status, 'given');
    assert.equal(rel(store), '친구', 'the relationship as of turn 4');
    assert.ok(!store.memories.some(m => /5번째|6번째/.test(m.summary)), 'no memory from the cut-off future');
    assert.ok(a.run('activityLog').list().some(r => /되감기·분기를 알아채 t4 뒤의 기록 2턴/.test(r.text)));

    // 더 뒤로 — 1턴까지
    a.context.chat.length = 2;
    a.run('reconcileWithChat')();
    assert.equal(loc(store), '등대');
    assert.equal(king(store), '왕은 살아 있다');
    assert.equal(compass(store).holder, '아리아');
    assert.equal(compass(store).status, 'kept');
    assert.equal(rel(store), '낯선 사람');
});

test('a branch point inside a value\'s lifetime keeps values that were only reconfirmed', async () => {
    const a = await app();
    const store = a.getStore();
    const up = a.run('upsertEntityState');
    up(store, { entity: '보라', slot: 'injury', value: '팔 골절', claim: 'objective', owner: null }, 2);
    up(store, { entity: '보라', slot: 'injury', value: '팔 골절', claim: 'objective', owner: null }, 5); // 다시 확인만
    const rolled = a.run('rollbackOrDrop')(store.entityStates, 5);
    assert.equal(rolled[0].value, '팔 골절', 'a reconfirmation is not a change');
    assert.equal(rolled[0].turnIndex, 2);
});

test('archives written before value history: a rewind drops what it cannot restore instead of leaking the future', async () => {
    const a = await app();
    const store = a.getStore();
    const chat = a.context.chat;
    for (let n = 1; n <= 6; n++) {
        chat.push({ is_user: true, mes: `${n}번째 행동`, name: '여행자' }, { is_user: false, mes: `아리아의 ${n}번째 대답.`, name: '아리아' });
        store.turns.push({ id: `t${n}`, mesId: chat.length - 1, mesHash: a.mesHashOf(chat[chat.length - 1]), turnIndex: n, summary: `${n}번째 일.`, importance: 0.5 });
    }
    store.turnCounter = 6;
    // 옛 형식: 바로 앞 값 하나만 있다. 위치는 2턴에 생겨 5턴·6턴에 바뀌었다 (5턴의 값은 기록이 없다)
    store.entityStates.push(
        { id: 'loc', entity: '아리아', slot: 'location', value: '왕궁 지하', claim: 'objective', owner: null, turnIndex: 6, createdTurn: 2, prev: '왕궁', prevTurn: 5 },
        { id: 'mood', entity: '아리아', slot: 'goal', value: '왕을 만난다', claim: 'objective', owner: null, turnIndex: 6, createdTurn: 1, prev: '등대를 지킨다', prevTurn: 1 },
        { id: 'old', entity: '보라', slot: 'job', value: '등대지기', claim: 'objective', owner: null, turnIndex: 3, createdTurn: 3, prev: null, prevTurn: null },
    );
    store.items.push({ id: 'i1', name: '나침반', holder: '민호', status: 'lost', firstTurn: 1, updatedTurn: 6, disabled: false, manual: false });

    chat.length = 8; // 4턴까지
    a.run('reconcileWithChat')();
    assert.equal(store.entityStates.find(s => s.id === 'loc'), undefined, 'its value at turn 4 is unknown — dropped, the next record refiles it');
    assert.equal(store.entityStates.find(s => s.id === 'mood').value, '등대를 지킨다', 'the one step back is known and before turn 4');
    assert.equal(store.entityStates.find(s => s.id === 'old').value, '등대지기', 'untouched since before the branch point');
    assert.equal(store.items[0].holder, null, 'who held it at turn 4 is unknown');
    assert.equal(store.items[0].name, '나침반', 'but the compass itself existed');
});

test('the settings drawer is left to SillyTavern to open and close', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const rules = [...css.matchAll(/([^{}]*\.inline-drawer-content[^{}]*)\{([^}]*)\}/g)].filter(m => !/>\s*\*|\s\.memoria/.test(m[1].split(',').pop()));
    for (const [, selector, body] of rules) {
        assert.doesNotMatch(body, /(^|;|\s)display\s*:/, `"${selector.trim()}" must not set display — the panel would always open expanded`);
    }
});
