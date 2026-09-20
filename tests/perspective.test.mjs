import test from 'node:test';
import assert from 'node:assert/strict';
import { NARRATOR_PERSPECTIVE, archiveSnapshot, validateArchive, archiveChanges } from '../archive-engine.mjs';
import { runtime } from './runtime.mjs';

test('shared novel preference survives old chat defaults, new chats and settings reload', async () => {
    const app = await runtime();
    app.run("setPerspectivePreference('__narrator__', false)");
    app.setChat('older-chat');
    delete app.context.chat_metadata.memoria;
    app.getStore().perspective = '';
    assert.equal(app.run('effectivePerspective()'), NARRATOR_PERSPECTIVE);
    app.setChat('new-chat');
    delete app.context.chat_metadata.memoria;
    assert.equal(app.run('effectivePerspective()'), NARRATOR_PERSPECTIVE);
    const reloaded = await runtime();
    reloaded.context.extension_settings.memoria = structuredClone(app.getSettings());
    assert.equal(reloaded.run('effectivePerspective()'), NARRATOR_PERSPECTIVE);
});

test('local public and named viewpoints do not overwrite the shared novel preference', async () => {
    const app = await runtime();
    app.run("setPerspectivePreference('__narrator__', false)");
    app.run("setPerspectivePreference('__public__', true)");
    assert.equal(app.run('effectivePerspective()'), '__public__');
    assert.equal(app.authorizedEntities().size, 0);
    app.run("setPerspectivePreference('아리아', true)");
    assert.equal(app.run('effectivePerspective()'), '아리아');
    assert.equal(app.getSettings().defaultPerspective, NARRATOR_PERSPECTIVE);
    assert.throws(() => app.run("setPerspectivePreference('아리아', false)"));
    app.run('setPerspectivePreference(getSettings().defaultPerspective, false)');
    assert.equal(app.run('effectivePerspective()'), NARRATOR_PERSPECTIVE);
    app.setChat('another-bot');
    delete app.context.chat_metadata.memoria;
    assert.equal(app.run('effectivePerspective()'), NARRATOR_PERSPECTIVE);
});

test('legacy migration waits for a chat and seeds the account default only once', async () => {
    const app = await runtime();
    app.setChat(null);
    assert.equal(app.run('effectivePerspective()'), '');
    assert.equal(app.getSettings().defaultPerspective, null);
    app.setChat('first-chat');
    app.getStore().perspective = NARRATOR_PERSPECTIVE;
    assert.equal(app.run('effectivePerspective()'), NARRATOR_PERSPECTIVE);
    app.setChat('older-public-chat');
    delete app.context.chat_metadata.memoria;
    app.getStore().perspective = '__public__';
    assert.equal(app.run('effectivePerspective()'), NARRATOR_PERSPECTIVE);
    app.getStore().perspective = '보라';
    assert.equal(app.run('effectivePerspective()'), '보라');
    assert.equal(app.getSettings().defaultPerspective, NARRATOR_PERSPECTIVE);
});

test('local scope round-trips in an archive and scope-only changes are reviewable', async () => {
    const app = await runtime();
    app.run("setPerspectivePreference('__narrator__', false)");
    const before = validateArchive(JSON.parse(archiveSnapshot(app.getStore())));
    app.run("setPerspectivePreference('__narrator__', true)");
    const after = validateArchive(JSON.parse(archiveSnapshot(app.getStore())));
    assert.equal(after.perspectiveScope, 'chat');
    assert.ok(archiveChanges(before, after).some(change => change.id === 'perspectiveScope'));
    assert.throws(() => validateArchive({ ...after, perspectiveScope: 'unknown' }));
});
