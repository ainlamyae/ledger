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
    'ef1c6f9', // Build full Ledger app → 1.0.0
    '3f61f44', // Health Log replaced by the per-day Physique tab → 2.0.0
    'ec8a02b', // Finance Market, Portfolio and Analysis pages → 3.0.0
  ],
  feat: `
    41be132 6200c18 9566a06 48548fd 2fc8843 8d81b7b 2394878 594af34 be2df89 f5766f2
    0eb9e80 cc5fd33 74fad7a 4a1ad79 8d4b8e3 d53563c 5f1dcc9 418e9e3 556cb35 25e7e4d
    8091fd1 54f516d bcda25d 617d6b1 d5396b6 ebee79c ef4e7c4 fee9d37 5cf0c90 9d8dd34
    08bfa9d 759abc6 41a4fb8 24d6085 0cd5ab0 e9b8a00 87a72fb 6f9d624 23f27c3 f13f587
    ed63c47 dd4ff72 1af5ea4 fceb649 a3e4029 2e4a0b9 afd6bc4 b9713f4 acc1261 6e6098e
    ef522c1 f194588 6d3468e 10a3506 99b3076 5533ebd 59b2006 57ff399 a067797 a95d2e3
    d136751 1a6aa52 04dce45 d3be16b 4890d35 9225012 5061047 5f2b3f4 cbd9614 b932300
    343c182 bfa6abf 2bf4622 f62ce5a 944f197 5b3bef3 7e21aac 99e3ebe d71afb0 3473d09
    ea831fc 547e319 d75629d 9edf1ab a349340 0f34e19 45cf99e eae0225 09f9b14 4c6c8e2
    baec43b cb52eae d2ef687 65e8ff8 662522d 643e693 c0f80b3 8bb4701 ad59c77 467e63f
    bc8eac8 661ae92 4e5b229 5972a9d 961caa6 32853a7 71a7efb 0ed6ced eb70213 0068746
    cf5e227 2b108c8 84ca421 46ba752 01b5e5e 4da2840 ff72b99 8fadc4a 2ff2f49 ad5cbed
    dfdddee b5cfc74 074853b 1d44063 51f094a cd4c1fa ee53d06 11f41ce 5151fa6 452e084
    d8e42a9 8a5a639 0f9dc03 dd9f0eb e9a7cb5 ba7d198 93b7edf 779f34b 4329dfb 48d3b73
    acc6e00 22e9251 add8449 34b46d6 fda3563 576cef7 97d01de 499dbab ab14cfb
    9c9de6e 98d039f f6e7172 d3b342b
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
