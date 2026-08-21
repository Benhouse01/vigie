// LE ROBOT CONTINU : un vrai crawler, qui tourne sans s'arreter, sur un serveur.
//
// ⛔ CE QUE CE FICHIER CORRIGE, ET C'ETAIT UNE ERREUR DE JUGEMENT. La premiere version du
//    projet affirmait qu'on ne pouvait pas crawler depuis une machine ordinaire. C'est
//    faux, et la confusion venait de la : on ne peut pas crawler LE WEB ENTIER, mais on
//    n'en a aucun besoin. Pour savoir qui vous lie, il suffit de crawler LES PAGES QUI
//    POURRAIENT VOUS LIER, et dans un secteur donne elles se comptent en centaines de
//    milliers, pas en milliards.
//
//    Les chiffres, pour que chacun juge : un robot poli tenant 5 pages par seconde lit
//    432 000 pages par jour, 13 millions par mois. Un secteur entier tient largement
//    dedans, et se recontrole chaque semaine.
//
// ⛔ CE QUI CHANGE VRAIMENT ENTRE UN PORTABLE ET UN SERVEUR, et ce n'est pas la puissance :
//    1. L'ADRESSE IP. Crawler depuis chez soi fait limiter la connexion de la maison, et
//       c'est la meme adresse qui sert a tout le reste. Sur un serveur, c'est une adresse
//       dediee, et si elle se fait limiter, ca n'empeche personne de travailler.
//       ⚠️ Contrepartie honnete : une adresse de centre de donnees est REFUSEE par
//       certains sites la ou une adresse residentielle passe. On mesure les deux, on ne
//       suppose pas.
//    2. LA CONTINUITE. Un portable dort, se deplace, change de reseau. Un crawl utile est
//       un crawl qui reprend, et qui repasse.
//    3. RIEN D'AUTRE. Ni le processeur ni la memoire ne sont le facteur limitant : un
//       robot poli passe son temps a ATTENDRE, pas a calculer.
//
// ⛔ LA POLITESSE EST LA CONDITION DE SURVIE DU ROBOT, pas une option morale.
//    Un robot impoli se fait bannir, et il grille la reputation de celui qui l'exploite
//    aupres des sites qu'il voudrait justement convaincre de le citer.
//      - robots.txt lu AVANT le premier appel a un hote, et respecte, Crawl-delay compris
//      - UNE seule requete en vol par hote, jamais deux
//      - un delai minimum entre deux requetes au meme hote
//      - un User-Agent qui s'annonce et donne un moyen de joindre l'exploitant
//      - des budgets qui l'arretent : pages par jour, octets par jour, disque
//
// Usage :
//   node outils/robot-continu.mjs --demarrer
//   node outils/robot-continu.mjs --etat
//   node outils/robot-continu.mjs --semer            (remplit la file depuis les sources)
//   ... --par-seconde=4 --hotes-paralleles=12 --pages-par-jour=300000 --go-par-jour=25

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recupererFiable, liensVers, indexabilite, texteDe, hote } from "./_lib-liens.mjs";
import { observation, ecrire, nouveauRun, lire, dernier, config, RACINE } from "./_lib-obs.mjs";

const VERSION = "robot-continu@1.0.0";
const ETAT_DIR = path.join(RACINE, ".cache", "robot-continu");
fs.mkdirSync(ETAT_DIR, { recursive: true });

const F_FILE = path.join(ETAT_DIR, "file.jsonl");        // la file d'attente, sur disque
const F_VUES = path.join(ETAT_DIR, "vues.txt");          // ce qui a deja ete lu
const F_ETAT = path.join(ETAT_DIR, "etat.json");
const F_JOUR = path.join(ETAT_DIR, "compteurs-du-jour.json");

