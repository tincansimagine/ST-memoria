import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './runtime.mjs';
import { readTies, latestFeelings, cleanTieName, cleanShift, sameText } from '../craft-engine.mjs';
import { buildChanges } from '../story-view.mjs';

test('tie names are stated flatly; hedged or empty names are refused', () => {
    assert.equal(cleanTieName('"믿음 섞인 애정."'), '믿음 섞인 애정');
    assert.equal(cleanTieName('질투 (아마)'), '질투');
    assert.equal(cleanTieName('아마 질투?'), '');
    assert.equal(cleanTieName('none'), '');
    assert.equal(cleanShift({ who: '도겸 → 시온', to: '의심 → 신뢰', kind: '감정' }).toward, '시온');
    assert.equal(cleanShift({ who: '도겸', from: '신뢰', to: '신뢰' }), null, 'no change is not a shift');
    assert.equal(sameText('완전히 믿게 됨', '완전히 믿게 됨.'), true);
});

test('the latest feeling between two people in the scene wins; a tie name fills in when no shift exists', () => {
    const shifts = [
        { kind: 'emotion', who: '도겸', toward: '시온', from: '의심', to: '경계', turnIndex: 3 },
        { kind: 'emotion', who: '도겸', toward: '시온', from: '경계', to: '깊은 신뢰', why: '정체를 털어놓음', turnIndex: 9 },
        { kind: 'situation', who: '도겸', to: '이직', turnIndex: 10 },
        { kind: 'emotion', who: '유원', toward: '시온', to: '질투', turnIndex: 11 },
    ];
    const bonds = [{ from: '시온', to: '도겸', name: '기대는 사랑', nameTurn: 8 }];
    const here = new Set(['도겸', '시온']);
    const rows = latestFeelings(shifts, bonds, n => here.has(n));
    assert.deepEqual(rows.map(r => [r.from, r.to, r.now]), [['도겸', '시온', '깊은 신뢰'], ['시온', '도겸', '기대는 사랑']]);
    assert.equal(rows[0].was, '경계');
});

test('shifts join the change view without doubling a step the bond log already shows', () => {
    const bonds = [{ from: '도겸', to: '시온', log: [{ stage: '선후배', turn: 1 }, { stage: '연인', turn: 5, basis: '고백' }] }];
    const rows = buildChanges({ bonds, shifts: [
        { kind: 'relationship', who: '도겸', toward: '시온', from: '선후배', to: '연인', why: '옥상 고백', turnIndex: 5 },
        { kind: 'growth', who: '시온', to: '숨기지 않는다', why: '받아들여짐', turnIndex: 6 },
    ] });
    assert.equal(rows.filter(r => r.kind === 'bond').length, 1);
    assert.equal(rows.find(r => r.kind === 'bond').note, '고백', 'the bond step keeps its own basis');
    assert.equal(rows.find(r => r.kind === 'growth').note, '받아들여짐');
});

test('a recorded turn names the tie and files shifts; rolling the turn back takes them away', async () => {
    const a = await runtime();
    const store = a.getStore();
    a.getSettings().recordBatch = 1;
    a.getSettings().storyClock = false;
    a.run('setTimeout = (fn) => { fn(); return 0; }');
    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '시온이 도겸에게 사실을 털어놓았다.', name: '여행자' }, { is_user: false, mes: '도겸은 한참 말이 없다가 시온의 손을 잡았다. "괜찮아. 알고 있었어."', name: '아리아' });
    let asked = '';
    a.context.generateRaw = async ({ systemPrompt }) => {
        asked = systemPrompt;
        return JSON.stringify({
            digest: '시온이 비밀을 털어놓고 도겸이 받아들였다.', weight: 0.7, time_passed: '0',
            memories: [{ kind: 'event', summary: '시온이 도겸에게 비밀을 털어놓았다', importance: 0.7, entities: ['시온', '도겸'] }],
            bonds: [{ from: '도겸', to: '시온', stage: '연인', basis: '손을 잡았다', name: '다 알고도 잡은 손', kind: 'love' }],
            shifts: [{ kind: 'emotion', who: '도겸', toward: '시온', from: '서운함', to: '안도', why: '시온이 먼저 털어놓아서' }],
        });
    };
    await a.run('commitTurns')([chat.length - 1]);
    assert.match(asked, /RELATION NAMES AND SHIFTS/);
    const bond = store.bonds.find(b => b.from === '도겸');
    assert.equal(bond.name, '다 알고도 잡은 손');
    assert.equal(store.shifts.length, 1);
    assert.equal(store.turns.at(-1).tie, true);
    assert.match(a.run('formatBondLine')(bond), /도겸 → 시온 \(다 알고도 잡은 손\)/);
    a.removeDerivedForTurn(store, store.turns.at(-1).turnIndex);
    assert.equal(store.shifts.length, 0);
    assert.equal(store.bonds.find(b => b.from === '도겸')?.name, undefined, 'the line that turn opened goes with it');
});

