// Discord side: the bot client, voice connection and audio player.

import { Client, GatewayIntentBits, Events, ChannelType, Routes, REST, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  getVoiceConnection,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState
} from '@discordjs/voice';
import { config } from './config.js';
import { ytdlp } from './ytdlp.js';
import { log } from './log.js';

// Minimal permissions requested by the default invite link.
// Embed Links makes "Now playing" messages show title, thumbnail and duration as a card.
export const BOT_PERMISSIONS =
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;

// What the bot needs in a voice channel to play there.
const VOICE_PERMISSIONS = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  Connect: PermissionFlagsBits.Connect,
  Speak: PermissionFlagsBits.Speak
};

// What the bot needs in a text channel to post "Now playing" there.
const TEXT_PERMISSIONS = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages
};

/** Names of the permissions the bot is missing in a channel (empty = all good). */
function missingPermissions(channel, required = VOICE_PERMISSIONS) {
  const me = channel.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms) return Object.keys(required);
  return Object.entries(required).filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
}

/** 'no-token' | 'connecting' | 'ready' | 'invalid-token' | 'error' */
let discordState = 'no-token';
let discordError = null;
let client = null;

const audioPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
let currentProcess = null;
let isSwitching = false;
let nowPlaying = null;
/** Last playback failure that would otherwise be silent (e.g. yt-dlp couldn't download). */
let lastError = null;

audioPlayer.on('error', (e) => log.warn('Player error (ignored):', e.message));
audioPlayer.on(AudioPlayerStatus.Idle, () => {
  if (isSwitching) return;
  nowPlaying = null;
  killProcess();
});

function killProcess() {
  if (!currentProcess) return;
  // Mark it instead of stripping listeners: removing stdout's listeners also removed its error
  // handler, so the audio pipeline's "Premature close" on a song switch became an uncaught exception.
  currentProcess.killedByUs = true;
  try { if (!currentProcess.killed) currentProcess.kill('SIGKILL'); } catch {}
  currentProcess = null;
}

// ---------------------------------------------------------------------------
// Discord login
// ---------------------------------------------------------------------------

/** Checks a token against the Discord API without opening a gateway connection. */
export async function validateToken(token) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${token}` }
  });
  if (res.status === 401) return { ok: false, error: 'Discord rejected this token. Copy it again from the Bot page.' };
  if (!res.ok) return { ok: false, error: `Discord returned HTTP ${res.status}` };
  const user = await res.json();
  return { ok: true, user };
}

export async function startDiscord() {
  if (client) {
    await client.destroy().catch(() => {});
    client = null;
  }
  const token = config.token;
  if (!token) {
    discordState = 'no-token';
    return;
  }

  discordState = 'connecting';
  discordError = null;
  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

  client.once(Events.ClientReady, async (c) => {
    discordState = 'ready';
    log.info(`Logged in to Discord as ${c.user.tag}`);
    migrateLegacyNotifyChannels();
    await registerCommands(c).catch((e) => log.warn('Could not register slash commands:', e.message));
  });
  client.on(Events.InteractionCreate, handleInteraction);
  client.on(Events.Error, (e) => log.error('Discord client error:', e));

  try {
    await client.login(token);
  } catch (e) {
    discordState = e.code === 'TokenInvalid' ? 'invalid-token' : 'error';
    discordError = e.message;
    log.error('Discord login failed:', e.message);
    client = null;
  }
}

/** admin=true asks for Administrator: sees every private channel, but is risky if the token leaks. */
export function getInviteUrl({ admin = false } = {}) {
  const appId = client?.application?.id || client?.user?.id;
  if (!appId) return null;
  const permissions = admin ? PermissionFlagsBits.Administrator : BOT_PERMISSIONS;
  return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${permissions}`;
}

// ---------------------------------------------------------------------------
// Voice channels
// ---------------------------------------------------------------------------

export function listVoiceChannels() {
  if (discordState !== 'ready') return [];
  return client.channels.cache
    .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
    .map((c) => {
      const missing = missingPermissions(c);
      return { channelName: c.name, channelId: c.id, guildId: c.guild.id, guildName: c.guild.name, canJoin: !missing.length, missing };
    })
    .sort((a, b) => a.guildName.localeCompare(b.guildName) || a.channelName.localeCompare(b.channelName));
}

export function setChannel(guildId, channelId) {
  config.update({ guildId, channelId });
}

// ---------------------------------------------------------------------------
// "Now playing" text channels (one per server)
// ---------------------------------------------------------------------------

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/** Text channels of one server, in the order Discord shows them. */
export function listTextChannels(guildId) {
  const guild = discordState === 'ready' ? client.guilds.cache.get(guildId) : null;
  if (!guild) return [];
  return guild.channels.cache
    .filter((c) => TEXT_TYPES.has(c.type))
    .sort((a, b) => (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1) || a.rawPosition - b.rawPosition)
    .map((c) => {
      const missing = missingPermissions(c, TEXT_PERMISSIONS);
      return { channelId: c.id, channelName: c.name, category: c.parent?.name ?? null, canSend: !missing.length, missing };
    });
}

