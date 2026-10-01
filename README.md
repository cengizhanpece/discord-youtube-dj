# Discord YouTube DJ

Play music in your Discord voice channel from:

- 🌐 **your browser** — whatever you open on YouTube or YouTube Music plays in Discord automatically
- 💬 **Discord** — `/play <song or link>` and `/stop`
- 🖥️ **a local dashboard** — search, pick a channel, play
- 🤖 **an AI assistant** — via the [MCP server](https://github.com/YOUR_GITHUB_USERNAME/discord-music-mcp) ("play some lo-fi in the Lobby")

The bot runs **on your own computer**. Nothing is hosted anywhere, and YouTube works reliably because requests come from your home connection.

---

## Install (Windows)

1. Download **`DiscordYouTubeDJ-Setup-x.y.z.exe`** from the [latest release](https://github.com/YOUR_GITHUB_USERNAME/discord-youtube-dj/releases/latest) and run it.
   No admin rights or Node.js needed.
   > Windows may show *"Windows protected your PC"* because the installer isn't code-signed. Click **More info → Run anyway**.
2. The dashboard opens in your browser and walks you through connecting a Discord bot (about 2 minutes):
   1. Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
   2. **Bot** tab → **Reset Token** → **Copy**.
   3. Paste it into the dashboard → **Save** → **Invite to server**.
3. Pick a voice channel in the dashboard. Done.

The bot starts automatically when you sign in to Windows (you can turn that off during setup). To open the dashboard later, launch **Discord YouTube DJ** from the Start menu, or go to <http://localhost:1231>.

### Browser extension (optional)

Works in Chrome, Edge, Brave, Opera and other Chromium browsers.

1. Download **`DiscordYouTubeDJ-Extension-x.y.z.zip`** from the [latest release](https://github.com/YOUR_GITHUB_USERNAME/discord-youtube-dj/releases/latest) and unzip it somewhere permanent (e.g. `Documents\DiscordYouTubeDJ-Extension`).
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Click the extension icon, switch it **on**, choose a channel. Open any YouTube video.

> The extension isn't on the Chrome Web Store, so it has to be loaded this way.
> Updating = unzip the new version over the old folder, then click ↻ on the extension card.

### Other platforms / from source

Requires Node.js 20+.

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/discord-youtube-dj
cd discord-youtube-dj/bot
npm install
npm start          # opens the dashboard
```

`yt-dlp` is downloaded automatically on first start and updated on every start.

---

## Where things are stored

| | Windows | macOS | Linux |
|---|---|---|---|
| Settings (`config.json`, contains your bot token) & `bot.log` | `%APPDATA%\discord-youtube-dj` | `~/Library/Application Support/discord-youtube-dj` | `~/.config/discord-youtube-dj` |

Environment variables override the settings file: `DISCORD_TOKEN`, `PORT` (default `1231`), `DATA_DIR`.

## Local API

The bot listens on `127.0.0.1` only. Browser requests are only accepted from the dashboard itself and browser extensions; everything that changes state is `POST` with a JSON body.

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/status` | |
| GET | `/api/channels` | |
| POST | `/api/channel` | `{ guildId, channelId }` |
| GET | `/api/search` | `?q=…&limit=5` |
| POST | `/api/play` | `{ song: "<url or search text>", guildId?, channelId? }` |
| POST | `/api/stop` | `{}` |

## Troubleshooting

- **Extension says "Bot is not running"** → start *Discord YouTube DJ* from the Start menu. If you changed the port, update **Settings → Bot address** in the extension.
- **"Sign in to confirm you're not a bot"** in the log → YouTube is rate-limiting your IP; wait a while.
- **Anything else** → check `bot.log` (path shown under *Advanced* in the dashboard) and open an issue.

## Project layout

```
bot/         Node.js bot + local dashboard (bot/public)
extension/   Chromium extension (Manifest V3)
installer/   Windows installer: build.mjs stages files, setup.iss is the Inno Setup script
```

Releases are built by GitHub Actions: push a tag `vX.Y.Z` and the installer + extension zip are attached to a new release.

## License

MIT
