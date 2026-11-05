// TELEGRAM_API_ROOT: the receiver sends Bot API calls there (Mila Agent's key keeper puts the real token into the path).
// bun test api-root.test.ts — a fake API records paths; the receiver starts in daemon mode for a few seconds.
import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const PLACEHOLDER = '1234' + '5678:' + 'mila-keyd-placeholder-not-a-token'

test('with TELEGRAM_API_ROOT set, Bot API calls go there, with the token in the path as given', async () => {
  const seen: string[] = []
  const srv = Bun.serve({ port: 0, fetch(req) {
    seen.push(new URL(req.url).pathname)
    const m = new URL(req.url).pathname.split('/').pop()
    const result = m === 'getMe' ? { id: 12345678, is_bot: true, first_name: 'T', username: 't_bot' } : []
    return Response.json({ ok: true, result })
  } })
  const dir = mkdtempSync(join(tmpdir(), 'tg-root-'))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: PLACEHOLDER,
           TELEGRAM_API_ROOT: `http://127.0.0.1:${srv.port}/telegram/` },
    stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  for (let i = 0; i < 40 && !seen.length; i++) await Bun.sleep(100)
  await Bun.sleep(500)
  p.kill(); await p.exited; srv.stop(true); rmSync(dir, { recursive: true, force: true })
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.every(s => s.startsWith(`/telegram/bot${PLACEHOLDER}/`))).toBe(true)
}, 20000)
