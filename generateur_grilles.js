/**
 * Crescendo FDJ — Générateur de grilles
 *
 * Algorithme en 5 couches :
 *  1. Condition jackpot (ne génère que si jackpot ≥ seuil)
 *  2. Construction greedy scorée (fréquence + paires + tendance + gap)
 *  3. Contraintes de forme (zones, somme, consécutifs)
 *  4. Diversification multi-grilles (max 4 numéros communs entre grilles)
 *  5. Choix de lettre + recommandation de mise
 *
 * Usage :
 *   node generateur_grilles.js                  → utilise le dernier tirage connu
 *   node generateur_grilles.js --jackpot 600000 → force un jackpot simulé
 *   node generateur_grilles.js --heure 17h      → pour l'heure indiquée
 */

const fs = require('fs');

// ─── CONFIG ───────────────────────────────────────────────────
const CFG = {
  // Seuils jackpot
  SEUIL_MIN:      300000,   // en dessous → ne pas jouer
  SEUIL_FEW:      500000,   // 3 grilles
  SEUIL_MAX:      700000,   // 5 grilles
  // Contraintes grille
  SUM_MIN:        108,
  SUM_MAX:        158,
  MAX_SHARED:     4,        // max numéros communs entre deux grilles
  MAX_CONSEQ:     5,        // max paires consécutives par grille
  // Pondération scoring
  W_FREQ:         0.30,
  W_RECENT:       0.30,
  W_PAIR:         0.25,
  W_GAP:          0.15,
  // Bonus paires fortes
  PAIR_STRONG_THR: 40,      // paire "forte" si > 40 co-occurrences
  PAIR_WEAK_THR:   25,      // paire "faible" si < 25
  PAIR_BONUS:      0.12,    // bonus score si paire forte avec un voisin déjà choisi
  PAIR_PENALTY:   -0.08,    // pénalité si paire faible
};

const NUMS    = Array.from({length: 25}, (_, i) => i + 1);
const LETTRES = ['S','A','M','E','D','I'];
const HOURS   = ['13h','14h','15h','16h','17h','18h','19h'];

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

const stats    = JSON.parse(fs.readFileSync('crescendo_stats.json', 'utf8'));
const tirages  = loadCsv('crescendo_historique_enrichi.csv');

// ─── JACKPOT COURANT ──────────────────────────────────────────
function getJackpotCourant() {
  // Lire depuis les args CLI
  const argJ = process.argv.find(a => a.startsWith('--jackpot=') || a === '--jackpot');
  if (argJ) {
    const idx = process.argv.indexOf('--jackpot');
    const val = argJ.includes('=') ? argJ.split('=')[1] : process.argv[idx+1];
    return parseInt(val);
  }
  // Sinon déduire depuis le dernier tirage connu
  const last = tirages[tirages.length - 1];
  const lastJackpot  = parseInt(last.jackpot_enjeu_eur);
  const lastRemporte = parseInt(last.jackpot_remporte);
  // Le prochain jackpot = reset si remporté, sinon +100K
  return lastRemporte ? 100000 : Math.min(lastJackpot + 100000, 700000);
}

function getHeureCible() {
  const argH = process.argv.find(a => a.startsWith('--heure=') || a === '--heure');
  if (argH) {
    const idx = process.argv.indexOf('--heure');
    return argH.includes('=') ? argH.split('=')[1] : process.argv[idx+1];
  }
  return null;  // toutes les heures
}

// ─── STRUCTURES DE SCORING ────────────────────────────────────

// Index des paires depuis stats.json
const PAIR_IDX = {};
stats.paires.top20.forEach(p => { PAIR_IDX[p.paire] = p.count; });
// Reconstruire l'index complet depuis le CSV (les stats ne contiennent que top20/bottom10)
// → on recalcule depuis les tirages pour avoir toutes les paires
const ALL_PAIRS = {};
NUMS.forEach(a => NUMS.forEach(b => {
  if (b > a) ALL_PAIRS[`${a}-${b}`] = 0;
}));
tirages.forEach(row => {
  const nums = [row.n1,row.n2,row.n3,row.n4,row.n5,row.n6,row.n7,row.n8,row.n9,row.n10]
    .map(Number).sort((a,b) => a-b);
  for (let i = 0; i < nums.length; i++)
    for (let j = i+1; j < nums.length; j++)
      ALL_PAIRS[`${nums[i]}-${nums[j]}`]++;
});

function getPairCount(a, b) {
  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
  return ALL_PAIRS[key] || 0;
}

