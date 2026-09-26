import type { KeywordEntry } from '@sherpaw/kws'

export interface KeywordPreset {
  id: 'english' | 'chinese'
  name: string
  note: string
  entries: KeywordEntry[]
}

// Encoded for the bundled phone+partial-pinyin model, not a text converter.
// HEY/HELLO follow its en.phone lexicon. The recorded 伊噜 pronunciation matches
// the model's L better than its English R; keep this mapping editable.
export const keywordPresets: KeywordPreset[] = [
  {
    id: 'english',
    name: 'Iru · English',
    note: 'Iru 按「伊噜」发音，使用贴近「噜」的发音编码；可编辑 token 调整。',
    entries: [
      { label: 'Hey Iru', tokens: ['HH', 'EY1', 'IY1', 'L', 'UW0'], score: 1.5, threshold: 0.1 },
      // The bilingual model can encode the same accented phrase as pinyin.
      { label: 'Hey Iru', tokens: ['h', 'ēi', 'y', 'ī', 'l', 'ù'], score: 1.5, threshold: 0.1 },
      { label: 'Hello Iru', tokens: ['HH', 'AH0', 'L', 'OW1', 'IY1', 'L', 'UW0'], score: 1.5, threshold: 0.1 },
      { label: 'Iru Iru', tokens: ['IY1', 'L', 'UW0', 'IY1', 'L', 'UW0'], score: 1.5, threshold: 0.1 },
      { label: 'Iru Iru', tokens: ['y', 'ī', 'l', 'ù', 'y', 'ī', 'l', 'ù'], score: 1.5, threshold: 0.1 },
    ],
  },
  {
    id: 'chinese',
    name: '肥鱼 · 中文',
    note: '按普通话「nǐ hǎo féi yú / dà féi yú / féi yú féi yú」编码。',
    entries: [
      { label: '你好肥鱼', tokens: ['n', 'ǐ', 'h', 'ǎo', 'f', 'éi', 'y', 'ú'] },
      { label: '大肥鱼', tokens: ['d', 'à', 'f', 'éi', 'y', 'ú'] },
      { label: '肥鱼肥鱼', tokens: ['f', 'éi', 'y', 'ú', 'f', 'éi', 'y', 'ú'] },
    ],
  },
]
