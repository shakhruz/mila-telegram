# Security Policy

## Reporting a vulnerability

Report privately, not in a public issue. Open a [GitHub security advisory](../../security/advisories/new) on this repository, or email the address listed on the repository owner's GitHub profile.

Please include what you need to reproduce it: version or commit, configuration that matters (daemon or in-session polling, DM or group, mention policy), and the impact you believe it has. A working proof of concept helps and is welcome.

Expect a first response within a few days. If the report is confirmed, you will get a fix timeline and credit in the advisory unless you prefer otherwise.

## Scope

In scope: anything that lets a message sender reach further than the access policy intends — bypassing the allowlist or mention requirement, forging approval, reading or writing files outside the state directory, leaking the bot token, or injecting events into the journal the bridge replays.

Out of scope, because they are design, not defects:

- **A message can influence the assistant.** Everything a sender writes reaches the model as content. Prompt injection through an allowlisted chat is inherent to what a chat channel is. Reports that simply demonstrate this are not vulnerabilities; reports that show it crossing an access boundary are.
- **The assistant can send any file.** `reply` takes absolute paths on purpose. What limits it is your permission configuration, not this code.
- **The owner can grant broad access.** Turning off `requireMention` in a group, or allowlisting a chat you do not control, is a decision the tool lets you make.

## Operator guidance

This plugin puts a door into a session that can read files and run commands. Two things matter more than the rest: keep `requireMention: true` in any group whose members you do not all trust, and keep the state directory on a filesystem only you can write, since whatever writes the event journal speaks with the voice of Telegram.
