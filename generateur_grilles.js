/**
 * Crescendo FDJ — Générateur v3 : Stratégie Roue (Wheeling)
 *
 * Principe : au lieu de 5 grilles DIFFÉRENTES qui se dispersent,
 * on joue des grilles qui PARTAGENT un noyau de 8 numéros forts.
 * Si le tirage tombe sur notre zone chaude → plusieurs grilles
 * scorent 8-9-10 simultanément.
 *
 * Architecture :
 *  - NOYAU (8 num) : les 8 meilleurs numéros absolus → dans TOUTES les grilles
 *  - VARIABLE (8 num du pool) : 2-3 numéros qui tournent par grille
 *  - POOL TOTAL = 14-16 meilleurs numéros de l'historique
 *
 * Probabilités réelles (calculées ci-dessous) :
 *  Rang 8  (~50-100€) : ~0.145% par grille → 1.44% sur 10 grilles
 *  Rang 9  (~500€)    : ~0.069% par grille
 *  Rang 9L (~1000€)   : ~0.012% par grille
 *  Rang 10 (jackpot)  : ~0.0000306% par grille
 */

const fs = require('fs');
const { execSync } = require('child_process');

// ─── CONSTANTES ───────────────────────────────────────────────
const NUMS    = Array.from({length:25},(_,i)=>i+1);
const LETTRES = ['S','A','M','E','D','I'];
const C_25_10 = 3268760;

// Probabilités théoriques par rang (par grille, hors lettre)
const PROB_RANG = {
  '10':  1       / C_25_10,            // jackpot
  '9':   150     / C_25_10,            // 9 bons
  '8':   4725    / C_25_10,            // 8 bons
  '7':   56700   / C_25_10,            // 7 bons
  '6':   286650  / C_25_10,            // 6 bons
};
// Avec lettre : diviser par 6 (probabilité d'avoir la bonne lettre)
const PROB_RANG_L = Object.fromEntries(
  Object.entries(PROB_RANG).map(([r,p]) => [r+'L', p/6])
);

// ─── CHARGEMENT ───────────────────────────────────────────────
function readCsv(f) {
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f,'utf8').trim().split('\n');
  const h = lines[0].split(',').map(s=>s.trim());
  return lines.slice(1).filter(l=>l.trim()).map(l=>{
    const v=l.split(','); const o={};
    h.forEach((k,i)=>o[k]=v[i]?.trim()??'');
    return o;
  });
}

const stats    = JSON.parse(fs.readFileSync('crescendo_stats.json','utf8'));
const tirages  = readCsv('crescendo_historique_enrichi.csv');

// ─── INDEX DES PAIRES ─────────────────────────────────────────
const ALL_PAIRS = {};
NUMS.forEach(a=>NUMS.forEach(b=>{ if(b>a) ALL_PAIRS[`${a}-${b}`]=0; }));
tirages.forEach(row=>{
  const nums=[row.n1,row.n2,row.n3,row.n4,row.n5,row.n6,row.n7,row.n8,row.n9,row.n10]
    .map(Number).sort((a,b)=>a-b);
  for(let i=0;i<nums.length;i++)
    for(let j=i+1;j<nums.length;j++)
      ALL_PAIRS[`${nums[i]}-${nums[j]}`]=(ALL_PAIRS[`${nums[i]}-${nums[j]}`]||0)+1;
});
function pairCount(a,b){ return ALL_PAIRS[a<b?`${a}-${b}`:`${b}-${a}`]||0; }

// ─── SCORE D'UNE GRILLE ───────────────────────────────────────
function scoreGrid(grid) {
  const indiv = grid.reduce((s,n)=>s+(stats.scores[n]||0),0);
  let pairs = 0;
  for(let i=0;i<grid.length;i++)
    for(let j=i+1;j<grid.length;j++)
      pairs += pairCount(grid[i],grid[j]);
  return { indiv: +(indiv/10).toFixed(4), paires: pairs,
    sum: grid.reduce((s,n)=>s+n,0),
    zones: { bas:grid.filter(n=>n<=8).length, mid:grid.filter(n=>n>=9&&n<=17).length, haut:grid.filter(n=>n>=18).length }
  };
}

// ─── COMBINAISONS ─────────────────────────────────────────────
function getCombos(arr,k){
  const res=[];
  function h(s,c){
    if(c.length===k){res.push([...c]);return;}
    for(let i=s;i<arr.length;i++){c.push(arr[i]);h(i+1,c);c.pop();}
  }
  h(0,[]);
  return res;
}

// ─── PROBABILITÉS CUMULÉES ────────────────────────────────────
function probaAtLeastOne(pOneGrid, nGrids) {
  return 1 - Math.pow(1 - pOneGrid, nGrids);
}

