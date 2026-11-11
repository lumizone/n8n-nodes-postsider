# n8n-nodes-postsider

An n8n community node for publishing and automating social media posts with [PostSider](https://postsider.com).

The package talks directly to the PostSider public REST API. It does not start the PostSider MCP server and has no runtime dependencies.

## What's new in 0.3.0

- **Node version 2** is the default for new nodes. Workflows that already use the node keep version 1, unchanged.
- **Post > Publish** puts a post out in four fields: Channels, Text, Media and When. When is **Now** by default.
- Pick several channels at once and send one text to all of them, with optional per-channel text.
- Media comes straight from the input item's binary data, from public URLs, or from files you already uploaded. No separate upload step.
- Platform settings have safe defaults, so a plain post works on X, YouTube, TikTok and Instagram without any JSON.
- **Wait for Result** returns the final status and the post link.
- New operations: Post Update, Delete, Duplicate, Retry Failed, Check Content, Rewrite with AI and Get Analytics; Media Upload, Get Many and Delete; Channel Get Rules, Find Next Slot, Get Analytics, Enable and Disable; Publishing Get State and Pause.
- New **PostSider Trigger** node (polling) for published, failed and scheduled posts.
- The node can be used as a tool by AI agents.

## Features

- Store the PostSider organization API key in n8n credentials.
- Load connected channels and channel groups dynamically.
- Publish now, schedule, use the next free queue slot, or save a draft.
- Use stable idempotency keys so n8n retries do not create duplicate posts.
- Upload media from binary data or public URLs as part of publishing.
- Request, list, approve and reject approvals; check a post against publishing policies; manage groups (need a newer PostSider server, see the operations table).
- Normalize PostSider media fields and optionally simplify large post responses.

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

## Quick start

### Publish a post now

1. Add a **PostSider** node. Resource **Post**, operation **Publish** are the defaults.
2. Choose one or more **Channels**.
3. Type the **Text**.
4. Leave **When** on **Now**.

That is all. Run the node and the post is sent. Turn on **Options > Wait for Result** to get the final status and the post link in the output.

### Publish with an image from a previous node

Set **Media** to **Binary Data**. **Input Binary Field** is `data` by default, which is where the HTTP Request node, Google Drive and most image nodes put their file. Several property names can be listed, separated by commas. The node uploads each file and attaches it to every selected channel. See `examples/publish-now-with-image.json`.

Other media modes: **Public URLs** (one HTTPS URL per line or comma-separated) and **Already Uploaded** (the `[{id, path}]` objects returned by Media > Upload).

### When

| Value | What happens |
| --- | --- |
| Now (default) | Publishes immediately |
| Schedule | Publishes at the **Date** you choose (UTC) |
| Next Free Slot | Looks up the next free queue slot of the first selected channel and schedules the post there |
| Draft | Saves the post without publishing |

### Options

- **First Comment**: posted right after the post, where the platform supports it.
- **Per-Channel Text**: a different text for a specific channel. Other channels use **Text**.
- **Thread Parts**: extra texts that post after the main text, in order. They become a thread on X, Threads, Bluesky and Mastodon, and follow-up comments on platforms that support them. Each part has its own text and an optional **Delay (Minutes)** from 0 to 1440. Media goes on the first post only, and **Per-Channel Text** replaces only the first text; the parts are sent to every selected channel.
- **Platform Settings**: X reply setting and community, YouTube visibility, made for kids and title, TikTok privacy, comments, duet, stitch and auto music, Instagram and Facebook post type, Pinterest board and link, LinkedIn image carousel, and a title for article platforms. A setting is applied only to channels of that platform.
- **Settings JSON**: raw provider settings, merged last. Give one object for every channel, or an object keyed by channel ID.
- **Tags** and **Shorten Links**.
- **Idempotency Key**: see below.
- **Wait for Result** and **Wait Timeout (Seconds)**.

Discord and Slack need a `channel` ID: set it in **Settings JSON**, for example `{"channel": "123456789"}`.

Safe defaults are filled in for you: X replies from everyone, YouTube public with the title taken from the first 100 characters of the text (set **Title** for a better one), TikTok public and direct post with comments on and duet, stitch and the brand toggles off, Instagram as a normal post.

### Wait for Result

With **Now** or **Next Free Slot**, the node polls PostSider every 5 seconds until each post is published or has failed, or until **Wait Timeout (Seconds)** passes (default 60, maximum 300). The output row then has:

- `state: PUBLISHED` and `releaseURL` (the link to the live post), or
- `state: ERROR` and `error`, or
- `timedOut: true` with the last known state. A timeout is not an error, or
- `waitSkipped: 'slot is later than the wait timeout'` with **Next Free Slot** when the slot is further away than the timeout, so the node does not wait for nothing.

### Output

Publish returns one item per channel: `postId`, `group`, `channelId`, `channelName`, `state`, `publishDate`, `releaseURL`, `error`, `approvalRequested` and `policy`.

## PostSider Trigger

The **PostSider Trigger** node starts a workflow when posts change state. It polls the PostSider API, so it needs no webhook setup and works on PostSider Cloud.

- **Events**: Post Published (default), Post Failed, Post Scheduled. Pick one or more.
- **Channels**: optional filter. Leave empty for all channels.
- It looks at posts from 7 days back to 30 days ahead.
- The first time you activate the workflow, it emits nothing. It only remembers what it sees.
- A new event is a post that reached a selected state and was not in that state in the previous poll. If a post leaves a state and comes back, it is reported again.
- In manual test mode it returns the newest matching post so you can map fields.

See `examples/notify-on-failed-post.json`.

## AI agents

The PostSider node can be used as a tool by n8n AI agents. Operations have plain descriptions written for the model, for example "Publish a post" and "Check a post before publishing".

## Operations (version 2)

| Resource | Operation | Purpose |
| --- | --- | --- |
| Approval | Request | Ask the approvers to review a post |
| Approval | Get Status | Retrieve the human approval state for a post |
| Approval | Get Many | List approvals by status and date, newest first |
| Approval | Approve / Reject | Decide a pending approval (optional note) |
| Channel | Get Many | List connected channels, optionally by group or including disabled ones |
| Channel | Get Rules | Limits and required settings of a channel |
| Channel | Get Options | List options from a channel's platform, such as Pinterest boards or Discord and Slack channels, to use in platform settings or Settings JSON. Some lists take an input such as a search word |
| Channel | Find Next Slot | Find the next free queue slot for a channel |
| Channel | Get Analytics | Analytics of a channel over a number of days |
| Channel | Enable / Disable | Turn a channel on or off without disconnecting it |
| Group | Get Many | List channel groups |
| Group | Create / Rename / Archive | Manage groups (customer workspaces) |
| Media | Upload | Upload binary data or public URLs to the media library |
| Media | Get Many | List media, with search and paging |
| Media | Delete | Delete a media file |
| Policy | Check | Dry run: which publishing rules a post would hit (creates nothing) |
| Policy | Get Many Rules | List the publishing policy rules |
| Post | Publish | Publish now, schedule, next free slot or draft, on one or more channels |
| Post | Get | Retrieve that post and its thread (the follow-up posts). Other channels of the same group are not included; use Get Many to see them |
| Post | Get Many | List posts for the next 7 days, the last 7 days or a custom range; filter by state, channel and group |
| Post | Update | Change text, time, first comment, media or settings; stored settings are kept |
| Post | Change Status | Move a post between draft and queue: Schedule queues a draft for its saved date, Draft takes a queued post out of the queue |
| Post | Delete | Delete a post. This deletes the whole group (all channel versions) |
| Post | Duplicate | Create a draft copy, optionally for another channel or date |
| Post | Retry Failed | Republish a failed post instead of creating a duplicate |
| Post | Check | Validate text against channel rules without creating a post |
| Post | Rewrite | Rewrite text with AI for a platform and tone |
| Post | Get Analytics | Analytics of a published post |
| Publishing | Get State | Whether publishing is paused |
| Publishing | Pause | Pause publishing for the whole organization. Resume only works in the PostSider dashboard |

Approval, Policy and Group operations and Post > Retry Failed need PostSider server 2026-11 or newer. On older servers they return a 404 error and the other operations keep working.

## Version 1 workflows

Workflows built with 0.2.x keep using node version 1: the same fields, the same behavior, including Post > Create and the Scheduling resource. Nothing needs to change. To use the new Publish operation, add a new PostSider node (it is version 2).

### Required API key scopes

Create the key with the scopes your workflow needs. Typical ones:

| Operation | Scopes |
| --- | --- |
| Post Publish | `posts:write` and `channels:read`; plus `media:write` for binary or URL media, and `posts:read` for Next Free Slot and Wait for Result |
| Post Update | `posts:write`; plus `posts:read` when you change platform settings, and `media:write` for new media |
| Post Delete, Duplicate, Retry Failed, Change Status | `posts:write` |
| Post Check, Rewrite | `posts:write` |
| Post Get, Get Many; PostSider Trigger | `posts:read` |
| Post Get Analytics | `analytics:read` |
| Media Upload, Delete | `media:write` |
| Media Get Many | `posts:read` |
| Approval Get Status, Get Many | `approvals:read` |
| Approval Request | `approvals:write` |
| Approval Approve, Reject | `approvals:decide` (never granted by default) and `approvals:read` |
| Policy Check | `posts:read` |
| Policy Get Many Rules | `policies:read` |
| Channel Get Many, Get Rules; Group Get Many | `channels:read` |
| Channel Find Next Slot | `posts:read` |
| Channel Get Analytics | `analytics:read` |
| Channel Get Options | `channels:write` (the server asks for it, although the operation only reads) |
| Channel Enable, Disable; Group Create, Rename, Archive | `channels:write` |
| Publishing Get State | `publishing:read` |
| Publishing Pause | `publishing:write` |

If an operation returns a permission error, check the scope list of the key in PostSider **Settings > API**. For a self-hosted PostSider, set **Base URL** to your public origin including `/api` (see Credentials).

## Create Post (version 1)

This section describes the version 1 operation. New workflows should use Post > Publish.

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

Publish and Create send an `Idempotency-Key` header, so a retry of the same request does not post twice. When **Idempotency Key** is empty, the node builds one from the n8n execution ID, the node name, the run number and the input item index. That makes it:

- safe for retries: re-running the same item inside the same execution reuses the same API operation instead of creating a duplicate;
- safe for loops and several PostSider nodes in one workflow: each node, run and item gets its own key, so they never collide.

PostSider rejects a reused key when the request body differs. So with **Retry On Fail**, the node remembers the date it resolved (now or the free slot) and the media it uploaded for each derived key (in memory, up to 500 items, per n8n process) and sends the identical request again, without uploading twice. This only applies to the automatic key. If a retry still gets "already used with a different request" (for example n8n restarted between attempts), the node returns one row per channel with `state: UNKNOWN`, `alreadySubmitted: true` and the key, instead of an error. Check the post in PostSider before retrying. A key you set yourself is never remembered and always passes the server answer through.

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

- `examples/publish-now-with-image.json`: download an image, then Publish Now with binary media and Wait for Result (version 2)
- `examples/notify-on-failed-post.json`: PostSider Trigger on failed posts, then a Set node you can replace with your own alert (version 2)
- `examples/import-media-and-create-draft.json` (version 1)
- `examples/find-slot-and-schedule.json` (version 1)
- `examples/approval-notify-slack.json`

The two version 2 examples are inactive when imported. The publish example sends a real post when you run it, so set the channel first. The draft example creates a draft, the schedule example schedules only after you configure and activate it. The approval example receives an `approval.requested` webhook, verifies its HMAC signature (placeholder secret from the `POSTSIDER_WEBHOOK_SECRET` environment variable) and filters the event; its Approve and Reject nodes are disabled until you enable one on purpose.

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

The test suite covers payload construction, URL security, request routing, UI metadata, item linking, retry-safe publish and create behavior, media upload, platform settings, the trigger, approval status, and response normalization.

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
- Destructive operations (Post Delete, Media Delete, Publishing Pause) only run when you add and configure them in a workflow.

Report security issues privately to `lukasz@postsider.com`.

## License

MIT
