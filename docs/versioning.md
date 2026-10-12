# Versioning

[← Back to README](../README.md)

The footer shows the app version as `vMAJOR.MINOR.PATCH` (e.g. `v3.6.0`).

- Versions are generated automatically from the commit messages; nothing is edited by hand.
- Start each commit message with a [Conventional Commits](https://www.conventionalcommits.org/) type — it decides the bump:

| Commit message starts with | Bump | Example |
|---|---|---|
| `feat!:` or a `BREAKING CHANGE:` footer | major + 1, minor and patch reset | 3.6.2 → 4.0.0 |
| `feat:` / `feat(scope):` | minor + 1, patch resets | 3.6.2 → 3.7.0 |
| anything else (`fix:`, `docs:`, `chore:`, `style:`, no prefix) | patch + 1 | 3.6.2 → 3.6.3 |

- `scripts/version.cjs` replays every non-merge commit since the baseline: the latest `v*.*.*` tag if there is one, else `3.5.3` at `d3b342b` (the last commit of the old commit-count scheme). Tag a commit (`git tag v4.0.0`) to start a new baseline.
- `scripts/hooks/post-commit` runs it after each commit, writes `assets/script/version.js`, and folds that file into the commit just made (an amend), so every commit carries its own version. Skipped during a rebase, cherry-pick, revert or bisect; the next normal commit catches up. Needs `node`; without it the hook does nothing.
- `node scripts/version.cjs` prints HEAD's version; `--write` updates `version.js` without committing.
- `app.js` fills `#footer-version` from `APP_VERSION`. No runtime call, no build step.

## Setup (once per clone)

```sh
git config core.hooksPath scripts/hooks
```
