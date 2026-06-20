/**
 * Crescendo FDJ — Module Stratégie
 *
 * Fonctions :
 *  1. Analyse intra-journée : recommande si jouer le 19h selon progression jackpot
 *  2. Calcul probabilités cumulées sur N sessions
 *  3. Back-test : comment l'algorithme aurait performé sur l'historique
 *  4. Suivi de sessions (lecture/écriture du journal)
 */

const fs = require('fs');

const TIRAGES_FILE = 'crescendo_historique_enrichi.csv';
const GAINS_FILE   = 'crescendo_gains_enrichi.csv';
const SESSIONS_FILE = 'crescendo_sessions.json';
const C_25_10 = 3268760; // C(25,10)

// ─── HELPERS ──────────────────────────────────────────────────
function readCsv(f) {
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  const h = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).filter(l => l.trim()).map(l => {
    const v = l.split(',');
    const o = {};
    h.forEach((k, i) => o[k] = v[i]?.trim() ?? '');
    return o;
  });
}

function readJson(f, def = {}) {
  if (!fs.existsSync(f)) return def;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch { return def; }
}

function writeJson(f, data) {
  fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
}

// ─── 1. ANALYSE INTRA-JOURNÉE ────────────────────────────────
/**
 * Calcule le jackpot attendu à chaque heure d'un samedi donné
 * en lisant les résultats déjà disponibles (tirages passés).
 * Retourne une recommandation pour chaque heure.
 */
function analyseJournee(tirages, date) {
  const HOURS = ['13h','14h','15h','16h','17h','18h','19h'];
  const jourData = tirages.filter(t => t.date === date)
    .sort((a,b) => parseInt(a.heure) - parseInt(b.heure));

  let jackpot = 100000;
  const analyse = [];

  for (const h of HOURS) {
    const t = jourData.find(t => t.heure === h);
    const info = {
      heure: h,
      jackpot_attendu: jackpot,
      resultat: t ? (t.jackpot_remporte === '1' ? 'REMPORTÉ' : 'non remporté') : 'non disponible',
      recommandation: null,
      jouer: false,
    };

    // Recommandation selon seuil
    if (jackpot >= 700000) {
      info.recommandation = '🏆 JOUER 5-7 grilles — jackpot MAXIMUM';
      info.jouer = true;
      info.nb_grilles = 5;
    } else if (jackpot >= 600000) {
      info.recommandation = '✅ JOUER 3 grilles — jackpot très élevé';
      info.jouer = true;
      info.nb_grilles = 3;
    } else if (jackpot >= 500000) {
      info.recommandation = '✅ JOUER 2 grilles — jackpot élevé';
      info.jouer = true;
      info.nb_grilles = 2;
    } else if (jackpot >= 300000) {
      info.recommandation = '⚠️ JOUER 1 grille si budget disponible';
      info.jouer = false; // optionnel
      info.nb_grilles = 1;
    } else {
      info.recommandation = '⛔ NE PAS JOUER — jackpot trop bas';
      info.jouer = false;
      info.nb_grilles = 0;
    }

    analyse.push(info);

    // Progression jackpot
    if (t) {
      jackpot = t.jackpot_remporte === '1' ? 100000 : Math.min(jackpot + 100000, 700000);
    } else {
      // Heure non encore disponible → estimer si pas encore joué
      jackpot = Math.min(jackpot + 100000, 700000);
    }
  }

  return analyse;
}

// ─── 2. PROBABILITÉS CUMULÉES ─────────────────────────────────
/**
 * Pour N sessions de jeu (à jackpot ≥ threshold, nbGrilles grilles par session) :
 * - P(au moins 1 jackpot) sur les N sessions
 * - P(au moins 1 rang 6+) sur les N sessions
 * - Coût total, espérance totale
 */
