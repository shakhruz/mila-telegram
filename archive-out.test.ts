// Archive part C: the keeper's spool folder (a file per send) moves into the archive as «mila» lines, each once, and the folder
// empties — it is memory. A file still being written (a dot name) waits; a file that is not a send is dropped. A fake Bot API.
import { test, expect } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111

test('outgoing: from the spool folder into the archive, once each, the folder empties', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arco-')), sock = join(dir, 'api.sock'), io = join(dir, 'io'), spool = join(dir, 'out')
  const row = (id: number, text: string) => JSON.stringify({ ts: 1000 + id, method: 'sendMessage', chat_id: String(OWNER), message_id: id, text })
  mkdirSync(spool)
  for (let i = 1; i <= 300; i++) writeFileSync(join(spool, `${1000 + i}-7-${i}.json`), row(i, 'answer ' + i))
  writeFileSync(join(spool, '.2000-7-999.json'), row(999, 'third'))            // still being written
  writeFileSync(join(spool, '1500-7-998.json'), '{"not": "a send"}')
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
  try {
    for (let i = 0; i < 80; i++) { await Bun.sleep(100); if (lines().length >= 300) break }
    const got = lines()
    expect(got.length).toBe(300)
    expect([got[0].from, got[0].kind, got[0].msg, got[0].text, got[0].ts]).toEqual(['mila', 'out', 1, 'answer 1', 1001])
    expect(readdirSync(spool)).toEqual(['.2000-7-999.json'])                  // the folder is empty but the half-written one
    renameSync(join(spool, '.2000-7-999.json'), join(spool, '2000-7-999.json'))   // now written whole
    for (let i = 0; i < 80; i++) { await Bun.sleep(100); if (lines().length >= 301) break }
    await Bun.sleep(5500)                                                                     // one more pass: nothing doubles
    expect(lines().map((r: any) => r.msg).slice(-2)).toEqual([300, 999])
    expect(lines().length).toBe(301)
    expect(readdirSync(spool)).toEqual([])
  } finally { p.kill(); await p.exited; srv.stop(true); rmSync(dir, { recursive: true, force: true }) }
}, 40000)
