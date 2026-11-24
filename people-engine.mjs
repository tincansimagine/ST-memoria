/**
 * 인물 보기 · 이름 정리 · 골라서 지우기의 집계 — 화면이 읽는 순수 함수.
 */
const nameKey = (s) => String(s || "").toLowerCase().replace(/[\s._\-'"`]+/g, "").trim();
const isScene = (n) => nameKey(n) === "scene";
const splitNames = (v) => String(v || "").split(/[,，、·]+/).map((s) => s.trim()).filter(Boolean);
function canonOf(mem, name) {
  const raw = String(name || "").trim(), k = nameKey(raw);
  if (!k) return raw;
  const c = mem.cast.find((x) => nameKey(x.name) === k || (x.aka || []).some((a) => nameKey(a) === k));
  return c ? c.name : raw;
}
function presentKeys(mem) {
  let names = [];
  for (let i = mem.status.length - 1; i >= 0; i--) {
    const s = mem.status[i];
    if (isScene(s.entity) && String(s.slot || "").toLowerCase() === "present" && s.expired == null) {
      names = splitNames(s.value);
      break;
    }
  }
  if (!names.length) {
    for (let i = mem.turns.length - 1; i >= 0 && i > mem.turns.length - 6; i--) if (mem.turns[i].present?.length) {
      names = mem.turns[i].present;
      break;
    }
  }
  return new Set(names.map((n) => nameKey(canonOf(mem, n))).filter(Boolean));
}
function mentions(text, names) {
  const src = String(text || "").toLowerCase();
  if (!src) return false;
  for (const n of names) {
    const w = String(n || "").trim().toLowerCase();
    if (w.length < 2) continue;
    let at = src.indexOf(w);
    while (at >= 0) {
      if (!/^[a-z0-9]+$/.test(w)) return true;
      const before = src[at - 1] || " ", after = src[at + w.length] || " ";
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
      at = src.indexOf(w, at + 1);
    }
  }
  return false;
}
function strayPeople(mem) {
  const known = new Set(mem.cast.flatMap((c) => [c.name, ...c.aka || []]).map(nameKey)), out = /* @__PURE__ */ new Map();
  const add = (n) => {
    const s = String(n || "").trim(), k = nameKey(s);
    if (k && !isScene(s) && !known.has(k) && !out.has(k) && s.length <= 60) out.set(k, s);
  };
  for (const s of mem.status) {
    add(s.entity);
    if (s.claim === "belief") add(s.owner);
  }
  for (const b of mem.bonds || []) {
    add(b.from);
    add(b.to);
  }
  for (const m of mem.memories) {
    add(m.owner);
    for (const k of m.knowers || []) add(k);
    for (const k of m.guessers || []) add(k);
  }
  for (const t of mem.turns) for (const p of t.present || []) add(p);
  return [...out.values()];
}
function peopleList(mem) {
  const here = presentKeys(mem), count = /* @__PURE__ */ new Map(), bonds = /* @__PURE__ */ new Map(), bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const m of mem.memories) for (const k of new Set((m.entities || []).map((e) => nameKey(canonOf(mem, e))))) bump(count, k);
  for (const b of mem.bonds || []) {
    bump(bonds, nameKey(canonOf(mem, b.from)));
    bump(bonds, nameKey(canonOf(mem, b.to)));
  }
  const row = (name, card) => {
    const k = nameKey(name);
    return { name, card, here: here.has(k), memories: count.get(k) || 0, bonds: bonds.get(k) || 0, at: card?.updated ?? card?.first ?? -1 };
  };
  const rows = [...mem.cast.map((c) => row(c.name, c)), ...strayPeople(mem).map((n) => row(n, null))];
  return rows.sort((a, b) => +!a.card - +!b.card || +b.here - +a.here || +!!a.card?.disabled - +!!b.card?.disabled || b.at - a.at || b.memories - a.memories || a.name.localeCompare(b.name));
}
function matchPerson(p, query) {
  const words = String(query || "").normalize("NFKC").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [p.name, ...p.card?.aka || [], p.card?.role, p.card?.occupation].filter(Boolean).join(" ").normalize("NFKC").toLowerCase();
  return words.every((w) => hay.includes(w));
}
const NOW_SLOTS = {
  location: "location",
  place: "location",
  whereabouts: "location",
  position: "location",
  activity: "activity",
  doing: "activity",
  action: "activity",
  task: "activity",
  posture: "activity",
  outfit: "outfit",
  clothing: "outfit",
  clothes: "outfit",
  attire: "outfit",
  dress: "outfit",
  injury: "injury",
  injuries: "injury",
  wound: "injury",
  wounds: "injury",
  condition: "injury",
  health: "injury",
  physical_state: "injury",
  mood: "mood",
  emotion: "mood",
  emotions: "mood",
  feeling: "mood",
  feelings: "mood"
};
const NOW_ORDER = ["location", "activity", "outfit", "injury", "mood", "other"];
const nowKind = (slot) => NOW_SLOTS[String(slot || "").trim().toLowerCase().replace(/[\s-]+/g, "_")] || "other";
const SCENES_MAX = 10;
const byTurnDesc = (a, b) => (b.turn ?? -1) - (a.turn ?? -1) || (b.ts || 0) - (a.ts || 0);
function personPage(mem, base) {
  const names = [...new Set([base.name, ...base.card?.aka || []].filter(Boolean))], keys = new Set(names.map(nameKey)), is = (n) => !!n && keys.has(nameKey(n)), has = (xs) => (xs || []).some(is);
  const now = base.states.filter((s) => !isScene(s.entity)).map((row) => ({ kind: nowKind(row.slot), row })).sort((a, b) => NOW_ORDER.indexOf(a.kind) - NOW_ORDER.indexOf(b.kind) || +(a.row.claim === "belief") - +(b.row.claim === "belief") || (b.row.turn || 0) - (a.row.turn || 0));
  const bonds = [];
  for (const [list, dir] of [[base.bondsOut, "out"], [base.bondsIn, "in"]]) for (const b of list) {
    const step = b.log?.[b.log.length - 1];
    if (step) bonds.push({ bond: b, dir, other: dir === "out" ? b.to : b.from, step });
  }
  const recent = /* @__PURE__ */ new Map();
  for (const x of bonds) recent.set(nameKey(x.other), Math.max(recent.get(nameKey(x.other)) || 0, x.step.turn || 0));
  bonds.sort((a, b) => (recent.get(nameKey(b.other)) || 0) - (recent.get(nameKey(a.other)) || 0) || nameKey(a.other).localeCompare(nameKey(b.other)) || +(a.dir === "in") - +(b.dir === "in"));
  const dimOf = /* @__PURE__ */ new Map();
  for (const m of base.dim) {
    const d = (m.dim || []).find((x) => is(x.who));
    if (d) dimOf.set(m.id, d);
  }
  const about = (m) => +has(m.entities), aboutFirst = (a, b) => about(b) - about(a) || byTurnDesc(a, b);
  const live = mem.memories.filter((m) => !m.disabled && !(m.tags || []).includes("episode_raw"));
  const absent = live.filter((m) => (m.visibility || "public") === "public" && (m.witnesses || []).length > 0 && !has(m.witnesses)).sort(aboutFirst);
  const unaware = live.filter((m) => (m.visibility || "public") !== "public" && !is(m.owner) && !has(m.knowers) && !has(m.guessers)).sort(aboutFirst);
  const resolved = mem.pledges.filter((p) => p.status === "resolved" && (is(p.owner) || mentions(`${p.summary} ${p.latest?.text || ""}`, names)));
  const items = mem.items.filter((it) => mentions(it.holder, names)).sort((a, b) => +(a.dormant != null) - +(b.dormant != null) || (b.updated ?? b.turn ?? 0) - (a.updated ?? a.turn ?? 0));
  const scenes = mem.memories.filter((m) => has(m.entities)).sort(byTurnDesc).slice(0, SCENES_MAX);
  return { base, names, here: presentKeys(mem).has(nameKey(base.name)), now, bonds, dimOf, absent, unaware, resolved, items, scenes };
}
const HANGUL = /[\uac00-\ud7a3]/;
function nameInside(a, b) {
  const A = String(a || "").trim(), B = String(b || "").trim(), ka = nameKey(A), kb = nameKey(B);
  if (!ka || !kb || ka === kb) return false;
  const [long, short, ks, kl] = ka.length >= kb.length ? [A, B, kb, ka] : [B, A, ka, kb];
  if (ks.length < 2) return false;
  if (long.split(/[\s·\-_.]+/).some((tok) => nameKey(tok) === ks)) return true;
  return HANGUL.test(short) && !/\s/.test(long) && kl.endsWith(ks) && kl.length - ks.length <= 2;
}
const pairKey = (a, b) => [nameKey(a), nameKey(b)].sort().join("|");
const SUGGEST_MAX = 40;
function nameSuggestions(mem, sameSound = () => false) {
  const apart = new Set(mem.nameApart || []), out = [], seen = /* @__PURE__ */ new Set();
  const cards = mem.cast.map((c) => ({ name: c.name, all: [c.name, ...c.aka || []].filter(Boolean), card: true, person: true }));
  const known = new Set(cards.flatMap((c) => c.all).map(nameKey)), people = strayPeople(mem), peopleKeys = new Set(people.map(nameKey));
  const things = [...new Map(mem.memories.flatMap((m) => m.entities || []).map((e) => [nameKey(e), String(e).trim()])).entries()].filter(([k, e]) => k && !known.has(k) && !peopleKeys.has(k) && k !== "scene" && e.length <= 40).map(([, e]) => e);
  const ids = [...cards, ...people.map((n) => ({ name: n, all: [n], card: false, person: true })), ...things.map((n) => ({ name: n, all: [n], card: false, person: false }))];
  const push = (x, y, why) => {
    const key = pairKey(x.name, y.name);
    if (seen.has(key) || apart.has(key)) return;
    seen.add(key);
    out.push({ a: x.name, b: y.name, why, key, aCard: x.card, bCard: y.card });
  };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const x = ids[i], y = ids[j];
    if (!x.card && !y.card && !(x.person && y.person)) continue;
    if (x.card && y.card && x.all.some((n) => y.all.some((m) => nameKey(n) === nameKey(m)))) {
      push(x, y, "aka");
      continue;
    }
    if (x.all.some((n) => y.all.some((m) => sameSound(n, m)))) {
      push(x, y, "sound");
      continue;
    }
    if (x.person && y.person && x.all.some((n) => y.all.some((m) => nameInside(n, m)))) push(x, y, "part");
  }
  const order = { aka: 0, sound: 1, part: 2 };
  return out.sort((a, b) => order[a.why] - order[b.why] || +b.aCard + +b.bCard - (+a.aCard + +a.bCard)).slice(0, SUGGEST_MAX);
}
function planMerge(mem, names, rep) {
  const picked = [...new Map(names.map((n) => [nameKey(n), String(n).trim()])).entries()].filter(([k]) => k);
  const cardOf = (k) => mem.cast.find((c) => nameKey(c.name) === k || (c.aka || []).some((a) => nameKey(a) === k)) || null;
  const cards = [...new Set(picked.map(([k]) => cardOf(k)).filter((c) => !!c))];
  const keep = cardOf(nameKey(rep)) || cards[0] || null, taken = new Set(cards.flatMap((c) => [c.name, ...c.aka || []]).map(nameKey));
  return { keep, rename: !!keep && nameKey(keep.name) !== nameKey(rep), cards: cards.filter((c) => c !== keep), aliases: picked.filter(([k]) => !taken.has(k) && k !== nameKey(rep)).map(([, n]) => n) };
}
export {
  NOW_ORDER,
  canonOf,
  matchPerson,
  mentions,
  nameInside,
  nameKey,
  nameSuggestions,
  nowKind,
  pairKey,
  peopleList,
  personPage,
  planMerge,
  presentKeys,
  strayPeople
};

