# Changelog

All notable changes to this project will be documented in this file.

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
