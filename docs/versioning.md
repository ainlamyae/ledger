# Versioning

[← Back to README](../README.md)

The footer shows the app version as `vMAJOR.MINOR.PATCH` (e.g. `v3.5.0`).

- Versions are generated automatically from the commit messages; nothing is edited by hand.
- Start each commit message with a [Conventional Commits](https://www.conventionalcommits.org/) type — it decides the bump:

| Commit message starts with | Bump | Example |
|---|---|---|
| `feat!:` or a `BREAKING CHANGE:` footer | major + 1, minor and patch reset | 3.6.2 → 4.0.0 |
| `feat:` / `feat(scope):` | minor + 1, patch resets | 3.6.2 → 3.7.0 |
| anything else (`fix:`, `docs:`, `chore:`, `style:`, no prefix) | patch + 1 | 3.6.2 → 3.6.3 |

- `scripts/version.cjs` replays **every** non-merge commit from `0.0.0` (or from the latest `v*.*.*` tag, if one is ever made).
- Commits from before the prefixes were used were read one by one and judged in the script's `LEGACY` lists: **major** = changed how the app or its sheet works as a whole, **feat** = something new to use; any not listed is a patch. Edit a list to re-judge a commit.
- The resulting history: `v0.1.0` initial commit → `v1.0.0` the full app (`ef1c6f9`) → `v2.0.0` the per-day Physique tab replacing the Health Log (`3f61f44`) → `v3.0.0` the Finance Market, Portfolio and Analysis pages (`ec8a02b`) → `v3.5.0` at the switch to prefixed messages (`3d29342`).
- `scripts/hooks/post-commit` runs it after each commit: writes `assets/script/version.js` and rewrites [Changelog](changelog.md), then folds both into the commit just made (an amend), so every commit carries its own version and changelog row. Skipped during a rebase, cherry-pick, revert or bisect; the next normal commit catches up. Needs `node`; without it the hook does nothing.
- `node scripts/version.cjs` prints HEAD's version; `--write` updates `version.js` without committing.
- `app.js` fills `#footer-version` from `APP_VERSION`. No runtime call, no build step.
- The changelog's newest row reads *(this commit)*: a commit can't contain its own id (folding the file in changes it), so the next commit's run fills it in. `node scripts/version.cjs --changelog` rewrites it by hand with every id filled.

## Commit authorship

No co-authors, no names or emails, and never Claude or Anthropic, in any commit — enforced at three points, all plain `sh` (no `node` needed):

- `scripts/hooks/pre-commit` refuses the commit if the author or committer name/email contains Claude or Anthropic.
- `scripts/hooks/commit-msg` strips every attribution line — any `Something-by:` trailer (`Co-authored-by:`, `Signed-off-by:`, …), any trailer carrying a `<name@email>`, "Generated with/by" lines, 🤖 lines and `noreply@` addresses — then refuses the commit if "Claude" or "Anthropic" is still anywhere in the message, rather than cutting words out of it.
- `scripts/hooks/pre-push` checks every commit the push adds (message, author and committer) and refuses the push if either name appears, which catches a commit made with `--no-verify`. Commits already on the remote aren't re-checked.

## Setup (once per clone)

```sh
git config core.hooksPath scripts/hooks
```
