# mila-telegram — privacy policy

mila-telegram is an open-source Claude Code plugin that connects a Claude Code session on your machine to your own Telegram
bot. This policy describes what the plugin itself handles. The plugin's authors (MILAGPT) run no server for it and receive
nothing from it.

## What data it handles
- Messages and attachments that Telegram users send to your bot. The plugin receives everything Telegram delivers to the bot.
  Only messages from chats on your allowlist (`access.json`) are passed on; other messages are dropped, except that in pairing
  mode a stranger gets a pairing code.
- Telegram metadata that comes with a message: chat id, user id, username, display name, message id, time.
- Your bot token.

## Where it goes
- **Your Claude Code session.** Allowlisted messages are delivered to the Claude Code session on your machine. The model then
  processes them under the terms of the Claude account or API key you signed in with (Anthropic, or the cloud provider you
  chose). The plugin sends them nowhere else.
- **Telegram.** The plugin talks only to the Telegram Bot API (`https://api.telegram.org`), using your bot token: to receive
  messages, download attachments and send replies.
- **Nothing else.** No telemetry, no analytics, no data to the plugin's authors or any other third party.
- **Optional, set by you:** if you set `TELEGRAM_VOICE_TRANSCRIBE_CMD`, the plugin passes the path of a downloaded voice note to
  that command on your machine. Where that command sends the audio is up to the command you chose.

## Where it is stored
Everything stays on your machine under `~/.claude/channels/telegram/` (or `TELEGRAM_STATE_DIR`):
- `access.json` — who may talk to the bot, chat modes;
- the inbound journal and per-chat notes the receiver keeps, so messages are not lost while the session restarts;
- downloaded attachments;
- approval cards and join requests;
- `.env` with the bot token (mode 600), only if you saved the token that way.

The sign-in reminder reads `~/state/auth` and keeps its own timestamps in `~/state/login-self.json`. Without `~/state/auth` it
does nothing.

## Credentials
The bot token is a plugin setting marked sensitive: Claude Code stores it as a sensitive setting (on macOS — in the Keychain). For older
installs the plugin falls back to the local `.env` file so running assistants keep working. The token never leaves your
machine except in requests to `api.telegram.org`, and the plugin does not log it.

## Retention and deletion
Files stay on your machine until you delete them. The plugin does not upload or sync them. To remove everything, uninstall the
plugin and delete `~/.claude/channels/telegram/`. Messages already delivered to Telegram are kept by Telegram under its own
policy, and conversation history in Claude Code under yours and Anthropic's.

## Who can change access
Only the owner: from the terminal (`/mila-telegram:access` — pairing and allowlists), or by tapping approve on a join card the
plugin sends to the owner's private chat when the bot is added to a group. Messages from other people can never change access.

## What the plugin sends on its own, without the model
- a pairing code to someone who messages the bot, in pairing mode;
- an optional static greeting to a stranger, if you turn it on;
- permission and approval cards to the owner.

## Contact
Questions and reports: <https://github.com/shakhruz/mila-telegram/issues>. Security issues: see [SECURITY.md](SECURITY.md).