const arg = (n, d) => {
  const v = (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  return v === undefined ? d : v;
};

const PAR_SECONDE = Number(arg("par-seconde", 4));
const HOTES_PARALLELES = Number(arg("hotes-paralleles", 12));
const PAGES_PAR_JOUR = Number(arg("pages-par-jour", 300000));
const GO_PAR_JOUR = Number(arg("go-par-jour", 25));
const DELAI_HOTE_MIN = Number(arg("delai-hote", 4000));
const PROFONDEUR_MAX = Number(arg("profondeur", 2));
const UA = process.env.VIGIE_UA ||
  "Mozilla/5.0 (compatible; VigieBot/1.0; +https://vigie-seo.pages.dev/ ; robot de veille SEO)";

const cfg = config();
const CIBLES = new Map();
for (const d of [...cfg.nous, ...cfg.concurrents]) {
  CIBLES.set(d.domaine, d.domaine);
}
// Les mots qui disent « cette page parle de notre sujet ». Sans eux, le robot part dans
// tout le web et ne revient jamais.
const MOTS = (cfg.lexique_secteur || []).map((m) => String(m).toLowerCase());

// ---------------------------------------------------------------- l'etat, sur disque

const lireJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const ecrireJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1), "utf8");

/**
 * Les URL deja lues, en memoire pour la comparaison et sur disque pour la reprise.
 * ⛔ Un crawler qui oublie ce qu'il a lu relit indefiniment les memes pages : c'est le
 *    plus sur moyen de se faire bannir tout en n'apprenant rien.
 */
const vues = new Set();
if (fs.existsSync(F_VUES)) {
  for (const l of fs.readFileSync(F_VUES, "utf8").split("\n")) if (l.trim()) vues.add(l.trim());
}
const fluxVues = fs.createWriteStream(F_VUES, { flags: "a" });
const marquerVue = (u) => { vues.add(u); fluxVues.write(u + "\n"); };

/** Compteurs remis a zero chaque jour : c'est ce qui borne la consommation. */
function compteursDuJour() {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const c = lireJson(F_JOUR, null);
  if (c && c.jour === aujourdhui) return c;
  return { jour: aujourdhui, pages: 0, octets: 0 };
}
let jour = compteursDuJour();

// ---------------------------------------------------------------- la file

/**
 * File d'attente sur disque, une ligne par URL.
 * ⛔ Elle est SUR DISQUE et pas en memoire, parce qu'un robot continu redemarre : apres
 *    une coupure de courant, une mise a jour ou un plantage, il doit reprendre la ou il
 *    en etait et non repartir des graines.
 */
