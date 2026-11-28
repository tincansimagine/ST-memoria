// 회상 시험 — 내장 해시 임베딩만으로(임베딩 API 없이) 물음마다 맞는 기억이 몇 등에 오는지 본다. 모델 호출 없음.
//   node tools/recall-bench.mjs            이 저장소
//   node tools/recall-bench.mjs <다른 폴더>  다른 판(예: git worktree)과 견줄 때
//   node tools/recall-bench.mjs . -v        물음마다 1~3등까지
// 한국어 세 묶음: A는 회상을 다듬으며 본 물음, B는 다듬는 데 쓰지 않은 물음, C는 바깥에서 만든 물음(유형별 넷씩).
// 다른 말 세 묶음: D 영어 · E 일본어 · F 중국어 (같은 이야기 틀, 유형별 셋씩), 바깥에서 만든 D2 · E2 · F2 (유형별 넷씩).
// 바깥에서 만든 X1 · X2(요약 언어가 영어인 한국어 · 일본어 채팅 — 회상 단서 있음 / 없음) · T1(번체 중국어) · M1(섞인 말). 모두 직전 장면 없이 / 함께 각각 잰다.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : fileURLToPath(new URL('..', import.meta.url)));
const verbose = process.argv.includes('-v');
const { runtime, memory } = await import(`${root}/tests/runtime.mjs`);

async function run(label, setup, qs, scene) {
    const a = await runtime();
    const store = a.getStore();
    setup(store, memory);
    for (const m of store.memories) m.vec = a.encodeVec(a.embedText(a.memoryIndexText(m)));
    let t1 = 0, t3 = 0, s1 = 0, s3 = 0;
    const byCat = new Map();
    for (const [q, want, cat] of qs) {
        const ids = (await a.retrieveMemories(q, [], '')).selected.map(m => m.id);
        const ids2 = (await a.retrieveMemories(q, [], scene)).selected.map(m => m.id);
        if (ids[0] === want) t1++; if (ids.slice(0, 3).includes(want)) t3++;
        if (ids2[0] === want) s1++; if (ids2.slice(0, 3).includes(want)) s3++;
        if (cat) { const c = byCat.get(cat) || [0, 0, 0]; c[0]++; if (ids[0] === want) c[1]++; if (ids2[0] === want) c[2]++; byCat.set(cat, c); }
        if (verbose) console.log(`  ${q} [${want}] ${ids.slice(0, 3).join(',')} | ${ids2.slice(0, 3).join(',')}`);
    }
    const n = qs.length;
    console.log(`${label}: 장면 없이 1등 ${t1}/${n} · 3등 안 ${t3}/${n} — 장면과 함께 1등 ${s1}/${n} · 3등 안 ${s3}/${n}`);
    if (byCat.size) console.log(`  유형별 1등 (장면 없이 / 함께): ${[...byCat].map(([c, [k, a1, b1]]) => `${c} ${a1}/${k} · ${b1}/${k}`).join(' | ')}`);
}

{ // 묶음 A
    const facts = [
     ['ring', '아리아가 부두에서 여행자에게 은반지를 건넸다', ['아리아'], 5],
     ['compass', '보라가 낡은 나침반을 여행자에게 맡겼다', ['보라'], 8],
     ['scar', '카엘의 왼뺨 흉터는 어린 시절 화재에서 생겼다', ['카엘'], 12],
     ['lighthouse', '아리아는 등대 꼭대기 방에서 혼자 지낸다', ['아리아'], 15],
     ['letter', '미나가 어머니의 편지를 서랍 깊이 숨겼다', ['미나'], 18],
     ['tea', '보라는 쓴 홍차를 싫어하고 꿀을 넣은 우유를 좋아한다', ['보라'], 21],
     ['promise', '여행자는 봄이 오면 아리아와 북쪽 호수에 가기로 약속했다', ['아리아'], 25],
     ['sword', '카엘은 아버지의 검을 전당포에 맡겼다', ['카엘'], 28],
     ['debt', '미나는 상인 조합에 금화 삼십 닢을 빚졌다', ['미나'], 31],
     ['fear', '아리아는 천둥소리를 들으면 숨이 막힌다', ['아리아'], 34],
     ['map', '보라가 숨겨진 수로 지도를 태워 버렸다', ['보라'], 37],
     ['song', '카엘은 술에 취하면 고향 자장가를 흥얼거린다', ['카엘'], 40],
     ['cat', '미나는 검은 고양이 밤톨이를 키운다', ['미나'], 43],
     ['key', '여행자가 등대 창고 열쇠를 가지고 있다', ['여행자'], 46],
     ['fight', '아리아와 보라가 시장에서 크게 다투었다', ['아리아', '보라'], 49],
     ['oath', '카엘이 기사단 앞에서 아리아를 지키겠다고 맹세했다', ['카엘', '아리아'], 52],
     ['poison', '미나가 약초상에게서 독초를 샀다', ['미나'], 55],
     ['boat', '보라는 작은 돛단배 은갈매기호를 가지고 있다', ['보라'], 58],
    ];
    const qs = [
     ['그 반지 아직 끼고 있어?', 'ring'], ['나침반 어디 뒀더라', 'compass'], ['카엘 흉터는 왜 생긴 거야?', 'scar'],
     ['리아는 어디서 지내?', 'lighthouse'], ['미나가 숨긴 편지 말이야', 'letter'], ['보라는 뭘 마시는 걸 좋아해?', 'tea'],
     ['우리 봄에 하기로 한 거 기억나?', 'promise'], ['단장은 아버지 검을 어떻게 했어?', 'sword'], ['미나 빚이 얼마였지?', 'debt'],
     ['천둥 치면 괜찮아?', 'fear'], ['수로 지도는 어떻게 됐어?', 'map'], ['카엘이 부르던 노래', 'song'],
     ['미나네 고양이 이름이 뭐였지?', 'cat'], ['창고 열쇠 누가 갖고 있지?', 'key'], ['둘이 왜 싸웠던 거야?', 'fight'],
     ['기사단 앞에서 한 맹세', 'oath'], ['미나가 약초상에서 뭘 샀다고?', 'poison'], ['보라 배 이름이 뭐였더라', 'boat'],
     ['응', null], ['그래서?', null],
    ];
    const scene = '아리아는 창가에 기대 바다를 바라보았다. 바람이 거세졌다. 여행자는 등대 계단을 올라와 그녀 옆에 섰다. 두 사람은 한동안 말없이 파도를 보았다.';
    await run('A (다듬으며 본 물음)', (store, memory) => {
        store.turnCounter = 120;
        store.characters.push({ id: 'c1', name: '아리아', aliases: ['리아'] }, { id: 'c2', name: '보라', aliases: [] }, { id: 'c3', name: '미나', aliases: [] }, { id: 'c4', name: '카엘', aliases: ['단장'] });
        
        for (const [id, summary, entities, t] of facts) store.memories.push(memory(id, { summary, entities, turnIndex: t, importance: 0.6 }));
        for (let i = 0; i < 30; i++) store.memories.push(memory(`f${i}`, { summary: `아리아와 여행자가 등대 근처를 걸으며 ${['날씨','저녁','바다','바람','시장'][i % 5]} 이야기를 나눴다`, entities: ['아리아', '여행자'], turnIndex: 60 + i * 2, importance: 0.5 }));
    }, qs.filter(([, want]) => want), scene);
}

