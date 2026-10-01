import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream, chmodSync, renameSync } from 'node:fs';
import { platform } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { dataDir } from './config.js';
import { log } from './log.js';

const execFileAsync = promisify(execFile);
const isWin = platform() === 'win32';
const binName = isWin ? 'yt-dlp.exe' : (platform() === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp');

const binDir = path.join(dataDir, 'bin');
const ytdlpPath = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');

function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim().split('\n').pop() || `yt-dlp exited with ${code}`));
    });
  });
}

export const ytdlp = {
  path: ytdlpPath,

  /** Downloads yt-dlp on first run, updates it on later runs (YouTube breaks old versions often). */
  async ensure() {
    if (!existsSync(ytdlpPath)) {
      mkdirSync(binDir, { recursive: true });
      const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binName}`;
      log.info('Downloading yt-dlp…');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`yt-dlp download failed: HTTP ${res.status}`);
      const tmp = `${ytdlpPath}.download`;
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      renameSync(tmp, ytdlpPath);
      if (!isWin) chmodSync(ytdlpPath, 0o755);
      log.info('yt-dlp downloaded.');
      return;
    }
    try {
      const { stdout, stderr } = await execFileAsync(ytdlpPath, ['-U'], { windowsHide: true });
      const line = `${stdout}${stderr}`.split('\n').map((l) => l.trim()).filter(Boolean).pop();
      log.info(`yt-dlp: ${line || 'up to date'}`);
      this._version = null;
    } catch (e) {
      log.warn('yt-dlp update failed, continuing with current version:', e.message);
    }
  },

  // Cached: spawning yt-dlp is slow and the dashboard polls status every few seconds.
  _version: null,
  async version() {
    if (!this._version) this._version = run(['--version']).then((v) => v.trim(), () => null);
    return this._version;
  },

  async info(url) {
    return JSON.parse(await run([url, '--dump-json', '--no-playlist', '--no-warnings']));
  },

  async search(query, limit = 5) {
    const out = await run([`ytsearch${limit}:${query}`, '--flat-playlist', '--dump-json', '--no-warnings']);
    return out.split('\n').filter(Boolean).map((line) => {
      const v = JSON.parse(line);
      return {
        id: v.id,
        title: v.title,
        channel: v.channel || v.uploader || null,
        duration: v.duration ?? null,
        url: `https://www.youtube.com/watch?v=${v.id}`
      };
    });
  },

  /** Starts streaming audio to stdout. Caller owns the returned process. */
  stream(url) {
    const proc = spawn(
      ytdlpPath,
      [url, '-f', 'bestaudio[ext=webm]/bestaudio/best', '--no-playlist', '--quiet', '--no-warnings', '-o', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    // Drain stderr so the pipe buffer never fills up and blocks yt-dlp.
    proc.stderr.on('data', () => {});
    return proc;
  }
};
