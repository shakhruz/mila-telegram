// Pin and forum topics: the topics registry, where an inbound came from (thread_id), Telegram's service events, and the
// `reply` (into a topic), `pin`, `topic` tools end to end — server.ts over MCP stdio against a fake Bot API.
import { test, expect } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isTopicRoot, topicMeta, topicsAll, topicsUpdate } from './topics.mjs'

const GROUP = String(-(100 * 1000000 + 9)), OWNER = String(555 * 1000000 + 111)

test('registry: update, name from the topic root, a reply to the root is not a person\'s reply', () => {
  const d = mkdtempSync(join(tmpdir(), 'topics-'))
  try {
    const msg = { message_id: 3, is_topic_message: true, message_thread_id: 42, chat: { id: Number(GROUP), type: 'supergroup' },
                  reply_to_message: { message_id: 42, forum_topic_created: { name: 'Launch' } } }
    expect(topicMeta(d, GROUP, msg, 'ivan')).toEqual({ thread_id: '42', topic: 'Launch' })
    expect(topicsAll(d)[GROUP]['42']).toMatchObject({ name: 'Launch', status: 'open', last_user: 'ivan' })
    expect(isTopicRoot(msg.reply_to_message)).toBe(true)
    expect(topicMeta(d, GROUP, { message_id: 4, chat: { id: 1, type: 'supergroup' } }, 'x')).toEqual({})   // General / plain chat
    topicsUpdate(d, GROUP, 42, { status: 'closed' })
    expect(topicsAll(d)[GROUP]['42'].status).toBe('closed')
    // a second folder that links to this registry (the session's in Mila Agent) writes through the link, does not replace it
    const d2 = mkdtempSync(join(tmpdir(), 'topics-link-'))
    require('fs').symlinkSync(join(d, 'topics.json'), join(d2, 'topics.json'))
    topicsUpdate(d2, GROUP, 43, { name: 'Second' })
    expect(require('fs').lstatSync(join(d2, 'topics.json')).isSymbolicLink()).toBe(true)
    expect(topicsAll(d)[GROUP]['43'].name).toBe('Second')
    rmSync(d2, { recursive: true, force: true })
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('server tools: reply into a topic, pin silently, unpin, topic create/rename/close/list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'topics-srv-'))
  const calls: Array<{ method: string, body: any }> = []
  const srv = Bun.serve({ port: 0, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    calls.push({ method, body })
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') { await Bun.sleep(200); return Response.json({ ok: true, result: [] }) }
    if (method === 'sendMessage') return Response.json({ ok: true, result: { message_id: 90, date: 1, chat: { id: body.chat_id, type: 'supergroup' } } })
    if (method === 'createForumTopic') return Response.json({ ok: true, result: { message_thread_id: 77, name: body.name, icon_color: 0 } })
    return Response.json({ ok: true, result: true })
  } })
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [OWNER], pending: {},
    groups: { [GROUP]: { requireMention: true, allowFrom: [] } } }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'server.ts')], {
    env: { ...base, TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: `http://127.0.0.1:${srv.port}` },
    stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  const out: string[] = []
  ;(async () => { const dec = new TextDecoder(); for await (const ch of p.stdout as any) out.push(dec.decode(ch)) })()
  let id = 0
  const send = (method: string, params: any) => { p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n'); return id }
  const result = async (rid: number) => {
    for (let i = 0; i < 100; i++) {
      const line = out.join('').split('\n').find(l => l.includes(`"id":${rid},`) || l.includes(`"id":${rid}}`))
      if (line) return JSON.parse(line)
      await Bun.sleep(50)
    }
    return null
  }
  const call = async (name: string, args: any) => result(send('tools/call', { name, arguments: args }))
  await result(send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }))
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  const list = await result(send('tools/list', {}))
  const names = (list?.result?.tools ?? []).map((t: any) => t.name)
  expect(names).toContain('pin'); expect(names).toContain('topic')

  await call('reply', { chat_id: GROUP, text: 'in the topic', thread_id: '42' })
  expect(calls.find(c => c.method === 'sendMessage')?.body.message_thread_id).toBe(42)

  await call('pin', { chat_id: GROUP, message_id: '90' })
  const pin = calls.find(c => c.method === 'pinChatMessage')
  expect(pin?.body.message_id).toBe(90); expect(pin?.body.disable_notification).toBe(true)
  await call('pin', { chat_id: GROUP, message_id: '90', unpin: true })
  expect(calls.some(c => c.method === 'unpinChatMessage')).toBe(true)

  const created = await call('topic', { chat_id: GROUP, action: 'create', name: 'Release' })
  expect(JSON.stringify(created)).toContain('created thread_id 77')
  await call('topic', { chat_id: GROUP, action: 'rename', thread_id: '77', name: 'Release v2' })
  await call('topic', { chat_id: GROUP, action: 'close', thread_id: '77' })
  expect(calls.some(c => c.method === 'editForumTopic' && c.body.name === 'Release v2')).toBe(true)
  expect(calls.some(c => c.method === 'closeForumTopic' && c.body.message_thread_id === 77)).toBe(true)
  const listed = await call('topic', { chat_id: GROUP, action: 'list' })
  expect(JSON.stringify(listed)).toContain('Release v2')
  expect(JSON.parse(readFileSync(join(dir, 'topics.json'), 'utf8'))[GROUP]['77'].status).toBe('closed')

  const notAllowed = await call('pin', { chat_id: String(-(100 * 1000000 + 1)), message_id: '1' })   // a chat that is not connected
  expect(JSON.stringify(notAllowed)).toMatch(/isError|not allowlisted|not allowed/i)

  p.kill(); await p.exited; srv.stop(true)
  rmSync(dir, { recursive: true, force: true })
}, 40000)
