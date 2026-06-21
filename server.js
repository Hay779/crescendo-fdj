const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');
const strat   = require('./strategie');

const app  = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── HELPERS ──────────────────────────────────────────────────
function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines   = fs.readFileSync(file, 'utf8').trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(',');
    const obj  = {};
    headers.forEach((h, i) => obj[h] = vals[i]?.trim() ?? '');
    return obj;
  });
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ─── API ──────────────────────────────────────────────────────

// Stats globales (dashboard)
app.get('/api/dashboard', (req, res) => {
  const tirages  = readCsv('crescendo_historique_enrichi.csv');
  const gains    = readCsv('crescendo_gains_enrichi.csv');
  const stats    = readJson('crescendo_stats.json');
  const grilles  = readJson('crescendo_grilles.json');

  if (!tirages.length) return res.json({ error: 'Pas de données' });

  const last     = tirages[tirages.length - 1];
  const jackpotNext = parseInt(last.jackpot_remporte) === 1
    ? 100000
    : Math.min(parseInt(last.jackpot_enjeu_eur) + 100000, 700000);

  const nbRemporte  = tirages.filter(t => t.jackpot_remporte === '1').length;
  const totalDist   = tirages.reduce((s, t) => s + parseInt(t.total_distribue_eur || 0), 0);

  res.json({
    nb_samedis:    [...new Set(tirages.map(t => t.date))].length,
    nb_tirages:    tirages.length,
    nb_gains_rows: gains.length,
    last_date:     last.date,
    last_heure:    last.heure,
    jackpot_next:  jackpotNext,
    jackpots_remportes: nbRemporte,
    jackpots_non_remportes: tirages.length - nbRemporte,
    total_distribue: totalDist,
    top10_nums: stats ? stats.top10recommandes : [],
    lettre_recommandee: stats?.lettres?.recommandee || '?',
    derniers_tirages: tirages.slice(-7).reverse(),
    grilles_enregistrees: grilles || null,
  });
});

// Combinaisons étendues
app.get('/api/combos', (req, res) => {
  const combos = readJson('crescendo_combos.json');
  if (!combos) return res.status(404).json({ error: 'Lance node analyse_combos.js' });
  res.json(combos);
});

// Historique complet
app.get('/api/historique', (req, res) => {
  const rows = readCsv('crescendo_historique_enrichi.csv');
  res.json(rows.reverse()); // plus récent en premier
});

// Stats analyse
app.get('/api/stats', (req, res) => {
  const stats = readJson('crescendo_stats.json');
  if (!stats) return res.status(404).json({ error: 'Lance d\'abord node analyse_stats.js' });
  res.json(stats);
});

// Gains par tirage
app.get('/api/gains/:date/:heure', (req, res) => {
  const gains = readCsv('crescendo_gains_enrichi.csv');
  const { date, heure } = req.params;
  const rows = gains.filter(g => g.date === date && g.heure === heure);
  res.json(rows);
});

