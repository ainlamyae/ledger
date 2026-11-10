#!/usr/bin/env node
// App version from git history (Conventional Commits), written to
// assets/script/version.js. Same idea as CELPiPi's scripts/version.cjs.
//
// Each non-merge commit after the baseline:
//   - `type!:` or a "BREAKING CHANGE:" footer  → major + 1, minor = 0, patch = 0
//   - `feat:` / `feat(scope):`                 → minor + 1, patch = 0
//   - anything else (fix, docs, chore, …)      → patch + 1
// Counted from 0.0.0 over the whole history (or from the latest reachable
// v*.*.* tag, if one is ever made).
//
// Usage:
//   node scripts/version.cjs           print the version for HEAD
//   node scripts/version.cjs --write   update version.js if it changed
//   node scripts/version.cjs --hook    post-commit: write version.js + changelog, fold both into HEAD
//   node scripts/version.cjs --changelog  rewrite docs/changelog.md

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION_PATH = 'assets/script/version.js'; // repo-relative, for git
const VERSION_FILE = path.join(ROOT, VERSION_PATH);
const CHANGELOG_PATH = 'docs/changelog.md';
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

// Every commit oldest first, each with the version it produced.
function computeHistory() {
  const tag = latestTag();
  let [major, minor, patch] = tag ? tag.slice(1).split('.').map(Number) : [0, 0, 0];

  const log = git(['log', '--reverse', '--no-merges', '--format=%H%x00%s%x00%b%x1e', tag ? `${tag}..HEAD` : 'HEAD']);
  const commits = log ? log.split('\x1e').map((c) => c.trim()).filter(Boolean) : [];

  return commits.map((entry) => {
    const [hash, subject, body = ''] = entry.split('\x00');
    const m = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?(!)?:/i.exec(subject);
    const type = m ? m[1].toLowerCase() : null;
    let bump;
    if ((m && m[3]) || type === 'major' || /^BREAKING[ -]CHANGE:/m.test(body)) { major++; minor = 0; patch = 0; bump = 'major'; }
    else if (type === 'feat') { minor++; patch = 0; bump = 'minor'; }
    else { patch++; bump = 'patch'; }
    return { hash, subject, bump, version: `${major}.${minor}.${patch}` };
  });
}

function computeVersion() {
  const history = computeHistory();
  return history.length ? history[history.length - 1].version : '0.0.0';
}

// docs/changelog.md: every commit, newest first. From the hook, the newest row
// reads "(this commit)": a commit can't hold its own id, and the amend that
// folds this file in changes it. The next commit's run fills it in.
function writeChangelog({ pendingHead = false } = {}) {
  const cell = (s) => s.replace(/\|/g, '\\|');
  const rows = computeHistory().reverse().map((c, i) => {
    const version = c.bump === 'patch' ? c.version : `**${c.version}**`;
    const id = pendingHead && i === 0 ? '(this commit)' : `\`${c.hash.slice(0, 7)}\``;
    return `| ${id} | ${version} | ${cell(c.subject)} |`;
  });
  const text = [
    '# Changelog',
    '',
    '[← Back to README](../README.md)',
    '',
    'Every commit, newest first, with the version it produced (see [Versioning](versioning.md)); major and minor releases in bold. Rewritten on every commit by the post-commit hook (`scripts/version.cjs`); the newest row reads *(this commit)* until the next commit fills in its id.',
    '',
    '| Commit | Version | Changes |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, CHANGELOG_PATH), text);
  return rows.length;
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

  const { version } = writeVersionFile();
  writeChangelog({ pendingHead: true });

  // Fold version.js and the changelog into the commit just made. A temporary
  // index built from HEAD leaves anything else you have staged untouched.
  const files = [VERSION_PATH, CHANGELOG_PATH].map((p) => ({ p, blob: git(['hash-object', '-w', p]) }));
  const tmpIndex = path.join(os.tmpdir(), `ledger-version-index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex, LEDGER_VERSION_HOOK: '1' };
  try {
    git(['read-tree', 'HEAD'], { env });
    files.forEach(({ p, blob }) => git(['update-index', '--add', '--cacheinfo', `100644,${blob},${p}`], { env }));
    git(['commit', '--amend', '--no-edit', '--no-verify', '--allow-empty', '--quiet'], { env });
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
  // Keep the real index in step so neither file shows as modified.
  files.forEach(({ p, blob }) => git(['update-index', '--add', '--cacheinfo', `100644,${blob},${p}`]));
  process.stdout.write(`version: ${version}; changelog updated\n`);
}

const arg = process.argv[2];
if (arg === '--hook') {
  try { hook(); } catch (e) { process.stderr.write(`version hook skipped: ${e.message.split('\n')[0]}\n`); }
} else if (arg === '--changelog') {
  console.log(`docs/changelog.md: ${writeChangelog()} commits`);
} else if (arg === '--write') {
  const r = writeVersionFile();
  console.log(r.version + (r.changed ? ' (updated)' : ''));
} else {
  console.log(computeVersion());
}