function chargerFile() {
  if (!fs.existsSync(F_FILE)) return [];
  const out = [];
  for (const l of fs.readFileSync(F_FILE, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (!vues.has(o.url)) out.push(o); } catch {}
  }
  return out;
}
function sauverFile(file) {
  const tmp = F_FILE + ".tmp";
  fs.writeFileSync(tmp, file.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
  fs.renameSync(tmp, F_FILE);
}

// ---------------------------------------------------------------- politesse

const robotsCache = new Map();
async function reglesDe(h) {
  if (robotsCache.has(h)) return robotsCache.get(h);
  const r = await recupererFiable(`https://${h}/robots.txt`, { timeout: 12000, ua: UA }, 1);
  let regles = { autorise: () => true, bloqueTout: false, delai: DELAI_HOTE_MIN };
  if (r.ok && r.http === 200) {
    const txt = r.html.slice(0, 200000);
    const bloc = /user-agent:\s*\*([\s\S]*?)(?=\nuser-agent:|$)/i.exec(txt);
    const corps = bloc ? bloc[1] : "";
    const interdits = [...corps.matchAll(/^\s*disallow:\s*(\S+)\s*$/gim)].map((m) => m[1]).filter(Boolean);
    const bloqueTout = interdits.includes("/");
    // ⛔ Crawl-delay est une demande explicite de l'editeur. On la respecte, et on ne
    //    descend jamais en dessous de notre propre plancher.
    const cd = /^\s*crawl-delay:\s*([\d.]+)/im.exec(corps);
    const delai = cd ? Math.max(DELAI_HOTE_MIN, Number(cd[1]) * 1000) : DELAI_HOTE_MIN;
    regles = {
      bloqueTout, delai,
      autorise: (chemin) => !bloqueTout && !interdits.some((i) => i !== "/" && !i.includes("*") && chemin.startsWith(i)),
    };
  }
  robotsCache.set(h, regles);
  return regles;
}

const dernierAppel = new Map();
const enVol = new Set();

// ---------------------------------------------------------------- semer

function graines() {
  const { obs } = lire();
  const photo = dernier(obs);
  const out = new Map();
  const ajouter = (url, origine, poids, profondeur = 0) => {
    if (!url || out.has(url) || vues.has(url)) return;
    out.set(url, { url, origine, poids, profondeur });
  };

  // 1. Les domaines qui citent nos cibles : le meilleur vivier, et il vient du graphe.
  const compte = new Map();
  for (const o of photo) {
    if (o.metrique !== "liens_depuis_domaine" || !o.objet?.domaine) continue;
    if (!CIBLES.has(o.sujet?.domaine)) continue;
    compte.set(o.objet.domaine, (compte.get(o.objet.domaine) || 0) + 1);
  }
  for (const [d, n] of [...compte].sort((a, b) => b[1] - a[1])) {
    ajouter(`https://${d}/`, `cite ${n} domaine(s) suivi(s)`, 100 + n * 10);
  }

  // 2. Les pages exactes deja connues : on repasse, un lien qui tombe ne fait aucun bruit.
  for (const o of photo) {
    const u = o.objet?.url || o.objet?.detail?.url_source;
    if (u && /^https?:/i.test(u)) ajouter(u, "page portante connue, on verifie qu'elle tient", 120);
  }

  // 3. Les spots de la configuration.
  for (const s of cfg.spots || []) {
    ajouter(s.page || `https://${s.domaine}/`, "spot de la configuration", 90);
  }
  return [...out.values()];
}

if (process.argv.includes("--semer")) {
  const g = graines();
  const file = chargerFile();
  const connues = new Set(file.map((x) => x.url));
  const neuves = g.filter((x) => !connues.has(x.url));
  sauverFile([...file, ...neuves].sort((a, b) => b.poids - a.poids));
  console.log(`${neuves.length} URL ajoutee(s) a la file, qui en porte maintenant ${file.length + neuves.length}.`);
  process.exit(0);
}

if (process.argv.includes("--etat")) {
  const e = lireJson(F_ETAT, {});
  const file = chargerFile();
  console.log(JSON.stringify({
    ...e,
    file: file.length,
    deja_lues: vues.size,
    aujourdhui: compteursDuJour(),
    budgets: { pages_par_jour: PAGES_PAR_JOUR, go_par_jour: GO_PAR_JOUR, par_seconde: PAR_SECONDE },
  }, null, 1));
  process.exit(0);
}

if (!process.argv.includes("--demarrer")) {
  console.log("Robot continu. Etapes :");
  console.log("  --semer      remplit la file depuis le journal et la configuration");
  console.log("  --demarrer   lance le crawl, en boucle, jusqu'a l'arret");
  console.log("  --etat       ou il en est, lisible pendant qu'il tourne");
  process.exit(0);
}

// ---------------------------------------------------------------- la boucle

const run = nouveauRun("robot-continu");
const t0 = Date.now();
let file = chargerFile();
if (!file.length) {
  console.log("File vide : je seme d'abord.");
  file = graines();
  sauverFile(file);
}

console.log(`Vigie — robot continu · ${VERSION}`);
console.log(`file ${file.length} · deja lues ${vues.size} · ${PAR_SECONDE} page(s)/s · ${HOTES_PARALLELES} hotes en parallele`);
console.log(`budgets du jour : ${PAGES_PAR_JOUR} pages, ${GO_PAR_JOUR} Go\n`);

let arret = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    // ⛔ On sauve la file AVANT de sortir. Un robot qui perd sa file au Ctrl+C recommence
    //    tout au redemarrage, et refait subir aux memes sites les memes requetes.
    console.log("\narret demande, sauvegarde de la file…");
    arret = true;
  });
}

