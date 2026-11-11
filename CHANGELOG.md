# Changelog

All notable changes to this project will be documented in this file.

## 0.3.0 - 2026-11-11

### Added

- Node version 2, the default for new nodes.
- Post > Publish: When = Now (default), Schedule, Next Free Slot or Draft, with a multi-select of channels and one text for all channels.
- Per-channel text, first comment, tags and shortened links as options.
- Media from the input item's binary data (default property `data`), from public URLs, or from already uploaded files.
- Platform settings with safe defaults (X reply setting, YouTube visibility and title, TikTok privacy and required toggles, Instagram post type, Pinterest board, LinkedIn carousel) and a Settings JSON option, either one object or keyed by channel ID.
- Wait for Result: polls every 5 seconds up to the timeout (maximum 300 seconds) and returns PUBLISHED with `releaseURL`, ERROR with `error`, or `timedOut`.
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
