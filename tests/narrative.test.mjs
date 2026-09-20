import test from 'node:test';
import assert from 'node:assert/strict';
import { NARRATOR_PERSPECTIVE, addCheckpoint, archiveChanges, archiveSnapshot, validateArchive } from '../archive-engine.mjs';
import { runtime, memory } from './runtime.mjs';

async function story() {
    const app = await runtime();
    const store = app.getStore();
    store.turnCounter = 20;
    store.memories = [
        memory('public', { summary: '두 사람은 등대에서 만났다.', pinned: true }),
        memory('aria', { summary: '아리아는 편지의 발신인을 숨긴다.', visibility: 'secret', owner: '아리아', pinned: true }),
        memory('player', { summary: '여행자는 고향이 그립다고 속으로 생각했다.', visibility: 'private', owner: '여행자', pinned: true }),
        memory('bora', { summary: '보라만 창고 열쇠의 위치를 안다.', visibility: 'secret', owner: '보라', pinned: true }),
        memory('unknown', { visibility: 'secret', owner: null, pinned: true }),
        memory('disabled', { visibility: 'private', owner: '지수', pinned: true, disabled: true }),
    ];
    return { app, store };
}

test('novel mode is opt-in, keeps ownership, and switching back restores the existing scope and instructions', async () => {
    const { app, store } = await story();
    assert.equal(store.perspective, undefined);
    await app.updateInjection();
    assert.deepEqual([...app.run('recallAudit.ids')], ['public', 'aria']);
    assert.match(app.prompts.at(-1)[1], /never write their actions, feelings, or decisions/);

    store.perspective = NARRATOR_PERSPECTIVE;
    await app.updateInjection();
    assert.deepEqual([...app.run('recallAudit.ids')], ['public', 'aria', 'player', 'bora']);
    const novel = app.prompts.at(-1)[1];
    assert.match(novel, /you may narrate all characters/);
    assert.match(novel, /Narrator access is not shared character knowledge/);
    assert.match(novel, /\[private:여행자\]/);
    assert.match(novel, /\[secret:보라\]/);
    assert.doesNotMatch(novel, /never write their actions|subtext only|stays unspoken/);
    assert.equal(app.run('lastPacketDiagnostics.hidden'), 1);
    assert.equal(store.memories.find(m => m.id === 'bora').visibility, 'secret');

    store.perspective = '';
    await app.updateInjection();
    assert.deepEqual([...app.run('recallAudit.ids')], ['public', 'aria']);
    assert.match(app.prompts.at(-1)[1], /never write their actions/);
    assert.doesNotMatch(app.prompts.at(-1)[1], /Novel co-writing mode/);
    app.context.selected_group = 'group';
    assert.equal(app.authorizedEntities().size, 0);
});

test('novel mode still honors the private-memory switch and explicit public-only selection', async () => {
    const { app, store } = await story();
    store.perspective = NARRATOR_PERSPECTIVE;
    app.context.selected_group = 'group';
    app.getSettings().authorizeCharPrivate = false;
    const packet = await app.buildPacketWithinBudget('등대', null);
    assert.deepEqual([...packet.ids], ['public']);
    assert.match(packet.text, /you may narrate all characters/);
    assert.doesNotMatch(packet.text, /편지의 발신인|고향이 그립|창고 열쇠/);
    app.getSettings().authorizeCharPrivate = true;
    store.perspective = '__public__';
    assert.equal(app.authorizedEntities().size, 0);
    assert.deepEqual([...(await app.retrieveMemories('등대', [])).pinned.map(m => m.id)], ['public']);
});

test('assistant-only continuation searches the latest scene, while a new user contribution takes priority', async () => {
    const app = await runtime();
    const store = app.getStore();
    store.turnCounter = 20;
    store.perspective = NARRATOR_PERSPECTIVE;
    store.memories = [
        memory('old', { summary: '과수원에서 사과를 땄던 일.', trigger: '과수원' }),
        memory('current', { summary: '봉인된 청동열쇠는 함부로 쓰면 안 된다.', trigger: '청동열쇠' }),
        memory('user', { summary: '달맞이 축제에는 얼굴을 가린다.', trigger: '달맞이' }),
    ];
    app.context.chat.push(
        { is_user: true, mes: '과수원으로 가자.' },
        { is_user: false, mes: '두 사람은 이미 과수원을 떠났다.' },
        { is_user: false, mes: '바닷바람이 분다. '.repeat(400) + '문 앞에서 청동열쇠를 꺼냈다.' },
        { is_system: true, mes: '과수원 시스템 메모' },
    );
    assert.ok(app.currentRecallQuery().length <= 2400);
    assert.match(app.currentRecallQuery(), /청동열쇠/);
    assert.doesNotMatch(app.currentRecallQuery(), /과수원/);
    await app.updateInjection();
    assert.equal(app.run('lastPacketDiagnostics.rows.find(m => m.id === "current").mode'), 'trigger');
    assert.notEqual(app.run('lastPacketDiagnostics.rows.find(m => m.id === "old")?.mode'), 'trigger');

    app.context.chat.push({ is_user: true, mes: '내가 먼저 달맞이 축제로 가자고 말했다.' });
    assert.equal(app.currentRecallQuery(), '내가 먼저 달맞이 축제로 가자고 말했다.');
    await app.updateInjection();
    assert.equal(app.run('lastPacketDiagnostics.rows.find(m => m.id === "user").mode'), 'trigger');
    app.context.chat.splice(0, app.context.chat.length, { is_user: false, mes: '청동열쇠로 문을 열었다.' });
    assert.equal(app.currentRecallQuery(), '청동열쇠로 문을 열었다.');
    await app.updateInjection();
    assert.equal(app.run('lastPacketDiagnostics.rows.find(m => m.id === "current").mode'), 'trigger');
    store.perspective = '';
    app.context.chat.unshift({ is_user: true, mes: '과수원으로 가자.' });
    assert.equal(app.currentRecallQuery(), '과수원으로 가자.');
});

