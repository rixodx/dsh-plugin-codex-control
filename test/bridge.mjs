import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { apply } from '../index.mjs';

const exec = promisify(execFile);
const scripts = path.dirname(fileURLToPath(import.meta.url));
const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-control-test-'));
const root = path.join(tempHome, 'cli-bridge-v1');
let dispose;
let secondDispose;
let calls = 0;
let running = false;
let wake;
const ctx = {
  effect(f) { dispose = f(); },
  pluginManager: { listBundles: async () => [{ name: 'dsh-plugin-codex-control', installed: true, enabled: true }] },
  workspaceRegistry: { list: () => [{ id: 'test-workspace', path: tempHome, title: 'Test' }], create: async cwd => ({ id: 'test-workspace', path: cwd }) },
  sessionController: {
    create: async ({workspaceId}) => { assert.equal(workspaceId, 'test-workspace'); return {sessionId: 'created'}; },
    rename: async ({sessionId, title}) => { assert.equal(sessionId, 'created'); assert.equal(title, 'Bridge test'); },
    list: async () => ({items: [{sessionId: 'created', running: false, origin: 'user'}, {sessionId:'child', origin:'subagent'}]}),
    events: async () => ({items: []}),
    prompt: async () => { calls++; running = true; return { accepted: true }; },
    state: async () => ({ running, cursor: calls }),
    wait: async () => { await new Promise(r => { wake = r; }); return { reason: 'idle', state: { running }, output: { records: [] } }; },
    cancel: () => { running = false; wake?.(); return { accepted: true }; },
  },
};
await apply(ctx, { bridgeDirectory: root });
await apply({ ...ctx, effect(f) { secondDispose = f(); } }, { bridgeDirectory: root });
const cli = async args => JSON.parse((await exec(process.execPath, [path.join(scripts, '..', 'cli.mjs'), '--home', tempHome, ...args])).stdout);
try {
  assert.equal((await cli(['ping'])).result.version, '1.0.2');
  assert.equal((await cli(['plugin-status'])).result.installed, true);
  assert.equal((await cli(['create', '--cwd', tempHome, 'Bridge test'])).result.sessionId, 'created');
  assert.equal((await cli(['list'])).result.length, 1);
  assert.equal((await cli(['prompt', 'created', '1+1'])).result.accepted, true);
  assert.equal((await cli(['state', 'created'])).result.running, true);
  assert.deepEqual((await cli(['events', 'created'])).result.items, []);
  calls = 0;
  assert.equal((await cli(['workspaces'])).result[0].id, 'test-workspace');
  const id = randomUUID();
  const request = { id, op: 'prompt', sessionId: 'test-session', text: '1+1', expiresAt: Date.now() + 10000 };
  const input = path.join(root, 'incoming', id + '.json');
  const output = path.join(root, 'outgoing', id + '.json');
  await fs.writeFile(input, JSON.stringify(request));
  for (let i = 0; i < 30; i++) { if (await fs.stat(output).catch(() => null)) break; await delay(100); }
  assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).ok, true);
  await fs.writeFile(input, JSON.stringify(request));
  await delay(650);
  assert.equal(calls, 1, 'claimed request replayed');
  const expiredId = randomUUID();
  await fs.writeFile(path.join(root, 'incoming', expiredId + '.json'), JSON.stringify({ ...request, id: expiredId, expiresAt: 1 }));
  await delay(650);
  assert.equal(calls, 1, 'expired request executed');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'outgoing', expiredId + '.json'), 'utf8')).ok, false);
  const waiting = cli(['wait', 'test-session', '5000']);
  for (let i = 0; i < 30 && !wake; i++) await delay(100);
  assert.ok(wake, 'wait was not dispatched');
  assert.equal((await cli(['cancel', 'test-session'])).ok, true, 'cancel blocked behind wait');
  assert.equal((await waiting).result.state.running, false);
  dispose();
  secondDispose();
  dispose = undefined;
  secondDispose = undefined;
  const afterDispose = randomUUID();
  await fs.writeFile(path.join(root, 'incoming', afterDispose + '.json'), JSON.stringify({ ...request, id: afterDispose, expiresAt: Date.now() + 10000 }));
  await delay(650);
  assert.equal(calls, 1, 'unloaded plugin still consumed requests');
  console.log(JSON.stringify({ ok: true, checks: ['CLI-to-plugin request and response', 'duplicate and expired requests rejected', 'cancellation works while wait is pending', 'plugin unload stops inbox consumption'], temporaryHome: tempHome }, null, 2));
} finally { dispose?.(); secondDispose?.(); await fs.rm(tempHome, { recursive: true, force: true }); }
