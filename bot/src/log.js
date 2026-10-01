// Logs go to the console (when there is one) and to <dataDir>/bot.log, so the
// background (windowless) process started by the installer is still debuggable.

import { appendFileSync, statSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.js';

export const logPath = path.join(dataDir, 'bot.log');
const MAX_BYTES = 1024 * 1024;

// Keep one previous log file around instead of growing forever.
try {
  if (existsSync(logPath) && statSync(logPath).size > MAX_BYTES) renameSync(logPath, `${logPath}.old`);
} catch {}

function write(level, args) {
  const msg = args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  try { appendFileSync(logPath, line + '\n'); } catch {}
  if (process.stdout.isTTY) (level === 'ERROR' ? console.error : console.log)(line);
}

export const log = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a)
};