// Score de base normalisé [0,1] pour chaque numéro
const BASE_SCORES = stats.scores;
const maxBaseScore = Math.max(...Object.values(BASE_SCORES));

// ─── CALCUL DU SCORE MARGINAL ─────────────────────────────────
/**
 * Score marginal d'ajouter `num` à une grille en cours de construction.
 * Prend en compte :
 *  - score de base (fréquence, récent, gap, paire-globale)
 *  - bonus/malus paires avec les numéros déjà dans la grille
 *  - contrainte de zone (si déjà trop de nums dans cette zone → pénalité)
 *  - contrainte de somme (si addition dépasse le plafond → pénalité)
 */
function marginalScore(num, current, targetZones) {
  let score = BASE_SCORES[num] / maxBaseScore;

  // Bonus paires avec les numéros déjà sélectionnés
  for (const n of current) {
    const cnt = getPairCount(num, n);
    if (cnt >= CFG.PAIR_STRONG_THR) score += CFG.PAIR_BONUS;
    else if (cnt <= CFG.PAIR_WEAK_THR) score += CFG.PAIR_PENALTY;
  }

  // Zone
  const zone = num <= 8 ? 'bas' : num <= 17 ? 'mid' : 'haut';
  const currentZone = countZones(current);
  const remaining   = 10 - current.length;
  // Pénalité si cette zone est déjà sursaturée
  if (zone === 'bas'  && currentZone.bas  >= targetZones.bas  + 1) score -= 0.15;
  if (zone === 'mid'  && currentZone.mid  >= targetZones.mid  + 1) score -= 0.15;
  if (zone === 'haut' && currentZone.haut >= targetZones.haut + 1) score -= 0.15;

  // Pénalité si la somme s'emballe
  const currentSum = current.reduce((s, n) => s + n, 0);
  const projectedMax = currentSum + num + (remaining-1)*25;
  const projectedMin = currentSum + num + (remaining-1)*1;
  if (projectedMax < CFG.SUM_MIN || projectedMin > CFG.SUM_MAX) score -= 0.20;

  return score;
}

function countZones(nums) {
  return {
    bas:  nums.filter(n => n <= 8).length,
    mid:  nums.filter(n => n >= 9 && n <= 17).length,
    haut: nums.filter(n => n >= 18).length,
  };
}

// Compter les paires consécutives
function countConsecutive(nums) {
  const s = [...nums].sort((a,b) => a-b);
  let cnt = 0;
  for (let i = 0; i < s.length-1; i++) if (s[i+1]-s[i] === 1) cnt++;
  return cnt;
}

// ─── CONSTRUCTION D'UNE GRILLE ────────────────────────────────
/**
 * Construit une grille par sélection greedy.
 * @param {Set}    excluded    - numéros à exclure
 * @param {Array}  seeded      - numéros de départ imposés
 * @param {Object} zones       - répartition cible {bas, mid, haut}
 * @param {Object} usageCount  - nb de grilles existantes contenant chaque numéro
 */
function buildGrid(excluded = new Set(), seeded = [], zones = {bas:3, mid:4, haut:3}, usageCount = {}, existingGrids = []) {
  let current = seeded.filter(n => !excluded.has(n));
  const pool  = NUMS.filter(n => !excluded.has(n) && !current.includes(n));

  // Compléter jusqu'à 10 numéros
  while (current.length < 10) {
    let bestN     = null;
    let bestScore = -Infinity;

    for (const n of pool.filter(x => !current.includes(x))) {
      // Bloquer dur si ce numéro pousserait l'overlap > MAX_SHARED avec une grille existante
      const wouldViolate = existingGrids.some(g => {
        const currentOvlp = overlap(current, g);
        const nInG        = g.includes(n);
        return nInG && currentOvlp >= CFG.MAX_SHARED;
      });
      if (wouldViolate) continue;

      let s = marginalScore(n, current, zones);
      // Pénaliser les numéros déjà présents dans des grilles existantes
      const used = usageCount[n] || 0;
      if (used === 1) s *= 0.70;
      else if (used >= 2) s *= 0.45;
      if (s > bestScore) { bestScore = s; bestN = n; }
    }
    if (!bestN) break;
    current.push(bestN);
  }

  if (current.length < 10) return null;

  // Post-traitement : ajuster la somme si hors plage
  current = adjustSum(current, excluded);

  return current.sort((a,b) => a-b);
}

/**
 * Ajuste la somme d'une grille par échange ciblé.
 */
