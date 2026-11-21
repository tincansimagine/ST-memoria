import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';
import { groundedIn, soundsHedged, contentWords, mentionsThread, noteThreadSightings, sleepStaleThreads, rareQueryWords } from '../craft-engine.mjs';

async function app() {
    const a = await runtime();
    a.getStore();
    return a;
}

const withVec = (a, m) => ({ ...m, vec: a.encodeVec(a.embedText(a.memoryIndexText(m))) });
const lock = (id, summary, extra = {}) => ({ id, kind: 'loose_end', summary, status: 'active', priority: 2, turnIndex: 0, createdTurn: 0, ...extra });

/** 한 턴짜리 채팅을 깔고, 사서 응답을 정해 둔 채로 그 턴을 기록한다 */
async function recordOnce(a, reply, prose = '보라는 북문 너머까지 걸어가 등불을 비추었다. 불빛의 정체는 오래된 등대지기의 오두막이었다.') {
    const chat = a.context.chat;
    chat.push({ is_user: true, mes: '북문 너머로 가 보자', name: '여행자' }, { is_user: false, mes: prose, name: '보라' });
    a.getSettings().recordBatch = 1;
    a.getSettings().chunkTurns = 50;
    let asked = '';
    a.context.generateRaw = async ({ prompt, systemPrompt }) => { asked = `${systemPrompt}\n${prompt[0].content}`; return JSON.stringify(reply); };
    assert.equal(await a.run('commitTurns')([chat.length - 1]), true);
    return asked;
}

test('evidence helpers: verbatim phrases, hedged verdicts, content words, thread mentions', () => {
    assert.ok(groundedIn('“불이 꺼지기 전에는”', '아리아: "불이 꺼지기 전에는 꼭 돌아올게요."'));
    assert.ok(!groundedIn('불이 꺼진 뒤에', '불이 꺼지기 전에는 꼭 돌아올게요.'), 'a paraphrase is not evidence');
    assert.ok(!groundedIn('불', '불이 꺼지기 전에는'), 'a scrap too short to prove anything');
    for (const t of ['거의 다 찾았다', '아직 열지 않았다', '편지를 읽으려고 했다', 'she seems to have found it', 'about to open the door']) assert.ok(soundsHedged(t), t);
    for (const t of ['편지를 소리 내어 읽었다', 'Mina read the letter aloud']) assert.ok(!soundsHedged(t), t);
    assert.deepEqual([...contentWords('나침반을 아리아에게 건넸다. The compass is old')], ['나침반', '아리아', '건넸다', 'compass']);
    assert.ok(mentionsThread('북문 너머의 불빛을 확인하기', '보라가 북문 너머로 가서 불빛의 정체를 확인했다.'));
    assert.ok(!mentionsThread('북문 너머의 불빛을 확인하기', '두 사람은 북쪽 시장에서 빵을 샀다.'));
});

test('a thread is settled only with a phrase from the scene; otherwise it is left as a suggestion with its reason', async () => {
    const a = await app();
    const store = a.getStore();
    store.locks.push(lock('l1', '북문 너머의 불빛 정체를 확인하기'), lock('l2', '보라가 숨긴 편지를 아리아에게 전하기'), lock('l3', '등대 열쇠를 되찾기'));
    const asked = await recordOnce(a, { digest: '보라가 북문 너머 불빛의 정체를 밝혔다.', memories: [], settled: [
        { tag: 'p1', how: '불빛은 등대지기의 오두막이었다', said: '불빛의 정체는 오래된 등대지기의 오두막이었다' },
        { tag: 'p2', how: '편지를 건넸다', said: '보라는 편지를 아리아에게 건넸다' },
        { tag: 'p3', how: '열쇠를 거의 찾았다', said: '등불을 비추었다' },
    ] });
    assert.match(asked, /"said"/);
    assert.equal(store.locks[0].status, 'resolved');
    assert.equal(store.locks[0].resolution, '불빛은 등대지기의 오두막이었다');
    for (const l of store.locks.slice(1)) {
        assert.equal(l.status, 'active', `${l.id} stays open`);
        assert.equal(l.suggestResolved, true);
    }
    assert.equal(store.locks[1].suggestHow, '편지를 건넸다');
    assert.ok(a.run('activityLog').list().some(r => /근거가 모자라/.test(r.text)));

    // 사용자가 ✔로 확정하면 사서가 적어 둔 경위가 남는다
    const settled = store.locks[1];
    settled.status = 'resolved';
    settled.resolution = settled.suggestHow;
    assert.equal(settled.resolution, '편지를 건넸다');
});

