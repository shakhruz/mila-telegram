// TELEGRAM_SAFE_GROUPS=0 outside Mila Agent: a Mila that serves customers in a group with no team list — everyone the group's
// policy lets in reaches the session, as before (no guests' journal, no team card, quotes as they are). In Mila Agent (the
// receiver's own journals) the switch is ignored: strangers stay out.
import { test, expect } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111, OTHER = 555 * 1000000 + 999, GROUP = -(100 * 1000000 + 8)
const msg = (id: number, uid: number, text: string, extra: any = {}) => ({ update_id: id, message: { message_id: id, date: 1,
  chat: { id: GROUP, type: 'supergroup', title: 'G' }, from: { id: uid, is_bot: false, first_name: 'X' }, text, ...extra } })
const updates = [msg(1, OTHER, 'customer asks the price'),
                 msg(2, OWNER, 'owner answers the customer', { reply_to_message: { message_id: 1, date: 1, chat: { id: GROUP, type: 'supergroup' },
                   from: { id: OTHER, is_bot: false, first_name: 'C' }, text: 'customer asks the price' } })]
const access = { dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {}, groups: { [String(GROUP)]: { requireMention: false, allowFrom: [] } } }

function fakeApi(opts: any, calls: any[]) {
  let served = false
  return Bun.serve({ ...opts, async fetch(req: Request) {
    const method = new URL(req.url).pathname.split('/').pop()!
    if (req.method === 'POST') { try { calls.push({ method, body: await req.json() }) } catch {} }
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true; return Response.json({ ok: true, result: updates })
    }
    return Response.json({ ok: true, result: true })
  } })
}
const baseEnv = () => { const b: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) b[k] = v; return b }

test('server.ts with TELEGRAM_SAFE_GROUPS=0: a customer in a group reaches the session; no guests journal, no team card', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-off-')), calls: any[] = []
  const srv = fakeApi({ port: 0 }, calls)
  writeFileSync(join(dir, 'access.json'), JSON.stringify(access))
  const p = Bun.spawn(['bun', join(import.meta.dir, 'server.ts')], {
    env: { ...baseEnv(), TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: `http://127.0.0.1:${srv.port}`,
           TELEGRAM_SAFE_GROUPS: '0' }, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  const out: string[] = []
  ;(async () => { const dec = new TextDecoder(); for await (const ch of p.stdout as any) out.push(dec.decode(ch)) })()
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n')
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  try {
    for (let i = 0; i < 100; i++) { await Bun.sleep(100); if (out.join('').includes('owner answers the customer')) break }
    await Bun.sleep(300)
  } finally { p.kill(); await p.exited; srv.stop(true) }
  const all = out.join('')
  const metaOf = (txt: string) => all.split('\n').filter(l => l.includes(txt)).map(l => JSON.parse(l).params.meta)[0]
  expect(all).toContain('customer asks the price')
  expect(metaOf('owner answers the customer').reply_quote).toBe('customer asks the price')
  expect(existsSync(join(dir, 'inbound', 'guests.jsonl'))).toBe(false)
  expect(calls.some(c => JSON.stringify(c.body ?? {}).includes('team:add'))).toBe(false)
  rmSync(dir, { recursive: true, force: true })
}, 30000)

test('Mila Agent (receiver with its journals) ignores TELEGRAM_SAFE_GROUPS=0: the stranger stays out of the session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-off-io-')), sock = join(dir, 'api.sock'), io = join(dir, 'io'), calls: any[] = []
  const srv = fakeApi({ unix: sock }, calls)
  mkdirSync(io); writeFileSync(join(io, 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  writeFileSync(join(dir, 'access.json'), JSON.stringify(access))
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...baseEnv(), RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: 'http://keeper/telegram',
           TELEGRAM_API_UNIX: sock, TELEGRAM_JOURNAL_DIR: io, TELEGRAM_SAFE_GROUPS: '0' }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  const ev = join(io, 'events.jsonl'), gf = join(io, 'guests.jsonl')
  try {
    for (let i = 0; i < 100; i++) { await Bun.sleep(100); if (existsSync(ev) && readFileSync(ev, 'utf8').includes('owner answers the customer')) break }
    await Bun.sleep(300)
  } finally { p.kill(); await p.exited; srv.stop(true) }
  const events = readFileSync(ev, 'utf8')
  expect(events).toContain('owner answers the customer')
  expect(events).not.toContain('"customer asks the price"')
  expect(readFileSync(gf, 'utf8')).toContain('customer asks the price')
  rmSync(dir, { recursive: true, force: true })
}, 30000)
