// A voice is transcribed only after the gate: from someone not allowed (a DM stranger) or from a stranger in a group, it is
// never downloaded and never sent to speech-to-text. The owner's voice is. server.ts against a fake Bot API, a fake STT command.
import { test, expect } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111, OTHER = 555 * 1000000 + 999, GROUP = -(100 * 1000000 + 6)

test('voice: only the allowed get downloaded and transcribed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-gate-'))
  const stt = join(dir, 'stt.sh'), sttLog = join(dir, 'stt.log')
  writeFileSync(stt, `#!/bin/sh\necho "$1" >> ${sttLog}\necho "hello from the owner"\n`); chmodSync(stt, 0o700)
  const voice = (id: number, uid: number, chat: any) => ({ update_id: id, message: { message_id: id, date: 1, chat,
    from: { id: uid, is_bot: false, first_name: 'X' }, voice: { file_id: 'v' + id, file_unique_id: 'u' + id, duration: 1, mime_type: 'audio/ogg', file_size: 10 } } })
  const updates = [voice(1, OTHER, { id: OTHER, type: 'private' }), voice(2, OTHER, { id: GROUP, type: 'supergroup', title: 'G' }),
                   voice(3, OWNER, { id: OWNER, type: 'private' })]
  const files: string[] = []; let served = false
  const srv = Bun.serve({ port: 0, async fetch(req) {
    const path = new URL(req.url).pathname, method = path.split('/').pop()!
    if (path.includes('/file/')) { files.push(path); return new Response('OggS') }
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true; return Response.json({ ok: true, result: updates })
    }
    if (method === 'getFile') return Response.json({ ok: true, result: { file_id: body.file_id, file_unique_id: 'x' + body.file_id, file_path: 'voice/' + body.file_id + '.oga', file_size: 10 } })
    return Response.json({ ok: true, result: true })
  } })
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {},
    groups: { [String(GROUP)]: { requireMention: false, allowFrom: [] } } }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'server.ts')], {
    env: { ...base, TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: `http://127.0.0.1:${srv.port}`,
           TELEGRAM_VOICE_TRANSCRIBE_CMD: stt }, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  const out: string[] = []
  ;(async () => { const dec = new TextDecoder(); for await (const ch of p.stdout as any) out.push(dec.decode(ch)) })()
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n')
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  for (let i = 0; i < 80; i++) { await Bun.sleep(100); if (out.join('').includes('hello from the owner')) break }
  await Bun.sleep(400)
  p.kill(); await p.exited; srv.stop(true)
  expect(out.join('')).toContain('[voice transcript]: hello from the owner')
  expect(files.length).toBe(1); expect(files[0]).toContain('v3')                       // only the owner's voice was downloaded
  expect(readFileSync(sttLog, 'utf8').trim().split('\n').length).toBe(1)                // and only it went to speech-to-text
  const inbox = join(dir, 'inbox'); expect(existsSync(inbox) ? readdirSync(inbox).length : 0).toBe(1)
  const g = readFileSync(join(dir, 'inbound', 'guests.jsonl'), 'utf8')
  expect(g).toContain('(voice message)'); expect(g).not.toContain('hello')              // the stranger's voice: a placeholder
  rmSync(dir, { recursive: true, force: true })
}, 30000)