/** channelId = null turns notifications off for that server. */
export function setNotifyChannel(guildId, channelId) {
  if (channelId) {
    const channel = client?.guilds.cache.get(guildId)?.channels.cache.get(channelId);
    if (!channel || !TEXT_TYPES.has(channel.type)) throw new Error('That text channel was not found in this server.');
    const missing = missingPermissions(channel, TEXT_PERMISSIONS);
    if (missing.length) {
      throw new Error(
        `The bot can't post in #${channel.name} (missing: ${missing.join(', ')}). ` +
        'In Discord: right-click the channel → Edit Channel → Permissions → add the bot and allow ' +
        'View Channel and Send Messages.'
      );
    }
  }
  const notifyChannels = { ...config.notifyChannels };
  if (channelId) notifyChannels[guildId] = channelId;
  else delete notifyChannels[guildId];
  config.update({ notifyChannels });
}

/** ≤1.0.0 stored a flat list of channel IDs; turn it into one channel per server. */
function migrateLegacyNotifyChannels() {
  if (!config.notificationChannels.length) return;
  const notifyChannels = { ...config.notifyChannels };
  for (const id of config.notificationChannels) {
    const channel = client.channels.cache.get(id);
    if (channel?.guild && !notifyChannels[channel.guild.id]) notifyChannels[channel.guild.id] = id;
  }
  config.update({ notifyChannels, notificationChannels: [] });
  log.info('Migrated notification channels to per-server settings.');
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/**
 * @param target  optional { guildId, channelId } voice channel; defaults to the saved one
 * @param options { skipNotifyIn?: textChannelId } — don't post "Now playing" there (e.g. /play already replied)
 */
export async function play(url, target, options = {}) {
  if (discordState !== 'ready') throw new Error('The bot is not connected to Discord yet. Finish setup in the dashboard.');
  const guildId = target?.guildId && target?.channelId ? target.guildId : config.guildId;
  const channelId = target?.guildId && target?.channelId ? target.channelId : config.channelId;
  if (!guildId || !channelId) throw new Error('No voice channel selected. Pick one in the dashboard or extension.');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('The bot is not in that server anymore. Pick another channel.');
  const channel = guild.channels.cache.get(channelId);
  if (!channel) throw new Error('That voice channel no longer exists. Pick another one.');

  // Without this check, joining a channel the bot can't access just times out after 20s.
  const missing = missingPermissions(channel);
  if (missing.length) {
    throw new Error(
      `The bot can't play in "${channel.name}" (missing: ${missing.join(', ')}). ` +
      'In Discord: right-click the channel → Edit Channel → Permissions → add the bot and allow ' +
      'View Channel, Connect and Speak.'
    );
  }
  if (target?.guildId && target?.channelId) setChannel(guildId, channelId);

  isSwitching = true;
  lastError = null;
  try {
    killProcess();
    let info;
    try { info = await ytdlp.info(url); } catch { throw new Error('Could not load that URL.'); }

    // Leave voice channels in other servers.
    for (const g of client.guilds.cache.values()) {
      if (g.id !== guildId) getVoiceConnection(g.id)?.destroy();
    }

    let connection = getVoiceConnection(guildId);
    if (connection && connection.joinConfig.channelId !== channelId) {
      connection.destroy();
      connection = null;
    }
    if (!connection) {
      connection = joinVoiceChannel({ channelId, guildId, adapterCreator: guild.voiceAdapterCreator });
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    }

    const proc = ytdlp.stream(url);
    currentProcess = proc;
    proc.stdout.on('error', () => {});

    // yt-dlp can fail after the voice connection is up (blocked/reset connection to YouTube's
    // video servers, age-restricted video…). Without this the bot sits in the channel in silence.
    let received = 0;
    proc.stdout.on('data', (chunk) => { received += chunk.length; });
    // 'exit' fires as soon as yt-dlp quits, before the empty stream makes the player go idle.
    proc.once('exit', (code) => {
      if (code === 0 || proc.killedByUs) return; // finished normally, or replaced/stopped by us
      const detail = proc.lastError() || `yt-dlp exited with code ${code}`;
      log.error(`yt-dlp could not stream ${url}: ${detail}`);
      if (received === 0) {
        lastError = { title: nowPlaying?.title ?? url, url, detail, hint: hintFor(detail), at: new Date().toISOString() };
        nowPlaying = null;
      }
    });

    const resource = createAudioResource(proc.stdout, { inputType: StreamType.WebmOpus });
    resource.playStream.on('error', (e) => {
      if (e.code !== 'ERR_STREAM_PREMATURE_CLOSE') log.warn('Stream error:', e.message);
    });

    connection.subscribe(audioPlayer);
    audioPlayer.play(resource);

    const title = info.title || url;
    nowPlaying = {
      title,
      url,
      duration: info.duration ?? null,
      isLive: !!info.is_live,
      uploader: info.channel || info.uploader || null,
      thumbnail: info.thumbnail || null,
      startedAt: new Date().toISOString()
    };
    log.info(`Playing: ${title}`);
    notify(nowPlaying, channel, options).catch((e) => log.warn('Now-playing message failed:', e.message));
    return { success: true, title };
  } catch (e) {
    killProcess();
    throw e;
  } finally {
    isSwitching = false;
  }
}

export function stop() {
  nowPlaying = null;
  lastError = null;
  killProcess();
  audioPlayer.stop(true);
  if (config.guildId) getVoiceConnection(config.guildId)?.destroy();
}

/** A short, actionable explanation for common yt-dlp failures. */
function hintFor(detail) {
  if (/SSL|TLS|INVALID_SESSION_ID|Connection reset|10054|timed out|Unable to connect|getaddrinfo/i.test(detail)) {
    return "The connection to YouTube's video servers failed. A DPI-bypass tool (GoodbyeDPI, zapret…), VPN, antivirus or firewall may be interfering. See Troubleshooting in the README.";
  }
  if (/Sign in to confirm|bot/i.test(detail)) return 'YouTube is rate-limiting this connection. Wait a while and try again.';
  if (/age|private|unavailable|members-only/i.test(detail)) return "This video can't be played (private, unavailable or age-restricted).";
  return null;
}

const fmtDuration = (s) => {
  if (s == null) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Posts "Now playing" to the text channel picked for the voice channel's server, if any. */
async function notify(track, voiceChannel, { skipNotifyIn } = {}) {
  const id = config.notifyChannels[voiceChannel.guild.id];
  if (!id || id === skipNotifyIn) return;
  const channel = voiceChannel.guild.channels.cache.get(id);
  if (!channel || missingPermissions(channel, TEXT_PERMISSIONS).length) {
    log.warn(`Can't post "Now playing" to channel ${id}: missing or no permission.`);
    return;
  }

  const canEmbed = channel.permissionsFor(voiceChannel.guild.members.me).has(PermissionFlagsBits.EmbedLinks);
  if (!canEmbed) {
    // Plain text fallback. <url> suppresses the link preview, which needs Embed Links anyway.
    await channel.send(`🎶 Now playing in 🔊 **${voiceChannel.name}**: **${track.title}**\n<${track.url}>`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: `Now playing in 🔊 ${voiceChannel.name}` })
    .setTitle(track.title.slice(0, 256))
    .setURL(track.url)
    .addFields({ name: 'Duration', value: track.isLive ? '🔴 Live' : fmtDuration(track.duration) ?? '?', inline: true });
  if (track.uploader) embed.addFields({ name: 'Channel', value: track.uploader.slice(0, 1024), inline: true });
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  await channel.send({ embeds: [embed] });
}

export function getStatus() {
  const channel = listVoiceChannels().find((c) => c.channelId === config.channelId);
  return {
    discord: discordState,
    discordError,
    botUser: client?.user ? { id: client.user.id, tag: client.user.tag, avatar: client.user.displayAvatarURL() } : null,
    inviteUrl: getInviteUrl(),
    inviteUrlAdmin: getInviteUrl({ admin: true }),
    guildCount: client?.guilds.cache.size ?? 0,
    connected: !!(config.guildId && getVoiceConnection(config.guildId)),
    currentGuild: {
      id: config.guildId || null,
      channelId: config.channelId || null,
      guildName: channel?.guildName ?? null,
      channelName: channel?.channelName ?? null,
      // "Now playing" text channel for this server (null = off)
      notifyChannelId: (config.guildId && config.notifyChannels[config.guildId]) || null
    },
    playerState: audioPlayer.state.status,
    nowPlaying,
    lastError
  };
}

// ---------------------------------------------------------------------------
// Slash commands: /play, /stop — usable from Discord without the extension.
// ---------------------------------------------------------------------------

const commands = [
  {
    name: 'play',
    description: 'Play a song from a URL or a YouTube search in your voice channel',
    options: [{ name: 'song', description: 'URL or search text', type: 3, required: true }]
  },
  { name: 'stop', description: 'Stop the music and leave the voice channel' }
];

async function registerCommands(c) {
  const rest = new REST().setToken(config.token);
  await rest.put(Routes.applicationCommands(c.application.id), { body: commands });
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'stop') {
    stop();
    return interaction.reply('⏹️ Stopped.');
  }

  if (interaction.commandName === 'play') {
    const voice = interaction.member?.voice?.channel;
    if (!voice) return interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
    await interaction.deferReply();
    try {
      let song = interaction.options.getString('song', true);
      if (!/^https?:\/\//i.test(song)) {
        const [first] = await ytdlp.search(song, 1);
        if (!first) return interaction.editReply(`No results for "${song}".`);
        song = first.url;
      }
      const { title } = await play(song, { guildId: voice.guild.id, channelId: voice.id }, { skipNotifyIn: interaction.channelId });
      await interaction.editReply(`▶️ **${title}**\n${song}`);
    } catch (e) {
      await interaction.editReply(`❌ ${e.message}`);
    }
  }
}