{ // 묶음 B
    const facts = [
     ['bread', '세린은 매일 아침 빵집에서 호밀빵을 샀다', ['세린'], 4],
     ['umbrella', '도윤이 비 오는 날 여행자에게 우산을 빌려주었다', ['도윤'], 9],
     ['tattoo', '하율의 손목에는 작은 별 문신이 있다', ['하율'], 13],
     ['ship', '마르코는 낡은 범선 바다제비호를 몰고 다닌다', ['마르코'], 17],
     ['study', '여울은 밤마다 도서관에서 고대어를 공부한다', ['여울'], 22],
     ['broke', '세린이 아끼던 찻잔을 실수로 깨뜨렸다', ['세린'], 26],
     ['lost', '도윤은 어릴 적 동생을 숲에서 잃어버렸다', ['도윤'], 30],
     ['run', '하율이 경비병을 피해 지붕 위로 도망쳤다', ['하율'], 35],
     ['cook', '마르코는 선원들에게 생선 수프를 끓여 준다', ['마르코'], 39],
     ['letter2', '여울이 할머니에게 보낼 편지를 몰래 썼다', ['여울'], 44],
     ['quarrel', '세린과 하율이 지도 해석을 두고 언쟁했다', ['세린', '하율'], 48],
     ['sleep', '도윤은 천둥이 치는 밤이면 잠을 못 이룬다', ['도윤'], 52],
     ['dance', '하율은 축제에서 여행자와 춤을 추었다', ['하율'], 57],
     ['sick', '여울이 겨울 내내 열병을 앓았다', ['여울'], 61],
     ['coin', '마르코가 여행자에게 금화 열 닢을 갚았다', ['마르코'], 66],
     ['hide', '세린은 오래된 반지를 상자 속에 감춰 두었다', ['세린'], 70],
     ['cry2', '도윤이 형의 무덤 앞에서 소리 없이 울었다', ['도윤'], 74],
     ['horse', '하율은 흰 말 눈송이를 아낀다', ['하율'], 78],
    ];
    const qs = [
     ['린이 아침마다 뭘 사러 가?', 'bread'], ['도윤 선배가 빌려준 거 뭐였지?', 'umbrella'], ['하율 손목에 있는 거 뭐야?', 'tattoo'],
     ['선장 배 이름이 뭐더라', 'ship'], ['여울이 밤에 뭐 공부하지?', 'study'], ['세린이 깬 게 뭐였지?', 'broke'],
     ['도윤이 잃은 사람이 누구야?', 'lost'], ['하율이 어디로 달아났어?', 'run'], ['마르코가 만드는 요리', 'cook'],
     ['여울이 누구한테 편지 쓴다고 했지?', 'letter2'], ['세린이랑 하율 왜 다퉜어?', 'quarrel'], ['도윤은 천둥 치면 어때?', 'sleep'],
     ['축제 때 누구랑 춤췄더라', 'dance'], ['여울이 아팠던 거 기억나?', 'sick'], ['마르코한테 받을 돈 받았어?', 'coin'],
     ['세린이 숨긴 반지 어디 있어?', 'hide'], ['도윤이 형 무덤에서 울었던 날', 'cry2'], ['하율이 아끼는 말 이름', 'horse'],
    ];
    const scene = '세린은 부두 난간에 기대 바다를 바라보았다. 바람이 차가웠다. 여행자는 그녀 옆에 서서 항구의 불빛을 보았다.';
    await run('B (따로 둔 물음)', (store, memory) => {
        store.turnCounter = 200;
        store.characters.push({ id: 'c1', name: '세린', aliases: ['린'] }, { id: 'c2', name: '도윤', aliases: [] }, { id: 'c3', name: '하율', aliases: [] }, { id: 'c4', name: '마르코', aliases: ['선장'] }, { id: 'c5', name: '여울', aliases: [] });
        store.bonds.push({ id: 'b1', from: '여행자', to: '도윤', log: [{ turn: 3, stage: '믿는 선배', calls: '선배' }], disabled: false });
        for (const [id, summary, entities, t] of facts) store.memories.push(memory(id, { summary, entities, turnIndex: t, importance: 0.6 }));
        for (let i = 0; i < 40; i++) store.memories.push(memory(`f${i}`, { summary: `세린과 여행자가 항구 거리를 걸으며 ${['날씨','저녁','배','바람','시장','하늘','파도','등불'][i % 8]} 이야기를 나눴다`, entities: ['세린', '여행자'], turnIndex: 100 + i * 2, importance: 0.5 }));
    }, qs.filter(([, want]) => want), scene);
}

