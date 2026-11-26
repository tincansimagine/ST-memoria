import test from 'node:test';
import assert from 'node:assert/strict';
import { readFindings, evidenceRows, driftNoteLines, liveFindings, repliesSince, sumChecks, applySumFix, readGrade, readRepair, repairBad, excerptsFor, checkModeOf, checkEveryOf, sumSecs, turnSpans } from '../audit-engine.mjs';
import { runtime } from './runtime.mjs';

const hashOf = (m) => String(m?.mes || '').length;
const chatOf = (n) => Array.from({ length: n }, (_, i) => ({ is_user: i % 2 === 1, mes: i % 2 ? `내 말 ${i}` : `답 ${i} — 이야기가 이어진다.`, name: i % 2 ? '시온' : '도겸' }));

function storeOf() {
    return {
        turns: [1, 2, 3, 4, 5, 6].map(t => ({ turnIndex: t, mesId: t * 2, summary: `턴 ${t}의 일 — 시온과 도겸이 이야기를 나눴다`, elapsedDays: t === 4 ? 1 : 0 })),
        chunkSummaries: [
            { id: 'c1', fromTurn: 1, toTurn: 3, text: 'WHEN: 1일째 저녁\nPLOT: 도겸은 시온이 남자라는 것을 알고 있다. 둘은 사귄 지 한 달이 넘었다.' },
            { id: 'c2', fromTurn: 3, toTurn: 6, text: 'WHEN: 9일째\nPLOT: 둘이 바닷가에 갔다. 차유원이 끼어들어 셋이 함께 저녁을 먹었고, 시온은 도겸의 손을 잡았다.' },
        ],
        arcSummaries: [],
        characters: [{ name: '도겸', aliases: [] }, { name: '시온', aliases: [] }],
        worldRules: [], bonds: [], entityStates: [], locks: [], memories: [], items: [], milestones: [],
    };
}

test('the check mode follows the old per-reply toggle first', () => {
    assert.equal(checkModeOf({ replyCheck: true, checkMode: 'batch' }), 'each');
    assert.equal(checkModeOf({ checkMode: 'batch' }), 'batch');
    assert.equal(checkModeOf({}), 'off');
    assert.equal(checkEveryOf({ checkEvery: 1 }), 2);
    assert.equal(checkEveryOf({}), 5);
});

test('a finding counts only when its quote is in the reply and its evidence is in the record', () => {
    const store = storeOf(), chat = chatOf(14);
    const win = [{ no: 12, h: 1, who: '도겸', text: '“후배, 너 여자였어?” 도겸이 물었다.' }];
    let n = 0;
    const out = readFindings([
        { n: 12, kind: 'fact', quote: '너 여자였어', evidence: '도겸은 시온이 남자라는 것을 알고 있다', problem: '도겸이 이미 아는 사실을 모른다' },
        { n: 12, kind: 'knows', quote: '후배', evidence: '어디에도 없는 문장입니다', problem: '근거 없음' },
        { n: 12, kind: 'fact', quote: '너 여자였어', evidence: '도겸은 시온이 남자라는 것을 알고 있다', problem: '같은 대목을 두 번 짚음' },
        { n: 99, kind: 'fact', quote: 'x', evidence: 'y', problem: '검사하지 않은 메시지' },
        { n: '#12', kind: 'speech', quote: '도겸이 물었다', evidence: '', problem: '말투' },
    ], win, evidenceRows(store, chat), '', () => `f${++n}`);
    assert.equal(out.length, 3, 'a number that was not checked, and the same quote twice, are dropped');
    assert.equal(out[0].ok, true);
    assert.equal(out[0].src.kind, 'summary');
    assert.equal(out[0].src.from, 1, 'the evidence points back at the messages the summary covers');
    assert.equal(out[1].ok, false, 'evidence not in the record is not verified');
    assert.equal(out[2].kind, 'address');
});

