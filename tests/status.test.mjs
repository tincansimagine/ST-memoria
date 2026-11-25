import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './runtime.mjs';

const BAR = '[ 3월 5일 화요일 | 오후 9:10 | 편의점 앞 | 맑음 ]';
const SMS = '[[prop:sms|차유원 선배|휘낭시에는 내일 아침에 우유랑 같이 먹고. 목요일 저녁 일곱 시, 학교 앞 괜찮지?]]';

async function app() {
    const a = await runtime();
    a.getStore();
    a.getSettings().recordBatch = 1;
    a.getSettings().chunkTurns = 50;
    a.getSettings().autoHide = false;
    return a;
}
const say = (a, text) => {
    a.context.chat.push({ is_user: true, mes: '다음 장면', name: '해준' }, { is_user: false, mes: text, name: '차유원' });
    return a.context.chat.length - 1;
};

test('a text-message card in the reply is not taken for the status bar: the turn, the ledger and the "now" line keep the real one', async () => {
    const a = await app();
    a.context.generateRaw = async () => JSON.stringify({ digest: '차유원이 문자를 보냈다.', clock: { day: 1 }, memories: [] });
    await a.run('commitTurns')([say(a, `${BAR}\n\n차유원은 편의점 앞에서 손을 흔들었다. 바람이 찼다.`)]);
    await a.run('commitTurns')([say(a, `해준의 폰이 울렸다. 화면에 이름이 떴다.\n\n${SMS}`)]);
    const [first, second] = a.getStore().turns;
    assert.equal(first.when, '3월 5일 화요일 오후 9:10');
    assert.equal(first.where, '편의점 앞');
    assert.doesNotMatch(`${second.when} ${second.where}`, /prop:sms|휘낭시에|목요일/);

    const now = a.run('latestStatus')();
    assert.equal(now.mesId, 1, 'the newest status bar is the one in the earlier reply');
    assert.equal(now.place, '편의점 앞');
    const packet = (await a.buildPacketWithinBudget('문자', null)).text;
    assert.match(packet, /latest status bar: 3월 5일 화요일 오후 9:10 · 편의점 앞 · 맑음/);
    assert.doesNotMatch(packet, /latest status bar:[^\n]*prop:sms/);
});

test('turns stamped from a message card by an older version are cleaned once when the chat opens; real status bars stay', async () => {
    const a = await app();
    const store = a.getStore();
    const chat = a.context.chat;
    const turn = (n, text, extra) => {
        const id = say(a, text);
        store.turns.push({ id: `t${n}`, mesId: id, mesHash: a.mesHashOf(chat[id]), turnIndex: n, summary: `${n}번째 일.`, importance: 0.5, ...extra });
    };
    turn(1, `${BAR}\n\n차유원은 편의점 앞에서 손을 흔들었다.`, { when: '3월 5일 화요일 오후 9:10', where: '편의점 앞', date: '2026-03-05' });
    // 예전 판정이 찍어 둔 값 그대로
    turn(2, `해준의 폰이 울렸다.\n\n${SMS}`, { when: '휘낭시에는 내일 아침에 우유랑 같이 먹고. 목요일 저녁 일곱 시, 학교 앞 괜찮지?]', where: '[prop:sms' });
    turn(3, '[문자|차유원 선배|3월 9일 저녁 7시에 봐요.]\n\n해준은 답장을 썼다.', { when: '3월 9일 저녁 7시에 봐요.', where: '문자', date: '2026-03-09' });
    // 사서가 적은 장면 값 — 상태창에서 온 게 아니므로 건드리지 않는다
    turn(4, '두 사람은 학교 앞에서 만났다. 해가 지고 있었다.', { when: '목요일 저녁', where: '학교 앞' });
    store.turnCounter = 4;
    delete store.statusRev;

    a.run('reconcileWithChat')();
    const [t1, t2, t3, t4] = store.turns;
    assert.deepEqual([t1.when, t1.where, t1.date], ['3월 5일 화요일 오후 9:10', '편의점 앞', '2026-03-05']);
    assert.deepEqual([t2.when, t2.where], [null, null]);
    assert.deepEqual([t3.when, t3.where, t3.date], [null, null, undefined], 'the date of the appointment is not the date of the scene');
    assert.deepEqual([t4.when, t4.where], ['목요일 저녁', '학교 앞']);
    assert.ok(a.run('activityLog').list().some(r => /시간·장소를 2턴에서 지웠어요/.test(r.text)));

    // 한 번만 — 다시 열어도 손대지 않는다
    t2.when = '직접 적은 값';
    a.run('reconcileWithChat')();
    assert.equal(t2.when, '직접 적은 값');
});
