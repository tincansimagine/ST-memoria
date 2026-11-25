import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';

/**
 * 이야기가 시작 설정을 뒤집은 채팅 — 캐릭터 설명은 "정체를 숨기고 있다"에 머물러 있는데 이야기에서는 오래전에 드러났다.
 * 장부가 그 변화를 놓치면 모델은 끝난 설정으로 돌아간다 (숨기는 중인 것처럼, 상대가 아직 모르는 것처럼 쓴다).
 */
async function app() {
    const a = await runtime();
    const store = a.getStore();
    const s = a.getSettings();
    s.autoHide = false; s.chunkTurns = 50; s.tokenBudget = 20000;
    store.turnCounter = 90;
    const chat = a.context.chat;
    for (let n = 1; n <= 90; n++) {
        chat.push({ is_user: true, mes: `${n}번째 행동`, name: '여행자' }, { is_user: false, mes: `아리아의 ${n}번째 대답이다. 바람이 불었다.`, name: '아리아' });
        store.turns.push({ id: `t${n}`, mesId: chat.length - 1, mesHash: a.mesHashOf(chat[chat.length - 1]), turnIndex: n, summary: `${n}번째 일.`, importance: 0.5, elapsedDays: 1 });
    }
    return a;
}
const card = (name, extra = {}) => ({ id: `c-${name}`, name, aliases: [], traits: [], relationships: [], lines: [], growth: [], firstTurn: 1, updatedTurn: 88, ...extra });
const mile = (n, title, grade = 'major') => ({ id: `m${n}`, title, summary: `${title}의 경위.`, participants: ['아리아'], grade, turnIndex: n });

test('the first big turning points stay in the ledger however many came after, and the ledger says they outrank the starting setup', async () => {
    const a = await app();
    const store = a.getStore();
    store.milestones.push(mile(4, '아리아의 정체가 드러남'), mile(8, '보라와 손을 잡음', 'minor'));
    for (let n = 12; n <= 88; n += 4) store.milestones.push(mile(n, `${n}턴의 전환`));
    const packet = (await a.buildPacketWithinBudget('등대', null)).text;
    assert.match(packet, /say where this story STARTED[\s\S]*replaces the starting setup wherever the two differ/);
    assert.match(packet, /## Turning Points \(chronological, oldest first — these happened and still stand/);
    const section = packet.split('## Turning Points')[1].split('\n## ')[0];
    assert.match(section, /아리아의 정체가 드러남/, 'the oldest major turning point is not pushed out by newer ones');
    assert.match(section, /88턴의 전환/);
    assert.doesNotMatch(section, /보라와 손을 잡음/, 'an old minor event does make way');
    assert.ok(section.indexOf('아리아의 정체가 드러남') < section.indexOf('88턴의 전환'), 'still in story order');
    assert.ok(section.trim().split('\n').length <= 11, 'ten at most');

    // 자리가 모자라 줄일 때도 처음의 큰 전환은 남는다
    const parts = await a.buildPacketSections('등대', null);
    const tight = a.renderPacket(parts, { extraLimit: 3 });
    assert.match(tight.split('## Turning Points')[1].split('\n## ')[0], /아리아의 정체가 드러남[\s\S]*88턴의 전환/);
});

test('a secret that came out is said to be out; one closed without a stated way is not listed', async () => {
    const a = await app();
    const store = a.getStore();
    const lock = (id, kind, summary, extra) => ({ id, kind, summary, status: 'resolved', priority: 2, turnIndex: 4, createdTurn: 4, ...extra });
    store.locks.push(lock('s1', 'keep_secret', '아리아가 왕녀라는 사실을 보라에게 숨긴다', { resolution: '보라가 인장 반지를 보고 알아챘다', resolvedTurn: 20 }),
        lock('s2', 'knowledge_gap', '민호는 등대의 주인이 누구인지 모른다', { resolution: '요약 때 정리됨' }),
        lock('s3', 'loose_end', '사라진 열쇠의 행방', { resolution: '창고에서 찾았다' }),
        lock('s4', 'keep_secret', '금고 비밀번호', { status: 'active' }));
    const packet = (await a.buildPacketWithinBudget('등대', null)).text;
    const out = packet.split('## No Longer Secret')[1].split('\n## ')[0];
    assert.match(out, /아리아가 왕녀라는 사실을 보라에게 숨긴다 — out: 보라가 인장 반지를 보고 알아챘다/);
    assert.doesNotMatch(out, /민호는 등대의|사라진 열쇠|금고 비밀번호/);
    assert.match(packet.split('## Pledges')[1].split('\n## ')[0], /금고 비밀번호/);
});

test('what the story changed in a person outranks the core they began with', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push(card('아리아', { core: '낯선 사람을 믿지 않는다', growth: [{ text: '보라를 믿게 됨', turn: 30 }, { text: '여행자에게 등대 열쇠를 맡김', turn: 50 }, { text: '마을 사람들과 어울리기 시작함', turn: 70 }] }),
        card('보라', { core: '말수가 적다' }));
    a.context.chat.push({ is_user: true, mes: '아리아와 보라에게 인사했다', name: '여행자' });
    const packet = (await a.buildPacketWithinBudget('아리아 보라', null)).text;
    assert.match(packet, /아리아[^\n]*core \(the temperament they began with — where "changed in this story" says otherwise, that is who they are now\): 낯선 사람을 믿지 않는다/);
    assert.match(packet, /changed in this story \(how they stand now — this outranks the core and the original description\): 보라를 믿게 됨; 여행자에게 등대 열쇠를 맡김; 마을 사람들과 어울리기 시작함/);
    assert.match(packet, /보라[^\n]*core \(constant — the story does not rewrite this\): 말수가 적다/, 'a person the story has not changed keeps the plain label');
});