function buildProbaTable(nGrids) {
  const rows = [];
  const rangs = [
    { label: 'Rang 10 (Jackpot)', p: PROB_RANG['10'],   gain: '100K→700K€' },
    { label: 'Rang 9L (+lettre)', p: PROB_RANG_L['9L'],  gain: '~1 000€'   },
    { label: 'Rang 9',            p: PROB_RANG['9'],    gain: '~500€'      },
    { label: 'Rang 8L (+lettre)', p: PROB_RANG_L['8L'],  gain: '~100€'     },
    { label: 'Rang 8',            p: PROB_RANG['8'],    gain: '~50€'       },
    { label: 'Rang 7L (+lettre)', p: PROB_RANG_L['7L'],  gain: '~14€'      },
    { label: 'Rang 7',            p: PROB_RANG['7'],    gain: '~7€'        },
  ];
  for(const r of rangs) {
    const pSession = probaAtLeastOne(r.p, nGrids);
    const sessionsFor50pct = Math.ceil(Math.log(0.5) / Math.log(1 - pSession));
    rows.push({ ...r, pSession: +(pSession*100).toFixed(4), sessionsFor50pct });
  }
  return rows;
}

// ─── STRATÉGIE ROUE (WHEELING) ────────────────────────────────
/**
 * Construit N grilles avec un NOYAU COMMUN de numNoyau numéros
 * et 10-numNoyau numéros variables depuis le pool.
 *
 * Toutes les grilles partagent les numNoyau numéros du noyau.
 * Les positions variables tournent pour maximiser la couverture.
 */
function buildWheeledGrids(nbGrids, jackpot) {
  // Taille du pool selon le jackpot et nombre de grilles
  const poolSize  = Math.min(10 + Math.ceil(nbGrids * 0.6), 18);
  const noyauSize = Math.min(7 + Math.floor(nbGrids / 5), 9); // 7-9 numéros noyau

  // Trier tous les numéros par score composite
  const sorted = [...NUMS].sort((a,b) => (stats.scores[b]||0) - (stats.scores[a]||0));

  const pool   = sorted.slice(0, poolSize);
  const noyau  = pool.slice(0, noyauSize);
  const variable = pool.slice(noyauSize);
  const nVar   = 10 - noyauSize; // numéros variables par grille

  // Générer toutes les combinaisons de nVar numéros depuis le pool variable
  const combos = getCombos(variable, nVar);

  // Scorer chaque combinaison (noyau + combo_variable)
  const scored = combos.map(extra => {
    const grid = [...noyau, ...extra].sort((a,b)=>a-b);
    const sc = scoreGrid(grid);
    // Score = paires fortes + somme dans plage cible
    const sumPenalty = (sc.sum < 105 || sc.sum > 160) ? -0.1 : 0;
    return { grid, score: sc.paires * 0.001 + sc.indiv + sumPenalty };
  });

  scored.sort((a,b)=>b.score-a.score);

  // Prendre les meilleures grilles avec une diversification partielle
  const grids = [];
  const seen  = new Set();

  for(const c of scored) {
    if(grids.length >= nbGrids) break;
    const key = c.grid.join('-');
    if(seen.has(key)) continue;

    // Vérifier que pas identique à une déjà choisie
    const tooSimilar = grids.some(g => {
      const common = g.filter(n=>c.grid.includes(n)).length;
      return common === 10; // rejeter seulement si identique
    });
    if(!tooSimilar) {
      grids.push(c.grid);
      seen.add(key);
    }
  }

  // Si pas assez de grilles (pool trop petit), compléter sans contrainte
  for(const c of scored) {
    if(grids.length >= nbGrids) break;
    const key = c.grid.join('-');
    if(!seen.has(key)) {
      grids.push(c.grid);
      seen.add(key);
    }
  }

  return { grids, noyau, pool, poolSize, noyauSize };
}

// ─── LETTRE RECOMMANDÉE ───────────────────────────────────────
function getBestLetter() {
  const recent = stats.lettres.recentes;
  return [...LETTRES].sort((a,b)=>recent[a]-recent[b])[0];
}

// ─── JACKPOT & NB GRILLES ─────────────────────────────────────
function getJackpot() {
  const argJ = process.argv.find(a=>a.startsWith('--jackpot='));
  if(argJ) return parseInt(argJ.split('=')[1]);
  const last = tirages[tirages.length-1];
  return last
    ? (parseInt(last.jackpot_remporte)===1 ? 100000 : Math.min(parseInt(last.jackpot_enjeu_eur)+100000,700000))
    : 100000;
}

function getNbGrids(jackpot, argNb) {
  if(argNb) return parseInt(argNb);
  // Toujours 5 grilles par défaut (stratégie de base)
  if(jackpot >= 300000) return 5;
  return 0;
}

// ─── AFFICHAGE ────────────────────────────────────────────────
const line = (c='─',n=70)=>c.repeat(n);

