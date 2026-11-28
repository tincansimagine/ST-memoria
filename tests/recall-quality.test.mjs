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
    assert.equal(row.log[0].backstory, true);
    up(store, { from: '아리아', to: '보라', stage: '서먹한 사이' }, 6);
    assert.equal(row.log.length, 2, 'the present tie a turn later is a new step, not a rewrite of the flashback one');
    assert.equal(row.log[0].stage, '소꿉친구');
    up(store, { from: '아리아', to: '보라', stage: '소꿉친구', calls: '리아', backstory: true }, 7);
    const now = a.run('bondNow')(store.bonds[0]);
    assert.equal(now.stage, '서먹한 사이', 'a flashback never moves the present tie');
    assert.equal(now.calls, '리아', 'but a form of address seen for the first time fills the empty slot');
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
    // 두 글자 이름은 다른 낱말 속에 든 것을 사람으로 세지 않는다
    assert.deepEqual(lost(store, ['보라색 커튼을 걷었다', '그녀는 하늘을 바라보라고 했다'], '커튼을 걷었다'), []);
    assert.deepEqual(lost(store, ['보라가 웃었다', '보라야, 가자'], '보라색 하늘'), ['보라']);
});

test('the summary trim never lets more summaries through than the limit, and keeps the newest one when room is tight', async () => {
    const a = await app();
    const keep = (...xs) => [...a.run('keepRootsAndRecent')(...xs)].map(r => r.id);
    const rows = [{ id: 'old', carried: true }, { id: 'saga', saga: true, level: 'arc' }, { id: 'a1', level: 'arc' }, { id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
    assert.deepEqual(keep(rows, 1), ['c3']);
    assert.deepEqual(keep(rows, 2), ['saga', 'c3']);
    assert.deepEqual(keep(rows, 3), ['old', 'saga', 'c3']);
    assert.deepEqual(keep([{ id: 'saga', saga: true }], 1), ['saga']);
});

test('a reply that only repeats the two leads\' names does not count as using the memory', async () => {
    const a = await app();
    const store = a.getStore();
    store.memories.push(memory('walk', { summary: '아리아와 여행자가 등대 근처를 걸으며 바람 이야기를 나눴다', entities: ['아리아', '여행자'], importance: 0.5 }));
    const echo = (reply) => {
        const mes = { is_user: false, mes: reply, name: '아리아' };
        a.context.chat.push(mes);
        a.run('recallAudit = { at: Date.now(), ids: ["walk"] };');
        a.run('auditRecallEcho')(mes, a.context.chat.length - 1);
        return store.memories[0];
    };
    assert.equal(echo('아리아는 여행자를 한참 바라보다가 아무 말 없이 고개를 끄덕였다. 창밖은 고요했다.').echoes || 0, 0);
    assert.equal(echo('아리아가 여행자에게 그날 등대 근처에서 나눈 바람 이야기를 꺼냈다. 둘은 웃었다.').echoes, 1);
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

test('verb endings reduce to their stem without touching plain nouns', async () => {
    const { verbStems } = await import('../craft-engine.mjs');
    const has = (w, st) => assert.ok(verbStems(w).includes(st), `${w} → ${st} (got ${verbStems(w).join(', ')})`);
    has('빚졌다', '빚'); has('지낸다', '지내'); has('다투었다', '다투'); has('다퉜다', '다투'); has('샀다', '사'); has('갔었다', '가');
    has('숨겼다', '숨기'); has('싸웠던', '싸우'); has('부르던', '부르'); has('흥얼거린다', '흥얼거리'); has('약속했다', '약속');
    has('좋아해', '좋아하'); has('공부하지', '공부'); has('빌려준', '빌려주'); has('건넸다', '건네');
    for (const noun of ['사건', '편지', '단장', '주인', '사진', '사고', '바다', '아버지', '어머니', '고양이', '나침반', '은반지', '돛단배', '기준', '하늘', '하나', '달러', '시간']) {
        assert.deepEqual(verbStems(noun), [], noun);
    }
    assert.deepEqual(verbStems('있었다'), ['있']);
});

test('a small concept table links words that mean the same thing', async () => {
    const { conceptTags } = await import('../craft-engine.mjs');
    const a = await app();
    const tags = (t) => [...conceptTags(a.run('stemSet')(t))];
    assert.ok(tags('둘이 왜 싸웠던 거야?').includes('~c:fight'));
    assert.ok(tags('아리아와 보라가 시장에서 크게 다투었다').includes('~c:fight'));
    assert.ok(tags('카엘은 고향 자장가를 흥얼거린다').includes('~c:music'));
    assert.deepEqual(tags('몇 살이야? 차 타고 가자'), [], 'one-letter words with several meanings are left out');
});

test('a full question is not treated as a short input that leans on the scene', async () => {
    const a = await app();
    const store = a.getStore();
    for (let i = 0; i < 3; i++) store.memories.push(withVec(a, memory(`m${i}`, { summary: `등대에서 있었던 일 ${i}` })));
    const scene = '아리아가 등대 계단을 올라갔다.';
    assert.equal((await a.retrieveMemories('응', [], scene)).shortQ, true);
    assert.equal((await a.retrieveMemories('*고개를 끄덕인다*', [], scene)).shortQ, true);
    assert.equal((await a.retrieveMemories('그래서?', [], scene)).shortQ, true);
    assert.equal((await a.retrieveMemories('리아는 어디서 지내?', [], scene)).shortQ, false);
    assert.equal((await a.retrieveMemories('나침반 어디 뒀더라', [], scene)).shortQ, false);
});

test('under a tight budget the scene leads keep their bond lines, whatever their names sort to', async () => {
    const a = await app();
    const bond = (from, to, stage) => ({ id: `${from}${to}`, from, to, log: [{ turn: 1, stage }], disabled: false });
    // 장면 인물의 줄이 앞에 온다 (buildPacketSections 의 차례) — 이름 차례로는 뒤쪽
    const parts = {
        rules: [], characters: [], items: [], summaries: [], locks: [], banned: [], states: [], publicRecall: [], protectedRecall: [], milestones: [],
        bonds: [bond('하린', '여행자', '깊은 신뢰'), bond('하린', '보라', '라이벌'), bond('가온', '나래', '옛 동료'), bond('나래', '가온', '서먹함')],
    };
    const text = a.renderPacket(parts, { charLimit: 2 });
    assert.match(text, /하린 → 여행자: 깊은 신뢰/);
    assert.match(text, /하린 → 보라: 라이벌/);
    assert.doesNotMatch(text, /가온 → 나래/);
});

test('when the budget is tight, middle eras shrink to their WHEN and SHIFTS lines before any is dropped', async () => {
    const a = await app();
    const era = (id, extra) => ({ id, level: 'arc', fromTurn: 1, toTurn: 2, text: `WHEN: ${id}의 때\nPLOT:\n- ${id}의 긴 줄거리\nSHIFTS: ${id}에서 남은 변화`, ...extra });
    const parts = {
        rules: [], characters: [], bonds: [], items: [], locks: [], banned: [], states: [], publicRecall: [], protectedRecall: [], milestones: [],
        summaries: [era('처음', { saga: true }), era('가운데'), { id: 'c1', fromTurn: 3, toTurn: 4, text: 'PLOT:\n- 최근 일' }],
    };
    const text = a.renderPacket(parts, { compactArcs: true });
    assert.match(text, /가운데에서 남은 변화/);
    assert.doesNotMatch(text, /가운데의 긴 줄거리/);
    assert.match(text, /처음의 긴 줄거리/, 'the oldest part keeps its plot');
    assert.match(text, /최근 일/);
});

test('more verb forms reduce to their stem: purpose -러, attached helper verbs, ㅂ-irregular, -던 after one letter, stem + 어/아', async () => {
    const { verbStems } = await import('../craft-engine.mjs');
    const has = (w, st) => assert.ok(verbStems(w).includes(st), `${w} → ${st} (got ${verbStems(w).join(', ')})`);
    has('사러', '사'); has('먹으러', '먹'); has('잃어버렸다', '잃'); has('찾아냈다', '찾'); has('숨긴', '숨기'); has('만든', '만들');
    has('구웠다', '굽'); has('굽던', '굽'); has('춤췄더라', '춤추'); has('약속했잖아', '약속'); has('갔대', '가'); has('적어', '적'); has('꽂아', '꽂');
    for (const noun of ['달러', '컬러', '킬러', '에러', '이해', '오해', '새해', '항해', '피해', '단어', '연어', '상어', '악어', '약어', '고려', '우려', '참여', '사진', '주인', '여신']) {
        assert.deepEqual(verbStems(noun), [], noun);
    }
});

test('the concept table leaves words with several meanings alone', async () => {
    const a = await app();
    const tags = (t) => [...a.run('conceptTags')(a.run('stemSet')(t))];
    for (const t of ['숨지 마', '멍하니 서 있었다', 'lie down here', '구속받기 싫어', '연고가 없는 도시', '중독성 있는 노래', '주문한 것', '차에 태워 줄게', '배고파']) {
        assert.ok(!tags(t).some(c => ['~c:death', '~c:hurt', '~c:lie', '~c:prison', '~c:heal', '~c:poison', '~c:fire', '~c:vessel'].includes(c)), `${t} → ${tags(t).join(',')}`);
    }
    assert.ok(tags('마르코가 생선 수프를 끓여 준다').includes('~c:cook'));
    assert.ok(tags('지하감옥에 갇혔다').includes('~c:prison'));
});

test('a recall cue counts distinct words, and a one-word cue matches by its stem', async () => {
    const a = await app();
    const store = a.getStore();
    for (let i = 0; i < 9; i++) store.memories.push(withVec(a, memory(`n${i}`, { summary: `여행자가 시장에서 ${i}번째 물건을 골랐다`, turnIndex: 10 + i })));
    store.memories.push(withVec(a, memory('ring', { summary: '아리아가 여행자에게 은반지를 건넸다', turnIndex: 2, hints: ['반지를 줬다'] })));
    store.memories.push(withVec(a, memory('fight', { summary: '아리아와 보라가 시장에서 말다툼을 벌였다', turnIndex: 3, hints: ['싸웠다'] })));
    const hint = async (q, id) => /검색 힌트/.test((await a.retrieveMemories(q, [], '')).trace.get(id)?.reason || '');
    assert.equal(await hint('반지를 봤어?', 'ring'), false, 'one word of the cue (in two forms) is not two words');
    assert.equal(await hint('반지를 줬잖아', 'ring'), true);
    assert.equal(await hint('둘이 싸웠어?', 'fight'), true);
});

test('names match on word boundaries, with stacked particles and short Latin names', async () => {
    const a = await app();
    const f = a.run('nameIn');
    assert.equal(f('보라랑은 안 가', '보라'), true);
    assert.equal(f('리아한테도 말했어', '리아'), true);
    assert.equal(f('미나네 고양이', '미나'), true);
    assert.equal(f('보라색 커튼', '보라'), false);
    assert.equal(f('기린이 있다', '린'), false);
    assert.equal(f('finally', 'al'), false);
    assert.equal(f('al said hi', 'al'), true);
    // 띄어 쓰지 않는 일본어 · 중국어 글 속의 두 글자 이름
    assert.equal(f('美奈は笑った', '美奈'), true);
    assert.equal(f('李明笑了', '李明'), true);
});

test('a question made only of filler words stays a short input; a chronicle keeps its SHIFTS bullets when squeezed', async () => {
    const a = await app();
    const store = a.getStore();
    for (let i = 0; i < 3; i++) store.memories.push(withVec(a, memory(`m${i}`, { summary: `등대에서 있었던 일 ${i}` })));
    assert.equal((await a.retrieveMemories('그래서 뭐야?', [], '아리아가 등대 계단을 올라갔다.')).shortQ, true);
    const squeeze = a.run('compactChronicle');
    assert.equal(squeeze('WHEN: 3일째\nPLOT:\n- 긴 줄거리\nSHIFTS:\n- 아리아 → 보라: 신뢰\n- 열쇠는 보라가 가졌다\nOPEN: 북문'), 'WHEN: 3일째\nSHIFTS:\n- 아리아 → 보라: 신뢰\n- 열쇠는 보라가 가졌다');
});

test('folding the oldest eras asks once more when a big turning point of that span is gone', async () => {
    const a = await app();
    const store = a.getStore();
    a.getSettings().eraKeep = 3;
    store.arcSummaries = [1, 2, 3, 4, 5].map(n => ({ id: `a${n}`, fromTurn: n * 10, toTurn: n * 10 + 9, text: `PLOT:\n- ${n}번째 시대의 일` }));
    store.milestones = [{ id: 'e1', title: '등대에서 처음 만났다', summary: '아리아와 여행자가 등대에서 처음 만났다', grade: 'major', turnIndex: 12 }];
    const asked = [];
    a.context.generateRaw = async ({ prompt }) => {
        asked.push(prompt[0].content);
        return asked.length === 1 ? 'PLOT:\n- 시장에서 물건을 샀다.' : 'PLOT:\n- 아리아와 여행자가 등대에서 처음 만났다.\n- 시장에서 물건을 샀다.';
    };
    assert.equal(await a.run('maybeFoldEras')(store), true);
    assert.equal(asked.length, 2);
    assert.match(asked[1], /lost these turning points[\s\S]*등대에서 처음 만났다/);
    assert.match(store.arcSummaries.find(x => x.saga).text, /처음 만났다/);
});
