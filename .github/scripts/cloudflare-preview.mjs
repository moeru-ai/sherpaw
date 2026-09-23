const marker = '<!-- sherpaw-cloudflare-preview -->'

/** Triggering workflow: preview completion or approval; bind artifact metadata to the live PR. */
export async function validatePreview({ github, context, metadata }) {
  const prNumber = Number(metadata.prNumber)
  const { headSha } = metadata
  if (!Number.isSafeInteger(prNumber) || prNumber < 1 || !/^[a-f0-9]{40}$/.test(headSha))
    throw new Error('Invalid preview metadata')

  const run = context.payload.workflow_run
  const repository = `${context.repo.owner}/${context.repo.repo}`
  if (run.event !== 'pull_request' || run.conclusion !== 'success'
    || run.repository.full_name !== repository
    || run.path !== '.github/workflows/deploy-cloudflare-workers-preview-prepare.yml'
    || run.head_sha !== headSha) {
    throw new Error('Preview metadata does not match the source workflow run')
  }

  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: prNumber })
  if (pr.state !== 'open' || pr.base.ref !== 'main' || pr.base.repo.full_name !== repository
    || pr.head.sha !== headSha || pr.head.repo?.full_name !== run.head_repository.full_name) {
    throw new Error('PR is closed, stale, or does not match the source workflow run')
  }
  return { prNumber, headSha }
}

/** Triggering workflow: prepare/deploy status; update one bot comment for each PR. */
export async function commentPreview({ github, context, prNumber, body }) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...context.repo,
    issue_number: prNumber,
    per_page: 100,
  })
  const comment = comments.find(item => item.user?.login === 'github-actions[bot]' && item.body?.includes(marker))
  const content = `${marker}\n${body}`
  if (comment)
    await github.rest.issues.updateComment({ ...context.repo, comment_id: comment.id, body: content })
  else
    await github.rest.issues.createComment({ ...context.repo, issue_number: prNumber, body: content })
}

export function previewAlias(versionUrl, prNumber) {
  const url = new URL(versionUrl)
  const match = url.hostname.match(/^[a-z0-9]+-(moeru-ai-sherpaw\.[a-z0-9-]+\.workers\.dev)$/)
  if (url.protocol !== 'https:' || !match || !Number.isSafeInteger(prNumber) || prNumber < 1)
    throw new Error('Unexpected Workers preview URL')
  return `https://pr-${prNumber}-${match[1]}`
}
