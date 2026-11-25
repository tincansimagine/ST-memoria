import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';
import { titlesInCalls, saysTitle, titleTargets } from '../stage-engine.mjs';

const card = (name, extra = {}) => ({ id: `c-${name}`, name, aliases: [], traits: [], relationships: [], lines: [], growth: [], firstTurn: 1, updatedTurn: 1, ...extra });
const bond = (from, to, stage, calls = '') => ({ id: `b-${from}-${to}`, from, to, log: [{ turn: 5, stage, basis: '', calls, unsaid: '' }] });

/** 60턴짜리 채팅: 답변마다 lines(n)의 글. 기록은 전부 되어 있다 */
async function app(lines = () => '아리아가 고개를 끄덕였다. 바람이 불었다.') {
    const a = await runtime();
    const store = a.getStore();
    const s = a.getSettings();
    s.autoHide = false; s.chunkTurns = 200; s.tokenBudget = 20000;
    const chat = a.context.chat;
    for (let n = 1; n <= 60; n++) {
        chat.push({ is_user: true, mes: `${n}번째 행동`, name: '여행자' }, { is_user: false, mes: lines(n), name: '아리아' });
        store.turns.push({ id: `t${n}`, mesId: chat.length - 1, mesHash: a.mesHashOf(chat[chat.length - 1]), turnIndex: n, summary: `${n}번째 일.`, importance: 0.5, elapsedDays: 1 });
    }
    store.turnCounter = 60;
    return a;
}
const back = (packet) => packet.split('## Back After a Long Absence')[1]?.split('\n## ')[0] || '';

test('titles in a "calls them" cell: the title is taken, names and explanations are not', () => {
    assert.deepEqual(titlesInCalls('민준 형', ['강민준']), ['형']);
    assert.deepEqual(titlesInCalls('선배 / 형'), ['선배', '형']);
    assert.deepEqual(titlesInCalls('태호형', ['김태호']), ['형']);
    assert.deepEqual(titlesInCalls('예전에는 오빠'), [], 'an explanation is not a title');
    assert.deepEqual(titlesInCalls('민준이, 너, 당신'), [], 'names and pronouns point at nobody');
    assert.equal(saysTitle('형, 오랜만이에요', '형'), true);
    assert.equal(saysTitle('형한테 물어봐', '형'), true);
    assert.equal(saysTitle('선배님! 여기요', '선배'), true);
    assert.equal(saysTitle('인형을 샀다. 형편이 어렵다.', '형'), false);
    assert.deepEqual(titleTargets('형, 오랜만이에요', [{ to: '강민준', calls: '민준 형' }, { to: '차유원', calls: '선배' }]), [{ to: '강민준', title: '형' }]);
    assert.deepEqual(titleTargets('형, 왔어?', [{ to: '강민준', calls: '형' }, { to: '김태호', calls: '형' }]), [], 'one title for two people picks neither');
});

