// The titles over the board's groups: what each session's group is FOR.
//
// The board frames every session with its subagents and labels that group by
// the folder it runs in, and a folder says little about a goal: four sessions
// in `web-app` read alike, and `scratch-2026-11-12-e1d41a` says nothing.
// A group can carry two titles instead, kept here:
//
//   name   the one a person typed on the board. It always wins.
//   auto   the one the goal titler wrote (goal-titler.mjs): a few words from
//          the session's own titles, prompts, branch and the tickets and pull
//          requests it mentions. Drawn while no person has named the group.
//
// Clearing the name brings the automatic title back; with neither, the folder
// is the label again. The folder never goes away: the board keeps it as the
// secondary text and in the tooltip.
//
// Keyed like the deck's session names (session-deck-names.mjs), by provider
// and session id, since a group on the board is one session and what it
// started. The file lives in the deck's data folder beside session-names.json.
//
// HOW IT REACHES A PAGE. On a `SessionNamed` event, as the deck's session name
// does, with two more fields: `groupName` (the person's, or null for cleared)
// and `goalTitle` (the automatic one, or null). An absent field says nothing,
// so the transcript's own naming, which keeps arriving, never touches either.
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deckDataDir } from "./deck-home.mjs";
import { writeFileAtomic } from "./atomic-write.mjs";
import { cleanDeckName, deckNameKey, DECK_NAMES_CAP } from "./session-deck-names.mjs";

/** The longest title a person may type, in code points: the session name's. */
export const GROUP_NAME_MAX = 120;
/** The longest automatic title kept. The titler asks for three to six words;
 *  a model that wrote a paragraph is cut here rather than drawn whole. */
export const GOAL_TITLE_MAX = 60;
/** The most groups kept. Past it the oldest goes. */
export const GROUP_TITLES_CAP = DECK_NAMES_CAP;

export function groupTitlesPath(home = deckDataDir()) {
  return join(home, "group-titles.json");
}

/** Where a group's titles are kept: the session's deck-name key. */
export const groupTitleKey = deckNameKey;

/** A title as a person typed it, cleaned the way a session name is: one line,
 *  no invisible marks. Null for empty or null (cleared), undefined for
 *  anything that is not a title. */
export function cleanGroupName(raw) {
  const clean = cleanDeckName(raw);
  return typeof clean === "string" ? [...clean].slice(0, GROUP_NAME_MAX).join("").trim() : clean;
}

/**
 * An automatic title as kept: one line, no quotes or trailing full stop, at
 * most GOAL_TITLE_MAX code points, cut at a word where it can be. Null for
 * anything that leaves nothing.
 */
