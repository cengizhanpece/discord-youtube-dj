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

/** "1.2.10" > "1.2.9" */
function isNewer(a, b) {
  const [x, y] = [a, b].map((v) => v.split('-')[0].split('.').map((n) => parseInt(n) || 0));
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
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

  // The bot knows the latest release; compare it with this extension's own version.
  const newer = !!status.latestVersion && isNewer(status.latestVersion, chrome.runtime.getManifest().version);
  $('updateLink').classList.toggle('hidden', !newer);
  $('updateLink').href = status.updateUrl;

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

  await loadNotifyChannels(status.currentGuild);

  $('np').textContent = status.nowPlaying?.title || msg('nothingPlaying');
  $('stop').classList.toggle('hidden', !status.nowPlaying);
}

// "Now playing" messages: one text channel per server, so the list follows the voice channel's server.
let notifyGuildId = null;

async function loadNotifyChannels(guild) {
  notifyGuildId = guild.id;
  $('notifySection').classList.toggle('hidden', !guild.id);
  if (!guild.id) return;

  const channels = await api(`/api/text-channels?guildId=${encodeURIComponent(guild.id)}`).catch(() => []);
  const sel = $('notify');
  sel.innerHTML = '';
  sel.add(new Option(msg('notifyOff'), ''));
  for (const c of channels) {
    const opt = new Option(`${c.canSend ? '' : '🔒 '}# ${c.channelName}`, c.channelId);
    opt.disabled = !c.canSend; // bot can't post there (no View Channel / Send Messages)
    sel.add(opt);
  }
  sel.value = channels.some((c) => c.channelId === guild.notifyChannelId) ? guild.notifyChannelId : '';
}

$('notify').onchange = async () => {
  $('notifyErr').classList.add('hidden');
  try {
    await api('/api/notify-channel', { guildId: notifyGuildId, channelId: $('notify').value || null });
  } catch (e) {
    $('notifyErr').textContent = e.message;
    $('notifyErr').classList.remove('hidden');
    refresh(); // put the select back to what the bot actually has
  }
};

$('channel').onchange = async () => {
  const [guildId, channelId] = $('channel').value.split('|');
  if (!channelId) return;
  await api('/api/channel', { guildId, channelId }).catch(() => {});
  refresh(); // a different server has a different list of text channels
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
