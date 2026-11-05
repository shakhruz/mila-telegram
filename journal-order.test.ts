// The journal first, the 👀 after: when Telegram shows the person the ack, the message is already in the receiver's journal.
// If the journal cannot be written, no ack — the person is not told «got it» for a message nobody has.
import { test, expect } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111

async function run(breakJournal: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'jorder-')), sock = join(dir, 'api.sock'), io = join(dir, 'io')
  mkdirSync(io); writeFileSync(join(io, 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  if (breakJournal) mkdirSync(join(io, 'events.jsonl'))   // a folder where the journal file should be: the write fails
  const acks: Array<{ journalHad: boolean }> = []; let served = false
  const srv = Bun.serve({ unix: sock, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true
      return Response.json({ ok: true, result: [{ update_id: 1, message: { message_id: 10, date: 1, chat: { id: OWNER, type: 'private' },
        from: { id: OWNER, is_bot: false, first_name: 'O' }, text: 'write this down' } }] })
    }
    if (method === 'setMessageReaction') {
      const ev = join(io, 'events.jsonl')
      acks.push({ journalHad: !breakJournal && existsSync(ev) && readFileSync(ev, 'utf8').includes('write this down') })
    }
    return Response.json({ ok: true, result: true })
  } })
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {}, groups: {}, ackReaction: '👀' }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35),
           TELEGRAM_API_ROOT: 'http://keeper/telegram', TELEGRAM_API_UNIX: sock, TELEGRAM_JOURNAL_DIR: io }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  for (let i = 0; i < 40; i++) { await Bun.sleep(100); if (acks.length) break }
  await Bun.sleep(500)
  p.kill(); await p.exited; srv.stop(true); rmSync(dir, { recursive: true, force: true })
  return acks
}

test('the ack comes after the journal; no journal — no ack', async () => {
  const ok = await run(false)
  expect(ok.length).toBe(1); expect(ok[0]!.journalHad).toBe(true)
  expect((await run(true)).length).toBe(0)
}, 30000)
