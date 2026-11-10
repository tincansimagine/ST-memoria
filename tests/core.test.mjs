import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';

async function app() {
    const a = await runtime();
    a.getStore();
    return a;
}

test('extraction keeps only real spoken lines, sized feelings, and who knows a secret', async () => {
    const a = await app();
    const reply = '아리아는 문을 반만 열었다. "늦었네요." 그녀는 열쇠를 건넸다.';
    const out = a.run('sanitizeExtraction')({
        digest: '아리아가 열쇠를 맡겼다.', weight: 0.8,
        memories: [{ kind: 'secret', summary: '아리아는 편지를 숨겼다', visibility: 'secret', owner: '아리아', known_by: ['보라', ''] }],
        bonds: [{ from: '아리아', to: '여행자', stage: '마지못한 신뢰', basis: '열쇠를 맡겼다', calls: 'null', unsaid: '' },
            { from: '아리아', to: '아리아', stage: '자기 자신' }, { from: '아리아', to: '보라' }],
        cast: [{ name: '아리아', core: '약속을 무겁게 여긴다', line: '"늦었네요."', growth: 'n/a', voice: '짧은 존댓말' },
            { name: '보라', line: '지어낸 대사입니다' }],
        settled: ['p1', { tag: 'P2', how: '편지를 읽어 주었다' }],
    }, '문을 두드렸다.', reply);
    assert.deepEqual(JSON.parse(JSON.stringify(out.bonds)), [{ from: '아리아', to: '여행자', stage: '마지못한 신뢰', basis: '열쇠를 맡겼다', calls: '', unsaid: '' }]);
    assert.equal(out.characters[0].line, '늦었네요.');
    assert.equal(out.characters[0].growth, null);
    assert.equal(out.characters[1].line, null, 'an invented line is dropped');
    assert.deepEqual([...out.memories[0].knowers], ['보라']);
    assert.deepEqual([...out.settledPledges], ['p1', 'p2']);
    assert.equal(out.settledHow.p2, '편지를 읽어 주었다');
});

test('core characterization is written once; growth and lines accumulate and roll back with their turn', async () => {
    const a = await app();
    const store = a.getStore();
    const upsert = a.run('upsertCharacter');
    upsert(store, { name: '아리아', core: '약속을 무겁게 여긴다', line: '늦었네요.', traits: [] }, 1);
    upsert(store, { name: '아리아', core: '사실은 수다스럽다', line: '가지 마세요.', growth: '반지를 받은 뒤 날짜를 먼저 묻는다', traits: [] }, 2);
    const card = store.characters[0];
    assert.equal(card.core, '약속을 무겁게 여긴다', 'a later scene cannot rewrite the core');
    assert.deepEqual([...card.lines.map(l => l.text)], ['늦었네요.', '가지 마세요.']);
    assert.equal(card.growth.length, 1);

    a.removeDerivedForTurn(store, 2);
    assert.deepEqual([...card.lines.map(l => l.text)], ['늦었네요.']);
    assert.equal(card.growth.length, 0);
    assert.equal(card.core, '약속을 무겁게 여긴다');
    a.removeDerivedForTurn(store, 1);
    assert.equal(card.core, null, 'the core goes with the turn that wrote it');
});

test('the player character gets no voice samples outside novel mode; locked cards keep their core', async () => {
    const a = await app();
    const store = a.getStore();
    const upsert = a.run('upsertCharacter');
    upsert(store, { name: '여행자', line: '안녕하세요.', traits: [] }, 1);
    assert.equal(store.characters[0].lines.length, 0);
    upsert(store, { name: '보라', traits: [] }, 1);
    store.characters[1].locked = true;
    upsert(store, { name: '보라', core: '새로 쓴 캐해', line: '오랜만이야.', traits: [] }, 2);
    assert.equal(store.characters[1].core ?? null, null);
    assert.deepEqual([...store.characters[1].lines.map(l => l.text)], ['오랜만이야.'], 'samples are evidence, not profile');
});

