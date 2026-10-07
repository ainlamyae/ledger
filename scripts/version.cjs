#!/usr/bin/env node
// App version from git history (Conventional Commits), written to
// assets/script/version.js. Same idea as CELPiPi's scripts/version.cjs.
//
// Each non-merge commit after the baseline:
//   - `type!:` or a "BREAKING CHANGE:" footer  → major + 1, minor = 0, patch = 0
//   - `feat:` / `feat(scope):`                 → minor + 1, patch = 0
//   - anything else (fix, docs, chore, …)      → patch + 1
// Baseline: the latest reachable v*.*.* tag, else BASELINE below (the last
// commit stamped by the old commit-count scheme).
//
// Usage:
//   node scripts/version.cjs           print the version for HEAD
//   node scripts/version.cjs --write   update version.js if it changed
//   node scripts/version.cjs --hook    post-commit: write + fold the file into HEAD

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION_PATH = 'assets/script/version.js'; // repo-relative, for git
const VERSION_FILE = path.join(ROOT, VERSION_PATH);
const BASELINE = { commit: 'd3b342b', version: '3.5.3' };

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
}

function latestTag() {
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*', 'HEAD']);
  } catch {
    return null;
  }
}

function computeVersion() {
  const tag = latestTag();
  const from = tag || BASELINE.commit;
  let [major, minor, patch] = (tag ? tag.slice(1) : BASELINE.version).split('.').map(Number);

  const log = git(['log', '--reverse', '--no-merges', '--format=%s%x00%b%x1e', `${from}..HEAD`]);
  const commits = log ? log.split('\x1e').map((c) => c.trim()).filter(Boolean) : [];

  commits.forEach((entry) => {
    const [subject, body = ''] = entry.split('\x00');
    const m = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject);
    const type = m ? m[1].toLowerCase() : '';
    if ((m && m[3]) || /^BREAKING[ -]CHANGE:/m.test(body)) { major++; minor = 0; patch = 0; }
    else if (type === 'feat') { minor++; patch = 0; }
    else { patch++; }
  });

  return `${major}.${minor}.${patch}`;
}

function writeVersionFile() {
  const version = computeVersion();
  const text = `// Written by scripts/version.cjs (post-commit hook); do not edit.\nconst APP_VERSION = '${version}';\n`;
  const current = fs.existsSync(VERSION_FILE) ? fs.readFileSync(VERSION_FILE, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current === text) return { changed: false, version };
  fs.writeFileSync(VERSION_FILE, text);
  return { changed: true, version };
}

// Skip while git is replaying commits; the next normal commit catches up.
function inProgressOperation() {
  const gitDir = path.resolve(ROOT, git(['rev-parse', '--git-dir']));
  return ['rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG']
    .some((name) => fs.existsSync(path.join(gitDir, name)));
}

function hook() {
  if (process.env.LEDGER_VERSION_HOOK) return; // the amend below re-runs post-commit
  if (inProgressOperation()) return;

  const { changed, version } = writeVersionFile();
  if (!changed) return;

  // Fold version.js into the commit just made. A temporary index built from
  // HEAD leaves anything else you have staged untouched.
  const blob = git(['hash-object', '-w', VERSION_PATH]);
  const tmpIndex = path.join(os.tmpdir(), `ledger-version-index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex, LEDGER_VERSION_HOOK: '1' };
  try {
    git(['read-tree', 'HEAD'], { env });
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${VERSION_PATH}`], { env });
    git(['commit', '--amend', '--no-edit', '--no-verify', '--allow-empty', '--quiet'], { env });
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
  // Keep the real index in step so version.js doesn't show as modified.
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},${VERSION_PATH}`]);
  process.stdout.write(`version: ${version}\n`);
}

const arg = process.argv[2];
if (arg === '--hook') {
  try { hook(); } catch (e) { process.stderr.write(`version hook skipped: ${e.message.split('\n')[0]}\n`); }
} else if (arg === '--write') {
  const r = writeVersionFile();
  console.log(r.version + (r.changed ? ' (updated)' : ''));
} else {
  console.log(computeVersion());
}
