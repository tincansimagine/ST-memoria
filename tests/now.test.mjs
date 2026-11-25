import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, memory } from './runtime.mjs';
import { splitNowBlock } from '../craft-engine.mjs';

/** 16턴짜리 채팅 (요약 주기 8) */
async function app() {
    const a = await runtime();
    const store = a.getStore();
    const s = a.getSettings();
    s.autoHide = false; s.chunkTurns = 8; s.recordBatch = 1;
    const chat = a.context.chat;
    for (let n = 1; n <= 16; n++) {
        chat.push({ is_user: true, mes: `${n}번째 행동`, name: '여행자' }, { is_user: false, mes: `아리아의 ${n}번째 대답이다. 바람이 불었다.`, name: '아리아' });
        store.turns.push({ id: `t${n}`, mesId: chat.length - 1, mesHash: a.mesHashOf(chat[chat.length - 1]), turnIndex: n, summary: `${n}번째 일: 아리아와 보라가 등대에서 지냈다.`, importance: 0.5 });
    }
    store.turnCounter = 16;
    a.run(`getContext = () => ({ characterId: 0, characters: [{ name: '아리아', description: '아리아는 남장을 하고 왕녀라는 정체를 숨긴다. 보라는 아리아를 남자로 안다.' }] })`);
    return a;
}
const record = (now) => `WHEN: 1일째 · 등대\nPLOT:\n- 보라가 인장 반지를 보고 아리아의 정체를 알아챘다.\n- 둘은 함께 살기로 했다.\n\nNOW:\n${now.map(l => `- ${l}`).join('\n')}`;

test('the NOW block is split off a summary reply wherever it stands', () => {
    assert.deepEqual(splitNowBlock('PLOT:\n- 일어난 일.\n\nNOW:\n- 지금 A\n- 지금 B\n\nCLOSED: o1'), { text: 'PLOT:\n- 일어난 일.\n\nCLOSED: o1', now: ['지금 A', '지금 B'] });
    assert.deepEqual(splitNowBlock('**NOW:** 한 줄로 쓴 지금\nWHEN: 3일째\nPLOT:\n- 일').now, ['한 줄로 쓴 지금']);
    assert.deepEqual(splitNowBlock('PLOT:\n- 일').now, []);
});

test('each chapter summary rewrites "where things stand now", and the ledger carries it first, above everything else', async () => {
    const a = await app();
    const store = a.getStore();
    const asked = [];
    a.context.generateRaw = async ({ prompt, systemPrompt }) => {
        asked.push({ system: systemPrompt, body: prompt[0].content });
        return asked.length === 1
            ? record(['아리아의 정체는 드러났다 — 보라는 아리아가 왕녀이자 여자임을 안다', '아리아는 더는 남장하지 않는다', '둘은 등대에서 함께 산다'])
            : record(['아리아와 보라는 연인이다', '아리아는 더는 남장하지 않는다', '둘은 등대에서 함께 산다']);
    };
    await a.run('maybeSummarizeChunk')(store);
    assert.equal(asked.length, 2, 'two chapters, one call each — no extra call for NOW');
    assert.match(asked[0].system, /NOW: after the record/);
    assert.match(asked[0].body, /There is no NOW yet[\s\S]*opening setup[\s\S]*아리아는 남장을 하고 왕녀라는 정체를 숨긴다/, 'the first NOW is written against the opening setup');
    assert.match(asked[1].body, /the previous NOW[\s\S]*- 아리아는 더는 남장하지 않는다/, 'later chapters carry the previous NOW forward');
    assert.doesNotMatch(asked[1].body, /There is no NOW yet/);
    assert.doesNotMatch(store.chunkSummaries[0].text, /NOW|더는 남장하지/, 'the chapter record itself stays as it was');

    const packet = (await a.buildPacketWithinBudget('보라', null)).text;
    assert.match(packet, /trust in this order: the latest user message first, then the visible chat, then Where Things Stand Now[\s\S]*character description and opening scenario last/);
    const top = packet.split('## Where Things Stand Now')[1];
    assert.ok(top, 'carried');
    assert.match(top, /^ \(the present state of the story[\s\S]*outranks the character description/);
    assert.match(top.split('\n## ')[0], /- 아리아와 보라는 연인이다\n- 아리아는 더는 남장하지 않는다/);
    assert.ok(packet.indexOf('## Where Things Stand Now') < packet.indexOf('## Story So Far'), 'before the summaries');

    // 되감기로 둘째 챕터가 걷히면 첫째 챕터의 NOW 로 돌아간다
    a.context.chat.length = 20;   // 10턴까지
    a.run('reconcileWithChat')();
    assert.equal(store.chunkSummaries.length, 1);
    assert.match(a.run('currentNow')(store).text, /보라는 아리아가 왕녀이자 여자임을 안다/);
});

test('a chat that has no NOW yet gets one written right away by the sweep, without waiting for the next chapter', async () => {
    const a = await app();
    const store = a.getStore();
    for (let n = 17; n <= 40; n++) store.turns.push({ id: `t${n}`, mesId: -1, mesHash: 0, turnIndex: n, summary: `${n}번째 일.`, importance: 0.5 });
    store.turnCounter = 40;
    store.chunkSummaries.push({ id: 'c1', fromTurn: 1, toTurn: 32, text: 'PLOT:\n- 보라가 인장 반지를 보고 아리아의 정체를 알아챘다.' });
    const calls = [];
    a.context.generateRaw = async ({ systemPrompt, prompt }) => {
        calls.push(systemPrompt);
        return /keep a running note/.test(systemPrompt) ? 'NOW:\n- 아리아는 정체를 숨기지 않는다\n- 보라는 다 안다' : JSON.stringify({ done: [], stale: [], premise: [] });
    };
    await a.run('maybeAuditPledges')(store);
    assert.equal(calls.length, 2, 'the sweep, then the NOW');
    assert.match(a.run('currentNow')(store).text, /- 아리아는 정체를 숨기지 않는다\n- 보라는 다 안다/);
    assert.equal(a.run('currentNow')(store).toTurn, 32);
});