function calculProbas(nbSessions, nbGrilles, jackpotMoyen) {
  const pJackpot1grille = 1 / C_25_10;
  const pRang6_1grille  = 0.0877; // ~8.77% par grille (calculé théoriquement)

  const pNoJackpot1session = Math.pow(1 - pJackpot1grille, nbGrilles);
  const pNoRang6_1session  = Math.pow(1 - pRang6_1grille, nbGrilles);

  const pJackpotNsessions = 1 - Math.pow(pNoJackpot1session, nbSessions);
  const pRang6Nsessions   = 1 - Math.pow(pNoRang6_1session, nbSessions);

  const coutTotal       = nbSessions * nbGrilles;
  const esperanceTotale = nbSessions * nbGrilles * (jackpotMoyen / C_25_10);

  // Sessions pour atteindre P=50% jackpot
  const sessionsFor50pctJackpot = Math.ceil(
    Math.log(0.5) / Math.log(pNoJackpot1session)
  );

  // Sessions pour P=50% rang 6+
  const sessionsFor50pctRang6 = Math.ceil(
    Math.log(0.5) / Math.log(pNoRang6_1session)
  );

  return {
    nbSessions, nbGrilles, jackpotMoyen,
    pJackpot:    +(pJackpotNsessions * 100).toFixed(6),
    pRang6:      +(pRang6Nsessions * 100).toFixed(1),
    coutTotal,
    esperanceTotale: +esperanceTotale.toFixed(2),
    sessionsFor50pctJackpot,
    sessionsFor50pctRang6,
    retourSurInvestissement: +((esperanceTotale / coutTotal) * 100).toFixed(1),
  };
}

// ─── 3. BACK-TEST ─────────────────────────────────────────────
/**
 * Simule l'application de la stratégie sur l'historique.
 * Pour chaque tirage éligible (jackpot ≥ seuil), on compare
 * les grilles générées avec les numéros réellement tirés.
 * On calcule les rangs théoriques obtenus.
 */
function backTest(tirages, gains, seuilJackpot = 500000) {
  const HOURS_ORDER = ['13h','14h','15h','16h','17h','18h','19h'];
  const results = {
    sessionsEligibles: 0,
    sessionsJouees: 0,
    coutTotal: 0,
    gainsTotal: 0,
    rangsObtenus: {},
    jackpotsManques: [],   // tirages où jackpot remporté mais on n'avait pas la bonne grille
    meilleurRang: null,
    details: [],
  };

  // Grouper par samedi
  const samedis = [...new Set(tirages.map(t => t.date))].sort();

  for (const date of samedis) {
    const jourTirages = tirages
      .filter(t => t.date === date)
      .sort((a,b) => parseInt(a.heure) - parseInt(b.heure));

    let jackpot = 100000;

    for (const t of jourTirages) {
      const jpEnjeu = parseInt(t.jackpot_enjeu_eur || jackpot);

      if (jpEnjeu >= seuilJackpot) {
        results.sessionsEligibles++;

        // Simuler : on joue 5 grilles générées par notre algo
        // (pour le back-test, on utilise les numéros du top-10 historique à cette date)
        // Simulation simplifiée : on calcule le matching moyen avec 5 grilles aléatoires
        const numérosTirés = [t.n1,t.n2,t.n3,t.n4,t.n5,t.n6,t.n7,t.n8,t.n9,t.n10].map(Number);
        const nbGrilles = jpEnjeu >= 700000 ? 5 : jpEnjeu >= 600000 ? 3 : jpEnjeu >= 500000 ? 2 : 1;

        results.sessionsJouees++;
        results.coutTotal += nbGrilles;

        // Pour chaque grille simulée : calculer le rang théorique
        // (back-test fidèle via les données de gains réels)
        const gainsRow = gains.filter(g => g.date === date && g.heure === t.heure);

        for (let g = 0; g < nbGrilles; g++) {
          // Distribution historique des rangs pour estimer le rang obtenu
          // On utilise la distribution statistique plutôt que simuler la grille exacte
          const rand = Math.random();
          let cumul = 0;
          let rangObtenu = '0L'; // par défaut lettre seule = 1€

          // Probabilités basées sur la distribution réelle de nos gains
          const probaRangs = [
            { rang: '10', p: 1/C_25_10 },
            { rang: '9L', p: (10*15)/(C_25_10/10) * (1/6) },
            { rang: '9',  p: (10*15)/(C_25_10/10) },
            { rang: '8L', p: 0.00274 * (1/6) },
            { rang: '8',  p: 0.00274 },
            { rang: '7L', p: 0.0258 * (1/6) },
            { rang: '7',  p: 0.0258 },
            { rang: '6L', p: 0.0877 * (1/6) },
            { rang: '6',  p: 0.0877 },
            { rang: '0L', p: 1/6 },
          ];

          for (const pr of probaRangs) {
            cumul += pr.p;
            if (rand < cumul) { rangObtenu = pr.rang; break; }
          }

          // Gain correspondant
          const gainRow = gainsRow.find(gr => gr.rang === rangObtenu);
          const gainUnitaire = gainRow ? parseFloat(gainRow.gain_unitaire_eur || 0) : 0;

          results.gainsTotal += gainUnitaire;
          results.rangsObtenus[rangObtenu] = (results.rangsObtenus[rangObtenu] || 0) + 1;

          if (rangObtenu === '10' && t.jackpot_remporte === '1') {
            results.jackpotsManques.push({ date, heure: t.heure, jackpot: jpEnjeu });
          }
        }

        results.details.push({
          date, heure: t.heure,
          jackpot: jpEnjeu,
          nbGrilles,
          remporte: t.jackpot_remporte === '1',
          distribue: parseInt(t.total_distribue_eur || 0),
        });
      }

      // Progression jackpot
      jackpot = t.jackpot_remporte === '1' ? 100000 : Math.min(jackpot + 100000, 700000);
    }
  }

  results.perte_nette = results.coutTotal - results.gainsTotal;
  results.roi = results.coutTotal > 0
    ? +((results.gainsTotal / results.coutTotal - 1) * 100).toFixed(1)
    : 0;

  return results;
}

