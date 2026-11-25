import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';

const card = (name, extra = {}) => ({ id: `c-${name}`, name, aliases: [], traits: [], relationships: [], lines: [], growth: [], firstTurn: 1, updatedTurn: 1, ...extra });

async function app() {
    const a = await runtime();
    const store = a.getStore();
    a.getSettings().autoHide = false;
    const chat = a.context.chat;
    for (let n = 1; n <= 30; n++) {
        chat.push({ is_user: true, mes: `${n}번째 행동`, name: '여행자' }, { is_user: false, mes: `${n}번째 대답이다. 바람이 불었다.`, name: '아리아' });
        store.turns.push({ id: `t${n}`, mesId: chat.length - 1, mesHash: a.mesHashOf(chat[chat.length - 1]), turnIndex: n, summary: `${n}번째 일.`, importance: 0.5 });
    }
    store.turnCounter = 30;
    return a;
}

test('a person is recognised by the given name the story uses (유원 for 차유원), but not inside another name', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push(card('차유원', { firstTurn: 26, updatedTurn: 28, voice: '다정한 반말', lines: [{ text: '편할 때 연락해, 시온아.', turn: 28 }] }), card('윤시온', { updatedTurn: 30 }));
    const forms = a.run('personForms');
    assert.deepEqual([...forms(store, store.characters[0])], ['차유원', '유원']);
    const hit = (text) => a.run('mentionsPerson')(store, text, store.characters[0]);
    assert.equal(hit('며칠 뒤 유원과 마주쳤다'), true);
    assert.equal(hit('"유원 형, 괜찮아요?"'), true);
    assert.equal(hit('차유원의 명함'), true);
    assert.equal(hit('윤시온은 집에 있었다'), false);
    // 성을 뺀 이름이 다른 사람과 겹치면 쓰지 않는다
    store.characters.push(card('박유원'));
    assert.deepEqual([...forms(store, store.characters[0])], ['차유원']);
    store.characters.pop();

    a.context.chat.push({ is_user: true, mes: '며칠 뒤, 시온은 길에서 유원과 마주친다.', name: '여행자' });
    const parts = await a.buildPacketSections(a.currentRecallQuery(), null);
    assert.ok(parts.characters.find(c => c.name === '차유원')?.sceneNow, '"유원" puts 차유원 in the scene');
    assert.match(a.renderPacket(parts), /차유원: "편할 때 연락해, 시온아\."/, 'and his own way of speaking comes with him');
});

test('someone who joined the story later is not marked as absent from its old scenes; private feelings carry no "not known to" list', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push(card('아리아', { updatedTurn: 30 }), card('보라', { updatedTurn: 30 }), card('유원', { firstTurn: 26, updatedTurn: 28 }));
    store.memories.push(
        memory('old', { summary: '보라가 아리아의 정체를 알아챘다', turnIndex: 3, witnesses: ['아리아', '보라'], pinned: true }),
        memory('late', { summary: '보라가 아리아에게 등대 열쇠를 맡겼다', turnIndex: 27, witnesses: ['아리아', '보라'], pinned: true }),
        memory('feel', { kind: 'impression', visibility: 'private', owner: '아리아', summary: '아리아는 보라가 떠날까 두렵다', turnIndex: 20, pinned: true }),
        memory('sec', { kind: 'secret', visibility: 'secret', owner: '아리아', summary: '금고의 비밀번호는 아리아만 안다', turnIndex: 6, pinned: true }));
    a.context.chat.push({ is_user: true, mes: '아리아와 보라, 유원이 등대에 모였다.', name: '여행자' });
    const text = (await a.buildPacketWithinBudget('등대', null)).text;
    assert.doesNotMatch(text.split('\n').find(l => l.includes('정체를 알아챘다')) || '', /not witnessed by 유원/, 'he was not yet in the story then');
    assert.match(text.split('\n').find(l => l.includes('등대 열쇠를 맡겼다')) || '', /not witnessed by 유원/, 'he was in the story and was not there');
    assert.match(text, /\[private:아리아\] 아리아는 보라가 떠날까 두렵다/);
    assert.match(text, /\[secret:아리아 · not known to 보라, 유원\] 금고의 비밀번호는 아리아만 안다/, 'a real secret still names who does not know');
});

test('the story\'s main character is not presented as "back after a long absence" just because their card has not changed', async () => {
    const a = await app();
    const store = a.getStore();
    a.run(`name2 = '차도겸';`);
    store.characters.push(card('차도겸', { updatedTurn: 2 }), card('윤시온', { updatedTurn: 2 }));
    for (const t of store.turns) t.summary = `도겸과 시온이 ${t.turnIndex}번째로 함께 지냈다.`;
    a.context.chat.push({ is_user: true, mes: '도겸이 시온을 불렀다.', name: '여행자' });
    const parts = await a.buildPacketSections(a.currentRecallQuery(), null);
    assert.deepEqual([...parts.returning.map(r => r.name)], []);
});

test('two people who only share a surname are said to be unrelated, unless the story ties them as family', async () => {
    const a = await app();
    const store = a.getStore();
    store.characters.push(card('차도겸'), card('차유원'), card('윤시온'));
    let text = (await a.buildPacketWithinBudget('유원', null)).text;
    assert.match(text, /\(차도겸 and 차유원 only share the surname 차 — they are not related and do not look alike unless the story says so\.\)/);
    assert.doesNotMatch(text, /윤시온 and/);
    store.characters[1].relationships = [{ target: '차도겸', relation: '사촌 형' }];
    text = (await a.buildPacketWithinBudget('유원', null)).text;
    assert.doesNotMatch(text, /only share the surname/);
});
