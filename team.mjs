// The team of a group: people the owner let into the main session there (by Telegram id). Everyone else in a group is a
// stranger (see the guests journal). The list changes only by the owner's press in a private chat — never from the group.
// Where it lives: team.json in the receiver's folder (Mila Agent: TELEGRAM_JOURNAL_DIR, which the session cannot write).
// Without that folder (a plain install, one OS user) access.json groups.<id>.team is read too, as before.
import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

const ID = /^-?[0-9]{1,20}$/

function file(journalDir) { return join(journalDir, 'team.json') }

export function readTeams(journalDir) {
  try {
    const d = JSON.parse(readFileSync(file(journalDir), 'utf8'))
    return { teams: d && typeof d.teams === 'object' && d.teams ? d.teams : {}, asked: d && typeof d.asked === 'object' && d.asked ? d.asked : {} }
  } catch { return { teams: {}, asked: {} } }
}

function save(journalDir, d, mode) {
  const p = file(journalDir), tmp = p + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(d, null, 1), { mode })
  renameSync(tmp, p); chmodSync(p, mode)
}

/** ids on the team of this chat */
export function teamOf(dir, access, chatId, trustAccess) {
  const own = readTeams(dir).teams[String(chatId)]
  const old = trustAccess ? access?.groups?.[String(chatId)]?.team : null
  return [...new Set([...(Array.isArray(own) ? own : []), ...(Array.isArray(old) ? old : [])].map(String))].filter(x => ID.test(x))
}

/** add / remove one id in team.json; returns the new list. */
export function setTeam(journalDir, chatId, userId, on, mode = 0o640) {
  chatId = String(chatId); userId = String(userId)
  if (!ID.test(chatId) || !ID.test(userId)) throw new Error('bad id')
  const d = readTeams(journalDir)
  const cur = new Set((d.teams[chatId] || []).map(String))
  on ? cur.add(userId) : cur.delete(userId)
  d.teams[chatId] = [...cur]
  save(journalDir, d, mode)
  return d.teams[chatId]
}

/** true once per (chat, person): whether to ask the owner «add to the team?» now. Remembers the ask. */
export function askOnce(journalDir, chatId, userId, mode = 0o640) {
  const d = readTeams(journalDir), k = String(chatId) + ':' + String(userId)
  if (d.asked[k]) return false
  // a flood of strangers does not become a flood of cards: at most 5 asks per chat an hour, 5000 remembered in all
  const hour = Date.now() - 3600_000
  if (Object.entries(d.asked).filter(([key, at]) => key.startsWith(String(chatId) + ':') && at > hour).length >= 5) return false
  if (Object.keys(d.asked).length >= 5000) return false
  d.asked[k] = Date.now()
  save(journalDir, d, mode)
  return true
}
