# Versioning

[← Back to README](../README.md)

The footer shows the app version as `vMAJOR.MINOR.PATCH` (e.g. `v3.2.9`).

- Versions are generated automatically; nothing is edited by hand.
- `scripts/hooks/pre-commit` writes `assets/script/version.js` before each commit and stages it, so every release carries its own version.
- `app.js` fills `#footer-version` from `APP_VERSION`. No runtime call, no build step.

## Setup (once per clone)

```sh
git config core.hooksPath scripts/hooks
```
