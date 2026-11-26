// Which pull requests and tickets each session works on, worked out from what
// the session itself did, with no model in between: the chips on Mission's
// live sessions, and the session a Todo item about one of them opens in.
//
// WHERE IT LOOKS. The session's own transcript, on the scan the deck already
// runs over it (transcript-scan.mjs folds every appended line through
// foldLinksLine), so this costs no read of its own and sees the whole session,
// not only what the event ring still holds. Each fact is one Claude Code wrote
// down itself:
//
//   a PR it opened    Claude Code's own `gitOperation.pr` on the Bash result
//                     of `gh pr create` ({ number, url, action: "created" }),
//                     believed only when the command ran gh or git itself
//   a PR it worked on `gh pr diff|review|checkout|comment|merge|edit|ready|
//                     close|reopen <PR URL>` (or <n> --repo o/r), a GitHub
//                     tool naming owner, repo and pullNumber, or
//                     `gitOperation.pr` action "edited"
//   a PR it looked at `gh pr view|checks …`, `gh api repos/o/r/pulls/n`
//   a branch it pushed `gitOperation.push.branch`
//   a ticket          a Jira or Linear tool naming its key (`issueIdOrKey`),
//                     the key a create returned, the key in a commit's
//                     message or a `gh pr create --title`
//
// and, read when asked (sessionLinks): the branch Claude Code stamps on every
// line, the session's names, and the brief's own PRs (status-gh.mjs) whose
// branch is the session's branch or one it pushed.
//
// WHAT IT DOES NOT READ. Prose. A prompt or a tool's output that mentions a
// ticket says nothing about who works on it: the session that reads the brief
// mentions every ticket on the list. A PR given only by its number, with no
// --repo beside it, is skipped: its repository is not in the line.
//
// BOUNDS. At most MAX_PRS PRs, MAX_KEYS tickets, MAX_BRANCHES pushed branches
// and MAX_CREATING open creates per transcript, the weakest and oldest going
// first; the scan's own caps bound the transcripts. A session shows at most
// SHOWN_PRS and SHOWN_KEYS of each.
import { extractRefs } from "./goal-context.mjs";

export const MAX_PRS = 8;
export const MAX_KEYS = 8;
export const MAX_BRANCHES = 4;
export const MAX_CREATING = 4;
export const MAX_CALLS = 8;
export const SHOWN_PRS = 4;
export const SHOWN_KEYS = 4;
/** The most of one command read for links: a heredoc PR body is not a link. */
const MAX_COMMAND = 20_000;

/** How sure a link is, strongest first. A Todo item opens the session whose
 *  link to it is strongest, and the chips are listed in this order. */
export const PR_HOW = Object.freeze({ created: 5, branch: 4, pushed: 4, worked: 3, viewed: 1 });
export const KEY_HOW = Object.freeze({ branch: 5, title: 4, commit: 4, pr: 4, wrote: 3, read: 2 });

/** A GitHub PR, in the shape status-gh.mjs's PR_URL takes. */
const PR_LINK = /https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9_.-]{1,100})\/pull\/(\d{1,9})/g;
// One match at a time, apart from PR_LINK: matchAll starts where the last
// exec on the same RegExp left off.
const PR_ONE = new RegExp(PR_LINK.source);
const prUrl = (owner, repo, n) => `https://github.com/${owner}/${repo}/pull/${Number(n)}`;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}$/;