let lues = 0, trouves = 0, opportunites = 0, murs = 0, interdits = 0;
const obsEnAttente = [];

const patienter = (ms) => new Promise((r) => setTimeout(r, ms));
const CONCURRENTS = (cfg.concurrents || []).map((d) => d.domaine);

/** Cette page parle-t-elle de notre sujet ? Sans ce filtre, le robot part dans tout le web. */
function dansLeSujet(html) {
  if (!MOTS.length) return true;
  const t = texteDe(html).toLowerCase().slice(0, 60000);
  return MOTS.some((m) => t.includes(m));
}

async function traiter(item) {
  let u;
  try { u = new URL(item.url); } catch { return; }
  const h = u.hostname.replace(/^www\./, "").toLowerCase();

  const regles = await reglesDe(h);
  if (regles.bloqueTout) { interdits++; marquerVue(item.url); return; }
  if (!regles.autorise(u.pathname)) { marquerVue(item.url); return; }

  // Une seule requete en vol par hote, et le delai demande respecte.
  while (enVol.has(h)) await patienter(120);
  const attente = regles.delai - (Date.now() - (dernierAppel.get(h) || 0));
  if (attente > 0) await patienter(attente);
  enVol.add(h);
  dernierAppel.set(h, Date.now());

  let r;
  try { r = await recupererFiable(item.url, { timeout: 15000, ua: UA }, 1); }
  finally { enVol.delete(h); }

  marquerVue(item.url);
  lues++;
  jour.pages++;
  jour.octets += r.octets || 0;

  if (!r.ok || r.http !== 200) { if (r.http === 403 || r.http === 429) murs++; return; }

  const ix = indexabilite(r.html, r.enTetes);

  // 1. Est-ce que cette page lie une de nos cibles ?
  let aTrouve = false;
  for (const cible of CIBLES.keys()) {
    const liens = liensVers(r.html, cible);
    if (!liens.length) continue;
    aTrouve = true;
    for (const l of liens) {
      trouves++;
      obsEnAttente.push(observation({
        type: "backlink", sujet: { domaine: cible },
        objet: {
          domaine: h, url: item.url, ancre: l.ancre,
          detail: {
            url_source: item.url, url_destination: l.url, ancre: l.ancre,
            rel_brut: l.rel, suivi: l.suivi, suivi_effectif: ix.indexable ? l.suivi : "NOFOLLOW",
            genre: l.genre,
            indexabilite: { meta_robots: ix.metaRobots, noindex: ix.noindex },
            trouve_par: "robot-continu", origine_candidat: item.origine,
          },
        },
        metrique: "lien_qualifie", valeur: 1, unite: "lien",
        nature: "mesure", etat: "MESURE",
        source: { nom: "robot", endpoint: item.url, http: 200, methode: "robot" },
        preuve: `rel=${JSON.stringify(l.rel)} lu dans le HTML servi par le robot continu`,
        run_id: run, collecteur: VERSION,
        drapeaux: ix.indexable ? ["trouve_par_robot"] : ["trouve_par_robot", "page_en_noindex"],
      }));
    }
  }

  // 2. Sinon, cite-t-elle un concurrent ? C'est une opportunite, pas un echec.
  if (!aTrouve && !CIBLES.has(h)) {
    const rivaux = CONCURRENTS.filter((c) => c !== h && liensVers(r.html, c).length);
    if (rivaux.length) {
      opportunites++;
      const notre = cfg.nous?.[0]?.domaine;
      if (notre) {
        obsEnAttente.push(observation({
          type: "backlink", sujet: { domaine: notre }, objet: { domaine: h, url: item.url },
          metrique: "opportunite_backlink", valeur: rivaux.length, unite: "concurrent",
          nature: "mesure", etat: "MESURE",
          source: { nom: "robot", endpoint: item.url, http: 200, methode: "robot" },
          preuve: `cite ${rivaux.length} concurrent(s) et PAS nous : ${rivaux.join(", ")}. Candidat retenu parce que : ${item.origine}`,
          run_id: run, collecteur: VERSION, drapeaux: ["opportunite"],
        }));
      }
    }
  }

  // 3. On suit les liens, mais seulement si la page parle du sujet et qu'on n'est pas
  //    trop profond. ⛔ Sans ces deux bornes, la file grossit plus vite qu'on ne la vide
  //    et le robot ne revient jamais sur ce qui compte.
  if (item.profondeur < PROFONDEUR_MAX && dansLeSujet(r.html)) {
    const sortants = liensVers(r.html, "").filter((l) => l.hote && l.hote !== h);
    const neufs = [];
    for (const l of sortants.slice(0, 60)) {
      const cle = `https://${l.hote}/`;
      if (vues.has(cle)) continue;
      neufs.push({ url: cle, origine: `trouve sur ${h}`, poids: 40, profondeur: item.profondeur + 1 });
    }
    if (neufs.length) file.push(...neufs);
  }
}

