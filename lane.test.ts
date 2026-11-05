// The strangers' lane: the receiver hands an addressed stranger's text to the lane's socket and sends back what it says —
// text only, to the same chat, as a reply. A stranger who did not address the bot: the lane is not asked. Nothing reaches the
// session journal either way. A fake Bot API and a fake lane on unix sockets.
import { test, expect } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111, OTHER = 555 * 1000000 + 999, GROUP = -(100 * 1000000 + 9)

test('lane: addressed stranger → lane → answer in the same chat; unaddressed → lane not asked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-'))
  const api = join(dir, 'api.sock'), laneSock = join(dir, 'lane.sock')
  const g = (id: number, text: string, entities?: any[]) => ({ update_id: id, message: { message_id: id, date: 1,
    chat: { id: GROUP, type: 'supergroup', title: 'G' }, from: { id: OTHER, is_bot: false, first_name: 'S' }, text, ...(entities ? { entities } : {}) } })
  const M = [{ type: 'mention', offset: 0, length: 6 }]
  const updates = [g(1, 'just chatting'), g(2, '@m_bot how much?', M), g(3, '@m_bot give a link', M), g(4, '@m_bot again', M), g(5, '@m_bot more', M)]
  const sent: any[] = []; let served = false
  const srv = Bun.serve({ unix: api, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true; return Response.json({ ok: true, result: updates })
    }
    if (method === 'sendMessage') { sent.push(body); return Response.json({ ok: true, result: { message_id: 50, date: 1, chat: { id: body.chat_id, type: 'supergroup' } } }) }
    return Response.json({ ok: true, result: true })
  } })
  const asked: string[] = []
  const lane = Bun.listen({ unix: laneSock, socket: {
    data(s, d) {
      asked.push(d.toString())
      const r = [{ ok: true, text: 'Lane says hi' }, { ok: false, reason: 'filtered' }, { ok: false, reason: 'cap' }, { ok: false, reason: 'cap' }][asked.length - 1]
      s.write(JSON.stringify(r) + '\n'); s.end()
    },
  } })
  mkdirSync(join(dir, 'io'))
  writeFileSync(join(dir, 'io', 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {},
    groups: { [String(GROUP)]: { requireMention: false, allowFrom: [] } } }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35),
           TELEGRAM_API_ROOT: 'http://keeper/telegram', TELEGRAM_API_UNIX: api, TELEGRAM_JOURNAL_DIR: join(dir, 'io'),
           TELEGRAM_SHARED_GROUP: '1', TELEGRAM_GUEST_LANE: laneSock }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  for (let i = 0; i < 80; i++) { await Bun.sleep(100); if (asked.length >= 4 && sent.some(b => /limit of answers/.test(String(b.text)))) break }
  await Bun.sleep(300)
  p.kill(); await p.exited; srv.stop(true); lane.stop(true)
  expect(asked.length).toBe(4)                                                   // only the addressed ones
  expect(JSON.parse(asked[0]!.trim())).toEqual({ chat_id: String(GROUP), user_id: String(OTHER), text: '@m_bot how much?' })
  const ans = sent.find(b => b.text === 'Lane says hi')
  expect(String(ans.chat_id)).toBe(String(GROUP)); expect(ans.reply_parameters?.message_id).toBe(2)
  // a filtered answer (a link not in the owner's knowledge, an @mention): a neutral line instead, as a reply
  const pass = sent.filter(b => String(b.chat_id) === String(GROUP) && b.text !== 'Lane says hi')
  expect(pass.length).toBe(1); expect(pass[0].reply_parameters?.message_id).toBe(3); expect(pass[0].text).toMatch(/pass your question/)
  // the day's ceiling: silence in the group, one line to the owner (not one per message)
  expect(sent.filter(b => String(b.chat_id) === String(OWNER) && /limit of answers/.test(b.text)).length).toBe(1)
  const ev = join(dir, 'io', 'events.jsonl')
  expect(existsSync(ev) ? readFileSync(ev, 'utf8') : '').not.toContain('how much')   // the session never sees it
  rmSync(dir, { recursive: true, force: true })
}, 30000)