test('the correction note rides along for three replies and drops dismissed findings', () => {
    const chat = chatOf(14);
    const report = { to: 12, lastH: hashOf(chat[12]), findings: [{ id: 'a', no: 12, h: hashOf(chat[12]), ok: true, evidence: '둘은 사귄 지 한 달이 넘었다', text: '처음 만난 사이처럼 굴었다' }, { id: 'b', no: 12, h: hashOf(chat[12]), ok: false, evidence: 'x', text: 'y' }] };
    const audit = { drift: report };
    assert.equal(liveFindings(report, chat, hashOf).length, 1);
    assert.equal(repliesSince(report, chat, hashOf), 0);
    const lines = driftNoteLines(audit, chat, hashOf, true);
    assert.equal(lines.length, 2);
    assert.match(lines[1], /reply #12 said otherwise/);
    assert.deepEqual(driftNoteLines(audit, chat, hashOf, false), [], 'off means not a single line');
    chat.push({ is_user: false, mes: 'a' }, { is_user: false, mes: 'b' }, { is_user: false, mes: 'c' });
    assert.deepEqual(driftNoteLines(audit, chat, hashOf, true), [], 'gone after three replies');
    chat.splice(14);
    report.findings[0].dismissed = true;
    assert.deepEqual(driftNoteLines(audit, chat, hashOf, true), []);
    chat[12].mes += ' 고침';
    assert.equal(repliesSince(report, chat, hashOf), -1, 'an edited reply ends the note');
});

test('summary checks catch overlap, order, wrong day and stray names, and fix what they can', () => {
    const store = storeOf(), chat = chatOf(14);
    const mentions = (text, names) => names.some(n => text.includes(n));
    const issues = sumChecks(store, chat, { strays: ['차유원'], known: ['도겸'], mentions });
    const types = issues.map(i => i.type).sort();
    assert.deepEqual(types, ['date', 'name', 'overlap']);
    const overlap = issues.find(i => i.type === 'overlap');
    assert.equal(overlap.fix, 'trim');
    assert.equal(applySumFix(store, overlap), true);
    assert.equal(store.chunkSummaries[1].fromTurn, 4);
    const date = issues.find(i => i.type === 'date');
    assert.equal(date.said, '9');
    store.chunkSummaries.reverse();
    const order = sumChecks(store, chat).find(i => i.type === 'order');
    assert.ok(order);
    assert.equal(applySumFix(store, order), true);
    assert.equal(store.chunkSummaries[0].id, 'c1');
    store.chunkSummaries[1].toTurn = 40;
    const range = sumChecks(store, chat).find(i => i.type === 'range');
    assert.equal(range.fix, 'clamp');
    assert.equal(applySumFix(store, range), true);
    assert.equal(store.chunkSummaries[1].toTurn, 6);
});

test('summary sections map onto the messages they cover', () => {
    const store = storeOf(), chat = chatOf(14);
    const spans = turnSpans(store, chat);
    assert.deepEqual(spans.get(1), [1, 2], 'a turn starts at the user line before its reply');
    const secs = sumSecs(store, chat);
    assert.deepEqual([secs[0].from, secs[0].to], [1, 6]);
});

test('grading keeps only tagged records and in-range references; repair keeps the old text when the new one shrinks', () => {
    const tags = new Map([['S1', { s: { id: 'c1' }, from: 1, to: 6 }]]);
    const items = readGrade([{ sec: 'S1', kind: 'wrong', text: '틀림', refs: [2, 40] }, { sec: 'S9', kind: 'wrong', text: 'x' }, { sec: 's1', kind: 'nonsense', text: 'y' }], tags);
    assert.deepEqual(items.map(i => [i.sum, i.kind, i.refs]), [['c1', 'wrong', [2]]]);
    const got = readRepair('앞말\n=== S1 ===\nWHEN: 1일째\nPLOT: 고친 글\n=== S2 ===\n두 번째', (t) => t.trim());
    assert.equal(got.get('S1'), 'WHEN: 1일째\nPLOT: 고친 글');
    assert.equal(got.get('S2'), '두 번째');
    const before = 'WHEN: 1일째\nPLOT: 하나\nPLOT: 둘\nPLOT: 셋';
    assert.equal(repairBad(before, 'PLOT: 하나'), 'shrunk');
    assert.equal(repairBad(before, 'WHEN: 1일째\nPLOT: 하나 고침\nPLOT: 둘\nPLOT: 셋 더'), '');
    assert.equal(repairBad('', ''), 'empty');
});

test('excerpts stay inside the range and keep the focus message', () => {
    const chat = chatOf(30);
    const lines = excerptsFor(chat, 4, 20, 800, m => m.name, m => m.mes, [15]);
    assert.ok(lines.length >= 2);
    assert.ok(lines.some(l => l.startsWith('[#15 ')));
    assert.ok(lines.every(l => { const n = Number(l.match(/^\[#(\d+)/)[1]); return n >= 4 && n <= 20; }));
});

test('a verified slip reaches the ledger as a short note, and the summary panel lists what the code found', async () => {
    const rt = await runtime();
    const store = rt.getStore();
    const chat = rt.context.chat;
    for (let i = 0; i < 8; i++) chat.push({ is_user: true, mes: `내 말 ${i}`, name: '여행자' }, { is_user: false, mes: `아리아의 대답 ${i} — 바람이 분다.`, name: '아리아' });
    const last = chat.length - 1;
    const h = rt.context.mesHashOf(chat[last]);
    store.memories.push({ id: 'm1', kind: 'fact', summary: '등대지기는 왼손을 다쳤다', turnIndex: 1, mesId: 1, importance: 0.9, entities: [], tags: [], hints: [], visibility: 'public', owner: null, pinned: true, disabled: false });
    store.audit = { drift: { at: Date.now(), from: last, to: last, lastH: h, checked: 1, findings: [{ id: 'x', no: last, h, ok: true, kind: 'fact', who: '아리아', evidence: '등대지기는 왼손을 다쳤다', text: '오른손을 다쳤다고 했다' }] } };
    const packet = await rt.buildPacketWithinBudget('바람');
    assert.match(packet.text, /Keep Consistent with the Record/);
    assert.match(packet.text, /등대지기는 왼손을 다쳤다/);
    rt.getSettings().driftNote = false;
    const quiet = await rt.buildPacketWithinBudget('바람');
    assert.doesNotMatch(quiet.text, /Keep Consistent/);
});
