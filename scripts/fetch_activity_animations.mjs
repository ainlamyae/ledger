// Pulls the animated exercise loops for the Activity Plan Instruction modal and
// writes them to assets/images/activities as <slug>.gif.
//
//     node scripts/fetch_activity_animations.mjs
//
// Used with the rights holder's permission. Output is committed; re-run only
// after adding a URL below.
//
// Kept as GIF rather than transcoded. An <img> plays one natively, so an
// animated activity and a still one differ by nothing but file extension — the
// page needs no <video> element and no fallback path.
//
// Every slug added here also has to go into ACTIVITY_ANIMATIONS in
// strength-plan.js, which is what tells the page to reach for the .gif instead
// of the .jpg. This prints that list when it finishes so the two can't drift
// apart without it being obvious.

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCES = {
  'Leg Press': 'https://media1.tenor.com/m/yBaS_oBgidsAAAAC/gym.gif',
  'Leg Extension (quads)': 'https://media1.tenor.com/m/L-taJvA94kQAAAAC/leg-extension.gif',
  'Leg Curl (hamstrings)': 'https://media1.tenor.com/m/ZElx6PviDq0AAAAC/gym.gif',
  'Hip Abduction machine': 'https://media1.tenor.com/m/N62v0esa3K8AAAAC/innerouter-thigh-machine.gif',
  'Chest Press machine': 'https://media1.tenor.com/m/EKlnuE8YO70AAAAC/converging-shoulder-press.gif',
  'Shoulder Press machine': 'https://media1.tenor.com/m/vFJSvh8AvhAAAAAC/a1.gif',
  'Pec Deck / Chest Fly machine': 'https://media1.tenor.com/m/k5ahyb6VmUkAAAAC/pec.gif',
  'Cable Tricep Pushdown': 'https://media1.tenor.com/m/mbebKudZjxYAAAAC/tr%C3%ADceps-pulley.gif',
  'Lat Pulldown': 'https://media1.tenor.com/m/PVR9ra9tAwcAAAAC/pulley-pegada-aberta.gif',
  'Seated Row machine': 'https://media1.tenor.com/m/ft6FHrqty-8AAAAC/remada-pronada-maquina.gif',
  'Left Lateral Raise machine (or cable)': 'https://media1.tenor.com/m/nJyyTUIZRScAAAAC/que-onda.gif',
  'Dumbbell Goblet Squat': 'https://media1.tenor.com/m/yvyaUSnqMXQAAAAC/agachamento-goblet-com-haltere.gif',
  'Dumbbell Bench Press': 'https://media1.tenor.com/m/nxJqRDCmt0MAAAAC/supino-reto.gif',
  'Dumbbell Lateral Raise': 'https://media1.tenor.com/m/cy46UbnfUrkAAAAC/eleva%C3%A7%C3%A3o-lateral-hateres.gif',
  'Leg Raise': 'https://media1.tenor.com/m/MNj_cLoECP4AAAAC/abdominales.gif',
  'Rear Delt Fly machine (or cable)': 'https://gymfitclub.ir/public/images/articles/upload/seated-reverse-fly.gif',
  'Cable Bicep Curl': 'https://fitnessvolt.com/wp-content/plugins/fv-app-core/exercises/360/0868.gif',
  'Dumbbell Bicep Curl': 'https://i.pinimg.com/originals/4b/e4/68/4be46841032506b311d43b8d49c6a58a.gif',
  'Bird Dog (both sides)': 'https://menspower.nl/wp-content/uploads/2018/03/bird-dog.gif',
  'Push-up': 'https://media1.tenor.com/m/e45GckrMBLEAAAAC/flex%C3%A3o-inclinada-no-banco.gif',
  'Hip Adduction machine': 'https://newlife.com.cy/wp-content/uploads/2019/11/05981301-Lever-Seated-Hip-Adduction_Thighs_360.gif',
  'Calf Raise machine': 'https://newlife.com.cy/wp-content/uploads/2019/11/26661301-Lever-Seated-Calf-Raise-plate-loaded-VERSION-2_Calves_360.gif',
  'Dumbbell Row': 'https://i.pinimg.com/originals/e7/bb/3b/e7bb3b0ba4911c6abf8a2e05bed03a2e.gif',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36';

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images', 'activities');
mkdirSync(outDir, { recursive: true });

let total = 0;
for (const [name, url] of Object.entries(SOURCES)) {
  const dest = join(outDir, `${slug(name)}.gif`);
  if (existsSync(dest)) {
    console.log(`  skip  ${name}`);
    continue;
  }

  // eslint-disable-next-line no-await-in-loop
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: new URL(url).origin } });
  if (!res.ok) {
    console.log(`  FAIL  ${name}  http ${res.status}`);
    continue;
  }
  // eslint-disable-next-line no-await-in-loop
  const gif = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, gif);
  total += gif.length;
  console.log(`  ok    ${name}  ${Math.round(gif.length / 1024)}kB`);
}

// A still and an animation for the same movement is one file too many. This ran
// by hand until a fetch 403'd and the cleanup went ahead anyway, deleting the
// .jpg for a movement whose .gif had never arrived and leaving it with no figure
// at all — hence checking the animation is really on disk before dropping it.
let dropped = 0;
for (const name of Object.keys(SOURCES)) {
  const gif = join(outDir, `${slug(name)}.gif`);
  const jpg = join(outDir, `${slug(name)}.jpg`);
  if (existsSync(gif) && existsSync(jpg)) {
    rmSync(jpg);
    dropped += 1;
  }
}

console.log(`\n${Math.round(total / 1024)}kB fetched, ${dropped} redundant still(s) dropped`);
console.log('ACTIVITY_ANIMATIONS in strength-plan.js must list:');
console.log(Object.keys(SOURCES).map((n) => `'${slug(n)}'`).join(', '));
