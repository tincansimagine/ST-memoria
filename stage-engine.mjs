/**
 * 장면 정리 — 이야기 밖 대화, 서로 부르는 말과 누가 한 말인지, 작중 기한, 장면 인물의 지금 모습.
 * 모두 순수 함수 (화면·저장소에 의존하지 않고 모델도 부르지 않는다).
 */
const OOC_START = /^(?:\(\(|[(\[（［【]\s*ooc\b|ooc\b)/i;
const leadIn = (text) => String(text ?? "").replace(/^(?:\s|<[^<>]{0,200}>)+/, "");
function isOocText(text) {
  return OOC_START.test(leadIn(text));
}
function looksOocReply(text) {
  const t = leadIn(text).trim();
  if (!t) return false;
  if (OOC_START.test(t)) return true;
  const m = t.match(/^([(（\[［])+/);
  if (!m) return false;
  const close = { "(": ")", "（": "）", "[": "]", "［": "］" };
  const want = close[m[0][0]];
  if (!t.endsWith(want)) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === m[0][0]) depth++;
    else if (c === want && --depth === 0 && i < t.length - 1 && t.slice(i + 1).replace(/[)）\]］\s]/g, "")) return false;
  }
  return true;
}
const NAME_TAIL = /^(?:아|야|이|씨|님|군|양|선배(?:님)?|언니|오빠|누나|형(?:님)?|선생님|쌤|ちゃん|さん|くん|様|さま|君)$/;
const NAME_HEAD = /^(?:miss|mr|mrs|ms|dr|lady|lord|sir|captain|master|professor|prof)\.?$/i;
const TITLE_WORDS = /* @__PURE__ */ new Set([
  "오빠",
  "언니",
  "형",
  "누나",
  "형님",
  "선배",
  "선배님",
  "후배",
  "아가씨",
  "도련님",
  "주인님",
  "선생님",
  "쌤",
  "사장님",
  "대표님",
  "팀장님",
  "부장님",
  "과장님",
  "실장님",
  "교수님",
  "아저씨",
  "아줌마",
  "이모",
  "삼촌",
  "자기",
  "자기야",
  "여보",
  "당신",
  "아빠",
  "엄마",
  "아버지",
  "어머니",
  "할머니",
  "할아버지",
  "공주님",
  "왕자님",
  "전하",
  "폐하",
  "마마",
  "아씨",
  "나리",
  "대감",
  "꼬맹이",
  "아기",
  "애기",
  "귀염둥이",
  "바보",
  "멍청아",
  "꼬마",
  "손님",
  "보스",
  "마스터",
  "주군",
  "각하",
  "도령",
  "sir",
  "ma'am",
  "madam",
  "boss",
  "master",
  "captain",
  "darling",
  "honey",
  "sweetheart",
  "babe",
  "baby",
  "dear",
  "kid",
  "love",
  "princess",
  "my lord",
  "my lady",
  "your highness",
  "your majesty",
  "お兄ちゃん",
  "お姉ちゃん",
  "先輩",
  "先生",
  "ご主人様",
  "お嬢様"
]);
const lowc = (s) => String(s ?? "").toLowerCase().trim();
function dialogueSpans(text) {
  const src = String(text ?? ""), out = [];
  for (const re of [/"([^"\n]{1,400})"/g, /“([^”\n]{1,400})”/g, /「([^」\n]{1,400})」/g, /『([^』\n]{1,400})』/g]) for (const m of src.matchAll(re)) out.push({ bit: m[1], start: m.index, end: m.index + m[0].length });
  return out.sort((a, b) => a.start - b.start);
}
function dialogueBits(text) {
  return dialogueSpans(text).map((d) => d.bit);
}
function speakerAfter(after, people) {
  const a = after.replace(/^[\s,.]+/, "").slice(0, 40), la = lowc(a);
  for (const p of people) for (const f of [p.name, ...p.forms]) {
    const lf = lowc(f);
    if (lf.length < 2) continue;
    if (la.startsWith(lf) && /^(?:이|가|은|는|도|의|께서|,|\s+(?:said|asked|says|asks|replied|whispered|shouted)\b)/.test(a.slice(f.length))) return p.name;
    if (new RegExp(`^(?:said|asked|says|asks|replied|whispered|shouted)\\s+${lf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(a)) return p.name;
  }
  return "";
}
const SAY_EN = "(?:said|asked|says|asks|replied|whispered|shouted|murmured|muttered|answered|called|snapped|sighed|laughed)";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function speakerTag(before, people) {
  const line = before.slice(before.lastIndexOf("\n") + 1).replace(/[*_`]/g, "").trim(), m = line.match(/^(.{1,30}?)\s*[:：|｜]$/u);
  if (!m) return "";
  const tag = lowc(m[1]);
  for (const p of people) if ([p.name, ...p.forms].some((f) => lowc(f).length >= 2 && lowc(f) === tag)) return p.name;
  return "";
}
function speakerBefore(before, people) {
  const para = before.slice(before.lastIndexOf("\n") + 1), cut = Math.max(para.lastIndexOf(". ", para.length - 3), para.lastIndexOf("? "), para.lastIndexOf("! "), para.lastIndexOf("” "), para.lastIndexOf('" '));
  const sent = para.slice(cut + 1).slice(-90), ls = lowc(sent);
  if (!sent.trim() || !/[,:.…]\s*$|(?:다|요|며|고|서)\s*$/u.test(sent.trimEnd())) return "";
  const found = [];
  for (const p of people) for (const f of [p.name, ...p.forms]) {
    const lf = lowc(f);
    if (lf.length < 2) continue;
    const subj = new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(lf)}(?:이|가|은|는|께서|와|과|랑|하고)(?![\\p{L}\\p{N}])|(?:^|[^\\p{L}\\p{N}])${esc(lf)}\\s+and\\s|(?:^|[^\\p{L}\\p{N}])${esc(lf)}\\s+${SAY_EN}\\b`, "iu");
    if (subj.test(ls)) {
      if (!found.includes(p.name)) found.push(p.name);
      break;
    }
  }
  return found.length === 1 ? found[0] : "";
}
function speakerOfSpan(src, span, people, author = "", crowded = false) {
  const tag = speakerTag(src.slice(0, span.start), people);
  if (tag) return tag;
  const after = speakerAfter(src.slice(span.end), people), called = after ? calledIn(src.slice(span.start + 1, span.end - 1), people) : "";
  if (after && lowc(after) !== lowc(called)) return after;
  const before = speakerBefore(src.slice(0, span.start), people);
  if (before && !(after && lowc(before) === lowc(called))) return before;
  return crowded || after ? "" : author;
}
function crowdedNarration(src, people, mine) {
  let narration = src;
  for (const d of [...dialogueSpans(src)].reverse()) narration = narration.slice(0, d.start) + " " + narration.slice(d.end);
  const ln = lowc(narration), own = new Set(mine.map(lowc));
  return people.some((p) => !own.has(lowc(p.name)) && [p.name, ...p.forms].some((f) => lowc(f).length >= 2 && ln.includes(lowc(f))));
}
function calledIn(bit, people, speaker = "", partner = "") {
  for (const re of [HEAD_RE, TAIL_RE]) {
    const m = bit.match(re);
    if (!m) continue;
    const to = resolveTerm(m[1].replace(/[\s,.!?…~]+$/u, "").trim(), people, partner);
    if (to && lowc(to) !== lowc(speaker)) return to;
  }
  return "";
}
function attributeQuote(text, quote, { author = "", people, partner = "" }) {
  const src = String(text ?? ""), squash = (s) => s.replace(/\s+/g, " ").trim(), q = squash(String(quote ?? "")).replace(/^["“”「」『』']+|["“”「」『』']+$/g, "");
  if (!q || !src) return { by: "", to: "", found: false };
  const span = dialogueSpans(src).find((d) => {
    const b = squash(d.bit);
    return b.includes(q) || q.length >= 8 && q.includes(b) && b.length >= q.length * 0.6;
  });
  if (!span) return { by: "", to: "", found: false };
  const crowded = crowdedNarration(src, people, [author, partner]), by = speakerOfSpan(src, span, people, author, crowded);
  const to = by ? calledIn(span.bit, people, by, lowc(by) === lowc(author) ? partner : "") || (lowc(by) === lowc(author) && partner && !crowded ? partner : "") : "";
  return { by, to, found: true };
}
const WORD = '[^\\s,.!?…~"“”「」『』]';
const HEAD_RE = new RegExp(`^\\s*(${WORD}{1,12}(?:\\s${WORD}{1,10})?)\\s*[,!…~]`, "u");
const TAIL_RE = new RegExp(`[,…]\\s*(${WORD}{1,12}(?:\\s${WORD}{1,10})?)\\s*[.!?~…]*\\s*$`, "u");
function resolveTerm(term, people, partner) {
  const t = term.trim(), lt = lowc(t);
  if (!t) return "";
  for (const p of people) {
    for (const f of [p.name, ...p.forms]) {
      const lf = lowc(f);
      if (lf.length < 2) continue;
      if (lt === lf) return p.name;
      if (lt.startsWith(lf) && NAME_TAIL.test(lt.slice(lf.length).trim())) return p.name;
      if (lt.endsWith(lf) && NAME_HEAD.test(lt.slice(0, lt.length - lf.length).trim())) return p.name;
    }
  }
  return partner && TITLE_WORDS.has(lt) ? partner : "";
}
function addressTermsIn(text, { speaker, people, partner = "" }) {
  if (!speaker) return [];
  const src = String(text ?? ""), spans = dialogueSpans(src), out = [], seen = /* @__PURE__ */ new Set();
  let narration = src;
  for (const d of [...spans].reverse()) narration = narration.slice(0, d.start) + " " + narration.slice(d.end);
  const ln = lowc(narration), mine = /* @__PURE__ */ new Set([lowc(speaker), lowc(partner)]);
  const crowded = people.some((p) => !mine.has(lowc(p.name)) && [p.name, ...p.forms].some((f) => lowc(f).length >= 2 && ln.includes(lowc(f))));
  for (const d of spans) {
    const who = speakerOfSpan(src, d, people, speaker, crowded);
    if (!who) continue;
    const pal = lowc(who) === lowc(speaker) ? partner : "", me = lowc(who);
    for (const re of [HEAD_RE, TAIL_RE]) {
      const m = d.bit.match(re);
      if (!m) continue;
      const term = m[1].replace(/[\s,.!?…~]+$/u, "").trim();
      if ([...term].length < 1 || term.length > 24) continue;
      const to = resolveTerm(term, people, pal);
      if (!to || lowc(to) === me) continue;
      const k = `${me}|${lowc(to)}|${lowc(term)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ from: who, to, term });
    }
  }
  return out;
}
function tallyAddress(perMessage) {
  const rows = /* @__PURE__ */ new Map();
  for (const { at, hits } of perMessage) {
    for (const h of hits) {
      const k = `${lowc(h.from)}|${lowc(h.to)}|${lowc(h.term)}`, r = rows.get(k);
      if (r) {
        r.count++;
        r.last = Math.max(r.last, at);
      } else rows.set(k, { ...h, count: 1, last: at });
    }
  }
  return [...rows.values()];
}
function pickAddressLines(rows, present, { minCount = 2, perPair = 2, max = 6, known = () => "" } = {}) {
  const pairs = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (r.count < minCount || !present.has(lowc(r.from)) || !present.has(lowc(r.to))) continue;
    const have = lowc(known(r.from, r.to));
    if (have && have.includes(lowc(r.term))) continue;
    const k = `${lowc(r.from)}|${lowc(r.to)}`, p = pairs.get(k) || { from: r.from, to: r.to, rows: [], last: 0 };
    p.rows.push(r);
    p.last = Math.max(p.last, r.last);
    pairs.set(k, p);
  }
  return [...pairs.values()].sort((a, b) => b.last - a.last || a.from.localeCompare(b.from)).slice(0, max).map((p) => ({ from: p.from, to: p.to, terms: p.rows.sort((a, b) => b.last - a.last || b.count - a.count).slice(0, perPair).map((r) => r.term) })).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}
