// Pulls the Activity Plan Instruction modal's exercise guides from liftmanual.com
// and writes them to assets/images/activities as <slug>.jpg.
//
//     node scripts/fetch_activity_images.mjs
//
// Used with the site owner's permission. The output is committed, so this only
// needs re-running when the plan's exercise list changes.
//
// Each guide is one wide image carrying both the start and the finish, which is
// why the modal shows a single picture per activity. A movement that later gets
// an animated loop has its still dropped by fetch_activity_animations.mjs.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Their catalogue names movements by equipment ("lever" for a plate/pin machine),
// so these are hand-checked against the plan's own wording rather than matched on
// text — "Machine Lateral Raise" and "Dumbbell Lateral Raise" are one search hit
// apart and different exercises. Several names have more than one candidate; the
// first that resolves wins, which is what covers the ones filed under a variant.
const SOURCES = {
  'Leg Press': ['lever-seated-leg-press'],
  'Leg Extension (quads)': ['lever-leg-extension'],
  'Leg Curl (hamstrings)': ['lever-seated-leg-curl'],
  'Hip Abduction machine': ['lever-seated-hip-abduction'],
  'Hip Adduction machine': ['lever-seated-hip-adduction'],
  'Calf Raise machine': ['lever-standing-calf-raise'],
  'Chest Press machine': ['lever-chest-press'],
  'Shoulder Press machine': ['lever-seated-shoulder-press'],
  'Pec Deck / Chest Fly machine': ['lever-pec-deck-fly'],
  'Left Lateral Raise machine (or cable)': ['lever-lateral-raise'],
  'Right Lateral Raise machine (or cable)': ['lever-lateral-raise'],
  'Cable Tricep Pushdown': ['cable-pushdown'],
  'Lat Pulldown': ['cable-wide-grip-lat-pulldown'],
  'Seated Row machine': ['lever-seated-row'],
  'Rear Delt Fly machine (or cable)': ['lever-seated-reverse-fly'],
  'Cable Bicep Curl': ['cable-curl'],
  'Dumbbell Goblet Squat': ['dumbbell-goblet-squat'],
  'Dumbbell Bench Press': ['dumbbell-bench-press'],
  'Dumbbell Row': ['dumbbell-bent-over-row'],
  'Dumbbell Shoulder Press': ['dumbbell-seated-shoulder-press'],
  'Dumbbell Romanian Deadlift': ['dumbbell-romanian-deadlift'],
  'Dumbbell Lateral Raise': ['dumbbell-lateral-raise'],
  'Dumbbell Bicep Curl': ['dumbbell-biceps-curl'],
  'Dumbbell Tricep Extension': ['dumbbell-standing-triceps-extension'],
  Crunch: ['crunch-floor', 'floor-crunch', 'long-arm-crunch', 'knee-touch-crunch', 'crunch-hold'],
  Plank: ['front-plank'],
  'Side Plank (both sides)': ['side-plank'],
  'Leg Raise': ['lying-leg-raise'],
  'Glute Bridge': ['bodyweight-glute-bridge', 'heel-glute-bridge'],
  'Bird Dog (both sides)': ['bird-dog'],
  Superman: ['superman'],
  'Push-up': ['push-up'],
  'Bodyweight Squat': ['squat', 'air-squat'],
  'Mountain Climber': ['mountain-climber', 'bodyweight-mountain-climber', 'floor-mountain-climber'],
};

const UA = 'Mozilla/5.0 (compatible; ledger-activity-figures/1.0)';

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function guideUrl(candidate) {
  const res = await fetch(`https://liftmanual.com/${candidate}/`, { headers: { 'User-Agent': UA } });
  // A miss redirects to the home page rather than 404ing, so the landing URL is
  // the only reliable signal that the slug was real.
  if (!res.ok || new URL(res.url).pathname === '/') return null;
  const html = await res.text();
  return html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images', 'activities');
mkdirSync(outDir, { recursive: true });

const missing = [];
for (const [name, candidates] of Object.entries(SOURCES)) {
  const dest = join(outDir, `${slug(name)}.jpg`);
  if (existsSync(dest)) {
    console.log(`  skip  ${name}`);
    continue;
  }

  let url = null;
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    url = await guideUrl(candidate);
    if (url) break;
    // A courtesy pause; this is someone else's server and there is no hurry.
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 400); });
  }
  if (!url) {
    missing.push(name);
    console.log(`  MISS  ${name}`);
    continue;
  }

  // eslint-disable-next-line no-await-in-loop
  const img = await fetch(url, { headers: { 'User-Agent': UA } });
  // eslint-disable-next-line no-await-in-loop
  const bytes = Buffer.from(await img.arrayBuffer());
  writeFileSync(dest, bytes);
  console.log(`  ok    ${name}  ${Math.round(bytes.length / 1024)}kB`);
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => { setTimeout(r, 400); });
}

console.log(`\n${Object.keys(SOURCES).length - missing.length}/${Object.keys(SOURCES).length} fetched`);
if (missing.length) console.log(`no guide found, keeping the drawing: ${missing.join(', ')}`);
