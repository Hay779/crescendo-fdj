/**
 * Crescendo FDJ — Enrichissement des CSV existants
 *
 * Dérivations purement calculées (0 scraping) :
 *
 * 1. jackpot_enjeu_eur : le montant mis en jeu à chaque tirage
 *    Logique Crescendo :
 *      - 13h démarre toujours à 100 000 €
 *      - si le tirage précédent a été remporté → reset à 100 000 €
 *      - sinon → +100 000 €
 *    Vérification : si le rang 10 a des gagnants, gain_unitaire = jackpot_enjeu ✓
 *
 * 2. jackpot_remporte : 0/1 (rang 10 nb_gagnants > 0)
 *
 * 3. gain_total_eur : nb_gagnants × gain_unitaire_eur (par rang)
 *
 * 4. total_distribue_eur : somme des gain_total de tous les rangs (par tirage)
 *
 * Sorties :
 *   crescendo_historique.csv  → +jackpot_enjeu_eur, +jackpot_remporte, +total_distribue_eur
 *   crescendo_gains.csv       → +gain_total_eur
 *   crescendo_resume.csv      → vue agrégée par tirage (1 ligne = 1 tirage)
 */

const fs = require('fs');

const HOURS = ['13h','14h','15h','16h','17h','18h','19h'];
const RANK_CODES = ['10','9L','9','8L','8','7L','7','6L','6','0L'];

// ─── LECTURE CSV ──────────────────────────────────────────────
function readCsv(path) {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = vals[i]?.trim() ?? ''; });
    return obj;
  });
}

function writeCsv(path, rows) {
  if (rows.length === 0) { fs.writeFileSync(path, '', 'utf8'); return; }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => r[h] ?? '').join(','))];
  fs.writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

// ─── TRI CHRONOLOGIQUE ────────────────────────────────────────
function sortKey(dateStr, heure) {
  const [d, m, y] = dateStr.split('/');
  return `${y}${m}${d}_${String(parseInt(heure)).padStart(2,'0')}`;
}

