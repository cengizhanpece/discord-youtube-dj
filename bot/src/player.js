// Discord side: the bot client, voice connection and audio player.

import { Client, GatewayIntentBits, Events, ChannelType, Routes, REST } from 'discord.js';
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

// Connect, Speak, View Channel, Send Messages
export const BOT_PERMISSIONS = (1n << 20n) | (1n << 21n) | (1n << 10n) | (1n << 11n);

/** 'no-token' | 'connecting' | 'ready' | 'invalid-token' | 'error' */
let discordState = 'no-token';
let discordError = null;
let client = null;

const audioPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
let currentProcess = null;
let isSwitching = false;
let nowPlaying = null;

audioPlayer.on('error', (e) => log.warn('Player error (ignored):', e.message));
audioPlayer.on(AudioPlayerStatus.Idle, () => {
  if (isSwitching) return;
  nowPlaying = null;
  killProcess();
});

function killProcess() {
  if (!currentProcess) return;
  currentProcess.stdout?.removeAllListeners();
  currentProcess.removeAllListeners();
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

export function getInviteUrl() {
  const appId = client?.application?.id || client?.user?.id;
  if (!appId) return null;
  return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${BOT_PERMISSIONS}`;
}

// ---------------------------------------------------------------------------
// Voice channels
// ---------------------------------------------------------------------------

export function listVoiceChannels() {
  if (discordState !== 'ready') return [];
  return client.channels.cache
    .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
    .map((c) => ({ channelName: c.name, channelId: c.id, guildId: c.guild.id, guildName: c.guild.name }))
    .sort((a, b) => a.guildName.localeCompare(b.guildName) || a.channelName.localeCompare(b.channelName));
}

export function setChannel(guildId, channelId) {
  config.update({ guildId, channelId });
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export async function play(url, target) {
  if (discordState !== 'ready') throw new Error('The bot is not connected to Discord yet. Finish setup in the dashboard.');
  if (target?.guildId && target?.channelId) setChannel(target.guildId, target.channelId);

  const { guildId, channelId } = config;
  if (!guildId || !channelId) throw new Error('No voice channel selected. Pick one in the dashboard or extension.');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('The bot is not in that server anymore. Pick another channel.');

  isSwitching = true;
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

    const resource = createAudioResource(proc.stdout, { inputType: StreamType.WebmOpus });
    resource.playStream.on('error', (e) => {
      if (e.code !== 'ERR_STREAM_PREMATURE_CLOSE') log.warn('Stream error:', e.message);
    });

    connection.subscribe(audioPlayer);
    audioPlayer.play(resource);

    const title = info.title || url;
    nowPlaying = { title, url, duration: info.duration ?? null, startedAt: new Date().toISOString() };
    log.info(`Playing: ${title}`);
    notify(title);
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
  killProcess();
  audioPlayer.stop(true);
  if (config.guildId) getVoiceConnection(config.guildId)?.destroy();
}

async function notify(title) {
  for (const id of config.notificationChannels) {
    try {
      const channel = await client.channels.fetch(id);
      if (channel?.isTextBased()) await channel.send(`🎶 Now playing: **${title}**`);
    } catch {}
  }
}

export function getStatus() {
  const channel = listVoiceChannels().find((c) => c.channelId === config.channelId);
  return {
    discord: discordState,
    discordError,
    botUser: client?.user ? { id: client.user.id, tag: client.user.tag, avatar: client.user.displayAvatarURL() } : null,
    inviteUrl: getInviteUrl(),
    guildCount: client?.guilds.cache.size ?? 0,
    connected: !!(config.guildId && getVoiceConnection(config.guildId)),
    currentGuild: {
      id: config.guildId || null,
      channelId: config.channelId || null,
      guildName: channel?.guildName ?? null,
      channelName: channel?.channelName ?? null
    },
    playerState: audioPlayer.state.status,
    nowPlaying
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
      const { title } = await play(song, { guildId: voice.guild.id, channelId: voice.id });
      await interaction.editReply(`▶️ **${title}**\n${song}`);
    } catch (e) {
      await interaction.editReply(`❌ ${e.message}`);
    }
  }
}
