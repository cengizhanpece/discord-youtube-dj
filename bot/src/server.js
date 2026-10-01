// Local HTTP API + dashboard. Bound to 127.0.0.1 only.
//
// Security: any website you visit can try to send requests to localhost. To stop that:
//   - the Host header must be localhost/127.0.0.1 (blocks DNS-rebinding attacks),
//   - browser requests must come from the dashboard itself or a browser extension (Origin check),
//   - state-changing routes are POST + JSON only, so plain <form>/<img> tricks can't reach them.
// Non-browser clients (the MCP server, curl) send no Origin header and are allowed.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { ytdlp } from './ytdlp.js';
import { log, logPath } from './log.js';
import * as player from './player.js';
import { getUpdateInfo } from './updates.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const isUrl = (s) => /^https?:\/\//i.test(s);
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function createServer({ version }) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.has(host)) return res.status(403).json({ error: 'Forbidden host' });

    const origin = req.headers.origin;
    if (origin) {
      const allowed =
        /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
        /^moz-extension:\/\//.test(origin) ||
        /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin);
      if (!allowed) return res.status(403).json({ error: 'Forbidden origin' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '10kb' }));
  app.use((req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Use Content-Type: application/json' });
    }
    next();
  });

  const route = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  };
  const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

  // --- read ---------------------------------------------------------------
  app.get('/api/status', route(async () => ({
    version,
    ...getUpdateInfo(version),
    ytdlpVersion: await ytdlp.version(),
    configPath: config.path,
    logPath,
    tokenFromEnv: config.tokenFromEnv,
    ...player.getStatus()
  })));

  app.get('/api/channels', route(() => player.listVoiceChannels()));

  app.get('/api/search', route(async (req) => {
    const q = String(req.query.q || '').trim();
    if (!q) throw badRequest('Missing q');
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 10);
    return ytdlp.search(q, limit);
  }));

  // --- write --------------------------------------------------------------
  app.post('/api/channel', route((req) => {
    const { guildId, channelId } = req.body;
    if (!guildId || !channelId) throw badRequest('guildId and channelId are required');
    player.setChannel(String(guildId), String(channelId));
    return { success: true };
  }));

  // body: { song: "<url or search text>", guildId?, channelId? }
  app.post('/api/play', route(async (req) => {
    const song = String(req.body.song || req.body.url || '').trim();
    if (!song) throw badRequest('Missing song');
    let url = song;
    if (!isUrl(song)) {
      const [first] = await ytdlp.search(song, 1);
      if (!first) throw Object.assign(new Error(`No results for "${song}"`), { status: 404 });
      url = first.url;
    }
    const { guildId, channelId } = req.body;
    const result = await player.play(url, guildId && channelId ? { guildId, channelId } : undefined);
    return { ...result, url };
  }));

  app.post('/api/stop', route(() => {
    player.stop();
    return { success: true };
  }));

  app.post('/api/setup/token', route(async (req) => {
    if (config.tokenFromEnv) throw badRequest('The token is set by the DISCORD_TOKEN environment variable.');
    const token = String(req.body.token || '').trim();
    if (!token) throw badRequest('Paste your bot token first.');
    const check = await player.validateToken(token);
    if (!check.ok) throw badRequest(check.error);
    config.update({ token });
    log.info(`Token saved for ${check.user.username}`);
    await player.startDiscord();
    return { success: true, ...player.getStatus() };
  }));

  // --- dashboard ----------------------------------------------------------
  app.use(express.static(publicDir));

  return app;
}