test('a thread that moved gets a "now" line beside its original wording, shown to the model and undone with its turn', async () => {
    const a = await app();
    const store = a.getStore();
    store.locks.push(lock('l1', '사라진 등대 열쇠를 찾기'));
    const asked = await recordOnce(a, { digest: '보라가 오두막에서 열쇠 꾸러미를 발견했지만 등대 열쇠는 없었다.', memories: [],
        moved: [{ tag: 'p1', now: '오두막은 뒤졌고, 남은 곳은 부두 창고' }, { tag: 'p9', now: '없는 꼬리표' }] }, '보라는 오두막에서 열쇠 꾸러미를 찾았지만 등대 열쇠는 없었다. 남은 곳은 부두 창고뿐이었다.');
    assert.match(asked, /"moved"/);
    const l = store.locks[0];
    assert.equal(l.status, 'active');
    assert.equal(l.summary, '사라진 등대 열쇠를 찾기', 'the original wording is kept');
    assert.equal(l.latest.text, '오두막은 뒤졌고, 남은 곳은 부두 창고');
    store.turnCounter = 5;
    const packet = (await a.buildPacketWithinBudget('열쇠', null)).text;
    assert.match(packet, /\[loose_end\] 사라진 등대 열쇠를 찾기 — now: 오두막은 뒤졌고, 남은 곳은 부두 창고/);

    a.invalidateTurnByMesId(a.context.chat.length - 1);
    assert.equal(store.locks[0].latest, null, 'swiping the turn away takes its "now" line with it');
});

test('a sleeping thread wakes when the story brings it up again, and talk keeps a thread awake', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 80;
    store.locks.push(
        lock('l1', '북문 너머의 불빛 정체를 확인하기', { status: 'dormant', sleptTurn: 70 }),
        lock('l2', '바닷가 마을의 축제에 가기', { status: 'dormant', sleptTurn: 70 }),
    );
    await recordOnce(a, { digest: '보라가 북문 너머로 가서 불빛의 정체가 등대지기의 오두막임을 확인하려 했다.', memories: [] });
    const [lit, fair] = store.locks;
    assert.equal(lit.status, 'active', 'mentioned again, so awake');
    assert.equal(lit.seenTurn, store.turnCounter);
    assert.equal(fair.status, 'dormant', 'nobody spoke of the festival');
    assert.ok(a.run('activityLog').list().some(r => /다시 언급돼 깨웠어요/.test(r.text)));

    // 다시 적히지 않아도 언급되고 있으면 잠들지 않는다
    assert.equal(sleepStaleThreads(store.locks, store.turnCounter + 30, 60), 0);
    assert.equal(lit.status, 'active');

    a.invalidateTurnByMesId(a.context.chat.length - 1);
    assert.equal(store.locks[0].status, 'dormant', 'undoing the turn that woke it puts it back to sleep');
    assert.equal(store.locks[0].seenTurn ?? null, null);
});

test('sightings are counted once per turn and never touch closed or standing pledges', () => {
    const locks = [lock('a', '북문 너머의 불빛 정체를 확인하기'), lock('b', '북문 너머의 불빛 정체를 확인하기', { status: 'resolved' }),
        { ...lock('c', '북문 너머의 불빛 정체를 아무도 모르게 하기'), kind: 'keep_secret' }];
    assert.deepEqual(noteThreadSightings(locks, '북문 너머 불빛의 정체를 확인했다', 9), { seen: 1, woke: 0 });
    assert.deepEqual(noteThreadSightings(locks, '북문 너머 불빛의 정체를 확인했다', 9), { seen: 0, woke: 0 });
    assert.equal(locks[1].seenTurn, undefined);
    assert.equal(locks[2].seenTurn, undefined);
});

