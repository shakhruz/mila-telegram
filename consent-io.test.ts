// A press on the consent proxy's card goes to the proxy (TELEGRAM_CONSENT_IO), with who pressed and where; the proxy decides,
// the receiver only says the outcome on the button and under the card. A fake Bot API and a fake proxy on unix sockets.
import { test, expect } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111

test('consent press → the proxy decides → the outcome on the button and under the card', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cio-')), api = join(dir, 'api.sock'), io = join(dir, 'consent.io.sock')
  const DATA = 'consent:0a1b2c3d.' + '01234' + '56789abcdef0123' + '.y'
  const sent: Array<{ method: string, body: any }> = []; let served = false
  const press = (id: number, data: string) => ({ update_id: id, callback_query: { id: 'cb' + id, chat_instance: 'x', data, from: { id: OWNER, is_bot: false, first_name: 'O' },
    message: { message_id: 40 + id, date: 1, chat: { id: OWNER, type: 'private' }, text: 'Публикуем? · Instagram' } } })
  const srv = Bun.serve({ unix: api, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    sent.push({ method, body })
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true; return Response.json({ ok: true, result: [press(1, DATA), press(2, 'consent:zz.not-ours')] })
    }
    return Response.json({ ok: true, result: true })
  } })
  const got: any[] = []
  const proxy = Bun.listen({ unix: io, socket: { data(s, d) { got.push(JSON.parse(d.toString().trim())); s.write(JSON.stringify({ status: 'granted' }) + '\n'); s.end() } } })
  mkdirSync(join(dir, 'io')); writeFileSync(join(dir, 'io', 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {}, groups: {} }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: 'http://keeper/telegram',
           TELEGRAM_API_UNIX: api, TELEGRAM_JOURNAL_DIR: join(dir, 'io'), TELEGRAM_CONSENT_IO: io }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  for (let i = 0; i < 60; i++) { await Bun.sleep(100); if (sent.some(x => x.method === 'editMessageText')) break }
  await Bun.sleep(400)
  p.kill(); await p.exited; srv.stop(true); proxy.stop(true); rmSync(dir, { recursive: true, force: true })
  expect(got).toEqual([{ op: 'callback', data: DATA, from_id: String(OWNER), chat_id: String(OWNER) }])   // only the well-formed press, with who and where
  expect(sent.find(x => x.method === 'answerCallbackQuery' && x.body.callback_query_id === 'cb1')?.body.text).toMatch(/Allowed/)
  expect(sent.find(x => x.method === 'editMessageText')?.body.text).toMatch(/Публикуем\? · Instagram\n\n✅ Allowed/)
}, 30000)
