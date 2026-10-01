// User settings live in a per-user data directory, never next to the source code,
// so the app can be installed to Program Files and secrets never end up in git.
//
//   Windows: %APPDATA%\discord-youtube-dj
//   macOS:   ~/Library/Application Support/discord-youtube-dj
//   Linux:   $XDG_CONFIG_HOME/discord-youtube-dj (or ~/.config/...)
//
// Environment variables override the file (handy for Docker / CI):
//   DISCORD_TOKEN, PORT, DATA_DIR

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';

const APP_NAME = 'discord-youtube-dj';

function defaultDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  switch (platform()) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), APP_NAME);
    case 'darwin':
      return path.join(homedir(), 'Library', 'Application Support', APP_NAME);
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), APP_NAME);
  }
}

export const dataDir = defaultDataDir();
mkdirSync(dataDir, { recursive: true });

const configPath = path.join(dataDir, 'config.json');

const defaults = {
  token: '',
  port: 1231,
  // Last voice channel picked in the dashboard / extension / MCP. Remembered across restarts.
  guildId: '',
  channelId: '',
  // Optional text channel IDs that get a "Now playing" message.
  notificationChannels: []
};

let current = { ...defaults };
if (existsSync(configPath)) {
  try {
    current = { ...defaults, ...JSON.parse(readFileSync(configPath, 'utf-8')) };
  } catch (e) {
    console.error(`Could not parse ${configPath}, using defaults:`, e.message);
  }
}

export const config = {
  get token() { return process.env.DISCORD_TOKEN || current.token; },
  get port() { return Number(process.env.PORT || current.port); },
  get guildId() { return current.guildId; },
  get channelId() { return current.channelId; },
  get notificationChannels() { return current.notificationChannels; },
  /** True when the token comes from the environment and must not be edited from the UI. */
  get tokenFromEnv() { return !!process.env.DISCORD_TOKEN; },
  path: configPath,

  update(patch) {
    current = { ...current, ...patch };
    writeFileSync(configPath, JSON.stringify(current, null, 2));
  }
};
