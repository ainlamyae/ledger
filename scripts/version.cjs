#!/usr/bin/env node
// App version from git history (Conventional Commits), written to
// assets/script/version.js. Same idea as CELPiPi's scripts/version.cjs.
//
// Each non-merge commit after the baseline:
//   - `type!:` or a "BREAKING CHANGE:" footer  → major + 1, minor = 0, patch = 0
//   - `feat:` / `feat(scope):`                 → minor + 1, patch = 0
//   - anything else (fix, docs, chore, …)      → patch + 1
// Counted from 0.0.0 over the whole history (or from the latest reachable
// v*.*.* tag, if one is ever made). Commits from before the prefixes were used
// are judged by hand in LEGACY below; any not listed there is a patch.
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
// Pre-prefix commits, read one by one: major = changed how the app or its sheet
// works as a whole; feat = something new to use; everything else = patch.
const LEGACY = {
  major: [
    '5c01171', // Build full Ledger app → 1.0.0
    '947fd74', // Health Log replaced by the per-day Physique tab → 2.0.0
    'e00ffe7', // Finance Market, Portfolio and Analysis pages → 3.0.0
  ],
  feat: `
    e608995 351a653 ae9fa28 1b1c1f8 f81dbea 3b63b40 d3f06b7 c577e1f e372c95 9370456
    f34a310 6e5c54e f356c47 f2be2e1 d5adef8 7adf9b3 01635e1 61f7e76 c61b138 fbc3aef
    4574d7d 081fd61 5e49ff3 7d072d5 bd95d25 2bf13f7 9eb68be 803ca46 6778a4c 7b182ca
    5d7ef5e 183fff8 4938854 b408e93 121f7fb a0b39fa 6e5eff5 b305b8f 6129e35 b8d10cb
    52ed849 632abf3 e002c18 273b90c 5605638 0b30840 7c142ca 306d083 9c914bc 29afbe1
    a50bd5f 72fdc41 e73e9ae e48e13c 4719d7a 2b34928 af98648 baf798b 88b9b76 d7a886e
    8087e4d 99c425a 2c1732c 3d7017d d88db9c 62780c6 2bf24cd f65615c 1b09191 af8304c
    ec8636b 29e7b68 8ef5274 af930fa 96c2780 cc416b8 c83e42b 30fd4c7 a82eee8 7259918
    702ddc3 90075b3 a2e11de b9bd316 a145a5b 0da2a17 898edf5 a3def5d 7d941d4 39a61d7
    0f65999 ccd7668 c925855 b9b2823 7836dfe 54e9a63 f8c4dce 6c028b9 8d9fbc9 26f194d
    31e63f2 70bc3c9 90a6a6b 59ac727 7008ceb 5e7650b 0c99819 455509d 3b21822 592a42c
    f6f7ca8 ba34d34 7d7f67e 644a23b 229e46b 1fd6436 e9c7e59 d30516a cee1304 337871d
    e69ef8e 7518214 6fbc532 22406b6 07fd7d1 d6788a0 a60d0cd 9703cfe e5fd877 3a29661
    bbacabf 012ca7e 750a440 1f286b0 d8cd6c1 cddca66 831eaa9 9ac38ba d447c9e 5a94be8
    4ff3dbd 0c2bd91 1a40681 d946716 0cfdb48 1284c06 b8a3185 39e17a0 93934ba
    2459c0e 6bb420f 828787d d3ff8ba
  `.trim().split(/\s+/),
};

function legacyType(hash) {
  if (LEGACY.major.some((h) => hash.startsWith(h))) return 'major';
  if (LEGACY.feat.some((h) => hash.startsWith(h))) return 'feat';
  return null;
}

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
    const type = m ? m[1].toLowerCase() : legacyType(hash);
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
