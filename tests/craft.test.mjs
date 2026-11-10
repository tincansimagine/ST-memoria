import test from 'node:test';
import assert from 'node:assert/strict';
import { withDeadline, parsePhraseList, stripPhrases, hasPhrase, findRepeatedPhrases, bundleKeys, pickBundleValues,
    resolveBundleName, switchBundle, saveBundle, deleteBundle, renameBundle, exportBundle, parseBundleFile,
    diffStableEntries, shouldRefreeze, createActivityLog, findRivalExtensions } from '../craft-engine.mjs';

const sleep = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));

test('withDeadline returns the value when it arrives in time and the fallback when it does not', async () => {
    assert.deepEqual(await withDeadline(sleep(5, 'ok'), 200, 'late'), { value: 'ok', timedOut: false });
    assert.deepEqual(await withDeadline(sleep(200, 'ok'), 10, 'late'), { value: 'late', timedOut: true });
    assert.deepEqual(await withDeadline(sleep(50, 'ok'), 0, null), { value: null, timedOut: true });
    assert.deepEqual(await withDeadline(sleep(5, 'ok'), Infinity), { value: 'ok', timedOut: false });
});

test('withDeadline does not leak an unhandled rejection after timing out', async () => {
    const failing = sleep(20).then(() => { throw new Error('late failure'); });
    assert.equal((await withDeadline(failing, 5, 'x')).timedOut, true);
    await sleep(40);
});

test('phrase list: splits on newlines and commas, dedupes, longest first, ignores single characters', () => {
    assert.deepEqual(parsePhraseList('나지막이, 입꼬리가  미세하게\n나지막이\n가\nOzone'), ['입꼬리가 미세하게', 'Ozone', '나지막이']);
});

test('stripPhrases removes phrases case-insensitively and tidies the gap', () => {
    const phrases = parsePhraseList('나지막이\n입꼬리가 미세하게\nozone');
    assert.equal(stripPhrases('그는 나지막이 웃었다. 입꼬리가\n미세하게 올라갔다.', phrases), '그는 웃었다. 올라갔다.');
    assert.equal(stripPhrases('The smell of OZONE , again.', phrases), 'The smell of, again.');
    assert.equal(stripPhrases('아무 일도 없었다.', phrases), '아무 일도 없었다.');
    assert.equal(hasPhrase('그는 나지막이 말했다', phrases), true);
    assert.equal(hasPhrase('그는 말했다', phrases), false);
    assert.equal(stripPhrases('a+b (c) 그대로', parsePhraseList('a+b (c)')), '그대로');
});

test('findRepeatedPhrases counts by reply, prefers the longer phrase and skips names', () => {
    const base = ['아리아는 창밖을 보았다.', '비가 내리고 있었다.', '그녀는 찻잔을 들었다.', '문이 열렸다.', '바람이 불었다.', '시계가 울렸다.'];
    const replies = base.map((b, i) => i < 4 ? `${b} 아리아는 입꼬리가 미세하게 ${i < 2 ? '올라갔다' : '떨렸다'}. ${["또", "문득", "곧", "이내"][i]} 입꼬리가 미세하게 움직였다${i}.` : `${b} 아리아는 조용히 앉았다.`);
    const found = findRepeatedPhrases(replies, { names: ['아리아'] });
    const top = found[0];
    assert.equal(top.phrase, '입꼬리가 미세하게');
    assert.equal(top.count, 4);
    assert.equal(top.total, 6);
    assert.ok(!found.some(f => f.phrase === '입꼬리가'), 'sub-phrase is subsumed');
    assert.ok(!found.some(f => /^아리아는?$/.test(f.phrase)), 'names are skipped');
    assert.deepEqual(findRepeatedPhrases(['하나', '둘']), []);
});

const DEFAULTS = { enabled: true, tokenBudget: 8000, topK: 10, autoHide: false, preserveRecent: 6, profileId: '',
    customApi: { key: '' }, embedApi: { mode: 'off' }, prompts: { archivist: 'p' }, bundles: {}, bundleByOwner: {}, activeBundle: '', bundleBase: null };
const fresh = () => JSON.parse(JSON.stringify(DEFAULTS));

test('bundles never carry switches, secrets, embeddings or prompts', () => {
    const s = fresh();
    s.customApi.key = 'sk-secret';
    const values = pickBundleValues(s, DEFAULTS);
    assert.deepEqual(Object.keys(values).sort(), ['autoHide', 'preserveRecent', 'profileId', 'tokenBudget', 'topK']);
    assert.ok(!JSON.stringify(values).includes('sk-secret'));
    assert.ok(!bundleKeys(DEFAULTS).includes('enabled'));
});

test('switching bundles swaps live values, keeps base settings intact and saves edits into the active bundle', () => {
    const s = fresh();
    s.autoHide = true; s.preserveRecent = 60;
    assert.equal(saveBundle(s, '  시뮬봇 ', DEFAULTS), '시뮬봇');
    s.autoHide = false; s.preserveRecent = 6;             // 기본 설정으로 되돌림

    assert.equal(switchBundle(s, '시뮬봇', DEFAULTS), true);
    assert.equal(s.preserveRecent, 60);
    assert.equal(s.activeBundle, '시뮬봇');
    s.tokenBudget = 12000;                                 // 세트가 적용된 동안 바꾼 값

    assert.equal(switchBundle(s, '', DEFAULTS), true);
    assert.equal(s.tokenBudget, 8000, 'base settings untouched');
    assert.equal(s.preserveRecent, 6);
    assert.equal(s.bundles['시뮬봇'].tokenBudget, 12000, 'edit saved into the bundle');
    assert.equal(s.bundleBase, null);

    assert.equal(switchBundle(s, '', DEFAULTS), false);
    assert.equal(switchBundle(s, '없는 세트', DEFAULTS), false);
});

