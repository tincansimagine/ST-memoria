/**
 * 「읽는 말로 보기」 — 서고 글을 읽는 말로 옮길 때 고르고 묶고 답을 읽는 순수 함수. 호출·저장은 index.js 가 한다.
 */
const READER_MAX_BYTES = 300 * 1024;
const READER_LONG = 280;
const READER_BATCH_CHARS = 1800;
const READER_BATCH_ITEMS = 14;
const READER_TOO_LONG = 8e3;
const READER_LANGS = { ko: "Korean", en: "English", "zh-CN": "Simplified Chinese" };
const READER_PROMPT = `You are translating entries of a story archive into {LANG} so its reader can skim them.

INPUT: one JSON object. Each key is an entry id, each value is the entry text.
OUTPUT: exactly one JSON object with the same ids; each value is that entry rendered in {LANG}. Nothing before "{" or after "}" — no notes, no code fences.

Rules:
1. Names stay untouched. Personal names, nicknames, place names, organization names, titles of works and any other proper noun are copied exactly as written in the entry — never translated, transliterated or respelled. The names listed under KEEP AS WRITTEN are examples of this; treat unlisted proper nouns the same way.
2. Structure stays untouched. Keep line breaks, list markers ("-", "•"), separators (" · ", "→", "=") and all-caps line labels such as WHEN:, PLOT:, SHIFTS:, OPEN: exactly where they are, and translate only the wording around them. Keep numbers, dates and markers like t12, #34, ★ as they are.
3. Translate the meaning plainly and completely. Add nothing, drop nothing, do not summarize or explain. Quoted speech is translated as natural speech and keeps its quotation marks.
4. An entry that is already in {LANG} is returned unchanged.
5. Every id in the input appears once in the output.`;
const KEEP_QUOTES_RULE = "Quoted speech is NOT translated: everything inside quotation marks is copied exactly as written, in its original language, with its quotation marks.";
/** keepQuotes: 따옴표 안의 대사는 옮기지 않는다 (서고의 기록을 고쳐 적을 때 — 대사는 원문 그대로 남아야 회상에서 찾는다) */
const readerSystem = (lang, { keepQuotes = false } = {}) => (keepQuotes
  ? READER_PROMPT.replace("Quoted speech is translated as natural speech and keeps its quotation marks.", KEEP_QUOTES_RULE)
  : READER_PROMPT).replace(/\{LANG\}/g, READER_LANGS[lang] || lang);
function readerUser(texts, names = []) {
  const keep = [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))].slice(0, 40);
  const body = {};
  texts.forEach((t, i) => {
    body[String(i + 1)] = t;
  });
  return `${keep.length ? `KEEP AS WRITTEN: ${keep.join(", ")}

` : ""}${JSON.stringify(body)}`;
}
function textHash(s) {
  let a = 5381, b = 52711;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = (a << 5) + a + c | 0;
    b = (b << 5) + b ^ c | 0;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36) + s.length.toString(36);
}
const readerKey = (text, lang) => `${lang}:${textHash(text)}`;
function needsReading(text, lang) {
  const s = String(text ?? "");
  if (s.length > READER_TOO_LONG) return false;
  let hangul = 0, latin = 0, han = 0, kana = 0, other = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 44032 && c <= 55203) hangul++;
    else if (c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 192 && c <= 591) latin++;
    else if (c >= 19968 && c <= 40959) han++;
    else if (c >= 12352 && c <= 12543) kana++;
    else if (c > 767 && /\p{L}/u.test(ch)) other++;
  }
  const lat = latin / 3, all = hangul + lat + han + kana + other;
  if (all < 1.5) return false;
  if (lang === "ko") return hangul / all < 0.5;
  if (lang === "en") return (hangul + han + kana + other) / all > 0.25;
  if (lang === "zh-CN") return han / all < 0.5 || kana > 0;
  if (lang === "ja") return kana < 1 || (kana + han) / all < 0.5;
  return true;
}
function packBatches(texts, { long = READER_LONG, chars = READER_BATCH_CHARS, items = READER_BATCH_ITEMS } = {}) {
  const out = [];
  let cur = [], size = 0;
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
    size = 0;
  };
  for (const t of texts) {
    if (t.length > long) {
      out.push([t]);
      continue;
    }
    if (cur.length >= items || size + t.length > chars) flush();
    cur.push(t);
    size += t.length;
  }
  flush();
  return out;
}
const replyBudget = (texts) => Math.max(600, Math.min(6e3, Math.round(texts.reduce((n, t) => n + t.length, 0) * 1.6) + 200 + texts.length * 12));
function readReply(reply, texts) {
  const none = texts.map(() => null);
  let s = String(reply ?? "").replace(/<(think|thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return none;
  s = s.slice(a, b + 1);
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    return none;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return none;
  return texts.map((src, i) => {
    const v = obj[String(i + 1)];
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t || t.length > src.length * 5 + 200) return null;
    const lines = (x) => x.split("\n").filter((l) => l.trim()).length;
    if (lines(src) > 1 && Math.abs(lines(src) - lines(t)) > Math.max(1, Math.floor(lines(src) / 3))) return null;
    return t;
  });
}
const bytes = (s) => new TextEncoder().encode(s).length;
function trimItems(items, max = READER_MAX_BYTES) {
  const cost = (k, v) => bytes(k) + bytes(v.t) + 40;
  let total = 0;
  const rows = Object.entries(items).map(([k, v]) => {
    const c = cost(k, v);
    total += c;
    return { k, c, at: v.at || 0 };
  });
  if (total <= max) return 0;
  rows.sort((x, y) => x.at - y.at);
  let n = 0;
  for (const r of rows) {
    if (total <= max) break;
    delete items[r.k];
    total -= r.c;
    n++;
  }
  return n;
}
export {
  READER_BATCH_CHARS,
  READER_BATCH_ITEMS,
  READER_LANGS,
  READER_LONG,
  READER_MAX_BYTES,
  READER_PROMPT,
  READER_TOO_LONG,
  needsReading,
  packBatches,
  readReply,
  readerKey,
  readerSystem,
  readerUser,
  replyBudget,
  textHash,
  trimItems
};
