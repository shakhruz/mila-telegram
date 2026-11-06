// Archive part C: the keeper's spool of outgoing messages moves into the archive as «mila» lines, each once — a half-written last
// line waits, a new spool (smaller than the offset) starts over. The receiver in daemon mode, a fake Bot API.
import { test, expect } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111

test('outgoing: from the spool into the archive, once each, a partial line waits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arco-')), sock = join(dir, 'api.sock'), io = join(dir, 'io'), spool = join(dir, 'out.jsonl')
  const row = (id: number, text: string) => JSON.stringify({ ts: 1, method: 'sendMessage', chat_id: String(OWNER), message_id: id, text }) + '\n'
  writeFileSync(spool, row(1, 'first answer') + row(2, 'second answer') + '{"ts": 1, "method": "sendMe')   // the last one still being written
  const srv = Bun.serve({ unix: sock, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
    return Response.json({ ok: true, result: true })
  } })
  mkdirSync(io); writeFileSync(join(io, 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {}, groups: {} }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: 'http://keeper/telegram',
           TELEGRAM_API_UNIX: sock, TELEGRAM_JOURNAL_DIR: io, TELEGRAM_OUT_SPOOL: spool }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  const f = join(io, 'archive', String(OWNER), new Date().toISOString().slice(0, 7) + '.jsonl')
  const lines = () => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []
  for (let i = 0; i < 80; i++) { await Bun.sleep(100); if (lines().length >= 2) break }
  expect(lines().map((r: any) => [r.from, r.msg, r.text])).toEqual([['mila', 1, 'first answer'], ['mila', 2, 'second answer']])
  appendFileSync(spool, 'ssage", "chat_id": "' + OWNER + '", "message_id": 3, "text": "third"}\n')   // the partial line completes
  for (let i = 0; i < 80; i++) { await Bun.sleep(100); if (lines().length >= 3) break }
  await Bun.sleep(5500)                                                                       // one more pass: nothing doubles
  p.kill(); await p.exited; srv.stop(true)
  expect(lines().map((r: any) => r.msg)).toEqual([1, 2, 3])
  rmSync(dir, { recursive: true, force: true })
}, 40000)
