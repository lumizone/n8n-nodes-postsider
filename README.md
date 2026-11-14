# n8n-nodes-postsider

An n8n community node for publishing and automating social media posts with [PostSider](https://postsider.com).

The package talks directly to the PostSider public REST API. It does not start the PostSider MCP server and has no runtime dependencies.

## What's new

### 0.3.2

- Optional fields of node version 2 moved into collections (Filters, Additional Fields, Options). Saved version 2 workflows and PostSider Trigger nodes created with 0.3.0 or 0.3.1 must set these fields again. [CHANGELOG.md](CHANGELOG.md) lists every moved or renamed field.
- Node version 2 lists only the operations that PostSider Cloud offers. Approval Get Many, Approve and Reject, the Policy resource, and Group Create, Rename and Archive are not in version 2, because api.postsider.com has no routes for them. Version 1 nodes keep them (see Version 1 workflows).
- Post > Retry Failed now retries one post by its Post ID (`POST /posts/:id/retry`) and returns only `postId`, `state`, `publishDate`, `releaseURL`, `error` and `errorCode`.
- Post > Delete returns `{ "postId": "...", "deleted": true }` and removes every channel version that was created with the post.
- Idempotency keys that the node derives are scoped to the n8n instance and the workflow, so two instances that share one PostSider organization no longer collide.
- Clearer errors: field names in single quotes, accepted date formats, the PostSider `msg` of an API error shown as the error description, and "This operation is not available on this PostSider server" when the server you are connected to does not offer a feature.
- Public media URLs are checked before any request: HTTPS without credentials. A file extension is not needed.
- Binary uploads are checked before they are sent: images up to 10 MB, videos up to 500 MB.
- The credential removes an accidental `Bearer ` in front of the API key.
- Posts and PostSider Trigger items include `errorCode` next to `error`.
- Post > Check, Post > Rewrite and Channel > Get Options wait up to 120 seconds for the AI response; other requests still time out after 30 seconds.
- The post state filter of Post > Get Many adds Awaiting Approval and Held.

### 0.3.0

Node version 2 (the default for new nodes), Post > Publish with When, Wait for Result, media from binary data or URLs, platform settings, more operations, and the PostSider Trigger node. See [CHANGELOG.md](CHANGELOG.md). Workflows built with earlier versions keep node version 1, unchanged.

## Features

- Store the PostSider organization API key in n8n credentials.
- Load connected channels and channel groups dynamically.
- Publish now, schedule, use the next free queue slot, or save a draft.
- Use stable idempotency keys so n8n retries do not create duplicate posts.
- Upload media from binary data or public URLs as part of publishing.
- Request an approval for a post and read its approval status; list channel groups.
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
3. Create an organization API key.
4. In n8n, create a **PostSider API** credential.
5. Paste the key into **API Key**.
6. Keep **Base URL** as `https://api.postsider.com` for PostSider Cloud.

PostSider uses the raw key in the `Authorization` header. Paste the key without `Bearer`. If `Bearer ` is pasted by mistake, the credential removes it before the request is sent.

For self-hosted PostSider behind the bundled proxy, use the public origin including `/api`, for example:

```text
https://social.example.com/api
```

The node appends `/public/v1`. Remote HTTP URLs and URLs containing embedded credentials are rejected. Plain HTTP is accepted only for loopback development hosts.

See the [PostSider authentication guide](https://docs.postsider.com/security/authentication) for how API keys work.

### What the API key can do

An organization API key from **Settings > API** has full access to the organization, so you do not choose permissions when you create it. Enabling or disabling a channel needs an admin, and an organization API key counts as one. Use a key that only this workflow uses, so you can revoke it without affecting other tools.

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

Media notes:

- A public URL must use HTTPS and must not contain credentials. It does not need a file extension, because PostSider detects the file type from the file itself.
- Upload limits: images up to 10 MB and videos up to 500 MB. The node refuses a larger binary file before it sends anything, and names the file and the limit.
- A post with a lot of text or settings for many channels at once can be larger than the request size limit of the PostSider server (about 100 KB of JSON). If you get a "request entity too large" error, split the post into several Publish runs with fewer channels each.

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

- **Trigger On** (required): Post Published (default), Post Failed, Post Scheduled. Pick one or more.
- **Options > Channel Names or IDs**: optional filter. Leave it out for all channels.
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
| Channel | Get Many | List connected channels. Filters: Group and Include Disabled |
| Channel | Get Rules | Limits and required settings of a channel |
| Channel | Get Options | List options from a channel's platform, such as Pinterest boards or Discord and Slack channels, to use in platform settings or Settings JSON. Some lists take an input such as a search word, set under List Inputs |
| Channel | Find Next Slot | Find the next free queue slot for a channel |
| Channel | Get Analytics | Analytics of a channel over a number of days |
| Channel | Enable / Disable | Turn a channel on or off without disconnecting it |
| Group | Get Many | List channel groups |
| Media | Upload | Upload binary data or public URLs to the media library |
| Media | Get Many | List media. Return All or Limit, and Filters > Search |
| Media | Delete | Delete a media file |
| Post | Publish | Publish now, schedule, next free slot or draft, on one or more channels |
| Post | Get | Retrieve that post and its thread (the follow-up posts). Other channels of the same group are not included; use Get Many to see them |
| Post | Get Many | List posts for the next 7 days, the last 7 days or a custom range. Filters: Channel, Group and State (Any, Awaiting Approval, Draft, Error, Held, Published, Queue) |
| Post | Update | Change text, time, first comment, media or settings; stored settings are kept |
| Post | Change Status | Move a post between draft and queue: Schedule queues a draft for its saved date, Draft takes a queued post out of the queue |
| Post | Delete | Delete a post. This removes every channel version that was created with the post, and returns `deleted: true` |
| Post | Duplicate | Create a draft copy, optionally for another channel or date |
| Post | Retry Failed | Retry a post in the Error state on its channel (enter its Post ID) instead of creating a duplicate. The channel must be connected and publishing must not be paused. Returns `postId`, `state`, `publishDate`, `releaseURL`, `error` and `errorCode` |
| Post | Check | Validate text against channel rules without creating a post. Options > Media Type tells the check what media the post would have |
| Post | Rewrite | Rewrite text with AI. Options: Platform, Tone and Number of Versions |
| Post | Get Analytics | Analytics of a published post |
| Publishing | Get State | Whether publishing is paused |
| Publishing | Pause | Pause publishing for the whole organization. Additional Fields > Reason is optional. Resume only works in the PostSider dashboard |

Node version 2 lists only operations that PostSider Cloud offers, so every operation in this table works on api.postsider.com. A removed operation that is still reached through an expression stops with "The operation '<resource> > <operation>' is not available in this node version".

## Version 1 workflows

Workflows built with 0.2.x keep using node version 1: the same fields, the same behavior, including Post > Create and the Scheduling resource. Nothing needs to change. To use the new Publish operation, add a new PostSider node (it is version 2).

Version 1 nodes still list Approval Get Many, Approve and Reject, the Policy resource, and Group Create, Rename and Archive. PostSider Cloud does not offer them, so a version 1 node that runs one of them stops with "This operation is not available on this PostSider server". They only work against a PostSider server that has those routes.

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

Publish and Create send an `Idempotency-Key` header, so a retry of the same request does not post twice. When **Idempotency Key** is empty, the node builds one from a hash of the n8n instance ID and of the workflow ID, the execution ID, the node name, the run number and the input item index. That makes it:

- safe for retries: re-running the same item inside the same execution reuses the same API operation instead of creating a duplicate;
- safe for loops and several PostSider nodes in one workflow: each node, run and item gets its own key, so they never collide;
- safe across n8n instances and workflows that use one PostSider organization: the instance and the workflow are part of the key.

PostSider rejects a reused key when the request body differs. So with **Retry On Fail**, the node remembers the date it resolved (now or the free slot) and the media it uploaded for each derived key (in memory, up to 500 items, per n8n process) and sends the identical request again, without uploading twice. This only applies to the automatic key. If a retry still gets "already used with a different request" (for example n8n restarted between attempts), the node returns one row per channel with `state: UNKNOWN`, `alreadySubmitted: true` and the key, instead of an error. Check the post in PostSider before retrying. A key you set yourself is never remembered and always passes the server answer through.

For retries across separate n8n executions, provide your own business key, such as:

```text
campaign_2026_10_linkedin_01
```

Allowed characters are letters, numbers, `.`, `_`, `:`, and `-` up to 255 characters.

PostSider remembers a key permanently for your organization (keys never expire). Reusing a key returns the result of the first request, or fails if the new request is different. Only Post > Publish (and version 1 Post > Create) send an Idempotency-Key.

## Approval behavior

In node version 2, **Request** asks the approvers to review a post and **Get Status** reads the human approval state of a post. Both are safe: neither one decides anything. The decision is made in PostSider.

**Approve** and **Reject** exist only in node version 1, and PostSider Cloud does not offer them. Where a server does, version 1 reads the approval first and sends `expectStage` (the current stage position), so a stale run gets a 409 instead of deciding a later stage. Each decision sends an `Idempotency-Key` built from the execution ID, the node name, the item index and a digest of the approval, decision, note, stage position and request time. Do not wire Approve or Reject to unreviewed AI output or to an unauthenticated webhook.

## Example workflows

The `examples` folder is part of the npm package and is also in the GitHub repository. Import a file into n8n (**Import from File**), select your credentials, and replace the placeholder IDs. All examples use PostSider node version 2 (the trigger is version 1), are inactive when imported, and need no environment variables or Code nodes.

- `examples/publish-now-with-image.json`: downloads an image, then Post > Publish with When = Now, binary media and Wait for Result. It sends a real post when you run it, so set the channel first.
- `examples/notify-on-failed-post.json`: PostSider Trigger on failed posts, then a Set node you can replace with your own alert.
- `examples/find-slot-and-schedule.json`: Post > Publish with When = Next Free Slot. One node finds the slot and schedules the post.
- `examples/import-media-and-create-draft.json`: Post > Publish with Media = Public URLs and When = Draft. It imports the image (the URL must use HTTPS) and saves a draft that is not published.
- `examples/draft-and-request-approval.json`: Post > Publish with When = Draft, then Approval > Request for the post it returns (`postId`). It saves a draft that is not published and asks the approvers in PostSider to review it.

## Compatibility

- Tested with n8n 2.47.7.
- Requires an n8n version that supports community node API version 1 (`n8nNodesApiVersion: 1`).
- Node version 2 targets PostSider Cloud (api.postsider.com) and offers only operations that exist there. Node version 1 also lists operations that PostSider Cloud does not offer (Approval Get Many, Approve and Reject, Policy, Group Create, Rename and Archive); a server without the route answers "This operation is not available on this PostSider server".
- Node.js 20.19 through 24 (the runtimes n8n uses).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [PostSider API documentation](https://docs.postsider.com/api/overview)
- [PostSider authentication and API keys](https://docs.postsider.com/security/authentication)
- [CHANGELOG.md](CHANGELOG.md)
- Issues: [github.com/lumizone/n8n-nodes-postsider/issues](https://github.com/lumizone/n8n-nodes-postsider/issues)

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
- API requests time out after 30 seconds, except Post > Check, Post > Rewrite and Channel > Get Options, which wait up to 120 seconds.
- Remote Base URLs must use HTTPS, except loopback development URLs.
- The package has no runtime dependencies and does not access environment variables or the filesystem.
- Destructive operations (Post Delete, Media Delete, Publishing Pause) only run when you add and configure them in a workflow.

Report security issues privately to `lukasz@postsider.com`.

## License

MIT
