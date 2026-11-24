// The board's group titles over HTTP, and how they reach every page.
//
//   POST /api/group-title        { provider, sessionId, name: string | null }
//        A person titles a group, or clears the title they gave it (an empty
//        name, or null). Answers { ok: true, name } with the name as kept, or
//        { ok: false, reason }: bad_request, not_saved.
//
//   POST /api/group-title/auto   { provider, sessionId }   or   { all: true }
//        The goal titler, now (goal-titler.mjs): one group, answered once the
//        run is done with { ok: true, title } or { ok: false, reason }; or
//        every group on the board no person has named, answered at once with
//        { ok: true, queued }. Reasons: off, named, empty, budget, unavailable,
//        failed, bad_request.
//
//   GET  /api/group-title/status
//        { enabled, available, running, queued, budget }: what the Settings
//        row and the board's button say.
//
// Every title travels on `SessionNamed` (group-titles.mjs says why): the
// person's as `groupName`, the titler's as `goalTitle`. A write is announced
// as it lands and logged, so a reload and a restart replay it; the boot tells
// the sessions the replay put back (announceKeptGroupTitles), and a session
// heard from again later is told once on its first live event
// (noteGroupEvent), for the log a rotation or a Clear took it out of.
//
// Behind the same gates as every other route (index.mjs).
import { PRODUCT } from "./brand.mjs";
import { pushEvent } from "./event-sink.mjs";
import { readBody, send } from "./http-io.mjs";
import { cleanGroupName, groupTitleKey, groupTitlesFor, heldGroupTitles, writeGroupName } from "./group-titles.mjs";
import { isEventOnly } from "./provider-ids.mjs";

let _titler = null;
let _sessions = () => [];

/** The deck's titler, and where the board's sessions are read from, wired at
 *  boot (index.mjs). Without one, the auto routes answer `unavailable`. */
export function connectGoalTitler(titler, sessions = () => []) {
  _titler = titler;
  _sessions = sessions;
}

/** The fields a page is told for a held entry: the person's name and the
 *  automatic title, each present only when held. */
function fieldsOf(entry) {
  const out = {};
  if (entry?.name) out.groupName = entry.name;
  if (entry?.auto) out.goalTitle = entry.auto;
  return out;
}

/** Tell every page a group's titles. A field set to null says "cleared". */
export function announceGroupTitles(sid, fields, opts) {
  pushEvent({ hook_event_name: "SessionNamed", session_id: sid, ...fields }, "internal", opts);
}

const announced = new Set();

/**
 * At boot, after the log's replay: each held group whose session the replay
 * put back in the ring, announced once and not logged again. Answers how many.
 */
export function announceKeptGroupTitles(envelopes, announce = announceGroupTitles) {
  const seen = new Set();
  for (const e of envelopes) {
    const sid = e?.payload?.session_id;
    if (typeof sid === "string" && sid) seen.add(sid);
  }
  let told = 0;
  for (const [, sid, entry] of heldGroupTitles()) {
    if (!seen.has(sid)) continue;
    announced.add(sid);
    announce(sid, fieldsOf(entry), { persist: false });
    told++;
  }
  return told;
}

/**
 * Every event the pipeline takes, after it is in the ring (event-pipeline.mjs).
 * A Clear forgets which sessions were told. A session's own live word tells
 * the pages its held titles once per run, and goes to the titler, which arms
 * its wait for a session that said something a title could come from.
 */
export function noteGroupEvent(raw, source, opts = {}, { titler = _titler, announce = announceGroupTitles } = {}) {
  if (!raw || typeof raw !== "object") return;
  if (raw.hook_event_name === "__clear") { announced.clear(); return; }
  if (opts.replay) return;
  const sid = raw.session_id;
  if (typeof sid !== "string" || !sid || isEventOnly(raw.provider)) return;
  const provider = source === "codex" || raw.provider === "codex" ? "codex" : "claude";
  const own = source === "hook" || source === "codex";
  if (own && !announced.has(sid)) {
    announced.add(sid);
    const entry = groupTitlesFor(provider, sid);
    if (entry) queueMicrotask(() => announce(sid, fieldsOf(entry), { persist: false }));
  }
  // The transcript's naming arrives as an internal SessionNamed: it is a
  // session saying what it is called, which is worth a title too.
  if (own || (source === "internal" && raw.hook_event_name === "SessionNamed")) titler?.note(raw, provider);
}

async function readJson(req, res) {
  const raw = await readBody(req, res).catch(() => null);
  try { const body = JSON.parse(raw ?? ""); return body && typeof body === "object" ? body : null; } catch { return null; }
}

export async function handleGroupTitleWrite(req, res, { write = writeGroupName, announce = announceGroupTitles } = {}) {
  const body = await readJson(req, res);
  if (!body) return send(res, 400, { ok: false, reason: "bad_request" });
  const provider = body.provider ?? "claude";
  const { sessionId } = body;
  const name = cleanGroupName(body.name === "" ? null : body.name);
  if (!groupTitleKey(provider, sessionId) || name === undefined) return send(res, 400, { ok: false, reason: "bad_request" });
  let kept;
  try {
    kept = await write(provider, sessionId, name);
  } catch (err) {
    // The error's code only: never the path, never the name.
    console.error(`${PRODUCT}: a group title was not saved (${err?.code ?? "error"})`);
    return send(res, 500, { ok: false, reason: "not_saved" });
  }
  announce(sessionId, { groupName: kept });
  return send(res, 200, { ok: true, name: kept });
}

export async function handleGoalTitleRequest(req, res, { titler = _titler, sessions = _sessions } = {}) {
  const body = await readJson(req, res);
  if (!body) return send(res, 400, { ok: false, reason: "bad_request" });
  if (!titler) return send(res, 200, { ok: false, reason: "unavailable" });
  if (body.all === true) return send(res, 200, titler.requestAll(sessions()));
  const provider = body.provider ?? "claude";
  if (!groupTitleKey(provider, body.sessionId)) return send(res, 400, { ok: false, reason: "bad_request" });
  return send(res, 200, await titler.request(provider, body.sessionId));
}

export function handleGoalTitleStatus(_req, res, { titler = _titler } = {}) {
  if (!titler) return send(res, 200, { enabled: false, available: false, running: false, queued: 0, budget: 0 });
  return send(res, 200, titler.status());
}

/** Tests only. */
export function resetGroupAnnouncedForTest() {
  announced.clear();
  _titler = null;
  _sessions = () => [];
}
