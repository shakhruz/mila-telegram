// SUPERGROUP-1004 tests: bun test supergroup.test.ts
import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateChat, mutateAccess, resolveChatId, migrateTargetFromError, supergroupTransformer } from './supergroup.mjs'

const OLD = '-5486792311', NEW = '-1004463170937'
let dir = ''
const acc = () => JSON.parse(readFileSync(join(dir, 'access.json'), 'utf8'))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sg-'))
  mkdirSync(join(dir, 'chats'))
  writeFileSync(join(dir, 'access.json'), JSON.stringify({
    dmPolicy: 'allowlist', allowFrom: ['1'], owners: ['1'], strangerGreeting: { text: 'hi' }, customField: 7,
    groups: { [OLD]: { requireMention: false, allowFrom: ['5'], observe: true }, '-100': { requireMention: true, allowFrom: [] } },
  }))
  writeFileSync(join(dir, 'chats', `${OLD}.md`), `# Артык x MilaGPT\n\nchat_id: ${OLD}\nрежим: all\n`)
  writeFileSync(join(dir, 'CHATS.md'), `# Подключённые чаты\n\n- Артык x MilaGPT · \`${OLD}\` · all\n- X · \`-100\` · mention\n`)
})

test('migrate moves access (same mode), card, CHATS.md, logs; old id removed; unknown fields kept', () => {
  const r = migrateChat(dir, OLD, NEW, 'test')
  expect(r.access && r.card && r.index).toBe(true)
  const a = acc()
  expect(a.groups[OLD]).toBeUndefined()
  expect(a.groups[NEW]).toEqual({ requireMention: false, allowFrom: ['5'], observe: true })
  expect(a.groups['-100']).toBeDefined()
  expect(a.customField).toBe(7); expect(a.strangerGreeting.text).toBe('hi')
  expect(existsSync(join(dir, 'chats', `${OLD}.md`))).toBe(false)
  expect(readFileSync(join(dir, 'chats', `${NEW}.md`), 'utf8')).toContain(`chat_id: ${NEW}`)
  const idx = readFileSync(join(dir, 'CHATS.md'), 'utf8')
  expect(idx).toContain(NEW); expect(idx).not.toContain(OLD)
  const last = readFileSync(join(dir, 'auth-log.jsonl'), 'utf8').trim().split('\n').pop()!
  expect(JSON.parse(last)).toMatchObject({ action: 'migrate', chat_id: NEW, old_chat_id: OLD })
  expect(resolveChatId(dir, OLD)).toBe(NEW)
  expect(resolveChatId(dir, Number(OLD))).toBe(Number(NEW))
})

test('idempotent; existing new entry wins; no double log', () => {
  migrateChat(dir, OLD, NEW)
  const n = readFileSync(join(dir, 'auth-log.jsonl'), 'utf8').split('\n').length
  const r = migrateChat(dir, OLD, NEW)
  expect(r.access || r.card || r.index || r.recorded).toBe(false)
  expect(readFileSync(join(dir, 'auth-log.jsonl'), 'utf8').split('\n').length).toBe(n)
  expect(acc().groups[NEW].observe).toBe(true)
})

test('manual pre-migration (new already present) still drops old', () => {
  const a = acc(); a.groups[NEW] = { requireMention: true, allowFrom: [] }; writeFileSync(join(dir, 'access.json'), JSON.stringify(a))
  migrateChat(dir, OLD, NEW)
  expect(acc().groups[OLD]).toBeUndefined()
  expect(acc().groups[NEW].requireMention).toBe(true)
})

test('error shapes', () => {
  expect(migrateTargetFromError({ ok: false, error_code: 400, parameters: { migrate_to_chat_id: -1004 } })).toBe('-1004')
  expect(migrateTargetFromError({ parameters: { retry_after: 3 } })).toBeNull()
  expect(migrateTargetFromError(null)).toBeNull()
})

test('transformer: 400 migrate -> migrate access + retry on new id; later sends go straight to new', async () => {
  const calls: any[] = []
  const prev = async (_m: string, p: any) => {
    calls.push(p.chat_id)
    return String(p.chat_id) === OLD
      ? { ok: false, error_code: 400, description: 'group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: Number(NEW) } }
      : { ok: true, result: { message_id: 1 } }
  }
  const t = supergroupTransformer(dir)
  const r1: any = await t(prev as any, 'sendMessage', { chat_id: OLD, text: 'x' } as any, undefined as any)
  expect(r1.ok).toBe(true); expect(calls).toEqual([OLD, NEW])
  expect(acc().groups[NEW]).toBeDefined(); expect(acc().groups[OLD]).toBeUndefined()
  calls.length = 0
  await t(prev as any, 'sendMessage', { chat_id: Number(OLD), text: 'y' } as any, undefined as any)
  expect(calls).toEqual([Number(NEW)])
  calls.length = 0
  const other: any = await t((async () => ({ ok: false, error_code: 403 })) as any, 'sendMessage', { chat_id: '5' } as any, undefined as any)
  expect(other.ok).toBe(false)
})

test('race: two processes mutating access.json lose no writes', async () => {
  const mod = join(import.meta.dir, 'supergroup.mjs')
  const script = (tag: string) => `import { mutateAccess } from ${JSON.stringify(mod)}; for (let i=0;i<40;i++) mutateAccess(${JSON.stringify(dir)}, r => { r.groups['${tag}'+i] = {requireMention:false,allowFrom:[]} })`
  const ps = ['a', 'b'].map(t => Bun.spawn(['bun', '-e', script(t)], { stderr: 'inherit' }))
  await Promise.all(ps.map(p => p.exited))
  const g = acc().groups
  for (const t of ['a', 'b']) for (let i = 0; i < 40; i++) expect(g[t + i]).toBeDefined()
  expect(g[OLD]).toBeDefined()
})

test('real grammy Bot against a mock Bot API: 400 migrate_to_chat_id -> retried on new id, state migrated', async () => {
  const { Bot } = await import('grammy')
  const seen: string[] = []
  const srv = Bun.serve({ port: 0, async fetch(req) {
    const b: any = await req.json()
    seen.push(String(b.chat_id))
    if (String(b.chat_id) === OLD) {
      return Response.json({ ok: false, error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: Number(NEW) } }, { status: 400 })
    }
    return Response.json({ ok: true, result: { message_id: 7, chat: { id: Number(b.chat_id) }, date: 1, text: b.text } })
  } })
  try {
    const bot = new Bot('123:TEST', { botInfo: { id: 123, is_bot: true, first_name: 'T', username: 't_bot' } as any, client: { apiRoot: `http://localhost:${srv.port}` } })
    bot.api.config.use(supergroupTransformer(dir, 'test'))
    const m = await bot.api.sendMessage(OLD, 'hello')
    expect(m.message_id).toBe(7)
    expect(seen).toEqual([OLD, NEW])
    expect(acc().groups[NEW]).toBeDefined(); expect(acc().groups[OLD]).toBeUndefined()
    await bot.api.sendMessage(OLD, 'again'); expect(seen.slice(2)).toEqual([NEW])
  } finally { srv.stop(true) }
})
