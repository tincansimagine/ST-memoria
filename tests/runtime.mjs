import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as engine from '../archive-engine.mjs';
import * as craft from '../craft-engine.mjs';

export async function runtime() {
    const raw = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const source = raw.replace(/^import\b[\s\S]*?;\r?\n/gm, '').replaceAll('import.meta.url', JSON.stringify(new URL('../index.js', import.meta.url).href));
    let chatId = 'test-chat';
    const prompts = [];
    const fakeElement = new Proxy({ length: 0 }, { get: (obj, key) => key in obj ? obj[key] : () => fakeElement });
    const context = vm.createContext({
        ...engine, ...craft, console, structuredClone, TextEncoder, TextDecoder, Uint8Array, Float32Array, Map, Set,
        btoa, atob, AbortController, URL, setTimeout, clearTimeout,
        chat: [], chat_metadata: {}, extension_settings: {}, name1: '여행자', name2: '아리아', selected_group: null,
        characters: [], power_user: {}, oai_settings: {},
        getStringHash: (str, seed = 0) => [...String(str)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, seed),
        getCurrentChatId: () => chatId, getContext: () => ({}), uuidv4: randomUUID,
        saveMetadataDebounced() {}, saveSettingsDebounced() {}, getRequestHeaders: () => ({}),
        setExtensionPrompt: (...args) => prompts.push(args),
        getTokenCountAsync: async text => Math.ceil(text.length / 3),
        getSortedEntries: async () => [],
        $: () => fakeElement, jQuery() {}, toastr: { success() {}, info() {}, warning() {}, error() {} },
        extension_prompt_types: { IN_CHAT: 1 }, extension_prompt_roles: { SYSTEM: 0 },
    });
    vm.runInContext(source, context, { filename: 'index.js' });
    const api = vm.runInContext(`({ getStore, getSettings, retrieveMemories, buildPacketWithinBudget, buildPacketSections,
        updateInjection, persistStore, authorizedEntities, runConsolidation, removeDerivedForTurn, invalidateTurnByMesId,
        restoreCheckpoint, resetMemory, showMemorySource, mesHashOf, encodeVec, embedText, memoryIndexText,
        currentRecallQuery, renderPacket, runSupervisor, rewritePacketWithLibrarian })`, context);
    return { ...api, context, prompts, run: code => vm.runInContext(code, context), setChat: id => { chatId = id; } };
}

export function memory(id, overrides = {}) {
    return { id, kind: 'event', summary: `오래된 사건 ${id}`, turnIndex: 1, mesId: 1, importance: 0.5,
        entities: [], tags: [], hints: [], visibility: 'public', owner: null, pinned: false, disabled: false, ...overrides };
}