test('someone back after a long absence is introduced with who they are, how the scene\'s people stand with them, and what last happened', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push(card('아리아', { updatedTurn: 60 }), card('민준', { role: '등대지기', core: '무뚝뚝하지만 약속은 지킨다', updatedTurn: 8, relationships: [{ target: '아리아', relation: '오랜 이웃' }] }));
    store.bonds.push(bond('여행자', '민준', '서로 믿는 사이', '민준 형'), bond('민준', '여행자', '아끼는 동생'), bond('민준', '보라', '서먹한 사이'));
    store.turns[7].summary = '민준이 여행자에게 등대 열쇠를 맡겼다.';
    store.memories.push(memory('vow', { kind: 'promise', summary: '민준이 겨울에 돌아오겠다고 약속했다', turnIndex: 7, entities: ['민준'], importance: 0.9 }));
    a.context.chat.push({ is_user: true, mes: '문을 여니 민준이 서 있었다. "오랜만이에요. 겨울에 돌아오겠다고 약속했잖아요."', name: '여행자' });
    const packet = (await a.buildPacketWithinBudget(a.currentRecallQuery(), null)).text;
    const sec = back(packet);
    assert.match(sec, /^ \(named or called again in the latest messages after a long gap[\s\S]*NOT a first meeting/);
    assert.match(sec, /- 민준 \(등대지기\) — 무뚝뚝하지만 약속은 지킨다 \[last in these notes 5[23] replies ago\]/);
    assert.match(sec, /· 여행자 → 민준: 서로 믿는 사이 \| calls them: 민준 형/);
    assert.match(sec, /· 민준 → 여행자: 아끼는 동생/);
    assert.doesNotMatch(sec, /보라/, 'a tie to someone who is not around is left out');
    assert.match(sec, /· 민준's standing ties — 아리아: 오랜 이웃/);
    assert.ok(sec.indexOf('여행자 → 민준') < sec.indexOf('민준 → 여행자'), 'how the scene treats them comes first');
    // 마지막으로 있었던 일: 이 사람이 든 가장 늦은 공개 기억. 이미 회상으로 실렸으면 한 번 더 적지 않는다
    assert.equal(packet.split('민준이 겨울에 돌아오겠다고 약속했다').length - 1, 1, 'what last happened is told once, not twice');
    assert.match(packet, /민준이 겨울에 돌아오겠다고 약속했다 \[as of then — from before 민준's long absence; it may no longer hold\]/, 'an old promise recalled with them is marked as from before they left');

    // 회상에 실리지 않았으면 여기에 적는다
    store.memories.length = 0;
    const plain = back((await a.buildPacketWithinBudget(a.currentRecallQuery(), null)).text);
    assert.match(plain, /· last on record: 민준이 여행자에게 등대 열쇠를 맡겼다\. \(~[^)]+ ago in-story\)/, 'with no memory on file, the digest of the turn they were last in');
});

test('a person who never left is not called returning just because their card has not changed in a while', async () => {
    // 아리아는 카드 주인(매 답변의 글쓴이), 보라는 매 답변에 이름이 나오는 사람 — 둘 다 카드는 5턴에 마지막으로 고쳐졌다
    const a = await app(n => `보라가 창가에 앉아 있었다. 아리아는 ${n}번째 차를 따랐다.`);
    const store = a.getStore();
    store.characters.push(card('아리아', { updatedTurn: 5 }), card('보라', { updatedTurn: 5 }));
    a.context.chat.push({ is_user: true, mes: '보라와 아리아에게 인사했다', name: '여행자' });
    assert.equal(a.run('lastSeenTurn')(store, store.characters[1]), 5, 'nothing on file names 보라 after turn 5');
    const packet = (await a.buildPacketWithinBudget('보라 아리아', null)).text;
    assert.equal(back(packet), '', 'both were in the chat all along — the record is only behind');

    // 턴 요약에 이름이 나오면 그 턴이 마지막으로 나온 때다
    store.turns[49].summary = '보라가 차를 마셨다.';
    assert.equal(a.run('lastSeenTurn')(store, store.characters[1]), 50);
});

test('called by a title alone, the person is found through the speaker\'s own bonds — unless that title has been in use for someone nearby', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push(card('아리아', { updatedTurn: 60 }), card('민준', { updatedTurn: 8 }), card('태호', { updatedTurn: 9 }));
    store.bonds.push(bond('여행자', '민준', '서로 믿는 사이', '형'), bond('아리아', '태호', '사촌', '오빠'));
    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '"형, 오랜만이에요." 나는 웃었다.', name: '여행자' });
    let called = a.run('calledByTitle')(store);
    assert.deepEqual([...called], [['민준', '형']]);
    const packet = (await a.buildPacketWithinBudget(a.currentRecallQuery(), null)).text;
    assert.match(back(packet), /- 민준/);
    assert.match(packet, /## Cast[\s\S]*- 민준/, 'their card is carried as someone in the scene');

    // 낱말 속에 든 글자는 호칭이 아니다
    chat[chat.length - 1].mes = '인형을 샀다. 형편이 어렵다고 했다.';
    assert.equal(a.run('calledByTitle')(store).size, 0);

    // 말한 사람의 관계선으로 본다: "오빠"는 아리아가 태호를 부르는 말이지, 여행자가 누구를 부르는 말이 아니다
    chat[chat.length - 1].mes = '"오빠, 어디 가요?"';
    assert.equal(a.run('calledByTitle')(store).size, 0);
    chat.push({ is_user: false, mes: '"오빠, 여기야!" 아리아가 손을 흔들었다.', name: '아리아' });
    assert.deepEqual([...a.run('calledByTitle')(store)], [['태호', '오빠']]);
    chat.pop();

    // 같은 호칭으로 부르는 사람이 둘이면 고르지 않는다
    chat[chat.length - 1].mes = '"형, 오랜만이에요."';
    store.bonds.push(bond('여행자', '태호', '아는 사이', '형'));
    assert.equal(a.run('calledByTitle')(store).size, 0);
    store.bonds.pop();

    // 민준이 떠난 뒤로도 여행자가 "형"을 계속 불러 왔다면, 곁에 있는 다른 사람을 부르는 말이다
    for (const i of [61, 71, 81]) chat[i - 1].mes = '"형, 이것 좀 봐요."';
    assert.equal(a.run('calledByTitle')(store).size, 0);
});