test('the story so far has no hole and no chapter twice: every chapter not yet folded into an era is carried', async () => {
    const a = await app();
    const store = a.getStore();
    a.getSettings().autoHide = true; a.getSettings().preserveRecent = 20;
    for (const m of a.context.chat.slice(0, -20)) m.is_system = true;
    const sum = (id, from, to, text) => ({ id, fromTurn: from, toTurn: to, text: `PLOT:\n- ${text}` });
    store.arcSummaries.push(sum('a1', 1, 32, '처음 한 달의 일'), sum('a2', 65, 80, '폭로 뒤의 일'));
    store.chunkSummaries.push(sum('c1', 33, 40, '등대에 갇힌 한 달'), sum('c2', 41, 48, '항구의 다툼'), sum('c3', 49, 56, '고백과 화해'), sum('c4', 57, 64, '새 약속'), sum('c5', 81, 90, '지금 장면'));
    const packet = (await a.buildPacketWithinBudget('항구의 다툼이 어떻게 됐더라', null)).text;
    const story = packet.split('## Story So Far')[1].split('\n## ')[0];
    for (const text of ['처음 한 달의 일', '등대에 갇힌 한 달', '항구의 다툼', '고백과 화해', '새 약속', '폭로 뒤의 일']) assert.equal(story.split(text).length - 1, 1, `"${text}" once`);
    assert.doesNotMatch(story, /지금 장면/, 'the stretch still on screen is not summarised again');
    assert.doesNotMatch(packet, /Recalled Chapter|a much earlier chapter/, 'a chapter already carried is not recalled on top');
    assert.ok(story.indexOf('등대에 갇힌 한 달') < story.indexOf('항구의 다툼') && story.indexOf('새 약속') < story.indexOf('폭로 뒤의 일'));
    assert.doesNotMatch(story, /earlier era|recent chapter/, 'eras and chapters are interleaved in story order, so neither is called earlier or recent');
});

