// Browser fixture only. All content is fictional; no model requests or user data.
import { libraryCharacters, libraryGroups, largeLibraryCharacters, largeLibrarySnapshot } from './library-fixture.mjs';
const largeLibrary = new URLSearchParams(location.search).get('library') === 'large';
export const chat = [];
export const name1 = '여행자';
export const name2 = '아리아';
export const selected_group = null;
export const characters = largeLibrary ? largeLibraryCharacters : libraryCharacters;
export const extension_settings = {};
export const power_user = {};
export const oai_settings = {};
export const extension_prompt_types = { IN_CHAT: 1, BEFORE_PROMPT: 0, IN_PROMPT: 2 };
export const extension_prompt_roles = { SYSTEM: 0 };
export const event_types = new Proxy({}, { get: (_, key) => key });
export const eventSource = { on() {} };
export const getCurrentChatId = () => 'preview-fictional-chat';
export const saveSettingsDebounced = () => {};
export const saveMetadataDebounced = () => {};
export const getRequestHeaders = () => ({});
export const getSortedEntries = async () => [];
export const getTokenCountAsync = async text => Math.ceil(text.length / 3);
export const getStringHash = (str, seed = 0) => [...String(str)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, seed);
export const uuidv4 = () => crypto.randomUUID();
export const setExtensionPrompt = () => {};
export const hideChatMessageRange = async () => {};
export const getFileText = file => file.text();
export const download = (content, filename, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type })); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
};
export const SlashCommandParser = { addCommandObject() {} };
export const SlashCommand = { fromProps: x => x };
export const SlashCommandArgument = { fromProps: x => x };
export const ARGUMENT_TYPE = { STRING: 'string' };
export const MacrosParser = { registerMacro() {} };
export const generateRaw = async () => JSON.stringify({ merge: [{ keep: 'm1', absorb: ['m2'], summary: '아리아는 등대에서 건넨 은빛 반지를 재회의 약속으로 간직한다.' }], drop: ['m3'], reweight: [{ id: 'm4', importance: 0.8 }] });

const subjects = ['등대의 은빛 반지', '등대에서 맺은 약속', '항구에서 나눈 인사', '지도에 표시한 길', '서쪽 숲의 오두막', '보라에게 보낸 편지', '닫힌 북문', '도서관에서 얻은 열쇠', '새벽 기차표', '여행자의 잃어버린 노트', '정원의 오래된 우물', '낡은 청동 나침반', '마을 축제', '먼 도시의 소식', '일출', '새로운 여정', '산장', '다시 찾은 등대'];
for (let i = 0; i < 18; i++) {
    chat.push({ is_user: true, mes: i === 17 ? '아리아, 등대에서 받은 은빛 반지 기억나?' : `아리아, ${subjects[i]} 이야기를 해줘.`, name: name1 });
    chat.push({ is_user: false, mes: `아리아는 ${subjects[i]}에 관해 이야기했다. "다시 돌아오겠다고 약속했잖아요." 여행의 기록에 남길 만한 순간이었다.`, name: name2 });
}
const places = ['항구', '항구', '등대', '등대', '서쪽 숲', '서쪽 숲', '북문', '도서관', '기차역', '등대', '정원', '정원', '마을 광장', '마을 광장', '해안', '해안', '산장', '등대'];
const weights = [0.5, 0.9, 0.4, 0.3, 0.6, 0.8, 0.3, 0.7, 0.4, 0.35, 0.5, 0.3, 0.6, 0.45, 0.85, 0.5, 0.4, 0.95];
for (let i = 0; i < 18; i += 3) chat[i * 2 + 1].mes = `[ ${i % 2 ? '오후 8:15' : '오전 7:30'} · ${Math.floor(i / 6) + 1}일째 · ${places[i]} · ${i % 2 ? '눈발, -1°C' : '맑음, 4°C'} ]\n\n${chat[i * 2 + 1].mes}`;
const turns = subjects.map((s, i) => ({ id: `turn${i}`, mesId: i * 2 + 1, turnIndex: i + 1, mesHash: getStringHash(chat[i * 2 + 1].mes) >>> 0, summary: `아리아와 여행자는 ${s}에 관해 대화했다.`, elapsedDays: 0.1,
    importance: weights[i], when: `${Math.floor(i / 6) + 1}일째 ${['아침', '낮', '저녁', '밤', '새벽', '오후'][i % 6]}`, where: places[i] }));
const memories = subjects.map((s, i) => ({ id: `memory${i}`, kind: i % 2 ? 'promise' : 'event', summary: `아리아와 여행자는 ${s}을 기억한다.`, mesId: i * 2 + 1, turnIndex: i + 1,
    entities: i % 5 === 0 ? [name2, name1, '보라'] : i % 3 === 0 ? [name2, '선장'] : [name2, name1], tags: i < 2 ? ['은빛반지', '재회'] : [`여행${i}`], hints: [], visibility: 'public', owner: null, importance: weights[i], pinned: false }));
