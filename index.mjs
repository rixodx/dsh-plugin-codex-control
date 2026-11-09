import fs from 'node:fs/promises';
import path from 'node:path';
import { bridgeRoot } from './paths.mjs';

export const name = 'codex-cli-desktop-bridge';
export const inject = ['sessionController', 'workspaceRegistry', 'pluginManager'];

export async function apply(ctx, config = {}) {
  const root = config.bridgeDirectory ? path.resolve(config.bridgeDirectory) : bridgeRoot();
  const incoming = path.join(root, 'incoming');
  const processing = path.join(root, 'processing');
  const outgoing = path.join(root, 'outgoing');
  await Promise.all([incoming, processing, outgoing].map(p => fs.mkdir(p, { recursive: true, mode: 0o700 })));
  const abort = new AbortController();
  const active = new Set();
  let scanning = false;
  let stopped = false;
  const write = async (file, value) => {
    const temp = file + '.tmp';
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
  };
  const dispatch = async r => {
    const api = ctx.sessionController;
    const signal = abort.signal;
    const sessionId = r.sessionId;
    if (!Number.isFinite(r.expiresAt) || Date.now() > r.expiresAt) throw new Error('Request expired; no action performed');
    if (r.op === 'ping') return { pid: process.pid, name, version: '1.0.2', bridgeDirectory: root };
    if (r.op === 'plugin-status') {
      const result = await ctx.pluginManager.listBundles();
      const bundles = Array.isArray(result) ? result : result.bundles;
      return bundles.find(b => b.name === 'dsh-plugin-codex-control') || { found: false };
    }
    if (r.op === 'workspaces') return ctx.workspaceRegistry.list().map(w => ({ id: w.id, path: w.path, title: w.title }));
    if (r.op === 'list') return api.list({}, signal);
    if (r.op === 'create') {
      let workspaceId = r.workspaceId;
      if (r.cwd) {
        if (!path.isAbsolute(r.cwd)) throw new Error('cwd must be an absolute directory');
        workspaceId = (await ctx.workspaceRegistry.create(r.cwd)).id;
      }
      if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspaceId or cwd required');
      const result = await api.create({ workspaceId });
      if (r.title) await api.rename({ sessionId: result.sessionId, title: r.title });
      return result;
    }
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId required');
    if (r.op === 'state') return api.state({ sessionId }, signal);
    if (r.op === 'wait') return api.wait({ sessionId, timeoutMs: Math.min(Math.max(r.timeoutMs || 30000, 1), 45000), maxMessages: 5, ...(r.afterSeq === undefined ? {} : { afterSeq: r.afterSeq }) }, signal);
    if (r.op === 'events') return api.events({ address: { kind: 'session', sessionId }, limit: 10 }, signal);
    if (r.op === 'cancel') return api.cancel({ sessionId });
    if (r.op === 'prompt') {
      if (typeof r.text !== 'string' || !r.text.trim()) throw new Error('Nonempty text required');
      const clientTimeZone = r.clientTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      return api.prompt({ requestId: r.id, sessionId, mode: 'queue', clientTimeZone, content: [{ type: 'text', text: '[CLI] ' + r.text }] }, signal);
    }
    throw new Error('Unsupported bridge operation');
  };
  const handle = async filename => {
    if (!/^[0-9a-f-]{36}\.json$/i.test(filename)) return;
    const source = path.join(incoming, filename);
    const claimed = path.join(processing, filename);
    const response = path.join(outgoing, filename);
    let claim;
    try {
      // Exclusive creation prevents another Host or a replay from reclaiming the same ID.
      claim = await fs.open(claimed, 'wx', 0o600);
    } catch (e) {
      if (e.code === 'EEXIST' && await fs.stat(response).catch(() => null)) await fs.unlink(source).catch(() => {});
      return;
    }
    try {
      if ((await fs.stat(source)).size > 65536) throw new Error('Request exceeds 64 KiB');
      const raw = await fs.readFile(source, 'utf8');
      await claim.writeFile(raw);
      await fs.unlink(source);
      const r = JSON.parse(raw);
      if (r.id + '.json' !== filename) throw new Error('Request identity mismatch');
      const result = await dispatch(r);
      await write(response, { id: r.id, ok: true, result });
    } catch (error) {
      await fs.unlink(source).catch(() => {});
      await write(response, { id: filename.slice(0, -5), ok: false, error: { message: error.message, code: error.code } });
    } finally { await claim.close(); }
  };
  const scan = async () => {
    if (stopped || scanning) return;
    scanning = true;
    try {
      for (const f of await fs.readdir(incoming)) {
        if (!f.endsWith('.json') || active.has(f)) continue;
        active.add(f);
        void handle(f).catch(() => {}).finally(() => active.delete(f));
      }
    } finally { scanning = false; }
  };
  await write(path.join(root, 'ready.json'), { pid: process.pid, version: '1.0.2', startedAt: new Date().toISOString() });
  ctx.effect(() => {
    const timer = setInterval(() => { void scan().catch(() => {}); }, 250);
    const announce = setTimeout(() => ctx.emit?.('plugin-manager/changed'), 250);
    return () => { stopped = true; clearInterval(timer); clearTimeout(announce); abort.abort(); };
  });
}