// ─── MAIN ─────────────────────────────────────────────────────
function main() {
  console.log('\n' + '═'.repeat(65));
  console.log('  CRESCENDO FDJ — Enrichissement');
  console.log('═'.repeat(65) + '\n');

  // Charger les deux fichiers
  const historique = readCsv('crescendo_historique.csv');
  const gains      = readCsv('crescendo_gains.csv');

  console.log(`Chargé: ${historique.length} tirages, ${gains.length} lignes de gains\n`);

  // ── ÉTAPE 1 : indexer les gains par (date, heure, rang) ──
  const gainsIdx = {};  // key = "date|heure|rang" → row
  const byTirage = {};  // key = "date|heure" → array of rank rows
  for (const g of gains) {
    const k = `${g.date}|${g.heure}|${g.rang}`;
    gainsIdx[k] = g;
    const t = `${g.date}|${g.heure}`;
    if (!byTirage[t]) byTirage[t] = [];
    byTirage[t].push(g);
  }

  // ── ÉTAPE 2 : calculer jackpot_enjeu + gain_total ─────────
  // Regrouper l'historique par samedi pour le calcul progressif
  const parSamedi = {};
  for (const h of historique) {
    if (!parSamedi[h.date]) parSamedi[h.date] = {};
    parSamedi[h.date][h.heure] = h;
  }

  // Méta-données par tirage
  const meta = {};  // key = "date|heure"

  let anomalies = 0;

  for (const date of Object.keys(parSamedi).sort()) {
    let jackpot = 100000;  // démarre toujours à 100 000 € pour le 13h

    for (const heure of HOURS) {
      const tirageKey = `${date}|${heure}`;

      // Rang 10 pour ce tirage
      const rank10 = gainsIdx[`${date}|${heure}|10`];
      const remporte = rank10 ? (parseInt(rank10.nb_gagnants) > 0 ? 1 : 0) : null;

      // Vérification de cohérence : si remporté, nb×gain = jackpot
      // (plusieurs gagnants peuvent se partager le jackpot)
      if (rank10 && remporte === 1) {
        const nb      = parseInt(rank10.nb_gagnants);
        const gainR10 = parseFloat(rank10.gain_unitaire_eur);
        const totalR10 = nb * gainR10;
        if (Math.abs(totalR10 - jackpot) > 1) {
          console.log(`  ⚠ Cohérence ${date} ${heure}: jackpot dérivé=${jackpot}€, nb×gain=${nb}×${gainR10}=${totalR10}€`);
          anomalies++;
          jackpot = totalR10;   // faire confiance aux données réelles
        }
      }

      // Calculer gain_total par rang et total_distribue
      const rowsForTirage = byTirage[tirageKey] || [];
      let totalDistribue = 0;

      for (const g of rowsForTirage) {
        const gainTotal = parseFloat(g.nb_gagnants) * parseFloat(g.gain_unitaire_eur);
        g.gain_total_eur = Math.round(gainTotal * 100) / 100;  // arrondi 2 décimales
        totalDistribue += gainTotal;
      }

      meta[tirageKey] = {
        jackpot_enjeu_eur: jackpot,
        jackpot_remporte:  remporte ?? '',
        total_distribue_eur: Math.round(totalDistribue),
      };

      // Faire progresser le jackpot pour l'heure suivante
      if (remporte === 1) {
        jackpot = 100000;  // reset après victoire
      } else {
        jackpot = Math.min(jackpot + 100000, 700000);  // +100K, max 700K
      }
    }
  }

  // ── ÉTAPE 3 : enrichir crescendo_historique.csv ───────────
  const historiqueEnrichi = historique.map(row => {
    const k = `${row.date}|${row.heure}`;
    const m = meta[k] || {};
    return {
      ...row,
      jackpot_enjeu_eur:   m.jackpot_enjeu_eur  ?? '',
      jackpot_remporte:    m.jackpot_remporte    ?? '',
      total_distribue_eur: m.total_distribue_eur ?? '',
    };
  });

  writeCsv('crescendo_historique_enrichi.csv', historiqueEnrichi);
  console.log('✅ crescendo_historique_enrichi.csv (+jackpot_enjeu_eur, +jackpot_remporte, +total_distribue_eur)');

  // ── ÉTAPE 4 : enrichir crescendo_gains.csv ────────────────
  const gainsEnrichi = gains.map(g => ({
    ...g,
    gain_total_eur: Math.round(parseFloat(g.nb_gagnants) * parseFloat(g.gain_unitaire_eur) * 100) / 100,
  }));

  writeCsv('crescendo_gains_enrichi.csv', gainsEnrichi);
  console.log('✅ crescendo_gains_enrichi.csv (+gain_total_eur)');

  // ── ÉTAPE 5 : générer crescendo_resume.csv ────────────────
  // 1 ligne par tirage avec toutes les colonnes utiles
  const resume = historique
    .sort((a, b) => sortKey(a.date, a.heure).localeCompare(sortKey(b.date, b.heure)))
    .map(row => {
      const k = `${row.date}|${row.heure}`;
      const m = meta[k] || {};
      return {
        date:                row.date,
        heure:               row.heure,
        n1: row.n1, n2: row.n2, n3: row.n3, n4: row.n4, n5: row.n5,
        n6: row.n6, n7: row.n7, n8: row.n8, n9: row.n9, n10: row.n10,
        lettre:              row.lettre,
        jackpot_enjeu_eur:   m.jackpot_enjeu_eur  ?? '',
        jackpot_remporte:    m.jackpot_remporte    ?? '',
        total_distribue_eur: m.total_distribue_eur ?? '',
      };
    });

  writeCsv('crescendo_resume_enrichi.csv', resume);
  console.log('✅ crescendo_resume_enrichi.csv créé (vue complète par tirage)');

  // ── RÉCAP STATISTIQUES ────────────────────────────────────
  console.log('\n' + '─'.repeat(65));
  console.log('STATISTIQUES GLOBALES');
  console.log('─'.repeat(65));

  const nbTirages    = historique.length;
  const nbRemportes  = Object.values(meta).filter(m => m.jackpot_remporte === 1).length;
  const nbNonGagnes  = Object.values(meta).filter(m => m.jackpot_remporte === 0).length;

  // Montants jackpots
  const jackpotsMises = Object.values(meta).map(m => m.jackpot_enjeu_eur).filter(Boolean);
  const jackpots700K  = jackpotsMises.filter(j => j === 700000).length;
  const jackpots100K  = jackpotsMises.filter(j => j === 100000).length;

  // Total distribué global
  const totalGlobal = Object.values(meta).reduce((s, m) => s + (m.total_distribue_eur || 0), 0);

  console.log(`Tirages total           : ${nbTirages}`);
  console.log(`Jackpots remportés      : ${nbRemportes} (${Math.round(nbRemportes/nbTirages*100)}%)`);
  console.log(`Jackpots non remportés  : ${nbNonGagnes} (${Math.round(nbNonGagnes/nbTirages*100)}%)`);
  console.log(`Jackpots à 100K mis en jeu : ${jackpots100K}`);
  console.log(`Jackpots à 700K mis en jeu : ${jackpots700K}`);
  console.log(`Total distribué global  : ${totalGlobal.toLocaleString('fr-FR')} €`);
  if (anomalies > 0) console.log(`\n⚠ Anomalies cohérence  : ${anomalies}`);

  // Distribution des montants jackpot
  const distrib = {};
  for (const j of jackpotsMises) {
    const k = `${j/1000}K`;
    distrib[k] = (distrib[k] || 0) + 1;
  }
  console.log('\nDistribution jackpots mis en jeu :');
  for (const k of ['100K','200K','300K','400K','500K','600K','700K']) {
    const n = distrib[k] || 0;
    const bar = '█'.repeat(Math.round(n/nbTirages*40));
    console.log(`  ${k.padEnd(5)}: ${String(n).padStart(3)}  ${bar}`);
  }

  // Aperçu du 08/11/2025 (premier samedi)
  console.log('\nAperçu 08/11/2025 (premier samedi) :');
  resume.filter(r => r.date === '08/11/2025').forEach(r =>
    console.log(`  ${r.heure}  jackpot=${(r.jackpot_enjeu_eur/1000).toFixed(0)}K€  remporté=${r.jackpot_remporte}  distribué=${Number(r.total_distribue_eur).toLocaleString('fr-FR')}€`)
  );

  // Aperçu du 13/06/2026 (dernier samedi)
  console.log('\nAperçu 13/06/2026 (dernier samedi) :');
  resume.filter(r => r.date === '13/06/2026').forEach(r =>
    console.log(`  ${r.heure}  jackpot=${(r.jackpot_enjeu_eur/1000).toFixed(0)}K€  remporté=${r.jackpot_remporte}  distribué=${Number(r.total_distribue_eur).toLocaleString('fr-FR')}€`)
  );

  console.log('\n' + '═'.repeat(65));
  console.log('Fichiers produits :');
  console.log('  crescendo_historique_enrichi.csv  — tirage + jackpot + total distribué');
  console.log('  crescendo_gains_enrichi.csv       — gains par rang + gain total ligne');
  console.log('  crescendo_resume_enrichi.csv      — vue complète, 1 ligne par tirage');
  console.log('═'.repeat(65) + '\n');
}

main();
