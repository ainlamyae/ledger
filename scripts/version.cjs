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
    'd6610f3', // Build full Ledger app → 1.0.0
    '4f9b480', // Health Log replaced by the per-day Physique tab → 2.0.0
    '5eb69fc', // Finance Market, Portfolio and Analysis pages → 3.0.0
  ],
  feat: `
    45a69a0 e49512c addfed9 3b266f1 ec5b8d0 d9b9f1a f7cc7f1 4264c46 0382a1c 0053b04
    9296a8c ebda02c 61381e4 eefeb99 04d2364 468de10 1b60730 b06e644 2080991 a3fa60d
    f44cc1d 56db6ee ecc1734 cee2164 23f28df e0d50e2 60e6037 ab8c678 482079f e6c3758
    3b9508c 38b3948 95aa539 ab4ab7d 36c8134 4825785 5a026ea 0ca482f 1703b0f 5604060
    4e89365 d12df95 49d8002 b75614b adeecdb 4e22a51 ea506f7 6b13472 2db2439 d5c61dd
    dc3e05b c556d5a 1c78335 00ae473 14edb76 c5f34bc e35f27e 0052148 eea4e27 a30fce0
    4446fce 1513803 6d5fe5d e1547bf 32c6a86 a3e3f33 6448f78 3d72cc2 0bd83e4 747086f
    3bd58d2 ae00e59 0a9179b cada066 b37c737 fdba793 a1eca3b 8ae6574 9466d96 ca48f4a
    6cda756 50e66bb cfd16af 0f6871a 04f8c4f ddf8d89 01e0c09 755e9f3 84108d7 0bd4256
    81f59fd d5c1178 296d3e0 a518e7a 46e43ff 2e0045e c902a68 9545c1b 9dff321 714ace0
    f4d0d2c a50b5b5 c217fa8 a689a04 70f2c9b b25aa1d a13027a 329db21 32ee985 fec16c3
    ba2e7ce dc8e284 d094584 bff4116 df9cb14 597b92c d36ef6d ea3405b 8095e7e aa60537
    bc23e56 bd5630b 5b54392 f20991c 5235c43 143d6e6 0295264 4b01e98 b073902 0e037be
    547301a 9939df6 3e620cb 5662572 a025c9a f58ac8a 06977ca 212a483 06fc9f3 da0671b
    6af2000 ff99ef5 284a6a2 29a2b03 7c66b3d 156bc7a 01bdcb6 f5bfe53 e9e46e6
    6169fb2 69c518a 3d8b026 f447c5c
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
