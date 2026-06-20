/**
 * Crescendo FDJ — Analyse statistique complète
 *
 * Analyses produites :
 *  1. Fréquence individuelle des numéros (1-25)
 *  2. Gap (tirages depuis la dernière apparition)
 *  3. Tendance récente (20 derniers tirages)
 *  4. Paires co-occurrentes (top 20 + bottom 20)
 *  5. Triplets remarquables (top 20)
 *  6. Quadruplets remarquables (top 10)
 *  7. Statistiques des lettres (globale + par heure + récente)
 *  8. Zones de numéros (bas/milieu/haut)
 *  9. Somme des tirages
 * 10. Numéros consécutifs
 * 11. Corrélation lettre × numéro
 * 12. Score global de recommandation par numéro
 *
 * Sortie : affichage console + crescendo_stats.json (pour l'algo de grilles)
 */

const fs = require('fs');

// ─── CHARGEMENT ───────────────────────────────────────────────
function loadCsv(path) {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i]?.trim() ?? '');
    return obj;
  });
}

const rows = loadCsv('crescendo_historique_enrichi.csv');

// Parser chaque tirage en objet exploitable
const tirages = rows.map(r => ({
  date:       r.date,
  heure:      r.heure,
  nums:       [r.n1,r.n2,r.n3,r.n4,r.n5,r.n6,r.n7,r.n8,r.n9,r.n10].map(Number),
  lettre:     r.lettre,
  jackpot:    parseInt(r.jackpot_enjeu_eur),
  remporte:   parseInt(r.jackpot_remporte),
  distribue:  parseInt(r.total_distribue_eur),
}));

const N_TIRAGES = tirages.length;
const NUMS      = Array.from({length: 25}, (_, i) => i + 1);
const LETTRES   = ['S','A','M','E','D','I'];
const HOURS     = ['13h','14h','15h','16h','17h','18h','19h'];

// ─── HELPERS ──────────────────────────────────────────────────
const line  = (char = '─', n = 65) => char.repeat(n);
const title = (t)  => `\n${line('═')}\n  ${t}\n${line('═')}`;
const sec   = (t)  => `\n${line('─')}\n  ${t}\n${line('─')}`;
const pct   = (n, d) => `${(n/d*100).toFixed(1)}%`;
const bar   = (n, max, w=20) => '█'.repeat(Math.round(n/max*w)).padEnd(w);
const zscore = (obs, exp, n) => ((obs - exp) / Math.sqrt(exp * (1 - exp/n))).toFixed(2);

// ─── 1. FRÉQUENCE INDIVIDUELLE ────────────────────────────────
const freq = {};
NUMS.forEach(n => freq[n] = 0);
tirages.forEach(t => t.nums.forEach(n => freq[n]++));

const EXP_NUM = N_TIRAGES * 10 / 25; // 89.6

// ─── 2. GAP (dernière apparition) ─────────────────────────────
const lastSeen = {};
NUMS.forEach(n => lastSeen[n] = -1);
const gap = {};
tirages.forEach((t, idx) => {
  t.nums.forEach(n => lastSeen[n] = idx);
});
NUMS.forEach(n => {
  gap[n] = lastSeen[n] === -1 ? N_TIRAGES : N_TIRAGES - 1 - lastSeen[n];
});

// ─── 3. TENDANCE RÉCENTE (20 derniers tirages) ────────────────
const RECENT = 20;
const recentTirages = tirages.slice(-RECENT);
const freqRecent = {};
NUMS.forEach(n => freqRecent[n] = 0);
recentTirages.forEach(t => t.nums.forEach(n => freqRecent[n]++));
const EXP_RECENT = RECENT * 10 / 25; // 8.0

// ─── 4. PAIRES CO-OCCURRENTES ─────────────────────────────────
const paires = {};
tirages.forEach(t => {
  const nums = t.nums;
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      const key = `${nums[i]}-${nums[j]}`;
      paires[key] = (paires[key] || 0) + 1;
    }
  }
});
const EXP_PAIRE = N_TIRAGES * 45 / 300; // 33.6

