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
    '765fbd8', // Build full Ledger app → 1.0.0
    '7ea44f1', // Health Log replaced by the per-day Physique tab → 2.0.0
    '40c813a', // Finance Market, Portfolio and Analysis pages → 3.0.0
  ],
  feat: `
    e608995 3090b89 5b7dbc5 8567e64 0ed8b3f 96aa2e7 48beac6 6160f62 2a5df9b f680119
    78e231a f5250cc 4046cc0 38dae07 cdf3b26 de9dadc b1c902f 07dd529 ea5edc8 df4fa3d
    3e98fe7 f970bfa d829aff e07ea68 3a787e8 3020fcc 68dbef8 0d77431 dfab9c6 dd1e063
    b8e03b3 605101a 6c74430 bada1d0 20ae6a9 b474cca 5782775 8414fa7 6e8715c 27c4305
    dd850bb 78f4679 59062b5 73b5fbf 178bc9a 94dab22 951510c babcdc0 0508956 b68a8e2
    deb116b a064c90 468c178 c57b6b8 c18b8d6 bcfb691 f4be546 c00f770 8ba40ca 8ab79cf
    6384853 bb9b993 2692be8 cf138b6 b53a7be 3439f1f 801fe0e f47e694 812afcd f109a77
    5020f27 4356fcd 79fd189 6aef9c2 6b0a077 dc28863 14c346c a1ade7f ea0d324 040b4ec
    61ce5b9 0d25123 e937246 a796452 ceaf9a8 afd9c10 c209d81 810f5d0 7167a57 4fd67f6
    cc937ba e379be1 6fde846 e521a8c 6299c8c b8a34b7 77d92f2 ec51720 5268746 1c06c9e
    c707705 25d8973 33ed153 3eca770 2b200bb d0329bd c8cf130 12bcc3c d99d1a6 c4fbfc7
    1d4ebae 35086f7 6747dbf dc2fa83 b56aa8e cc1b712 b6dbe9f 8c6d09a 12e82c0 56bbad4
    051749f 2145eac 4c95ce6 244a145 77fcb9e 92576ce 26ef72b 67748ab f90856d 30aa4d8
    57da33a 690d225 8bc518d 046f454 ebcab15 efd9a05 d121a18 0ff62cc 2ee886c 53e01d3
    5a021a7 732bcfb 0fcbf0e 12b09a3 cc8df16 0629ebc 0fa0022 16305cd 0251c20
    c6ba7c1 c23c09f 8629ee8 cd5ebbb
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