memories.push({ id: 'private-memory', kind: 'secret', summary: '아리아만 편지의 발신인이 보라라는 사실을 안다.', mesId: 11, turnIndex: 6, entities: [name2], tags: ['편지'], visibility: 'secret', owner: name2, pinned: true, importance: 0.8 });
memories.push({ id: 'player-memory', kind: 'impression', summary: '여행자는 돌아갈 고향을 그리워하면서도 아리아에게 말하지 않았다.', mesId: 11, turnIndex: 6, entities: [name1], tags: ['고향'], visibility: 'private', owner: name1, pinned: true, importance: 0.8 });
memories.push({ id: 'bora-memory', kind: 'secret', summary: '보라만 등대 창고의 열쇠가 어디에 있는지 안다.', mesId: 13, turnIndex: 7, entities: ['보라'], tags: ['열쇠'], visibility: 'secret', owner: '보라', pinned: true, importance: 0.8 });
export const chat_metadata = { memoria: { version: 1, lexiconRev: 5, turnCounter: 18, turns, memories,
    characters: [{ id: 'aria', name: name2, aliases: ['Aria'], role: '등대지기', traits: ['과묵함'], relationships: [{ target: '보라', relation: '옛 동료' }], firstTurn: 1, updatedTurn: 18,
        core: '말수가 적고 약속을 무겁게 여긴다 · 먼저 다가가지 않지만 한번 받아들인 사람은 끝까지 챙긴다 · 거짓말은 하지 않고, 대신 침묵한다',
        voice: '짧은 존댓말, "~잖아요"로 끝맺는 버릇',
        growth: [{ text: '반지를 받은 뒤로 여행자 앞에서는 떠날 날짜를 먼저 묻는다', turn: 8 }],
        lines: [{ text: '다시 돌아오겠다고 약속했잖아요.', turn: 2 }] }, { id: 'bora', name: '보라', aliases: [], traits: [], relationships: [], firstTurn: 6, updatedTurn: 6 }],
    worldRules: [{ id: 'rule', scope: 'world', key: 'lighthouse', value: '등대는 여행자들의 귀환을 알린다.', turnIndex: 1 }],
    entityStates: [{ id: 'place', entity: 'scene', slot: 'location', value: '해안의 등대', turnIndex: 18 }],
    locks: [{ id: 'pledge', kind: 'keep_unresolved', summary: '여행자는 보라에게 편지를 전하기로 약속했다.', status: 'active', priority: 1, turnIndex: 10 }],
    pivots: [
        { id: 'pv1', way: 'closer', who: name2, with: name1, was: '경계', now: '마지못한 신뢰', why: '창고 열쇠를 맡겼다', turn: 8 },
        { id: 'pv2', way: 'heart', who: name2, with: name1, was: '마지못한 신뢰', now: '떠나보내기 싫음', why: '반지를 받고 한참 말이 없었다', turn: 16 },
        { id: 'pv3', way: 'apart', who: name2, with: '보라', was: '동료', now: '멀어진 사이', why: '편지를 뜯지 않았다', turn: 6 },
        { id: 'pv4', way: 'lot', who: name1, was: '떠돌이', now: '등대에 머무는 손님', why: '새벽 기차를 타지 않았다', turn: 12 }],
    tieRev: 1,
    bonds: [{ id: 'bond1', from: name2, to: name1, manual: false, disabled: false, types: [{ group: 'affection', type: 'pining' }, { group: 'debt', type: 'benefactor' }], word: '말없이 곁을 지킴', tieTurn: 16, log: [
        { turn: 1, stage: '경계하는 낯선 손님', basis: '등대 문을 반만 열고 이름을 물었다', calls: '손님', unsaid: '' },
        { turn: 8, stage: '마지못한 신뢰', basis: '창고 열쇠를 맡겼다', calls: '여행자 씨, 존댓말', unsaid: '' },
        { turn: 16, stage: '떠나보내기 싫은 사람', basis: '반지를 받고 한참 말이 없었다', calls: '여행자 씨, 존댓말', unsaid: '가지 말라는 말' }] },
        { id: 'bond2', from: name1, to: name2, manual: false, disabled: false, types: [{ group: 'affection', type: 'flirt' }], word: '돌아오고 싶은 곳', log: [{ turn: 2, stage: '호기심', basis: '등대에 다시 찾아갔다', calls: '아리아 씨', unsaid: '' }, { turn: 16, stage: '돌아오고 싶은 곳', basis: '반지를 건넸다', calls: '아리아', unsaid: '' }] },
        { id: 'bond3', from: name2, to: '보라', manual: false, disabled: false, types: [{ group: 'work', type: 'colleague' }], word: '멀어진 옛 동료', log: [{ turn: 6, stage: '멀어진 옛 동료', basis: '편지를 뜯지 않고 서랍에 넣었다', calls: '보라', unsaid: '왜 떠났는지' }] },
        { id: 'bond4', from: '보라', to: name1, manual: false, disabled: false, types: [{ group: 'conflict', type: 'wary' }], log: [{ turn: 12, stage: '경계', basis: '이름을 묻지 않았다', calls: '', unsaid: '' }] }],
    chunkSummaries: [{ id: 'chapter', fromTurn: 1, toTurn: 8, text: '여행자는 아리아를 만나 함께 해안을 걸었다. 등대에서 반지를 건네며 돌아오겠다고 약속했다.' },
        { id: 'chapter2', fromTurn: 9, toTurn: 16, text: 'WHEN: 2일째 낮 ~ 3일째 새벽 · 기차역, 정원, 해안\nPLOT:\n- 여행자가 새벽 기차표를 끊었지만 타지 않았다.\n- 아리아가 정원 우물에서 낡은 나침반을 건져 건넸다. "길 잃지 말라고요."\n- 해안에서 일출을 보며 여행자가 은빛 반지를 건넸다.\nSHIFTS: 아리아 → 여행자: 떠나보내기 싫은 사람 · 나침반은 여행자에게\nOPEN: 보라에게 전할 편지 · 닫힌 북문 너머' }],
    arcSummaries: [], milestones: [{ id: 'ms1', title: '등대의 약속', summary: '돌아오겠다고 약속했다', participants: [name2, name1], grade: 'major', turnIndex: 2 }, { id: 'ms2', title: '은빛 반지', summary: '해안에서 반지를 건넸다', participants: [name2, name1], grade: 'major', turnIndex: 15 }], items: [], dossier: [] } };

