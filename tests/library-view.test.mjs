import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogEntry, libraryKey } from '../library-engine.mjs';
import { groupLibrary, libraryPage, selectionState, chatLabel, ownerAvatarSources } from '../library-view.mjs';
import { fictionalArchive, largeLibrarySnapshot } from './library-fixture.mjs';

const entry = (ownerId, chatId, n = 1, extra = {}) => catalogEntry({ kind: 'character', ownerId, ownerName: ownerId, chatId, ...extra }, { memoria: fictionalArchive(n) });

test('700 owners and 1000 chats in one owner stay bounded on two independent pages', () => {
    const snapshot = largeLibrarySnapshot();
    const groups = groupLibrary(snapshot.entries, { sort: 'name' });
    assert.equal(groups.length, 700);
    const owners = libraryPage(groups, 0, 8);
    assert.equal(owners.items.length, 8); assert.equal(owners.pages, 88);
    assert.equal(owners.items[0].entries.length, 1000);
    assert.equal(owners.items[1].entries.length, 2);
    const chats = libraryPage(owners.items[0].entries, 0, 10);
    assert.equal(chats.items.length, 10); assert.equal(chats.pages, 100);
    const last = libraryPage(owners.items[0].entries, 99, 10);
    assert.equal(last.items.length, 10); assert.equal(last.items.at(-1).chatId, '이야기 1000');
    const beyond = libraryPage(groups, 999, 8);
    assert.equal(beyond.page, 87); assert.equal(beyond.items.length, 4);
    assert.equal(new Set(groups.map(g => g.key)).size, 700);
});

test('owner ranking uses aggregate record counts and keeps identical names separate', () => {
    const entries = [entry('a', '1', 3, { ownerName: '같은 이름' }), entry('a', '2', 3, { ownerName: '같은 이름' }), entry('b', '1', 5, { ownerName: '같은 이름' })];
    const groups = groupLibrary(entries, { sort: 'memories' });
    assert.equal(groups.length, 2); assert.equal(groups[0].ownerId, 'a'); assert.equal(groups[0].memories, 6);
    assert.equal(groups[0].summaries, 2);
    const filtered = groupLibrary(entries, { query: '2' });
    assert.equal(filtered.length, 1); assert.equal(filtered[0].entries.length, 1);
    assert.equal(filtered[0].entries[0].chatId, '2');
});

test('owner selection reflects all matching pages, supports mixed state and excludes unused archives', () => {
    const entries = Array.from({ length: 32 }, (_, i) => entry('a', `${i}`));
    entries.push(catalogEntry({ kind: 'character', ownerId: 'a', ownerName: 'a', chatId: 'unused' }, {}));
    const selected = new Set([entries[0].key, entries[31].key, libraryKey({ kind: 'character', ownerId: 'other', chatId: '1' })]);
    const partial = selectionState(entries, selected);
    assert.equal(partial.keys.length, 32); assert.equal(partial.count, 2); assert.equal(partial.mixed, true); assert.equal(partial.checked, false);
    for (const key of partial.keys) selected.add(key);
    assert.equal(selectionState(entries, selected).checked, true);
    assert.equal(selectionState([], selected).checked, false);
    // Filtering changes the scope without erasing selections in another bot or on another page.
    const narrowed = groupLibrary(entries, { query: '31' });
    assert.equal(selectionState(narrowed[0].entries, selected).keys.length, 1); assert.equal(selected.size, 33);
});

test('only machine-generated chat titles are shortened and original identifiers never change', () => {
    const row = entry('태경.png', '서태경 - 2026-09-21@04h40m19s109ms', 1, { ownerName: '서태경' });
    const before = JSON.stringify(row);
    assert.equal(chatLabel(row), '2026.09.21 · 04:40'); assert.equal(JSON.stringify(row), before);
    for (const name of ['서태경과 재회', '다른 봇 - 2026-09-21@04h40m19s109ms', '서태경 - 2026-09-21@04h40m19s109ms 새로운 분기']) {
        assert.equal(chatLabel({ ...row, chatId: name }), name);
    }
});

test('avatars use the live host thumbnail helper, encoded filenames and group member portraits', () => {
    const owner = { kind: 'character', ownerId: '이름 #1&.png' };
    const calls = [];
    assert.deepEqual(ownerAvatarSources(owner, { getThumbnailUrl: (...args) => { calls.push(args); return '/current-thumbnail'; } }), ['/current-thumbnail']);
    assert.deepEqual(calls, [['avatar', '이름 #1&.png']]);
    assert.deepEqual(ownerAvatarSources(owner, {}), [`/thumbnail?type=avatar&file=${encodeURIComponent(owner.ownerId)}`]);
    const group = { kind: 'group', ownerId: 'g' };
    const context = { groups: [{ id: 'g', members: ['a.png', 'missing.png', 'b.png', 'a.png'] }], characters: [{ avatar: 'a.png' }, { avatar: 'b.png' }] };
    assert.equal(ownerAvatarSources(group, context).length, 2);
    context.groups[0].avatar_url = '/user/images/group picture.png';
    assert.deepEqual(ownerAvatarSources(group, context), ['/user/images/group picture.png']);
    assert.deepEqual(ownerAvatarSources({ kind: 'group', ownerId: 'deleted' }, context), []);
});
