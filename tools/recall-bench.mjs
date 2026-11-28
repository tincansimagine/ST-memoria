// 회상 시험 — 내장 해시 임베딩만으로(임베딩 API 없이) 물음마다 맞는 기억이 몇 등에 오는지 본다. 모델 호출 없음.
//   node tools/recall-bench.mjs            이 저장소
//   node tools/recall-bench.mjs <다른 폴더>  다른 판(예: git worktree)과 견줄 때
//   node tools/recall-bench.mjs . -v        물음마다 1~3등까지
// 세 묶음: A는 회상을 다듬으며 본 물음, B는 다듬는 데 쓰지 않은 물음, C는 바깥에서 만든 물음(유형별 넷씩). 모두 직전 장면 없이 / 함께 각각 잰다.
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