test('a memory is retired only when the librarian quotes the scene', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 1;
    store.turns.push({ id: 't0', mesId: -1, mesHash: 0, turnIndex: 1, summary: '여행자가 열쇠를 받았다.', importance: 0.5 });
    store.memories.push(withVec(a, memory('key', { kind: 'item', summary: '여행자가 등대 창고 열쇠를 가지고 있다', turnIndex: 1, mesId: -1, entities: ['여행자'] })));
    await recordOnce(a, { digest: '여행자가 열쇠를 강에 던졌다.', memories: [], outdated: [{ tag: 'm1', now: '열쇠는 강바닥에 있다', said: '열쇠를 바다에 던져 버렸다' }] },
        '여행자는 등대 창고 열쇠를 강물에 던졌다. 열쇠는 소리도 없이 가라앉았다.');
    assert.equal(store.memories.find(m => m.id === 'key').retired, undefined, 'the quoted phrase is not in the scene');

    const b = await app();
    const s2 = b.getStore();
    s2.turnCounter = 1;
    s2.turns.push({ id: 't0', mesId: -1, mesHash: 0, turnIndex: 1, summary: '여행자가 열쇠를 받았다.', importance: 0.5 });
    s2.memories.push(withVec(b, memory('key', { kind: 'item', summary: '여행자가 등대 창고 열쇠를 가지고 있다', turnIndex: 1, mesId: -1, entities: ['여행자'] })));
    await recordOnce(b, { digest: '여행자가 열쇠를 강에 던졌다.', memories: [], outdated: [{ tag: 'm1', now: '열쇠는 강바닥에 있다', said: '열쇠는 소리도 없이 가라앉았다' }] },
        '여행자는 등대 창고 열쇠를 강물에 던졌다. 열쇠는 소리도 없이 가라앉았다.');
    assert.equal(s2.memories.find(m => m.id === 'key').retired?.now, '열쇠는 강바닥에 있다');
});

test('a rare word in the message pulls up the few memories that hold it', async () => {
    const a = await app();
    const store = a.getStore();
    store.turnCounter = 40;
    a.context.chat.push({ is_user: true, mes: '그 나침반 아직 갖고 있어?', name: '여행자' });
    for (let i = 0; i < 14; i++) {
        store.memories.push(withVec(a, memory(`m${i}`, { summary: `아리아와 여행자가 등대 근처에서 ${i}번째로 이야기를 나눴다`, turnIndex: 20 + i, importance: 0.7, entities: ['아리아', '여행자'] })));
    }
    store.memories.push(withVec(a, memory('compass', { kind: 'item', summary: '보라가 낡은 나침반을 여행자에게 맡겼다', turnIndex: 3, importance: 0.35 })));

    const words = rareQueryWords('그 나침반 아직 갖고 있어?', store.memories.map(m => a.memoryIndexText(m).toLowerCase()));
    assert.deepEqual(words.map(w => w.word), ['나침반']);
    const { selected, trace } = await a.retrieveMemories('그 나침반 아직 갖고 있어?', [], '');
    assert.equal(selected[0].id, 'compass', 'the one memory that holds the rare word comes first, though it is old and minor');
    assert.match(trace.get('compass').reason, /드문 낱말: 나침반/);

    // 앞선 답변들에 연달아 실렸어도, 그 낱말로 직접 물으면 미뤄지지 않는다
    for (const at of [-3, -2, -1]) a.run('noteRecallHistory')('test-chat', at, ['compass']);
    assert.equal((await a.retrieveMemories('그 나침반 아직 갖고 있어?', [], '')).selected[0].id, 'compass');
});
