// Forum topics: a registry of the topics a group has — name, open/closed, last activity, who wrote last.
// <stateDir>/topics.json = { [chat_id]: { [thread_id]: { name, status, created, last, last_user } } }.
// The receiver fills it from incoming messages and Telegram's service events (topic created/renamed/closed/reopened);
// the `topic` tool, when Mila creates or closes one herself. Plain JS, imported by receiver.ts and server.ts.
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function topicsAll(stateDir) {
  try { return JSON.parse(readFileSync(join(stateDir, 'topics.json'), 'utf8')) } catch { return {} }
}

export function topicsUpdate(stateDir, chatId, threadId, patch, mode = 0o600) {
  try {
    const all = topicsAll(stateDir)
    const c = (all[String(chatId)] ??= {})
    c[String(threadId)] = { ...(c[String(threadId)] ?? {}), ...patch }
    // a link (Mila Agent: the session's folder links to the receiver's registry) is written through, not replaced
    let file = join(stateDir, 'topics.json')
    try { file = realpathSync(file) } catch {}
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode })
    renameSync(tmp, file)
  } catch (err) {
    process.stderr.write(`telegram channel: topics registry write failed: ${err}\n`)
  }
}

export function topicName(stateDir, chatId, threadId) {
  return topicsAll(stateDir)[String(chatId)]?.[String(threadId)]?.name
}

/** In a forum every topic message's reply_to_message is the service «topic created» — not a person's reply. */
export function isTopicRoot(m) {
  return !!(m && m.forum_topic_created)
}

/** thread_id (and the topic's name) for an inbound message, or {} for the General topic and plain chats. */
export function topicMeta(stateDir, chatId, msg, author, mode = 0o600) {
  const threadId = msg?.is_topic_message || (msg?.chat?.type === 'private' && msg?.message_thread_id) ? msg.message_thread_id : undefined
  if (threadId == null) return {}
  const rootName = msg?.reply_to_message?.forum_topic_created?.name
  const name = rootName ?? topicName(stateDir, chatId, threadId)
  topicsUpdate(stateDir, chatId, threadId, { ...(rootName ? { name: rootName } : {}), status: 'open', last: new Date().toISOString(), last_user: author }, mode)
  return { thread_id: String(threadId), ...(name ? { topic: String(name).slice(0, 128) } : {}) }
}