test('novel guidance works with an empty archive and does not disappear into the old long-packet footer', async () => {
    const app = await runtime();
    assert.equal((await app.buildPacketWithinBudget('', null)).text, '');
    app.getStore().perspective = NARRATOR_PERSPECTIVE;
    assert.match((await app.buildPacketWithinBudget('', null)).text, /Novel co-writing mode/);
    const parts = await app.buildPacketSections('', null);
    parts.rules = Array.from({ length: 50 }, (_, n) => ({ scope: 'world', key: `rule${n}`, value: '도시는 밤에 문을 닫는다.' }));
    const full = app.renderPacket(parts);
    assert.match(full, /End of archive.*novel co-writing may portray all characters/);
    assert.doesNotMatch(full, /belongs to the user alone|never write their actions|stays unspoken/);
});

test('novel mode retains the token ceiling and knowledge boundaries in compact fallback packets', async () => {
    const { app, store } = await story();
    store.perspective = NARRATOR_PERSPECTIVE;
    store.locks = [
        { id: 'huge', kind: 'world_limit', summary: '가'.repeat(5000), priority: 1, status: 'active' },
        { id: 'short', kind: 'keep_secret', summary: '편지 발신인을 공개하지 않는다', priority: 2, status: 'active' },
    ];
    for (const budget of [1, 100, 400, 2500]) {
        app.getSettings().tokenBudget = budget;
        const packet = await app.buildPacketWithinBudget('등대', null);
        assert.ok(packet.tokens <= budget);
        if (packet.text) {
            assert.ok(packet.text.endsWith('</memoria_ledger>'));
            assert.match(packet.text, /[Nn]ovel co-writing/);
            assert.doesNotMatch(packet.text, /never write their actions|Private knowledge stays unspoken/);
        }
        if (budget === 100) assert.match(packet.text, /편지 발신인을 공개하지 않는다/);
    }
});

test('director and rewritten drafts follow the selected mode without overwriting saved custom prompts', async () => {
    const { app, store } = await story();
    app.getSettings().supervisorEnabled = true;
    const savedPrompt = app.getSettings().prompts.supervisor;
    const calls = [];
    app.context.captureCall = (system, user) => { calls.push({ system, user }); return '{"remember":[]}'; };
    app.context.setTimeout = (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; };
    app.run('callAuxLLM = async (system, user) => captureCall(system, user);');
    await app.runSupervisor('등대');
    assert.match(calls.at(-1).system, /Never plan their actions/);
    store.perspective = NARRATOR_PERSPECTIVE;
    await app.runSupervisor('청동열쇠로 문을 열었다.');
    assert.match(calls.at(-1).system, /you may narrate all characters/);
    assert.doesNotMatch(calls.at(-1).system, /Never plan their actions|may only tint mood and subtext/);
    assert.match(calls.at(-1).user, /^Recall cue from the latest scene/);
    assert.equal(app.getSettings().prompts.supervisor, savedPrompt);

    app.context.captureCall = (system, user) => { calls.push({ system, user }); return '## Hidden Knowledge\n- [secret:보라] 보라만 창고 열쇠의 위치를 안다.'; };
    const draft = await app.rewritePacketWithLibrarian();
    assert.match(calls.at(-1).system, /exact holder and visibility/);
    assert.doesNotMatch(calls.at(-1).system, /marked as subtext only/);
    assert.match(draft, /you may narrate all characters/);
    assert.match(draft, /\[secret:보라\]/);
});

test('manual pinned packets remain intact and releasing them applies the chosen narrative mode', async () => {
    const { app, store } = await story();
    store.packetPin = { text: '사용자가 직접 고정한 장부' };
    store.perspective = NARRATOR_PERSPECTIVE;
    await app.updateInjection();
    assert.equal(app.prompts.at(-1)[1], store.packetPin.text);
    assert.equal(app.run('lastPacketDiagnostics'), null);
    delete store.packetPin;
    app.persistStore();
    await app.updateInjection();
    assert.match(app.prompts.at(-1)[1], /Novel co-writing mode/);
});

test('an in-flight rewritten draft cannot reintroduce the previous narrative mode', async () => {
    const { app, store } = await story();
    store.perspective = NARRATOR_PERSPECTIVE;
    let release;
    let started;
    const waiting = new Promise(resolve => { started = resolve; });
    app.context.waitForReply = async () => { started(); return new Promise(resolve => { release = resolve; }); };
    app.run('callAuxLLM = async () => waitForReply();');
    const pending = app.rewritePacketWithLibrarian();
    await waiting;
    store.perspective = '';
    release('## Hidden Knowledge\n- 이전 소설 모드의 초안');
    await assert.rejects(pending, /기억·서술 방식이 바뀌어/);
});

test('narrative mode survives export and checkpoint restore with a readable review label', async () => {
    const { app, store } = await story();
    store.perspective = NARRATOR_PERSPECTIVE;
    const exported = validateArchive(JSON.parse(archiveSnapshot(store)));
    assert.equal(exported.perspective, NARRATOR_PERSPECTIVE);
    addCheckpoint(store, '소설 모드 저장', 'novel');
    store.perspective = '';
    const changes = archiveChanges(store, exported);
    assert.match(changes.find(c => c.id === 'perspective').after, /소설·풀사칭/);
    app.run('reviewArchiveChanges = async () => true;');
    await app.restoreCheckpoint('novel');
    assert.equal(app.getStore().perspective, NARRATOR_PERSPECTIVE);
});
