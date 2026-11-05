// Safe by default, server.ts path (no receiver daemon): in a group, a stranger's message does not reach the session — it is not
// sent over MCP, it lands in guests.jsonl (0600). The owner's and a team member's messages in the same group do reach it.
import { test, expect } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111, TEAM = 555 * 1000000 + 222, OTHER = 555 * 1000000 + 999, GROUP = -(100 * 1000000 + 8)

test('server.ts: a stranger in a group goes to guests.jsonl, not to the session; owner and team do', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-route-'))
  const msg = (id: number, uid: number, text: string, extra: any = {}) => ({ update_id: id, message: { message_id: id, date: 1,
    chat: { id: GROUP, type: 'supergroup', title: 'G' }, from: { id: uid, is_bot: false, first_name: 'X', ...extra }, text } })
  const updates = [msg(1, OTHER, 'stranger says hi', { first_name: 'Shahruz' }), msg(2, OWNER, 'owner task'), msg(3, TEAM, 'team task'),
                   msg(4, 136 * 1000000 + 817688, 'channel post', { is_bot: true, first_name: 'Channel_Bot' })]
  let served = false
  const srv = Bun.serve({ port: 0, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true; return Response.json({ ok: true, result: updates })
    }
    return Response.json({ ok: true, result: true })
  } })
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {},
    groups: { [String(GROUP)]: { requireMention: false, allowFrom: [], team: [String(TEAM)] } } }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'server.ts')], {
    env: { ...base, TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: `http://127.0.0.1:${srv.port}` },
    stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  const out: string[] = []
  ;(async () => { const dec = new TextDecoder(); for await (const ch of p.stdout as any) out.push(dec.decode(ch)) })()
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n')
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const gf = join(dir, 'inbound', 'guests.jsonl')
  for (let i = 0; i < 100; i++) { await Bun.sleep(100); if (out.join('').includes('team task') && existsSync(gf) && readFileSync(gf, 'utf8').includes('channel post')) break }
  await Bun.sleep(300)
  p.kill(); await p.exited; srv.stop(true)
  const all = out.join('')
  expect(all).toContain('owner task'); expect(all).toContain('team task')
  expect(all).not.toContain('stranger says hi'); expect(all).not.toContain('channel post')
  // the session learns only how many strangers wrote since it last heard from the chat — the number, not the text
  const metaOf = (txt: string) => all.split('\n').filter(l => l.includes(txt)).map(l => JSON.parse(l).params.meta)[0]
  expect(metaOf('owner task').guests_since_last).toBe('1'); expect(metaOf('team task').guests_since_last).toBeUndefined()
  const g = readFileSync(gf, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  expect(g.map((x: any) => x.text)).toEqual(['stranger says hi', 'channel post'])
  expect(statSync(gf).mode & 0o777).toBe(0o600)
  rmSync(dir, { recursive: true, force: true })
}, 30000)

test('team: a stranger → a card to the owner; the owner\'s press in a private chat adds them; a press in the group or by someone else does not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-team-'))
  const gmsg = (id: number, uid: number, text: string) => ({ update_id: id, message: { message_id: id, date: 1,
    chat: { id: GROUP, type: 'supergroup', title: 'G' }, from: { id: uid, is_bot: false, first_name: 'Ivan', username: 'ivan_x' }, text } })
  const press = (id: number, uid: number, chat: any, data: string) => ({ update_id: id, callback_query: { id: 'cb' + id, chat_instance: 'x', data,
    from: { id: uid, is_bot: false, first_name: 'P' }, message: { message_id: 90 + id, date: 1, chat, text: 'card' } } })
  const priv = (uid: number) => ({ id: uid, type: 'private' })
  const batches = [
    [gmsg(1, OTHER, 'first from stranger')],
    [press(2, OTHER, priv(OTHER), `team:add:${GROUP}:${OTHER}`),                          // the stranger presses himself — refused
     press(3, OWNER, { id: GROUP, type: 'supergroup', title: 'G' }, `team:add:${GROUP}:${OTHER}`),   // in the group — refused
     gmsg(4, OTHER, 'second from stranger')],
    [press(5, OWNER, priv(OWNER), `team:add:${GROUP}:${OTHER}`)],
    [gmsg(6, OTHER, 'now on the team')],
  ]
  const calls: Array<{ method: string, body: any }> = []
  let step = 0
  const srv = Bun.serve({ port: 0, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    calls.push({ method, body })
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      await Bun.sleep(step === 0 ? 0 : 700)
      const b = batches[step]; if (!b) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      step++; return Response.json({ ok: true, result: b })
    }
    if (method === 'sendMessage') return Response.json({ ok: true, result: { message_id: 50, date: 1, chat: { id: body.chat_id, type: 'private' }, text: body.text } })
    return Response.json({ ok: true, result: true })
  } })
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {},
    groups: { [String(GROUP)]: { requireMention: false, allowFrom: [] } } }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'server.ts')], {
    env: { ...base, TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: `http://127.0.0.1:${srv.port}` },
    stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  const out: string[] = []
  ;(async () => { const dec = new TextDecoder(); for await (const ch of p.stdout as any) out.push(dec.decode(ch)) })()
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n')
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  for (let i = 0; i < 150; i++) { await Bun.sleep(100); if (out.join('').includes('now on the team')) break }
  await Bun.sleep(300)
  p.kill(); await p.exited; srv.stop(true)
  const cards = calls.filter(c => c.method === 'sendMessage' && String(c.body.text).includes('ivan_x'))
  expect(cards.length).toBe(1)                                                    // one card, not one per message
  expect(String(cards[0]!.body.chat_id)).toBe(String(OWNER))
  expect(JSON.stringify(cards[0]!.body.reply_markup)).toContain(`team:add:${GROUP}:${OTHER}`)
  const all = out.join('')
  expect(all).not.toContain('first from stranger'); expect(all).not.toContain('second from stranger')   // the refused presses changed nothing
  expect(all).toContain('now on the team')                                       // after the owner's press in a private chat
  expect(JSON.parse(readFileSync(join(dir, 'team.json'), 'utf8')).teams[String(GROUP)]).toEqual([String(OTHER)])
  rmSync(dir, { recursive: true, force: true })
}, 40000)
