// 장기기억 — 인연과 전환점 (순수 함수: 화면 · 저장소 · 모델에 의존하지 않는다)
//
// - 인연 읽기: 관계선 한 줄(누가 → 누구에게)이 어떤 사이인지 — 무리(애정 · 가족 · 우정 · 일·학교 · 대립 · 위계·맹세 · 은혜·빚 · 비밀·공모 · 그 밖)와 그 안의 갈래를
// 세 개까지 겹쳐(첫 번째가 대표 · 목록에 없으면 제 말로), 그리고 사서가 적고 사람이 고칠 수 있는 짧은 인연 한마디. 방향마다 따로다
// - 전환점: 한 번의 기록에서 무엇이 무엇으로 왜 바뀌었는지를, 움직인 쪽으로 나눈다 — 가까워짐 · 멀어짐 · 뒤집힘 (사이) · 마음 · 처지 · 자람 (한 사람)
// - 지금 사이: 장면에 함께 있는 사람들끼리 가장 최근의 읽기 몇 줄 (장부의 매 턴 바뀌는 구간에 싣는다)
// - 관계도: 이름 상자와 선의 자리 — 선 위에는 인연 한마디, 선의 빛깔은 무리 (그리는 일은 화면이 한다)
// - 옛 꼴: 예전에 저장한 종류(kind) · shifts 줄을 새 꼴로 옮긴다
// 화살표로 이은 두 말 ("A → B") — 두 쪽이 다 있을 때만
const ARROW = /\s*(?:[→⇒➔➜➝➞⟶➡▶►]|[-=–—~]{1,2}>|>>)\s*/;
export function splitArrow(text) {
  const parts = String(text ?? '').split(ARROW).map(x => x.trim().replace(/^["'「『(\[]+|["'」』)\]]+$/g, '')).filter(Boolean);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

const squash = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const BLANK = /^(null|none|n\/a|없음|无|なし|-|—|\?)?$/i;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// ════════ 인연 읽기 ════════
/**
 * 무리 → 그 안의 흔한 갈래. 차례가 곧 화면의 차례다. 이 목록에 없는 사이는 사서 · 사람이 제 말로 적을 수 있다(직접 쓴 갈래 — 가장 가까운 무리, 없으면 그 밖에 둔다)
 */
export const TIE_GROUPS = {
  affection: ['lover', 'spouse', 'engaged', 'flirt', 'pining', 'first_love', 'ex', 'arranged', 'obsession', 'forbidden'],
  family: ['parent_child', 'siblings', 'twins', 'relatives', 'adoptive', 'step_family', 'sworn_siblings'],
  friendship: ['friend', 'best_friend', 'childhood_friend', 'alumni', 'comrade', 'neighbor'],
  work: ['colleague', 'boss', 'senior_junior', 'mentor', 'classmate', 'employer', 'deal', 'commission'],
  conflict: ['rival', 'nemesis', 'enemy', 'wary', 'revenge', 'betrayal'],
  fealty: ['master_servant', 'lord_knight', 'guardian', 'contract', 'loyalty'],
  debt: ['benefactor', 'saved_life', 'indebted'],
  secret: ['accomplice', 'shared_secret', 'using', 'alliance'],
  other: ['companion', 'first_meeting', 'tangled'],
};
export const GROUPS = Object.keys(TIE_GROUPS);
/** 갈래 → 그 무리 */
export const GROUP_OF = Object.fromEntries(GROUPS.flatMap(g => TIE_GROUPS[g].map(t => [t, g])));
/** 한 방향에 겹쳐 적을 수 있는 갈래 수 (첫 번째가 대표) */
export const TYPES_MAX = 3;
/** 한마디의 너비 상한 (한글 · 한자 한 글자 = 2) — 한글로 열두 자쯤 */
export const WORD_UNITS = 24;
/** 직접 쓴 갈래의 너비 상한 — 한글로 열두 자쯤 */
export const OWN_TYPE_UNITS = 24;
/** 갈래 하나: 무리 · 정해 둔 갈래(없으면 무리만) · 직접 쓴 갈래인가(type 이 그 말 그대로다) */
;

/** 갈래 · 무리를 가리키는 말 (정해 둔 낱말 · 화면 이름 · 흔한 다른 말 — 띄어쓰기 · 문장부호는 보지 않는다) */
const TYPE_LABELS = {
  lover: ['연인', '애인', 'lovers', 'couple', 'dating', '恋人', '情侣'], spouse: ['부부', '배우자', '남편', '아내', 'married', 'husband', 'wife', '夫妻', '配偶'],
  engaged: ['약혼', '약혼자', 'fiance', 'fiancee', '订婚', '未婚夫', '未婚妻'], flirt: ['썸', 'flirting', 'situationship', '暧昧'],
  pining: ['짝사랑', '외사랑', 'unrequited', 'one_sided', 'crush', '单恋', '暗恋'], first_love: ['첫사랑', '初恋'], ex: ['옛연인', '전애인', '전연인', 'former_lover', '前任'],
  arranged: ['정략', '정략결혼', 'arranged_marriage', '政治联姻', '包办婚姻'], obsession: ['집착', 'obsessed', '执念', '执着'], forbidden: ['금지된사이', '금단', 'forbidden_love', '禁忌'],
  parent_child: ['부모자식', '부모', '자식', 'parent', 'father', 'mother', 'son', 'daughter', '父母', '亲子'], siblings: ['형제자매', '형제', '자매', '남매', 'sibling', 'brother', 'sister', '兄弟姐妹', '兄弟', '姐妹'],
  twins: ['쌍둥이', 'twin', '双胞胎'], relatives: ['친척', '사촌', 'relative', 'cousin', 'kin', '亲戚'], adoptive: ['양부모양자', '양부모', '양자', '입양', 'adopted', '养父母', '养子'],
  step_family: ['의붓가족', '의붓', '계모', '계부', 'stepfamily', 'stepmother', 'stepfather', 'stepsibling', '继亲', '继母'], sworn_siblings: ['의형제의남매', '의형제', '의남매', '의자매', 'sworn_brothers', '结拜'],
  friend: ['친구', '벗', 'friends', 'buddy', '朋友'], best_friend: ['단짝', '절친', 'bestie', '挚友', '闺蜜', '死党'], childhood_friend: ['소꿉친구', '소꿉', '青梅竹马', '发小'],
  alumni: ['동창', 'alumnus', 'old_classmate', '校友', '老同学'], comrade: ['전우', 'comrade_in_arms', 'brothers_in_arms', '战友'], neighbor: ['이웃', 'neighbour', '邻居'],
  colleague: ['동료', 'coworker', 'teammate', '同事'], boss: ['상사부하', '상사', '부하', 'boss_subordinate', 'superior', 'subordinate', '上司', '下属'],
  senior_junior: ['선후배', '선배', '후배', 'senior', 'junior', '前辈', '后辈', '学长', '学姐'], mentor: ['스승제자', '스승', '제자', 'mentor_student', 'teacher', 'student', 'apprentice', '师徒', '老师', '徒弟'],
  classmate: ['동급생', '같은반', '同学'], employer: ['고용', '고용주', 'employee', 'employment', 'hired', '雇佣', '雇主'], deal: ['거래', 'client', 'business', 'trade', '交易', '客户'],
  commission: ['의뢰', '의뢰인', 'commissioned', '委托', '委托人'],
  rival: ['라이벌', '경쟁자', 'competitor', '对手', '竞争对手'], nemesis: ['숙적', 'archenemy', 'arch_enemy', '宿敌'], enemy: ['원수', '적', 'foe', 'hostile', '仇人', '敌人'],
  wary: ['경계', '의심', 'suspicious', 'distrust', '警惕', '戒备'], revenge: ['복수', '복수대상', 'vengeance', '复仇'], betrayal: ['배신', '배신자', 'betrayed', 'traitor', '背叛'],
  master_servant: ['주종', '주인과하인', 'master', 'servant', '主仆'], lord_knight: ['주군기사', '주군', '기사', 'liege', 'knight', '君臣', '主君'], guardian: ['보호자', '후견인', 'protector', 'caretaker', '监护人', '保护者'],
  contract: ['계약', 'pact', '契约'], loyalty: ['충성', '충신', 'loyal', '忠诚'],
  benefactor: ['은인', '恩人'], saved_life: ['생명의은인', 'life_saver', 'lifesaver', '救命恩人'], indebted: ['빚진사이', 'debtor', '欠债', '欠人情'],
  accomplice: ['공범', 'partner_in_crime', '共犯', '同谋'], shared_secret: ['비밀을나눈사이', '비밀공유', 'secret_keepers', '共享秘密'], using: ['이용', '이용하는사이', 'used', 'exploiting', '利用'],
  alliance: ['협력', '동맹', 'allies', 'ally', 'cooperation', '合作', '同盟'],
  companion: ['동행', '동반자', 'travel_companion', 'fellow_traveler', '同行', '旅伴'], first_meeting: ['첫만남', '처음만남', 'strangers', 'stranger', '初遇', '初次见面'],
  tangled: ['얽힘', '애증', '복잡', 'complicated', 'complex', 'love_hate', '纠葛', '复杂'],
};
const GROUP_LABELS = {
  affection: ['애정', '사랑', '연애', 'love', 'romance', 'romantic', '爱情'], family: ['가족', '혈연', 'kinship', '家人', '家庭'], friendship: ['우정', 'friendship', '友情'],
  work: ['일학교', '일', '학교', '직장', 'school', 'work_school', 'job', '工作', '学校'], conflict: ['대립', '적대', 'hostility', 'opposition', '对立'],
  fealty: ['위계맹세', '위계', '맹세', 'hierarchy', 'oath', '等级', '誓约'], debt: ['은혜빚', '은혜', '빚', 'favor', 'grace', '恩情'],
  secret: ['비밀공모', '비밀', '공모', 'conspiracy', '秘密', '共谋'], other: ['그밖', '기타', 'misc', '其他'],
};
const label = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s·・.,/\\\-_'"`]+/g, '');
const TYPE_BY_LABEL = new Map (), GROUP_BY_LABEL = new Map ();
for (const [t, ls] of Object.entries(TYPE_LABELS)) for (const l of [t, ...ls]) TYPE_BY_LABEL.set(label(l), t);
for (const g of GROUPS) for (const l of [g, ...GROUP_LABELS[g]]) GROUP_BY_LABEL.set(label(l), g);
/** 무리 읽기 (모르는 말이면 undefined) */
export const readGroup = (raw) => GROUP_BY_LABEL.get(label(raw));
/** 정해 둔 갈래 읽기 (모르는 말이면 undefined) */
export const readType = (raw) => TYPE_BY_LABEL.get(label(raw));
/** 옛 종류(kind) → 갈래. 옛 서고와 옛 답을 읽을 때만 쓴다 */
const OLD_KIND = {
  love: { group: 'affection', type: 'lover' }, one_sided: { group: 'affection', type: 'pining' }, family: { group: 'family' }, friendship: { group: 'friendship', type: 'friend' },
  colleague: { group: 'work', type: 'colleague' }, work: { group: 'work', type: 'deal' }, rival: { group: 'conflict', type: 'rival' }, hostile: { group: 'conflict', type: 'enemy' }, complicated: { group: 'other', type: 'tangled' },
};
export function readOldKind(raw) {
  const k = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'), v = OLD_KIND[k];
  return v ? { ...v } : undefined;
}
/**
 * 갈래 하나 읽기 — 정해 둔 갈래 · 그 다른 이름이면 그 갈래(무리는 그 갈래의 무리), 옛 종류 낱말이면 옮긴 갈래, 무리 이름뿐이면 무리만,
 * 그 밖의 말은 직접 쓴 갈래로 그대로 남긴다 (무리는 적힌 무리 → 없으면 그 밖). "affection:pining" · "debt/제 말" 처럼 무리를 앞에 붙인 꼴도 받는다
 */
export function readTieType(raw, groupHint) {
  let text = raw, hint = groupHint;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) { const o = raw; text = o.type ?? o.name ?? o.label ?? o.kind ?? ''; hint = o.group ?? groupHint; }
  let s = squash(text, 80).replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '');
  const split = s.match(/^([^:：/]{1,24})\s*[:：/]\s*(.+)$/);
  if (split && readGroup(split[1])) { hint = split[1]; s = split[2].trim(); }
  else if (split && readType(split[2])) s = split[2].trim(); // 모르는 무리에 아는 갈래 — 갈래가 무리를 정한다
  if (BLANK.test(s) && !readGroup(hint)) return null;
  const t = s && readType(s); if (t) return { group: GROUP_OF[t], type: t };
  const old = s ? readOldKind(s) : undefined; if (old) return old;
  const g = readGroup(s) || readGroup(hint);
  if (!s || BLANK.test(s) || readGroup(s)) return g ? { group: g } : null;
  const own = cleanWord(s, OWN_TYPE_UNITS); if (!own) return g ? { group: g } : null;
  return { group: g || 'other', type: own, custom: true };
}
/** 갈래 목록 읽기 — 목록 · 쉼표로 이은 글 · 객체 무엇이든. 같은 것은 한 번만, TYPES_MAX 개까지 (첫 번째가 대표) */
export function readTieTypes(raw, groupHint) {
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s*[,，、;+]\s*|\s+[&＆]\s+/) : raw ? [raw] : [];
  const out = [];
  for (const it of items) { const r = readTieType(it, groupHint); if (r && !out.some(o => sameType(o, r)) && out.length < TYPES_MAX) out.push(r); }
  return out;
}
export const sameType = (a, b) => a.group === b.group && label(a.type) === label(b.type);

/** 글의 화면 너비 어림 (한글 · 한자 · 가나는 한 글자가 라틴 글자 둘쯤) */
export const textUnits = (s) => { let u = 0; for (const ch of s) u += /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 2 : 1; return u; };
/** 너비에 맞춰 줄인다 (…) */
export function fitText(s, units) {
  if (textUnits(s) <= units) return s;
  let u = 0, out = ''; for (const ch of s) { const w = textUnits(ch); if (u + w > units - 1) break; u += w; out += ch; }
  return out.trimEnd() + '…';
}
/** 말끝을 흐리는 말 — 한마디는 글이 보여 준 대로 단정해 적는다 */
const HEDGE = /[?？]|아마|불확실|불명|모름|미정|일지도|인 ?듯|같음|같다|maybe|perhaps|unclear|uncertain|unknown|possibl|probabl|seem|\btbd\b|\bn\/a\b|不确定|可能|也许|或许|不明|たぶん|かも/i;
/**
 * 한마디 다듬기: 따옴표 · 끝 문장부호를 떼고, 흐린 괄호는 걷어 낸다. 그래도 흐린 말이 남으면 받지 않는다 ('').
 * 너비 상한을 넘으면 낱말 경계에서 자른다 (말줄임표를 붙이지 않는다 — 저장되는 글이다)
 */
export function cleanWord(raw, units = WORD_UNITS) {
  let t = squash(raw, 120).replace(/^["'“”‘’「『《〈]+|["'“”‘’」』》〉]+$/g, '').replace(/[.。,，;；:：!！]+$/, '').trim();
  if (BLANK.test(t)) return '';
  if (HEDGE.test(t)) t = t.replace(/\s*[(（\[][^()（）\[\]]*[)）\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || HEDGE.test(t)) return '';
  if (textUnits(t) <= units) return t;
  const words = t.split(' '); let out = '';
  for (const w of words) { const next = out ? `${out} ${w}` : w; if (textUnits(next) > units) break; out = next; }
  if (!out) { let u = 0; for (const ch of t) { const w = textUnits(ch); if (u + w > units) break; u += w; out += ch; } }
  return out.trim();
}
/** 읽기에 적힌 것이 있는가 */
export const hasRead = (r) => !!r && (!!r.types?.length || !!r.word);
/** 두 읽기가 같은가 (갈래의 차례까지 · 한마디는 띄어쓰기 · 문장부호 차이를 무시한다) */
export const sameRead = (a, b) => (a.types || []).length === (b.types || []).length && (a.types || []).every((x, i) => sameType(x, b.types [i])) && norm(a.word) === norm(b.word);
/** 대표 무리 (첫 갈래의 무리 · 없으면 '') */
export const mainGroup = (r) => r?.types?.[0]?.group || '';

/** 관계선 한 줄의 지금 읽기 — 새 칸이 먼저, 없으면 옛 칸(이름 · 종류)에서 */
export function tieOf(b) {
  if (!b) return {};
  const old = !Array.isArray(b.types) && b.kind ? readOldKind(b.kind) : undefined;
  const types = Array.isArray(b.types) ? readTieTypes(b.types) : old ? [old] : [], word = String(b.word ?? b.name ?? '').trim();
  return { ...(types.length ? { types } : {}), ...(word ? { word } : {}) };
}

// ════════ 전환점 ════════
export const WAYS = ['closer', 'apart', 'flip', 'heart', 'lot', 'grow'];
/** 두 사람 사이가 움직인 쪽 (나머지 셋은 한 사람의 일) */
export const BETWEEN = new Set (['closer', 'apart', 'flip']);
/** 마음의 흐름에 드는 쪽 — 사이가 움직였거나 마음이 바뀌었다 */
export const HEARTFELT = new Set (['closer', 'apart', 'flip', 'heart']);

/** 글이 품은 마음의 결 어림 (-2 ~ 2, 단서가 없으면 0) — 옛 기록의 관계 변화를 가까워짐 · 멀어짐 · 뒤집힘 가운데 하나로 옮길 때만 쓴다 */
const HEAT = [
  [/사랑|연모|애정|열렬|헌신|애틋|그리워|좋아하|반했|설레|설렘|love|ador|devot|cherish|yearn|longing|爱|恋|喜欢|思念/i, 2],
  [/신뢰|믿|친근|친구|우정|단짝|다정|고마|호감|안심|누그러|화해|편안|따뜻|따스|기대|warm|trust|fond|grate|relie|soft|reconcil|friend|ally|allies|at ease|信任|温|亲近|感激/i, 1],
  [/경계|서운|불안|의심|어색|서먹|실망|섭섭|낯설|망설|wary|guard|distant|uneas|suspic|awkward|disappoint|hurt|cool|hesita|疑|冷淡|失望/i, -1],
  [/증오|혐오|원망|분노|배신|적의|경멸|두려|공포|미워|원수|hate|hatred|loath|despis|furious|rage|betray|hostil|contempt|fear|resent|enem|恨|怒|厌|敌/i, -2],
];
export function heatOfText(s) {
  const t = String(s ?? ''); if (!t) return 0;
  let sum = 0, n = 0; for (const [rx, v] of HEAT) if (rx.test(t)) { sum += v; n++; }
  return n ? Math.max(-2, Math.min(2, Math.round(sum / n))) : 0;
}
const WAY_WORDS = [
  ['flip', /^(flip|turn|revers|overturn|뒤집|돌변|반전|翻转|逆转)/i],
  ['closer', /^(closer|close|approach|draw.?near|warm.?up|reconcil|가까워|다가|좁혀|靠近|拉近)/i],
  ['apart', /^(apart|away|distance|drift|estrang|break|split|cool.?off|멀어|틀어|벌어|疏远|远离)/i],
  ['heart', /^(heart|feel|emotion|mood|마음|감정|心意|情感)/i],
  ['lot', /^(lot|circum|situat|status|life|fortune|처지|상황|신변|处境|境况)/i],
  ['grow', /^(grow|develop|matur|self|자람|성장|成长)/i],
];
/**
 * 전환점의 갈래 읽기. 새 낱말(closer …)과 화면 이름(가까워짐 …)을 받고, 옛 갈래는 글로 짐작해 옮긴다 —
 * 상황 → 처지 · 성장 → 자람 · 감정 → 마음, 관계는 바뀌기 전후의 마음의 결을 견주어 가까워짐 · 멀어짐 · 뒤집힘 · 마음 가운데 하나로
 */
export function wayOf(raw, was = '', now = '') {
  const t = String(raw ?? '').trim().toLowerCase();
  if ((WAYS).includes(t)) return t;
  const a = heatOfText(was), b = heatOfText(now), flipped = (a >= 1 && b <= -1) || (a <= -1 && b >= 1);
  if (/^(relationship|relation|bond|tie|관계|사이|关系|関係)/.test(t)) return flipped ? 'flip' : b > a ? 'closer' : b < a ? 'apart' : 'heart';
  if (/^(emotion|feeling|감정|情绪|感情|気持)/.test(t)) return 'heart';
  if (/^(situation|circumstance|상황|状况|状況)/.test(t)) return 'lot';
  if (/^(growth|성장|成長)/.test(t)) return 'grow';
  for (const [w, rx] of WAY_WORDS) if (rx.test(t)) return w;
  return 'heart';
}
/** 사서 · 되짚기가 적은 전환점 한 줄 (정제한 것) */
const one = (v) => (Array.isArray(v) ? v.find(x => typeof x === 'string' && x.trim()) : v);
/**
 * 전환점 한 줄을 정제한다 — 새 칸(way · with · was · now · because)과 옛 칸(kind · toward · from · to · why)을 다 읽는다.
 * 누가 · 무엇으로 바뀌었는지가 없거나, 바뀌기 전과 뒤가 같으면 받지 않는다 (null)
 */
export function cleanPivot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw, na = (v, n) => { const t = squash(one(v), n); return BLANK.test(t) ? '' : t; };
  let who = na(r.who, 60), other = na(r.with ?? r.toward, 60), was = na(r.was ?? r.from, 90), now = na(r.now ?? r.to, 90);
  if (!other) { const p = splitArrow(who); if (p) { who = p[0]; other = p[1]; } }
  if (!was) { const p = splitArrow(now); if (p) { was = p[0]; now = p[1]; } }
  if (!who || !now || norm(was) === norm(now)) return null;
  return { way: wayOf(r.way ?? r.kind, was, now), who, with: other, was, now, why: na(r.because ?? r.why, 180) };
}
const grams = (s) => { const g = new Set (); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
/** 두 글이 사실상 같은 말인가 (띄어쓰기 · 문장부호 · 조사 조금 차이는 같은 것으로) */
export function sameText(a, b) {
  const x = norm(a), y = norm(b); if (!x || !y) return x === y; if (x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)))) return true;
  const ga = grams(x), gb = grams(y); if (ga.size < 3 || gb.size < 3) return false;
  let hit = 0; for (const g of ga) if (gb.has(g)) hit++;
  return hit / Math.min(ga.size, gb.size) >= 0.75;
}
/** 같은 전환점을 두 번 적은 것인가 — 같은 사람 · 같은 상대이고 "무엇으로"가 같은 말이다 (사이 · 마음 쪽끼리는 갈래가 달라도 같은 일로 본다). key: 이름을 견줄 열쇠 */
export function samePivot(a, b, key = norm) {
  const fam = (w) => (HEARTFELT.has(w) ? 'heart' : w);
  return fam(a.way) === fam(b.way) && key(a.who) === key(b.who) && key(a.with || '') === key(b.with || '') && sameText(a.now, b.now);
}

// ════════ 옛 꼴 옮기기 ════════
/** 관계선 한 줄의 옛 칸(이름 · 종류 · 그 이력)을 새 칸으로 옮긴다. 반환: 옮긴 것이 있는가 */
export function liftBond(b) {
  if (!b || !('name' in b || 'kind' in b || 'nameTurn' in b || 'nameMsgId' in b || 'nameManual' in b || 'nameWas' in b)) return false;
  const has = b.types != null || b.word != null, old = readOldKind(b.kind), name = String(b.name ?? '').trim();
  if (!has) {
    if (old) b.types = [old]; if (name) b.word = name;
    if (typeof b.nameTurn === 'number') b.tieTurn = b.nameTurn; if (b.nameMsgId) b.tieMsgId = b.nameMsgId; if (b.nameManual) b.tieHand = true;
    const w = b.nameWas;
    if (w && (w.name || w.kind)) { const wo = readOldKind(w.kind); b.tieWas = { ...(wo ? { types: [wo] } : {}), ...(w.name ? { word: w.name } : {}), ...(w.turn != null ? { turn: w.turn } : {}), ...(w.msgId ? { msgId: w.msgId } : {}) }; }
  }
  for (const k of ['name', 'kind', 'nameTurn', 'nameMsgId', 'nameManual', 'nameWas']) delete b[k];
  return true;
}
/** 옛 shifts 한 줄 → 전환점 (누가 · 무엇으로가 없으면 null) */
export function liftShift(s) {
  if (!s || typeof s !== 'object' || typeof s.who !== 'string' || typeof s.to !== 'string' || !Number.isFinite(s.turn)) return null;
  const out = { id: s.id, way: wayOf(s.kind, s.from, s.to), who: s.who, now: s.to, turn: s.turn };
  if (s.toward) out.with = s.toward; if (s.from) out.was = s.from; if (s.why) out.why = s.why;
  for (const k of ['msgId', 'span', 'scan', 'manual']) if (s[k] != null) out[k] = s[k];
  return out;
}
/** 서고 하나를 새 꼴로 (관계선의 옛 칸 · 옛 shifts). 반환: 고친 것이 있는가 — 저장은 부르는 쪽이 한다 */
export function liftMem(mem) {
  let changed = false;
  for (const b of (Array.isArray(mem.bonds) ? mem.bonds : [])) if (liftBond(b)) changed = true;
  if (mem.shifts != null) {
    const old = (Array.isArray(mem.shifts) ? mem.shifts : []), list = (Array.isArray(mem.pivots) ? mem.pivots : (mem.pivots = []));
    const ids = new Set(list.map(p => p.id));
    for (const s of old) { const p = liftShift(s); if (p && !(p.id && ids.has(p.id))) list.push(p); }
    list.sort((a, b) => (a.turn) - (b.turn));
    delete mem.shifts; changed = true;
  }
  if ((mem.tieRev || 0) < 1) { mem.tieRev = 1; changed = true; }
  return changed;
}

// ════════ 지금 사이 ════════
/** 장면에 함께 있는 두 사람 사이의 지금 한 줄의 재료 */
;
/**
 * 장면에 함께 있는 사람들끼리의 지금 사이. 두 사람마다 관계선의 읽기와, 그 둘 사이의 가장 늦은 전환점(사이 · 마음 쪽)을 함께 싣는다.
 * inScene: 그 이름이 지금 장면에 있는가. 늦게 움직인 것부터 max 줄
 */
export function standingRows(pivots, bonds, inScene, key = norm, max = 3) {
  const rows = new Map (), pair = (a, b) => `${key(a)}\u0001${key(b)}`;
  for (const b of bonds || []) {
    if (!hasRead(b.read) || !inScene(b.from) || !inScene(b.to)) continue;
    rows.set(pair(b.from, b.to), { from: b.from, to: b.to, read: b.read, turn: b.turn ?? -1 });
  }
  for (const p of pivots || []) {
    if (!HEARTFELT.has(p.way) || !p.with || !p.now || !inScene(p.who) || !inScene(p.with)) continue;
    const k = pair(p.who, p.with), old = rows.get(k), turn = p.turn ?? -1;
    if (old?.now && (old.turn ?? -1) > turn) continue;
    rows.set(k, { from: old?.from || p.who, to: old?.to || p.with, read: old?.read || {}, way: p.way, was: p.was || '', now: p.now, why: p.why || '', turn: Math.max(turn, old?.turn ?? -1) });
  }
  return [...rows.values()].sort((a, b) => b.turn - a.turn || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)).slice(0, Math.max(0, max));
}

// ════════ 관계도 ════════
/** 관계도에 그릴 인연 한 줄 — label: 인연 한마디(없으면 관계선의 단계) · kind: 무리(선의 빛깔, 모르면 '') */
/** 인물을 관계가 많은 순으로 (같으면 먼저 나온 순) */
export function rankPeople(edges) {
  const deg = new Map ();
  for (const e of edges) for (const n of [e.from, e.to]) deg.set(n, (deg.get(n) || 0) + 1);
  return [...deg.entries()].map(([n, d], i) => ({ n, d, i })).sort((a, b) => b.d - a.d || a.i - b.i).map(x => x.n);
}
;
/**
 * 관계도 배치. 인물이 limit 보다 많으면 관계가 많은 사람만 그린다. focus 를 주면 그 사람을 가운데 두고 그 사람의 관계만 그린다.
 * 둘뿐이면 옆으로 나란히, 셋부터는 세로로 긴 타원 위에 (이름 상자는 옆으로 길어 세로로 벌리는 쪽이 덜 겹친다). 한 사람이 거의 모두와 이어져 있으면 그 사람을 가운데 둔다 (선이 서로 덜 가로지른다).
 * 마주 보는 두 방향의 선은 서로 반대쪽으로 휜다.
 * 틀(box)은 이름 상자와 선 위의 한마디까지 다 들어가게 잡는다. hidden: 그리지 않은 인물 수
 */
export function layoutTies(all, { focus = '', limit = 9, width = 340 } = {}) {
  let edges = all.filter(e => e.from && e.to && e.from !== e.to);
  const everyone = rankPeople(edges);
  let names, pool = everyone.length, hub = false;
  if (focus && everyone.includes(focus)) {
    edges = edges.filter(e => e.from === focus || e.to === focus);
    const around = rankPeople(edges).filter(n => n !== focus), near = around.slice(0, Math.max(1, limit - 1));
    names = [focus, ...near]; pool = around.length + 1; edges = edges.filter(e => names.includes(e.from) && names.includes(e.to));
  } else {
    names = everyone.slice(0, Math.max(2, limit)); edges = edges.filter(e => names.includes(e.from) && names.includes(e.to)); focus = '';
    const top = names[0], linked = new Set(edges.filter(e => e.from === top || e.to === top).map(e => (e.from === top ? e.to : e.from)));
    hub = names.length >= 5 && linked.size >= (names.length - 1) * 0.6;
  }
  const hidden = pool - names.length, H = 34, NAME_UNITS = 12;
  const nodes = names.map(name => { const text = fitText(name, NAME_UNITS); return { name, text, x: 0, y: 0, w: Math.max(44, textUnits(text) * 6.6 + 18), h: H }; });
  const ring = focus || hub ? nodes.slice(1) : nodes, n = ring.length;
  if (!focus && n === 2) { const gap = Math.min(width - 40 - (nodes[0].w + nodes[1].w) / 2, 190); nodes[0].x = -gap / 2; nodes[1].x = gap / 2; }
  else if (focus && n === 1) { nodes[0].focus = true; nodes[0].x = -85; nodes[1].x = 85; }
  else {
    if (focus) nodes[0].focus = true;
    const maxW = Math.max(...ring.map(r => r.w)), rx = Math.max(70, (width - maxW) / 2 - 6), ry = Math.max(rx, 34 + n * 21);
    ring.forEach((r, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; r.x = rx * Math.cos(a); r.y = ry * Math.sin(a); });
  }
  const at = new Map(nodes.map(nd => [nd.name, nd])), pairs = new Set(edges.map(e => `${e.from}\u0001${e.to}`));
  /** 상자 가장자리에서 선이 나가는 점 (가운데에서 (ux,uy) 쪽으로) */
  const edgeOf = (nd, ux, uy, pad) => { const tx = Math.abs(ux) < 1e-6 ? Infinity : (nd.w / 2 + pad) / Math.abs(ux), ty = Math.abs(uy) < 1e-6 ? Infinity : (nd.h / 2 + pad) / Math.abs(uy), t = Math.min(tx, ty); return [nd.x + ux * t, nd.y + uy * t]; };
  const LABEL_UNITS = 14, lines = edges.map(e => {
    const p = at.get(e.from) , q = at.get(e.to) , dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const both = pairs.has(`${e.to}\u0001${e.from}`), bend = both ? Math.max(20, Math.min(44, len * 0.22)) : Math.min(14, len * 0.08); // 가는 쪽에서 볼 때 오른쪽으로 휜다 — 마주 보는 선과 겹치지 않는다
    const cx = (p.x + q.x) / 2 - uy * bend * 2, cy = (p.y + q.y) / 2 + ux * bend * 2;
    const d1 = Math.hypot(cx - p.x, cy - p.y) || 1, d2 = Math.hypot(cx - q.x, cy - q.y) || 1;
    const [sx, sy] = edgeOf(p, (cx - p.x) / d1, (cy - p.y) / d1, 2), [ex, ey] = edgeOf(q, (cx - q.x) / d2, (cy - q.y) / d2, 7);
    const label = fitText(e.label, LABEL_UNITS), lx = 0.25 * sx + 0.5 * cx + 0.25 * ex, ly = 0.25 * sy + 0.5 * cy + 0.25 * ey;
    const r = (v) => Math.round(v * 10) / 10, el = Math.hypot(ex - cx, ey - cy) || 1, vx = (ex - cx) / el, vy = (ey - cy) / el;
    return { id: e.id, from: e.from, to: e.to, kind: e.kind, label, full: e.label, d: `M${r(sx)} ${r(sy)} Q${r(cx)} ${r(cy)} ${r(ex)} ${r(ey)}`,
      ah: `M${r(ex + vx * 5)} ${r(ey + vy * 5)} L${r(ex - vy * 3.4)} ${r(ey + vx * 3.4)} L${r(ex + vy * 3.4)} ${r(ey - vx * 3.4)} Z`, lx: r(lx), ly: r(ly), lw: textUnits(label) * 5.6 + 10 };
  });
  // 겹친 한마디는 위아래로 조금 벌린다
  const placed = [];
  for (const l of [...lines].sort((a, b) => a.ly - b.ly)) {
    for (let tries = 0; tries < 8; tries++) { const hit = placed.find(o => Math.abs(o.ly - l.ly) < 15 && Math.abs(o.lx - l.lx) < (o.lw + l.lw) / 2); if (!hit) break; l.ly = hit.ly + 15; }
    placed.push(l);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (ax, ay, bx, by) => { x0 = Math.min(x0, ax); y0 = Math.min(y0, ay); x1 = Math.max(x1, bx); y1 = Math.max(y1, by); };
  for (const nd of nodes) grow(nd.x - nd.w / 2, nd.y - nd.h / 2, nd.x + nd.w / 2, nd.y + nd.h / 2);
  for (const l of lines) grow(l.lx - l.lw / 2, l.ly - 9, l.lx + l.lw / 2, l.ly + 9);
  if (!nodes.length) return { nodes, lines, box: [0, 0, width, 80], hidden };
  // 사람 수가 적어도 지나치게 크게 키우지 않는다: 틀을 화면 너비보다 좁게 잡지 않는다
  const pad = 10, w = Math.max(x1 - x0 + pad * 2, width), h = y1 - y0 + pad * 2, mx = (x0 + x1) / 2;
  return { nodes, lines, box: [Math.round(mx - w / 2), Math.round(y0 - pad), Math.round(w), Math.round(h)], hidden };
}
