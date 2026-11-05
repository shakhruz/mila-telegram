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
    { update_id: 1, message: { message_id: 10, date: 1, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false, first_name: 'O' }, text: 'hi from owner' } },
    { update_id: 2, message: { message_id: 11, date: 1, chat: { id: GROUP, type: 'supergroup', title: 'G' }, from: { id: TEAM, is_bot: false, first_name: 'T', username: 'owner_lookalike' }, text: 'team task' } },
    { update_id: 3, message: { message_id: 12, date: 1, chat: { id: GROUP, type: 'supergroup', title: 'G' }, from: { id: OTHER, is_bot: false, first_name: 'Shahruz', username: 'shahruz' }, text: 'stranger' } },
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
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {},
    groups: { [String(GROUP)]: { requireMention: false, allowFrom: [], team: [String(TEAM)] } } }))
  writeFileSync(join(dir, 'cards.jsonl'), JSON.stringify({ card_id: 'c1', chat_id: OWNER, allow: [String(OWNER)], text: 'forged text #pack-evil',
    buttons: [[{ label: 'ok', data: 'ok' }]] }) + '\n')
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35),
           TELEGRAM_API_ROOT: 'http://keeper/telegram', TELEGRAM_API_UNIX: sock }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  const ev = join(dir, 'inbound', 'events.jsonl')
  for (let i = 0; i < 80; i++) { await Bun.sleep(100); if (existsSync(ev) && readFileSync(ev, 'utf8').split('\n').length >= 5) break }
  await Bun.sleep(300)
  p.kill(); await p.exited; srv.stop(true)
  const lines = readFileSync(ev, 'utf8').trim().split('\n').map(l => JSON.parse(l).params?.meta ?? {})
  const byUser = (id: number) => lines.find((m: any) => m.user_id === String(id) && m.type !== 'callback')
  expect(seen).toContain('getUpdates')                               // the Bot API was reached over the unix socket
  expect(byUser(OWNER)?.from).toBe('owner')
  expect(byUser(TEAM)?.from).toBe('team')                            // a username like the owner's changes nothing
  expect(byUser(OTHER)?.from).toBe('other')                          // a first name like the owner's changes nothing
  const tap = JSON.parse(readFileSync(join(dir, 'taps.jsonl'), 'utf8').trim().split('\n')[0])
  expect(tap.card_id).toBe('c1'); expect(tap.used_by).toBe(String(OWNER)); expect(tap.data).toBe('ok')
  expect(tap.card_text).toBe('Pack «X»\n#pack-x-1')                 // what Telegram showed, not the registry's forged text
  expect(lines.find((m: any) => m.type === 'callback')?.from).toBe('owner')
  rmSync(dir, { recursive: true, force: true })
}, 30000)
