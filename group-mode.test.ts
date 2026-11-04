import { expect, test } from 'bun:test'
import { groupPolicy, modeOf } from './group-mode.mjs'

const OWNERS = ['111', '222']

test('«Only me»: mention required, only the owners may call', () => {
  const g = groupPolicy('owner', undefined, OWNERS)
  expect(g).toEqual({ requireMention: true, allowFrom: ['111', '222'] })
  expect(modeOf(g, OWNERS)).toBe('owner')
})

test('anyone by mention / reply to everyone: nobody filtered', () => {
  expect(groupPolicy('mention', undefined, OWNERS)).toEqual({ requireMention: true, allowFrom: [] })
  expect(groupPolicy('all', undefined, OWNERS)).toEqual({ requireMention: false, allowFrom: [] })
  expect(modeOf(groupPolicy('mention', undefined, OWNERS), OWNERS)).toBe('mention')
})

test('switching away from «Only me» opens the group again', () => {
  const was = groupPolicy('owner', undefined, OWNERS)
  expect(groupPolicy('mention', was, OWNERS).allowFrom).toEqual([])
  expect(groupPolicy('all', was, OWNERS).allowFrom).toEqual([])
})

test('an allowFrom set by hand stays when the mode changes', () => {
  expect(groupPolicy('all', { requireMention: true, allowFrom: ['555'] }, OWNERS).allowFrom).toEqual(['555'])
})

test('observer and listen-only keep their flags', () => {
  expect(groupPolicy('observe', undefined, OWNERS)).toMatchObject({ observe: true, requireMention: false })
  expect(groupPolicy('read', undefined, OWNERS)).toMatchObject({ readOnly: true })
  expect(modeOf({ requireMention: false, allowFrom: [], observe: true }, OWNERS)).toBe('observe')
})