export function cleanGoalTitle(raw) {
  const one = cleanDeckName(typeof raw === "string" ? raw : null);
  if (typeof one !== "string") return null;
  const bare = one.replace(/^["'“”‘’`*_#\s]+|["'“”‘’`*_\s]+$/g, "").replace(/[.。]+$/, "").trim();
  if (!bare) return null;
  const chars = [...bare];
  if (chars.length <= GOAL_TITLE_MAX) return bare;
  const cut = chars.slice(0, GOAL_TITLE_MAX).join("");
  const space = cut.lastIndexOf(" ");
  return (space > GOAL_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

function entryOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  const name = cleanGroupName(raw.name);
  if (typeof name === "string") { out.name = name; out.nameAt = Number.isFinite(raw.nameAt) ? raw.nameAt : 0; }
  const auto = cleanGoalTitle(raw.auto);
  if (auto) {
    out.auto = auto;
    out.autoAt = Number.isFinite(raw.autoAt) ? raw.autoAt : 0;
    if (typeof raw.basis === "string" && raw.basis.length <= 128) out.basis = raw.basis;
  }
  return out.name || out.auto ? out : null;
}

const newest = e => Math.max(e.nameAt ?? 0, e.autoAt ?? 0);

/** Whatever is on disk, as a map of key to entry. A file this version cannot
 *  read is no titles, not an error: the deck still runs. */
export function normaliseGroupTitles(raw) {
  const out = new Map();
  const groups = raw && typeof raw === "object" && raw.groups && typeof raw.groups === "object" ? raw.groups : {};
  for (const [key, value] of Object.entries(groups)) {
    const cut = key.indexOf(":");
    if (cut < 0 || groupTitleKey(key.slice(0, cut), key.slice(cut + 1)) !== key) continue;
    const entry = entryOf(value);
    if (entry) out.set(key, entry);
  }
  return capGroupTitles(out);
}

export function capGroupTitles(map) {
  if (map.size <= GROUP_TITLES_CAP) return map;
  return new Map([...map].sort((a, b) => newest(b[1]) - newest(a[1])).slice(0, GROUP_TITLES_CAP));
}

// As last read or written. This process is the file's only writer.
let _held = null;
let _path = null;

/** Read the file once, as the deck starts. Later calls answer what is held. */
export async function loadGroupTitles(path = groupTitlesPath()) {
  if (_held && _path === path) return _held;
  _path = path;
  try { _held = normaliseGroupTitles(JSON.parse(await readFile(path, "utf8"))); } catch { _held = new Map(); }
  return _held;
}

/** A group's titles, `{ name?, auto?, basis? }`, or undefined for none. */
export function groupTitlesFor(provider, sessionId) {
  const key = groupTitleKey(provider, sessionId);
  return key && _held ? _held.get(key) : undefined;
}

/** Every group held, as [provider, sessionId, entry] — the boot's announce. */
export function heldGroupTitles() {
  if (!_held) return [];
  return [..._held].map(([key, entry]) => {
    const cut = key.indexOf(":");
    return [key.slice(0, cut), key.slice(cut + 1), entry];
  });
}

let _writes = Promise.resolve();
function update(provider, sessionId, change, { path = groupTitlesPath(), writeFile = writeFileAtomic } = {}) {
  const key = groupTitleKey(provider, sessionId);
  if (!key) return Promise.reject(new TypeError("not a session the deck names"));
  const done = _writes.then(async () => {
    const before = await loadGroupTitles(path);
    const next = new Map(before);
    const entry = { ...(next.get(key) ?? {}) };
    change(entry);
    if (entry.name || entry.auto) next.set(key, entry); else next.delete(key);
    const kept = capGroupTitles(next);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${JSON.stringify({ version: 1, groups: Object.fromEntries(kept) })}\n`);
    _held = kept;
    return kept.get(key);
  });
  _writes = done.catch(() => {});
  return done;
}

/**
 * Keep the title a person typed for a group, or clear it with null. Written
 * whole and atomically before memory changes. Answers the name kept, or null.
 */
export async function writeGroupName(provider, sessionId, name, { now = Date.now(), ...io } = {}) {
  const clean = cleanGroupName(name);
  if (clean === undefined) throw new TypeError("not a name");
  const entry = await update(provider, sessionId, e => {
    if (clean === null) { delete e.name; delete e.nameAt; } else { e.name = clean; e.nameAt = now; }
  }, io);
  return entry?.name ?? null;
}

/**
 * Keep the goal titler's title for a group, with the basis it was written
 * from (goal-context.mjs contextBasis), or clear it with null. Answers the
 * title kept, or null.
 */
export async function writeGoalTitle(provider, sessionId, title, { basis, now = Date.now(), ...io } = {}) {
  const clean = title === null ? null : cleanGoalTitle(title);
  if (title !== null && !clean) throw new TypeError("not a title");
  const entry = await update(provider, sessionId, e => {
    if (clean === null) { delete e.auto; delete e.autoAt; delete e.basis; return; }
    e.auto = clean; e.autoAt = now;
    if (typeof basis === "string" && basis) e.basis = basis.slice(0, 128); else delete e.basis;
  }, io);
  return entry?.auto ?? null;
}

/** Tests only: forget what is held, as a new process would. */
export function resetGroupTitlesForTest() {
  _held = null;
  _path = null;
  _writes = Promise.resolve();
}
