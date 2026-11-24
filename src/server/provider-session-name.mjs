// Native provider metadata only: never submit a prompt or inject terminal keys.
// Claude's documented renameSession operation appends a custom-title entry:
// https://code.claude.com/docs/en/agent-sdk/typescript#renamesession
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { claudeConfigDir } from './claude-dir.mjs';
import { readCodexSelection } from './codex-selection.mjs';
import { resolveCodexLiveEndpoint, connectCodexLiveRpc } from './codex-live-rpc.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Why the provider's own name could not be written, as `reason` on the error:
// no_transcript, ambiguous, not_plain_file, mid_write, not_owner, not_found,
// unsupported, bad_request, too_many_projects. The route keeps the deck's name
// whatever the reason (session-name-route.mjs).
const unavailable = (reason = 'unavailable') => {
  throw Object.assign(new Error('provider_name_not_saved'), { code: 'provider_name_not_saved', reason });
};

export async function renameProviderSession(provider, sessionId, name, options = {}) {
  if (!uuid.test(sessionId) || typeof name !== 'string' || !name.trim()) return unavailable('bad_request');
  if (provider === 'codex') {
    const selection = await (options.readSelection ?? readCodexSelection)(options);
    const endpoint = await (options.resolveEndpoint ?? resolveCodexLiveEndpoint)(selection.originalHome, options);
    const rpc = await (options.connectRpc ?? connectCodexLiveRpc)(endpoint);
    try {
      const { thread } = await rpc.request('thread/read', { threadId: sessionId, includeTurns: false });
      if (thread?.id !== sessionId) return unavailable('not_found');
      await rpc.request('thread/name/set', { threadId: sessionId, name });
      return;
    } finally { rpc.close(); }
  }
  if (provider !== 'claude') return unavailable('unsupported');
  const root = await realpath(join(claudeConfigDir(options.env, options.home), 'projects'));
  const matches = [];
  // Only immediate project directories; never follow a transcript or project symlink.
  const dirs = await readdir(root, { withFileTypes: true });
  if (dirs.length > 10_000) return unavailable('too_many_projects');
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const parent = join(root, dir.name), path = join(parent, `${sessionId}.jsonl`);
    try {
      if (await realpath(parent) !== parent) continue;
      const info = await lstat(path);
      if (!info.isFile() || info.nlink !== 1) continue;
      matches.push({ path, info });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (matches.length !== 1) return unavailable(matches.length ? 'ambiguous' : 'no_transcript');
  const { path, info } = matches[0];
  const file = await open(path, constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await file.stat();
    if (!current.isFile() || current.dev !== info.dev || current.ino !== info.ino || current.nlink !== 1) return unavailable('not_plain_file');
    if (typeof process.getuid === 'function' && current.uid !== process.getuid()) return unavailable('not_owner');
    if (current.size > 0) {
      const last = Buffer.alloc(1);
      await file.read(last, 0, 1, current.size - 1);
      if (last[0] !== 10) return unavailable('mid_write'); // Do not splice into an in-flight JSONL write.
    }
    await file.write(JSON.stringify({ type: 'custom-title', customTitle: name, sessionId }) + '\n');
    await file.sync();
  } finally { await file.close(); }
}
