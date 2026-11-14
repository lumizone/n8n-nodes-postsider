# Changelog

All notable changes to this project will be documented in this file.

## 0.3.2 - 2026-11-14

Changes made for the n8n verification review, and to make every operation of node version 2 work on PostSider Cloud (api.postsider.com).

### Removed

These operations are no longer in node version 2, because the production API has no routes for them (the node answered 404 "Cannot GET ..."). Version 1 nodes are unchanged and still list them, but PostSider Cloud does not offer them. A version 2 node that still reaches one through an expression stops with "The operation '<resource> > <operation>' is not available in this node version".

- Approval > Get Many, Approve and Reject (`/approvals`). Approval > Request and Get Status stay.
- The whole Policy resource: Check and Get Many Rules (`/policies`).
- Group > Create, Rename and Archive (`/customers`). Group > Get Many stays.
- The fields that only served them, the "Requires PostSider server 2026-11 or newer" notes, and the group list load method (no node version uses it any more).

### Changed

Moved or renamed fields. Saved version 2 workflows and PostSider Trigger nodes created with 0.3.0 or 0.3.1 must set these fields again.

- Post > Retry Failed (version 2): retries one post by its Post ID (`POST /posts/:id/retry`) instead of a whole group. The field Post Group ID (`postGroup`) is gone; the field is now Post ID (`postId`). Only a post in the Error state can be retried, its channel must be connected and publishing must not be paused. The output is exactly one item with `postId`, `state`, `publishDate`, `releaseURL`, `error` and `errorCode` (null when missing). The server answers with the whole post including the channel, and the channel carries its access tokens, so nothing else from that response is ever returned.
- Channel > Get Many (version 2): Group and Include Disabled moved into a Filters collection (`channelFilters`, fields `groupId` and `includeDisabled`).
- Media > Get Many (version 2): Page removed. Return All and Limit added; Search moved into a Filters collection (`mediaFilters`, field `search`). Pages are fetched until the limit is met, or all of them with Return All, at most 50 pages (900 files).
- Publishing > Pause (version 2): Reason moved into an Additional Fields collection (`pauseAdditionalFields`).
- Post > Check (version 2): Has Media and Media Type replaced by Options > Media Type (`checkOptions`, field `mediaType`: Image, Mixed, None, Video; default None).
- Channel > Get Options (version 2): the key of List Inputs is shown as Field Name (same parameter).
- PostSider Trigger: Events is now called Trigger On and is required. Channel Names or IDs moved into Options (`options`, field `channels`).
- Post > Delete (version 2) returns `{ "postId": "...", "deleted": true }` and says that it deletes the post on every channel it was created for.
- Post > Get Many (version 2) state filter adds Awaiting Approval and Held.
- Operation labels no longer contain articles (for example "Get post"), in both node versions.
- Dates: error messages name the field (for example 'Start Date'), and the offsets `Z`, `+HH:MM`, `+HHMM` and `+HH` are accepted. A date without a time zone is still read as UTC.
- Descriptions and error messages put the names of fields in single quotes. Post > Check and Post > Rewrite describe the 409 (no AI key) and 402 (AI quota used up) errors.
- Scope names (`posts:write`, `channels:write`, `approvals:decide`, `policies:read` and so on) are removed from the descriptions and the README: organization API keys have no scopes on PostSider Cloud and act with full access to the organization. The README explains this under Credentials.
- Codex files no longer declare `subcategories`.
- The credential documentation link points to docs.postsider.com/security/authentication.
- Version 1 nodes are unchanged, except for operation label and error message wording, the idempotency key of Post Create (below), Media > Import From URL (no extension check, below), the removed scope names, and error handling.
- The Idempotency Key fields (both node versions) now say that PostSider remembers a key permanently for the organization (keys never expire), that reusing it returns the first result, and that it fails if the request is different. The derived key comments no longer say 7 days.

### Added

- Public media URLs are checked before any request for HTTPS and no credentials only. PostSider detects the file type from the file itself, so a URL does not need a file extension (`.JPG`, `?w=800` and no extension at all are accepted). This also applies to version 1 Media > Import From URL.
- Binary uploads are checked before anything is sent: an image over 10 MB or a video over 500 MB (the limits of every PostSider upload route) stops the node with an error that names the file and the limit. All files are checked before the first one is uploaded.
- The credential removes an accidental leading `Bearer ` (and surrounding spaces) from the API key, because PostSider only accepts the bare key. The API Key field says to paste it without `Bearer`.
- Errors with a `{ "msg": "..." }` body, which is what most PostSider errors look like, now show that message as the error description. n8n's status message (for example "Bad request - please check your parameters") and the HTTP status stay. A 429 keeps its status and Retry-After, so Wait for Result still pauses and retries.
- Posts keep `error` and `errorCode` when simplified (Post > Get and Get Many), and PostSider Trigger items include `errorCode` next to `error`.
- Post > Check, Post > Rewrite and Channel > Get Options wait up to 120 seconds (other requests still 30 seconds).
- A server that does not know a route (404 "Cannot GET /public/v1/...") now gives "This operation is not available on this PostSider server" with the description "The PostSider server you are connected to does not offer this feature."
- Example `examples/draft-and-request-approval.json` (Post > Publish as a draft, then Approval > Request) replaces `approval-notify-slack.json`, which used Approval > Get Many.

### Fixed

- Derived idempotency keys include the instance ID and workflow ID (hashed) next to the execution ID, node name, run and item, so two n8n instances or a reset n8n database that use one PostSider organization no longer collide. The version 1 Post Create key also gains the node name and run number. Keys stay the same for a retry of the same item.
- Wait for Result retries after HTTP 429 (and respects Retry-After) instead of failing every pending row.
- Errors keep their type and carry the item index; plain errors in media upload and settings lookup are now node errors.

## 0.3.1 - 2026-11-11

### Fixed

- The node, trigger and credential icons now show the PostSider logo instead of a generic letter.

## 0.3.0 - 2026-11-11

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