/** A PR's own address, from any link to it or under it, else null. */
export function prOf(url) {
  if (typeof url !== "string") return null;
  const m = PR_ONE.exec(url);
  return m && url.startsWith(m[0]) && /^(?:[/?#]|$)/.test(url.slice(m[0].length)) ? prUrl(m[1], m[2], m[3]) : null;
}

/** A Jira or Linear key as its page names it, else null. */
export function ticketOf(url) {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    const m = /\/browse\/([A-Z][A-Z0-9]{1,9}-\d{1,6})(?:\/|$)/.exec(u.pathname)
      ?? (/(^|\.)linear\.app$/.test(u.hostname) ? /\/issue\/([A-Z][A-Z0-9]{1,9}-\d{1,6})(?:\/|$)/.exec(u.pathname) : null);
    return m ? m[1] : null;
  } catch { return null; }
}

/** The ticket keys a text names, or none. DIS-0000 is a placeholder. */
function keysIn(text) {
  return typeof text === "string" && text ? extractRefs(text).tickets.filter(k => !/-0+$/.test(k)) : [];
}

/** Branches every repository has, which name no one piece of work. */
const SHARED_BRANCHES = new Set(["main", "master", "development", "develop", "dev", "trunk", "staging", "production", "release", "head"]);
export function ownBranch(b) {
  return typeof b === "string" && b.length <= 255 && !SHARED_BRANCHES.has(b.toLowerCase()) ? b : null;
}

export function newLinksState() {
  // gitCalls: the Bash calls that ran gh or git, whose result's gitOperation
  // is believed; creating: the ticket creates whose answer names the key.
  // cwd: the folder the session's first own line was written in.
  return { prs: [], keys: [], pushed: [], gitCalls: [], creating: [], jiraHost: null, cwd: null };
}

/** Adds or strengthens one entry of a capped list: the stronger `how` and the
 *  later time win, and past `max` the weakest, then oldest, goes. */
function note(list, id, entry, ranks, max) {
  const had = list.find(e => e[id] === entry[id]);
  if (had) {
    if ((ranks[entry.how] ?? 0) > (ranks[had.how] ?? 0)) had.how = entry.how;
    if (entry.at > had.at) had.at = entry.at;
    if (entry.src && !had.src) had.src = entry.src;
    return;
  }
  list.push(entry);
  if (list.length <= max) return;
  let weakest = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i], w = list[weakest];
    if ((ranks[a.how] ?? 0) < (ranks[w.how] ?? 0) || ((ranks[a.how] ?? 0) === (ranks[w.how] ?? 0) && a.at < w.at)) weakest = i;
  }
  list.splice(weakest, 1);
}

const addPr = (s, url, how, at) => { if (url) note(s.prs, "url", { url, how, at }, PR_HOW, MAX_PRS); };
const addKey = (s, key, how, at, src = null) => { if (key) note(s.keys, "key", { key, how, at, ...(src ? { src } : {}) }, KEY_HOW, MAX_KEYS); };
const remember = (list, id, max) => {
  if (typeof id !== "string" || !id || id.length > 120) return;
  list.push(id);
  if (list.length > max) list.shift();
};

