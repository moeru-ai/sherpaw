# Deploy the sandbox to Cloudflare Workers

The deployment serves the sandbox home page, `/asr`, and `/speaker-identification` as a static SPA. It uses the production, preview preparation, and preview deployment workflow structure from [AIRI](https://github.com/moeru-ai/airi/tree/main/.github/workflows).

## Configure once

1. Create GitHub environments named **Production** and **Preview**. Add a required reviewer to **Preview** to approve deployments from PRs, including forks.
2. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in each environment. The token needs **Account / Workers Scripts / Edit** for the target account. See [Cloudflare's CI setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
3. Enable a `workers.dev` subdomain in that Cloudflare account. The Worker is named `moeru-ai-sherpaw` in `packages/sandbox/wrangler.toml`.
4. Merge these workflows to `main`, then run **Cloudflare Workers** on `main` once (or let the main push trigger it). This creates the production Worker before preview versions are uploaded. The `workflow_run` preview deployment workflow must exist on the default branch to run.

No account ID, custom domain, or API token is committed. Creating environments and setting secrets are repository administration steps; the workflows do not configure them automatically.

## Production and previews

- **Cloudflare Workers** builds and deploys in one job through **Production**, on pushes to `main` or a manual run.
- **Cloudflare Workers (Preview) Prepare** only uploads the PR number, source repository, and head commit as a metadata artifact. It does not check out or build the app. Unlike AIRI's prepare workflow, it has no manual trigger because manual runs have no PR metadata.
- **Cloudflare Workers (Preview) Deploy** follows AIRI's `ask-for-approval` and `on-success` jobs, with a sandbox matrix entry. The first job posts the approval link; the second waits for **Preview** environment review.
- After approval, the deployment job checks out the recorded PR commit, installs dependencies, builds the sandbox, and uploads a Worker version with alias `pr-<number>`. It updates the PR comment with the version URL and stable PR URL. Build failures update the same comment. The preview does not replace production.

As in AIRI, approval authorizes running the recorded PR commit in the deployment job. Review that commit before approving the **Preview** environment. The build and deployment steps are written directly in the workflows, without repository-local composite actions or helper scripts.

## Models and static asset limits

Workers static assets have a [25 MiB per-file limit](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). The speaker models are about 28 MB and 71 MB, so the `cloudflare` Vite mode replaces their asset imports with Hugging Face URLs pinned to the model submodule revisions in the build commit. Neither model is uploaded to Workers; each downloads directly to the browser when selected. Inference and recordings remain local to the browser. The hosted speaker page requires network access to Hugging Face.

WASM and the rest of the app remain static Worker assets. Local development and the normal sandbox build still use the model submodules. The Cloudflare build requires a Git checkout but does not require Git LFS or initializing the model submodules. ASR continues to accept user-supplied model files.

## Build and check locally

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter '@sherpaw/sandbox^...' run build
pnpm -F @sherpaw/sandbox run build:cloudflare
pnpm dlx wrangler@4 deploy --dry-run --config packages/sandbox/wrangler.toml
pnpm dlx wrangler@4 dev --local --config packages/sandbox/wrangler.toml
```

The output is `packages/sandbox/dist-cloudflare`. A dry run validates packaging without publishing to Cloudflare. Open the URL printed by Wrangler to check routes, microphone recording, and model downloads locally.