test('a bond keeps its path, ignores restatements, and steps back when a turn is rolled back', async () => {
    const a = await app();
    const store = a.getStore();
    const upsert = a.run('upsertBond');
    const line = a.run('formatBondLine');
    upsert(store, { from: '아리아', to: '여행자', stage: '경계', basis: '문을 반만 열었다', calls: '손님' }, 1);
    upsert(store, { from: '아리아', to: '여행자', stage: '경계', basis: '', calls: '' }, 2);
    assert.equal(store.bonds[0].log.length, 1, 'restating the same stage files nothing');
    upsert(store, { from: '아리아', to: '여행자', stage: '마지못한 신뢰', basis: '열쇠를 맡겼다', calls: '' }, 3);
    upsert(store, { from: '아리아', to: '여행자', stage: '떠나보내기 싫음', basis: '반지를 받았다', calls: '', unsaid: '가지 말라는 말' }, 5);
    assert.equal(store.bonds.length, 1);
    assert.equal(store.bonds[0].log.at(-1).calls, '손님', 'an omitted address is inherited, not erased');
    assert.match(line(store.bonds[0]), /아리아 → 여행자: 떠나보내기 싫음 \| shown by: 반지를 받았다 \| calls them: 손님 \| unsaid: 가지 말라는 말 \| path so far: 경계 → 마지못한 신뢰 → now/);

    a.removeDerivedForTurn(store, 5);
    assert.equal(store.bonds[0].log.at(-1).stage, '마지못한 신뢰');
    a.removeDerivedForTurn(store, 3);
    a.removeDerivedForTurn(store, 1);
    assert.equal(store.bonds.length, 0);
    assert.equal(upsert(store, { from: '아리아', to: '아리아', stage: 'x' }, 1), null);
});

test('a secret reaches the people listed as knowing it, and the ledger says who they are', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 10;
    store.memories.push(memory('s1', { kind: 'secret', summary: '등대 창고 열쇠는 우물 아래에 있다', visibility: 'secret', owner: '보라', knowers: ['아리아'], pinned: true }));
    store.memories.push(memory('s2', { kind: 'secret', summary: '보라만 아는 다른 비밀', visibility: 'secret', owner: '보라', pinned: true }));
    const packet = (await a.buildPacketWithinBudget('열쇠', null)).text;
    assert.match(packet, /\[secret:보라 · also known to 아리아\] 등대 창고 열쇠/);
    assert.doesNotMatch(packet, /보라만 아는 다른 비밀/);
    assert.match(packet, /1 more entries sealed/);
});

test('banned phrases are scrubbed from the ledger and a quote containing one is dropped whole', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 10;
    a.getSettings().bannedPhrases = '나지막이\n입꼬리가 미세하게';
    store.worldRules.push({ id: 'r1', scope: 'world', key: 'habit', value: '아리아는 나지막이 웃는다', turnIndex: 1 });
    store.memories.push(memory('m1', { summary: '아리아가 등대 계단에서 웃었다', excerpt: '입꼬리가 미세하게 올라갔다', pinned: true }));
    store.memories.push(memory('m2', { summary: '아리아가 약속을 했다', excerpt: '꼭 돌아와요', pinned: true }));
    const packet = (await a.buildPacketWithinBudget('등대', null)).text;
    assert.doesNotMatch(packet, /나지막이|입꼬리가 미세하게/);
    assert.match(packet, /habit = 아리아는 웃는다/);
    assert.match(packet, /"꼭 돌아와요"/);
    a.getSettings().banTell = true;
    assert.match((await a.buildPacketWithinBudget('등대', null)).text, /Overused phrasings — do not write these in the reply: 입꼬리가 미세하게 · 나지막이/);
    a.getSettings().recallQuotes = false;
    assert.doesNotMatch((await a.buildPacketWithinBudget('등대', null)).text, /"꼭 돌아와요"/);
});

