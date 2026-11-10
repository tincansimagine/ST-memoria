import test from 'node:test';
import assert from 'node:assert/strict';
import { findStatusBars, statusOneLine, isPauseDirective, isPauseMessage, parseRecord, buildTimelineRows, filterTimelineRows,
    timelineMarkdown, timelineCsv, layoutTimelineGraph, verifyIssues } from '../scene-engine.mjs';

test('one-line status bars are read; prose and dialogue are not', () => {
    const [bar] = findStatusBars('[ 🌙 오후 8:15 · 1943년 12월 9일 (목) · 호그와트 → 병동 · ❄️ 눈발, -1°C ]\n\n병동 창문에 눈송이가 부딪혔다.');
    assert.equal(bar.when, '오후 8:15 1943년 12월 9일 (목)');
    assert.equal(bar.place, '호그와트 → 병동');
    assert.equal(bar.weather, '눈발, -1°C');
    assert.equal(statusOneLine(bar), '오후 8:15 1943년 12월 9일 (목) · 호그와트 → 병동 · 눈발, -1°C');
    assert.deepEqual(findStatusBars('그는 오후 3시에 왔다 · 그리고 떠났다.'), []);
    assert.deepEqual(findStatusBars('"오후 8:15 · 12월 9일 · 병동"'), []);
    assert.deepEqual(findStatusBars('[HP 30 · MP 12 · 호감도 55]'), [], 'a stat block without time is not a status bar');
});

test('labelled and HTML status bars are read; custom pattern and off mode are honoured', () => {
    const [bar] = findStatusBars('<div class="st">📅 날짜: 3일째<br>⏰ 시간: 저녁 7시<br>📍 장소: 항구 창고<br>🌡 날씨: 흐림</div>본문');
    assert.equal(bar.when, '3일째 저녁 7시');
    assert.equal(bar.place, '항구 창고');
    assert.equal(bar.weather, '흐림');
    const custom = findStatusBars('본문\n<<12월 10일 | 아침 7:30 | 대연회장>>', { mode: 'custom', pattern: '<<(.+?)>>' });
    assert.equal(custom[0].place, '대연회장');
    assert.deepEqual(findStatusBars('[ 오후 8:15 · 12월 9일 · 병동 ]', { mode: 'off' }), []);
    assert.deepEqual(findStatusBars('x', { mode: 'custom', pattern: '(' }), []);
});

test('pause directives mark side pieces; story-continuing prompts do not', () => {
    assert.equal(isPauseDirective('<System>Pause the role-play and write a horoscope.</System>'), true);
    assert.equal(isPauseDirective('롤플을 잠시 멈추고 인터뷰를 진행해줘'), true);
    assert.equal(isPauseDirective('Skip ahead three days and continue the scene.'), false);
    assert.equal(isPauseMessage('<System>STOP the RP. Quiz time.</System>'), true);
    assert.equal(isPauseMessage('이야기를 멈추고 싶지 않아'), false, 'in-character speech has no system marker');
});

test('summary records are parsed into beats and chips; legacy prose falls back to sentences', () => {
    const r = parseRecord('WHEN: 3일째 저녁 · 항구\nPLOT:\n- 아리아가 열쇠를 맡겼다.\n- 보라가 떠났다.\nSHIFTS: 아리아 → 여행자: 마지못한 신뢰 · 열쇠는 여행자에게\nOPEN: 편지의 발신인');
    assert.equal(r.when, '3일째 저녁 · 항구');
    assert.deepEqual(r.beats, ['아리아가 열쇠를 맡겼다.', '보라가 떠났다.']);
    assert.deepEqual(r.shifts, ['아리아 → 여행자: 마지못한 신뢰', '열쇠는 여행자에게']);
    assert.deepEqual(r.open, ['편지의 발신인']);
    const legacy = parseRecord('여행자는 아리아를 만났다. 등대에서 반지를 건넸다.');
    assert.equal(legacy.structured, false);
    assert.deepEqual(legacy.beats, ['여행자는 아리아를 만났다.', '등대에서 반지를 건넸다.']);
});

const store = {
    turns: [{ turnIndex: 1, mesId: 1, when: '1일째 밤', where: '항구' }, { turnIndex: 2, mesId: 3 }, { turnIndex: 3, mesId: 5, when: '2일째', where: '등대' }],
    memories: [
        { id: 'a', kind: 'event', summary: '항구 도착', turnIndex: 1, entities: ['아리아', '선장'], importance: 0.5 },
        { id: 'b', kind: 'promise', summary: '등대의 약속', turnIndex: 2, entities: ['아리아', '여행자'], importance: 0.9 },
        { id: 'c', kind: 'event', summary: '길드의 빚', turnIndex: 3, entities: ['여행자'], importance: 0.3 },
        { id: 'd', kind: 'event', summary: '꺼진 기억', turnIndex: 3, entities: [], disabled: true },
    ],
    milestones: [{ id: 'm', title: '반지를 건넴', summary: '', participants: ['아리아', '여행자'], grade: 'major', turnIndex: 3 }],
};

