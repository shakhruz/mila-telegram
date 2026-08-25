# Telegram Plus

Run your Claude Code session from Telegram — and keep it running.

This is an extended fork of the [official Telegram channel plugin](https://github.com/anthropics/claude-plugins-official) (Apache-2.0). The original connects a Telegram bot to a Claude Code session. This fork adds the things you start needing once you actually work that way every day: teams in group chats, voice notes, and a poller that doesn't lose your messages when the session restarts.

## What this fork adds

**A daemon that outlives the session.** In the original, the Telegram poller lives inside the session process: restart Claude Code and every message sent in the meantime is gone. Here the poller runs as a long-lived daemon that appends events to a journal file, and the session replays them from a cursor on startup. Restart, crash, upgrade — incoming messages wait in the file and arrive when the session comes back.

**Group auto-join with one-tap approval.** Add the bot to a group and send `/channel_join`. The owner gets an inline button in a private chat; one tap puts the group on the allowlist. No numeric chat IDs, no editing JSON by hand. Group messages can never change the allowlist themselves — approval only happens in the owner's private chat.

**Voice transcription.** Voice notes are handed to a transcription command of your choice (set `TELEGRAM_VOICE_TRANSCRIBE_CMD`), and the text reaches the assistant along with the audio. Unset means voice notes simply pass through untranscribed — no default, no vendor.

**Reply-quote context.** When someone replies to an earlier message, the quoted text travels with the new one, so the assistant answers about the message you actually pointed at instead of the last thing in the chat.

Everything from the original plugin still works: pairing, allowlists, mention detection, `reply` / `react` / `edit_message`, photos, attachments, typing indicators.

## Security

Read this before you put it on a machine that matters.

**Messages are untrusted input.** Anything anyone sends the bot reaches your assistant as content. Someone in an allowlisted chat can try to instruct it. Treat the channel as a public door into a session that can read files and run commands.

**Groups require a mention by default.** An approved group is added with `requireMention: true`, so the bot only responds when addressed. Turning that off means every message from every member goes straight into the session — that is a real prompt-injection surface, not a theoretical one. Turn it off only for a chat where you trust every member.

**Attachments can go out.** The `reply` tool sends any absolute path the assistant passes it. That is deliberate — it's how you get files out of a session — but combined with the point above it is also an exfiltration path. Your permission settings, not this plugin, are what stand between a message and a file leaving your machine.

**The event journal is a trust boundary.** The daemon writes events to a file and the session replays them; whatever can write that file speaks with the voice of Telegram. The journal and its directory are created `0600`/`0700`, and the bridge replays only an allowlist of two methods so a forged line cannot invoke arbitrary ones. Keep the state directory on a filesystem only you can write.

**Your token lives in `~/.claude/channels/telegram/.env`** at `0600`, and is stripped from error output before anything is logged.

## Prerequisites

- [Bun](https://bun.sh) — the MCP server runs on Bun: `curl -fsSL https://bun.sh/install | bash`

## Setup

**1. Create a bot.** Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token it gives you (the whole thing, including the leading digits and colon).

**2. Install the plugin.** From a Claude Code session:

```
/plugin marketplace add <this-repo>
/plugin install telegram-plus@<marketplace-name>
```

**3. Give the server the token.**

```
/telegram:configure 123456789:AAHfiqksKZ8...
```

This writes `TELEGRAM_BOT_TOKEN=...` to `~/.claude/channels/telegram/.env`. You can write that file yourself instead, or set the variable in your shell — the shell wins.

> To run several bots on one machine, point `TELEGRAM_STATE_DIR` at a different directory per instance.

**4. Relaunch with the channel flag.** The server won't connect without it:

```sh
claude --channels plugin:telegram-plus@<marketplace-name>
```

**5. Pair.** DM your bot; it replies with a 6-character code. In the session:

```
/telegram:access pair <code>
```

**6. Lock it down.** Pairing exists to capture your ID. Once you're in, switch to an allowlist so strangers stop getting pairing codes:

```
/telegram:access policy allowlist
```

## Running the daemon

The daemon is what makes restarts free. Run `receiver.ts` as a service under your process supervisor of choice — `launchd` on macOS, `systemd` on Linux — with `RECEIVER_DAEMON=1` in its environment:

```sh
RECEIVER_DAEMON=1 bun /path/to/plugin/receiver.ts
```

It writes events to `$TELEGRAM_STATE_DIR/inbound/events.jsonl`. When a session starts and finds the daemon alive, it reads from that journal instead of polling, so the two never fight over the Telegram API. With no daemon running, the session polls directly exactly as the original plugin does — the daemon is optional.

## Configuration

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather. Required. |
| `TELEGRAM_STATE_DIR` | State directory. Default `~/.claude/channels/telegram`. |
| `TELEGRAM_VOICE_TRANSCRIBE_CMD` | Command that transcribes a voice file. Unset means no transcription. |
| `RECEIVER_DAEMON` | Set to `1` to run `receiver.ts` as the polling daemon. |

## Access control

See **[ACCESS.md](./ACCESS.md)** for DM policies, groups, mention detection, delivery config, skill commands, and the `access.json` schema.

IDs are numeric user IDs — get yours from [@userinfobot](https://t.me/userinfobot). `ackReaction` only accepts Telegram's fixed emoji whitelist.

## Tools exposed to the assistant

| Tool | Purpose |
| --- | --- |
| `reply` | Send to a chat. Takes `chat_id` + `text`, optionally `reply_to` for native threading and `files` (absolute paths) for attachments. Images send as photos, everything else as documents, 50MB each. Long text is chunked. Returns the sent message ID(s). |
| `react` | Add an emoji reaction by message ID. Telegram's fixed whitelist only (👍 👎 ❤ 🔥 👀 …). |
| `edit_message` | Edit a message the bot sent. Good for "working…" → result. Own messages only. |
| `download_attachment` | Fetch a file by `file_id` from an inbound message and return its local path. |

Inbound messages trigger a typing indicator automatically.

## No history, no search

Telegram's Bot API exposes neither. The bot only sees messages as they arrive — there is no way to fetch a chat's past. If the assistant needs earlier context it has to ask you for it. This is a limit of Telegram, not of this plugin, and it is why photos are downloaded eagerly on arrival.

## License and attribution

Apache-2.0. This is a modified fork of the `telegram` channel plugin from [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official), copyright Anthropic, PBC. See [NOTICE](./NOTICE) for the list of changes.