// La boucle : on prend HOTES_PARALLELES elements a la fois, en veillant a ne jamais
// prendre deux URL du meme hote dans le meme lot.
let derniereSauvegarde = Date.now();
while (!arret && file.length) {
  if (jour.jour !== new Date().toISOString().slice(0, 10)) jour = compteursDuJour();
  if (jour.pages >= PAGES_PAR_JOUR) {
    console.log(`budget de ${PAGES_PAR_JOUR} pages atteint pour aujourd'hui, pause d'une heure.`);
    await patienter(3600000);
    continue;
  }
  if (jour.octets / 1e9 >= GO_PAR_JOUR) {
    console.log(`budget de ${GO_PAR_JOUR} Go atteint pour aujourd'hui, pause d'une heure.`);
    await patienter(3600000);
    continue;
  }

  const lot = [];
  const hotesDuLot = new Set();
  for (let i = 0; i < file.length && lot.length < HOTES_PARALLELES; i++) {
    let h;
    try { h = new URL(file[i].url).hostname.replace(/^www\./, ""); } catch { file.splice(i--, 1); continue; }
    if (hotesDuLot.has(h) || enVol.has(h)) continue;
    hotesDuLot.add(h);
    lot.push(...file.splice(i--, 1));
  }
  if (!lot.length) { await patienter(500); continue; }

  const debut = Date.now();
  await Promise.all(lot.map((x) => traiter(x).catch(() => {})));

  // Le rythme demande : on ne va jamais plus vite que PAR_SECONDE pages.
  const voulu = (lot.length / PAR_SECONDE) * 1000;
  const reste = voulu - (Date.now() - debut);
  if (reste > 0) await patienter(reste);

  if (obsEnAttente.length >= 20) { ecrire(obsEnAttente.splice(0)); }

  if (Date.now() - derniereSauvegarde > 30000) {
    derniereSauvegarde = Date.now();
    sauverFile(file);
    ecrireJson(F_JOUR, jour);
    ecrireJson(F_ETAT, {
      version: VERSION, run, demarre: new Date(t0).toISOString(),
      ecoule_s: Math.round((Date.now() - t0) / 1000),
      file: file.length, lues, trouves, opportunites, murs, interdits,
      pages_du_jour: jour.pages, go_du_jour: +(jour.octets / 1e9).toFixed(2),
    });
    console.log(`  ${lues} lues · ${trouves} lien(s) · ${opportunites} opportunite(s) · file ${file.length} · ${(jour.octets / 1e9).toFixed(2)} Go aujourd'hui`);
  }
}

if (obsEnAttente.length) ecrire(obsEnAttente);
sauverFile(file);
ecrireJson(F_JOUR, jour);
ecrireJson(F_ETAT, {
  version: VERSION, run, fini: !file.length, arrete: arret,
  ecoule_s: Math.round((Date.now() - t0) / 1000),
  file: file.length, lues, trouves, opportunites, murs, interdits,
});
console.log(`\n${lues} page(s) lue(s), ${trouves} lien(s), ${opportunites} opportunite(s), ${murs} mur(s), ${interdits} interdit(s). File : ${file.length}.`);
fluxVues.end();