test('timeline rows are ordered by turn, inherit missing time and place, and can be filtered and sorted', () => {
    const rows = buildTimelineRows(store);
    assert.deepEqual(rows.map(r => r.id), ['a', 'b', 'm', 'c']);
    assert.equal(rows[1].when, '1일째 밤');
    assert.equal(rows[1].whenCarried, true);
    assert.equal(rows[2].star, true);
    assert.deepEqual(filterTimelineRows(rows, { query: '여행자', minStars: 3 }).map(r => r.id), ['b', 'm']);
    assert.deepEqual(filterTimelineRows(rows, { sort: 'importance', desc: true }).map(r => r.id), ['m', 'b', 'a', 'c']);
    assert.match(timelineMarkdown(rows), /\| 2 \| 1일째 밤 \| 항구 \| 아리아, 여행자 \| 등대의 약속 \| ★★★★★ \| #3 \|/);
    const csv = timelineCsv(rows);
    assert.ok(csv.startsWith('﻿"순서"'));
    assert.match(csv, /"1","1일째 밤","항구","아리아, 선장","항구 도착","3","#1"/);
});

test('graph layout gives lanes to the most frequent people and bands to story time', () => {
    const g = layoutTimelineGraph(buildTimelineRows(store), { maxLanes: 2 });
    assert.deepEqual(g.lanes, ['아리아', '여행자', '그 밖']);
    assert.deepEqual(g.points[0].lanes, [0, 2], 'the captain falls into the catch-all lane');
    assert.deepEqual(g.bands.map(b => [b.label, b.from, b.to]), [['1일째', 0, 1], ['2일째', 2, 3]]);
    assert.deepEqual(layoutTimelineGraph(buildTimelineRows(store), { by: 'place' }).lanes, ['등대', '항구']);
});

test('reply-check issues must quote the reply; unverifiable evidence is set aside, not shown as fact', () => {
    const reply = '깡은 차갑게 식은 콜라를 한 모금 마셨다. 항구 창고는 조용했다.';
    const context = '[#12] 깡은 김이 나는 커피를 두 손으로 감쌌다.';
    const { kept, filtered } = verifyIssues([
        { quote: '차갑게 식은 콜라를 한 모금', evidence: '김이 나는 커피를 두 손으로 감쌌다', source: '#12', problem: '커피가 콜라로 바뀜' },
        { quote: '항구 창고', evidence: '편의점 앞에 있었다', source: 'memory', problem: '장소가 다름' },
        { quote: '답변에 없는 문장', evidence: '김이 나는 커피', problem: '지어낸 경고' },
        { quote: '차갑게 식은 콜라를 한 모금', evidence: '김이 나는 커피', problem: '중복' },
        null,
    ], reply, context);
    assert.deepEqual(kept.map(i => i.problem), ['커피가 콜라로 바뀜']);
    assert.deepEqual(filtered.map(i => i.problem), ['장소가 다름']);
});

test('story views render pictures: pulse bars, flow cards, graph dots, table rows and a relationship map', async () => {
    const view = await import('../story-view.mjs');
    const pulse = view.pulseSvg([{ turnIndex: 1, importance: 0.9, summary: '<b>약속</b>' }, { turnIndex: 2, importance: 0.2 }, { turnIndex: 3 }], { spans: [{ fromTurn: 1, toTurn: 2, level: 'chunk' }], marks: [1] });
    assert.equal((pulse.match(/<rect /g) || []).length, 3);
    assert.match(pulse, /mmv-pulse-bar--a is-peak" data-turn="1"/);
    assert.match(pulse, /mmv-pulse-bar--raw" data-turn="3"/);
    assert.match(pulse, /mmv-pulse-star/);
    assert.ok(!pulse.includes('<b>약속</b>'), 'text is escaped');

    const flow = view.flowHtml([{ id: 'c1', level: 'chunk', fromTurn: 1, toTurn: 8, text: 'WHEN: 3일째 · 항구\nPLOT:\n- 열쇠를 맡겼다.\nSHIFTS: 신뢰\nOPEN: 편지', marks: [{ title: '약속' }], open: true }]);
    assert.match(flow, /class="mmv-card memoria__summary-card" data-id="c1" data-level="chunk" open/);
    assert.match(flow, /mmv-when">3일째 · 항구</);
    assert.match(flow, /mmv-chip--shift[^>]*>신뢰<[\s\S]*mmv-chip--open[^>]*>편지</);
    assert.match(flow, /memoria-summary-regen[\s\S]*memoria-summary-edit[\s\S]*memoria-summary-delete/);

    const rows = buildTimelineRows(store);
    const graph = view.graphHtml(layoutTimelineGraph(rows), { dim: new Set(['c']), picked: 'b' });
    assert.equal((graph.match(/<g class="mmv-pt/g) || []).length, 4);
    assert.match(graph, /is-dim" data-id="c"/);
    assert.match(graph, /is-picked" data-id="b"/);
    assert.match(view.tableHtml(rows, { sort: 'importance', desc: true }), /data-sort="importance" class="is-sortable is-sorted">중요도 ▼/);
    assert.match(view.detailHtml(rows[1]), /data-mes="3">#3</);

    const map = view.bondMapSvg([{ id: 'x', from: '아리아', to: '여행자', stage: '마지못한 신뢰' }, { id: 'y', from: '여행자', to: '아리아', stage: '호기심' }], { picked: 'x' });
    assert.equal((map.match(/class="mmv-person/g) || []).length, 2);
    assert.match(map, /mmv-edge is-picked" data-id="x"/);
    assert.equal(view.bondMapSvg([]), '');
    assert.match(view.bondStepsHtml({ from: 'A', to: 'B', log: [{ stage: '경계' }, { stage: '경계' }, { stage: '신뢰', unsaid: '고마움' }] }), /--mmv-step:0[\s\S]*--mmv-step:1[\s\S]*말하지 못한 것 · 고마움/);
});
