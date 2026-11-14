# Changelog

All notable changes to this project will be documented in this file.

## 0.3.2 - 2026-11-14

Made for the n8n verification review and to make every operation of the current node version work on PostSider Cloud (api.postsider.com).

### Node versions

PostSider node version **2.1** and PostSider Trigger version **1.1** are added and are the default for new nodes.

n8n drops a saved parameter when its field is not displayed for the node version. So a field is never moved or removed inside a published version. Saved nodes keep their version and are not changed:

- PostSider node **version 1** (0.2.x) and **version 2** (0.3.0 and 0.3.1), and PostSider Trigger **version 1**, show exactly the fields they showed before, with the same defaults, and run the same operations with the same requests and output. Version 2 still includes Approval Get Many, Approve and Reject, the Policy resource and Group Create, Rename and Archive (PostSider Cloud answers "This operation is not available on this PostSider server" for them), Post > Retry Failed with its Group ID (`/posts/group/:id/retry-failed`), Post > Delete and simplified posts with their 0.3.1 output, and dates without a time zone as UTC.
- Exceptions in version 2 and trigger 1: the channel tokens that a server may send with Retry Failed are never output, and `errorCode` is added to posts and trigger items next to `error`.

Changes in version **2.1** and trigger **1.1** only (new nodes):

- Only operations that PostSider Cloud offers. Not in 2.1: Approval Get Many, Approve and Reject; the Policy resource; Group Create, Rename and Archive. A saved node of version 2.1 that reaches one through an expression stops with "The operation '<resource> > <operation>' is not available in this node version". The `getGroups` list of channel groups is still used (Channel Get Many filter).
- Optional fields moved into collections: Channel > Get Many (Filters: Group Name or ID and Include Disabled), Media > Get Many (Return All, Limit and Filters > Search instead of Page), Publishing > Pause (Additional Fields > Reason), Post > Check (Options > Media Type with None replaces Has Media and Media Type), Channel > Get Options (Additional Fields > List Inputs; the key is called Field Name). PostSider Trigger 1.1: Trigger On (required) and Options > Channel Names or IDs.
- Channel > Get Many and Group > Get Many have Return All and Limit (default 50).
- Days of Post > Get Analytics and Channel > Get Analytics is required. An empty analytics answer is one item `{ "data": [] }`.
- Post > Retry Failed retries one post by its Post ID (`POST /posts/:id/retry`) and returns `postId` (the requested ID when the response has none), `state`, `publishDate`, `releaseURL`, `error` and `errorCode` (null when missing). Nothing else from the response is returned, because the server sends the channel with its access tokens. Only a post in the Error state can be retried; its channel must be connected and publishing must not be paused.
- Post > Delete returns `{ "postId": "...", "deleted": true }`. It deletes the post and its thread on its channel; posts on other channels from the same Publish are not deleted.
- Simplified posts (Post > Get, Post > Get Many, PostSider Trigger 1.1) are flat objects with at most ten fields: `id`, `content`, `publishDate`, `state`, `releaseURL`, `error`, `errorCode`, `integrationId`, `integrationName`, `provider`. Trigger items add `event`. Post > Get returns the main post (the first one); its follow-up posts are not included.
- Post > Get Many is sorted by publish date (then ID) and repeated rows (same ID and publish date) are dropped before the limit.
- A date without a time zone is read in the workflow time zone (UTC in version 1, version 2 and trigger 1). A date with `Z` or an offset is unchanged. The descriptions say so.
- The field that lists binary properties is called Input Data Field Names (Publish, Update, Media Upload), and the related errors use that name.
- Post > Check and Post > Rewrite say "Needs an AI key in PostSider and uses your AI quota." instead of HTTP codes. Post > Get says "Retrieve a post and its thread (follow-up posts)". Change Status says that it returns the post ID and its new state. The Next Free Slot option says that the slot of the first selected channel is used for all channels.
- The Post > Get Many state filter adds Awaiting Approval and Held.
- Operation labels have no articles (for example "Get post"), also in version 1 (wording only). Version 2 keeps its 0.3.1 labels.

### Fixed in every node version

