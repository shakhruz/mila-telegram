// Foundation: the receiver tags every inbound by author from the Telegram id (owner / team / other — never by name), writes
// presses to its own taps.jsonl with the card text as Telegram shows it, and can reach the Bot API over a unix socket
// (TELEGRAM_API_UNIX — the key keeper knows which OS user calls there).
// A fake Bot API on a unix socket; the receiver in daemon mode reads the journal it writes.
import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111, TEAM = 555 * 1000000 + 222, OTHER = 555 * 1000000 + 999, GROUP = -(100 * 1000000 + 7)

test('author by id, presses in taps.jsonl with Telegram\'s card text, Bot API over a unix socket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-found-'))
  const sock = join(dir, 'api.sock')
  const seen: string[] = []
  const updates = [
    { update_id: 1, message: { message_id: 10, date: 1, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false, first_name: 'O', language_code: 'uz' }, text: 'hi from owner' } },
    { update_id: 2, message: { message_id: 11, date: 1, chat: { id: GROUP, type: 'supergroup', title: 'G' }, from: { id: TEAM, is_bot: false, first_name: 'T', username: 'owner_lookalike' }, text: 'team task' } },
    { update_id: 3, message: { message_id: 12, date: 1, chat: { id: GROUP, type: 'supergroup', title: 'G' }, from: { id: OTHER, is_bot: false, first_name: 'Shahruz', username: 'shahruz' }, text: 'stranger' } },
    { update_id: 5, message: { message_id: 13, date: 1, chat: { id: GROUP, type: 'supergroup', title: 'G' }, from: { id: OWNER, is_bot: false, first_name: 'O' }, text: 'owner replies',
      reply_to_message: { message_id: 12, date: 1, chat: { id: GROUP, type: 'supergroup' }, from: { id: OTHER, is_bot: false, first_name: 'S' }, text: 'stranger' } } },
    { update_id: 4, callback_query: { id: 'cb1', chat_instance: 'x', data: 'card:c1:ok', from: { id: OWNER, is_bot: false, first_name: 'O' },
      message: { message_id: 50, date: 1, chat: { id: OWNER, type: 'private' }, text: 'Pack «X»\n#pack-x-1' } } },
  ]
  let served = false
  const srv = Bun.serve({ unix: sock, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    seen.push(method)
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true; return Response.json({ ok: true, result: updates })
    }
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 1, chat: { id: 1, type: 'private' } } : true })
  } })
  require('fs').mkdirSync(join(dir, 'io'))
  writeFileSync(join(dir, 'io', 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  writeFileSync(join(dir, 'io', 'team.json'), JSON.stringify({ teams: { [String(GROUP)]: [String(TEAM)] }, asked: {} }))   // the receiver's own team list
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], owners: [String(OWNER), String(OTHER)], pending: {},
    groups: { [String(GROUP)]: { requireMention: false, allowFrom: [], team: [String(TEAM), String(OTHER)] } } }))   // a team line the session wrote: not trusted
  writeFileSync(join(dir, 'cards.jsonl'), JSON.stringify({ card_id: 'c1', chat_id: OWNER, allow: [String(OWNER)], text: 'forged text #pack-evil',
    buttons: [[{ label: 'ok', data: 'ok' }]] }) + '\n')
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35),
           TELEGRAM_API_ROOT: 'http://keeper/telegram', TELEGRAM_API_UNIX: sock, TELEGRAM_JOURNAL_DIR: join(dir, 'io'),
           TELEGRAM_SHARED_GROUP: '1' }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  const ev = join(dir, 'io', 'events.jsonl')
  for (let i = 0; i < 80; i++) { await Bun.sleep(100); if (existsSync(ev) && readFileSync(ev, 'utf8').split('\n').length >= 5) break }
  await Bun.sleep(300)
  p.kill(); await p.exited; srv.stop(true)
  const lines = readFileSync(ev, 'utf8').trim().split('\n').map(l => JSON.parse(l).params?.meta ?? {})
  const byUser = (id: number) => lines.find((m: any) => m.user_id === String(id) && m.type !== 'callback')
  expect(seen).toContain('getUpdates')                               // the Bot API was reached over the unix socket
  expect(byUser(OWNER)?.from).toBe('owner')
  expect(byUser(OWNER)?.lang).toBe('uz')                            // the sender's Telegram language — for the core's lang=
  expect(byUser(TEAM)?.lang).toBeUndefined()
  expect(byUser(TEAM)?.from).toBe('team')                            // a username like the owner's changes nothing
  // a stranger in a group — a first name like the owner's, or a line in access.json, changes nothing — never reaches the session:
  // not in events.jsonl, only in guests.jsonl (0600, the session's group cannot read it)
  expect(byUser(OTHER)).toBeUndefined()
  expect(readFileSync(ev, 'utf8')).not.toContain('"stranger')   // nor quoted in the owner's reply
  expect(lines.find((m: any) => m.reply_to_message_id === '12')?.reply_quote).toContain("a stranger's message")
  const gf = join(dir, 'io', 'guests.jsonl')
  const guest = JSON.parse(readFileSync(gf, 'utf8').trim().split('\n')[0])
  expect(guest.user_id).toBe(String(OTHER)); expect(guest.text).toBe('stranger'); expect(guest.chat_id).toBe(String(GROUP))
  expect(require('fs').statSync(gf).mode & 0o777).toBe(0o600)
  expect(seen.filter(m => m === 'setMessageReaction' || m === 'sendChatAction').length).toBeLessThanOrEqual(3)   // owner ×2 + team only
  expect(existsSync(join(dir, 'inbound', 'events.jsonl'))).toBe(false)   // journals only in TELEGRAM_JOURNAL_DIR
  expect(require('fs').statSync(ev).mode & 0o777).toBe(0o640)             // the session's group reads, does not write
  const tap = JSON.parse(readFileSync(join(dir, 'io', 'taps.jsonl'), 'utf8').trim().split('\n')[0])
  expect(tap.card_id).toBe('c1'); expect(tap.used_by).toBe(String(OWNER)); expect(tap.data).toBe('ok')
  expect(tap.card_text).toBe('Pack «X»\n#pack-x-1')                 // what Telegram showed, not the registry's forged text
  expect(lines.find((m: any) => m.type === 'callback')?.from).toBe('owner')
  rmSync(dir, { recursive: true, force: true })
}, 30000)
