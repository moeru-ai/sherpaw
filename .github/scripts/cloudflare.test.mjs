import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Deployment checks run with Node alone, without installing application dependencies.
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'

import { commentPreview, previewAlias, validatePreview } from './cloudflare-preview.mjs'
import { validateAssets } from './validate-cloudflare-assets.mjs'

function preview() {
  const headSha = 'a'.repeat(40)
  const metadata = { prNumber: '12', headSha }
  const context = {
    repo: { owner: 'moeru-ai', repo: 'sherpaw' },
    payload: {
      workflow_run: {
        event: 'pull_request',
        conclusion: 'success',
        repository: { full_name: 'moeru-ai/sherpaw' },
        head_repository: { full_name: 'contributor/sherpaw' },
        path: '.github/workflows/deploy-cloudflare-workers-preview-prepare.yml',
        head_sha: headSha,
      },
    },
  }
  const pr = {
    state: 'open',
    base: { ref: 'main', repo: { full_name: 'moeru-ai/sherpaw' } },
    head: { sha: headSha, repo: { full_name: 'contributor/sherpaw' } },
  }
  const github = { rest: { pulls: { get: async () => ({ data: pr }) } } }
  return { github, context, metadata, pr }
}

it('accepts a current fork PR, with metadata bound to the triggering run', async () => {
  const fixture = preview()
  assert.deepEqual(await validatePreview(fixture), { prNumber: 12, headSha: fixture.metadata.headSha })
})

it('rejects forged metadata, unrelated runs, and stale or closed PRs', async () => {
  const mutations = [
    f => f.metadata.prNumber = '12; echo unsafe',
    f => f.metadata.headSha = 'b'.repeat(40),
    f => f.context.payload.workflow_run.repository.full_name = 'other/sherpaw',
    f => f.context.payload.workflow_run.head_repository.full_name = 'other/sherpaw',
    f => f.context.payload.workflow_run.path = '.github/workflows/other.yml',
    f => f.context.payload.workflow_run.event = 'push',
    f => f.context.payload.workflow_run.conclusion = 'failure',
    f => f.pr.head.sha = 'b'.repeat(40),
    f => f.pr.state = 'closed',
    f => f.pr.base.ref = 'other',
  ]
  for (const mutate of mutations) {
    const fixture = preview()
    mutate(fixture)
    await assert.rejects(validatePreview(fixture))
  }
})

it('updates only the workflow bot comment', async () => {
  const calls = []
  const github = {
    paginate: async () => [
      { id: 1, user: { login: 'contributor' }, body: '<!-- sherpaw-cloudflare-preview -->' },
      { id: 2, user: { login: 'github-actions[bot]' }, body: '<!-- sherpaw-cloudflare-preview -->' },
    ],
    rest: { issues: { listComments() {}, updateComment: async args => calls.push(args) } },
  }
  await commentPreview({ github, context: preview().context, prNumber: 12, body: 'Ready' })
  assert.equal(calls[0].comment_id, 2)
  assert.match(calls[0].body, /Ready/)
})

it('derives the stable PR alias from a Workers version URL', () => {
  assert.equal(previewAlias('https://a1b2c3d4-moeru-ai-sherpaw.example.workers.dev', 12), 'https://pr-12-moeru-ai-sherpaw.example.workers.dev')
  assert.throws(() => previewAlias('https://example.com', 12))
  assert.throws(() => previewAlias('http://a1b2c3d4-moeru-ai-sherpaw.example.workers.dev', 12))
})

it('validates static assets and rejects missing entry points, large models, and symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sherpaw-assets-'))
  try {
    await assert.rejects(validateAssets(directory))
    await writeFile(join(directory, 'index.html'), '<html></html>')
    assert.equal(await validateAssets(directory), 1)
    const model = join(directory, 'model.data')
    await writeFile(model, '')
    await truncate(model, 25 * 1024 * 1024 + 1)
    await assert.rejects(validateAssets(directory), /25 MiB/)
    await rm(model)
    await symlink(join(directory, 'index.html'), join(directory, 'linked.html'))
    await assert.rejects(validateAssets(directory), /symlinks/)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