function adjustSum(grid, excluded) {
  let g = [...grid];
  let sum = g.reduce((s,n) => s+n, 0);
  const pool = NUMS.filter(n => !g.includes(n) && !excluded.has(n));

  // Trop élevée → remplacer le plus grand par un plus petit
  let iter = 0;
  while (sum > CFG.SUM_MAX && iter++ < 30) {
    const biggest = g[g.length-1];
    const smaller = pool
      .filter(n => n < biggest && !g.includes(n))
      .sort((a,b) => {
        const sA = marginalScore(a, g.filter(x=>x!==biggest), {bas:3,mid:4,haut:3});
        const sB = marginalScore(b, g.filter(x=>x!==biggest), {bas:3,mid:4,haut:3});
        return sB - sA;
      })[0];
    if (!smaller) break;
    g[g.indexOf(biggest)] = smaller;
    g = g.sort((a,b) => a-b);
    sum = g.reduce((s,n) => s+n, 0);
  }

  // Trop basse → remplacer le plus petit par un plus grand
  iter = 0;
  while (sum < CFG.SUM_MIN && iter++ < 30) {
    const smallest = g[0];
    const bigger = pool
      .filter(n => n > smallest && !g.includes(n))
      .sort((a,b) => {
        const sA = marginalScore(a, g.filter(x=>x!==smallest), {bas:3,mid:4,haut:3});
        const sB = marginalScore(b, g.filter(x=>x!==smallest), {bas:3,mid:4,haut:3});
        return sB - sA;
      })[0];
    if (!bigger) break;
    g[g.indexOf(smallest)] = bigger;
    g = g.sort((a,b) => a-b);
    sum = g.reduce((s,n) => s+n, 0);
  }

  return g;
}

// ─── SCORE D'UNE GRILLE COMPLÈTE ──────────────────────────────
function scoreGrid(grid) {
  // Score individuel
  const indiv = grid.reduce((s, n) => s + BASE_SCORES[n], 0);

  // Score paires
  let pairScore = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = i+1; j < grid.length; j++)
      pairScore += getPairCount(grid[i], grid[j]);

  // Normalisation
  return {
    indiv:    +(indiv / 10).toFixed(4),
    paires:   pairScore,
    zones:    countZones(grid),
    sum:      grid.reduce((s,n) => s+n, 0),
    conseq:   countConsecutive(grid),
  };
}

// ─── OVERLAP ──────────────────────────────────────────────────
function overlap(g1, g2) {
  return g1.filter(n => g2.includes(n)).length;
}

// ─── GÉNÉRATION MULTI-GRILLES ─────────────────────────────────
function generateGrids(nbGrids) {
  const grids   = [];
  const topTriplet = stats.triplets.top20[0].triplet.split('-').map(Number);

  // Grille 1 : base pure avec le meilleur triplet
  const g1 = buildGrid(new Set(), topTriplet, {bas:3, mid:4, haut:3});
  if (g1) grids.push(g1);

  // Grilles 2+ : diversification progressive
  const zoneVariants = [
    {bas:3, mid:3, haut:4},   // plus orientée haute zone
    {bas:4, mid:3, haut:3},   // plus orientée basse zone
    {bas:3, mid:4, haut:3},   // équilibrée
    {bas:2, mid:5, haut:3},   // focus milieu
    {bas:4, mid:4, haut:2},   // basse + milieu
    {bas:2, mid:4, haut:4},   // milieu + haute
  ];

  // Différents triplets de départ pour la diversification
  const altTriplets = stats.triplets.top20
    .slice(1, 10)
    .map(t => t.triplet.split('-').map(Number));

  let attempts = 0;
  while (grids.length < nbGrids && attempts < 800) {
    attempts++;
    const idx   = grids.length - 1;
    const zones = zoneVariants[idx % zoneVariants.length];

    // Compter les usages de chaque numéro dans les grilles déjà générées
    const usageCount = {};
    grids.forEach(g => g.forEach(n => usageCount[n] = (usageCount[n] || 0) + 1));

    // Seed : prendre en priorité les numéros NON présents dans les grilles existantes
    const freeNums = NUMS.filter(n => !usageCount[n]);
    // Si assez de numéros libres, démarrer avec 2-3 d'entre eux + 1 du top altTriplets
    let seedTrip;
    if (freeNums.length >= 3) {
      // Trier les libres par score décroissant et prendre les 3 meilleurs
      seedTrip = [...freeNums]
        .sort((a, b) => BASE_SCORES[b] - BASE_SCORES[a])
        .slice(0, 3);
    } else {
      // Plus de numéros libres : utiliser des numéros faiblement utilisés
      seedTrip = NUMS
        .filter(n => (usageCount[n] || 0) <= 1)
        .sort((a, b) => BASE_SCORES[b] - BASE_SCORES[a])
        .slice(0, 3);
    }

    // Exclure uniquement les numéros présents dans TOUTES les grilles
    const excluded = new Set(
      Object.entries(usageCount)
        .filter(([_, c]) => c >= grids.length)
        .map(([n]) => parseInt(n))
    );

    const candidate = buildGrid(excluded, seedTrip, zones, usageCount, grids);
    if (!candidate) continue;

    // Contrainte diversité
    const maxOvlp = Math.max(...grids.map(g => overlap(g, candidate)));
    if (maxOvlp > CFG.MAX_SHARED) continue;

    // Contraintes de forme
    const sc = scoreGrid(candidate);
    if (sc.sum < CFG.SUM_MIN || sc.sum > CFG.SUM_MAX) continue;
    if (sc.conseq > CFG.MAX_CONSEQ) continue;

    grids.push(candidate);
  }

  return grids;
}

