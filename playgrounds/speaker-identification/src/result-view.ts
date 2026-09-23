import type { IdentificationResult } from './protocol'

function scoreBar(score: number, label: string) {
  const container = document.createElement('span')
  container.className = 'score-value'
  container.dataset.accepted = String(score >= 0.6)
  const track = document.createElement('span')
  track.className = 'score-track'
  const progress = document.createElement('progress')
  progress.max = 1
  progress.value = Math.max(0, Math.min(1, score))
  progress.setAttribute('aria-label', `${label}：${score.toFixed(4)}`)
  // Negative cosine scores remain visible numerically; only positive similarity fills the bar.
  const value = document.createElement('span')
  value.className = 'score-number'
  value.textContent = score.toFixed(4)
  track.append(progress)
  container.append(track, value)
  return container
}

export function renderResult(element: HTMLElement, result: IdentificationResult) {
  element.querySelector<HTMLElement>('.result')!.hidden = false
  element.querySelector('.match-name')!.textContent = result.match?.name ?? '未匹配'
  const best = result.scores[0]
  const highest = element.querySelector('.match-score')!
  if (best)
    highest.replaceChildren(scoreBar(best.score, `${best.name} 最高相似度`))
  else
    highest.textContent = '—'
  element.querySelector('.row-time')!.textContent = `${result.milliseconds.toFixed(0)} ms`
  const scores = element.querySelector('.scores')!
  for (const match of result.scores) {
    const chip = document.createElement('span')
    chip.className = 'score'
    const name = document.createElement('span')
    name.textContent = match.name
    chip.append(name, scoreBar(match.score, `${match.name} 相似度`))
    scores.append(chip)
  }
}
