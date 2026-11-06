// The archive of files has a ceiling (ARCHIVE_FILES_MB), strangers at most half: over it — metadata only and one line to the owner
// a day; the owner's private chat is not counted. Here 1 MB: strangers' half is 512 KB.
import { test, expect } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111, OTHER = 555 * 1000000 + 999, GROUP = -(100 * 1000000 + 2)

test('archive ceiling: strangers stop at half, one line to the owner, the owner\'s DM still kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arcc-')), sock = join(dir, 'api.sock'), io = join(dir, 'io')
  const SIZE: Record<string, number> = { d1: 400 * 1024, d2: 400 * 1024, d3: 400 * 1024, d4: 2 * 1024 * 1024 }
  const doc = (id: number, chat: any, uid: number, fid: string) => ({ update_id: id, message: { message_id: id, date: 1, chat, from: { id: uid, is_bot: false, first_name: 'X' },
    document: { file_id: fid, file_unique_id: 'u' + fid, file_size: SIZE[fid], file_name: fid + '.pdf' } } })
  const G = { id: GROUP, type: 'supergroup', title: 'G' }
  const updates = [doc(1, G, OTHER, 'd1'), doc(2, G, OTHER, 'd2'), doc(3, G, OTHER, 'd3'), doc(4, { id: OWNER, type: 'private' }, OWNER, 'd4')]
  const sent: any[] = []; let served = false
  const srv = Bun.serve({ unix: sock, async fetch(req) {
    const path = new URL(req.url).pathname, method = path.split('/').pop()!
    if (path.includes('/file/')) { const k = method.split('.')[0]!; return new Response(Buffer.alloc(SIZE[k] ?? 1, k.charCodeAt(1))) }
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    if (method === 'sendMessage') sent.push(body)
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true; return Response.json({ ok: true, result: updates })
    }
    if (method === 'getFile') return Response.json({ ok: true, result: { file_id: body.file_id, file_unique_id: 'x', file_path: 'f/' + body.file_id + '.pdf', file_size: SIZE[body.file_id] } })
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 1, chat: { id: body.chat_id, type: 'private' } } : true })
  } })
  mkdirSync(io); writeFileSync(join(io, 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  mkdirSync(join(io, 'archive', String(GROUP)), { recursive: true }); writeFileSync(join(io, 'archive', String(GROUP), '.announced'), '1')
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {}, groups: { [String(GROUP)]: { requireMention: false, allowFrom: [] } } }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: 'http://keeper/telegram',
           TELEGRAM_API_UNIX: sock, TELEGRAM_JOURNAL_DIR: io, ARCHIVE_FILES_MB: '1' }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  const A = join(io, 'archive'), month = new Date().toISOString().slice(0, 7)
  const read = (c: number) => { const f = join(A, String(c), month + '.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [] }
  for (let i = 0; i < 100; i++) { await Bun.sleep(100); if (read(GROUP).length >= 3 && read(OWNER).length >= 1) break }
  await Bun.sleep(400); p.kill(); await p.exited; srv.stop(true)
  const byFile = Object.fromEntries(read(GROUP).map((r: any) => [r.file_id, r]))
  // the files arrive together: one of the three strangers' files fits in their half (512 KB), the other two do not
  const kept = ['d1', 'd2', 'd3'].filter(f => byFile[f]?.file_sha), full = ['d1', 'd2', 'd3'].filter(f => byFile[f]?.file === 'not downloaded: the archive is full')
  expect(kept.length).toBe(1); expect(full.length).toBe(2)
  expect(read(OWNER)[0].file_sha).toBeTruthy()                                     // the owner's DM: kept, over the ceiling too
  expect(sent.filter(b => /archive of files is full/.test(b.text)).length).toBe(1)  // one line to the owner a day, not one per file
  rmSync(dir, { recursive: true, force: true })
}, 30000)
