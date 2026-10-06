// LOGIN-SELF-1006: a companion without a live model login cannot ask for one —
// and a bot cannot write first. So the *receiver* (no model involved) answers the
// owner's first message with a web_app login button, and on "вход" / "/login" always
// hands out a fresh one. Group chats never get the link: the owner is told, in one
// line, to open the bot and press Start.
//
// Plain JS, no dependencies, side effects only through the injected `api`
// (grammy-style: api.sendMessage(chatId, text, { reply_markup })) and small files
// under stateDir. Secrets are never logged; the login URL carries only the slug.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LOGIN_WORDS = ['вход', 'войти', 'ссылка входа', 'ссылка не работает', 'не могу войти', '/login', 'login']
const norm = (s) => String(s ?? '').toLowerCase().replace(/@\w+/g, '').replace(/[^\p{L}\p{N}/ ]+/gu, ' ').replace(/\s+/g, ' ').trim()
/** Exact short phrase only — "как войти в кабинет?" in normal talk must not trigger. */
export const isLoginWord = (text) => LOGIN_WORDS.includes(norm(text))

/** True when the companion's session is waiting for a login (state/auth written by the supervisor). */
export function needsLogin(stateDir, authMode = 'subscription') {
  if (authMode === 'apikey') return false
  try { const a = readFileSync(join(stateDir, 'auth'), 'utf8').trim(); return a === 'pending' || a === 'expired' } catch { return false }
}

const STAMP = 'login-self.json'
function readStamps(stateDir) { try { return JSON.parse(readFileSync(join(stateDir, STAMP), 'utf8')) } catch { return {} } }
function writeStamps(stateDir, s) {
  try { mkdirSync(stateDir, { recursive: true }); const t = join(stateDir, STAMP + '.tmp'); writeFileSync(t, JSON.stringify(s)); renameSync(t, join(stateDir, STAMP)) } catch {}
}

const TEXT_FIRST = `🔴 Мила остановилась: закончился вход в Claude. Пока вы не войдёте, она не отвечает.

Что сделать (1 минута):
1. Нажмите «🔑 Войти в Claude» ниже
2. Войдите аккаунтом, на котором ваша подписка Claude
3. Скопируйте код со страницы и вставьте в то же окно

Дальше Мила продолжит сама. Пароль и код видите только вы.`
const TEXT_RELOGIN = `🔑 Свежая кнопка входа — нажмите, войдите аккаунтом с подпиской Claude, скопируйте код и вставьте в то же окно. Пароль и код видите только вы.`

export const groupHint = (botUsername) => `Откройте @${botUsername} и нажмите «Старт» — пришлю кнопку входа туда.`

/**
 * @param o { api, slug, botUsername, stateDir, authMode, chatType, chatId, senderId, isOwner, text, now?, cooldownMs?, reloginGapMs? }
 * @returns { action: 'none'|'button'|'group-hint'|'group-note', swallow: boolean }
 *   swallow = the message was a login request fully served here (don't also hand it to the model).
 */
export async function loginSelf(o) {
  const now = o.now ?? Date.now()
  const none = { action: 'none', swallow: false }
  if (!o.isOwner) return none
  const word = isLoginWord(o.text)
  const dead = needsLogin(o.stateDir, o.authMode)
  if (!word && !dead) return none
  const priv = o.chatType === 'private'
  const st = readStamps(o.stateDir)
  const cooldown = o.cooldownMs ?? 10 * 60_000
  const gap = o.reloginGapMs ?? 20_000
  if (word) { if (now - (st.lastBtn ?? 0) < gap) return { action: 'none', swallow: true } }
  else if (now - (st.lastBtn ?? 0) < cooldown) return none
  if (!priv && !word && now - (st.lastGroup ?? 0) < cooldown) return none
  const url = `https://login.milagpt.io/connect/?slug=${encodeURIComponent(o.slug)}`
  const markup = { inline_keyboard: [[{ text: '🔑 Войти в Claude — 1 минута', web_app: { url } }]] }
  const note = (s) => console.error(`login-self: ${s}`)
  try {
    await o.api.sendMessage(o.senderId, dead ? TEXT_FIRST : TEXT_RELOGIN, { reply_markup: markup })
    st.lastBtn = now; writeStamps(o.stateDir, st)
    note(`button sent to owner ${o.senderId} (${priv ? 'dm' : 'from group'}, ${word ? 'word' : 'auto'})`)
    if (!priv && word) { try { await o.api.sendMessage(o.chatId, 'Кнопку входа отправила вам в личку.') } catch {} }
    return { action: 'button', swallow: word }
  } catch (e) {
    note(`dm button failed: ${String((e && e.description) || (e && e.message) || e).slice(0, 120)}`)
    if (!priv && (word || now - (st.lastGroup ?? 0) >= cooldown)) {
      try { await o.api.sendMessage(o.chatId, groupHint(o.botUsername)); st.lastGroup = now; writeStamps(o.stateDir, st) } catch {}
      return { action: 'group-hint', swallow: word }
    }
    return none
  }
}
