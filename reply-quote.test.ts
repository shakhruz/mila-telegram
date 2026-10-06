// QUOTE-3000-1006 tests: bun test reply-quote.test.ts
import { test, expect } from 'bun:test'
import { replyQuote, REPLY_QUOTE_MAX } from './reply-quote.mjs'

const long = Array.from({ length: 60 }, (_, i) => `Строка ${i}: «цитата» "кавычки" <b>тег</b> & 'апостроф'`).join('\n').slice(0, 2500)

test('2500 знаков с переводами строк, кавычками и < > проходят целиком', () => {
  expect(long.length).toBe(2500)
  const q = replyQuote({ reply_to_message: { text: long } })
  expect(q).toBe(long)
  expect(q).toContain('\n')
})

test('значение переживает JSON-сериализацию meta (транспорт уведомления)', () => {
  const q = replyQuote({ reply_to_message: { text: long } })
  const back = JSON.parse(JSON.stringify({ meta: { reply_quote: q } }))
  expect(back.meta.reply_quote).toBe(long)
})

test('предел 3000; quote.text приоритетнее; caption — запасной; пусто — пустая строка', () => {
  expect(REPLY_QUOTE_MAX).toBe(3000)
  expect(replyQuote({ reply_to_message: { text: 'x'.repeat(5000) } }).length).toBe(3000)
  expect(replyQuote({ quote: { text: 'sel' }, reply_to_message: { text: 'all' } })).toBe('sel')
  expect(replyQuote({ reply_to_message: { caption: 'cap' } })).toBe('cap')
  expect(replyQuote({})).toBe('')
})