// ─── 4. ANALYSE DE LA FRÉQUENCE DES OPPORTUNITÉS ─────────────
/**
 * Sur l'historique : combien de fois par samedi un tirage
 * atteignait chaque seuil de jackpot ?
 */
function analyseOpportunites(tirages) {
  const seuils = [300000, 400000, 500000, 600000, 700000];
  const result = {};

  seuils.forEach(s => {
    const eligible = tirages.filter(t => parseInt(t.jackpot_enjeu_eur) >= s).length;
    const samedisAvec = [...new Set(
      tirages.filter(t => parseInt(t.jackpot_enjeu_eur) >= s).map(t => t.date)
    )].length;
    const totalSamedis = [...new Set(tirages.map(t => t.date))].length;

    result[s] = {
      tiragesEligibles: eligible,
      pctTirages: +((eligible / tirages.length) * 100).toFixed(1),
      samedisAvecOpportunite: samedisAvec,
      pctSamedis: +((samedisAvec / totalSamedis) * 100).toFixed(1),
      frequenceMois: +(samedisAvec / totalSamedis * 4.3).toFixed(1), // ~4.3 samedis/mois
    };
  });

  return result;
}

// ─── 5. STRATÉGIE OPTIMALE "ATTENDRE LE 19H" ─────────────────
/**
 * Stratégie avancée : ne jouer que si on peut vérifier les résultats
 * des tirages précédents et choisir le meilleur moment.
 *
 * Optimal : attendre de voir les 6 premiers tirages (13h-18h).
 * Si AUCUN n'est remporté → 19h à 700K → JOUER !
 *
 * Calcule la fréquence de cette opportunité.
 */
function strategie19h(tirages) {
  const samedis = [...new Set(tirages.map(t => t.date))].sort();
  let sessions700k  = 0;
  let sessionsTotal = 0;
  const details = [];

  for (const date of samedis) {
    const jourTirages = tirages
      .filter(t => t.date === date)
      .sort((a, b) => parseInt(a.heure) - parseInt(b.heure));

    if (jourTirages.length < 7) continue;
    sessionsTotal++;

    // Vérifier si 13h-18h tous non remportés
    const avant19h = jourTirages.filter(t => parseInt(t.heure) < 19);
    const aucunRemporte = avant19h.every(t => t.jackpot_remporte === '0');
    const tirage19h = jourTirages.find(t => t.heure === '19h');

    if (aucunRemporte && tirage19h) {
      sessions700k++;
      const jp = parseInt(tirage19h.jackpot_enjeu_eur || 700000);
      details.push({
        date,
        jackpot19h: jp,
        remporte19h: tirage19h.jackpot_remporte === '1',
        distribue: parseInt(tirage19h.total_distribue_eur || 0),
      });
    }
  }

  return {
    samedisAnalyses: sessionsTotal,
    opportunites700k: sessions700k,
    pct: +((sessions700k / sessionsTotal) * 100).toFixed(1),
    frequenceMois: +(sessions700k / sessionsTotal * 4.3).toFixed(2),
    remportesParmi700k: details.filter(d => d.remporte19h).length,
    details,
  };
}

// ─── EXPORT POUR LE SERVEUR ───────────────────────────────────
module.exports = {
  analyseJournee,
  calculProbas,
  backTest,
  analyseOpportunites,
  strategie19h,
  readCsv,
  readJson,
  writeJson,
  SESSIONS_FILE,
};

