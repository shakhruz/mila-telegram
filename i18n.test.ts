// The bot's own words in the person's language: dictionary, choice of language, fallback to English, memory of the language,
// and the group card end to end (a fake Bot API, the receiver in daemon mode, the bot added to a group).
import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { keys, langOf, pickLang, rememberLang, t, words, LANGS } from './i18n.mjs'

test('every key has all four languages, and placeholders match English', () => {
  for (const k of keys()) {
    const w = words(k)
    for (const l of LANGS) expect(typeof w[l] === 'string' && w[l].length > 0).toBe(true)
    const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(',')
    for (const l of LANGS) expect(ph(w[l])).toBe(ph(w.en))
  }
})

test('language: ru-RU → ru, uz → uz, zh-hans → zh, de / empty → en (fallback)', () => {
  expect(pickLang('ru-RU')).toBe('ru'); expect(pickLang('uz')).toBe('uz'); expect(pickLang('zh-hans')).toBe('zh')
  expect(pickLang('de')).toBe('en'); expect(pickLang(undefined)).toBe('en')
  expect(t('de', 'mode.all')).toBe(t('en', 'mode.all'))
  expect(t('ru', 'join.connected', { mode: 'X' })).toBe('✅ Подключено: X')
})

test('the owner\'s language is remembered from their last message; unknown person → en', () => {
  const d = mkdtempSync(join(tmpdir(), 'lang-'))
  try {
    expect(langOf(d, '42')).toBe('en')
    rememberLang(d, '42', 'uz'); expect(langOf(d, '42')).toBe('uz')
    rememberLang(d, '42', 'ru-RU'); expect(langOf(d, '42')).toBe('ru')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('Uzbek is in Latin letters (no Cyrillic)', () => {
  for (const k of keys()) expect(/[А-Яа-яЁё]/.test(words(k).uz)).toBe(false)
})

test('the group card: comes to the owner in their language, no chat_id or request code', async () => {
  const OWNER = 555 * 1000000 + 111, GROUP = -(100 * 1000000 + 5)
  const sent: any[] = []
  let served = false
  const srv = Bun.serve({ port: 0, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true
      return Response.json({ ok: true, result: [{ update_id: 1, my_chat_member: {
        chat: { id: GROUP, type: 'supergroup', title: 'Команда' }, date: 1,
        from: { id: OWNER, is_bot: false, first_name: 'Ivan', username: 'ivan', language_code: 'ru' },
        old_chat_member: { status: 'left', user: { id: 777, is_bot: true, first_name: 'M' } },
        new_chat_member: { status: 'member', user: { id: 777, is_bot: true, first_name: 'M' } } } },
        { update_id: 2, message: { message_id: 5, date: 1, chat: { id: GROUP, type: 'supergroup', title: 'Команда' },
          from: { id: 999001, is_bot: false, first_name: 'Guest', language_code: 'uz' }, text: 'salom' } }] })
    }
    if (method === 'sendMessage') sent.push(body)
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 1, chat: { id: body.chat_id, type: 'private' } } : true })
  } })
  const dir = mkdtempSync(join(tmpdir(), 'tg-card-'))
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], groups: {}, pending: {} }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35),
           TELEGRAM_API_ROOT: `http://127.0.0.1:${srv.port}` }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  for (let i = 0; i < 80 && !sent.length; i++) await Bun.sleep(100)
  await Bun.sleep(400)
  p.kill(); await p.exited; srv.stop(true)
  const langs = JSON.parse(require('fs').readFileSync(join(dir, 'langs.json'), 'utf8'))
  rmSync(dir, { recursive: true, force: true })
  expect(langs[String(OWNER)]).toBe('ru')            // who added the bot — remembered
  expect(langs['999001']).toBeUndefined()            // a member writing in the group — not
  const card = sent.find(m => String(m.chat_id) === String(OWNER))
  expect(card).toBeDefined()
  expect(card.text).toContain('Как ей там работать?')
  expect(card.text).toContain('«Команда»')
  expect(card.text).not.toContain(String(GROUP))
  expect(card.text).not.toMatch(/\[[0-9a-f]{8}\]/)
  const labels = card.reply_markup.inline_keyboard.flat().map((b: any) => b.text)
  expect(labels).toEqual(['🙋 Только мне', '🏷 По упоминанию', '💬 Вести чат', '👁 Наблюдатель', '❌ Отказать'])
  const data = card.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data.split(':')[1])
  expect(data).toEqual(['owner', 'mention', 'all', 'observe', 'deny'])
}, 30000)
