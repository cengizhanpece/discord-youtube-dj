const REPO = 'https://github.com/cengizhanpece/discord-youtube-dj';
const DEFAULTS = { enabled: false, botUrl: 'http://localhost:1231', muteTab: true };

const $ = (id) => document.getElementById(id);
const msg = (key) => chrome.i18n.getMessage(key) || key;

document.querySelectorAll('[data-msg]').forEach((el) => (el.textContent = msg(el.dataset.msg)));
document.querySelectorAll('[data-msg-title]').forEach((el) => (el.title = msg(el.dataset.msgTitle)));
$('downloadLink').href = `${REPO}/releases/latest`;

let settings;

async function api(path, body) {
  const res = await fetch(`${settings.botUrl.replace(/\/+$/, '')}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setStatus(kind, text) {
  $('dot').className = 'dot ' + kind;
  $('statusText').textContent = text;
}

async function refresh() {
  $('dashboard').href = settings.botUrl;
  let status;
  try {
    status = await api('/api/status');
  } catch {
    setStatus('err', msg('statusOffline'));
    $('offline').classList.remove('hidden');
    $('online').classList.add('hidden');
    return;
  }
  $('offline').classList.add('hidden');

  if (status.discord !== 'ready') {
    setStatus('err', msg('statusNeedsSetup'));
    $('online').classList.add('hidden');
    return;
  }
  setStatus('ok', status.botUser.tag);
  $('online').classList.remove('hidden');

  const channels = await api('/api/channels');
  const current = `${status.currentGuild.id}|${status.currentGuild.channelId}`;
  $('channel').innerHTML = '';
  if (!channels.some((c) => `${c.guildId}|${c.channelId}` === current)) {
    $('channel').add(new Option(msg('pickChannel'), ''));
  }
  for (const c of channels) {
    const opt = new Option(`${c.canJoin === false ? '🔒 ' : ''}${c.guildName} › ${c.channelName}`, `${c.guildId}|${c.channelId}`);
    // Locked = the bot lacks View Channel / Connect / Speak there. The dashboard explains how to fix it.
    opt.disabled = c.canJoin === false;
    $('channel').add(opt);
  }
  $('channel').value = channels.some((c) => `${c.guildId}|${c.channelId}` === current) ? current : '';

  $('np').textContent = status.nowPlaying?.title || msg('nothingPlaying');
  $('stop').classList.toggle('hidden', !status.nowPlaying);
}

$('channel').onchange = async () => {
  const [guildId, channelId] = $('channel').value.split('|');
  if (channelId) await api('/api/channel', { guildId, channelId }).catch(() => {});
};

$('stop').onclick = async () => {
  await api('/api/stop', {}).catch(() => {});
  refresh();
};

$('enabled').onchange = () => chrome.runtime.sendMessage({ type: 'setEnabled', enabled: $('enabled').checked });
$('muteTab').onchange = () => chrome.storage.local.set({ muteTab: $('muteTab').checked });
$('botUrl').onchange = async () => {
  const value = $('botUrl').value.trim() || DEFAULTS.botUrl;
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(value)) {
    $('botUrl').value = settings.botUrl;
    return;
  }
  settings.botUrl = value;
  await chrome.storage.local.set({ botUrl: value });
  refresh();
};

(async () => {
  settings = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  $('enabled').checked = settings.enabled;
  $('muteTab').checked = settings.muteTab;
  $('botUrl').value = settings.botUrl;
  refresh();
})();
