// The archive: every message from a connected chat is kept per chat and month in a folder only the receiver reads — owners,
// the team and strangers (author by id), edits as their own lines; an unconnected chat leaves nothing. Keys are masked.
import { test, expect } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111, TEAM = 555 * 1000000 + 222, OTHER = 555 * 1000000 + 999, GROUP = -(100 * 1000000 + 5), FAR = -(100 * 1000000 + 6)

test('archive: per chat and month, 0700/0600, author by id, edits, nothing from an unconnected chat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-')), sock = join(dir, 'api.sock'), io = join(dir, 'io')
  const msg = (id: number, chat: any, uid: number, text: string) => ({ update_id: id, message: { message_id: id, date: 1, chat, from: { id: uid, is_bot: false, first_name: 'X' }, text } })
  const G = { id: GROUP, type: 'supergroup', title: 'G' }
  const updates = [
    msg(1, { id: OWNER, type: 'private' }, OWNER, 'owner note sk-' + 'ant-' + 'api03-' + 'A'.repeat(30)),
    msg(2, G, TEAM, 'team task'), msg(3, G, OTHER, 'stranger hello'),
    msg(4, { id: FAR, type: 'supergroup', title: 'F' }, OTHER, 'unconnected chat'),
    { update_id: 5, edited_message: { message_id: 1, date: 1, edit_date: 2, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false, first_name: 'O' }, text: 'owner note, edited' } },
  ]
  let served = false
  const srv = Bun.serve({ unix: sock, async fetch(req) {
    const method = new URL(req.url).pathname.split('/').pop()!
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true; return Response.json({ ok: true, result: updates })
    }
    return Response.json({ ok: true, result: true })
  } })
  mkdirSync(io); writeFileSync(join(io, 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  writeFileSync(join(io, 'team.json'), JSON.stringify({ teams: { [String(GROUP)]: [String(TEAM)] }, asked: {} }))
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {}, groups: { [String(GROUP)]: { requireMention: false, allowFrom: [] } } }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: 'http://keeper/telegram',
           TELEGRAM_API_UNIX: sock, TELEGRAM_JOURNAL_DIR: io, TELEGRAM_SHARED_GROUP: '1' }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  const A = join(io, 'archive'), month = new Date().toISOString().slice(0, 7)
  const read = (c: number) => { const f = join(A, String(c), month + '.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [] }
  for (let i = 0; i < 80; i++) { await Bun.sleep(100); if (read(OWNER).length >= 2 && read(GROUP).length >= 2) break }
  await Bun.sleep(300); p.kill(); await p.exited; srv.stop(true)
  expect(statSync(A).mode & 0o777).toBe(0o700)                                       // the session's group cannot list it
  expect(statSync(join(A, String(OWNER), month + '.jsonl')).mode & 0o777).toBe(0o600)
  const own = read(OWNER), grp = read(GROUP)
  expect(own[0].from).toBe('owner'); expect(own[0].text).not.toContain('A'.repeat(30))   // a key in the text is masked
  expect(own[1]).toMatchObject({ edit: true, msg: 1, text: 'owner note, edited' })        // an edit is its own line
  expect(grp.map((r: any) => [r.from, r.text])).toEqual([['team', 'team task'], ['other', 'stranger hello']])
  expect(existsSync(join(A, String(FAR)))).toBe(false)                                    // an unconnected chat: nothing
  rmSync(dir, { recursive: true, force: true })
}, 30000)