// ─── 5. TRIPLETS ──────────────────────────────────────────────
const triplets = {};
tirages.forEach(t => {
  const nums = t.nums;
  for (let i = 0; i < nums.length; i++)
    for (let j = i+1; j < nums.length; j++)
      for (let k = j+1; k < nums.length; k++) {
        const key = `${nums[i]}-${nums[j]}-${nums[k]}`;
        triplets[key] = (triplets[key] || 0) + 1;
      }
});
const EXP_TRIPLET = N_TIRAGES * 120 / 2300; // 11.7

// ─── 6. QUADRUPLETS ───────────────────────────────────────────
const quadruplets = {};
tirages.forEach(t => {
  const nums = t.nums;
  for (let i = 0; i < nums.length; i++)
    for (let j = i+1; j < nums.length; j++)
      for (let k = j+1; k < nums.length; k++)
        for (let l = k+1; l < nums.length; l++) {
          const key = `${nums[i]}-${nums[j]}-${nums[k]}-${nums[l]}`;
          quadruplets[key] = (quadruplets[key] || 0) + 1;
        }
});
const EXP_QUADRUPLET = N_TIRAGES * 210 / 12650; // 3.7

// ─── 7. STATISTIQUES DES LETTRES ──────────────────────────────
const freqLettre = {};
LETTRES.forEach(l => freqLettre[l] = 0);
tirages.forEach(t => freqLettre[t.lettre]++);

// Par heure
const freqLettreHeure = {};
LETTRES.forEach(l => {
  freqLettreHeure[l] = {};
  HOURS.forEach(h => freqLettreHeure[l][h] = 0);
});
tirages.forEach(t => {
  if (freqLettreHeure[t.lettre]) freqLettreHeure[t.lettre][t.heure]++;
});

// Par niveau jackpot
const freqLettreJackpot = {};
LETTRES.forEach(l => { freqLettreJackpot[l] = { bas: 0, haut: 0 }; });
tirages.forEach(t => {
  const cat = t.jackpot >= 500000 ? 'haut' : 'bas';
  if (freqLettreJackpot[t.lettre]) freqLettreJackpot[t.lettre][cat]++;
});

// Tendance récente lettres (20 derniers)
const freqLettreRecente = {};
LETTRES.forEach(l => freqLettreRecente[l] = 0);
recentTirages.forEach(t => { if (freqLettreRecente[t.lettre] !== undefined) freqLettreRecente[t.lettre]++; });

// ─── 8. ZONES ─────────────────────────────────────────────────
// Bas: 1-8 (8 nums), Milieu: 9-17 (9 nums), Haut: 18-25 (8 nums)
const zones = tirages.map(t => {
  const bas   = t.nums.filter(n => n <= 8).length;
  const mid   = t.nums.filter(n => n >= 9 && n <= 17).length;
  const haut  = t.nums.filter(n => n >= 18).length;
  return { bas, mid, haut };
});
const avgZone = {
  bas:  zones.reduce((s, z) => s + z.bas, 0)  / N_TIRAGES,
  mid:  zones.reduce((s, z) => s + z.mid, 0)  / N_TIRAGES,
  haut: zones.reduce((s, z) => s + z.haut, 0) / N_TIRAGES,
};
// Attendu: 10 × (8/25), 10 × (9/25), 10 × (8/25)
const expZone = { bas: 10*8/25, mid: 10*9/25, haut: 10*8/25 };

// ─── 9. SOMME DES TIRAGES ─────────────────────────────────────
const sommes = tirages.map(t => t.nums.reduce((s, n) => s + n, 0));
const avgSomme  = sommes.reduce((a, b) => a + b, 0) / N_TIRAGES;
const minSomme  = Math.min(...sommes);
const maxSomme  = Math.max(...sommes);
const stdSomme  = Math.sqrt(sommes.reduce((s, x) => s + (x - avgSomme)**2, 0) / N_TIRAGES);

// Distribution par tranches
const tranchesSomme = { '<90': 0, '90-110': 0, '110-130': 0, '130-150': 0, '150-170': 0, '>170': 0 };
sommes.forEach(s => {
  if      (s < 90)       tranchesSomme['<90']++;
  else if (s < 110)      tranchesSomme['90-110']++;
  else if (s < 130)      tranchesSomme['110-130']++;
  else if (s < 150)      tranchesSomme['130-150']++;
  else if (s < 170)      tranchesSomme['150-170']++;
  else                   tranchesSomme['>170']++;
});