const WIPE_KINDS = ["memories", "cast", "bonds", "pledges", "canon", "status", "items", "summaries", "dossier"];
function wipeCounts(mem) {
  return { memories: mem.memories.length, cast: mem.cast.length, bonds: (mem.bonds || []).length, pledges: mem.pledges.length, canon: mem.canon.length, status: mem.status.length, items: mem.items.length, summaries: mem.chunks.length + mem.arcs.length, dossier: mem.dossier.length };
}
function wipeShelves(mem, kinds) {
  const pick = new Set(kinds), before = wipeCounts(mem);
  let n = 0;
  for (const k of pick) n += before[k] || 0;
  if (pick.has("memories")) {
    mem.memories = [];
    mem.consolidatedAt = 0;
  }
  if (pick.has("cast")) mem.cast = [];
  if (pick.has("bonds")) mem.bonds = [];
  if (pick.has("pledges")) mem.pledges = [];
  if (pick.has("canon")) mem.canon = [];
  if (pick.has("status")) mem.status = [];
  if (pick.has("items")) mem.items = [];
  if (pick.has("summaries")) {
    mem.chunks = [];
    mem.arcs = [];
    mem.chunked = 0;
    mem.arcAt = 0;
    delete mem.arcCursor;
  }
  if (pick.has("dossier")) mem.dossier = [];
  if (pick.has("cast") && mem.nameApart) delete mem.nameApart;
  return n;
}
export {
  WIPE_KINDS,
  wipeCounts,
  wipeShelves
};
