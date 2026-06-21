/**
 * Crescendo FDJ — Analyse combinaisons étendues (2→8 numéros)
 * + séquences consécutives
 * Sortie : crescendo_combos.json
 */

const fs = require('fs');

function loadCsv(path) {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const h = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).filter(l => l.trim()).map(l => {
    const v = l.split(','); const o = {};
    h.forEach((k,i) => o[k] = v[i]?.trim() ?? '');
    return o;
  });
}

const rows = loadCsv('crescendo_historique_enrichi.csv');
const tirages = rows.map(r => ({
  date: r.date, heure: r.heure,
  nums: [r.n1,r.n2,r.n3,r.n4,r.n5,r.n6,r.n7,r.n8,r.n9,r.n10].map(Number).sort((a,b)=>a-b),
  lettre: r.lettre,
}));

const N = tirages.length;
console.log(`\nAnalyse de ${N} tirages...\n`);

// Théoriques attendus
// C(10,k)/C(25,k) × N
function c(n, k) {
  if (k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return Math.round(r);
}
const C25 = [0,25,300,2300,12650,53130,177100,480700,1081575];
const C10 = [0,10,45,120,210,252,210,120,45];

// ── CALCUL DES COMBINAISONS k=2..8 ────────────────────────────
const combosMap = {}; // k → { key: count }
for (let k = 2; k <= 8; k++) combosMap[k] = {};

function getCombos(arr, k) {
  const result = [];
  function helper(start, combo) {
    if (combo.length === k) { result.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

let processed = 0;
for (const t of tirages) {
  for (let k = 2; k <= 8; k++) {
    const combos = getCombos(t.nums, k);
    for (const c of combos) {
      const key = c.join('-');
      combosMap[k][key] = (combosMap[k][key] || 0) + 1;
    }
  }
  processed++;
  if (processed % 50 === 0) process.stdout.write(`  ${processed}/${N} tirages...\r`);
}
console.log(`  ${N}/${N} tirages traités.`);

// ── SÉQUENCES CONSÉCUTIVES ─────────────────────────────────────
// Toutes les suites de k numéros consécutifs qui apparaissent dans le même tirage
const consecMap = {}; // "5-6-7-8" → count

for (const t of tirages) {
  const nums = t.nums; // déjà triés
  // Pour chaque sous-suite consécutive de longueur k (2..8)
  for (let i = 0; i < nums.length; i++) {
    for (let len = 2; len <= 8; len++) {
      // Vérifier si nums[i..i+len-1] sont consécutifs
      if (i + len > nums.length) break;
      let isConsec = true;
      for (let j = 1; j < len; j++) {
        if (nums[i+j] !== nums[i+j-1] + 1) { isConsec = false; break; }
      }
      if (isConsec) {
        const key = nums.slice(i, i+len).join('-');
        consecMap[key] = (consecMap[key] || 0) + 1;
      }
    }
  }
}

// ── TOP PAR TAILLE ─────────────────────────────────────────────
const result = {};
for (let k = 2; k <= 8; k++) {
  const exp = (N * C10[k] / C25[k]);
  const entries = Object.entries(combosMap[k])
    .map(([combo, count]) => ({ combo, count, delta: +(count - exp).toFixed(2) }))
    .sort((a,b) => b.count - a.count);

  const top20  = entries.slice(0, 20);
  const total  = entries.length;
  const maxCount = entries[0]?.count || 0;
  const neverSeen = C25[k] - total; // combos avec count=0

  result[k] = { k, exp: +exp.toFixed(2), total, maxCount, neverSeen, top20 };

  console.log(`k=${k}: ${total} combos distinctes | attendu=${exp.toFixed(2)}/combo | max=${maxCount}x (${entries[0]?.combo})`);
}

// ── TOP SÉQUENCES CONSÉCUTIVES ────────────────────────────────
const consecByLen = {};
for (const [key, count] of Object.entries(consecMap)) {
  const len = key.split('-').length;
  if (!consecByLen[len]) consecByLen[len] = [];
  consecByLen[len].push({ combo: key, count });
}
for (const len of Object.keys(consecByLen)) {
  consecByLen[len].sort((a, b) => b.count - a.count);
}

console.log('\nSéquences consécutives les plus fréquentes:');
for (let k = 2; k <= 8; k++) {
  const top = (consecByLen[k] || []).slice(0, 5);
  if (top.length > 0) {
    console.log(`  Longueur ${k}: ${top.map(x => `${x.combo}(${x.count}x)`).join('  ')}`);
  }
}

// ── SAUVEGARDE ─────────────────────────────────────────────────
const output = {
  generatedAt: new Date().toISOString(),
  nbTirages: N,
  combos: result,
  consecutives: consecByLen,
};
fs.writeFileSync('crescendo_combos.json', JSON.stringify(output, null, 2), 'utf8');
console.log('\n✅ crescendo_combos.json sauvegardé');