// Lancer l'analyse statistique
app.post('/api/analyser', (req, res) => {
  if (IS_PROD) return res.json({ ok: true, message: '(prod) Relancer localement puis redéployer' });
  try {
    execSync('node analyse_stats.js', { cwd: __dirname, timeout: 30000 });
    res.json({ ok: true, message: 'Analyse terminée, crescendo_stats.json mis à jour' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Générer des grilles
app.post('/api/generer', (req, res) => {
  const { jackpot, heure } = req.body;
  try {
    const args = [`--jackpot=${jackpot || 500000}`, heure ? `--heure=${heure}` : ''].filter(Boolean).join(' ');
    execSync(`node generateur_grilles.js ${args}`, { cwd: __dirname, timeout: 60000 });
    const result = readJson('crescendo_grilles.json');
    res.json({ ok: true, result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Lancer le scraping tirages (local uniquement)
app.post('/api/scrape/tirages', (req, res) => {
  if (IS_PROD) return res.json({ ok: true, message: '⚠️ Scraping disponible uniquement en local (Playwright requis)' });
  try {
    execSync('node scrape_v4.js', { cwd: __dirname, timeout: 600000 });
    res.json({ ok: true, message: 'Scraping tirages terminé' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Lancer le scraping gains (local uniquement)
app.post('/api/scrape/gains', (req, res) => {
  if (IS_PROD) return res.json({ ok: true, message: '⚠️ Scraping disponible uniquement en local (Playwright requis)' });
  try {
    execSync('node scrape_gains_v2.js', { cwd: __dirname, timeout: 600000 });
    res.json({ ok: true, message: 'Scraping gains terminé' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Enrichir les CSV
app.post('/api/enrichir', (req, res) => {
  if (IS_PROD) return res.json({ ok: true, message: '⚠️ Enrichissement disponible uniquement en local' });
  try {
    execSync('node enrichir.js', { cwd: __dirname, timeout: 30000 });
    res.json({ ok: true, message: 'Enrichissement terminé' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── API STRATÉGIE ────────────────────────────────────────────

// Analyse complète stratégique
app.get('/api/strategie', (req, res) => {
  const tirages = strat.readCsv('crescendo_historique_enrichi.csv');
  const gains   = strat.readCsv('crescendo_gains_enrichi.csv');
  const sessions = strat.readJson(strat.SESSIONS_FILE, { sessions: [], stats: {} });

  const opps    = strat.analyseOpportunites(tirages);
  const s19     = strat.strategie19h(tirages);
  const bt      = strat.backTest(tirages, gains, 500000);
  const probas  = {
    s10:  strat.calculProbas(10, 5, 700000),
    s20:  strat.calculProbas(20, 5, 700000),
    s50:  strat.calculProbas(50, 5, 700000),
    s100: strat.calculProbas(100, 5, 700000),
  };

  // Jackpot prochain estimé
  const last = tirages[tirages.length - 1];
  const jackpotNext = last
    ? (parseInt(last.jackpot_remporte) === 1 ? 100000 : Math.min(parseInt(last.jackpot_enjeu_eur) + 100000, 700000))
    : 100000;

  res.json({ opps, s19, bt, probas, sessions: sessions.sessions || [], jackpotNext });
});

// Analyse journée spécifique
app.get('/api/strategie/journee/:date', (req, res) => {
  const tirages = strat.readCsv('crescendo_historique_enrichi.csv');
  const analyse = strat.analyseJournee(tirages, req.params.date);
  res.json(analyse);
});

// Enregistrer une session jouée
app.post('/api/strategie/session', (req, res) => {
  const { date, heure, jackpot, nb_grilles, grilles, resultat } = req.body;
  const data = strat.readJson(strat.SESSIONS_FILE, { sessions: [] });

  const session = {
    id: Date.now(),
    date, heure, jackpot, nb_grilles,
    grilles: grilles || [],
    resultat: resultat || { rang: null, gain: 0 },
    cout: nb_grilles,
    createdAt: new Date().toISOString(),
  };

  data.sessions.push(session);

  // Recalculer stats globales
  const totalCout  = data.sessions.reduce((s, ss) => s + (ss.cout || 0), 0);
  const totalGain  = data.sessions.reduce((s, ss) => s + (ss.resultat?.gain || 0), 0);
  data.stats = {
    nbSessions: data.sessions.length,
    totalCout,
    totalGain,
    roi: totalCout > 0 ? +((totalGain/totalCout - 1)*100).toFixed(1) : 0,
    meilleurGain: Math.max(...data.sessions.map(s => s.resultat?.gain || 0)),
  };

  strat.writeJson(strat.SESSIONS_FILE, data);
  res.json({ ok: true, session, stats: data.stats });
});

// Récupérer les sessions
app.get('/api/strategie/sessions', (req, res) => {
  const data = strat.readJson(strat.SESSIONS_FILE, { sessions: [], stats: {} });
  res.json(data);
});

// Supprimer une session
app.delete('/api/strategie/session/:id', (req, res) => {
  const data = strat.readJson(strat.SESSIONS_FILE, { sessions: [] });
  data.sessions = data.sessions.filter(s => String(s.id) !== String(req.params.id));
  const totalCout = data.sessions.reduce((s, ss) => s + (ss.cout || 0), 0);
  const totalGain = data.sessions.reduce((s, ss) => s + (ss.resultat?.gain || 0), 0);
  data.stats = {
    nbSessions: data.sessions.length,
    totalCout, totalGain,
    roi: totalCout > 0 ? +((totalGain/totalCout-1)*100).toFixed(1) : 0,
    meilleurGain: data.sessions.length ? Math.max(...data.sessions.map(s => s.resultat?.gain || 0)) : 0,
  };
  strat.writeJson(strat.SESSIONS_FILE, data);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n✅ Crescendo Dashboard → http://localhost:${PORT}\n`);
});
