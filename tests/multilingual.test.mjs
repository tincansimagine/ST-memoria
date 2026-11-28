import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';
import { wordsOf, jaStems, enStems, contentWords, soundsHedged, ungroundedFigures, findRepeatedPhrases, verbStems } from '../craft-engine.mjs';

async function app() {
    const a = await runtime();
    a.getStore();
    return a;
}
const withVec = (a, m) => ({ ...m, vec: a.encodeVec(a.embedText(a.memoryIndexText(m))) });

test('Korean and English keep the old word split; Japanese and Chinese are split into words', () => {
    assert.deepEqual(wordsOf('미나 빚이 얼마였지?'), ['미나', '빚이', '얼마였지']);
    assert.deepEqual(wordsOf('Who lends me umbrellas?'), ['who', 'lends', 'me', 'umbrellas']);
    const ja = wordsOf('美奈は古い指輪を木箱の中に隠した');
    assert.ok(ja.includes('指輪') && ja.includes('木箱'), ja.join('/'));
    assert.ok(wordsOf('王芳把一枚旧戒指藏在了木盒里').includes('戒指'));
    assert.deepEqual(jaStems('隠し'), ['隠']);
    assert.deepEqual(jaStems('指輪'), []);
});

test('content words: Japanese and Chinese drop function words, English keeps three-letter words and drops stop words', () => {
    assert.deepEqual([...contentWords('指輪はどこにある？')].filter(w => w === '指輪'), ['指輪']);
    assert.ok(!contentWords('指輪はどこにある？').has('は'));
    assert.ok(contentWords('戒指在哪里？').has('戒指'));
    const en = contentWords('Where is the map? Did she run?');
    assert.ok(en.has('map') && en.has('run'));
    assert.ok(!en.has('the') && !en.has('did'));
});

test('English inflection reduces to a stem; names and look-alike words stay', () => {
    const has = (w, st) => assert.ok(enStems(w).includes(st), `${w} → ${st} (got ${enStems(w).join(', ')})`);
    has('lends', 'lend'); has('lent', 'lend'); has('studies', 'study'); has('studying', 'study'); has('rings', 'ring');
    has('running', 'run'); has('boxes', 'box'); has('hiding', 'hide'); has('stopped', 'stop');
    for (const w of ['marcus', 'iris', 'nothing', 'does', 'glass', 'rose', 'left']) assert.deepEqual(enStems(w), [], w);
    assert.ok(!enStems('running').includes('rune'));
});

test('a Japanese or Chinese question is a real question, a bare backchannel is a short input', async () => {
    const a = await app();
    const store = a.getStore();
    for (let i = 0; i < 3; i++) store.memories.push(withVec(a, memory(`m${i}`, { summary: `アリアは灯台で${i}番目の話をした` })));
    const scene = '港は静かだった。美奈は手すりにもたれていた。';
    const short = async (q) => (await a.retrieveMemories(q, [], scene)).shortQ;
    assert.equal(await short('指輪はどこ？'), false);
    assert.equal(await short('戒指在哪里？'), false);
    assert.equal(await short('うん'), true);
    assert.equal(await short('嗯'), true);
    assert.equal(await short('それで？'), true);
    assert.equal(a.run('PAST_QUERY_RE').test('你还记得那时候吗'), true);
});

test('names across scripts: full and half width are one name, honorifics fold into a card on file, titles work without spaces', async () => {
    const a = await app();
    const store = a.getStore();
    const key = a.run('entityKey');
    assert.equal(key('ｱﾘｱ'), key('アリア'));
    assert.equal(key('Ｅｌｅｎａ'), key('Elena'));
    store.characters.push({ id: 'c1', name: '美奈', aliases: [] }, { id: 'c2', name: '蓮', aliases: [] });
    const canon = a.run('canonEntityName');
    assert.equal(canon(store, '美奈さん'), '美奈');
    assert.equal(canon(store, '健太くん'), '健太くん', 'no card for the bare name — left as written');
    const nameIn = a.run('nameIn');
    assert.equal(nameIn('蓮は笑った', '蓮'), true);
    assert.equal(nameIn('池に睡蓮が咲いた', '蓮'), false);
    store.bonds.push({ id: 'b1', from: '旅人', to: '美奈', log: [{ turn: 1, stage: '先輩', calls: '先輩' }] }, { id: 'b2', from: '旅人', to: '陈默', log: [{ turn: 1, stage: '师兄', calls: '师兄' }] });
    const titles = a.run('titleReferred');
    assert.deepEqual([...titles(store, '先輩はどこ？')], [key('美奈')]);
    assert.deepEqual([...titles(store, '师兄在哪里？')], [key('陈默')]);
    // 장면에 있는 한 글자 한자 이름
    assert.equal(a.run('cardNamedIn')('蓮が船に乗った', store.characters[1]), true);
});