// ─── 10. NUMÉROS CONSÉCUTIFS ──────────────────────────────────
const nbConsec = tirages.map(t => {
  let count = 0;
  const sorted = [...t.nums].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i+1] - sorted[i] === 1) count++;
  }
  return count;
});
const avgConsec = nbConsec.reduce((a, b) => a + b, 0) / N_TIRAGES;
// Attendu théorique : E[paires consécutives] = (n-1) × k(k-1)/(N(N-1)) × ... ≈ 3.24 pour k=10, N=25
const expConsec = 9 * (10*9) / (25*24); // approximation
const distribConsec = {};
nbConsec.forEach(n => distribConsec[n] = (distribConsec[n] || 0) + 1);

// ─── 11. CORRÉLATION LETTRE × NUMÉRO ─────────────────────────
const lettreNum = {};
LETTRES.forEach(l => { lettreNum[l] = {}; NUMS.forEach(n => lettreNum[l][n] = 0); });
tirages.forEach(t => {
  t.nums.forEach(n => {
    if (lettreNum[t.lettre]) lettreNum[t.lettre][n]++;
  });
});
// Pour chaque lettre, freq attendue par numéro = freqLettre[l] × 10 / 25
const topNumParLettre = {};
LETTRES.forEach(l => {
  const expN = freqLettre[l] * 10 / 25;
  topNumParLettre[l] = NUMS
    .map(n => ({ n, count: lettreNum[l][n], delta: lettreNum[l][n] - expN }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);
});

// ─── 12. SCORE GLOBAL DE RECOMMANDATION ──────────────────────
// Composantes normalisées 0-1 :
//   A. Fréquence brute     (chaud = bien)
//   B. Gap inversé         (absent depuis longtemps = intéressant)
//   C. Fréquence récente   (tendance = bien)
//   D. Force paires        (somme des co-occ de ce num avec les autres)

const maxFreq   = Math.max(...NUMS.map(n => freq[n]));
const maxGap    = Math.max(...NUMS.map(n => gap[n]));
const maxRecent = Math.max(...NUMS.map(n => freqRecent[n]));

// Force paires : pour chaque numéro, somme de ses co-occurrences
const pairStrength = {};
NUMS.forEach(n => {
  let total = 0;
  NUMS.forEach(m => {
    if (m !== n) {
      const key = n < m ? `${n}-${m}` : `${m}-${n}`;
      total += paires[key] || 0;
    }
  });
  pairStrength[n] = total;
});
const maxPairStr = Math.max(...NUMS.map(n => pairStrength[n]));

const scores = {};
NUMS.forEach(n => {
  const sFreq   = freq[n]          / maxFreq;
  const sGap    = gap[n]           / maxGap;
  const sRecent = freqRecent[n]    / Math.max(maxRecent, 1);
  const sPair   = pairStrength[n]  / maxPairStr;
  // Pondération : fréquence 30%, tendance récente 30%, paires 25%, gap 15%
  scores[n] = (sFreq * 0.30 + sRecent * 0.30 + sPair * 0.25 + sGap * 0.15);
});

// ─── AFFICHAGE ────────────────────────────────────────────────
console.log(title('CRESCENDO FDJ — ANALYSE STATISTIQUE COMPLÈTE'));
console.log(`  ${N_TIRAGES} tirages analysés | 08/11/2025 → 13/06/2026`);

// ── 1. FRÉQUENCES INDIVIDUELLES ──
console.log(title('1. FRÉQUENCE DES NUMÉROS'));
console.log(`  Attendu théorique : ${EXP_NUM.toFixed(1)} apparitions par numéro\n`);

const sortedByFreq = [...NUMS].sort((a, b) => freq[b] - freq[a]);
const maxF = freq[sortedByFreq[0]];
sortedByFreq.forEach(n => {
  const f    = freq[n];
  const diff = f - EXP_NUM;
  const sign = diff > 0 ? '+' : '';
  const flag = f > EXP_NUM + 10 ? ' 🔥' : f < EXP_NUM - 10 ? ' ❄' : '';
  console.log(`  ${String(n).padStart(2)}: ${String(f).padStart(3)} fois  ${bar(f, maxF)} ${sign}${diff.toFixed(1)}${flag}`);
});

// ── 2. GAP ──
console.log(sec('2. GAP — Tirages depuis la dernière apparition'));
const sortedByGap = [...NUMS].sort((a, b) => gap[b] - gap[a]);
const top8Gap = sortedByGap.slice(0, 8);
console.log('  Numéros les plus "en retard" :');
top8Gap.forEach(n => {
  const g = gap[n];
  const bar10 = '█'.repeat(Math.min(g, 20)).padEnd(20);
  console.log(`  ${String(n).padStart(2)}: absent depuis ${String(g).padStart(3)} tirages  ${bar10}`);
});

// ── 3. TENDANCE RÉCENTE ──
console.log(sec(`3. TENDANCE RÉCENTE (${RECENT} derniers tirages)`));
console.log(`  Attendu : ${EXP_RECENT.toFixed(1)} par numéro\n`);

const sortedRecent = [...NUMS].sort((a, b) => freqRecent[b] - freqRecent[a]);
console.log('  Numéros EN FORME (au-dessus de la moyenne) :');
sortedRecent.filter(n => freqRecent[n] > EXP_RECENT).forEach(n => {
  console.log(`  ${String(n).padStart(2)}: ${freqRecent[n]} fois  (${pct(freqRecent[n], RECENT * 10 / 25)} au-dessus)`);
});
console.log('\n  Numéros FROIDS (en dessous de la moyenne) :');
sortedRecent.filter(n => freqRecent[n] < EXP_RECENT - 2).forEach(n => {
  console.log(`  ${String(n).padStart(2)}: ${freqRecent[n]} fois`);
});

// ── 4. PAIRES ──
console.log(title('4. PAIRES CO-OCCURRENTES'));
console.log(`  Attendu théorique : ${EXP_PAIRE.toFixed(1)} fois par paire\n`);

const sortedPaires = Object.entries(paires).sort((a, b) => b[1] - a[1]);

console.log('  TOP 20 paires les plus fréquentes :');
sortedPaires.slice(0, 20).forEach(([pair, count], i) => {
  const diff = count - EXP_PAIRE;
  console.log(`  ${String(i+1).padStart(2)}. (${pair.padEnd(7)}) → ${count} fois  (+${diff.toFixed(1)} vs attendu)`);
});

console.log('\n  BOTTOM 10 paires les plus rares (sortent peu ensemble) :');
sortedPaires.slice(-10).reverse().forEach(([pair, count]) => {
  const diff = count - EXP_PAIRE;
  console.log(`  (${pair.padEnd(7)}) → ${count} fois  (${diff.toFixed(1)} vs attendu)`);
});

// ── 5. TRIPLETS ──
console.log(title('5. TRIPLETS REMARQUABLES'));
console.log(`  Attendu théorique : ${EXP_TRIPLET.toFixed(1)} fois par triplet\n`);

const sortedTriplets = Object.entries(triplets).sort((a, b) => b[1] - a[1]);
console.log('  TOP 20 triplets les plus fréquents :');
sortedTriplets.slice(0, 20).forEach(([trip, count], i) => {
  const diff = count - EXP_TRIPLET;
  console.log(`  ${String(i+1).padStart(2)}. (${trip.padEnd(12)}) → ${count} fois  (+${diff.toFixed(1)})`);
});

// ── 6. QUADRUPLETS ──
console.log(title('6. QUADRUPLETS REMARQUABLES'));
console.log(`  Attendu théorique : ${EXP_QUADRUPLET.toFixed(1)} fois par quadruplet\n`);

const sortedQuads = Object.entries(quadruplets).sort((a, b) => b[1] - a[1]);
console.log('  TOP 15 quadruplets les plus fréquents :');
sortedQuads.slice(0, 15).forEach(([quad, count], i) => {
  const diff = count - EXP_QUADRUPLET;
  console.log(`  ${String(i+1).padStart(2)}. (${quad.padEnd(15)}) → ${count} fois  (+${diff.toFixed(1)})`);
});

// ── 7. LETTRES ──
console.log(title('7. STATISTIQUES DES LETTRES'));
const expLettre = N_TIRAGES / 6;
console.log(`  Attendu théorique : ${expLettre.toFixed(1)} fois par lettre\n`);

console.log('  Fréquence globale :');
const maxLF = Math.max(...LETTRES.map(l => freqLettre[l]));
LETTRES.sort((a, b) => freqLettre[b] - freqLettre[a]).forEach(l => {
  const f    = freqLettre[l];
  const diff = f - expLettre;
  const sign = diff >= 0 ? '+' : '';
  console.log(`  ${l}: ${String(f).padStart(3)} fois  ${bar(f, maxLF)}  ${sign}${diff.toFixed(1)}`);
});

console.log('\n  Fréquence par heure de tirage :');
process.stdout.write('  Lettre |');
HOURS.forEach(h => process.stdout.write(` ${h.padEnd(4)} |`));
console.log();
console.log('  ' + '-'.repeat(63));
LETTRES.forEach(l => {
  process.stdout.write(`    ${l}    |`);
  HOURS.forEach(h => {
    const cnt = freqLettreHeure[l][h];
    process.stdout.write(`  ${String(cnt).padStart(2)}   |`);
  });
  console.log();
});

console.log('\n  Fréquence par niveau jackpot :');
LETTRES.forEach(l => {
  const bas  = freqLettreJackpot[l].bas;
  const haut = freqLettreJackpot[l].haut;
  const total = bas + haut;
  const pHaut = total > 0 ? (haut/total*100).toFixed(0) : '0';
  console.log(`  ${l}: jackpot bas=${String(bas).padStart(3)}  jackpot ≥500K=${String(haut).padStart(2)}  (${pHaut}% sur gros jackpots)`);
});

console.log(`\n  Tendance récente (${RECENT} derniers tirages) :`);
const expLR = RECENT / 6;
LETTRES.sort((a, b) => freqLettreRecente[b] - freqLettreRecente[a]).forEach(l => {
  const f    = freqLettreRecente[l];
  const diff = f - expLR;
  const sign = diff >= 0 ? '+' : '';
  const flag = diff < -1.5 ? ' ← À JOUER' : '';
  console.log(`  ${l}: ${f} fois (${sign}${diff.toFixed(1)})${flag}`);
});

// ── 8. ZONES ──
console.log(title('8. ZONES DE NUMÉROS'));
console.log(`  Zones : Bas (1-8) | Milieu (9-17) | Haut (18-25)\n`);
console.log(`  Attendu   : Bas=${expZone.bas.toFixed(1)}  Milieu=${expZone.mid.toFixed(1)}  Haut=${expZone.haut.toFixed(1)}`);
console.log(`  Observé   : Bas=${avgZone.bas.toFixed(2)}  Milieu=${avgZone.mid.toFixed(2)}  Haut=${avgZone.haut.toFixed(2)}`);
console.log(`  Écart     : Bas=${(avgZone.bas-expZone.bas).toFixed(2)}  Milieu=${(avgZone.mid-expZone.mid).toFixed(2)}  Haut=${(avgZone.haut-expZone.haut).toFixed(2)}\n`);

// Distribution des répartitions de zones
const zoneDistrib = {};
zones.forEach(z => {
  const key = `${z.bas}-${z.mid}-${z.haut}`;
  zoneDistrib[key] = (zoneDistrib[key] || 0) + 1;
});
const topZones = Object.entries(zoneDistrib).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('  Répartitions Bas-Milieu-Haut les plus fréquentes :');
topZones.forEach(([key, cnt]) => {
  console.log(`  [${key}] → ${cnt} tirages (${pct(cnt, N_TIRAGES)})`);
});

// ── 9. SOMME ──
console.log(title('9. SOMME DES 10 NUMÉROS PAR TIRAGE'));
console.log(`  Min: ${minSomme}  Max: ${maxSomme}  Moyenne: ${avgSomme.toFixed(1)}  σ: ${stdSomme.toFixed(1)}\n`);

const maxTranche = Math.max(...Object.values(tranchesSomme));
Object.entries(tranchesSomme).forEach(([tranche, cnt]) => {
  console.log(`  ${tranche.padEnd(8)}: ${String(cnt).padStart(3)} tirages  ${bar(cnt, maxTranche)}`);
});

// Tirages extrêmes
const sorted_s = [...sommes.entries()].sort((a,b) => a[1]-b[1]);
console.log('\n  3 tirages avec la somme la plus basse :');
sorted_s.slice(0,3).forEach(([i, s]) => {
  console.log(`  ${tirages[i].date} ${tirages[i].heure}: somme=${s}  nums=[${tirages[i].nums.join(',')}]`);
});
console.log('  3 tirages avec la somme la plus haute :');
sorted_s.slice(-3).reverse().forEach(([i, s]) => {
  console.log(`  ${tirages[i].date} ${tirages[i].heure}: somme=${s}  nums=[${tirages[i].nums.join(',')}]`);
});

// ── 10. NUMÉROS CONSÉCUTIFS ──
console.log(title('10. NUMÉROS CONSÉCUTIFS PAR TIRAGE'));
console.log(`  Moyenne observée : ${avgConsec.toFixed(2)} paires consécutives par tirage`);
console.log(`  Attendu théorique: ~${(9*10*9/(25*24)).toFixed(2)}\n`);

console.log('  Distribution du nombre de paires consécutives :');
const maxDC = Math.max(...Object.values(distribConsec));
Object.entries(distribConsec).sort((a,b) => +a[0] - +b[0]).forEach(([nb, cnt]) => {
  console.log(`  ${nb} paires: ${String(cnt).padStart(3)} tirages  ${bar(cnt, maxDC)}`);
});

// Paires consécutives les plus fréquentes
const conseqPairs = {};
tirages.forEach(t => {
  const sorted = [...t.nums].sort((a,b) => a-b);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i+1] - sorted[i] === 1) {
      const key = `${sorted[i]}-${sorted[i+1]}`;
      conseqPairs[key] = (conseqPairs[key] || 0) + 1;
    }
  }
});
const topConseq = Object.entries(conseqPairs).sort((a,b) => b[1]-a[1]).slice(0, 10);
console.log('\n  Paires consécutives les plus fréquentes :');
topConseq.forEach(([pair, cnt]) => {
  console.log(`  (${pair.padEnd(5)}) : ${cnt} fois`);
});