// ?audit=1 — 검사 탭 화면 확인용: 겹친 요약 · 지난 검사 보고서 · 채점 결과를 깐다
if (new URLSearchParams(location.search).get('audit') === '1') {
    const m = chat_metadata.memoria;
    m.chunkSummaries[1].fromTurn = 7;
    m.audit = {
        driftAt: 30,
        drift: { at: Date.now(), from: 26, to: 34, lastH: 0, checkedIds: [26, 30, 34], checked: 3, every: 5, tokIn: 3200, tokOut: 180, findings: [
            { id: 'f1', no: 30, h: 0, who: name2, kind: 'fact', ok: true, text: '반지를 왼손에 끼었다고 했지만 기록에는 오른손에 끼었다고 되어 있어요.', quote: '왼손 약지에 반지를 끼우며', evidence: '오른손에 반지를 끼었다', src: { kind: 'summary', name: '2일째 낮', from: 17, to: 32 } },
            { id: 'f2', no: 34, h: 0, who: name2, kind: 'address', ok: false, text: '여행자를 반말로 불렀어요.', quote: '너 왜 이제 와', evidence: '', src: null },
        ] },
        grade: { at: Date.now(), sums: ['chapter2'], tokIn: 4100, tokOut: 300, items: [{ sum: 'chapter2', kind: 'wrong', text: '요약에는 여행자가 기차를 탔다고 되어 있지만 원문에서는 타지 않았어요.', refs: [20, 22] }] },
    };
}

const fixtureStorage = new Map();
if (largeLibrary) fixtureStorage.set('memoria.libraryIndex.v1', JSON.stringify(largeLibrarySnapshot()));
export function getContext() {
    return {
        characters, groups: libraryGroups, characterId: largeLibrary ? -1 : 0,
        getThumbnailUrl: (type, file) => `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`,
        accountStorage: { getItem: key => fixtureStorage.get(key), setItem: (key, value) => fixtureStorage.set(key, value), removeItem: key => fixtureStorage.delete(key) },
        POPUP_TYPE: { CONFIRM: 1, TEXT: 2 }, POPUP_RESULT: { AFFIRMATIVE: 1 }, saveMetadata: async () => {},
        callGenericPopup: async (content, type, value, opts = {}) => new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.className = 'fixture-dialog';
            if (opts.allowVerticalScrolling) dialog.classList.add('vertical_scrolling_dialogue_popup');
            const body = document.createElement('div'); body.className = 'popup-body';
            const pane = document.createElement('div'); pane.className = 'popup-content';
            if (typeof content === 'string') { const text = document.createElement('p'); text.textContent = content; pane.append(text); }
            else $(pane).append(content);
            const actions = document.createElement('footer');
            const ok = document.createElement('button'); ok.textContent = opts.okButton || '닫기';
            ok.onclick = () => { dialog.close(); dialog.remove(); resolve(1); };
            actions.append(ok);
            if (type === 1) { const cancel = document.createElement('button'); cancel.textContent = '취소'; cancel.onclick = () => { dialog.close(); dialog.remove(); resolve(0); }; actions.append(cancel); }
            body.append(pane, actions); dialog.append(body); document.body.append(dialog);
            dialog.addEventListener('cancel', () => { dialog.remove(); resolve(0); });
            dialog.showModal();
        }),
    };
}
