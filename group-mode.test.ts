import { expect, test } from 'bun:test'
import { groupPolicy, groupSenderAllowed, modeOf } from './group-mode.mjs'

const OWNERS = ['111', '222']

test('«Only me»: mention required, only the owners get through', () => {
  const g = groupPolicy('owner', undefined)
  expect(g).toEqual({ requireMention: true, allowFrom: [], ownerOnly: true })
  expect(modeOf(g)).toBe('owner')
  expect(groupSenderAllowed(g, '111', OWNERS)).toBe(true)
  expect(groupSenderAllowed(g, '999', OWNERS)).toBe(false)
})

test('a co-owner added later is let through at once (no stale list)', () => {
  const g = groupPolicy('owner', undefined)
  expect(groupSenderAllowed(g, '333', OWNERS)).toBe(false)
  expect(groupSenderAllowed(g, '333', [...OWNERS, '333'])).toBe(true)
})

test('anyone by mention / reply to everyone: nobody filtered', () => {
  expect(groupPolicy('mention', undefined)).toEqual({ requireMention: true, allowFrom: [] })
  expect(groupPolicy('all', undefined)).toEqual({ requireMention: false, allowFrom: [] })
  expect(groupSenderAllowed(groupPolicy('mention', undefined), '999', OWNERS)).toBe(true)
})

test('switching away from «Only me» opens the group again', () => {
  const g = groupPolicy('mention', groupPolicy('owner', undefined))
  expect(g.ownerOnly).toBeUndefined()
  expect(groupSenderAllowed(g, '999', OWNERS)).toBe(true)
})

test('an allowFrom set by hand stays and still filters', () => {
  const g = groupPolicy('all', { requireMention: true, allowFrom: ['555'] })
  expect(g.allowFrom).toEqual(['555'])
  expect(groupSenderAllowed(g, '999', OWNERS)).toBe(false)
})

test('observer and listen-only keep their flags', () => {
  expect(groupPolicy('observe', undefined)).toMatchObject({ observe: true, requireMention: false })
  expect(groupPolicy('read', undefined)).toMatchObject({ readOnly: true })
  expect(modeOf({ requireMention: false, allowFrom: [], observe: true })).toBe('observe')
})