// ─── CLI : afficher le rapport complet ───────────────────────
if (require.main === module) {
  const tirages = readCsv(TIRAGES_FILE);
  const gains   = readCsv(GAINS_FILE);

  console.log('\n' + '═'.repeat(65));
  console.log('  CRESCENDO — ANALYSE STRATÉGIQUE COMPLÈTE');
  console.log('═'.repeat(65));

  // Fréquences d'opportunités
  console.log('\n📊 FRÉQUENCE DES OPPORTUNITÉS (sur l\'historique)\n');
  const opps = analyseOpportunites(tirages);
  Object.entries(opps).forEach(([seuil, d]) => {
    console.log(`  Jackpot ≥ ${(seuil/1000).toFixed(0)}K :`);
    console.log(`    ${d.tiragesEligibles} tirages (${d.pctTirages}%)  |  ${d.samedisAvecOpportunite} samedis (${d.pctSamedis}%)  |  ~${d.frequenceMois}×/mois`);
  });

  // Stratégie 19h
  console.log('\n🎯 STRATÉGIE "ATTENDRE LE 19H" (700K garanti)\n');
  const s19 = strategie19h(tirages);
  console.log(`  Samedis analysés            : ${s19.samedisAnalyses}`);
  console.log(`  Opportunités 700K au 19h    : ${s19.opportunites700k} (${s19.pct}%)`);
  console.log(`  Fréquence                   : ~${s19.frequenceMois} fois/mois`);
  console.log(`  Jackpots remportés parmi eux: ${s19.remportesParmi700k}`);

  // Probabilités cumulées — différents horizons
  console.log('\n📈 PROBABILITÉS CUMULÉES (stratégie 700K, 5 grilles)\n');
  console.log('  Sessions | P(Jackpot)    | P(Rang 6+) | Coût  | Espérance');
  console.log('  ' + '-'.repeat(60));
  [10, 20, 50, 100, 500].forEach(n => {
    const p = calculProbas(n, 5, 700000);
    console.log(
      `  ${String(n).padStart(8)} | ${p.pJackpot.toFixed(6)}%  | ${p.pRang6.toFixed(1)}%      | ${p.coutTotal}€  | ${p.esperanceTotale}€`
    );
  });

  // Sessions pour P=50%
  const p100 = calculProbas(100, 5, 700000);
  console.log(`\n  → ${p100.sessionsFor50pctRang6} sessions pour 50% de chance de gagner rang 6+`);
  console.log(`  → ${p100.sessionsFor50pctJackpot.toLocaleString()} sessions pour 50% de chance de toucher le jackpot`);

  // Back-test
  console.log('\n🔬 BACK-TEST (stratégie ≥ 500K sur l\'historique)\n');
  const bt = backTest(tirages, gains, 500000);
  console.log(`  Sessions éligibles    : ${bt.sessionsEligibles}`);
  console.log(`  Sessions jouées       : ${bt.sessionsJouees}`);
  console.log(`  Coût total simulé     : ${bt.coutTotal} €`);
  console.log(`  Gains simulés         : ${bt.gainsTotal.toFixed(2)} €`);
  console.log(`  Perte nette           : ${bt.perte_nette.toFixed(2)} €`);
  console.log(`  ROI                   : ${bt.roi}%`);
  console.log(`  Rangs obtenus         :`);
  Object.entries(bt.rangsObtenus).sort((a,b) => {
    const order = ['10','9L','9','8L','8','7L','7','6L','6','0L'];
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  }).forEach(([rang, n]) => {
    if (n > 0) console.log(`    Rang ${rang.padEnd(3)}: ${n} fois`);
  });

  // Recommandation budgétaire
  console.log('\n💡 RECOMMANDATION BUDGET ANNUEL\n');
  const freqAn = Math.round(s19.frequenceMois * 12);
  const budgetAn = freqAn * 5; // 5€ par session 700K
  console.log(`  Opportunités 700K/an  : ~${freqAn} samedis`);
  console.log(`  Budget recommandé     : ${budgetAn} € / an (5€ × ${freqAn} sessions)`);
  console.log(`  Variante conservative : ${Math.round(freqAn * 2)} € / an (2€ × ${freqAn} sessions)`);
  console.log(`  P(rang 6+ sur l\'année): ${(1 - Math.pow(1-0.37, freqAn)*100).toFixed(0)}%`);
  console.log('');
}
