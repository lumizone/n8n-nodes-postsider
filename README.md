# n8n-nodes-postsider

An n8n community node for building review-first social media publishing workflows with [PostSider](https://postsider.com).

The package talks directly to the PostSider public REST API. It does not start the PostSider MCP server and has no runtime dependencies.

## Features

- Store the PostSider organization API key in n8n credentials.
- Load connected channels and channel groups dynamically.
- Create drafts or schedule posts with channel-specific content and provider settings.
- Use stable idempotency keys so n8n retries do not create duplicate posts.
- Import public HTTPS media URLs into the PostSider media library.
- Find the next available queue slot for a channel.
- Request, list, approve and reject approvals; check a post against publishing policies; manage groups.
- Normalize PostSider media fields and optionally simplify large post responses.
- Use the node as an n8n AI tool.

Immediate publishing, post deletion, channel deletion, and the organization-wide publishing pause are intentionally not exposed in the first release.

## Installation

### Verified n8n installation

After n8n verification, an instance owner or administrator can search for `PostSider` in the node panel and install it from the community section.

### Manual community-node installation

Until verification is complete, install the package from **Settings > Community nodes** using:

```text
n8n-nodes-postsider
```

The package is published on npm as [`n8n-nodes-postsider`](https://www.npmjs.com/package/n8n-nodes-postsider). For local development, use `npm run dev`.

## Credentials

1. Open PostSider.
2. Go to **Settings > API**.
3. Create an organization API key with the scopes needed by your workflow.
4. In n8n, create a **PostSider API** credential.
5. Paste the key into **API Key**.
6. Keep **Base URL** as `https://api.postsider.com` for PostSider Cloud.

PostSider uses the raw key in the `Authorization` header. Do not add `Bearer`.

For self-hosted PostSider behind the bundled proxy, use the public origin including `/api`, for example:

```text
https://social.example.com/api
```

The node appends `/public/v1`. Remote HTTP URLs and URLs containing embedded credentials are rejected. Plain HTTP is accepted only for loopback development hosts.

## Operations

| Resource | Operation | Purpose |
| --- | --- | --- |
| Approval | Request | Ask the approvers to review a post |
| Approval | Get Status | Retrieve the human approval state for a post |
| Approval | Get Many | List approvals by status and date, newest first |
| Approval | Approve / Reject | Decide a pending approval (optional note) |
| Channel | Get Many | List connected and enabled channels, optionally by group |
| Group | Get Many | List channel groups |
| Group | Create / Rename / Archive | Manage groups (customer workspaces) |
| Media | Import From URL | Import a public HTTPS image or video URL |
| Policy | Check | Dry run: which publishing rules a post would hit (creates nothing) |
| Policy | Get Many Rules | List the publishing policy rules |
| Post | Create | Create a draft or schedule a post |
| Post | Get | Retrieve a post and all channel versions in its group |
| Post | Get Many | Retrieve posts in a required date range |
| Scheduling | Find Next Slot | Find the next free queue slot for a channel |

### Required API key scopes

| Operation | Scope |
| --- | --- |
| Approval Get Status, Get Many | `approvals:read` |
| Approval Request | `approvals:write` |
| Approval Approve, Reject | `approvals:decide` (never granted by default) |
| Policy Check | `posts:read` |
| Policy Get Many Rules | `policies:read` |
| Group Get Many | `channels:read` |
| Group Create, Rename, Archive | `channels:write` |
| Post Create | `posts:write` |

Approval, policy and group operations need a PostSider version that has the matching endpoints. On older servers they return the server's error and the other operations keep working. For a self-hosted PostSider, set **Base URL** to your public origin including `/api` (see Credentials).

## Create Post

`Post Type` defaults to `Draft`. Scheduling is explicit and requires `Publish Date`.

Add one **Channel Post** per target channel. Each entry contains:

- **Channel Name or ID**
- **Content**
- **First Comment** (optional)
- **Media JSON** (optional)
- **Settings JSON**

Use the output from **Media > Import From URL** as a media object:

```json
[
  {
    "id": "={{ $('Import Media').item.json.id }}",
    "path": "={{ $('Import Media').item.json.path }}"
  }
]
```

Provider settings vary by channel. Common examples:

```json
{ "who_can_reply_post": "everyone" }
```

```json
{ "post_type": "post" }
```

```json
{ "title": "Video title", "type": "public" }
```

PostSider validates the final provider settings before accepting a scheduled post.

### Idempotency

When **Idempotency Key** is empty, the node derives a stable value from the n8n execution ID and input-item index. Re-running the same item inside the same execution therefore reuses the same API operation instead of creating a duplicate.

For retries across separate n8n executions, provide your own business key, such as:

```text
campaign_2026_10_linkedin_01
```

Allowed characters are letters, numbers, `.`, `_`, `:`, and `-` up to 255 characters.

## Approval behavior

Request, Get Many and Get Status are safe reads and requests. **Approve** and **Reject** make the decision that lets a post publish.

> Do not wire Approve or Reject to unreviewed AI output or to an unauthenticated webhook. Use a dedicated API key with only `approvals:decide`, keep the example's signature check, and decide only from a source you trust. PostSider can block an API key from approving a post it requested itself.

The node reads the approval first and sends `expectStage` (the current stage position), so a stale run gets a 409 instead of deciding a later stage. Each decision sends an `Idempotency-Key` built from the execution ID, the node name, the item index and a digest of the approval, decision, note, stage position and request time, so an n8n retry does not decide twice, a later stage or re-requested approval never replays an older answer, and two Approve nodes never collide. If the read fails, a random per-call key is used and `expectStage` is omitted. **Get Many** with **Return All** follows `nextCursor` for up to 10 pages (1000 approvals).

## Example workflows

Import these files into n8n and replace placeholder channel IDs:

- `examples/import-media-and-create-draft.json`
- `examples/find-slot-and-schedule.json`
- `examples/approval-notify-slack.json`

The first two are safe by default: the first creates a draft, the second schedules only after the user configures and activates it. The third receives an `approval.requested` webhook, verifies its HMAC signature (placeholder secret from the `POSTSIDER_WEBHOOK_SECRET` environment variable) and filters the event; its Approve and Reject nodes are disabled until you enable one on purpose.

## Development

Requirements:

- Node.js 22.22 or newer for development (the built node supports n8n runtimes on Node.js 20.19 through 24)
- npm 11 or newer

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run dev
```

The test suite covers payload construction, URL security, request routing, UI metadata, item linking, retry-safe create behavior, approval status, and response normalization.

## Release verification

```bash
npm run verify
npm audit --omit=dev --omit=peer --audit-level=high
npm pack --dry-run
```

Releases are published only from GitHub Actions (`.github/workflows/publish.yml`, triggered by a version tag) through npm Trusted Publishing, so every version carries an npm provenance statement, which n8n requires for verified community nodes. No release is performed from a branch push.

## Security

- The API key is stored as an n8n password credential.
- Requests refuse redirects, preventing the authenticated request from being redirected to another origin.
- Credentials are not sent on cross-origin redirects.
- API requests time out after 30 seconds.
- Remote Base URLs must use HTTPS, except loopback development URLs.
- The package has no runtime dependencies and does not access environment variables or the filesystem.
- Immediate publishing and destructive operations are not part of the first release.

Report security issues privately to `lukasz@postsider.com`.

## License

MIT
