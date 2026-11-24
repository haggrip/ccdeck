// The goal titler as the running deck has it: wired to the event ring, the
// transcript scan the deck already runs, the preference and the machine veto,
// the group-title store and the announce. Kept out of index.mjs so the boot
// there stays one line, and out of goal-titler.mjs so that stays pure.
import { connectorsState, runAgent } from "./claude-agent.mjs";
import { eventsSince } from "./event-ring.mjs";
import { createGoalTitler, enabledConnectors } from "./goal-titler.mjs";
import { groupTitlesFor, loadGroupTitles, writeGoalTitle } from "./group-titles.mjs";
import { announceGroupTitles } from "./group-title-route.mjs";
import { heldPrefs } from "./prefs-state.mjs";
import { summarizeSessions } from "./session-summary.mjs";
import { isClaudeTranscriptPath } from "./transcript-gate.mjs";
import { scanTranscript } from "./transcript-scan.mjs";

/** Whether automatic titles may run here: the preference, and the bridge's
 *  own machine veto, read on every ask so a Settings change lands at once. */
export function goalTitlesOn(prefs = heldPrefs.current(), env = process.env) {
  return prefs?.goalTitles !== false && env.AGENTS_DECK_NO_AGENT !== "1";
}

/** The sessions on the board now: every one the ring has that has not ended. */
export function boardSessions(envelopes = eventsSince(0)) {
  return summarizeSessions(envelopes)
    .filter(r => r.state !== "ended")
    .map(r => ({ provider: r.provider, sid: r.id }));
}

/** Read the kept titles, make the titler, and hand it to the routes. */
export async function startGoalTitler({ connect } = {}) {
  await loadGroupTitles();
  const titler = createGoalTitler({
    run: runAgent,
    // Only the tools the person turned on in Settings › Connectors: the
    // bridge refuses a run that asks for any other.
    connectors: async () => enabledConnectors(await connectorsState()),
    envelopes: () => eventsSince(0),
    // The branch rides the scan that already reads the transcript for the
    // model and the usage, behind the same gate every other read takes.
    readBranch: async path => (isClaudeTranscriptPath(path) ? (await scanTranscript(path))?.gitBranch ?? null : null),
    enabled: () => goalTitlesOn(),
    titlesFor: groupTitlesFor,
    writeTitle: writeGoalTitle,
    announce: announceGroupTitles,
    log: line => console.log(`  ${line}`),
  });
  connect?.(titler, () => boardSessions());
  return titler;
}