// gh or git run as a command, not named inside one (`grep 'gh pr create'`):
// Claude Code's own gitOperation is read off the command and its output, and
// it says "created" for a grep that prints a PR's address.
const RUNS_GIT = /(?:^|[\n;&|(]|\$\()\s*(?:gh|git)\s/;
// `gh pr <verb> … <PR URL>`, up to the end of that command.
const GH_PR = /\bgh\s+pr\s+(view|checks|diff|review|checkout|comment|merge|edit|ready|close|reopen)\b([^\n;&|]*)/g;
const LOOKS = new Set(["view", "checks"]);
const GH_API_PULL = /\bgh\s+api\b[^\n;&|]*?\brepos\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9_.-]{1,100})\/pulls\/(\d{1,9})\b/g;
const PR_TITLE = /\bgh\s+pr\s+(?:create|edit)\b[^\n]*?--title[ =](?:"([^"\n]{1,300})"|'([^'\n]{1,300})')/g;
// A commit's message, first line: -m "…", -m '…', or -m "$(cat <<'EOF' then its first line.
const COMMIT_MSG = /\bgit\s+commit\b[^\n]*?\s-m\s*(?:"\$\(cat\s*<<-?\s*['"]?\w+['"]?\s*\n\s*([^\n]{1,300})|"([^"\n]{1,300})|'([^'\n]{1,300}))/g;

function foldCommand(s, cmd, id, at) {
  if (typeof cmd !== "string" || !cmd) return;
  const c = cmd.length > MAX_COMMAND ? cmd.slice(0, MAX_COMMAND) : cmd;
  if (!RUNS_GIT.test(c)) return;
  remember(s.gitCalls, id, MAX_CALLS);
  for (const m of c.matchAll(GH_PR)) {
    const how = LOOKS.has(m[1]) ? "viewed" : "worked";
    let found = false;
    for (const p of m[2].matchAll(PR_LINK)) { addPr(s, prUrl(p[1], p[2], p[3]), how, at); found = true; }
    // A number is a PR only with the repository named beside it.
    const n = found ? null : /^\s+(\d{1,9})(?=\s|$)/.exec(m[2]);
    const r = n && /\s(?:--repo[= ]|-R\s*)([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9_.-]{1,100})(?=\s|$)/.exec(m[2]);
    if (r) addPr(s, prUrl(r[1], r[2], n[1]), how, at);
  }
  for (const m of c.matchAll(GH_API_PULL)) addPr(s, prUrl(m[1], m[2], m[3]), "viewed", at);
  for (const m of c.matchAll(PR_TITLE)) for (const k of keysIn(m[1] ?? m[2])) addKey(s, k, "pr", at);
  for (const m of c.matchAll(COMMIT_MSG)) for (const k of keysIn(m[1] ?? m[2] ?? m[3])) addKey(s, k, "commit", at);
}

const TICKET_SHAPE = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;
const toolTail = name => String(name ?? "").split("__").pop() ?? "";
const READS = /(?:^|[_-])(?:get|search|read|fetch|list|view|lookup)/i;
const JIRA_HOST = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/;

/** A connector's call: a ticket it names, a PR it names, or a create whose
 *  answer will name the ticket. Atlassian's tools name Jira (getJiraIssue,
 *  with the site as `cloudId`); an issue tool without either is Linear's. */
function foldTool(s, use, at) {
  const input = use.input && typeof use.input === "object" ? use.input : {};
  const tail = toolTail(use.name);
  const reads = READS.test(tail);
  const jira = /jira/i.test(tail) || typeof input.cloudId === "string";
  if (jira && JIRA_HOST.test(input.cloudId ?? "")) s.jiraHost = input.cloudId;
  for (const f of ["issueIdOrKey", "issueKey", "issueId", "id"]) {
    const v = input[f];
    if (typeof v !== "string" || !TICKET_SHAPE.test(v)) continue;
    // `id` is a Linear issue's, and only on an issue's own tool.
    if (f === "id" && !/issue/i.test(tail)) continue;
    addKey(s, v, reads ? "read" : "wrote", at, jira ? "jira" : /issue/i.test(tail) ? "linear" : null);
    break;
  }
  if (/create.*issue/i.test(tail) && typeof use.id === "string" && use.id && use.id.length <= 120) {
    s.creating.push({ id: use.id, src: jira ? "jira" : "linear" });
    if (s.creating.length > MAX_CREATING) s.creating.shift();
  }
  const n = input.pullNumber ?? input.pull_number;
  if ((typeof n === "number" || (typeof n === "string" && /^\d{1,9}$/.test(n))) && OWNER.test(input.owner ?? "") && REPO.test(input.repo ?? "")) {
    addPr(s, prUrl(input.owner, input.repo, n), reads ? "viewed" : "worked", at);
  }
}

/** The text of a tool result's content, for the key a create answered with. */
function resultText(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(x => (typeof x?.text === "string" ? x.text : "")).join("\n");
  return "";
}

function foldGitOperation(s, git, at) {
  const pr = git.pr;
  if (pr && typeof pr === "object") {
    const url = prOf(pr.url);
    if (url) addPr(s, url, pr.action === "created" ? "created" : "worked", at);
    else if (Number.isInteger(pr.number)) {
      // merged or closed: Claude Code names only the number, so it is the
      // session's own PR of that number or nothing.
      const had = s.prs.find(p => p.url.endsWith(`/pull/${pr.number}`));
      if (had && at > had.at) had.at = at;
    }
  }
  const b = ownBranch(git.push?.branch);
  if (b) {
    const i = s.pushed.indexOf(b);
    if (i >= 0) s.pushed.splice(i, 1);
    s.pushed.push(b);
    if (s.pushed.length > MAX_BRANCHES) s.pushed.shift();
  }
}

function foldResult(s, record, at) {
  const content = record.message?.content;
  if (!Array.isArray(content)) return;
  const r = record.toolUseResult;
  const git = r && typeof r === "object" && r.gitOperation && typeof r.gitOperation === "object" ? r.gitOperation : null;
  for (const c of content) {
    if (c?.type !== "tool_result") continue;
    const g = s.gitCalls.indexOf(c.tool_use_id);
    if (g >= 0) {
      s.gitCalls.splice(g, 1);
      if (git) foldGitOperation(s, git, at);
    }
    const k = s.creating.findIndex(x => x.id === c.tool_use_id);
    if (k >= 0) {
      const [{ src }] = s.creating.splice(k, 1);
      const key = c.is_error === true ? null : keysIn(resultText(c.content).slice(0, 4000))[0];
      if (key) addKey(s, key, "wrote", at, src);
    }
  }
}

// What a line has to mention to be parsed at all: everything else costs a
// handful of substring tests.
const USE_MARKS = ["gh ", "git ", "issueIdOrKey", "issueKey", "pullNumber", "pull_number", "Issue", "issue"];

/**
 * Fold one transcript line into `s` (newLinksState). `record` is the line
 * already parsed, when the scan parsed it; null otherwise. Pure: `s` is the
 * only thing written.
 */
export function foldLinksLine(s, line, record = null) {
  if (!s || !line) return;
  if (s.cwd == null && typeof record?.cwd === "string" && record.cwd.length <= 1024 && record.isSidechain !== true) s.cwd = record.cwd;
  const result = (s.gitCalls.length > 0 && line.includes('"gitOperation"')) || s.creating.some(x => line.includes(x.id));
  const use = line.includes('"tool_use"') && USE_MARKS.some(m => line.includes(m));
  if (!result && !use) return;
  let o = record;
  if (!o) { try { o = JSON.parse(line); } catch { return; } }
  if (!o || typeof o !== "object") return;
  const at = Date.parse(o.timestamp ?? "") || 0;
  if (o.type === "user") { foldResult(s, o, at); return; }
  // Only the assistant's own lines: an api-request-blob repeats earlier calls.
  if (o.type !== "assistant" || !Array.isArray(o.message?.content)) return;
  for (const c of o.message.content) {
    if (c?.type !== "tool_use") continue;
    if (c.name === "Bash") foldCommand(s, c.input?.command, c.id, at);
    else if (typeof c.name === "string" && c.name.startsWith("mcp__")) foldTool(s, c, at);
  }
}

const rankOf = (ranks, how) => ranks[how] ?? 0;
const byStrength = ranks => (a, b) => rankOf(ranks, b.how) - rankOf(ranks, a.how) || b.at - a.at;

/** A PR's repository and number, for its chip. */
export function prParts(url) {
  const m = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)$/.exec(url ?? "");
  return m ? { repo: m[1], number: Number(m[2]) } : { repo: null, number: null };
}

/**
 * What the brief's gh reads say about each PR, by its address: open, draft,
 * merged or closed, its checks and its review. `brief` is status-brief.mjs's
 * stored brief: `prs` (my open PRs, status-gh.mjs normalisePrs), `activity`
 * (what moved since the last brief) and `linkStates` (the Todo list's PRs).
 */
export function prFacts(brief) {
  const out = new Map();
  const get = url => { if (!out.has(url)) out.set(url, { state: "open", checks: null, review: null, title: null, branch: null }); return out.get(url); };
  for (const p of Array.isArray(brief?.prs) ? brief.prs : []) {
    const url = prOf(p?.url);
    if (!url) continue;
    const f = get(url);
    if (p.draft === true) f.state = "draft";
    const c = p.checks;
    if (c) f.checks = c.failed > 0 ? "fail" : c.pending > 0 ? "pending" : c.passed > 0 ? "pass" : null;
    f.review = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "required" }[p.review] ?? null;
    if (typeof p.title === "string" && p.title) f.title = p.title;
    if (ownBranch(p.branch)) f.branch = p.branch;
  }
  for (const i of Array.isArray(brief?.activity?.items) ? brief.activity.items : []) {
    const url = prOf(i?.url);
    if (!url) continue;
    const f = get(url);
    if (i.state === "merged" || i.state === "closed") f.state = i.state;
    if (!f.title && typeof i.title === "string" && i.title) f.title = i.title;
  }
  for (const l of Array.isArray(brief?.linkStates) ? brief.linkStates : []) {
    const url = prOf(l?.url);
    if (!url) continue;
    const f = get(url);
    if (l.state === "merged" || l.state === "closed") f.state = l.state;
    else if (l.state === "approved") f.review = "approved";
    else if (l.state === "green" && !f.checks) f.checks = "pass";
  }
  return out;
}

/**
 * The branch that is the session's own, or null. Claude Code stamps every line
 * with the branch of the session's folder, and a session started in a
 * repository's main checkout inherits whatever that checkout is on, which
 * other sessions move: on this machine, every session started in
 * ~/saas-platform said one ticket's branch, and some had "switched" to it
 * without doing anything. So the branch counts only when the folder is a
 * linked worktree (its `.git` is a file), or when the session pushed it.
 */
export function ownedBranch({ links = null, branch = null, worktree = false } = {}) {
  const b = ownBranch(branch);
  return b && (worktree || links?.pushed?.includes(b)) ? b : null;
}

/**
 * Where each ticket project's pages are, as { prefix: base }: from the ticket
 * links the Todo list and the brief carry (a Jira /browse/KEY or a Linear
 * /<workspace>/issue/KEY), then from the Jira sites the sessions' own Jira
 * tools named for the keys they used.
 */
export function ticketBases({ urls = [], states = [] } = {}) {
  const out = new Map();
  for (const u of Array.isArray(urls) ? urls : []) {
    const key = ticketOf(u);
    if (!key) continue;
    const prefix = key.split("-")[0];
    if (out.has(prefix)) continue;
    try {
      const url = new URL(u);
      const at = url.pathname.indexOf(`/${key}`);
      if (url.protocol === "https:" && at > 0) out.set(prefix, `${url.origin}${url.pathname.slice(0, at)}/`);
    } catch { /* not a URL */ }
  }
  for (const st of Array.isArray(states) ? states : []) {
    if (!st?.jiraHost) continue;
    for (const k of st.keys ?? []) {
      const prefix = k.key.split("-")[0];
      if (k.src === "jira" && !out.has(prefix)) out.set(prefix, `https://${st.jiraHost}/browse/`);
    }
  }
  return out;
}

/**
 * One session's PRs and tickets, strongest first, at most SHOWN_PRS and
 * SHOWN_KEYS. `links` is the transcript's folded state (or null); `branch` the
 * branch its newest line was written on and `worktree` whether its folder is a
 * linked worktree (ownedBranch); `names` its names (Claude Code's and the
 * deck's); `facts` prFacts of the brief; `bases` ticketBases.
 */
export function sessionLinks({ links = null, branch = null, worktree = false, names = [], facts = new Map(), bases = new Map() } = {}) {
  const s = newLinksState();
  for (const p of links?.prs ?? []) addPr(s, p.url, p.how, p.at);
  for (const k of links?.keys ?? []) addKey(s, k.key, k.how, k.at, k.src);
  const own = ownedBranch({ links, branch, worktree });
  const branches = new Set([own, ...(links?.pushed ?? [])].filter(Boolean));
  // The brief's PRs on a branch this session is on or pushed.
  for (const [url, f] of facts) if (f.branch && branches.has(f.branch)) addPr(s, url, f.branch === own ? "branch" : "pushed", 0);
  // A branch named after a ticket carries it in lower case: dis-1234-fix.
  for (const b of branches) for (const k of keysIn(b.toUpperCase())) addKey(s, k, "branch", 0);
  for (const n of names) for (const k of keysIn(n)) addKey(s, k, "title", 0);
  const prs = s.prs.sort(byStrength(PR_HOW)).slice(0, SHOWN_PRS);
  // The ticket a PR's title names is the session's too, for a PR it did more
  // than look at.
  for (const p of prs) if (p.how !== "viewed") for (const k of keysIn(facts.get(p.url)?.title)) addKey(s, k, "pr", 0);
  const pageOf = k => {
    const base = bases.get(k.key.split("-")[0]) ?? (k.src === "jira" && links?.jiraHost ? `https://${links.jiraHost}/browse/` : null);
    return base ? `${base}${k.key}` : null;
  };
  return {
    prs: prs.map(p => {
      const f = facts.get(p.url);
      return { url: p.url, ...prParts(p.url), how: p.how, ...(f ? { state: f.state, checks: f.checks, review: f.review } : {}) };
    }),
    keys: s.keys.sort(byStrength(KEY_HOW)).slice(0, SHOWN_KEYS).map(k => {
      const url = pageOf(k);
      return { key: k.key, how: k.how, ...(url ? { url } : {}) };
    }),
  };
}

/**
 * The session each open Todo item is about, by its link: a PR one of them
 * works on, or a ticket. `sessions` is { id: { prs, keys, lastEventAt } };
 * `opens(id)` says whether the session can be opened (the desktop app runs
 * it). An item that already names its session is left to it. The strongest
 * link wins, then the session heard from last.
 */
export function matchItems(items, sessions, { opens = () => true } = {}) {
  const out = {};
  for (const i of Array.isArray(items) ? items : []) {
    if (!i || typeof i.id !== "string" || i.link?.sessionId) continue;
    const pr = prOf(i.link?.url);
    const key = pr ? null : ticketOf(i.link?.url);
    if (!pr && !key) continue;
    let best = null;
    for (const [id, s] of Object.entries(sessions ?? {})) {
      if (!opens(id)) continue;
      const hit = pr ? s.prs?.find(p => p.url === pr) : s.keys?.find(k => k.key === key);
      if (!hit) continue;
      const rank = rankOf(pr ? PR_HOW : KEY_HOW, hit.how);
      const at = Number(s.lastEventAt) || 0;
      if (!best || rank > best.rank || (rank === best.rank && at > best.at)) best = { id, rank, at };
    }
    if (best) out[i.id] = best.id;
  }
  return out;
}
