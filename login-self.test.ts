// LOGIN-SELF-1006 tests: bun test login-self.test.ts
import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loginSelf, isLoginWord, needsLogin } from './login-self.mjs'

let dir = '', sent: any[] = [], failDm = false
const api = { sendMessage: async (chat: any, text: string, extra?: any) => {
  if (failDm && chat === 418) throw { description: 'Bad Request: chat not found' }
  sent.push({ chat, text, extra }); return {} } }
const base = () => ({ api, slug: 'amirpg', botUsername: 'amirpg_mila_bot', stateDir: dir, authMode: 'subscription',
  chatType: 'private', chatId: 418, senderId: 418, isOwner: true, text: '/start', now: 1_000_000 })
const auth = (v: string) => writeFileSync(join(dir, 'auth'), v + '\n')
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ls-')); sent = []; failDm = false })

test('words: exact short phrases only', () => {
  for (const w of ['вход', 'Войти!', '/login', '/login@amirpg_mila_bot', 'ссылка не работает']) expect(isLoginWord(w)).toBe(true)
  for (const w of ['как войти в кабинет TeamAvia?', 'вход в офис в 9', '']) expect(isLoginWord(w)).toBe(false)
})
test('auth pending: owner DM gets web_app button once per cooldown', async () => {
  auth('pending')
  const r = await loginSelf(base())
  expect(r.action).toBe('button'); expect(sent.length).toBe(1)
  expect(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://login.milagpt.io/connect/?slug=amirpg')
  expect((await loginSelf({ ...base(), now: 1_000_000 + 5 * 60_000 })).action).toBe('none')
  expect((await loginSelf({ ...base(), now: 1_000_000 + 11 * 60_000 })).action).toBe('button')
  expect(sent.length).toBe(2)
})
test('auth expired counts; running/starting does not; apikey mode never', async () => {
  auth('expired'); expect(needsLogin(dir)).toBe(true)
  auth('running'); expect((await loginSelf(base())).action).toBe('none')
  auth('starting'); expect(needsLogin(dir)).toBe(false)
  auth('pending'); expect((await loginSelf({ ...base(), authMode: 'apikey' })).action).toBe('none')
  expect(sent.length).toBe(0)
})
test('login word: fresh button even with live login, and swallowed', async () => {
  auth('running')
  const r = await loginSelf({ ...base(), text: 'вход' })
  expect(r).toEqual({ action: 'button', swallow: true }); expect(sent.length).toBe(1)
  expect((await loginSelf({ ...base(), text: 'вход', now: 1_000_000 + 3000 })).action).toBe('none') // flood gap
})
test('not owner: nothing, ever', async () => {
  auth('pending'); await loginSelf({ ...base(), isOwner: false }); await loginSelf({ ...base(), isOwner: false, text: 'вход' })
  expect(sent.length).toBe(0)
})
test('group, DM never opened: one-line hint in the group, no link in the group', async () => {
  auth('pending'); failDm = true
  const r = await loginSelf({ ...base(), chatType: 'supergroup', chatId: -100123 })
  expect(r.action).toBe('group-hint'); expect(sent.length).toBe(1)
  expect(sent[0].chat).toBe(-100123); expect(sent[0].text).toBe('Откройте @amirpg_mila_bot и нажмите «Старт» — пришлю кнопку входа туда.')
  expect(JSON.stringify(sent[0])).not.toContain('login.milagpt.io')
  expect((await loginSelf({ ...base(), chatType: 'supergroup', chatId: -100123, now: 1_000_000 + 60_000 })).action).toBe('none') // spam guard
})
test('group, DM open: button goes to DM only, group gets a no-link note on a login word', async () => {
  auth('pending')
  await loginSelf({ ...base(), chatType: 'group', chatId: -5, text: 'войти' })
  expect(sent[0].chat).toBe(418); expect(sent[0].extra.reply_markup).toBeDefined()
  expect(sent[1].chat).toBe(-5); expect(JSON.stringify(sent[1])).not.toContain('login.milagpt.io')
})
test('live login + plain message: untouched', async () => {
  auth('running'); expect((await loginSelf({ ...base(), text: 'привет' })).action).toBe('none'); expect(sent.length).toBe(0)
})