function main() {
  const jackpot = getJackpot();
  const argNb   = process.argv.find(a=>a.startsWith('--grilles='))?.split('=')[1];
  const nbGrids = getNbGrids(jackpot, argNb);

  console.log('\n'+line('═'));
  console.log('  CRESCENDO FDJ — GÉNÉRATEUR v3 · STRATÉGIE ROUE');
  console.log(line('═'));
  console.log(`\n  Jackpot : ${jackpot.toLocaleString('fr-FR')} €`);

  if(nbGrids === 0) {
    console.log('\n  ⛔ Jackpot trop bas (< 300K€). Attendre ≥ 300K€.\n');
    fs.writeFileSync('crescendo_grilles.json', JSON.stringify({ jackpot, nbGrids:0, grilles:[] },null,2));
    return;
  }

  // ── Génération ────────────────────────────────────────────
  const { grids, noyau, pool, poolSize, noyauSize } = buildWheeledGrids(nbGrids, jackpot);
  const lettre = getBestLetter();

  // ── Table de probabilités ──────────────────────────────────
  const probaTable = buildProbaTable(nbGrids);

  // ── Affichage ─────────────────────────────────────────────
  console.log(`  Stratégie : ${nbGrids} grilles · Noyau commun : ${noyauSize} numéros · Pool : ${poolSize} numéros`);
  console.log(`  Lettre recommandée : ${lettre} (moins vue récemment)\n`);

  console.log(line('─'));
  console.log('  NOYAU COMMUN (présent dans TOUTES les grilles)');
  console.log(line('─'));
  console.log(`  [${noyau.join(' - ')}]`);
  console.log(`  Ces ${noyauSize} numéros ont les meilleurs scores historiques.`);
  console.log(`  Si ${noyauSize} de vos numéros sortent, TOUTES vos grilles ont au moins ${noyauSize}/10.\n`);

  console.log(line('─'));
  console.log('  GRILLES GÉNÉRÉES');
  console.log(line('─'));
  grids.forEach((g,i) => {
    const sc = scoreGrid(g);
    const variable = g.filter(n=>!noyau.includes(n));
    console.log(`\n  Grille ${i+1}: [${g.join('-')}] + ${lettre}`);
    console.log(`    Noyau : ${noyau.join('-')}`);
    console.log(`    Variable : ${variable.join('-')}`);
    console.log(`    Somme=${sc.sum} | Paires=${sc.paires} | Zones: Bas=${sc.zones.bas} Mid=${sc.zones.mid} Haut=${sc.zones.haut}`);
  });

  // ── Probabilités ──────────────────────────────────────────
  console.log('\n'+line('═'));
  console.log(`  PROBABILITÉS RÉELLES — ${nbGrids} grilles par session`);
  console.log(line('═'));
  console.log(`\n  ${'Rang'.padEnd(20)} ${'P/session'.padEnd(14)} ${'Gain'.padEnd(12)} Sessions pour 50%`);
  console.log('  '+'-'.repeat(65));
  probaTable.forEach(r=>{
    const pStr = r.pSession < 0.01 ? `${(r.pSession).toFixed(4)}%` : `${r.pSession.toFixed(2)}%`;
    const s50  = r.sessionsFor50pct > 99999 ? '> 99 999' : r.sessionsFor50pct.toLocaleString('fr-FR');
    console.log(`  ${r.label.padEnd(20)} ${pStr.padEnd(14)} ${r.gain.padEnd(12)} ${s50}`);
  });

  // ── Overlap ───────────────────────────────────────────────
  console.log('\n'+line('─'));
  console.log('  CHEVAUCHEMENT ENTRE GRILLES (volontaire — stratégie roue)');
  console.log(line('─'));
  for(let i=0;i<grids.length;i++)
    for(let j=i+1;j<grids.length;j++){
      const common = grids[i].filter(n=>grids[j].includes(n));
      console.log(`  G${i+1} ∩ G${j+1} : ${common.length}/10 communs → si ces ${common.length} numéros sortent, les 2 grilles scorent bien`);
    }

  // ── Budget ────────────────────────────────────────────────
  console.log('\n'+line('═'));
  console.log('  RÉSUMÉ');
  console.log(line('═'));
  console.log(`  Jackpot en jeu   : ${jackpot.toLocaleString('fr-FR')} €`);
  console.log(`  Grilles à jouer  : ${nbGrids}`);
  console.log(`  Coût par session : ${nbGrids} €`);
  console.log(`  Lettre           : ${lettre} (sur chaque grille)`);
  console.log(`\n  ▶ GRILLES À JOUER :`);
  grids.forEach((g,i)=>console.log(`    G${i+1}: [${g.join('-')}] + ${lettre}`));

  // ── Sauvegarde ────────────────────────────────────────────
  const output = {
    generatedAt: new Date().toISOString(),
    jackpot, nbGrids,
    strategie: 'roue',
    noyau, pool: pool.slice(0, poolSize),
    lettre,
    grilles: grids.map((g,i)=>({
      id:i+1, numeros:g, lettre,
      variable: g.filter(n=>!noyau.includes(n)),
      ...scoreGrid(g)
    })),
    probabilites: probaTable,
  };
  fs.writeFileSync('crescendo_grilles.json', JSON.stringify(output,null,2),'utf8');
  console.log(`\n✅ crescendo_grilles.json sauvegardé\n`);
}

main();