// ─── LETTRE RECOMMANDÉE ───────────────────────────────────────
function getLetterRecommendation(nbGrids) {
  const recent = stats.lettres.recentes;
  const sorted = [...LETTRES].sort((a, b) => recent[a] - recent[b]);
  // Attribuer les lettres les moins fréquentes aux premières grilles
  return sorted.slice(0, nbGrids);
}

// ─── AFFICHAGE ────────────────────────────────────────────────
const line = (c='─', n=65) => c.repeat(n);

function displayGrids(jackpot, heureCible, nbGrids, grids, letters) {
  console.log('\n' + line('═'));
  console.log('  CRESCENDO FDJ — GÉNÉRATEUR DE GRILLES');
  console.log(line('═'));

  // ── Condition jackpot ──
  const bar = (j) => {
    const pct = (j - 100000) / 600000;
    const filled = Math.round(pct * 20);
    return '▓'.repeat(filled).padEnd(20, '░');
  };

  console.log(`\n  Jackpot estimé   : ${(jackpot/1000).toFixed(0)} 000 €  ${bar(jackpot)}`);

  if (jackpot < CFG.SEUIL_MIN) {
    console.log(`\n  ⛔ Jackpot < ${CFG.SEUIL_MIN/1000}K€ — Ne pas jouer ce tirage.`);
    console.log(`     Attendre un jackpot ≥ ${CFG.SEUIL_MIN/1000}K€ pour optimiser l'espérance de gain.\n`);
    return;
  }

  const reco = jackpot >= CFG.SEUIL_MAX
    ? `✅ Jackpot MAXIMUM (${jackpot/1000}K€) — Jouer ${nbGrids} grilles`
    : `✅ Jackpot élevé (${jackpot/1000}K€) — Jouer ${nbGrids} grilles`;
  console.log(`\n  ${reco}`);
  if (heureCible) console.log(`  Heure cible      : ${heureCible}`);

  console.log(`\n  Mise totale recommandée : ${nbGrids} €`);
  console.log(`  Probabilité jackpot/grille : 1 / 3 268 760 (0.0000306%)`);
  console.log(`  Probabilité rang 6+ /grille : ~8.8%  (au moins une grille : ${((1-(1-0.088)**nbGrids)*100).toFixed(0)}%)`);

  // ── Grilles ──
  console.log('\n' + line('─'));
  console.log('  GRILLES RECOMMANDÉES');
  console.log(line('─'));

  grids.forEach((grid, i) => {
    const sc  = scoreGrid(grid);
    const ltr = letters[i] || letters[letters.length - 1];
    const zones = sc.zones;
    const zoneStr = `Bas=${zones.bas} Mid=${zones.mid} Haut=${zones.haut}`;
    const sumFlag = sc.sum >= CFG.SUM_MIN && sc.sum <= CFG.SUM_MAX ? '✓' : '⚠';

    console.log(`\n  ┌─ GRILLE ${i+1} ─────────────────────────────────────────┐`);
    console.log(`  │  Numéros : ${grid.map(n => String(n).padStart(2)).join(' - ')}  │`);
    console.log(`  │  Lettre  : ${ltr}                                           │`);
    console.log(`  │  Zones   : ${zoneStr.padEnd(28)}  │`);
    console.log(`  │  Somme   : ${sc.sum} ${sumFlag}  │  Consécutifs : ${sc.conseq}  │  Score paires : ${sc.paires}  │`);
    console.log(`  └───────────────────────────────────────────────────────────┘`);

    // Justification des numéros choisis
    console.log(`  Pourquoi ces numéros :`);
    grid.forEach(n => {
      const f  = stats.frequences[n];
      const r  = stats.freqRecente[n];
      const g  = stats.gaps[n];
      const sc = (stats.scores[n] * 100).toFixed(0);
      const flag = f > 95 ? '🔥' : f < 80 ? '❄' : r > 10 ? '📈' : '';
      console.log(`    ${String(n).padStart(2)}: score=${sc}%  freq=${f}  récent=${r}  gap=${g} ${flag}`);
    });
  });

  // ── Overlap entre grilles ──
  if (grids.length > 1) {
    console.log('\n' + line('─'));
    console.log('  DIVERSIFICATION — Numéros communs entre grilles');
    console.log(line('─'));
    for (let i = 0; i < grids.length; i++) {
      for (let j = i+1; j < grids.length; j++) {
        const common = grids[i].filter(n => grids[j].includes(n));
        console.log(`  G${i+1} ∩ G${j+1} : ${common.length} communs [${common.join(', ')}]`);
      }
    }
  }

  // ── Lettre ──
  console.log('\n' + line('─'));
  console.log('  LETTRES — Analyse récente (20 derniers tirages)');
  console.log(line('─'));
  const recent = stats.lettres.recentes;
  const exp20  = 20/6;
  LETTRES.sort((a,b) => recent[a] - recent[b]).forEach((l, rank) => {
    const diff = recent[l] - exp20;
    const sign = diff >= 0 ? '+' : '';
    const arrow = rank === 0 ? ' ← RECOMMANDÉE' : rank <= 1 ? ' ← Possible' : '';
    console.log(`  ${l}: ${recent[l]}x (${sign}${diff.toFixed(1)})${arrow}`);
  });

  // ── Triplets de référence dans les grilles ──
  console.log('\n' + line('─'));
  console.log('  TRIPLETS FORTS PRÉSENTS DANS VOS GRILLES');
  console.log(line('─'));
  grids.forEach((grid, i) => {
    const found = [];
    stats.triplets.top20.slice(0, 10).forEach(t => {
      const nums = t.triplet.split('-').map(Number);
      if (nums.every(n => grid.includes(n))) {
        found.push(`(${t.triplet}) ${t.count}x`);
      }
    });
    if (found.length > 0) {
      console.log(`  G${i+1}: ${found.join('  |  ')}`);
    } else {
      console.log(`  G${i+1}: aucun top-10 triplet (grille diversifiée)`);
    }
  });

  // ── Résumé ──
  console.log('\n' + line('═'));
  console.log('  RÉSUMÉ DE LA MISE');
  console.log(line('═'));
  console.log(`  Jackpot en jeu   : ${jackpot.toLocaleString('fr-FR')} €`);
  console.log(`  Nombre de grilles: ${grids.length}`);
  console.log(`  Coût total       : ${grids.length} €`);
  console.log(`  Espérance/grille : ~${(jackpot/3268760).toFixed(3)} €  (pour 1 € misé)`);
  console.log(`  Espérance totale : ~${(grids.length * jackpot/3268760).toFixed(3)} €`);
  console.log();
  grids.forEach((g, i) => {
    console.log(`  ▶ Grille ${i+1}: ${g.join('-')} + ${letters[i]}`);
  });
  console.log();
}

