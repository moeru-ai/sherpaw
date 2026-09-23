# Deploy the sandbox to Cloudflare Workers

The deployment serves the sandbox home page, `/asr`, and `/speaker-identification` as a static SPA. It uses the production, preview preparation, and preview deployment workflow structure from [AIRI](https://github.com/moeru-ai/airi/tree/main/.github/workflows).

## Configure once

1. Create GitHub environments named **Production** and **Preview**. Add a required reviewer to **Preview** to approve deployments from PRs, including forks.
2. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in each environment. The token needs **Account / Workers Scripts / Edit** for the target account. See [Cloudflare's CI setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
3. Enable a `workers.dev` subdomain in that Cloudflare account. The Worker is named `moeru-ai-sherpaw` in `packages/sandbox/wrangler.toml`. If you change its name, also update the preview alias helper and its test in `.github/scripts/`.
4. Merge these workflows to `main`, then run **Cloudflare Workers** on `main` once (or let the main push trigger it). This creates the production Worker before preview versions are uploaded. The `workflow_run` preview deployment workflow must exist on the default branch to run.

No account ID, custom domain, or API token is committed. Creating environments and setting secrets are repository administration steps; the workflows do not configure them automatically.

## Production and previews

- **Cloudflare Workers** builds on pushes to `main` or a manual run on `main`. A separate job deploys the artifact through **Production**.
- **Cloudflare Workers (Preview) Prepare** builds PRs targeting `main` without Cloudflare secrets or a write-capable token. It uploads the static site and PR metadata as artifacts retained for seven days. The build uses GitHub's PR merge checkout.
- **Cloudflare Workers (Preview) Deploy** runs after a successful preparation. It checks the source run, repository, PR state, and head commit, then posts a deployment status comment. Its deployment job waits for **Preview** environment approval when required reviewers are configured.
- After approval, the workflow checks the PR head again, uploads a Worker version with alias `pr-<number>`, and updates the same comment with a stable PR URL and the version URL. It does not promote the preview to production. Superseded or closed PRs are rejected; rerun preparation if artifacts expire.

The privileged preview workflow checks out only the default branch and runs its deployment configuration and scripts. It never installs dependencies or runs build commands from the PR. The PR artifact is treated as static data and checked for oversized files and symlinks before upload. Reviewers should still review the site content before approving a public preview.

## Models and static asset limits

Workers static assets have a [25 MiB per-file limit](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). The speaker models are about 28 MB and 71 MB, so the `cloudflare` Vite mode replaces their asset imports with Hugging Face URLs pinned to the model submodule revisions in the build commit. Neither model is uploaded to Workers; each downloads directly to the browser when selected. Inference and recordings remain local to the browser. The hosted speaker page requires network access to Hugging Face.

WASM and the rest of the app remain static Worker assets. Local development and the normal sandbox build still use the model submodules. The Cloudflare build requires a Git checkout but does not require Git LFS or initializing the model submodules. ASR continues to accept user-supplied model files.

## Build and check locally

From the repository root:

```sh
pnpm install --frozen-lockfile
node --test .github/scripts/cloudflare.test.mjs
pnpm --filter '@sherpaw/sandbox^...' build
pnpm -F @sherpaw/sandbox build:cloudflare
node .github/scripts/validate-cloudflare-assets.mjs packages/sandbox/dist-cloudflare
pnpm dlx wrangler@4.136.3 deploy --dry-run --config packages/sandbox/wrangler.toml
pnpm dlx wrangler@4.136.3 dev --local --config packages/sandbox/wrangler.toml
```

The output is `packages/sandbox/dist-cloudflare`. A dry run validates packaging without publishing to Cloudflare. Open the URL printed by Wrangler to check routes, microphone recording, and model downloads locally.
