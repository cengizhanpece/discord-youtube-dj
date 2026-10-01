// Checks GitHub for a newer release so the dashboard (and extension) can show an
// "update available" link. Updating = run the new installer; settings are kept.

import { log } from './log.js';

const REPO = 'cengizhanpece/discord-youtube-dj';
const CHECK_EVERY = 6 * 60 * 60 * 1000;

let latest = null; // { version, url }
let lastCheck = 0;
let checking = false;

/** "1.2.10" > "1.2.9"; pre-release suffixes (e.g. "-dev") are ignored. */
export function isNewer(a, b) {
  const parse = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function check() {
  checking = true;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    });
    if (res.status === 404) latest = null; // no releases yet
    else if (res.ok) {
      const r = await res.json();
      latest = { version: r.tag_name.replace(/^v/, ''), url: r.html_url };
    }
    lastCheck = Date.now();
  } catch (e) {
    log.warn('Update check failed:', e.message);
    lastCheck = Date.now() - CHECK_EVERY + 10 * 60 * 1000; // retry in 10 minutes
  } finally {
    checking = false;
  }
}

/** Never blocks: returns the last known result and refreshes in the background when stale. */
export function getUpdateInfo(currentVersion) {
  if (!checking && Date.now() - lastCheck > CHECK_EVERY) check();
  return {
    latestVersion: latest?.version ?? null,
    updateUrl: latest?.url ?? `https://github.com/${REPO}/releases/latest`,
    updateAvailable: !!latest && isNewer(latest.version, currentVersion)
  };
}