- Requests that answer 429 are repeated for reads (GET) and for `POST /posts` with an Idempotency-Key (Post > Publish, version 1 Post > Create): the node waits for `Retry-After` (5 seconds when missing, at most 60 seconds each time) and sends the request again, up to three times. Other writes are not repeated. Wait for Result still handles 429 itself within its timeout.
- Idempotency: a 409 "already used with a different request" is shown as `UNKNOWN` / `alreadySubmitted` only when the same n8n process sent that derived key before. Otherwise the error explains that the key was already used for a different post and asks for a unique 'Idempotency Key'. A 409 "already processing" after an earlier attempt waits (5 seconds, up to three times) and sends the same body again; if the first attempt is still running the node returns `UNKNOWN` rows.
- Derived idempotency keys include the hashed instance ID and workflow ID next to the execution ID, node name, run and item. The node name part is now collision-free: a name with other characters than letters, numbers, `.`, `_` and `-`, or longer than 40 characters, is shortened and gets a hash of the full name (before, "Publish (EN)" and "Publish [EN]" gave the same key). Keys of nodes with a plain name are unchanged. The version 1 Post Create key also gains the node name and run number. The Idempotency Key fields say that PostSider remembers a key permanently for the organization. The README no longer claims that a reset n8n database cannot collide: set your own key for posts that must never be sent twice, and note that n8n's Retry execution creates a new execution ID and can post again.
- Dates must be ISO 8601 (a date, or a date and time with optional seconds, fraction and `Z`, `+HH`, `+HHMM` or `+HH:MM`) and must exist. Text such as `Sat Nov 14 2026 10:00:00 GMT+0100`, `2026-02-30`, hour 24 and month 13 stop the node with an error that names the field.
- Binary uploads: sizes are checked from the stored file (or the base64 text held in memory) before anything is uploaded, and each file is read right before its upload, so only one file is in memory at a time. Limits stay at 10 MB for images and 500 MB for videos; files with another MIME type are left to the server.
- A list of media URLs is split at new lines and at a comma followed by the next `http` URL, so a comma inside a URL (`w_800,h_600`) is kept. The error for an invalid URL names it (without credentials).
- Media URL imports (`/upload-from-url`) wait up to 120 seconds, like Post > Check, Post > Rewrite and Channel > Get Options. Other requests time out after 30 seconds.
- Error details: a post validation error `{ name, message }` is shown as `name: message`; a 423 `publishing_paused` answer gives the message "Publishing is paused in PostSider" and the reason PostSider sent (or "Resume publishing in the PostSider dashboard."). A null or empty status code is no longer read as status 0.
- Errors keep their type and carry the item index; with Continue On Fail a failed item has `error` and, when PostSider gave a reason, `description`.
- Wait for Result retries after HTTP 429 (and respects Retry-After) instead of failing every pending row.
- The credential removes an accidental leading `Bearer ` from the API key. Errors with a `{ "msg": "..." }` body show that message as the error description. A server that does not know a route (404 "Cannot GET ..." or "Cannot POST ...") gives "This operation is not available on this PostSider server".
- Public media URLs are checked before anything is uploaded or created for HTTPS and no credentials only (Publish first reads your channel list). A URL does not need a file extension. This also applies to version 1 Media > Import From URL.
- Posts keep `error` and `errorCode`; PostSider Trigger items include `errorCode` next to `error`. The correction to 0.3.0: PostSider returns `error` and `errorCode` only, so the trigger never had `errorCategory` or `errorRetryable` to pass on.
- Scope names are removed from descriptions and README: organization API keys have no scopes on PostSider Cloud. The credential documentation link points to docs.postsider.com/security/authentication. Codex files no longer declare `subcategories`.
- Example `examples/draft-and-request-approval.json` (Post > Publish as a draft, then Approval > Request) replaces `approval-notify-slack.json`, which used Approval > Get Many. All examples use node version 2.1 and trigger 1.1.

Tests now run saved 0.3.1 parameters through n8n's own display rules for each node version, so a parameter that a version would drop makes a test fail.

## 0.3.1 - 2026-11-11

### Fixed

- The node, trigger and credential icons now show the PostSider logo instead of a generic letter.

## 0.3.0 - 2026-11-11

Tagged in git but not published on npm; 0.3.1 is the first npm release with these changes.

### Added