test('split injection freezes the stable block and carries changes as updates until it must be rewritten', async () => {
    const a = await app();
    const store = a.getStore();
    const settings = a.getSettings();
    settings.splitInjection = true;
    store.turnCounter = 10;
    store.worldRules.push({ id: 'r1', scope: 'world', key: 'lighthouse', value: '등대는 귀환을 알린다', turnIndex: 1 });
    store.memories.push(memory('m1', { summary: '아리아가 반지를 받았다', pinned: true }));

    const first = await a.buildPacketWithinBudget('반지', null);
    assert.ok(first.stableText.startsWith('<memoria_ledger>'));
    assert.match(first.stableText, /lighthouse = 등대는 귀환을 알린다/);
    assert.doesNotMatch(first.stableText, /## Recalled Moments/);
    assert.match(first.nowText, /^<memoria_now>[\s\S]*## Recalled Moments[\s\S]*<\/memoria_now>$/);
    assert.equal(first.diagnostics.split.refreshed, true);

    store.memories.push(memory('m2', { summary: '아리아가 편지를 숨겼다', pinned: true }));
    const second = await a.buildPacketWithinBudget('편지', null);
    assert.equal(second.stableText, first.stableText, 'new recall does not touch the cached block');
    assert.equal(second.diagnostics.split.refreshed, false);

    store.worldRules[0].value = '등대는 꺼졌다';
    store.worldRules.push({ id: 'r2', scope: 'world', key: 'harbor', value: '항구는 닫혔다', turnIndex: 10 });
    const third = await a.buildPacketWithinBudget('편지', null);
    assert.equal(third.stableText, first.stableText);
    assert.match(third.nowText, /## Archive Updates[\s\S]*- \[Canon\] \(world\) lighthouse = 등대는 꺼졌다[\s\S]*- \[Canon\] \(world\) harbor = 항구는 닫혔다/);

    store.worldRules.shift();
    const fourth = await a.buildPacketWithinBudget('편지', null);
    assert.notEqual(fourth.stableText, first.stableText, 'a removed entry forces a fresh block');
    assert.doesNotMatch(fourth.stableText, /lighthouse/);
    assert.doesNotMatch(fourth.nowText, /Archive Updates/);

    await a.updateInjection();
    const [stableCall, nowCall] = a.prompts.slice(-2);
    assert.equal(stableCall[0], 'memoria_archive');
    assert.equal(stableCall[1], fourth.stableText);
    assert.equal(nowCall[0], 'memoria_ledger');
    assert.ok(nowCall[1].startsWith('<memoria_now>'));

    settings.splitInjection = false;
    await a.updateInjection();
    const [stableOff, whole] = a.prompts.slice(-2);
    assert.equal(stableOff[1], '', 'the stable slot is cleared when the mode is turned off');
    assert.match(whole[1], /^<memoria_ledger>[\s\S]*## Recalled Moments/);
});

test('recall wait: a slow embedding call is abandoned and the reply is not held hostage', async () => {
    const a = await app();
    const never = () => new Promise(() => {});
    a.run('recallDeadlineAt = Date.now() + 30; recallTimedOut = false;');
    const began = Date.now();
    assert.equal(await a.run('withinRecallWait')(never, 'fallback'), 'fallback');
    assert.ok(Date.now() - began < 1000);
    assert.equal(a.run('recallTimedOut'), true);
    // 채팅을 열기만 했을 때(이미 지난 상한)는 네트워크를 아예 부르지 않는다
    let called = false;
    a.run('recallDeadlineAt = 1;');
    assert.equal(await a.run('withinRecallWait')(() => { called = true; return Promise.resolve('x'); }, null), null);
    assert.equal(called, false);
    a.run('recallDeadlineAt = 0;');
    assert.equal(await a.run('withinRecallWait')(() => Promise.resolve('x'), null), 'x');
});

test('default prompts carry the new shelves, and a customised prompt survives the revision', async () => {
    const a = await app();
    const prompts = a.getSettings().prompts;
    assert.match(prompts.archivist, /THE SIX SHELVES[\s\S]*bonds —[\s\S]*PEOPLE STAY THEMSELVES[\s\S]*"known_by"[\s\S]*"bonds":\[/);
    assert.match(prompts.chunk, /WHEN:[\s\S]*PLOT:[\s\S]*★/);
    assert.match(prompts.arc, /never flatten or reinterpret a personality/);

    const b = await runtime();
    b.context.extension_settings.memoria = { ...JSON.parse(JSON.stringify(a.getSettings())), promptRev: 22, prompts: { ...prompts, archivist: '내가 직접 쓴 사서 프롬프트' } };
    const migrated = b.getSettings();
    assert.equal(migrated.prompts.archivist, '내가 직접 쓴 사서 프롬프트');
    assert.equal(migrated.promptOutdated.archivist, 23);
    assert.equal(migrated.prompts.chunk, prompts.chunk);
});

test('summary sanitiser keeps the WHEN line and still cuts a continued scene', async () => {
    const a = await app();
    const clean = a.run('sanitizeRecordOutput');
    const out = clean('WHEN: 3일째 저녁 · 항구\nPLOT:\n- 아리아가 열쇠를 맡겼다.\nSHIFTS: 아리아 → 여행자: 마지못한 신뢰\n\n***\n\n아리아는 창밖을 보았다. 바람이 불었다. 그녀는 오래 서 있었다.');
    assert.match(out, /^WHEN: 3일째 저녁 · 항구\nPLOT:\n- 아리아가 열쇠를 맡겼다\.\nSHIFTS:/);
    assert.doesNotMatch(out, /창밖/);
    assert.equal(a.run('digestTag')({ turnIndex: 5, importance: 0.9, when: '3일째 저녁', where: '항구' }), 't5 ★ · 3일째 저녁 · 항구');
});

test('a recorded turn files bonds, voice samples and scene stamp end to end, and waits while a reply is generating', async () => {
    const a = await app();
    const reply = '아리아는 문을 반만 열었다. "늦었네요." 그녀는 한참 망설이다 창고 열쇠를 여행자의 손에 쥐여 주었다.';
    a.context.chat.push({ is_user: true, mes: '등대 문을 두드린다.', name: '여행자' }, { is_user: false, mes: reply, name: '아리아' });
    let calls = 0;
    a.context.generateRaw = async ({ prompt }) => {
        calls++;
        assert.match(prompt[0].content, /The cast shelf is empty/);
        return JSON.stringify({
            digest: '아리아가 망설이다 여행자에게 창고 열쇠를 맡겼다.', weight: 0.8, time_passed: '0',
            memories: [{ kind: 'event', summary: '아리아가 여행자에게 창고 열쇠를 맡겼다', importance: 0.7, entities: ['아리아', '여행자'], visibility: 'public' }],
            status: [{ entity: 'scene', slot: 'location', value: '등대 현관' }, { entity: 'scene', slot: 'date', value: '3일째' }, { entity: 'scene', slot: 'present', value: '아리아, 여행자' }],
            bonds: [{ from: '아리아', to: '여행자', stage: '마지못한 신뢰', basis: '창고 열쇠를 맡겼다', calls: '손님' }],
            cast: [{ name: '아리아', core: '약속을 무겁게 여긴다', voice: '짧은 존댓말', line: '늦었네요.', traits: [] }],
        });
    };
    // 답변 생성 중에는 기록을 시작하지 않는다
    a.run('setChatGenerating(true, "normal")');
    const pending = a.run('commitTurn')(1, { silent: true });
    await new Promise(r => setTimeout(r, 60));
    assert.equal(calls, 0);
    a.run('setChatGenerating(false)');
    assert.equal(await pending, true);
    assert.equal(calls, 1);

    const store = a.getStore();
    assert.equal(store.turns[0].when, '3일째');
    assert.equal(store.turns[0].where, '등대 현관');
    assert.equal(store.bonds[0].log[0].stage, '마지못한 신뢰');
    assert.equal(store.characters[0].core, '약속을 무겁게 여긴다');
    assert.equal(store.characters[0].lines[0].text, '늦었네요.');
    assert.ok(a.run('activityLog').list().some(r => r.kind === 'defer'));

    const packet = (await a.buildPacketWithinBudget('열쇠', null)).text;
    assert.match(packet, /## Bonds[\s\S]*아리아 → 여행자: 마지못한 신뢰/);
    assert.match(packet, /## Scene Now — place: 등대 현관 · date: 3일째 · present: 아리아, 여행자/);
    assert.match(packet, /## Voices[\s\S]*- 아리아: "늦었네요\."/);

    // 다른 확장이 화면만 다시 그렸으면 아무 일도 없고, 본문이 바뀌었으면 그 턴을 다시 기록한다
    assert.equal(store.turns[0].mesHash, a.mesHashOf(a.context.chat[1]));
    a.invalidateTurnByMesId(1);
    assert.equal(store.bonds.length, 0, 'the bond filed by that turn goes with it');
});