test('an old private feeling is not presented as a present secret, and is not on anyone\'s mind now', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push(card('아리아'), card('보라'));
    a.context.chat.push({ is_user: true, mes: '아리아와 보라가 마주 앉았다', name: '여행자' });
    const feeling = (id, turnIndex, summary, extra = {}) => memory(id, { kind: 'impression', visibility: 'private', owner: '아리아', summary, turnIndex, ...extra });
    store.memories.push(
        feeling('old', 5, '아리아는 정체가 드러나면 보라에게 버림받을까 두려웠다', { importance: 0.9 }),
        feeling('held', 6, '아리아는 등대가 무너질까 늘 불안하다', { pinned: true }),
        feeling('new', 85, '아리아는 보라와 함께 사는 일상이 낯설고 좋다'),
        memory('sec', { kind: 'secret', visibility: 'secret', owner: '아리아', summary: '금고의 비밀번호는 아리아만 안다', turnIndex: 6, pinned: true }));
    const packet = (await a.buildPacketWithinBudget('등대 금고', null)).text;
    // 고정해 둔 것은 늘 실린다: 진짜 비밀에는 누가 모르는지 붙고, 속마음에는 붙지 않는다
    assert.match(packet, /\[secret:아리아 · not known to 보라\] 금고의 비밀번호는 아리아만 안다/);
    assert.match(packet, /\[private:아리아\] 아리아는 등대가 무너질까 늘 불안하다/, 'a feeling is nobody else\'s to know anyway — no "not known to" list');
    // 오래된 속마음이 회상되면 그때의 마음이라고 적는다
    const line = a.run('formatMemoryLine')(store.memories.find(m => m.id === 'old'), false, null, 90);
    assert.match(line, /how they felt back then — things have moved on since; not a present secret/);
    assert.doesNotMatch(a.run('formatMemoryLine')(store.memories.find(m => m.id === 'new'), false, null, 90), /how they felt back then/);
    // "지금 마음에 둔 것"에는 최근 것과 고정한 것만
    const minds = packet.split('## On Their Minds')[1]?.split('\n## ')[0] || '';
    assert.match(minds, /함께 사는 일상이 낯설고 좋다/);
    assert.doesNotMatch(minds, /버림받을까 두려웠다/, 'a feeling from eighty turns ago is not what they carry now');
});

test('in novel mode a line is not credited to the card just because the card wrote the message', async () => {
    const a = await app();
    const store = a.getStore();
    a.getSettings().defaultPerspective = '__narrator__';
    a.getSettings().recordBatch = 1;
    store.characters.push(card('아리아'), card('보라'));
    const chat = a.context.chat;
    // 글쓴이는 카드(아리아)지만 "주인님"·"언니"라고 부르는 쪽은 보라다
    const reply = '보라가 고개를 숙였다. "주인님, 다녀오셨어요." 그리고 조금 뒤에 덧붙였다. "언니, 저녁은요?"\n\n"아리아 언니, 문 잠갔어요?" 보라가 물었다.\n\n아리아와 보라, 민호가 식탁에 둘러앉았다.\n\n"밥은 다 됐어."';
    for (let i = 0; i < 3; i++) chat.push({ is_user: true, mes: '계속', name: '여행자' }, { is_user: false, name: '아리아', mes: reply });
    store.characters.push(card('민호'));
    const rows = a.run('addressRows')(store);
    assert.ok(!rows.some(r => r.from === '아리아'), 'nothing is credited to the card as speaker');
    assert.deepEqual(rows.map(r => `${r.from}→${r.to}:${r.term}`), ['보라→아리아:아리아 언니'], 'only a line whose speaker the text names is counted, and a bare title points at nobody');

    // 예전 판이 카드 주인의 말로 적어 둔 인용은 채팅을 열 때 다시 가린다
    const id = chat.length - 1;
    store.turns.push({ id: 'tx', mesId: id, mesHash: a.mesHashOf(chat[id]), turnIndex: 91, summary: '보라가 인사했다.', importance: 0.5 });
    store.turnCounter = 91;
    const quote = (k, excerpt) => memory(k, { summary: `${k} 인용`, turnIndex: 91, mesId: id, excerpt, by: '아리아', to: '여행자' });
    store.memories.push(quote('q1', '주인님, 다녀오셨어요.'), quote('q2', '아리아 언니, 문 잠갔어요?'), quote('q3', '밥은 다 됐어.'));
    a.run('reconcileWithChat')();
    const [q1, q2, q3] = ['q1', 'q2', 'q3'].map(k => store.memories.find(m => m.id === k));
    assert.equal(q1.by, '보라', 'the text says who spoke');
    assert.equal(q2.by, '보라');
    assert.equal(q2.to, '아리아');
    assert.equal(q3.by, undefined, 'nobody is named as the speaker — the wrong name is taken off rather than kept');
    assert.equal(q3.to, undefined);
    assert.ok(a.run('activityLog').list().some(r => /말한 사람이 잘못 붙어 있던 인용 3개/.test(r.text)));

    // 한 번만 한다
    q3.by = '직접 고친 이름';
    a.run('reconcileWithChat')();
    assert.equal(q3.by, '직접 고친 이름');
});

