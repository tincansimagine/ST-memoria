// Browser fixture only. All content is fictional; no model requests or user data.
export const chat = [];
export const name1 = '여행자';
export const name2 = '아리아';
export const selected_group = null;
export const characters = [];
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
export const download = () => {};
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
const turns = subjects.map((s, i) => ({ id: `turn${i}`, mesId: i * 2 + 1, turnIndex: i + 1, mesHash: getStringHash(chat[i * 2 + 1].mes) >>> 0, summary: `아리아와 여행자는 ${s}에 관해 대화했다.`, elapsedDays: 0.1 }));
const memories = subjects.map((s, i) => ({ id: `memory${i}`, kind: i % 2 ? 'promise' : 'event', summary: `아리아와 여행자는 ${s}을 기억한다.`, mesId: i * 2 + 1, turnIndex: i + 1,
    entities: [name2], tags: i < 2 ? ['은빛반지', '재회'] : [`여행${i}`], hints: [], visibility: 'public', owner: null, importance: 0.6, pinned: false }));
memories.push({ id: 'private-memory', kind: 'secret', summary: '아리아만 편지의 발신인이 보라라는 사실을 안다.', mesId: 11, turnIndex: 6, entities: [name2], tags: ['편지'], visibility: 'secret', owner: name2, pinned: true, importance: 0.8 });
export const chat_metadata = { memoria: { version: 1, lexiconRev: 5, turnCounter: 18, turns, memories,
    characters: [{ id: 'aria', name: name2, aliases: ['Aria'], role: '등대지기', traits: [], relationships: [], firstTurn: 1, updatedTurn: 18 }, { id: 'bora', name: '보라', aliases: [], traits: [], relationships: [], firstTurn: 6, updatedTurn: 6 }],
    worldRules: [{ id: 'rule', scope: 'world', key: 'lighthouse', value: '등대는 여행자들의 귀환을 알린다.', turnIndex: 1 }],
    entityStates: [{ id: 'place', entity: 'scene', slot: 'location', value: '해안의 등대', turnIndex: 18 }],
    locks: [{ id: 'pledge', kind: 'keep_unresolved', summary: '여행자는 보라에게 편지를 전하기로 약속했다.', status: 'active', priority: 1, turnIndex: 10 }],
    chunkSummaries: [{ id: 'chapter', fromTurn: 1, toTurn: 8, text: '여행자는 아리아를 만나 함께 해안을 걸었다. 등대에서 반지를 건네며 돌아오겠다고 약속했다.' }],
    arcSummaries: [], milestones: [], items: [], dossier: [] } };

export function getContext() {
    return {
        POPUP_TYPE: { CONFIRM: 1, TEXT: 2 }, POPUP_RESULT: { AFFIRMATIVE: 1 }, saveMetadata: async () => {},
        callGenericPopup: async (content, type, value, opts = {}) => new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.className = 'fixture-dialog';
            if (typeof content === 'string') { const text = document.createElement('p'); text.textContent = content; dialog.append(text); }
            else $(dialog).append(content);
            const actions = document.createElement('footer');
            const ok = document.createElement('button'); ok.textContent = opts.okButton || '닫기';
            ok.onclick = () => { dialog.close(); dialog.remove(); resolve(1); };
            actions.append(ok);
            if (type === 1) { const cancel = document.createElement('button'); cancel.textContent = '취소'; cancel.onclick = () => { dialog.close(); dialog.remove(); resolve(0); }; actions.append(cancel); }
            dialog.append(actions); document.body.append(dialog);
            dialog.addEventListener('cancel', () => { dialog.remove(); resolve(0); });
            dialog.showModal();
        }),
    };
}
