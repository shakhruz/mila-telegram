// Where the bot token comes from: the plugin option (bot_token → TELEGRAM_BOT_TOKEN_FROM_CONFIG), the shell, .env.
// bun test token-source.test.ts — starts server.ts with stdin closed, so it stops right after the token check.
import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const FAKE = '1234' + '56789:AAH' + 'fakefakefakefake'   // glued: not a real token shape in the source

function start(env: Record<string, string>, dotenv?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tg-token-'))
  try {
    if (dotenv !== undefined) writeFileSync(join(dir, '.env'), dotenv, { mode: 0o600 })
    const base: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
    const r = Bun.spawnSync(['bun', join(import.meta.dir, 'server.ts')], {
      env: { ...base, ...env, TELEGRAM_STATE_DIR: dir }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', timeout: 15000,
    })
    return r.stderr.toString()
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const REQUIRED = 'TELEGRAM_BOT_TOKEN required'

test('option unset (Claude Code passes ""), nothing else → asks for the token and names /plugin configure', () => {
  const err = start({ TELEGRAM_BOT_TOKEN_FROM_CONFIG: '' })
  expect(err).toContain(REQUIRED)
  expect(err).toContain('/plugin configure mila-telegram@mila')
})

test('option unset + .env → the existing .env still works', () => {
  expect(start({ TELEGRAM_BOT_TOKEN_FROM_CONFIG: '' }, `TELEGRAM_BOT_TOKEN=${FAKE}\n`)).not.toContain(REQUIRED)
})

test('option unset + shell variable → the shell still works', () => {
  expect(start({ TELEGRAM_BOT_TOKEN_FROM_CONFIG: '', TELEGRAM_BOT_TOKEN: FAKE })).not.toContain(REQUIRED)
})

test('option set, no .env → works without any file', () => {
  expect(start({ TELEGRAM_BOT_TOKEN_FROM_CONFIG: FAKE })).not.toContain(REQUIRED)
})

test('option of spaces counts as unset', () => {
  expect(start({ TELEGRAM_BOT_TOKEN_FROM_CONFIG: '   ' })).toContain(REQUIRED)
})

test('the token is never printed', () => {
  for (const err of [start({ TELEGRAM_BOT_TOKEN_FROM_CONFIG: FAKE }), start({}, `TELEGRAM_BOT_TOKEN=${FAKE}\n`)])
    expect(err).not.toContain(FAKE.split(':')[1])
})
