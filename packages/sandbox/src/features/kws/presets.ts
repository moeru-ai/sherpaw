import type { KeywordEntry } from '@sherpaw/kws'

export interface KeywordPreset {
  id: 'english' | 'chinese'
  name: string
  note: string
  maxActivePaths: number
  entries: KeywordEntry[]
}

// Encoded for the bundled phone+partial-pinyin model, not a text converter.
// HEY/HELLO follow its en.phone lexicon. The recorded 伊噜 pronunciation matches
// the model's L better than its English R; keep this mapping editable.
export const keywordPresets: KeywordPreset[] = [
  {
    id: 'english',
    maxActivePaths: 16,
    name: 'Iru · English',
    note: 'Iru 按「伊噜」发音，使用贴近「噜」的发音编码；可编辑 token 调整。',
    entries: [
      {
        label: 'Hey Iru',
        matches: [
          { tokens: ['HH', 'EY1', 'IY1', 'L', 'UW0'] },
          { tokens: ['h', 'ēi', 'y', 'ī', 'l', 'ù'] },
        ],
        score: 1.5,
        threshold: 0.1,
      },
      {
        label: 'Hello Iru',
        matches: [
          { tokens: ['HH', 'AH0', 'L', 'OW1', 'IY1', 'L', 'UW0'] },
          { tokens: ['HH', 'AH0', 'L', 'OW1', 'y', 'ī', 'l', 'ù'] },
        ],
        score: 1.5,
        threshold: 0.1,
      },
      {
        label: 'Iru Iru',
        matches: [
          { tokens: ['IY1', 'L', 'UW0', 'IY1', 'L', 'UW0'] },
          { tokens: ['y', 'ī', 'l', 'ù', 'y', 'ī', 'l', 'ù'] },
        ],
        score: 1.5,
        threshold: 0.1,
      },
    ],
  },
  {
    id: 'chinese',
    maxActivePaths: 32,
    name: '肥鱼 · 中文',
    note: '保留普通话拼音，并兼容录音中「肥」被模型编码为一声的情况。',
    entries: [
      {
        label: '你好肥鱼',
        matches: [
          { tokens: ['n', 'ǐ', 'h', 'ǎo', 'f', 'éi', 'y', 'ú'] },
          { tokens: ['n', 'ǐ', 'h', 'ǎo', 'f', 'ēi', 'y', 'ú'] },
        ],
        threshold: 0.1,
      },
      {
        label: '大肥鱼',
        matches: [
          { tokens: ['d', 'à', 'f', 'éi', 'y', 'ú'] },
          { tokens: ['d', 'à', 'f', 'ēi', 'y', 'ú'] },
        ],
        threshold: 0.1,
      },
      {
        label: '肥鱼肥鱼',
        matches: [
          { tokens: ['f', 'éi', 'y', 'ú', 'f', 'éi', 'y', 'ú'] },
          { tokens: ['f', 'ēi', 'y', 'ú', 'f', 'ēi', 'y', 'ú'] },
        ],
        score: 1.5,
        threshold: 0.1,
      },
    ],
  },
]
