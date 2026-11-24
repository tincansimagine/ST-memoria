/**
 * 작중 달력 · 날 세기 · 장면 카드 · 작가 계획의 누설 검사 — 순수 함수 (모델을 부르지 않는다).
 */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const realDate = (y, m, d) => {
  if (!(y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  const t = new Date(Date.UTC(2e3, m - 1, d));
  t.setUTCFullYear(y);
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}` : "";
};
const century = (two, base) => {
  const by = base ? +base.slice(0, 4) : 0;
  if (!by) return 2e3 + two;
  const c = Math.floor(by / 100) * 100, cands = [c - 100 + two, c + two, c + 100 + two];
  return cands.sort((a, b) => Math.abs(a - by) - Math.abs(b - by))[0];
};
function parseStoryDate(text, base) {
  const s = String(text ?? "").normalize("NFKC");
  if (!s.trim()) return "";
  let m;
  if (m = s.match(/(?<![\d.])(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?![\d])/)) return realDate(+m[1], +m[2], +m[3]);
  if (m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)) return realDate(+m[1], +m[2], +m[3]);
  if (m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)) return realDate(+m[1], +m[2], +m[3]);
  if (m = s.match(/(?<![\d.:])(\d{2})\s*[-.]\s*(\d{1,2})\s*[-.]\s*(\d{1,2})(?![\d:])/)) return realDate(century(+m[1], base), +m[2], +m[3]);
  const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  if (m = s.match(new RegExp(`\\b${mon}\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i"))) {
    const y = m[3] ? +m[3] : base ? +base.slice(0, 4) : 0;
    return y ? realDate(y, MONTHS[m[1].toLowerCase()], +m[2]) : "";
  }
  if (m = s.match(new RegExp(`\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${mon}(?:,?\\s+(\\d{4}))?`, "i"))) {
    const y = m[3] ? +m[3] : base ? +base.slice(0, 4) : 0;
    return y ? realDate(y, MONTHS[m[2].toLowerCase()], +m[1]) : "";
  }
  if (base && (m = s.match(/(\d{1,2})\s*[월月]\s*(\d{1,2})\s*[일日]/))) {
    const by = +base.slice(0, 4), bm = +base.slice(5, 7), y = +m[1] < bm && bm - +m[1] >= 6 ? by + 1 : by;
    return realDate(y, +m[1], +m[2]);
  }
  return "";
}
const toUtc = (iso) => {
  const t = new Date(Date.UTC(2e3, +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  t.setUTCFullYear(+iso.slice(0, 4));
  return t.getTime();
};
const isIsoDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && realDate(+v.slice(0, 4), +v.slice(5, 7), +v.slice(8, 10)) === v;
const dayDiff = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 864e5);
function addDays(iso, days) {
  const t = new Date(toUtc(iso) + Math.round(days) * 864e5);
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function storyDatesOf(turns, fixes) {
  const fx = new Map((fixes || []).filter((f) => f && isIsoDate(f.date)).map((f) => [f.msgId, f.date])), out = [];
  let cur = "", shift = 0, carry = 0;
  for (const t of turns) {
    const fix = t.msgId ? fx.get(t.msgId) : void 0, read = isIsoDate(t.date) ? t.date : "";
    if (fix) {
      shift = read ? dayDiff(read, fix) : 0;
      cur = fix;
      carry = 0;
    } else if (read) {
      cur = addDays(read, shift);
      carry = 0;
    } else if (cur) {
      carry += Math.max(0, Number(t.days) || 0);
      const whole = Math.floor(carry);
      if (whole >= 1) {
        cur = addDays(cur, whole);
        carry -= whole;
      }
    }
    out.push(cur);
  }
  return out;
}
function trackerText(tk, today) {
  if (!tk || tk.disabled || !isIsoDate(today)) return "";
  if (tk.type === "count") {
    if (!isIsoDate(tk.start)) return "";
    const n = dayDiff(tk.start, today) + (tk.firstDay === 0 ? 0 : 1);
    return n >= 0 ? `${tk.label}: day ${n}` : "";
  }
  if (tk.type === "until") {
    if (!isIsoDate(tk.target)) return "";
    const left = dayDiff(today, tk.target);
    return `${tk.label}: ${left > 0 ? `D-${left}` : left === 0 ? "D-day" : `D+${-left}`}`;
  }
  if (tk.type === "cycle") {
    const every = Math.max(1, Math.round(Number(tk.every) || 0)), length = Math.max(1, Math.round(Number(tk.length) || 1)), starts = (tk.starts || []).filter(isIsoDate).filter((s2) => dayDiff(s2, today) >= 0).sort();
    if (!starts.length || !(Number(tk.every) > 0)) return "";
    let s = starts[starts.length - 1];
    const gone = dayDiff(s, today);
    if (gone >= every) s = addDays(s, Math.floor(gone / every) * every);
    const k = dayDiff(s, today);
    return k < length ? `${tk.label}: in progress (day ${k + 1} of ${length})` : `${tk.label}: next in D-${every - k}`;
  }
  return "";
}
function trackerLineOf(trackers, today, present, key, max = 6) {
  if (!isIsoDate(today)) return "";
  const on = (trackers || []).filter((tk) => tk && !tk.disabled && tk.inject !== "never" && (tk.inject === "always" || !(tk.people || []).length || (tk.people || []).some((p) => present.has(key(p)))));
  const bits = [...on.filter((tk) => tk.inject === "always"), ...on.filter((tk) => tk.inject !== "always")].map((tk) => {
    const txt = trackerText(tk, today);
    return txt ? `${(tk.people || []).length ? `${tk.people.join(" & ")} — ` : ""}${txt}` : "";
  }).filter(Boolean).slice(0, max);
  return bits.length ? `(Counted days as of ${today} in-story — ${bits.join(" · ")})` : "";
}
function pickBeats(beats, max = 8) {
  const all = (beats || []).filter((b) => b && b.text);
  if (all.length <= max) return all;
  const rank = (b) => (b.major ? 2 : 0) + (b.q ? 1 : 0), keep = new Set([...all].map((b, i) => ({ b, i })).sort((x, y) => rank(y.b) - rank(x.b) || x.i - y.i).slice(0, max).map((x) => x.i));
  return all.filter((_, i) => keep.has(i));
}
function beatLines(beats, { away = () => [], quote = (b) => b.q || "", maxChars = 1500 } = {}) {
  const out = [];
  let used = 0;
  for (const b of beats) {
    const q = quote(b), gone = away(b), line = `- ${b.major ? "★ " : ""}${b.text}${q ? ` — ${b.by ? `${b.by}${b.to ? ` to ${b.to}` : ""}: ` : ""}"${q}"` : ""}${gone.length ? ` [${gone.join(", ")} not there]` : ""}`;
    if (used + line.length > maxChars && out.length) break;
    out.push(line);
    used += line.length;
  }
  return out;
}
const GENERIC = new Set("real reason truth secret identity cause behind true actual hidden mystery who whom what why how when where the and for with that this from into about still not yet must stay keep leave left 진짜 정체 이유 비밀 진실 원인 누구 무엇 어째서 아직 그대로 밝히지 말것 사실 까닭".split(" "));
const JOSA = /(으로|에서|에게|한테|까지|부터|처럼|보다|이라는|라는|이라고|라고|에는|에도|은|는|이|가|을|를|의|에|로|와|과|도|만)$/;
function planWords(text, names) {
  const skip = new Set(names.map((n) => n.toLowerCase())), out = /* @__PURE__ */ new Set();
  for (const raw of String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []) {
    const latin = /^[a-z0-9']+$/.test(raw);
    let w = latin ? raw.replace(/(?:'s|es|s|ed|ing)$/, "") : raw.replace(JOSA, "");
    if (w.length < 2 || GENERIC.has(raw) || GENERIC.has(w) || skip.has(raw) || skip.has(w) || [...skip].some((n) => n.includes(raw) || n.includes(w))) continue;
    if (!latin && w.length > 3) w = w.slice(0, 3);
    out.add(w);
  }
  return out;
}
function veilLeaks(veil, plan, names = []) {
  const v = String(veil ?? "").trim(), p = String(plan ?? "");
  if (!v) return true;
  const nameSet = new Set(names.map((n) => n.toLowerCase()));
  for (const w of p.match(/\b[A-Z][a-z]{2,}\b|\d{2,}/g) || []) {
    if (nameSet.has(w.toLowerCase()) || /^(The|This|That|She|He|They|When|After|Before|But|And|His|Her)$/.test(w)) continue;
    if (new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "u").test(v) && !p.trimStart().startsWith(w)) return true;
  }
  const vw = planWords(v, names), pw = planWords(p, names);
  if (!vw.size) return false;
  let shared = 0;
  for (const w of vw) if (pw.has(w)) shared++;
  return shared >= 3 && shared / vw.size >= 0.6 || pw.size >= 3 && shared / pw.size >= 0.7;
}
export {
  addDays,
  beatLines,
  dayDiff,
  isIsoDate,
  parseStoryDate,
  pickBeats,
  storyDatesOf,
  trackerLineOf,
  trackerText,
  veilLeaks
};
