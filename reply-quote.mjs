// QUOTE-3000-1006: цитата ответа (reply_quote) для тега канала.
// Боты не видят сообщений друг друга, цитата — единственное окно, поэтому лимит 3000, не 400.
export const REPLY_QUOTE_MAX = 3000
export function replyQuote(msg) {
  const m = msg ?? {}
  const raw = m.quote?.text ?? m.reply_to_message?.text ?? m.reply_to_message?.caption ?? ''
  return String(raw).slice(0, REPLY_QUOTE_MAX)
}