{ // 묶음 C — 바깥에서 만든 물음 (용언 활용 · 같은 뜻 · 별명 · 호칭 · 한 글자 이름씨 · 꾸밈꼴 · 장면 쏠림 각 넷)
    const facts = [
        ['bake', '소연은 축제 전날 밤 호두파이를 직접 구웠다', ['소연'], 6],
        ['fix', '태오가 고장 난 회중시계를 밤새 직접 고쳤다', ['태오'], 11],
        ['bury', '유진이 오래된 철제 상자를 떡갈나무 아래 묻었다', ['유진'], 16],
        ['freeze', '겨울 한파 때문에 북쪽 강물이 단단히 얼어붙었다', ['태오'], 21],
        ['apology', '소연이 먼저 고개를 숙여 태오에게 사과했다', ['소연', '태오'], 26],
        ['heal', '유진이 다친 레온의 팔에 붕대를 감아 주었다', ['유진', '레온'], 31],
        ['prison', '레온이 반역 누명을 쓰고 지하감옥에 갇혔다', ['레온'], 36],
        ['steal', '소매치기가 시장 골목에서 태오의 지갑을 훔쳤다', ['태오'], 41],
        ['burn', '지안은 어릴 적 벼락을 맞은 뒤 왼손에 화상을 입었다', ['지안'], 45],
        ['sword2', '태오는 새벽마다 뒤뜰에서 목검을 휘두른다', ['태오'], 49],
        ['cloak', '레온은 밤순찰 때 늘 붉은 망토를 두른다', ['레온'], 53],
        ['herb', '유진은 약방 서랍에 말린 라벤더를 모아 둔다', ['유진'], 57],
        ['tower', '태오가 낡은 시계탑 꼭대기에 망원경을 숨겼다', ['태오'], 61],
        ['gun', '레온은 책상 깊숙한 곳에 은빛 권총을 보관한다', ['레온'], 65],
        ['flower', '소연이 유리병에 노란 들꽃을 꽂아 두었다', ['소연'], 69],
        ['remedy', '유진이 독에 대비해 해독약을 미리 달여 두었다', ['유진'], 73],
        ['note', '태오가 떠나기 전 책상 위에 짧은 쪽지를 남겨 두었다', ['태오'], 77],
        ['code', '지안이 비밀 금고의 비밀번호를 어젯밤 바꾸었다', ['지안'], 81],
        ['diary', '소연이 지하실 통로 좌표를 수첩에 적어 두었다', ['소연'], 85],
        ['parcel', '유진이 수도에서 온 소포를 여행자에게 보냈다', ['유진'], 89],
        ['snow_oath', '지안은 첫눈이 오면 여행자와 항구 등불을 보러 가기로 맹세했다', ['지안', '여행자'], 18],
        ['piano', '지안은 비가 쏟아지는 밤이면 낡은 피아노를 친다', ['지안'], 24],
        ['clash', '지안과 레온이 항구 창고에서 밀수 장부를 두고 크게 다투었다', ['지안', '레온'], 33],
        ['peach', '지안은 복숭아를 먹으면 온몸에 두드러기가 난다', ['지안'], 39],
    ];
    const qs = [
        ['소연이가 직접 굽던 파이가 뭐였지?', 'bake', '활용'], ['태오가 시계 고쳐 줬어?', 'fix', '활용'], ['유진이 나무 밑에 뭘 묻어 뒀지?', 'bury', '활용'], ['북쪽 강이 완전히 얼었어?', 'freeze', '활용'],
        ['소연이가 태오한테 용서 빌었어?', 'apology', '같은 뜻'], ['레온 팔 치료해 준 사람이 누구야?', 'heal', '같은 뜻'], ['레온 왜 감옥에 잡혀 들어갔어?', 'prison', '같은 뜻'], ['태오 지갑 가져간 도둑 기억나?', 'steal', '같은 뜻'],
        ['안이 왼손 화상은 왜 생겼어?', 'burn', '별명·호칭'], ['사부가 새벽마다 휘두르는 게 뭐야?', 'sword2', '별명·호칭'], ['대장이 순찰 나갈 때 두르는 거 뭐야?', 'cloak', '별명·호칭'], ['누나가 서랍에 모아 두는 게 뭐야?', 'herb', '별명·호칭'],
        ['태오가 탑 위에 둔 게 뭐였지?', 'tower', '한 글자'], ['레온이 가진 총 어디에 있어?', 'gun', '한 글자'], ['소연이가 꽃을 어디에 꽂아 뒀어?', 'flower', '한 글자'], ['유진이 달여 둔 약이 무슨 용도야?', 'remedy', '한 글자'],
        ['태오가 남긴 쪽지 어디에 뒀어?', 'note', '꾸밈꼴'], ['지안이가 바꾼 비밀번호 알아?', 'code', '꾸밈꼴'], ['소연이가 수첩에 적은 게 뭐였지?', 'diary', '꾸밈꼴'], ['유진이 보낸 소포 도착했어?', 'parcel', '꾸밈꼴'],
        ['우리 첫눈 오면 하기로 한 거 기억나?', 'snow_oath', '장면 쏠림'], ['지안이 비 오는 밤에 뭘 쳐?', 'piano', '장면 쏠림'], ['지안이랑 레온 왜 싸웠던 거야?', 'clash', '장면 쏠림'], ['지안이 먹으면 두드러기 나는 게 뭐였지?', 'peach', '장면 쏠림'],
    ];
    const scene = '지안은 온실 유리창 너머로 내리는 비를 바라보았다. 빗소리가 잦아들었다. 여행자는 젖은 외투를 털며 그녀 옆에 앉았다. 두 사람은 말없이 정원을 내다보았다.';
    await run('C (바깥에서 만든 물음)', (store, memory) => {
        store.turnCounter = 220;
        store.characters.push({ id: 'c1', name: '지안', aliases: ['안'] }, { id: 'c2', name: '태오', aliases: ['사부'] }, { id: 'c3', name: '소연', aliases: ['연이'] }, { id: 'c4', name: '레온', aliases: [] }, { id: 'c5', name: '유진', aliases: [] });
        store.bonds.push({ id: 'b1', from: '여행자', to: '레온', log: [{ turn: 4, stage: '믿는 상관', calls: '대장' }], disabled: false }, { id: 'b2', from: '여행자', to: '유진', log: [{ turn: 5, stage: '친한 누나', calls: '누나' }], disabled: false });
        for (const [id, summary, entities, t] of facts) store.memories.push(memory(id, { summary, entities, turnIndex: t, importance: 0.6 }));
        for (let i = 0; i < 30; i++) store.memories.push(memory(`f${i}`, { summary: `지안과 여행자가 온실 정원을 거닐며 ${['빗소리', '차향', '계절', '구름', '화분', '오후'][i % 6]} 이야기를 나눴다`, entities: ['지안', '여행자'], turnIndex: 110 + i * 2, importance: 0.5 }));
    }, qs, scene);
}

