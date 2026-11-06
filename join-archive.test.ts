// The archive is announced: the owner's connection card says Mila keeps an archive of the chat, and when the group is connected
// the group itself is told — its messages are kept, the owner reads them, removal is by asking the owner.
import { test, expect } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111, GROUP = -(100 * 1000000 + 4)

async function connect(pick: number) {
  const dir = mkdtempSync(join(tmpdir(), 'jarc-')), sock = join(dir, 'api.sock'), io = join(dir, 'io')
  const sent: any[] = []; let step = 0
  const added = { update_id: 1, my_chat_member: { chat: { id: GROUP, type: 'group', title: 'Team' }, from: { id: OWNER, is_bot: false, first_name: 'O' }, date: 1,
    old_chat_member: { user: { id: 777, is_bot: true, first_name: 'M' }, status: 'left' }, new_chat_member: { user: { id: 777, is_bot: true, first_name: 'M' }, status: 'member' } } }
  const srv = Bun.serve({ unix: sock, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    if (method === 'sendMessage') sent.push(body)
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (step === 0) { step = 1; return Response.json({ ok: true, result: [added] }) }
      const card = sent.find(b => String(b.chat_id) === String(OWNER) && b.reply_markup)
      if (step === 1 && card) {
        step = 2
        const data = card.reply_markup.inline_keyboard.flat()[pick].callback_data
        return Response.json({ ok: true, result: [{ update_id: 2, callback_query: { id: 'c', chat_instance: 'x', data, from: { id: OWNER, is_bot: false, first_name: 'O' },
          message: { message_id: 9, date: 1, chat: { id: OWNER, type: 'private' }, text: card.text } } }] })
      }
      await Bun.sleep(200); return Response.json({ ok: true, result: [] })
    }
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 1, chat: { id: body.chat_id, type: 'private' } } : true })
  } })
  mkdirSync(io); writeFileSync(join(io, 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {}, groups: {} }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: 'http://keeper/telegram',
           TELEGRAM_API_UNIX: sock, TELEGRAM_JOURNAL_DIR: io }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  try {   // the daemon dies with the test even when it fails or is cut short
    for (let i = 0; i < 100; i++) { await Bun.sleep(100); if (sent.some(b => String(b.chat_id) === String(GROUP))) break }
    await Bun.sleep(300)
  } finally { p.kill(); await p.exited; srv.stop(true); rmSync(dir, { recursive: true, force: true }) }
  return { card: sent.find(b => String(b.chat_id) === String(OWNER) && b.reply_markup), inGroup: sent.find(b => String(b.chat_id) === String(GROUP)) }
}

test('the archive is told: in the owner\'s card and in the group on connection', async () => {
  const { card, inGroup } = await connect(1)   // «By mention»
  expect(card?.text).toMatch(/keeps an archive of the chat/)
  expect(inGroup?.text).toMatch(/connected to this chat/); expect(inGroup?.text).toMatch(/keeps an archive of this chat; the owner can read it/)
}, 30000)

test('an observer group is not told in the group — only the owner\'s card says it', async () => {
  const { card, inGroup } = await connect(2)   // «Observer»
  expect(card?.text).toMatch(/keeps an archive of the chat/)
  expect(inGroup?.text).toMatch(/connected to this chat/); expect(inGroup?.text).not.toMatch(/archive/)
}, 30000)