- Node version 2, the default for new nodes.
- Post > Publish: When = Now (default), Schedule, Next Free Slot or Draft, with a multi-select of channels and one text for all channels.
- Per-channel text, first comment, tags and shortened links as options.
- Media from the input item's binary data (default property `data`), from public URLs, or from already uploaded files.
- Platform settings with safe defaults (X reply setting, YouTube visibility and title, TikTok privacy and required toggles, Instagram post type, Pinterest board, LinkedIn carousel) and a Settings JSON option, either one object or keyed by channel ID.
- Wait for Result: polls every 5 seconds up to the timeout (maximum 300 seconds) and returns PUBLISHED with `releaseURL`, ERROR with `error`, or `timedOut`.
- Post > Publish option Thread Parts: extra texts posted after the main text as a thread or follow-up comments, each with an optional delay in minutes (0 to 1440).
- Post > Change Status: move a post between draft and queue.
- Channel > Get Options: list values from a channel's platform, such as Pinterest boards or Discord and Slack channels.
- Post operations: Update (keeps stored settings), Delete, Duplicate, Retry Failed, Check, Rewrite with AI, Get Analytics. Get Many now has next 7 days, last 7 days and custom ranges with state, channel and group filters.
- Media operations: Upload, Get Many, Delete.
- Channel operations: Get Rules, Find Next Slot, Get Analytics, Enable, Disable.
- Publishing operations: Get State and Pause. Resume is only available in the PostSider dashboard.
- PostSider Trigger node (polling): Post Published, Post Failed and Post Scheduled, with an optional channel filter.
- AI agent tool support for the PostSider node, with plain operation descriptions.
- Examples: `publish-now-with-image.json` and `notify-on-failed-post.json`.

### Changed

- The default idempotency key now includes the node name and run number, so loops and several PostSider nodes in one workflow do not collide.
- Package description and README rewritten around publishing. The old note that immediate publishing and deletion are not exposed is removed.

### Fixed before release

- Retry On Fail no longer ends in a permanent 409: the date and uploaded media of a derived idempotency key are reused, and an "already used with a different request" conflict becomes `UNKNOWN` rows with `alreadySubmitted: true`.
- Wait for Result detects 4xx poll errors in n8n API errors, and is skipped when the Next Free Slot is later than the timeout (`waitSkipped`).
- Post > Get Many has a Group filter.
- Publish with Public URLs and an empty list now fails clearly, and an unexpected create response is reported with its raw body.
- PostSider Trigger keeps `error`, `errorCategory` and `errorRetryable` on failed posts.
- README scope table and Get description corrected.

### Notes

- Version 1 of the node is unchanged. Existing workflows keep working with no edits.
- Approval, Policy and Group operations and Post > Retry Failed need PostSider server 2026-11 or newer. On older servers they return 404.

## 0.2.3 - 2026-11-08

No change to node operations. Fixes the findings of the n8n verification scanner (`@n8n/scan-community-package`) on 0.2.2.

### Fixed

- Node category is now "Marketing & Content" (the former "Marketing" is not a supported category).
- Node and credential ship a themed icon (`postsider.svg` and a new `postsider.dark.svg`).
- Validation errors are thrown as `NodeOperationError` instead of plain `Error`; messages are unchanged.

### Changed

- The credential test is now declarative (`GET /public/v1/is-connected` on the normalized base URL) instead of a programmatic test that used the deprecated `request` helper.
- Removed the npm `overrides` block from `package.json`.
- Upgraded the `@n8n/node-cli` dev tooling to 0.55.5.

## 0.2.2 - 2026-11-08

No functional changes. First version published from GitHub Actions with npm provenance (Trusted Publishing), which the n8n verified-node submission requires; 0.2.1 was published by hand without provenance.

### Changed

- Publish workflow uses npm Trusted Publishing (OIDC) only; the npm token is no longer used.
- README no longer says the package is unpublished.

## 0.2.1 - 2026-11-06

First release on npm. It carries everything listed for 0.2.0 below; 0.2.0 was tagged in git but never published because its publish run failed before reaching npm.

### Fixed

- Policy Get Many Rules returned no items against the real server because the list reader ignored the `policies` key.

### Added

- Approval resource: Request, Get Many (status, since, limit, Return All with cursor paging up to 10 pages), Approve and Reject (optional note, stage bound idempotency key and `expectStage`). Approve and Reject need an API key with the `approvals:decide` scope, which is never granted by default.
- Policy resource: Check (dry run of a post against the publishing rules, creates nothing) and Get Many Rules.
- Group operations: Create, Rename and Archive (customer workspaces).
- Example workflow `examples/approval-notify-slack.json`: webhook, HMAC signature verification, event filter, and disabled Approve/Reject nodes.
- Operations that need the new server endpoints return the server's error on older PostSider versions; existing operations are unchanged.

## 0.1.0 - Unreleased

### Added

- PostSider API-key credential with cloud and self-hosted Base URL support.
- Dynamic channel and group selectors.
- Draft and scheduled post creation with stable idempotency keys.
- Post detail and date-range listing with normalized media and simplified outputs.
- Remote media import, next-slot discovery, and approval status operations.
- Unit and workflow-level tests.
- GitHub Actions CI and provenance-ready trusted publishing workflow.
