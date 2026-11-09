#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { bridgeRoot } from './paths.mjs';

const args = process.argv.slice(2);
let home;
if (args[0] === '--home') { args.shift(); home = args.shift(); if (!home) throw new Error('--home requires a path'); }
const [op, target, ...rest] = args;
const allowed = new Set(['ping', 'plugin-status', 'workspaces', 'list', 'create', 'prompt', 'state', 'wait', 'events', 'cancel']);
if (!allowed.has(op)) {
  console.error('Usage: harness-control [--home HOME] ping|plugin-status|workspaces|list|create WORKSPACE_ID [TITLE]|create --cwd PATH [TITLE]|prompt SESSION_ID TEXT|prompt SESSION_ID --file PATH|state SESSION_ID|wait SESSION_ID [MS] [AFTER_SEQ]|events SESSION_ID|cancel SESSION_ID');
  process.exit(2);
}
const root = bridgeRoot(home);
const request = { id: randomUUID(), op, expiresAt: Date.now() + 120000 };
if (op === 'create') {
  if (target === '--cwd') Object.assign(request, { cwd: rest[0], title: rest.slice(1).join(' ') });
  else Object.assign(request, { workspaceId: target, title: rest.join(' ') });
} else if (!['ping', 'plugin-status', 'workspaces', 'list'].includes(op)) {
  if (!target) throw new Error('sessionId required');
  request.sessionId = target;
}
if (op === 'prompt') {
  request.text = rest[0] === '--file' ? await fs.readFile(rest[1], 'utf8') : rest.join(' ');
  if (!request.text.trim()) throw new Error('Nonempty prompt required');
  request.clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
}
if (op === 'wait') {
  request.timeoutMs = Number(rest[0] || 30000);
  if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) throw new Error('timeout must be positive milliseconds');
  if (rest[1] !== undefined) {
    request.afterSeq = Number(rest[1]);
    if (!Number.isSafeInteger(request.afterSeq) || request.afterSeq < 0) throw new Error('afterSeq must be a nonnegative integer');
  }
}
const incoming = path.join(root, 'incoming');
await fs.mkdir(incoming, { recursive: true, mode: 0o700 });
const pending = path.join(incoming, request.id + '.json');
await fs.writeFile(pending + '.tmp', JSON.stringify(request), { mode: 0o600 });
await fs.rename(pending + '.tmp', pending);
const response = path.join(root, 'outgoing', request.id + '.json');
const deadline = Date.now() + (op === 'wait' ? Math.min(request.timeoutMs, 45000) + 10000 : 20000);
while (Date.now() < deadline) {
  try {
    const value = JSON.parse(await fs.readFile(response, 'utf8'));
    if (value.ok && op === 'wait') value.result = { reason: value.result.reason, state: value.result.state, messages: value.result.output.records.map(r => ({ seq: r.event.seq, text: (r.event.data.message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n') })) };
    if (value.ok && op === 'list') value.result = value.result.items.filter(s => s.origin !== 'subagent').map(s => ({ sessionId: s.sessionId, title: s.projections?.values?.title || '', cwd: s.cwd, running: s.running, agentAvailable: s.agentAvailable }));
    console.log(JSON.stringify(value, null, 2));
    process.exitCode = value.ok ? 0 : 1;
    break;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await delay(150);
}
if (process.exitCode === undefined) {
  try { await fs.unlink(pending); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  console.error(JSON.stringify({ ok: false, error: 'No bridge response; outcome may be unknown. Inspect request before retrying.', requestId: request.id, bridgeDirectory: root }));
  process.exitCode = 1;
}
