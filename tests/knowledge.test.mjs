import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';
import { findConflicts, measuresIn, stripNegation } from '../craft-engine.mjs';

async function app() {
    const a = await runtime();
    a.getStore();
    return a;
}

const card = (name, extra = {}) => ({ id: `c-${name}`, name, aliases: [], traits: [], relationships: [], lines: [], growth: [], firstTurn: 1, updatedTurn: 1, ...extra });

test('conflict finder: one-per-person measures and a statement against its own denial', () => {
    const C = (key, text, turn = 1) => ({ key, about: 'aria', text, turn });
    const found = findConflicts([
        C('a', '아리아는 22살이다'), C('b', 'age 23살'),
        C('c', '보라는 술을 마신다'), C('d', '보라는 술을 마시지 않는다'),
        C('e', '아리아는 고양이를 키운다'), C('f', '아리아는 고양이를 무서워하지 않는다'),
        C('g', '동생이 있다'), C('h', '동생이 없다'),
        C('i', '키 170cm, 은발'), C('j', '키는 170 cm'),
        C('k', 'Aria can swim'), C('l', 'Aria cannot swim'),
    ], { names: ['아리아', '보라', 'aria'] });
    assert.deepEqual(found.map(x => `${x.a.key}${x.b.key}:${x.why}`).sort(), ['ab:age', 'cd:negation', 'gh:negation', 'kl:negation']);
    assert.deepEqual(findConflicts([C('a', '22살'), C('b', '23살')], { ignore: ['a|b'] }), [], 'a pair the user waved through stays quiet');
    assert.deepEqual(findConflicts([{ key: 'a', about: 'aria', text: '22살' }, { key: 'b', about: 'bora', text: '23살' }]), [], 'different people are never compared');
    assert.deepEqual([...measuresIn('아리아(22살)와 보라(25세)').age].sort(), ['22', '25']);
    assert.equal(stripNegation('술을 마시지 않는다').trim(), '술을 마시');
});

test('conflicts across a character card, a fact memory and a status are found, and picking a side retires the other', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 10;
    store.characters.push(card('아리아', { age: '22' }));
    store.memories.push(memory('old', { kind: 'fact', summary: '아리아는 23살이다', entities: ['아리아'], turnIndex: 2 }));
    store.entityStates.push({ id: 's1', entity: '아리아', slot: 'habit', value: '술을 마시지 않는다', claim: 'objective', owner: null, turnIndex: 8 });
    store.memories.push(memory('bar', { kind: 'preference', summary: '아리아는 술을 마신다', entities: ['아리아'], turnIndex: 3 }));
    store.memories.push(memory('ev', { kind: 'event', summary: '아리아는 24살 생일을 보냈다', entities: ['아리아'], turnIndex: 4 }));

    const found = a.run('currentConflicts')(store);
    assert.deepEqual(found.map(x => x.why).sort(), ['age', 'negation'], 'events are what happened, not standing claims');

    // 카드가 맞다고 고르면 사실 기억은 꺼지고, 상태가 맞다고 고르면 취향 기억이 꺼진다
    const age = found.find(x => x.why === 'age');
    a.run('dropClaim')(store, [age.a.key, age.b.key].find(k => k.startsWith('m:')));
    assert.equal(store.memories.find(m => m.id === 'old').disabled, true);
    const habit = a.run('currentConflicts')(store);
    assert.equal(habit.length, 1);
    store.conflictIgnore = [habit[0].pair];
    assert.equal(a.run('currentConflicts')(store).length, 0);
    assert.equal(store.memories.find(m => m.id === 'bar').disabled, false, '"both are right" changes nothing');
});

test('a secret is known only to people who were there or are named in the exchange', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push(card('보라'), card('민호', { aliases: ['민호 선배'] }));
    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '보라에게 귓속말을 했다', name: '여행자' },
        { is_user: false, mes: '아리아는 보라의 귀에 대고, 편지를 쓴 사람이 자신이라고 속삭였다. 보라는 숨을 삼켰다.', name: '아리아' });
    a.getSettings().recordBatch = 1;
    a.getSettings().chunkTurns = 50;
    a.context.generateRaw = async () => JSON.stringify({ digest: '아리아가 보라에게 편지의 발신인을 털어놓았다.', memories: [
        { kind: 'secret', summary: '편지를 쓴 사람은 아리아다', visibility: 'secret', owner: '아리아', known_by: ['보라', '민호', '여행자'], entities: ['아리아', '보라'], importance: 0.8 },
    ], status: [{ entity: 'scene', slot: 'present', value: '아리아, 보라, 여행자' }] });
    assert.equal(await a.run('commitTurns')([1]), true);
    const secret = store.memories.find(m => m.kind === 'secret');
    assert.deepEqual([...secret.knowers], ['보라', '여행자'], '민호 was not there and is not named, so he does not know');
    assert.ok(a.run('activityLog').list().some(r => /그 자리에 없던 인물 1명/.test(r.text)));
});

test('who does not know a secret is left to the writer: the line carries the librarian\'s record of who knows, nothing guessed from the scene', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 10;
    store.characters.push(card('아리아'), card('보라'), card('민호'));
    a.context.chat.push({ is_user: true, mes: '보라와 함께 등대로 갔다', name: '여행자' }, { is_user: false, mes: '보라는 계단 아래에서 기다렸다. 아리아는 위층 창을 열었다.', name: '아리아' });
    store.memories.push(memory('sec', { kind: 'secret', visibility: 'secret', owner: '아리아', knowers: ['민호'], summary: '편지를 쓴 사람은 아리아다', pinned: true }));
    const packet = (await a.buildPacketWithinBudget('편지', null)).text;
    assert.match(packet, /\[secret:아리아 · also known to 민호\] 편지를 쓴 사람은 아리아다/);
    assert.doesNotMatch(packet, /not known to/);
});
