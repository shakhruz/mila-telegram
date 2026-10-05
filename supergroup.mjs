// SUPERGROUP-1004: a Telegram group upgraded to a supergroup gets a new chat_id.
// Everything that keyed on the old id (access.json, chat card, CHATS.md) has to
// follow, and sends to the old id (400 "group chat was upgraded to a supergroup",
// parameters.migrate_to_chat_id) must be retried on the new one.
//
// Plain JS, no dependencies: imported by receiver.ts, server.ts and the sender
// daemon alike. Every write to access.json goes through mutateAccess():
// lock -> read the file fresh -> mutate -> atomic rename. No process keeps a
// snapshot, so two processes cannot overwrite each other's change.
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch {} }

/** Run fn on a freshly read, raw access.json object; write it back if fn returns !== false. */
export function mutateAccess(stateDir, fn) {
  const file = join(stateDir, 'access.json')
  const lock = file + '.lock'
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const t0 = Date.now()
  for (;;) {
    try { mkdirSync(lock); break } catch (e) {
      if (e && e.code !== 'EEXIST') throw e
      try { if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { recursive: true, force: true }) } catch {}
      if (Date.now() - t0 > 5_000) { rmSync(lock, { recursive: true, force: true }); continue }
      sleepSync(20)
    }
  }
  try {
    let raw = {}
    try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { if (e && e.code !== 'ENOENT') throw e }
    if (!raw.groups || typeof raw.groups !== 'object') raw.groups = {}
    const res = fn(raw)
    if (res === false) return false
    const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`
    writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
    return true
  } finally {
    try { rmSync(lock, { recursive: true, force: true }) } catch {}
  }
}

const migFile = (stateDir) => join(stateDir, 'chat-migrations.json')

function readMigrations(stateDir) {
  try { return JSON.parse(readFileSync(migFile(stateDir), 'utf8')) } catch { return {} }
}

/** Follow old -> new links (max 5 hops). Returns the input unchanged if not migrated. */
export function resolveChatId(stateDir, id) {
  if (id === undefined || id === null) return id
  const m = readMigrations(stateDir)
  let cur = String(id)
  for (let i = 0; i < 5 && m[cur]; i++) cur = String(m[cur])
  return cur === String(id) ? id : (typeof id === 'number' ? Number(cur) : cur)
}

/**
 * Move everything keyed on oldId to newId. Idempotent.
 * Returns { access, card, index, recorded }.
 */
export function migrateChat(stateDir, oldId, newId, via = 'update') {
  oldId = String(oldId); newId = String(newId)
  const out = { access: false, card: false, index: false, recorded: false }
  if (!oldId || !newId || oldId === newId) return out

  // 1. access.json: same mode on the new id, old id removed
  out.access = mutateAccess(stateDir, (raw) => {
    if (!raw.groups[oldId]) return false
    if (!raw.groups[newId]) raw.groups[newId] = raw.groups[oldId]
    delete raw.groups[oldId]
    return true
  })

  // 2. old -> new map (lets senders redirect at once)
  const m = readMigrations(stateDir)
  if (m[oldId] !== newId) {
    m[oldId] = newId
    const tmp = migFile(stateDir) + `.tmp.${process.pid}`
    writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, migFile(stateDir))
    out.recorded = true
  }

  // 3. chat card chats/<id>.md
  const chats = join(stateDir, 'chats')
  const oldCard = join(chats, `${oldId}.md`), newCard = join(chats, `${newId}.md`)
  try {
    if (existsSync(oldCard)) {
      if (!existsSync(newCard)) {
        const txt = readFileSync(oldCard, 'utf8').split(oldId).join(newId)
        writeFileSync(newCard, txt, { mode: 0o600 })
        rmSync(oldCard)
      } else {
        renameSync(oldCard, `${oldCard}.migrated-${Date.now()}`)
      }
      out.card = true
    }
  } catch {}

  // 4. CHATS.md index line
  try {
    const idx = join(stateDir, 'CHATS.md')
    const txt = readFileSync(idx, 'utf8')
    if (txt.includes(oldId)) {
      const lines = txt.split('\n')
      const hasNew = lines.some((l) => l.includes(`\`${newId}\``))
      const next = lines.filter((l) => !(hasNew && l.includes(`\`${oldId}\``))).join('\n').split(oldId).join(newId)
      writeFileSync(idx, next, { mode: 0o600 })
      out.index = true
    }
  } catch {}

  if (out.access || out.card || out.index || out.recorded) {
    try {
      appendFileSync(join(stateDir, 'auth-log.jsonl'), JSON.stringify({
        ts: new Date().toISOString(), chat_id: newId, old_chat_id: oldId,
        action: 'migrate', via, access: out.access, card: out.card, index: out.index,
      }) + '\n', { mode: 0o600 })
    } catch {}
  }
  return out
}

/** migrate_to_chat_id from a grammy GrammyError, a Bot API JSON response, or a thrown {parameters}. */
export function migrateTargetFromError(err) {
  const p = err?.parameters ?? err?.error?.parameters ?? err?.response?.parameters
  const to = p?.migrate_to_chat_id
  return to === undefined || to === null ? null : String(to)
}

/** grammy API transformer: redirect migrated ids up front, migrate + retry once on 400. */
export function supergroupTransformer(stateDir, via = 'send') {
  return async (prev, method, payload, signal) => {
    const orig = payload?.chat_id
    if (orig !== undefined && payload) {
      const r = resolveChatId(stateDir, orig)
      if (String(r) !== String(orig)) payload = { ...payload, chat_id: r }
    }
    const res = await prev(method, payload, signal)
    const to = !res?.ok ? migrateTargetFromError(res) : null
    if (to && payload?.chat_id !== undefined) {
      migrateChat(stateDir, payload.chat_id, to, via)
      return prev(method, { ...payload, chat_id: typeof payload.chat_id === 'number' ? Number(to) : to }, signal)
    }
    return res
  }
}
