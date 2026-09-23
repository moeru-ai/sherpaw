# Deploy the sandbox to Cloudflare Workers

The deployment serves the sandbox home page, `/asr`, and `/speaker-identification` as a static SPA. It uses the production, preview preparation, and preview deployment workflow structure from [AIRI](https://github.com/moeru-ai/airi/tree/main/.github/workflows).

## Configure once

1. Create GitHub environments named **Production** and **Preview**. Add a required reviewer to **Preview** to approve deployments from PRs, including forks.
2. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in each environment. The token needs **Account / Workers Scripts / Edit** for the target account. See [Cloudflare's CI setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
   Also configure AIRI's storage secrets: `S3_ENDPOINT` (the bucket URL), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, and `WARP_DRIVE_PUBLIC_BASE` (the public bucket/CDN URL). The bucket must permit browser GET requests from the sandbox origin through CORS.
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

Workers static assets have a [25 MiB per-file limit](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). The speaker models are about 28 MB and 71 MB. As in AIRI, [unplugin-basemove](https://www.npmjs.com/package/unplugin-basemove) uploads the built `.data` assets to S3-compatible storage, rewrites their URLs, and removes the uploaded files from the local build output. The page keeps its normal local asset references; there is no custom model loader or import-rewriting plugin.

CI first prepares the pinned Hugging Face model submodules using Git LFS. Basemove uses `sherpaw/sandbox/main/` for production and `sherpaw/sandbox/pr-<number>/` for each preview. `clean: false` preserves assets referenced by older deployments, and Vite's hashed filenames distinguish model versions.

Without S3 credentials, builds retain local model assets. Configure storage for Cloudflare deployments so the model files do not exceed its limit. WASM and the rest of the app remain static Worker assets. Inference and recordings stay in the browser; ASR continues to accept user-supplied model files.

## Build and check locally

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm -F @sherpaw/speaker-identification run test:prepare
pnpm --filter '@sherpaw/sandbox^...' run build
pnpm -F @sherpaw/sandbox run build
pnpm dlx wrangler@4 deploy --dry-run --config packages/sandbox/wrangler.toml
pnpm dlx wrangler@4 dev --local --config packages/sandbox/wrangler.toml
```

The output is `packages/sandbox/dist`. Export the storage variables before building to exercise uploads and URL rewriting; use a separate `SANDBOX_WARP_DRIVE_PREFIX` for local checks. The build uploads model assets when storage is configured, even if the subsequent Wrangler command is a dry run. Wrangler's dry run only skips publishing the Worker. Open the URL printed by Wrangler to check routes, microphone recording, and model downloads locally.