// 다른 말 — 같은 틀(사실 12 · 평범한 장면 기억 20 · 물음 12)을 영어 · 일본어 · 중국어로. 유형: 그대로 · 활용(바꿔 말함) · 같은 뜻 · 별명/호칭
async function langSet(label, { chars, bonds = [], facts, filler, fillTopics, qs, scene, bare = false }) {
    await run(label, (store, memory) => {
        store.turnCounter = 120;
        store.characters.push(...chars);
        store.bonds.push(...bonds);
        // 다섯째 칸(선택): 기억에 함께 적힌 회상 단서 등 — bare면 빼고 잰다 (단서가 없을 때의 최악)
        for (const [id, summary, entities, t, extra] of facts) store.memories.push(memory(id, { summary, entities, turnIndex: t, importance: 0.6, ...(bare ? {} : (extra || {})) }));
        for (let i = 0; i < 20; i++) store.memories.push(memory(`f${i}`, { summary: filler(fillTopics[i % fillTopics.length]), entities: [chars[0].name], turnIndex: 60 + i * 2, importance: 0.5 }));
    }, qs, scene);
}
await langSet('D (영어)', {
    chars: [{ id: 'c1', name: 'Elena', aliases: ['Lena'] }, { id: 'c2', name: 'Marcus', aliases: [] }, { id: 'c3', name: 'Iris', aliases: [] }, { id: 'c4', name: 'Theo', aliases: ['Teddy'] }],
    bonds: [{ id: 'b1', from: 'Traveler', to: 'Iris', log: [{ turn: 2, stage: 'trusted healer', calls: 'Doc' }], disabled: false }],
    facts: [
        ['bread', 'Elena buys rye bread from the bakery every morning', ['Elena'], 4], ['umbrella', 'Marcus lent the traveler his umbrella on a rainy night', ['Marcus'], 8],
        ['tattoo', 'Iris has a small star tattoo on her wrist', ['Iris'], 12], ['ship', 'Marcus sails an old schooner called the Petrel', ['Marcus'], 16],
        ['study', 'Theo studies ancient runes in the library every night', ['Theo'], 20], ['broke', 'Elena accidentally broke her favorite teacup', ['Elena'], 24],
        ['lost', 'Theo lost his younger brother in the forest as a child', ['Theo'], 28], ['ran', 'Iris escaped the guards by running across the rooftops', ['Iris'], 32],
        ['soup', 'Marcus cooks fish stew for his crew', ['Marcus'], 36], ['quarrel', 'Elena and Iris argued over how to read the map', ['Elena', 'Iris'], 40],
        ['hide', 'Elena hid an old ring inside a wooden box', ['Elena'], 44], ['herb', 'Iris keeps dried lavender in her medicine drawer', ['Iris'], 48],
    ],
    filler: (t) => `Elena and the traveler strolled along the harbor talking about the ${t}`, fillTopics: ['weather', 'evening', 'wind', 'sea', 'market'],
    qs: [
        ['What does Elena buy every morning?', 'bread', '그대로'], ['Does Iris have a tattoo?', 'tattoo', '그대로'], ["What's the name of Marcus's ship?", 'ship', '그대로'],
        ['Who lends me umbrellas when it rains?', 'umbrella', '활용'], ['What is Theo studying at night?', 'study', '활용'], ['What does Marcus cook for the crew?', 'soup', '활용'],
        ['Why did Elena and Iris fight?', 'quarrel', '같은 뜻'], ['What did Elena smash?', 'broke', '같은 뜻'], ['Did Iris flee from the guards?', 'ran', '같은 뜻'],
        ['Where did Lena hide the ring?', 'hide', '별명·호칭'], ['What does Doc keep in her drawer?', 'herb', '별명·호칭'], ['Who did Teddy lose in the forest?', 'lost', '별명·호칭'],
    ],
    scene: 'The harbor wind was cold. Elena leaned on the railing and watched the boats while the traveler stood beside her.',
});
await langSet('E (일본어)', {
    chars: [{ id: 'c1', name: '美奈', aliases: ['ミナ'] }, { id: 'c2', name: '健太', aliases: [] }, { id: 'c3', name: 'アリア', aliases: ['リア'] }, { id: 'c4', name: '蓮', aliases: [] }],
    bonds: [{ id: 'b1', from: '旅人', to: '健太', log: [{ turn: 2, stage: '頼れる先輩', calls: '先輩' }], disabled: false }],
    facts: [
        ['bread', '美奈は毎朝パン屋でライ麦パンを買う', ['美奈'], 4], ['umbrella', '健太は雨の夜に旅人へ傘を貸した', ['健太'], 8],
        ['tattoo', 'アリアの手首には小さな星の刺青がある', ['アリア'], 12], ['ship', '蓮は古い帆船「海燕号」に乗っている', ['蓮'], 16],
        ['study', '健太は毎晩図書館で古代文字を勉強している', ['健太'], 20], ['broke', '美奈はお気に入りのティーカップを割ってしまった', ['美奈'], 24],
        ['lost', '蓮は幼い頃、森で弟とはぐれた', ['蓮'], 28], ['ran', 'アリアは衛兵から逃げて屋根の上を走った', ['アリア'], 32],
        ['soup', '蓮は船員たちに魚のスープを作ってあげる', ['蓮'], 36], ['quarrel', '美奈とアリアは地図の読み方で口論した', ['美奈', 'アリア'], 40],
        ['hide', '美奈は古い指輪を木箱の中に隠した', ['美奈'], 44], ['herb', 'アリアは薬棚に乾燥ラベンダーをしまっている', ['アリア'], 48],
    ],
    filler: (t) => `美奈と旅人は港を歩きながら${t}の話をした`, fillTopics: ['天気', '夕方', '風', '海', '市場'],
    qs: [
        ['美奈は毎朝何を買うの？', 'bread', '그대로'], ['アリアの手首に何がある？', 'tattoo', '그대로'], ['蓮の船の名前は？', 'ship', '그대로'],
        ['健太は夜に何を勉強してる？', 'study', '활용'], ['蓮が作るスープって何の？', 'soup', '활용'], ['蓮が小さい頃はぐれたのは誰？', 'lost', '활용'],
        ['美奈とアリアはなんで喧嘩したの？', 'quarrel', '같은 뜻'], ['美奈が壊したものは？', 'broke', '같은 뜻'], ['アリアは衛兵から逃走したの？', 'ran', '같은 뜻'],
        ['ミナが隠した指輪はどこ？', 'hide', '별명·호칭'], ['先輩が貸してくれたのは何？', 'umbrella', '별명·호칭'], ['リアは薬棚に何をしまってる？', 'herb', '별명·호칭'],
    ],
    scene: '港の風は冷たかった。美奈は手すりにもたれて船を眺め、旅人はその隣に立っていた。',
});
await langSet('F (중국어)', {
    chars: [{ id: 'c1', name: '王芳', aliases: ['芳芳'] }, { id: 'c2', name: '李明', aliases: ['阿明'] }, { id: 'c3', name: '陈默', aliases: [] }, { id: 'c4', name: '林雪', aliases: ['小雪'] }],
    bonds: [{ id: 'b1', from: '旅人', to: '陈默', log: [{ turn: 2, stage: '可靠的师兄', calls: '师兄' }], disabled: false }],
    facts: [
        ['bread', '王芳每天早上都去面包店买黑麦面包', ['王芳'], 4], ['umbrella', '陈默在一个雨夜把伞借给了旅人', ['陈默'], 8],
        ['tattoo', '林雪的手腕上有一个小小的星星纹身', ['林雪'], 12], ['ship', '李明驾驶着一艘名叫海燕号的旧帆船', ['李明'], 16],
        ['study', '陈默每天晚上在图书馆研究古代文字', ['陈默'], 20], ['broke', '王芳不小心打碎了她最喜欢的茶杯', ['王芳'], 24],
        ['lost', '李明小时候在森林里和弟弟走散了', ['李明'], 28], ['ran', '林雪为了躲避卫兵从屋顶上逃走了', ['林雪'], 32],
        ['soup', '李明经常给船员们煮鱼汤', ['李明'], 36], ['quarrel', '王芳和林雪因为怎么看地图吵了一架', ['王芳', '林雪'], 40],
        ['hide', '王芳把一枚旧戒指藏在了木盒里', ['王芳'], 44], ['herb', '林雪在药柜里收着晒干的薰衣草', ['林雪'], 48],
    ],
    filler: (t) => `王芳和旅人沿着港口散步，聊着${t}`, fillTopics: ['天气', '傍晚', '风', '大海', '集市'],
    qs: [
        ['王芳每天早上买什么？', 'bread', '그대로'], ['林雪手腕上有什么？', 'tattoo', '그대로'], ['李明的船叫什么名字？', 'ship', '그대로'],
        ['陈默晚上在研究什么？', 'study', '활용'], ['李明给船员做什么汤？', 'soup', '활용'], ['李明小时候跟谁走散了？', 'lost', '활용'],
        ['王芳和林雪为什么争吵？', 'quarrel', '같은 뜻'], ['王芳摔碎了什么？', 'broke', '같은 뜻'], ['林雪是怎么逃跑的？', 'ran', '같은 뜻'],
        ['芳芳把戒指藏在哪里了？', 'hide', '별명·호칭'], ['师兄借给我的是什么？', 'umbrella', '별명·호칭'], ['小雪在药柜里放了什么？', 'herb', '별명·호칭'],
    ],
    scene: '港口的风很冷。王芳靠在栏杆上看着船，旅人站在她身边。',
});