// ── 11. CORRÉLATION LETTRE × NUMÉRO ──
console.log(title('11. CORRÉLATION LETTRE × NUMÉRO'));
console.log('  Top 5 numéros sur-représentés par lettre :\n');
LETTRES.forEach(l => {
  const exp = (freqLettre[l] * 10 / 25).toFixed(1);
  process.stdout.write(`  ${l} (exp=${exp}/num): `);
  topNumParLettre[l].forEach(({n, count, delta}) => {
    const sign = delta >= 0 ? '+' : '';
    process.stdout.write(`${n}(${sign}${delta.toFixed(0)}) `);
  });
  console.log();
});

// ── 12. SCORE GLOBAL ──
console.log(title('12. SCORE GLOBAL DE RECOMMANDATION'));
console.log('  (fréquence 30% + tendance récente 30% + force paires 25% + gap 15%)\n');

const sortedScores = [...NUMS].sort((a, b) => scores[b] - scores[a]);
const maxScore = scores[sortedScores[0]];

console.log('  RANG  NUM  SCORE  FREQ  RÉCENT  GAP  PAIRES');
console.log('  ' + '-'.repeat(55));
sortedScores.forEach((n, rank) => {
  const s       = (scores[n] * 100).toFixed(1);
  const f       = freq[n];
  const r       = freqRecent[n];
  const g       = gap[n];
  const p       = pairStrength[n];
  const flag    = rank < 10 ? ' ★' : '';
  console.log(
    `  ${String(rank+1).padStart(3)}.  ${String(n).padStart(2)}   ${s.padStart(5)}%   ${String(f).padStart(3)}    ${String(r).padStart(2)}    ${String(g).padStart(3)}   ${p}${flag}`
  );
});

