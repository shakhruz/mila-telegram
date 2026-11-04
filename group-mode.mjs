// Who may call Mila in a group the owner connects. The owner picks on the card; «Only me» is the first, green button:
// then only the owner(s) can call her, by mention, and other people's words never reach the session. «Only me» is a flag
// (ownerOnly), checked against the current owners at every message — a co-owner added later counts at once.
// Plain JS, imported by receiver.ts and server.ts.

/** The group's access entry for a mode the owner pressed; prev — the entry before (a repeat join changes the mode). */
export function groupPolicy(mode, prev) {
  return {
    requireMention: mode === 'mention' || mode === 'owner',
    allowFrom: (prev && prev.allowFrom) || [],   // an allowFrom set by hand stays
    ...(mode === 'owner' ? { ownerOnly: true } : {}),
    ...(mode === 'read' ? { readOnly: true } : {}),
    ...(mode === 'observe' ? { observe: true } : {}),
  }
}

/** The mode shown in CHATS.md for an access entry. */
export function modeOf(g) {
  if (g.readOnly) return 'read'
  if (g.observe) return 'observe'
  if (g.ownerOnly) return 'owner'
  return g.requireMention ? 'mention' : 'all'
}

/** May this sender reach the session from this group (before the mention check)? */
export function groupSenderAllowed(g, senderId, owners) {
  if (g.ownerOnly && !owners.map(String).includes(String(senderId))) return false
  const af = g.allowFrom || []
  return af.length === 0 || af.map(String).includes(String(senderId))
}
