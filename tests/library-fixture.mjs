// Fictional data shared by the local preview and library integration tests.
export const libraryCharacters = [
    { name: '아리아', avatar: 'aria.png', chat_size: 3000 },
    { name: '보라', avatar: 'bora.png', chat_size: 3000 },
    { name: '아리아', avatar: 'aria-alternate.png', chat_size: 1000 },
    { name: '아직 시작하지 않은 이야기', avatar: 'unused.png', chat_size: 0 },
    { name: '기록 확인이 필요한 봇', avatar: 'unavailable.png', chat_size: 1000 },
];
export function fictionalArchive(n = 2) {
    return { version: 1, turnCounter: n, turns: [], memories: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, kind: 'event', summary: `등대에서 남긴 가상의 기록 ${i}`, turnIndex: i + 1, mesId: i * 2 + 1, entities: ['아리아'], tags: [], hints: [], visibility: 'public', owner: null, importance: .5 })),
        chunkSummaries: [{ id: 's1', fromTurn: 1, toTurn: n, text: '등대에서 다시 만날 약속을 했다.' }], arcSummaries: [], characters: [], checkpoints: [] };
}
export const libraryGroups = [
    { id: 'crew', name: '새벽 항해단', chat_id: '첫 항해', chats: ['첫 항해', '북쪽 항로'], chat_metadata: { memoria: fictionalArchive(4) }, past_metadata: { '북쪽 항로': { memoria: fictionalArchive(3) } } },
    { id: 'new-crew', name: '숲속의 동행', chat_id: '오두막의 밤', chats: ['오두막의 밤'] },
];
const metadata = (store = fictionalArchive()) => ({ memoria: store });
export const libraryChatFiles = {
    'aria.png': { 'preview-fictional-chat': metadata(), '등대에서 재회 — 오랜 여행을 마치고 돌아온 가을날의 이야기': metadata(fictionalArchive(8)), '빈 서고': metadata({ version: 1, memories: [], turns: [] }), '메모리아 없이 시작한 대화': {} },
    'bora.png': Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`편지 ${i + 1}장`, metadata(fictionalArchive(i + 1))])),
    'aria-alternate.png': { '등대에서 재회': metadata(fictionalArchive(3)) },
};
export async function libraryFixturePost(path, body) {
    if (path === '/api/groups/all') return structuredClone(libraryGroups);
    if (path === '/api/characters/chats') {
        if (body.avatar_url === 'unavailable.png') throw new Error('모의 읽기 오류');
        if (body.avatar_url === 'unused.png') return { error: true };
        return Object.entries(libraryChatFiles[body.avatar_url] || {}).map(([name, data]) => ({ file_name: `${name}.jsonl`, chat_metadata: structuredClone(data), last_mes: '2026-09-19T10:00:00Z' }));
    }
    if (path === '/api/chats/get') {
        const data = libraryChatFiles[body.avatar_url]?.[body.file_name];
        return data ? [{ user_name: '여행자', character_name: '아리아', chat_metadata: structuredClone(data) }, { mes: '가상 대화', send_date: '2026-09-19T10:00:00Z' }] : [];
    }
    if (path === '/api/chats/group/get') {
        if (body.id === '오두막의 밤') return [{ chat_metadata: metadata(fictionalArchive(5)) }, { mes: '새 그룹의 가상 대화' }];
        if (['첫 항해', '북쪽 항로'].includes(body.id)) return [{ mes: '예전 그룹의 가상 대화', is_user: false }];
        return [];
    }
    throw new Error(`Unexpected fixture endpoint: ${path}`);
}