// ─── MAIN ─────────────────────────────────────────────────────
function main() {
  const jackpot    = getJackpotCourant();
  const heureCible = getHeureCible();

  // Nombre de grilles selon le jackpot
  let nbGrids;
  if (jackpot < CFG.SEUIL_MIN)        nbGrids = 0;
  else if (jackpot < 400000)           nbGrids = 1;
  else if (jackpot < CFG.SEUIL_FEW)   nbGrids = 2;
  else if (jackpot < CFG.SEUIL_MAX)   nbGrids = 3;
  else                                 nbGrids = 5;

  if (nbGrids === 0) {
    displayGrids(jackpot, heureCible, 0, [], []);
    return;
  }

  const grids   = generateGrids(nbGrids);
  const letters = getLetterRecommendation(grids.length);

  displayGrids(jackpot, heureCible, grids.length, grids, letters);

  // Sauvegarder la recommandation
  const output = {
    generatedAt: new Date().toISOString(),
    jackpot,
    heureCible,
    nbGrids: grids.length,
    grilles: grids.map((g, i) => ({
      id: i + 1,
      numeros: g,
      lettre: letters[i],
      ...scoreGrid(g),
    })),
  };
  fs.writeFileSync('crescendo_grilles.json', JSON.stringify(output, null, 2), 'utf8');
  console.log('✅ crescendo_grilles.json sauvegardé\n');
}

main();