test('a tie name set by a later turn falls back to the earlier name when that turn is rolled back', async () => {
    const a = await runtime();
    const store = a.getStore();
    store.bonds = [{ id: 'b1', from: '도겸', to: '시온', log: [{ stage: '선후배', turn: 1 }, { stage: '연인', turn: 4 }], name: '설레는 후배 사랑', nameTurn: 4, nameWas: { name: '편한 후배', turn: 1 } }];
    store.turns.push({ id: 't4', turnIndex: 4, mesId: 7, summary: 'x' });
    a.removeDerivedForTurn(store, 4);
    assert.equal(store.bonds[0].name, '편한 후배');
    store.bonds[0].nameManual = true;
    store.bonds[0].nameTurn = 1;
    a.removeDerivedForTurn(store, 1);
    assert.equal(store.bonds[0]?.name ?? '편한 후배', '편한 후배', 'a name the user wrote stays');
});

test('the ledger carries the latest feelings in its changing part', async () => {
    const a = await runtime();
    const parts = {
        rules: [], characters: [], bonds: [], items: [], summaries: [], locks: [], banned: [], states: [], publicRecall: [], protectedRecall: [], milestones: [],
        feelings: [{ from: '도겸', to: '시온', now: '깊은 신뢰', was: '경계', why: '정체를 털어놓음', turn: 9 }],
    };
    const text = a.renderPacket(parts, {});
    assert.match(text, /How They Feel Right Now/);
    assert.match(text, /도겸 → 시온: 깊은 신뢰 \(was: 경계; since: 정체를 털어놓음\)/);
    assert.doesNotMatch(a.renderPacket({ ...parts, feelings: [] }, {}), /How They Feel/);
});

test('a card that introduces several people and not itself voices many characters', async () => {
    const { cardVoicesMany } = await import('../craft-engine.mjs');
    const card = { name: '학교 시뮬레이터', description: '이름: 한서진\n나이: 17\n성격: 차분함\n\n이름: 차유원\n나이: 18\n\n이름: {{user}}' };
    assert.deepEqual(cardVoicesMany(card, '시온'), ['한서진', '차유원']);
    assert.deepEqual(cardVoicesMany({ name: '아리아', description: '이름: 아리아\n등대지기. 친구 이름: 미나'.padEnd(60, ' ') }, '여행자'), []);
});

test('in a chat set to "several characters", nothing is filed under the card name', async () => {
    const a = await runtime();
    const store = a.getStore();
    store.cardCast = 'many';
    a.getSettings().characterTracking = true;
    a.getSettings().recordBatch = 1;
    a.getSettings().storyClock = false;
    a.run('setTimeout = (fn) => { fn(); return 0; }');
    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '교실 문을 연다.', name: '여행자' }, { is_user: false, mes: '서진이 고개를 들었다. "왔어?" 유원은 창밖만 보았다.', name: '아리아' });
    let asked = '';
    a.context.generateRaw = async (args) => {
        asked = JSON.stringify(args);
        return JSON.stringify({
            digest: '여행자가 교실에 들어왔다.', weight: 0.4, time_passed: '0', memories: [{ kind: 'event', summary: '서진이 인사했다', importance: 0.4, entities: ['서진', '아리아'] }],
            cast: [{ name: '아리아', traits: ['해설'] }, { name: '서진', traits: ['차분함'] }],
            status: [{ entity: '아리아', slot: 'mood', value: '평온' }],
        });
    };
    await a.run('commitTurns')([chat.length - 1]);
    assert.match(asked, /voices several characters/);
    assert.deepEqual([...store.characters.map(c => c.name)], ['서진']);
    assert.equal(store.entityStates.some(s => s.entity === '아리아'), false);
    assert.equal(store.memories.some(m => (m.entities || []).includes('아리아')), false);
});
