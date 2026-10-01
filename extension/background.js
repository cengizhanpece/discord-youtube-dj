// Service worker: receives "video changed" messages from YouTube tabs and forwards them
// to the bot running on this computer.

const DEFAULTS = { enabled: false, botUrl: 'http://localhost:1231', muteTab: true };

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

async function api(path, body) {
  const { botUrl } = await getSettings();
  const res = await fetch(`${botUrl.replace(/\/+$/, '')}${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Tabs we muted, so we can unmute exactly those when the extension is switched off.
async function rememberMuted(tabId) {
  const { muted = [] } = await chrome.storage.session.get('muted');
  if (!muted.includes(tabId)) await chrome.storage.session.set({ muted: [...muted, tabId] });
}

async function unmuteAll() {
  const { muted = [] } = await chrome.storage.session.get('muted');
  await Promise.all(muted.map((id) => chrome.tabs.update(id, { muted: false }).catch(() => {})));
  await chrome.storage.session.set({ muted: [] });
}

async function updateBadge() {
  const { enabled } = await getSettings();
  await chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#5865F2' });
}

let lastSent = { id: null, at: 0 };

async function onVideo(videoId, tab) {
  const settings = await getSettings();
  if (!settings.enabled) return;

  // The same video can be reported twice in quick succession (event + poll, two tabs…).
  if (lastSent.id === videoId && Date.now() - lastSent.at < 5000) return;
  lastSent = { id: videoId, at: Date.now() };

  if (settings.muteTab && tab?.id != null) {
    await chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
    await rememberMuted(tab.id);
  }

  try {
    await api('/api/play', { song: `https://www.youtube.com/watch?v=${videoId}` });
    await chrome.action.setBadgeText({ text: 'ON' });
  } catch (e) {
    console.warn('Could not play in Discord:', e.message);
    await chrome.action.setBadgeText({ text: '!' });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'video') {
    onVideo(msg.videoId, sender.tab);
    return;
  }
  // Popup → background helpers. Responding asynchronously requires `return true`.
  if (msg.type === 'setEnabled') {
    (async () => {
      await chrome.storage.local.set({ enabled: msg.enabled });
      if (!msg.enabled) {
        await unmuteAll();
        await api('/api/stop', {}).catch(() => {});
      }
      await updateBadge();
      sendResponse({ ok: true });
    })();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
