# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Email `lukasz@postsider.com` with:

- the affected version,
- reproduction steps,
- expected and observed behavior,
- the potential impact,
- any suggested remediation.

You should receive an acknowledgement within seven days.

## Supported versions

Until the first stable release, only the latest published version will receive security fixes.

## Security design

- API keys use n8n password credentials.
- Authenticated requests refuse redirects and do not forward credentials cross-origin.
- Remote PostSider Base URLs require HTTPS.
- The npm package has no runtime dependencies.
- The node does not read environment variables or the filesystem.
- Destructive operations and immediate publishing are excluded from the v1 surface.
