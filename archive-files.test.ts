// Archive part B: originals are kept — the owner's photo and voice, a stranger's voice (no transcription) — under
// archive/<chat>/files/<sha[:2]>/<sha256>.<ext>, 0600; the line carries the sha; a file over 20 MB — metadata only.
import { test, expect } from 'bun:test'
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OWNER = 555 * 1000000 + 111, OTHER = 555 * 1000000 + 999, GROUP = -(100 * 1000000 + 3)

test('archive files: owner photo and voice, stranger voice without STT, over 20 MB — metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arcf-')), sock = join(dir, 'api.sock'), io = join(dir, 'io')
  const stt = join(dir, 'stt.sh'), sttLog = join(dir, 'stt.log')
  writeFileSync(stt, `#!/bin/sh\necho "$1" >> ${sttLog}\necho "owner says hi"\n`); chmodSync(stt, 0o700)
  const BYTES: Record<string, string> = { p1: 'PHOTO-BYTES', v2: 'OWNER-VOICE', v3: 'STRANGER-VOICE' }
  const G = { id: GROUP, type: 'supergroup', title: 'G' }, D = { id: OWNER, type: 'private' }
  const updates = [
    { update_id: 1, message: { message_id: 1, date: 1, chat: D, from: { id: OWNER, is_bot: false, first_name: 'O' }, photo: [{ file_id: 'p0', file_unique_id: 'u0', width: 1, height: 1 }, { file_id: 'p1', file_unique_id: 'u1', width: 9, height: 9, file_size: 11 }], caption: 'look' } },
    { update_id: 2, message: { message_id: 2, date: 1, chat: D, from: { id: OWNER, is_bot: false, first_name: 'O' }, voice: { file_id: 'v2', file_unique_id: 'w2', duration: 1, file_size: 11 } } },
    { update_id: 3, message: { message_id: 3, date: 1, chat: G, from: { id: OTHER, is_bot: false, first_name: 'S' }, voice: { file_id: 'v3', file_unique_id: 'w3', duration: 1, file_size: 14 } } },
    { update_id: 4, message: { message_id: 4, date: 1, chat: D, from: { id: OWNER, is_bot: false, first_name: 'O' }, document: { file_id: 'big', file_unique_id: 'b', file_size: 30 * 1024 * 1024, file_name: 'big.mov' } } },
  ]
  let served = false
  const srv = Bun.serve({ unix: sock, async fetch(req) {
    const path = new URL(req.url).pathname, method = path.split('/').pop()!
    if (path.includes('/file/')) return new Response(BYTES[method.split('.')[0]!] ?? 'X')
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 777, is_bot: true, first_name: 'M', username: 'm_bot' } })
    if (method === 'getUpdates') {
      if (served) { await Bun.sleep(300); return Response.json({ ok: true, result: [] }) }
      served = true; return Response.json({ ok: true, result: updates })
    }
    if (method === 'getFile') return Response.json({ ok: true, result: { file_id: body.file_id, file_unique_id: 'x', file_path: 'f/' + body.file_id + '.oga', file_size: 11 } })
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 1, chat: { id: body.chat_id, type: 'private' } } : true })
  } })
  mkdirSync(io); writeFileSync(join(io, 'owners.json'), JSON.stringify({ owners: [String(OWNER)] }))
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], pending: {}, groups: { [String(GROUP)]: { requireMention: false, allowFrom: [] } } }))
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('TELEGRAM_')) base[k] = v
  const p = Bun.spawn(['bun', join(import.meta.dir, 'receiver.ts')], {
    env: { ...base, RECEIVER_DAEMON: '1', TELEGRAM_STATE_DIR: dir, TELEGRAM_BOT_TOKEN: '1234' + '5678:' + 'x'.repeat(35), TELEGRAM_API_ROOT: 'http://keeper/telegram',
           TELEGRAM_API_UNIX: sock, TELEGRAM_JOURNAL_DIR: io, TELEGRAM_VOICE_TRANSCRIBE_CMD: stt }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  const A = join(io, 'archive'), month = new Date().toISOString().slice(0, 7)
  const read = (c: number) => { const f = join(A, String(c), month + '.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [] }
  for (let i = 0; i < 100; i++) { await Bun.sleep(100); if (read(OWNER).length >= 3 && read(GROUP).length >= 1) break }
  await Bun.sleep(300); p.kill(); await p.exited; srv.stop(true)
  const own = read(OWNER), grp = read(GROUP)
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  const photo = own.find((r: any) => r.kind === 'photo'), voice = own.find((r: any) => r.kind === 'voice')
  expect(photo.file_sha).toBe(sha('PHOTO-BYTES')); expect(photo.text).toBe('look')
  const pf = join(A, String(OWNER), 'files', photo.file_sha.slice(0, 2), `${photo.file_sha}.${photo.file_ext}`)
  expect(readFileSync(pf, 'utf8')).toBe('PHOTO-BYTES'); expect(statSync(pf).mode & 0o777).toBe(0o600)
  expect(voice.file_sha).toBe(sha('OWNER-VOICE')); expect(voice.text).toContain('owner says hi')        // the owner's voice: original + transcript
  expect(grp[0]).toMatchObject({ from: 'other', kind: 'voice', file_sha: sha('STRANGER-VOICE') })        // the stranger's original is kept…
  expect(readFileSync(sttLog, 'utf8').trim().split('\n').length).toBe(1)                               // …but only the owner's went to STT
  expect(own.find((r: any) => r.kind === 'document')?.file).toBe('not downloaded: over 20 MB')
  rmSync(dir, { recursive: true, force: true })
}, 30000)