const VAGUE_TITLES = /* @__PURE__ */ new Set(["당신", "자기", "자기야", "바보", "멍청아", "아기", "애기", "baby", "babe", "dear", "love", "honey", "darling", "sweetheart", "kid"]);
const isTitleWord = (t) => !!t && !VAGUE_TITLES.has(t) && (TITLE_WORDS.has(t) || /^[가-힣]{1,5}님$/.test(t));
const TITLE_TAIL = "(?:에게서|한테서|이라고|께서|에게|한테|이랑|하고|이야|라고|으로|부터|까지|처럼|보다|이|가|은|는|을|를|도|의|와|과|랑|야|아|께|로|만)?";
/**
 * 관계선의 "부르는 말" 한 칸에서 호칭만 골라낸다 — "민준 형" → 형, "선배 / 형" → 선배·형.
 * 이름·대명사·풀어 쓴 설명("예전에는 오빠")은 버린다. nameForms: 불리는 사람의 이름들
 */
function titlesInCalls(calls, nameForms = []) {
  const forms = nameForms.map(lowc).filter((f) => f.length >= 2), out = /* @__PURE__ */ new Set();
  for (const raw of String(calls ?? "").split(/[,，、/·|;()（）→]+|\s+(?:or|또는|혹은)\s+/)) {
    const t = lowc(raw).replace(/^["“”'‘’「」『』\s]+|["“”'‘’「」『』\s.]+$/g, "");
    if (isTitleWord(t)) {
      out.add(t);
      continue;
    }
    for (let i = 2; i < t.length; i++) {
      const head = t.slice(0, i).trim().replace(/이$/, ""), tail = t.slice(i).trim();
      if (head.length >= 2 && isTitleWord(tail) && forms.some((f) => f.includes(head))) {
        out.add(tail);
        break;
      }
    }
  }
  return [...out];
}
/** 글에 그 호칭이 낱말로 나오는가 — "형, " · "형이 " · "선배님!" 은 맞고 "인형" · "형편" 은 아니다 */
function saysTitle(text, title) {
  const t = lowc(title);
  if (!t) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(t)}${[...t].length >= 2 && !t.endsWith("님") ? "님?" : ""}${TITLE_TAIL}(?![\\p{L}\\p{N}])`, "u").test(lowc(text));
}
/**
 * 글에 나온 호칭이 가리키는 사람들. bonds: 말한 사람에게서 나가는 관계선 [{ to, calls(부르는 말), forms(그 사람의 다른 이름) }].
 * 호칭 하나가 두 사람 이상에게 적혀 있으면 누구인지 알 수 없으므로 고르지 않는다. 반환: [{ to, title }]
 */
function titleTargets(text, bonds) {
  const by = /* @__PURE__ */ new Map();
  for (const b of bonds) for (const t of titlesInCalls(b.calls, [b.to, ...b.forms || []])) {
    if (!by.has(t)) by.set(t, /* @__PURE__ */ new Map());
    by.get(t).set(lowc(b.to), b.to);
  }
  const out = [];
  for (const [title, tos] of by) if (tos.size === 1 && saysTitle(text, title)) out.push({ to: [...tos.values()][0], title });
  return out;
}
function dueLabel(remaining) {
  if (!Number.isFinite(remaining)) return "";
  if (remaining > 0.75) return `D-${Math.max(1, Math.round(remaining))}`;
  if (remaining >= 1 / 24) return `D-day (in ~${Math.max(1, Math.round(remaining * 24))}h)`;
  if (remaining >= -0.5) return "D-day (due now)";
  const n = Math.max(1, Math.round(-remaining));
  return `${n} day${n === 1 ? "" : "s"} overdue`;
}
function storyDays(daysPerTurn) {
  const out = [];
  let acc = 0;
  for (const d of daysPerTurn) {
    acc += Number(d) || 0;
    out.push(acc);
  }
  return out;
}
function pickDeadlines(rows, { dayAt, turnNow, touched, staleTurns = 50, max = 5 }) {
  const now = dayAt.length ? dayAt[dayAt.length - 1] : 0, out = [];
  for (const row of rows) {
    const d = row.due;
    if (!d || !(Number(d.in) > 0) || !Number.isInteger(d.turn)) continue;
    const start = d.turn >= 0 && d.turn < dayAt.length ? dayAt[d.turn] : d.turn < 0 ? 0 : now;
    const remaining = start + Number(d.in) - now;
    if (remaining < -0.5 && turnNow - 1 - touched(row) > staleTurns) continue;
    out.push({ row, remaining, label: dueLabel(remaining) });
  }
  return out.sort((a, b) => Math.abs(a.remaining) - Math.abs(b.remaining)).slice(0, max);
}
const LOOK_SLOTS = [["location", "at"], ["whereabouts", "gone to"], ["activity", "doing"], ["outfit", "wearing"], ["injury", "injured"], ["condition", "condition"], ["holding", "holding"], ["mood", "mood"], ["goal", "wants"]];
const LOOK_ORDER = new Map(LOOK_SLOTS.map(([k], i) => [k, i]));
const LOOK_WORD = new Map(LOOK_SLOTS);
function personNowLine(name, slots) {
  const bits = [...slots].sort((a, b) => (LOOK_ORDER.get(a.slot) ?? 99) - (LOOK_ORDER.get(b.slot) ?? 99) || a.slot.localeCompare(b.slot)).map((s) => `${LOOK_WORD.get(s.slot) || s.slot.replace(/_/g, " ")} ${s.value}${s.note ? ` ${s.note}` : ""}`);
  return bits.length ? `- ${name}: ${bits.join(" · ")}` : "";
}
export {
  addressTermsIn,
  attributeQuote,
  calledIn,
  crowdedNarration,
  dialogueBits,
  dialogueSpans,
  dueLabel,
  isOocText,
  looksOocReply,
  personNowLine,
  pickAddressLines,
  pickDeadlines,
  saysTitle,
  speakerOfSpan,
  storyDays,
  tallyAddress,
  titleTargets,
  titlesInCalls
};