// 바깥에서 만든 다국어 묶음 — 회상을 다듬는 데 쓰지 않는다 (유형별 넷: 그대로 · 활용 · 같은 뜻 · 별명/호칭)
await langSet('D2 (영어, 바깥에서 만든 물음)', {
    chars: [{ id: 'c1', name: 'Clara', aliases: ['Clary'] }, { id: 'c2', name: 'Gideon', aliases: [] }, { id: 'c3', name: 'Nora', aliases: ['Red'] }, { id: 'c4', name: 'Bram', aliases: [] }],
    bonds: [{ id: 'b1', from: 'Traveler', to: 'Gideon', log: [{ turn: 2, stage: 'stern captain', calls: 'Cap' }], disabled: false }, { id: 'b2', from: 'Traveler', to: 'Nora', log: [{ turn: 3, stage: 'protective sister', calls: 'Sis' }], disabled: false }],
    facts: [
        ['locket', 'Clara wears a brass locket shaped like a crescent moon', ['Clara'], 4], ['map2', 'Gideon keeps a rolled sea map inside his coat pocket', ['Gideon'], 8],
        ['scar2', 'Bram got a burn scar on his shoulder during the mill fire', ['Bram'], 12], ['owl', 'Nora feeds a snowy owl on the bell tower roof', ['Nora'], 16],
        ['forge', 'Bram forged a silver dagger for the winter expedition', ['Bram'], 20], ['oath2', 'Gideon swore to protect the northern gate until dawn', ['Gideon'], 24],
        ['steal2', "A pickpocket stole Clara's brass compass at the square", ['Clara'], 28], ['teach', 'Nora taught the traveler how to brew bitter willow tea', ['Nora'], 32],
        ['apology2', 'Bram finally apologized to Clara after the harsh quarrel', ['Bram', 'Clara'], 36], ['fear2', 'Clara is terrified of deep underground caves', ['Clara'], 40],
        ['poison2', 'Gideon was struck by a venom dart in the canyon', ['Gideon'], 44], ['weep', 'Nora sat by the stone bridge weeping silently in the rain', ['Nora'], 48],
        ['diary2', 'Clara wrote the vault code inside a red leather journal', ['Clara'], 52], ['horse2', 'Gideon rides a black mare named Cinder across the ridge', ['Gideon'], 56],
        ['debt2', 'Nora still owes the tavern keeper forty silver coins', ['Nora'], 60], ['violin', 'Nora plays a cracked wooden violin whenever snow falls', ['Nora'], 64],
    ],
    filler: (t) => `Clara and the traveler walked along the stone wall chatting about the ${t}`, fillTopics: ['clouds', 'lanterns', 'autumn', 'bread', 'river'],
    qs: [
        ['What locket does Clara wear?', 'locket', '그대로'], ['Where does Gideon keep the sea map?', 'map2', '그대로'], ['How did Bram get the burn scar?', 'scar2', '그대로'], ['What bird does Nora feed on the bell tower?', 'owl', '그대로'],
        ['What weapon was Bram forging for the expedition?', 'forge', '활용'], ['What did Gideon swear to guard?', 'oath2', '활용'], ["Who was stealing Clara's compass at the square?", 'steal2', '활용'], ['What tea did Nora teach me to brew?', 'teach', '활용'],
        ['Did Bram ask Clara to forgive him?', 'apology2', '같은 뜻'], ['Why is Clara afraid of underground caves?', 'fear2', '같은 뜻'], ['When was Gideon poisoned in the canyon?', 'poison2', '같은 뜻'], ['Why was Nora crying on the bridge?', 'weep', '같은 뜻'],
        ['Where did Clary write the vault code?', 'diary2', '별명·호칭'], ["What is the name of Cap's black mare?", 'horse2', '별명·호칭'], ['How much does Red owe the tavern keeper?', 'debt2', '별명·호칭'], ['What instrument does Sis play when it snows?', 'violin', '별명·호칭'],
    ],
    scene: 'Cold mist drifted over the courtyard. Clara adjusted her scarf along the stone wall while the traveler walked quietly beside her.',
});
await langSet('E2 (일본어, 바깥에서 만든 물음)', {
    chars: [{ id: 'c1', name: '詩織', aliases: ['しおり'] }, { id: 'c2', name: '拓海', aliases: [] }, { id: 'c3', name: '葵', aliases: [] }, { id: 'c4', name: '蒼真', aliases: ['ソウマ'] }],
    bonds: [{ id: 'b1', from: '旅人', to: '拓海', log: [{ turn: 2, stage: '尊敬する師匠', calls: '先生' }], disabled: false }, { id: 'b2', from: '旅人', to: '葵', log: [{ turn: 3, stage: '頼れる姉貴分', calls: '姉さん' }], disabled: false }],
    facts: [
        ['watch', '詩織は祖父の形見の懐中時計を大切にしている', ['詩織'], 4], ['violin2', '拓海は古い木造の書斎で毎晩バイオリンを弾く', ['拓海'], 8],
        ['scar2', '葵の左肩には幼い頃の火傷の跡が残っている', ['葵'], 12], ['cat2', '蒼真は黒猫のクロに毎朝ミルクをあげている', ['蒼真'], 16],
        ['pie', '詩織は祭りの前夜に胡桃のパイを焼いた', ['詩織'], 20], ['branch', '拓海は嵐の夜に折れた松の枝を片付けた', ['拓海'], 24],
        ['parcel2', '蒼真が王都からの小包を旅人に届けた', ['蒼真'], 28], ['oath2', '葵は初雪の日に岬の灯台で会おうと約束した', ['葵'], 32],
        ['apology2', '蒼真は頭を下げて詩織に謝罪した', ['蒼真', '詩織'], 36], ['betray2', '門番が密告して旅人たちの居場所を裏切った', ['拓海'], 40],
        ['heal2', '葵は負傷した蒼真の腕に包帯を巻いて治療した', ['葵', '蒼真'], 44], ['prison2', '拓海は冤罪で城の地下牢に閉じ込められた', ['拓海'], 48],
        ['key2', '詩織は温室の合鍵を本棚の裏に隠した', ['詩織'], 52], ['map2', '拓海は古い海図を机の引き出しにしまっている', ['拓海'], 56],
        ['tea2', '葵は苦い抹茶より甘い梅酒を好む', ['葵'], 60], ['sword2', '蒼真は夜明けに裏庭で木剣の稽古をする', ['蒼真'], 64],
    ],
    filler: (t) => `詩織と旅人は石畳の通りを歩きながら${t}の話をした`, fillTopics: ['雨音', '季節', '雲', '夕焼け', '鐘の音'],
    qs: [
        ['詩織が大切にしている懐中時計は誰の形見？', 'watch', '그대로'], ['拓海は書斎で何を弾くの？', 'violin2', '그대로'], ['葵の左肩にある跡は何？', 'scar2', '그대로'], ['蒼真が黒猫にあげているものは？', 'cat2', '그대로'],
        ['詩織が祭りの前に焼くパイは何のパイ？', 'pie', '활용'], ['拓海が片付けた枝は嵐でどうなったの？', 'branch', '활용'], ['蒼真が王都から届けてくれたものは？', 'parcel2', '활용'], ['葵と初雪の日にした約束って覚えてる？', 'oath2', '활용'],
        ['蒼真は詩織に許しを乞うたの？', 'apology2', '같은 뜻'], ['旅人の居場所を敵に売った裏切り者は誰？', 'betray2', '같은 뜻'], ['蒼真の怪我の手当をしたのは誰？', 'heal2', '같은 뜻'], ['拓海が監禁されていたのはどこ？', 'prison2', '같은 뜻'],
        ['しおりが温室の鍵を隠した場所は？', 'key2', '별명·호칭'], ['先生が引き出しに入れている海図は？', 'map2', '별명·호칭'], ['姉さんが好きな飲み物は何？', 'tea2', '별명·호칭'], ['ソウマは朝に裏庭で何の稽古をしてる？', 'sword2', '별명·호칭'],
    ],
    scene: '冷たい雨が石畳を濡らしていた。詩織は傘を傾け、旅人と並んで静かに通りを歩いていた。',
});
await langSet('F2 (중국어, 바깥에서 만든 물음)', {
    chars: [{ id: 'c1', name: '苏晴', aliases: ['晴晴'] }, { id: 'c2', name: '周远', aliases: [] }, { id: 'c3', name: '沈墨', aliases: ['阿墨'] }, { id: 'c4', name: '顾安', aliases: [] }],
    bonds: [{ id: 'b1', from: '旅人', to: '周远', log: [{ turn: 2, stage: '敬重的师傅', calls: '师傅' }], disabled: false }, { id: 'b2', from: '旅人', to: '顾安', log: [{ turn: 3, stage: '可靠的上司', calls: '队长' }], disabled: false }],
    facts: [
        ['watch', '苏晴一直戴着外婆留下的银怀表', ['苏晴'], 4], ['flute', '周远每天黄昏都会在屋顶吹竹笛', ['周远'], 8],
        ['scar2', '顾安的右臂上有一道旧箭伤', ['顾安'], 12], ['dog', '沈墨在院子里养了一只叫阿黄的土狗', ['沈墨'], 16],
        ['pie', '苏晴在节日前夜亲手烤了核桃派', ['苏晴'], 20], ['clock', '周远通宵修好了大厅里停摆的座钟', ['周远'], 24],
        ['bury', '沈墨把铜匣子埋在了老槐树下面', ['沈墨'], 28], ['cloak', '顾安在大雪天把红色斗篷借给了旅人', ['顾安'], 32],
        ['apology2', '沈墨低着头向苏晴正式道歉了', ['沈墨', '苏晴'], 36], ['heal2', '苏晴给受伤的顾安缠上了干净的绷带', ['苏晴', '顾安'], 40],
        ['prison2', '周远因为冤案被关进了城南地牢', ['周远'], 44], ['steal2', '扒手在集市巷口偷走了沈墨的钱袋', ['沈墨'], 48],
        ['key2', '苏晴把地窖钥匙藏进了花瓶底下', ['苏晴'], 52], ['sword2', '周远黎明时分总在后院练木剑', ['周远'], 56],
        ['tea2', '沈墨最讨厌苦茶，只喝加蜜的桂花酿', ['沈墨'], 60], ['letter2', '顾安在桌上留了一封给旅人的密信', ['顾安'], 64],
    ],
    filler: (t) => `苏晴和旅人沿着青石街散步，聊着${t}`, fillTopics: ['雨声', '季节', '晚霞', '钟声', '落叶'],
    qs: [
        ['苏晴戴的怀表是谁留下的？', 'watch', '그대로'], ['周远黄昏在屋顶吹什么？', 'flute', '그대로'], ['顾安右臂上的伤是怎么来的？', 'scar2', '그대로'], ['沈墨院子里养的狗叫什么？', 'dog', '그대로'],
        ['苏晴节日前夜烤的是什么派？', 'pie', '활용'], ['周远把大厅的座钟修好了吗？', 'clock', '활용'], ['沈墨在槐树底下埋着什么东西？', 'bury', '활용'], ['下雪那天顾安借了我什么？', 'cloak', '활용'],
        ['沈墨请求苏晴原谅了吗？', 'apology2', '같은 뜻'], ['是谁帮顾安治疗臂伤的？', 'heal2', '같은 뜻'], ['周远为什么进了监狱？', 'prison2', '같은 뜻'], ['小偷在巷口拿走了沈墨什么？', 'steal2', '같은 뜻'],
        ['晴晴把地窖钥匙放哪儿了？', 'key2', '별명·호칭'], ['师傅早上在后院练什么？', 'sword2', '별명·호칭'], ['阿墨喜欢喝什么酒？', 'tea2', '별명·호칭'], ['队长在桌上留了什么信？', 'letter2', '별명·호칭'],
    ],
    scene: '细雨打湿了青石街。苏晴撑着油纸伞，和旅人并肩安静地走着。',
});