// ── TOP 10 RECOMMANDÉS ──
console.log(sec('TOP 10 NUMÉROS RECOMMANDÉS (grille de base)'));
const top10 = sortedScores.slice(0, 10).sort((a, b) => a - b);
console.log(`  Grille suggérée : [${top10.join(' - ')}]`);

// Vérification équilibre zones
const top10Bas  = top10.filter(n => n <= 8).length;
const top10Mid  = top10.filter(n => n >= 9 && n <= 17).length;
const top10Haut = top10.filter(n => n >= 18).length;
const top10Sum  = top10.reduce((s, n) => s + n, 0);
console.log(`  Zones : Bas=${top10Bas} | Milieu=${top10Mid} | Haut=${top10Haut}`);
console.log(`  Somme : ${top10Sum} (optimum : 110-150)`);

// Lettre recommandée
const lettreRecommandee = LETTRES
  .sort((a, b) => freqLettreRecente[a] - freqLettreRecente[b])[0];
console.log(`  Lettre recommandée : ${lettreRecommandee} (moins fréquente sur ${RECENT} derniers tirages)`);

// ─── EXPORT JSON ──────────────────────────────────────────────
const stats = {
  meta: {
    generatedAt:  new Date().toISOString(),
    nbTirages:    N_TIRAGES,
    periode:      { debut: tirages[0].date, fin: tirages[N_TIRAGES-1].date },
  },
  frequences: Object.fromEntries(NUMS.map(n => [n, freq[n]])),
  freqAttendue: EXP_NUM,
  gaps: Object.fromEntries(NUMS.map(n => [n, gap[n]])),
  freqRecente: Object.fromEntries(NUMS.map(n => [n, freqRecent[n]])),
  scores: Object.fromEntries(NUMS.map(n => [n, +scores[n].toFixed(4)])),
  top10recommandes: top10,
  paires: {
    attendu: EXP_PAIRE,
    top20: sortedPaires.slice(0, 20).map(([p, c]) => ({ paire: p, count: c, delta: +(c - EXP_PAIRE).toFixed(1) })),
    bottom10: sortedPaires.slice(-10).map(([p, c]) => ({ paire: p, count: c, delta: +(c - EXP_PAIRE).toFixed(1) })),
  },
  triplets: {
    attendu: EXP_TRIPLET,
    top20: sortedTriplets.slice(0, 20).map(([t, c]) => ({ triplet: t, count: c, delta: +(c - EXP_TRIPLET).toFixed(1) })),
  },
  quadruplets: {
    attendu: EXP_QUADRUPLET,
    top15: sortedQuads.slice(0, 15).map(([q, c]) => ({ quad: q, count: c, delta: +(c - EXP_QUADRUPLET).toFixed(1) })),
  },
  lettres: {
    frequences: freqLettre,
    attendu: expLettre,
    parHeure: freqLettreHeure,
    parJackpot: freqLettreJackpot,
    recentes: freqLettreRecente,
    recommandee: lettreRecommandee,
  },
  zones: {
    moyenneObservee: avgZone,
    attendu: expZone,
    topRepartitions: topZones.map(([k, c]) => ({ zones: k, count: c })),
  },
  sommes: {
    min: minSomme, max: maxSomme, moyenne: +avgSomme.toFixed(1), ecartType: +stdSomme.toFixed(1),
    distribution: tranchesSomme,
  },
  consecutifs: {
    moyenneObservee: +avgConsec.toFixed(2),
    attenduTheorique: +(9*10*9/(25*24)).toFixed(2),
    distribution: distribConsec,
    topPaires: topConseq.map(([p, c]) => ({ paire: p, count: c })),
  },
  pairStrength: Object.fromEntries(NUMS.map(n => [n, pairStrength[n]])),
};

fs.writeFileSync('crescendo_stats.json', JSON.stringify(stats, null, 2), 'utf8');
console.log('\n' + line('═'));
console.log(`✅ crescendo_stats.json sauvegardé (utilisé par l'algorithme de grilles)`);
console.log(line('═') + '\n');
