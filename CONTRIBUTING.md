# Contributing

## Development setup

Use Node.js 22 or newer and npm 11 or newer.

```bash
npm install
npm run verify
```

For interactive testing in a local n8n instance:

```bash
npm run dev
```

## Pull requests

- Keep the public node UI and documentation in English.
- Add a failing test before changing behavior.
- Do not add runtime dependencies.
- Do not access environment variables or the filesystem from node or credential code.
- Preserve existing workflow parameter names unless the node version is bumped.
- Keep immediate publishing and destructive operations out of the v1 surface.
- Run `npm run verify`, `npm audit --omit=dev --omit=peer --audit-level=high`, and `npm pack --dry-run` before opening a pull request.

## API behavior

The package is a direct adapter for PostSider `/public/v1`. Keep payload defaults, idempotency, provider settings, and response normalization covered by tests when the API evolves.
