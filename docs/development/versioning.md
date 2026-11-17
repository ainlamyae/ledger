# Versioning

[Docs](../README.md) › Development

How the footer version and the changelog are generated from commit messages.

## At a glance

- **Format:** `vMAJOR.MINOR.PATCH` in the footer, e.g. `v3.41.2`.
- **Source:** computed from commit messages; nothing is edited by hand.
- **Hook:** `scripts/hooks/post-commit` stamps `version.js` and rewrites [Changelog](../changelog.md) into each commit.
- **Setup:** once per clone, `git config core.hooksPath scripts/hooks`.

## Bump rules

Start each commit message with a [Conventional Commits](https://www.conventionalcommits.org/) type.

| Commit message | Bump | Example |
|---|---|---|
| `type!:` (e.g. `feat!:`, `fix!:`) or a `BREAKING CHANGE:` footer | Major; minor and patch reset | 3.6.2 → 4.0.0 |
| `feat:` or `feat(scope):` | Minor; patch resets | 3.6.2 → 3.7.0 |
| Anything else (`fix:`, `docs:`, `chore:`, no prefix) | Patch | 3.6.2 → 3.6.3 |

- **Replay:** `scripts/version.cjs` walks every non-merge commit from `0.0.0`, or from the latest `v*.*.*` tag if one exists.

## Commands

| Command | Does |
|---|---|
| `node scripts/version.cjs` | Prints HEAD's version |
| `node scripts/version.cjs --write` | Updates `assets/script/version.js` without committing |
| `node scripts/version.cjs --changelog` | Rewrites `docs/changelog.md` with every commit id filled in |
| `node scripts/version.cjs --hook` | What the post-commit hook runs |

## Hooks

- **`post-commit`:** writes `version.js` and `docs/changelog.md`, then amends both into the commit just made, leaving anything else staged untouched.
- **Skipped:** during a rebase, cherry-pick, revert or bisect; the next normal commit catches up.
- **Needs Node:** without `node` the hook does nothing.
- **`commit-msg`:** removes trailer lines (`…-by:`, email trailers, "generated with/by") and trailing blank lines; plain `sh`, no Node.
- **Newest changelog row:** reads *(this commit)*, since a commit can't contain its own id; the next commit fills it in.

## In the app

- **Footer:** `app.js` fills `#footer-version` from `APP_VERSION` (`version.js`) at boot; no runtime call.

## Related

- [Changelog](../changelog.md): every commit with its version.
- [Getting started](getting-started.md): template sheet, Google Cloud, `config.js`, local server, API keys.
- [Project structure](project-structure.md): every file, one line each.