// 요약 언어(영어) ≠ 채팅 언어 — 기억 글은 영어, 회상 단서(recall)는 채팅 언어로 적혔다고 본다. "단서 없음"은 그 단서마저 없을 때
const X1 = {
    chars: [{ id: 'c1', name: '서윤', aliases: ['윤'] }, { id: 'c2', name: '지호', aliases: [] }, { id: 'c3', name: '하은', aliases: [] }, { id: 'c4', name: '민재', aliases: ['선배'] }],
    bonds: [{ id: 'b1', from: '여행자', to: '민재', log: [{ turn: 2, stage: 'trusted senior', calls: '선배' }], disabled: false }],
    facts: [
        ['locket', '서윤 dropped a silver locket into the fountain at dusk', ['서윤'], 4, { hints: ['은목걸이', '분수대', '목걸이 어디 갔어?'] }],
        ['key', '지호 hid the greenhouse spare key under a clay pot', ['지호'], 8, { hints: ['온실 열쇠', '화분 밑', '예비 열쇠'] }],
        ['allergy', '하은 breaks out in hives whenever she eats walnuts', ['하은'], 12, { hints: ['호두 알레르기', '두드러기', '못 먹는 음식'] }],
        ['violin', '민재 practiced a broken cello in the empty auditorium', ['민재'], 16, { hints: ['첼로', '강당', '악기 연습'] }],
        ['vow', '서윤 promised to meet the traveler at the clock tower on New Year', ['서윤'], 20, { hints: ['시계탑', '새해 약속', '다시 만나기로'] }],
        ['debt', '지호 owes the bookshop owner fifty silver coins', ['지호'], 24, { hints: ['서점 빚', '은화', '얼마 빌렸지?'] }],
        ['quarrel', '서윤 and 하은 argued fiercely over the missing ledger', ['서윤', '하은'], 28, { hints: ['장부', '크게 싸움', '다툼'] }],
        ['scar', '민재 got a long scar across his palm from a broken lantern', ['민재'], 32, { hints: ['손바닥 흉터', '깨진 등불', '다친 곳'] }],
        ['letter', '하은 burned an unsigned letter in the fireplace', ['하은'], 36, { hints: ['편지 태움', '벽난로', '익명 편지'] }],
        ['cat', '서윤 feeds a stray ginger cat behind the bakery', ['서윤'], 40, { hints: ['길고양이', '치즈냥', '빵집 뒤'] }],
        ['poison', '지호 bought dried nightshade from a traveling peddler', ['지호'], 44, { hints: ['독초', '보부상', '뭘 샀더라'] }],
        ['escape', '민재 fled the manor guards through the cellar tunnel', ['민재'], 48, { hints: ['지하 통로', '도망', '경비병 피함'] }],
    ],
    filler: (t) => `서윤 and the traveler walked along the canal discussing the ${t}`, fillTopics: ['rain', 'clouds', 'evening', 'bridge', 'tea'],
    qs: [
        ['서윤이가 분수대에 빠뜨린 목걸이 기억나?', 'locket', '단서'], ['온실 예비 열쇠 어디 숨겼더라?', 'key', '단서'], ['하은이가 먹으면 두드러기 나는 게 뭐야?', 'allergy', '단서'],
        ['선배가 강당에서 연습하던 악기 뭐였지?', 'violin', '호칭+단서'], ['윤이랑 새해에 시계탑에서 보기로 한 약속', 'vow', '별명+개념'], ['지호가 서점에 빚진 돈 얼마였지?', 'debt', '개념+단서'],
        ['서윤이랑 하은이 왜 싸웠던 거야?', 'quarrel', '개념'], ['민재 손바닥 흉터 왜 생긴 거야?', 'scar', '개념+단서'], ['하은이가 벽난로에서 태운 편지 말이야', 'letter', '개념+단서'],
        ['서윤이가 빵집 뒤에서 챙기는 길고양이', 'cat', '단서'], ['지호가 보부상한테 독초 산 일 기억나?', 'poison', '개념+단서'], ['선배가 경비병 피해 어디로 달아났어?', 'escape', '호칭+개념'],
    ],
    scene: '서윤은 운하 다리 난간에 기대 빗소리를 들었다. 여행자가 우산을 기울여 그녀 옆에 섰다.',
};
await langSet('X1 (한국어 물음 · 영어 기억, 단서 있음)', X1);
await langSet('X1- (한국어 물음 · 영어 기억, 단서 없음)', { ...X1, bare: true });
const X2 = {
    chars: [{ id: 'c1', name: '結衣', aliases: ['ゆい'] }, { id: 'c2', name: '翔', aliases: [] }, { id: 'c3', name: '凛', aliases: [] }, { id: 'c4', name: '悠真', aliases: ['ユウマ'] }],
    bonds: [{ id: 'b1', from: '旅人', to: '悠真', log: [{ turn: 2, stage: 'trusted mentor', calls: '師匠' }], disabled: false }],
    facts: [
        ['compass', '結衣 gifted the traveler an old brass compass at the station', ['結衣'], 4, { hints: ['真鍮の羅針盤', '駅でもらった', 'コンパス'] }],
        ['key', '翔 locked the attic trunk with a rusted iron padlock', ['翔'], 8, { hints: ['屋根裏', '南京錠', '錆びた鍵'] }],
        ['tea', '凛 hates bitter green tea and prefers warm honey milk', ['凛'], 12, { hints: ['蜂蜜ミルク', '苦いお茶', '好きな飲み物'] }],
        ['flute', '悠真 plays a bamboo flute on the shrine steps at dusk', ['悠真'], 16, { hints: ['竹笛', '神社の階段', '夕暮れの音'] }],
        ['vow', '結衣 swore to return to the northern cape before spring', ['結衣'], 20, { hints: ['北の岬', '春までの約束', '戻る誓い'] }],
        ['quarrel', '翔 and 凛 argued fiercely over the stolen map', ['翔', '凛'], 24, { hints: ['地図の口論', '激しく喧嘩'] }],
        ['heal', "凛 bandaged 悠真's bruised ribs after the ambush", ['凛', '悠真'], 28, { hints: ['包帯', '肋骨の手当', '襲撃の怪我'] }],
        ['prison', '翔 was locked in the watchtower cell on false charges', ['翔'], 32, { hints: ['見張り塔の牢', '冤罪で監禁'] }],
        ['cat', '結衣 keeps a white kitten named Yuki in her studio', ['結衣'], 36, { hints: ['白猫ユキ', 'アトリエの子猫'] }],
        ['letter', "凛 hid her brother's farewell letter inside a dictionary", ['凛'], 40, { hints: ['兄の手紙', '辞書の中', '書き置き'] }],
        ['steal', "A thief snatched 結衣's embroidered pouch at the festival", ['結衣'], 44, { hints: ['祭りのスリ', '刺繍の巾着', '盗まれた'] }],
        ['escape', '悠真 escaped the border patrol by crossing the frozen river', ['悠真'], 48, { hints: ['凍った川', '国境警備から逃走'] }],
    ],
    filler: (t) => `結衣 and the traveler strolled along the canal talking about the ${t}`, fillTopics: ['rain', 'wind', 'lanterns', 'clouds', 'autumn'],
    qs: [
        ['結衣が駅でくれた羅針盤どこ？', 'compass', '단서'], ['翔が屋根裏のトランクにかけた南京錠は？', 'key', '단서'], ['凛が好きな甘い飲み物って何？', 'tea', '단서'],
        ['師匠が神社の階段で吹く竹笛のこと覚えてる？', 'flute', '호칭+단서'], ['ゆいと春までに北の岬で交わした約束', 'vow', '별명+개념'], ['翔と凛はどうして喧嘩したの？', 'quarrel', '개념'],
        ['ユウマが襲撃されたとき手当したのは誰？', 'heal', '별명+개념'], ['翔が監禁されていた見張り塔の牢ってどこ？', 'prison', '개념+단서'], ['結衣のアトリエにいる白猫の名前は？', 'cat', '단서'],
        ['凛が辞書に隠した兄の手紙はどこ？', 'letter', '개념+단서'], ['祭りで結衣の巾着を盗んだ泥棒のこと', 'steal', '개념+단서'], ['師匠が凍った川を渡って逃げた時の話', 'escape', '호칭+개념'],
    ],
    scene: '運河に細い雨が降っていた。結衣は橋の手すりに手を置き、旅人と静かに水面を見ていた。',
};
await langSet('X2 (일본어 물음 · 영어 기억, 단서 있음)', X2);
await langSet('X2- (일본어 물음 · 영어 기억, 단서 없음)', { ...X2, bare: true });
await langSet('T1 (번체 중국어)', {
    chars: [{ id: 'c1', name: '林書瑤', aliases: ['瑤瑤'] }, { id: 'c2', name: '陳遠', aliases: [] }, { id: 'c3', name: '許嵐', aliases: ['阿嵐'] }, { id: 'c4', name: '張衡', aliases: [] }],
    bonds: [{ id: 'b1', from: '旅人', to: '張衡', log: [{ turn: 2, stage: '可靠的前輩', calls: '前輩' }], disabled: false }],
    facts: [
        ['lamp', '林書瑤在燈塔頂層點亮了一盞舊銅燈', ['林書瑤'], 4], ['key', '陳遠把鐵門鑰匙藏在書櫃後面的暗格裡', ['陳遠'], 8],
        ['soup', '許嵐冬天總會在廚房煮熱騰騰的麵湯', ['許嵐'], 12], ['sword', '張衡將祖傳的長劍鎖在木箱裡保存', ['張衡'], 16],
        ['vow', '林書瑤發誓明年春天一定要回到海島', ['林書瑤'], 20], ['quarrel', '陳遠和許嵐為了帳本裡的銀兩大吵了一架', ['陳遠', '許嵐'], 24],
        ['heal', '林書瑤替受傷的張衡換了藥並重新包紮', ['林書瑤', '張衡'], 28], ['prison', '陳遠曾被關在城東的地牢裡三天三夜', ['陳遠'], 32],
        ['book', '許嵐每晚都在閣樓裡抄寫古書', ['許嵐'], 36], ['letter', '張衡在鐘錶店留下了一封寫給旅人的密信', ['張衡'], 40],
        ['steal', '小偷在集市橋邊偷走了林書瑤的錢袋', ['林書瑤'], 44], ['escape', '張衡趁著雷雨夜從後窗逃出了莊園', ['張衡'], 48],
    ],
    filler: (t) => `林書瑤和旅人沿著石橋散步，聊著${t}`, fillTopics: ['細雨', '晚風', '茶香', '雲層', '鐘聲'],
    qs: [
        ['林書瑤在燈塔點亮的是什麼燈？', 'lamp', '번체'], ['陈远把铁门钥匙藏在书柜哪里了？', 'key', '간체→번체'], ['許嵐冬天在廚房煮什麼湯？', 'soup', '번체'],
        ['張衡把長劍鎖在哪個箱子裡？', 'sword', '번체'], ['瑤瑤發誓明年春天要去哪裡？', 'vow', '별명'], ['陈远和许岚为什么争吵？', 'quarrel', '간체+개념'],
        ['是誰幫張衡治療傷口的？', 'heal', '개념'], ['陈远曾经被关在哪个监狱里？', 'prison', '간체+개념'], ['阿嵐每晚在閣樓抄寫什麼書？', 'book', '별명'],
        ['前輩在鐘錶店留下的密信是什麼？', 'letter', '호칭'], ['集市橋邊誰偷了林書瑤的錢袋？', 'steal', '번체'], ['前輩是怎麼從莊園逃跑的？', 'escape', '호칭+개념'],
    ],
    scene: '細雨落在石橋上，晚風帶著茶香。林書瑤靠在欄杆旁，旅人安靜地站在她身邊。',
});
await langSet('M1 (섞인 말 — 한국어 · 일본어 속 로마자 이름)', {
    chars: [{ id: 'c1', name: 'Elena', aliases: ['Lena'] }, { id: 'c2', name: 'Marcus', aliases: [] }, { id: 'c3', name: 'Iris', aliases: [] }, { id: 'c4', name: 'Theo', aliases: [] }],
    bonds: [{ id: 'b1', from: '여행자', to: 'Marcus', log: [{ turn: 2, stage: '믿는 선장', calls: 'Cap' }], disabled: false }],
    facts: [
        ['ko_ring', 'Elena가 부두에서 여행자에게 은반지를 건넸다', ['Elena'], 4], ['ko_key', 'Marcus의 외투 안주머니에 등대 창고 열쇠가 들어 있다', ['Marcus'], 8],
        ['ko_tea', 'Iris에게는 뜨거운 꿀우유를 따로 챙겨 준다', ['Iris'], 12], ['ko_map', 'Theo랑 여행자가 지하 수로 지도를 같이 그렸다', ['Theo'], 16],
        ['ko_fight', 'Elena와 Iris가 항구 시장에서 크게 다투었다', ['Elena', 'Iris'], 20], ['ko_vow', 'Marcus가 첫눈이 오면 북쪽 항구로 떠나기로 약속했다', ['Marcus'], 24],
        ['ja_watch', 'Elenaは古い懐中時計を机の引き出しに隠した', ['Elena'], 28], ['ja_scar', 'Marcusの左肩には嵐の夜の火傷の跡がある', ['Marcus'], 32],
        ['ja_herb', 'Irisは薬棚に乾燥ラベンダーをしまっている', ['Iris'], 36], ['ja_violin', 'Theoは雨の夜に屋根裏でバイオリンを弾く', ['Theo'], 40],
        ['ja_heal', 'Irisが負傷したTheoの腕に包帯を巻いた', ['Iris', 'Theo'], 44], ['ja_prison', 'Marcusは濡れ衣で地下牢に閉じ込められた', ['Marcus'], 48],
    ],
    filler: (t) => `Elena가 여행자와 항구를 걸으며 ${t} 이야기를 나눴다`, fillTopics: ['날씨', '바람', '저녁', '파도', '구름'],
    qs: [
        ['Elena가 부두에서 준 반지 기억나?', 'ko_ring', '한+영'], ['Cap 외투 주머니에 있는 창고 열쇠', 'ko_key', '한+호칭'], ['Iris가 좋아하는 꿀우유 말이야', 'ko_tea', '한+영'],
        ['Theo랑 같이 그린 수로 지도 어디 있어?', 'ko_map', '한+영'], ['Lena랑 Iris 왜 싸웠어?', 'ko_fight', '한+별명'], ['Marcus랑 첫눈 오면 하기로 한 약속', 'ko_vow', '한+영'],
        ['Elenaが引き出しに隠した懐中時計は？', 'ja_watch', '일+영'], ['Marcusの左肩の火傷ってどうしたの？', 'ja_scar', '일+영'], ['Irisが薬棚にしまってるラベンダー', 'ja_herb', '일+영'],
        ['Theoは雨の夜に屋根裏で何を弾くの？', 'ja_violin', '일+영'], ['Theoの腕を手当したのは誰？', 'ja_heal', '일+개념'], ['Marcusが監禁された地下牢はどこ？', 'ja_prison', '일+개념'],
    ],
    scene: 'Elena가 난간에 기대 바다를 바라보았다. 바람이 불었고 여행자는 그녀 옆에 섰다.',
});