test('a Japanese or Chinese reply that uses the memory counts as using it', async () => {
    const a = await app();
    const store = a.getStore();
    store.memories.push(memory('ja', { summary: 'アリアは灯台で指輪を受け取った', entities: ['アリア'] }), memory('zh', { summary: '李明在灯塔里收到了一枚银戒指', entities: ['李明'] }));
    const echo = (id, reply) => {
        const mes = { is_user: false, mes: reply, name: 'x' };
        a.context.chat.push(mes);
        a.run(`recallAudit = { at: Date.now(), ids: ["${id}"] };`);
        a.run('auditRecallEcho')(mes, a.context.chat.length - 1);
        return store.memories.find(m => m.id === id).echoes || 0;
    };
    assert.equal(echo('ja', 'アリアは灯台で受け取った指輪をそっと撫でた。あの日のことを思い出していた。'), 1);
    assert.equal(echo('zh', '李明摸了摸那枚在灯塔里收到的银戒指，想起了那天。'), 1);
});

test('checking helpers read Japanese, Chinese and full-width text', async () => {
    const a = await app();
    assert.equal(soundsHedged('たぶん見つかったかもしれない'), true);
    assert.equal(soundsHedged('好像找到了'), true);
    assert.deepEqual(ungroundedFigures('金貨３０枚と三十枚、十分だった', '金貨30枚'), []);
    assert.deepEqual(ungroundedFigures('金貨５０枚', '金貨30枚'), ['50']);
    assert.deepEqual(ungroundedFigures('欠了一万两千', '欠了12000'), []);
    assert.deepEqual(findRepeatedPhrases(['彼女は小さく息を呑んだ。そして笑った。', '彼は小さく息を呑んだ。窓の外を見た。', '美奈は小さく息を呑んだ。', 'アリアは小さく息を呑んだ。']).map(r => r.phrase), ['小さく息を呑んだ']);
    assert.deepEqual(findRepeatedPhrases(['他轻轻叹了一口气，看向窗外。', '她轻轻叹了一口气，没有说话。', '李明轻轻叹了一口气。']).map(r => r.phrase), ['轻轻叹了一口气']);
    assert.equal(a.run('firstSentence')('アリアは笑った。そして窓を開けた。'), 'アリアは笑った。');
});

test('a fixed summary language never asks for the verbatim fields to be translated, and Chinese is offered', async () => {
    const a = await app();
    const L = a.run('LANG_DIRECTIVES');
    for (const k of ['ko', 'en', 'ja', 'zh', 'hybrid']) assert.match(L[k], /"said"/, k);
    assert.doesNotMatch(L.en, /Translate everything, including dialogue/);
    a.getSettings().summaryLanguage = 'en';
    assert.match(a.run('languageTail')(), /except the verbatim fields/);
});

test('folding keeps a short turning point that survives in another word form, and skips the check when the summary language changed', async () => {
    const a = await app();
    const store = a.getStore();
    a.getSettings().eraKeep = 3;
    const fold = async (milestone, reply) => {
        store.arcSummaries = [1, 2, 3, 4, 5].map(n => ({ id: `a${n}`, fromTurn: n * 10, toTurn: n * 10 + 9, text: `PLOT:\n- ${n}번째 시대의 일` }));
        store.milestones = [milestone];
        let calls = 0;
        a.context.generateRaw = async () => { calls++; return reply; };
        await a.run('maybeFoldEras')(store);
        return calls;
    };
    assert.equal(await fold({ id: 'e1', title: '고백', summary: '옥상에서 마음을 전했다', grade: 'major', turnIndex: 12 }, 'PLOT:\n- 아리아가 옥상에서 고백했다.'), 1);
    assert.equal(await fold({ id: 'e2', title: 'The confession', summary: 'Aria confessed on the roof', grade: 'major', turnIndex: 12 }, 'PLOT:\n- 시장에서 물건을 샀다.'), 1, 'an English turning point is not compared with a Korean summary');
    assert.deepEqual(verbStems('지웠다').includes('집'), false);
});

test('with an English summary language, a Korean chat still finds the memory in Korean — the record keeps a few chat-language words', async () => {
    const a = await app();
    const store = a.getStore();
    a.getSettings().summaryLanguage = 'en';
    a.getSettings().recordBatch = 1;
    a.getSettings().chunkTurns = 50;
    store.characters.push({ id: 'c1', name: '아리아', aliases: [] });
    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '창고 열쇠는 네가 가지고 있어.', name: '여행자' },
        { is_user: false, mes: '여행자는 등대 창고 열쇠를 외투 주머니에 넣었다. "잃어버리지 마." 아리아가 조용히 말했다.', name: '아리아' });
    let asked = '';
    a.context.generateRaw = async ({ prompt, systemPrompt }) => {
        asked = `${systemPrompt}\n${prompt[0].content}`;
        return JSON.stringify({ digest: 'The traveler pocketed the storeroom key.', weight: 0.5, time_passed: '0',
            memories: [{ kind: 'item', summary: 'The traveler keeps the lighthouse storeroom key in his coat pocket', importance: 0.6, entities: ['여행자'], recall: ['storeroom key', 'coat pocket'] }] });
    };
    assert.equal(await a.run('commitTurns')([chat.length - 1]), true);
    assert.match(asked, /"recall" cues stay in the chat's own language/);
    const m = store.memories.find(x => !(x.tags || []).includes('episode_raw'));
    assert.ok(m.cues?.includes('창고') && m.cues.includes('열쇠'), `cues: ${m.cues}`);
    assert.ok(!m.cues.some(c => /었다$/.test(c)), 'inflected verbs are not search words');
    for (let i = 0; i < 6; i++) store.memories.push(withVec(a, memory(`f${i}`, { summary: `The traveler and 아리아 walked by the harbor talking about the ${['wind', 'sea', 'market'][i % 3]}`, entities: ['아리아'], turnIndex: 1 })));
    const found = (await a.retrieveMemories('창고 열쇠 누가 갖고 있지?', [], '')).selected.map(x => x.id);
    assert.equal(found[0], m.id);
    // 같은 말로 쓰인 채팅에서는 아무것도 덧붙이지 않는다
    assert.deepEqual([...a.run('crossLangCues')({ summary: '여행자가 창고 열쇠를 가졌다' }, '창고 열쇠는 네가 가지고 있어.', store)], []);
});