test('bundle resolution: chat binding wins over character binding, unknown names fall through', () => {
    const s = fresh();
    saveBundle(s, 'A', DEFAULTS); saveBundle(s, 'B', DEFAULTS);
    s.bundleByOwner = { 'char:aria.png': 'B' };
    assert.equal(resolveBundleName(s, { chatBundle: 'A', ownerKey: 'char:aria.png' }), 'A');
    assert.equal(resolveBundleName(s, { chatBundle: '지워진 세트', ownerKey: 'char:aria.png' }), 'B');
    assert.equal(resolveBundleName(s, { chatBundle: '', ownerKey: 'char:other.png' }), '');
});

test('rename follows character bindings; delete restores base settings and clears bindings', () => {
    const s = fresh();
    s.topK = 20; saveBundle(s, '1인봇', DEFAULTS); s.topK = 10;
    s.bundleByOwner = { 'char:a.png': '1인봇' };
    switchBundle(s, '1인봇', DEFAULTS);
    assert.equal(renameBundle(s, '1인봇', '일대일'), '일대일');
    assert.equal(s.activeBundle, '일대일');
    assert.equal(s.bundleByOwner['char:a.png'], '일대일');
    assert.equal(renameBundle(s, '일대일', '일대일'), '');
    assert.equal(deleteBundle(s, '일대일', DEFAULTS), true);
    assert.equal(s.topK, 10);
    assert.equal(s.activeBundle, '');
    assert.deepEqual(s.bundleByOwner, {});
});

test('a bundle deleted behind our back does not strand the base settings', () => {
    const s = fresh();
    s.topK = 20; saveBundle(s, 'X', DEFAULTS); s.topK = 10;
    switchBundle(s, 'X', DEFAULTS);
    delete s.bundles.X;
    switchBundle(s, '', DEFAULTS);
    assert.equal(s.topK, 10);
    assert.equal(s.activeBundle, '');
});

test('bundle files round-trip and reject unknown keys, wrong types and foreign files', () => {
    const s = fresh();
    s.topK = 15; saveBundle(s, '공유', DEFAULTS);
    const parsed = parseBundleFile(exportBundle(s, '공유', DEFAULTS), DEFAULTS);
    assert.equal(parsed.name, '공유');
    assert.equal(parsed.values.topK, 15);
    const hostile = JSON.stringify({ memoriaBundle: 1, name: 'x', values: { topK: 'many', enabled: false, customApi: { key: 'k' }, tokenBudget: 500, evil: 1 } });
    assert.deepEqual(parseBundleFile(hostile, DEFAULTS).values, { tokenBudget: 500 });
    assert.equal(parseBundleFile('{"glossary":[]}', DEFAULTS), null);
    assert.equal(parseBundleFile('not json', DEFAULTS), null);
});

test('stable diff reports changed and added lines, and counts removals', () => {
    const frozen = [{ id: 'a', sec: 'Canon', line: '- a = 1' }, { id: 'b', sec: 'Cast', line: '- B' }];
    const diff = diffStableEntries(frozen, [{ id: 'a', sec: 'Canon', line: '- a = 2' }, { id: 'c', sec: 'Cast', line: '- C' }]);
    assert.deepEqual(diff.changed.map(e => e.id), ['a', 'c']);
    assert.equal(diff.removed, 1);
    assert.deepEqual(diffStableEntries(frozen, frozen), { changed: [], removed: 0 });
});

test('refreeze only when the frozen block can no longer stand in', () => {
    const freeze = { chatId: 'c', key: 'k', level: 1, turn: 10 };
    const same = { chatId: 'c', key: 'k', level: 1, turn: 12, diff: { changed: [], removed: 0 } };
    assert.equal(shouldRefreeze(null, same), 'new');
    assert.equal(shouldRefreeze(freeze, same), '');
    assert.equal(shouldRefreeze(freeze, { ...same, level: 0 }), '', 'a roomier budget alone does not break the cache');
    assert.equal(shouldRefreeze(freeze, { ...same, level: 2 }), 'budget');
    assert.equal(shouldRefreeze(freeze, { ...same, chatId: 'other' }), 'new');
    assert.equal(shouldRefreeze(freeze, { ...same, diff: { changed: [], removed: 1 } }), 'removed');
    assert.equal(shouldRefreeze(freeze, { ...same, diff: { changed: Array(15).fill({}), removed: 0 } }), 'drift');
    assert.equal(shouldRefreeze(freeze, { ...same, turn: 34 }), 'age');
    assert.equal(shouldRefreeze(freeze, { ...same, turn: 500, maxTurns: 0 }), '');
});

test('activity log keeps the newest first, folds repeats and stays bounded', () => {
    const log = createActivityLog(3);
    log.add('recall', 'a', 1); log.add('recall', 'a', 2); log.add('record', 'b', 3); log.add('error', 'c', 4); log.add('recall', 'd', 5);
    assert.deepEqual(log.list().map(r => r.text), ['d', 'c', 'b']);
    const folded = createActivityLog();
    folded.add('recall', 'a', 1); folded.add('recall', 'a', 2);
    assert.equal(folded.list()[0].count, 2);
    assert.equal(folded.size, 1);
});

test('rival memory extensions are detected only when enabled', () => {
    const names = ['third-party/Cairn', 'third-party/SillyTavern-MessageSummarize', 'third-party/ST-memoria', 'memory', 'vectors'];
    assert.deepEqual(findRivalExtensions(names), ['Cairn', 'Qvink Memory (MessageSummarize)']);
    assert.deepEqual(findRivalExtensions(names, ['third-party/Cairn']), ['Qvink Memory (MessageSummarize)']);
});
