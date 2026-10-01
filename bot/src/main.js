// Entry point.
//
//   node src/main.js                 run in this terminal
//   node src/main.js --open          also open the dashboard in the browser
//   node src/main.js --background    detach and keep running without a window (used by the installer)
//
// Only one instance runs at a time: if the bot is already running, a new launch just
// opens the dashboard (when --open is given) and exits. That way the Start-menu shortcut
// both "starts the app" and "shows the app".

import { spawn, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { log } from './log.js';
import { ytdlp } from './ytdlp.js';
import { createServer } from './server.js';
import { startDiscord } from './player.js';

const args = new Set(process.argv.slice(2));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const dashboardUrl = `http://localhost:${config.port}`;

function openBrowser(url) {
  const cmd = platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform() === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  execFile(cmd[0], cmd[1], { windowsHide: true }, () => {});
}

async function alreadyRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/api/status`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

if (await alreadyRunning()) {
  if (args.has('--open')) openBrowser(dashboardUrl);
  else console.log(`Already running at ${dashboardUrl}`);
  process.exit(0);
}

if (args.has('--background')) {
  // Re-launch ourselves detached with no console window, then exit this (visible) process.
  const childArgs = [fileURLToPath(import.meta.url), ...[...args].filter((a) => a !== '--background')];
  spawn(process.execPath, childArgs, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  process.exit(0);
}

process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e));
process.on('uncaughtException', (e) => log.error('Uncaught exception:', e));

const app = createServer({ version });
const server = app.listen(config.port, '127.0.0.1', () => {
  log.info(`Discord YouTube DJ v${version} — dashboard: ${dashboardUrl}`);
  log.info(`Settings: ${config.path}`);
  if (args.has('--open')) openBrowser(dashboardUrl);
});
server.on('error', (e) => {
  log.error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already used by another program.` : e);
  process.exit(1);
});

await ytdlp.ensure().catch((e) => log.error('yt-dlp setup failed:', e.message));
await startDiscord();