test('a few stray foreign words do not switch a Korean or English text to Japanese/Chinese handling', async () => {
    const { isNoSpaceCjk } = await import('../craft-engine.mjs');
    assert.equal(isNoSpaceCjk('아리아가 창밖을 보며 少し 한숨을 쉬었다'), false);
    assert.equal(isNoSpaceCjk('She felt a sudden 感觉 of dread'), false);
    assert.equal(isNoSpaceCjk('美奈 gave Elena a ring at the harbor'), false);
    assert.equal(isNoSpaceCjk('Elenaは古い懐中時計を隠した'), true);
    assert.equal(isNoSpaceCjk('うん'), true);
    // 영어 글에 한자가 한 글자 튀어도 반복 표현은 띄어쓰기를 지킨 채 찾는다
    assert.deepEqual(findRepeatedPhrases(['She let out a breath she did not know she was holding 息.', 'He let out a breath he did not know he was holding.', 'Aria let out a breath 美 she did not know she was holding.']).map(r => r.phrase), ['let out a breath']);
    const a = await app();
    assert.match(a.run('LANG_DIRECTIVES').auto, /stray words/);
});

test('mixed scripts and English contractions split into clean words; Traditional and Simplified Chinese meet', async () => {
    const { toSimp } = await import('../craft-engine.mjs');
    assert.deepEqual(wordsOf('Elena가 웃었다'), ['elena', '웃었다']);
    assert.deepEqual(wordsOf('Marcus의 외투'), ['marcus', '외투']);
    assert.deepEqual(wordsOf("Marcus's ship didn't sink"), ['marcus', 'ship', 'did', 'sink']);
    assert.deepEqual(wordsOf("I can't and won't"), ['i', 'can', 'and', 'will']);
    assert.equal(toSimp('燈塔'), '灯塔');
    assert.equal(toSimp('アリアは間に合った'), 'アリアは間に合った', 'Japanese text is left as it is');
    assert.ok(wordsOf('陳遠把鐵門鑰匙藏在書櫃後面').includes('钥匙'));
    const a = await app();
    assert.equal(a.run('entityKey')('陳遠'), a.run('entityKey')('陈远'));
});

test('small fixes: 不可能 is not hedging, English -e stems only where they belong, a single kanji is not counted twice', async () => {
    assert.equal(soundsHedged('已经不可能回去'), false);
    assert.equal(soundsHedged('可能找到了'), true);
    assert.deepEqual(enStems('working'), ['work']);
    assert.deepEqual(enStems('watching'), ['watch']);
    assert.ok(enStems('forging').includes('forge'));
});

test('when a question has a topic, a memory that only shares the person\'s name steps back', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push({ id: 'c1', name: '카엘', aliases: [] });
    for (let i = 0; i < 6; i++) store.memories.push(withVec(a, memory(`n${i}`, { summary: `여행자가 시장에서 ${i}번째 물건을 샀다`, turnIndex: 5 + i })));
    // 같은 사람 · 같은 때의 두 기억 — 동점에서 내용(노래 ↔ 자장가)이 맞은 쪽이 이겨야 한다
    store.memories.push(withVec(a, memory('oath', { summary: '카엘이 성문 앞에서 기사단에게 맹세했다', entities: ['카엘'], turnIndex: 20 })));
    store.memories.push(withVec(a, memory('song', { summary: '카엘이 술에 취해 고향 자장가를 흥얼거렸다', entities: ['카엘'], turnIndex: 20 })));
    const r = await a.retrieveMemories('카엘이 부르던 노래', [], '');
    assert.equal(r.selected[0].id, 'song');
    assert.match(r.trace.get('oath').reason, /이름만 겹쳐/);
    assert.doesNotMatch(r.trace.get('song').reason, /이름만 겹쳐/);
    // 이름만 물으면 아무도 뒤로 가지 않는다
    assert.doesNotMatch((await a.retrieveMemories('카엘', [], '')).trace.get('oath')?.reason || '', /이름만 겹쳐/);
});
