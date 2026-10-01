import { expect, it } from 'vitest'

import { isPunctuationToken, joinTokens } from './tokens'

it('joins tokens as sherpa-onnx builds its text', () => {
  expect(joinTokens([' 这', ' 是', ' 测', ' 试', ' ，'])).toBe('这是测试，')
  expect(joinTokens([' sea', 'r', 'ch', ' work', 's', ' .'])).toBe('search works.')
  expect(joinTokens([' 测', ' 试', ' hello', ' world', ' 。'])).toBe('测试 hello world。')
  expect(joinTokens([])).toBe('')
  // A character outside the vocabulary of a model with BPE byte fallback: 你 is E4 BD A0 in UTF-8.
  expect(joinTokens([' 我', '<0xE4>', '<0xBD>', '<0xA0>', ' 好'])).toBe('我你好')
})

it('finds tokens that hold only punctuation', () => {
  expect([' ，', '。', ' ?', ' ...', '？！'].every(isPunctuationToken)).toBe(true)
  expect([' 这', ' hel', 'lo', ' ', '', ' 3'].some(isPunctuationToken)).toBe(false)
})