test('cast values that carry another field\'s label are not taken as a name, an age or a change', async () => {
    const a = await app();
    const store = a.getStore();
    a.getSettings().recordBatch = 1;
    a.context.generateRaw = async () => JSON.stringify({ digest: '유원이 명함을 건넸다.', clock: { day: 90 }, memories: [], cast: [
        { name: '유원', aka: ['특성: 다정함', '단정함', '유원 선배'], role: '동아리 선배', age: '직업: 건축사사무소 대리', occupation: '건축사사무소 대리', growth: '남긴 말: 편할 때 연락해.' },
        { name: '민호', aka: ['민호 형'], age: '20대 후반', growth: '아리아를 믿게 됨' }] });
    a.context.chat.push({ is_user: true, mes: '유원 선배를 만났다', name: '여행자' }, { is_user: false, mes: '유원 선배가 명함을 건넸다. 민호 형은 뒤에서 지켜봤다.', name: '아리아' });
    assert.equal(await a.run('commitTurns')([a.context.chat.length - 1]), true);
    const yuwon = store.characters.find(c => c.name === '유원');
    assert.deepEqual([...yuwon.aliases], ['단정함', '유원 선배']);
    assert.equal(yuwon.age ?? null, null);
    assert.deepEqual([...(yuwon.growth || [])], []);
    const minho = store.characters.find(c => c.name === '민호');
    assert.equal(minho.age, '20대 후반');
    assert.equal(minho.growth[0].text, '아리아를 믿게 됨');

    // 이미 그렇게 저장된 카드는 채팅을 열 때 한 번 걷어 낸다
    yuwon.aliases = ['특성: 다정함', '유원 선배']; yuwon.age = '직업: 대리'; yuwon.growth = [{ text: '남긴 말: 편할 때 연락해.', turn: 90 }, { text: '여행자를 걱정하게 됨', turn: 91 }];
    delete store.castRev;
    a.run('reconcileWithChat')();
    assert.deepEqual([...yuwon.aliases], ['유원 선배']);
    assert.equal(yuwon.age, null);
    assert.deepEqual(yuwon.growth.map(g => g.text), ['여행자를 걱정하게 됨']);
});

test('defaults that invited trouble are corrected for people who never changed them, and left alone for people who did', async () => {
    const a = await runtime();
    const fresh = a.getSettings();
    assert.deepEqual([fresh.recordDelay, fresh.eventTracking, fresh.autoHide, fresh.preserveRecent], [1, true, true, 20]);

    const b = await runtime();
    // 예전 기본값 그대로 쓰던 사람
    b.context.extension_settings.memoria = { ...structuredClone(fresh), settingsRev: 3, recordDelay: 0, eventTracking: false, autoHide: false, preserveRecent: 6 };
    const old = b.getSettings();
    assert.deepEqual([old.recordDelay, old.eventTracking, old.preserveRecent], [1, true, 20]);
    assert.equal(old.autoHide, false, 'hiding old messages is never switched on behind someone\'s back');

    const c = await runtime();
    // 직접 바꿔 둔 사람
    c.context.extension_settings.memoria = { ...structuredClone(fresh), settingsRev: 3, recordDelay: 2, eventTracking: true, preserveRecent: 10 };
    const tuned = c.getSettings();
    assert.deepEqual([tuned.recordDelay, tuned.preserveRecent], [2, 10]);
});

test('an old stretch of the chat is quoted only when the user\'s own words look back, not when the narration does', async () => {
    const a = await app();
    const store = a.getStore();
    const s = a.getSettings();
    s.autoHide = true; s.preserveRecent = 6;
    const chat = a.context.chat;
    chat[9].mes = '아리아가 은반지를 등대 서랍 깊숙이 넣었다. "이건 아무한테도 말하지 마요."';
    for (const m of chat.slice(0, -6)) { m.is_system = true; m.extra = { memoria_hidden: true }; }
    // 입력 없이 이어 받는 중 — 마지막은 답변이고, 그 서술에 "그때"가 들어 있다
    chat.push({ is_user: false, mes: '그때 서랍에 넣어 둔 은반지가 떠올랐다. 아리아는 등대 계단을 올랐다.', name: '아리아' });
    let packet = (await a.buildPacketWithinBudget(a.currentRecallQuery(), null)).text;
    assert.doesNotMatch(packet, /## Original Lines/);
    // 내가 직접 되짚어 물으면 싣는다
    chat.push({ is_user: true, mes: '그때 아리아가 은반지를 서랍에 넣으면서 뭐라고 했지?', name: '여행자' });
    packet = (await a.buildPacketWithinBudget(a.currentRecallQuery(), null)).text;
    assert.match(packet, /## Original Lines[\s\S]*이건 아무한테도 말하지 마요/);
});
