# @postsider/n8n-nodes-postsider

An n8n community node for building review-first social media publishing workflows with [PostSider](https://postsider.com).

The package talks directly to the PostSider public REST API. It does not start the PostSider MCP server and has no runtime dependencies.

## Features

- Store the PostSider organization API key in n8n credentials.
- Load connected channels and channel groups dynamically.
- Create drafts or schedule posts with channel-specific content and provider settings.
- Use stable idempotency keys so n8n retries do not create duplicate posts.
- Import public HTTPS media URLs into the PostSider media library.
- Find the next available queue slot for a channel.
- Read the current human approval status for a post.
- Normalize PostSider media fields and optionally simplify large post responses.
- Use the node as an n8n AI tool.

Immediate publishing, post deletion, channel deletion, and the organization-wide publishing pause are intentionally not exposed in the first release.

## Installation

### Verified n8n installation

After n8n verification, an instance owner or administrator can search for `PostSider` in the node panel and install it from the community section.

### Manual community-node installation

Until verification is complete, install the package from **Settings > Community nodes** using:

```text
@postsider/n8n-nodes-postsider
```

The package has not been published yet. For local development, use `npm run dev`.

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
| Approval | Get Status | Retrieve the human approval state for a post |
| Channel | Get Many | List connected and enabled channels, optionally by group |
| Group | Get Many | List channel groups |
| Media | Import From URL | Import a public HTTPS image or video URL |
| Post | Create | Create a draft or schedule a post |
| Post | Get | Retrieve a post and all channel versions in its group |
| Post | Get Many | Retrieve posts in a required date range |
| Scheduling | Find Next Slot | Find the next free queue slot for a channel |

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

The node exposes approval status as a read-only operation. Requesting, approving, and rejecting remain human actions in PostSider until the request endpoint offers atomic retry protection.

## Example workflows

Import these files into n8n and replace placeholder channel IDs:

- `examples/import-media-and-create-draft.json`
- `examples/find-slot-and-schedule.json`

Both examples are safe by default. The first creates a draft. The second schedules only after the user configures and activates it.

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

The n8n registry scanner accepts published npm package names, so its final check runs after the first prerelease is published with npm provenance. The repository is prepared for GitHub Actions trusted publishing, but no release is performed automatically from a branch push.

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