test('forms of address on file are carried for anyone in or named in the scene, and a slip in the dialogue does not override them', async () => {
    const a = await app();
    const store = a.getStore();
    a.getSettings().defaultPerspective = '';
    store.characters.push(card('아리아', { updatedTurn: 60 }), card('유원', { updatedTurn: 58 }), card('여행자', { updatedTurn: 60 }));
    store.bonds.push(bond('여행자', '유원', '믿고 따르는 선배', '유원 형, 형'), bond('유원', '여행자', '아끼는 후배', '시온아'), bond('아리아', '보라', '친구', '보라야'));
    const chat = a.context.chat;
    // 직전 답변 두 개가 "유원 씨"로 잘못 불렀다
    for (let i = 0; i < 2; i++) chat.push({ is_user: true, mes: '계속', name: '여행자' }, { is_user: false, mes: '"유원 씨, 괜찮아요?" 여행자가 물었다. "유원 씨, 피가 나요."', name: '아리아' });
    // 이번 입력에서 유원이 처음 언급된다 (장면에 있던 사람이 아니다)
    chat.push({ is_user: true, mes: '집에 가는 길에 유원을 마주쳤다.', name: '여행자' });
    const packet = (await a.buildPacketWithinBudget(a.currentRecallQuery(), null)).text;
    const sec = packet.split('## How They Address Each Other')[1]?.split('\n## ')[0] || '';
    assert.match(sec, /also when one of them enters partway through a scene[\s\S]*Never put 씨 or 님 after a name here/);
    assert.match(sec, /- 여행자 → 유원: "유원 형", "형"\n- 유원 → 여행자: "시온아"\n- 아리아 → 보라: "보라야"/, 'pairs touching the scene first; the rest still listed — anyone may walk in');
    assert.doesNotMatch(sec.split('(The last reply')[0], /유원 씨/, 'the slip is not handed back as the form to keep');
    assert.match(sec, /\(The last reply got these wrong — from here on use the forms above:\)\n- 여행자 called 유원 "유원 씨" — the form on record is "유원 형" \/ "형"/);
});

test('a person is recognised by the given name the story actually uses (유원 for 차유원), and a slip in earlier attempts at the same reply is called out', async () => {
    const a = await app();
    const store = a.getStore();
    a.getSettings().defaultPerspective = '__narrator__';
    store.characters.push(card('차유원', { updatedTurn: 58 }), card('윤시온', { updatedTurn: 60 }), card('차도겸', { updatedTurn: 60 }));
    store.bonds.push(bond('윤시온', '차유원', '믿고 따르는 선배', '유원 형, 형'), bond('차유원', '윤시온', '아끼는 후배', '시온아'));
    assert.deepEqual([...a.run('personForms')(store, store.characters[0])], ['차유원', '유원']);
    assert.equal(a.run('mentionsPerson')(store, '며칠 뒤 유원과 마주쳤다', store.characters[0]), true);
    assert.equal(a.run('mentionsPerson')(store, '차유원의 명함', store.characters[0]), true);
    assert.equal(a.run('mentionsPerson')(store, '그 사람은 차유원 씨가 아니었다', store.characters[2]), false);
    // 성을 뺀 이름이 다른 카드와 겹치면 쓰지 않는다
    store.characters.push(card('박유원'));
    assert.deepEqual([...a.run('personForms')(store, store.characters[0])], ['차유원']);
    store.characters.pop();

    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '며칠 뒤, 화방에 다녀오던 시온은 길에서 유원과 마주친다.', name: '윤시온' });
    let parts = await a.buildPacketSections(a.currentRecallQuery(), null);
    assert.ok(parts.characters.find(c => c.name === '차유원')?.sceneNow, '"유원" puts 차유원 in the scene');

    // 같은 답변을 다시 받는 중: 앞서 받은 답변에서 유원이 시온을 "윤시온 씨"라고 불렀다
    chat.push({ is_user: false, name: '차도겸', mes: '', swipe_id: 1, swipes: ['차유원이 걸음을 멈추고 손을 들었다. "어, 윤시온 씨……."', ''] });
    a.run('chatGenerating = true; lastGenerationType = "swipe";');
    parts = await a.buildPacketSections(a.currentRecallQuery(), null);
    a.run('chatGenerating = false;');
    assert.deepEqual([...parts.slips.map(x => `${x.from}→${x.to}:${x.term}`)], ['차유원→윤시온:윤시온 씨']);
    const text = a.renderPacket(parts);
    assert.match(text, /\(Earlier attempts at this reply got these wrong — do not repeat them:\)\n- 차유원 called 윤시온 "윤시온 씨" — the form on record is "시온아"/);
});

test('a bond filed again at the same stage keeps the forms of address on file; a real move may change them', () => {
    return (async () => {
        const a = await app();
        const store = a.getStore();
        const up = a.run('upsertBond');
        up(store, { from: '여행자', to: '유원', stage: '믿고 따르는 선배', calls: '유원 형, 형' }, 10);
        up(store, { from: '여행자', to: '유원', stage: '믿고 따르는 선배', calls: '유원 씨' }, 20);
        assert.equal(a.run('bondNow')(store.bonds[0]).calls, '유원 형, 형', 'a slip in wording is not filed');
        up(store, { from: '여행자', to: '유원', stage: '서로 의지하는 연인', calls: '자기, 형' }, 40);
        assert.equal(a.run('bondNow')(store.bonds[0]).calls, '자기, 형', 'when the relationship moves, the way they call each other may move with it');
        // 사람이 직접 고친 부르는 말은 사서가 바꾸지 못한다
        up(store, { from: '유원', to: '여행자', stage: '아끼는 후배', calls: '시온아' }, 41, { manual: true });
        up(store, { from: '유원', to: '여행자', stage: '각별한 후배', calls: '시온 씨' }, 50);
        assert.equal(a.run('bondNow')(store.bonds[1]).calls, '시온아');
    })();
});
