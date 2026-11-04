// Who may call Mila in a group the owner connects. The owner picks on the card; «Only me» is the first, green button:
// then only the owner(s) can call her, by mention, and other people's words never reach the session.
// Plain JS, imported by receiver.ts and server.ts.

export function sameIds(a, b) {
  return a.length === b.length && [...a].map(String).sort().join(',') === [...b].map(String).sort().join(',')
}

/** The group's access entry for a mode the owner pressed; prev — the entry before (a repeat join changes the mode). */
export function groupPolicy(mode, prev, owners) {
  const was = (prev && prev.allowFrom) || []
  return {
    requireMention: mode === 'mention' || mode === 'owner',
    // switching away from «only me» opens the group again; an allowFrom set by hand for another mode stays
    allowFrom: mode === 'owner' ? [...owners].map(String) : (was.length && sameIds(was, owners) ? [] : was),
    ...(mode === 'read' ? { readOnly: true } : {}),
    ...(mode === 'observe' ? { observe: true } : {}),
  }
}

/** The mode shown in CHATS.md for an access entry. */
export function modeOf(g, owners) {
  if (g.readOnly) return 'read'
  if (g.observe) return 'observe'
  if (!g.requireMention) return 'all'
  return g.allowFrom && g.allowFrom.length && sameIds(g.allowFrom, owners) ? 'owner' : 'mention'
}
