// NOTRE PROPRE ROBOT, CELUI QUI TOURNE EN CONTINU.
//
// ⛔ POURQUOI IL EXISTE, ET POURQUOI RIEN D'AUTRE NE LE REMPLACE.
//    Le graphe de Common Crawl est refait CHAQUE TRIMESTRE. Il donne de la profondeur
//    (36 891 domaines referents sur un gros site, mesure le 21/08/2026) mais il ne donne
//    aucune fraicheur : un domaine cree depuis la derniere edition en est absent, et un
//    lien pose la semaine derniere n'y sera pas avant des mois.
//    Ahrefs et Semrush n'ont pas ce probleme parce qu'ils font tourner leur robot en
//    permanence. C'est exactement ce que fait ce fichier.
//
// ⛔ ET LE SEUL ENDROIT OU CHERCHER, C'EST CHEZ LES VOISINS.
//    Crawler le web au hasard demanderait les moyens d'Ahrefs. Mais les sites qui
//    pointent vers VOS CONCURRENTS sont exactement ceux qui peuvent pointer vers vous :
//    les annuaires du secteur, les comparatifs, les blogs de niche, les forums. Le
//    graphe trimestriel donne cette liste (4 483 domaines pour un secteur entier), et
//    le robot la crawle en continu. Chaque lien trouve est FRAIS et lu dans le HTML.
//
// ⛔ LA POLITESSE N'EST PAS NEGOCIABLE, ET CE N'EST PAS DE LA COURTOISIE.
//    robots.txt lu et respecte avant toute page. Une seule requete en vol par hote, avec
//    un delai entre deux. Un User-Agent qui s'annonce et donne un moyen de nous joindre.
//    Un robot impoli fait bannir l'adresse du serveur, et il grille les sites qu'on
//    voulait justement convaincre de nous publier.
//
// Usage :
//   node serveur/crawler.mjs --semer          remplit la file depuis la base D1
//   node serveur/crawler.mjs                  crawle en continu
//   node serveur/crawler.mjs --pages=5000     s'arrete apres ce nombre de pages
//   node serveur/crawler.mjs --etat           dit ou il en est, sans rien crawler

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const arg = (nom, defaut = null) => {
  const t = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return t ? t.slice(nom.length + 3) : defaut;
};

const DOSSIER = process.env.VIGIE_DONNEES || "C:/vigie/donnees";
const BD = path.join(DOSSIER, "index.sqlite");
const AGENT = "Mozilla/5.0 (compatible; VigieBot/1.0; +https://vigie-seo.pages.dev/robot)";

const EN_VOL = Number(arg("parallele", 24));      // hotes crawles en meme temps
const DELAI_HOTE = Number(arg("delai", 2000));    // ms entre deux pages du meme hote
const PROFONDEUR_MAX = Number(arg("profondeur", 3));
const PAGES_MAX = Number(arg("pages", 0));        // 0 = sans fin
const OCTETS_MAX = 1_200_000;

const INSTANCE = arg("instance", "1");
const horodate = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const dire = (m) => console.log(`[${horodate()}] [r${INSTANCE}] ${m}`);

// ⛔ UN FILET, ET IL EST NECESSAIRE. Une exception levee depuis un evenement de socket
//    par une bibliotheque tierce ne traverse aucun try/catch de la boucle. Sans ce
//    filet, le robot meurt en pleine passe et la file reste figee jusqu au prochain
//    reveil de la tache planifiee. L etat vit en base, donc perdre une page n a aucune
//    consequence : on la note et on continue.
let incidents = 0;
process.on("uncaughtException", (e) => {
  incidents++;
  dire(`incident rattrape (${incidents}) : ${e.name} ${String(e.message).slice(0, 120)}`);
  if (incidents > 500) { dire("trop d incidents, on s arrete pour que la tache relance proprement"); process.exit(1); }
});
process.on("unhandledRejection", (e) => {
  incidents++;
  dire(`promesse non tenue (${incidents}) : ${String(e && e.message || e).slice(0, 120)}`);
});

fs.mkdirSync(DOSSIER, { recursive: true });
const bd = new DatabaseSync(BD);

// ⛔ SANS busy_timeout, DEUX ROBOTS SUR LA MEME BASE SE JETTENT DES « database is
//    locked » A LA FIGURE. En WAL un seul ecrit a la fois ; le second doit attendre son
//    tour, pas abandonner. Trente secondes couvrent largement une ecriture de page.
//
// ⛔ ET IL SE POSE EN PREMIER, AVANT TOUTE AUTRE PRAGMA. « journal_mode = WAL » reclame
//    un verrou exclusif le temps de basculer le journal ; si l autre robot ecrit a cette
//    seconde-la, SQLite rend « database is locked » IMMEDIATEMENT tant que le delai
//    d attente n est pas pose. L exception part alors du corps du module : plus rien
//    n est programme dans la boucle d evenements, le filet uncaughtException ecrit UNE
//    ligne, et node sort avec le code 0. Une mort propre et silencieuse, qu une tache
//    planifiee « au demarrage du systeme » ne rattrape jamais. C est ce qui a tue le
//    robot du large le 21/08/2026 a 20h45 UTC : il est reste couche 43 heures pendant
//    que l ecran public affichait un moteur « en direct ».
bd.exec("PRAGMA busy_timeout = 30000");

// ⛔ WAL ET synchronous=NORMAL, SINON LE ROBOT PASSE SON TEMPS A ATTENDRE LE DISQUE.
//    En mode journal par defaut, chaque page ecrite force une synchronisation complete :
//    mesure a une page par seconde au lieu de trente.
bd.exec("PRAGMA journal_mode = WAL");
bd.exec("PRAGMA synchronous = NORMAL");
bd.exec("PRAGMA temp_store = MEMORY");
bd.exec("PRAGMA cache_size = -200000");

bd.exec(`
-- ⛔ « priorite » N EST PAS UN CONFORT, C EST CE QUI REND LE ROBOT UTILE.
--    Sans elle, la file melange les 36 891 domaines referents d un geant du secteur et
--    les 508 d un concurrent direct : le robot passe ses journees sur des sites de
--    finance generalistes qui ne citeront jamais un petit outil. Les domaines qui
--    citent VOS concurrents directs passent devant, parce que ce sont eux qui peuvent
--    vous citer. 1 = a lire d abord, 5 = quand il n y a plus rien d autre.
CREATE TABLE IF NOT EXISTS file (
  url        TEXT PRIMARY KEY,
  hote       TEXT NOT NULL,
  profondeur INTEGER NOT NULL DEFAULT 0,
  priorite   INTEGER NOT NULL DEFAULT 3,
  etat       TEXT NOT NULL DEFAULT 'attente',   -- attente | lu | mur | interdit
  ajoute_le  TEXT NOT NULL,
  lu_le      TEXT
);
CREATE INDEX IF NOT EXISTS idx_file_travail ON file(etat, priorite, profondeur);
CREATE INDEX IF NOT EXISTS idx_file_hote ON file(hote, etat);

-- ⛔ « occupe_jusqu_a » EST CE QUI PERMET DE FAIRE TOURNER PLUSIEURS ROBOTS.
--    La politesse dit : une seule requete en vol par hote. Tant qu il n y avait qu un
--    processus, un simple ensemble en memoire suffisait. Des qu il y en a deux, chacun
--    a son propre ensemble et ils ne se voient pas : ils tombent tous les deux sur le
--    meme site et le martelent. C est exactement ce qui fait bannir une adresse IP.
--    Le verrou vit donc dans la BASE, partagee, et il porte une date d expiration pour
--    qu un robot tue en pleine page ne bloque pas son hote pour toujours.
CREATE TABLE IF NOT EXISTS hotes (
  hote           TEXT PRIMARY KEY,
  interdit       TEXT,
  delai          REAL NOT NULL DEFAULT 0,
  mur            INTEGER NOT NULL DEFAULT 0,
  robots_le      TEXT,
  pages_lues     INTEGER NOT NULL DEFAULT 0,
  dernier_le     TEXT,
  occupe_jusqu_a TEXT
);

-- L'INDEX DE LIENS. C'est le produit du robot, et il est valable pour TOUS les
-- domaines, pas seulement ceux qu'on suit : une page lue une fois rend tous ses liens
-- sortants d'un coup.
CREATE TABLE IF NOT EXISTS liens (
  url_src      TEXT NOT NULL,
  domaine_src  TEXT NOT NULL,
  domaine_dest TEXT NOT NULL,
  url_dest     TEXT NOT NULL,
  ancre        TEXT,
  rel          TEXT NOT NULL,
  vu_le        TEXT NOT NULL,
  PRIMARY KEY (url_src, url_dest)
);
CREATE INDEX IF NOT EXISTS idx_liens_dest ON liens(domaine_dest, vu_le);
CREATE INDEX IF NOT EXISTS idx_liens_src ON liens(domaine_src);
`);

// La colonne peut manquer sur une base creee avant cette version : on l ajoute sans
// rien casser, et on ignore l erreur si elle est deja la.
try { bd.exec("ALTER TABLE file ADD COLUMN priorite INTEGER NOT NULL DEFAULT 3"); } catch { /* deja presente */ }
try { bd.exec("ALTER TABLE hotes ADD COLUMN occupe_jusqu_a TEXT"); } catch { /* deja presente */ }

// ⛔ UNE PAGE LAISSEE « en cours » PAR UN ROBOT TUE BLOQUERAIT LA FILE POUR TOUJOURS.
//    Au demarrage, on rend a la file tout ce qui traine depuis plus de dix minutes :
//    aucune page ne prend dix minutes, donc c est forcement un robot qui n est plus la.
const rendues = bd.prepare(
  "UPDATE file SET etat = 'attente' WHERE etat = 'encours' AND (lu_le IS NULL OR lu_le < ?)"
).run(new Date(Date.now() - 600000).toISOString());
if (rendues.changes) console.log(`[reprise] ${rendues.changes} page(s) rendue(s) a la file`);
try { bd.exec("CREATE INDEX IF NOT EXISTS idx_file_travail2 ON file(etat, priorite, profondeur)"); } catch { /* deja presente */ }

/* -------------------------------------------------------------- utilitaires */

const domaineDe = (url) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
};

const memeSite = (a, b) => !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));

const EXTENSIONS_MORTES = /\.(jpe?g|png|gif|webp|svg|ico|css|js|mjs|pdf|zip|rar|gz|mp[34]|avi|mov|woff2?|ttf|eot|xml|rss|json|csv|xlsx?|docx?|pptx?)$/i;

/**
 * ⛔ ON PART DE LA BALISE OUVRANTE, JAMAIS DE LA PAIRE <a>…</a>.
 *    Exiger la fermeture dans les 400 caracteres rate TOUS les liens qui enveloppent un
 *    bloc : une carte, une image avec legende, un article entier. Sur le meme jeu de
 *    pages, la correction a fait passer 3 liens qualifies a 21.
 */
function liensDe(html, base) {
  const trouves = [];
  const re = /<a\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attributs = m[1];
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributs);
    if (!href) continue;
    const brut = (href[2] ?? href[3] ?? href[4] ?? "").trim();
    if (!brut || brut.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(brut)) continue;

    let url;
    try { url = new URL(brut, base); } catch { continue; }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    url.hash = "";
    if (url.href.length > 500) continue;

    const relAttr = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributs);
    const relBrut = relAttr ? (relAttr[2] ?? relAttr[3] ?? relAttr[4] ?? "").trim() : "";

    const apres = html.slice(re.lastIndex, re.lastIndex + 500);
    const fin = apres.indexOf("</a>");
    const ancre = fin >= 0
      ? apres.slice(0, fin).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)
      : "";

    trouves.push({ url: url.href, relBrut, ancre });
  }
  return trouves;
}

/**
 * ⛔ « non qualifie » N'EST PAS UNE VALEUR ACCEPTABLE. Un lien est dofollow, nofollow,
 *    ugc ou sponsored. L'absence d'attribut rel EST la definition de dofollow.
 */
function qualifierRel(relBrut) {
  const mots = (relBrut || "").toLowerCase().split(/\s+/).filter(Boolean);
  const gardes = mots.filter((x) => ["nofollow", "ugc", "sponsored"].includes(x));
  return gardes.length ? [...new Set(gardes)].sort().join("+") : "dofollow";
}

/* ------------------------------------------------------------------ robots */

const memoireRobots = new Map();

async function reglesDe(hote) {
  if (memoireRobots.has(hote)) return memoireRobots.get(hote);

  const veille = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const cache = bd.prepare("SELECT interdit, delai, mur, robots_le FROM hotes WHERE hote = ?").get(hote);
  if (cache && cache.robots_le && cache.robots_le > veille) {
    const r = { interdit: (cache.interdit || "").split("\n").filter(Boolean), delai: cache.delai, mur: !!cache.mur };
    memoireRobots.set(hote, r);
    return r;
  }

  let interdit = [];
  let delai = 0;
  let mur = false;
  try {
    const r = await fetch(`https://${hote}/robots.txt`, {
      headers: { "user-agent": AGENT, accept: "text/plain" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (r.status === 404 || r.status === 410) {
      interdit = [];
    } else if (r.ok) {
      const texte = (await r.text()).slice(0, 120000);
      let concerne = false;
      for (const brute of texte.split(/\r?\n/)) {
        const ligne = brute.split("#")[0].trim();
        const sep = ligne.indexOf(":");
        if (sep < 0) continue;
        const cle = ligne.slice(0, sep).trim().toLowerCase();
        const val = ligne.slice(sep + 1).trim();
        if (cle === "user-agent") concerne = val === "*" || /vigie/i.test(val);
        else if (concerne && cle === "disallow" && val) interdit.push(val);
        else if (concerne && cle === "crawl-delay") {
          const n = parseFloat(val);
          if (Number.isFinite(n)) delai = Math.min(n * 1000, 30000);
        }
      }
    } else {
      // ⛔ UN 403 SUR robots.txt N'EST PAS UNE AUTORISATION. Seul un 404 dit « aucune
      //    restriction ». Un hote qui oppose un mur des le robots.txt ne se crawle pas.
      mur = true;
    }
  } catch {
    mur = true;
  }

  bd.prepare(
    `INSERT INTO hotes (hote, interdit, delai, mur, robots_le) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hote) DO UPDATE SET interdit = excluded.interdit, delai = excluded.delai,
       mur = excluded.mur, robots_le = excluded.robots_le`
  ).run(hote, interdit.join("\n"), delai, mur ? 1 : 0, new Date().toISOString());

  const regles = { interdit, delai, mur };
  memoireRobots.set(hote, regles);
  return regles;
}

function autorise(regles, chemin) {
  if (regles.mur) return false;
  for (const motif of regles.interdit) {
    if (motif === "/") return false;
    const prefixe = motif.split("*")[0];
    if (prefixe && chemin.startsWith(prefixe)) return false;
  }
  return true;
}

/* ------------------------------------------------------------- la file */

const ajouter = bd.prepare(
  "INSERT INTO file (url, hote, profondeur, priorite, etat, ajoute_le) VALUES (?, ?, ?, ?, 'attente', ?) ON CONFLICT(url) DO NOTHING"
);
// Une page deja en file qui revient avec une meilleure priorite doit remonter : c est
// ce qui fait qu ajouter une cible prioritaire reordonne le travail restant.
const remonter = bd.prepare(
  "UPDATE file SET priorite = ? WHERE url = ? AND etat = 'attente' AND priorite > ?"
);
const marquer = bd.prepare("UPDATE file SET etat = ?, lu_le = ? WHERE url = ?");
const noterLien = bd.prepare(
  `INSERT INTO liens (url_src, domaine_src, domaine_dest, url_dest, ancre, rel, vu_le)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(url_src, url_dest) DO UPDATE SET rel = excluded.rel, ancre = excluded.ancre, vu_le = excluded.vu_le`
);

// ⛔ UN SEUL HOTE NE DOIT JAMAIS POSSEDER UNE BANDE ENTIERE.
//    La politesse n autorise qu une requete en vol par hote. Le jour ou tout ce qui
//    reste en attente dans une bande appartient au meme site, les soixante lecteurs se
//    disputent un seul creneau et le moteur entier tombe a la cadence de ce site.
//    Mesure du 23/08/2026 : la bande de la niche ne contenait plus qu arxiv.org, 14 588
//    URL, et le robot lisait DEUX pages par minute la ou il en lisait cent trente.
//    Le plafond compte les pages EN ATTENTE, jamais les pages lues : un gros site se
//    crawle toujours en entier, mais par vagues, en laissant passer les autres entre.
const PLAFOND_HOTE = Number(arg("plafond-hote", 1500));
const enAttenteParHote = new Map();
const compterAttente = bd.prepare("SELECT COUNT(*) AS n FROM file WHERE hote = ? AND etat = 'attente'");
function attenteDe(hote) {
  let n = enAttenteParHote.get(hote);
  if (n === undefined) { n = compterAttente.get(hote)?.n || 0; enAttenteParHote.set(hote, n); }
  return n;
}

function enfiler(url, profondeur, priorite = 3) {
  const hote = domaineDe(url);
  if (!hote) return false;
  try { if (EXTENSIONS_MORTES.test(new URL(url).pathname)) return false; } catch { return false; }
  if (attenteDe(hote) >= PLAFOND_HOTE) return false;
  const pose = ajouter.run(url, hote, profondeur, priorite, new Date().toISOString());
  if (pose.changes) enAttenteParHote.set(hote, attenteDe(hote) + 1);
  remonter.run(priorite, url, priorite);
  return true;
}

/* ------------------------------------------------------------- le crawl */

let pagesLues = 0;
let liensNotes = 0;

/**
 * Ouvre une page, avec plafond d octets et de temps.
 *
 * ⛔ ON INTERROMPT LA REQUETE, ON N ANNULE PAS LE LECTEUR.
 *    Appeler reader.cancel() pour arreter la lecture au plafond d octets fait tomber
 *    l analyseur HTTP de Node avec « AssertionError: assert(!this.paused) », depuis les
 *    entrailles d undici. Ce n est PAS rattrapable par un try/catch autour du fetch :
 *    l exception surgit plus tard, sur un evenement de socket. Le robot est mort au bout
 *    de 1 330 pages le 21/08/2026, sans que la boucle puisse rien y faire.
 *    Un AbortController, lui, est le chemin prevu : il defait la requete proprement.
 */
async function ouvrir(url) {
  const controle = new AbortController();
  const chrono = setTimeout(() => controle.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: {
        "user-agent": AGENT,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "accept-language": "fr,en;q=0.8",
      },
      redirect: "follow",
      signal: controle.signal,
    });
    if (!r.ok) { controle.abort(); return { mur: "HTTP " + r.status }; }
    const type = r.headers.get("content-type") || "";
    if (type && !/html|xhtml|text\/plain/i.test(type)) { controle.abort(); return { mur: "type " + type.split(";")[0] }; }

    // Une page annoncee comme enorme ne s ouvre pas du tout : la lire pour la jeter
    // ensuite coute la bande passante de quelqu un d autre.
    const annonce = Number(r.headers.get("content-length") || 0);
    if (annonce > OCTETS_MAX * 4) { controle.abort(); return { mur: "trop lourde" }; }

    const lecteur = r.body?.getReader();
    if (!lecteur) return { mur: "corps vide" };
    const morceaux = [];
    let total = 0;
    let coupee = false;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      total += value.length;
      if (total >= OCTETS_MAX) { coupee = true; break; }
    }
    if (coupee) controle.abort();

    const octets = new Uint8Array(total);
    let i = 0;
    for (const m of morceaux) { octets.set(m.subarray(0, Math.min(m.length, total - i)), i); i += m.length; if (i >= total) break; }
    return { html: new TextDecoder("utf-8", { fatal: false }).decode(octets), url: r.url };
  } catch (e) {
    return { mur: e.name === "AbortError" || e.name === "TimeoutError" ? "delai depasse" : "injoignable" };
  } finally {
    clearTimeout(chrono);
  }
}
/** Une page : on l'ouvre, on note TOUS ses liens sortants, on enfile ses liens internes. */
async function traiter(ligne) {
  const { url, hote, profondeur, priorite } = ligne;

  const regles = await reglesDe(hote);
  let chemin = "/";
  try { chemin = new URL(url).pathname; } catch { /* garde "/" */ }
  if (!autorise(regles, chemin)) {
    marquer.run("interdit", new Date().toISOString(), url);
    return;
  }

  const res = await ouvrir(url);
  if (res.mur) {
    marquer.run("mur", new Date().toISOString(), url);
    return;
  }

  pagesLues++;
  const base = res.url || url;
  const maintenant = new Date().toISOString();
  const internes = [];

  for (const l of liensDe(res.html, base)) {
    const dest = domaineDe(l.url);
    if (!dest) continue;
    if (memeSite(dest, hote)) {
      if (profondeur < PROFONDEUR_MAX) internes.push(l.url);
      continue;
    }
    // ⛔ ON NOTE TOUS LES LIENS SORTANTS, PAS SEULEMENT CEUX QU'ON SUIT.
    //    Une page lue une fois rend tous ses liens d'un coup : la filtrer sur une liste
    //    de cibles obligerait a la relire pour chaque nouveau domaine demande.
    noterLien.run(base, hote, dest, l.url, l.ancre || null, qualifierRel(l.relBrut), maintenant);
    liensNotes++;
  }

  // Quelques liens internes seulement : le but est de couvrir BEAUCOUP de sites, pas
  // d'aspirer un site entier.
  // ⛔ ON DESCEND PLUS LOIN SUR LES SITES PRIORITAIRES, et a peine sur les autres.
  //    Un annuaire du secteur porte ses liens sur des pages profondes ; un site
  //    generaliste n en portera aucun quel que soit le nombre de pages lues.
  const combien = (priorite || 3) <= 2 ? 60 : 12;
  for (const u of internes.slice(0, combien)) enfiler(u, profondeur + 1, priorite || 3);

  marquer.run("lu", maintenant, url);
  bd.prepare("UPDATE hotes SET pages_lues = pages_lues + 1, dernier_le = ? WHERE hote = ?").run(maintenant, hote);
  // Une page lue est une place rendue sous le plafond de cet hote.
  if (enAttenteParHote.has(hote)) enAttenteParHote.set(hote, Math.max(0, enAttenteParHote.get(hote) - 1));
}

/**
 * Prend la prochaine page a lire, et POSE LE VERROU DANS LA BASE.
 *
 * ⛔ LA PRISE DOIT ETRE ATOMIQUE, sinon deux robots choisissent la meme page a la
 *    milliseconde pres et la lisent tous les deux. BEGIN IMMEDIATE prend le verrou
 *    d ecriture avant de lire : la selection et la reservation ne peuvent pas etre
 *    coupees en deux.
 */
// ⛔ CHAQUE ROBOT NE PIOCHE QUE DANS SA BANDE DE PRIORITE.
//    Un seul robot qui prend tout finit par partir sur le large des que la niche est a
//    jour, puis met des heures a revenir sur la niche quand une page y bouge. Deux
//    robots, deux bandes : celui de la niche ne fait QUE la niche et repasse dessus
//    sans arret, celui du large elargit la couverture pour tous les autres domaines
//    que quelqu un demandera un jour.
//    Les bornes sont ramenees a des entiers valides avant d entrer dans la requete :
//    elles y sont concatenees, jamais liees, parce qu une clause BETWEEN liee empeche
//    SQLite d utiliser l index de la file.
const PRIO_MIN = Math.max(1, Math.min(9, Number(arg("pmin", 1)) || 1));
const PRIO_MAX = Math.max(PRIO_MIN, Math.min(9, Number(arg("pmax", 9)) || 9));

const choisir = bd.prepare(
  "SELECT f.url, f.hote, f.profondeur, f.priorite FROM file f " +
  "WHERE f.etat = 'attente' AND f.priorite BETWEEN " + PRIO_MIN + " AND " + PRIO_MAX + " AND NOT EXISTS (" +
  "  SELECT 1 FROM hotes h WHERE h.hote = f.hote AND h.occupe_jusqu_a > ?" +
  ") ORDER BY f.priorite ASC, f.profondeur ASC, f.rowid ASC LIMIT 1"
);
// ⛔ UN LECTEUR QUI NE TROUVE RIEN DANS SA BANDE NE DOIT PAS DORMIR.
//    Sa bande peut etre vide, ou n avoir que des hotes en cours de politesse. Dans les
//    deux cas il reste des dizaines de milliers de pages a lire un cran plus bas, et
//    soixante lecteurs qui tournent a vide ne rapportent rien a personne.
//    Le repli ne va QUE vers les priorites MOINS importantes, jamais l inverse : le
//    robot du large ne remontera donc jamais chercher la niche. La doctrine tient, la
//    niche passe toujours en premier, et quand elle n a rien a donner ses lecteurs
//    elargissent au lieu d attendre.
const REPLI = arg("repli", "1") !== "0" && PRIO_MAX < 9;
const choisirRepli = REPLI ? bd.prepare(
  "SELECT f.url, f.hote, f.profondeur, f.priorite FROM file f " +
  "WHERE f.etat = 'attente' AND f.priorite BETWEEN " + (PRIO_MAX + 1) + " AND 9 AND NOT EXISTS (" +
  "  SELECT 1 FROM hotes h WHERE h.hote = f.hote AND h.occupe_jusqu_a > ?" +
  ") ORDER BY f.priorite ASC, f.profondeur ASC, f.rowid ASC LIMIT 1"
) : null;

const reserverPage = bd.prepare("UPDATE file SET etat = 'encours', lu_le = ? WHERE url = ? AND etat = 'attente'");
const reserverHote = bd.prepare(
  "INSERT INTO hotes (hote, occupe_jusqu_a) VALUES (?, ?) ON CONFLICT(hote) DO UPDATE SET occupe_jusqu_a = excluded.occupe_jusqu_a"
);
const libererHote = bd.prepare("UPDATE hotes SET occupe_jusqu_a = ? WHERE hote = ?");

function prochaine() {
  const maintenant = new Date().toISOString();
  try {
    bd.exec("BEGIN IMMEDIATE");
    let ligne = choisir.get(maintenant);
    if (!ligne && choisirRepli) ligne = choisirRepli.get(maintenant);
    if (!ligne) { bd.exec("COMMIT"); return null; }
    const pris = reserverPage.run(maintenant, ligne.url);
    if (!pris.changes) { bd.exec("COMMIT"); return null; }
    // Le verrou tient le temps d une lecture au pire ; il sera repousse au vrai delai
    // de politesse quand la page sera finie.
    reserverHote.run(ligne.hote, new Date(Date.now() + 60000).toISOString());
    bd.exec("COMMIT");
    return ligne;
  } catch (e) {
    try { bd.exec("ROLLBACK"); } catch { /* deja defait */ }
    return null;
  }
}
async function lecteur() {
  for (;;) {
    if (PAGES_MAX && pagesLues >= PAGES_MAX) return;
    const ligne = prochaine();
    if (!ligne) { await new Promise((s) => setTimeout(s, 1200)); continue; }
    try {
      await traiter(ligne);
    } catch (e) {
      marquer.run("mur", new Date().toISOString(), ligne.url);
    } finally {
      // On repousse le verrou du delai de politesse, jamais on ne le retire : le
      // prochain robot qui regarde verra que cet hote vient d etre sollicite.
      const regles = memoireRobots.get(ligne.hote);
      const attente = Math.max(DELAI_HOTE, regles?.delai || 0);
      try { libererHote.run(new Date(Date.now() + attente).toISOString(), ligne.hote); } catch { /* base occupee */ }
    }
  }
}
/* ------------------------------------------------------------------ semer */

// ⛔ POWERSHELL ECRIT UN BOM EN TETE DE SES FICHIERS UTF-8, ET JSON.parse LE REFUSE.
//    Le message d erreur ne nomme ni le BOM ni le fichier : il ressemble a un JSON
//    corrompu alors que le contenu est parfait. Trois caracteres invisibles ont coute
//    une passe entiere le 21/08/2026.
const marqueOrdreOctets = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * Seme depuis le resultat COMPLET d une passe de graphe, sans passer par D1.
 *
 * ⛔ D1 NE PORTE QU UNE VERSION PLAFONNEE DE LA VERITE. On y pousse au plus quelques
 *    centaines de domaines referents par cible, parce que son palier gratuit accepte
 *    100 000 lignes ecrites par jour. Semer le robot depuis D1 reviendrait donc a lui
 *    cacher la majorite du terrain : 4 483 domaines au lieu de 42 000 sur le meme
 *    secteur, mesure le 21/08/2026. Le fichier de passe, lui, est complet.
 */
function semerDepuisFichier(chemin, prioritaires, massives) {
  const j = JSON.parse(marqueOrdreOctets(fs.readFileSync(chemin, "utf8")));
  const parVoisin = new Map();

  for (const [cible, v] of Object.entries(j.cibles || {})) {
    const c = String(cible).toLowerCase();
    const p = prioritaires.includes(c) ? 1 : massives.includes(c) ? 5 : 2;
    for (const d of v.domaines || []) {
      if (!d) continue;
      parVoisin.set(d, Math.min(parVoisin.get(d) ?? 9, p));
    }
  }
  return parVoisin;
}

/**
 * LA CO-CITATION, ET C EST LA BOUCLE QUI FAIT GROSSIR L INDEX SUR UN SITE JEUNE.
 *
 * ⛔ LE CONSTAT QUI L IMPOSE, MESURE LE 21/08/2026.
 *    Le robot trouvait 62 domaines referents pour un concurrent et 3 pour le site de
 *    l utilisateur. Ce n etait pas un defaut du robot : il crawle les domaines qui
 *    citent les CONCURRENTS, donc il retrouve forcement les concurrents. Le site jeune,
 *    lui, n a que dix-sept referents connus, donc rien a crawler autour de lui.
 *
 *    Le raisonnement qui debloque : une page qui liste un produit en liste toujours
 *    d autres. Si une page cite l annuaire ou vous etes inscrit, elle cite aussi les
 *    annuaires FRERES, ceux ou vous devriez etre et ou vous etes peut-etre deja sans
 *    le savoir. On part donc des domaines qui vous citent, on prend les pages qui les
 *    citent, et on ramasse tout ce que ces pages citent d autre. C est exactement la
 *    facon dont un profil de liens se decouvre de proche en proche.
 *
 * ⛔ ET ON ECARTE CE QUI EST CITE PARTOUT. Un domaine cite par plus d un quart des
 *    pages de l index est un reseau social ou un outil de mesure, pas un annuaire de
 *    votre secteur. Le garder noierait la liste.
 */
function semerCoCitation(graines, plafond = 4000) {
  if (!graines.length) return new Map();

  const trous = graines.map(() => "?").join(",");
  const pages = bd
    .prepare(`SELECT DISTINCT url_src FROM liens WHERE domaine_dest IN (${trous}) LIMIT 30000`)
    .all(...graines)
    .map((l) => l.url_src);

  dire(`${pages.length} page(s) citent au moins une de vos ${graines.length} graine(s)`);
  if (!pages.length) return new Map();

  // Combien de pages au total citent chaque domaine : sert a ecarter les omnipresents.
  const totalPages = bd.prepare("SELECT COUNT(DISTINCT url_src) AS n FROM liens").get().n || 1;
  const plafondOmnipresent = Math.max(50, Math.floor(totalPages / 4));

  const compte = new Map();
  const requete = bd.prepare("SELECT domaine_dest FROM liens WHERE url_src = ?");
  for (const p of pages) {
    for (const l of requete.all(p)) {
      const d = l.domaine_dest;
      if (!d || graines.includes(d)) continue;
      compte.set(d, (compte.get(d) || 0) + 1);
    }
  }

  const omnipresents = new Set(
    bd.prepare("SELECT domaine_dest FROM liens GROUP BY domaine_dest HAVING COUNT(DISTINCT url_src) > ?")
      .all(plafondOmnipresent)
      .map((l) => l.domaine_dest)
  );

  const retenus = [...compte.entries()]
    .filter(([d]) => !omnipresents.has(d))
    .sort((a, b) => b[1] - a[1])
    .slice(0, plafond);

  dire(`${compte.size} domaine(s) co-cites, ${omnipresents.size} ecarte(s) comme omnipresents, ${retenus.length} retenus`);
  return new Map(retenus.map(([d]) => [d, 1]));
}

async function semer() {
  const prioritaires = String(arg("prioritaires", "") || "")
    .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const massives = String(arg("massives", "tradingview.com,myfxbook.com"))
    .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

  const CHEMINS = [
    "/blog", "/blog/", "/tools", "/outils", "/partners", "/partenaires", "/integrations",
    "/reviews", "/avis", "/resources", "/ressources", "/directory", "/annuaire",
    "/comparison", "/alternatives", "/best-trading-journals", "/trading-tools",
  ];

  // ⛔ LES GRAINES SONT LES DOMAINES QUI VOUS CITENT DEJA, pas vos concurrents.
  const cocitation = arg("cocitation");
  if (cocitation) {
    const graines = cocitation.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const parVoisin = semerCoCitation(graines, Number(arg("plafond", 4000)));
    let m = 0;
    bd.exec("BEGIN");
    for (const [v, p] of parVoisin) {
      if (enfiler(`https://${v}/`, 0, p)) m++;
      for (const c of CHEMINS) enfiler(`https://${v}${c}`, 1, p);
    }
    bd.exec("COMMIT");
    dire(`${m} domaine(s) co-cite(s) mis en file en priorite 1`);
    return;
  }

  const fichier = arg("fichier");
  if (fichier) {
    const parVoisin = semerDepuisFichier(fichier, prioritaires, massives);
    const compte = {};
    for (const p of parVoisin.values()) compte[p] = (compte[p] || 0) + 1;
    dire(`${parVoisin.size} domaine(s) voisin(s) depuis ${fichier} : ` +
      Object.entries(compte).map(([p, n]) => `${n} en priorite ${p}`).join(", "));
    let m = 0;
    bd.exec("BEGIN");
    for (const [v, p] of parVoisin) {
      if (enfiler(`https://${v}/`, 0, p)) m++;
      if (p <= 2) for (const c of CHEMINS) enfiler(`https://${v}${c}`, 1, p);
    }
    bd.exec("COMMIT");
    dire(`${m} accueil(s) mis en file`);
    return;
  }

  const COMPTE = process.env.CLOUDFLARE_ACCOUNT_ID;
  const JETON = process.env.CLOUDFLARE_API_TOKEN;
  const BASE = process.env.VIGIE_D1;
  if (!COMPTE || !JETON || !BASE) {
    console.error("⛔ identifiants Cloudflare absents : impossible de lire la liste des voisins.");
    process.exit(2);
  }

  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${COMPTE}/d1/database/${BASE}/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${JETON}`, "content-type": "application/json" },
      body: JSON.stringify({
        sql:
          "SELECT domaine_src, cible FROM referents " +
          "UNION SELECT domaine_src, cible FROM backlinks",
      }),
    }
  );
  const d = await r.json();
  if (!d.success) { console.error("lecture D1 en echec :", JSON.stringify(d.errors).slice(0, 200)); process.exit(1); }

  // ⛔ L ORDRE DE PASSAGE EST DICTE PAR LA CIBLE D OU VIENT LE VOISIN.
  //    Les domaines qui citent VOS concurrents directs sont ceux qui peuvent vous citer.
  //    Ceux qui citent un geant du secteur sont, pour l essentiel, des sites de finance
  //    generalistes qui ne citeront jamais un petit outil : ils passent en dernier.
  const parVoisin = new Map();
  for (const l of d.result?.[0]?.results || []) {
    const v = l.domaine_src;
    const c = String(l.cible || "").toLowerCase();
    if (!v) continue;
    let p = 3;
    if (prioritaires.length && prioritaires.includes(c)) p = 1;
    else if (massives.includes(c)) p = 5;
    else p = 2;
    parVoisin.set(v, Math.min(parVoisin.get(v) ?? 9, p));
  }

  const compte = { 1: 0, 2: 0, 3: 0, 5: 0 };
  for (const p of parVoisin.values()) compte[p] = (compte[p] || 0) + 1;
  dire(
    `${parVoisin.size} domaine(s) voisin(s) a semer : ` +
      `${compte[1] || 0} prioritaire(s), ${compte[2] || 0} de concurrents, ${compte[5] || 0} de sites massifs`
  );

  let n = 0;
  bd.exec("BEGIN");
  for (const [v, p] of parVoisin) {
    if (enfiler(`https://${v}/`, 0, p)) n++;
    if (p <= 2) for (const c of CHEMINS) enfiler(`https://${v}${c}`, 1, p);
  }
  bd.exec("COMMIT");
  dire(`${n} accueil(s) mis en file, plus leurs pages a liens pour les prioritaires`);
}

/* --------------------------------------------------------------------- main */

if (process.argv.includes("--etat")) {
  const f = bd.prepare("SELECT etat, COUNT(*) AS n FROM file GROUP BY etat").all();
  const l = bd.prepare("SELECT COUNT(*) AS liens, COUNT(DISTINCT domaine_dest) AS cibles, COUNT(DISTINCT domaine_src) AS sources FROM liens").get();
  const h = bd.prepare("SELECT COUNT(*) AS n FROM hotes WHERE mur = 0").get();
  console.log("file :", f.map((x) => `${x.etat}=${x.n}`).join("  "));
  const oc = bd.prepare("SELECT COUNT(*) AS n FROM hotes WHERE occupe_jusqu_a > ?").get(new Date().toISOString());
  console.log("hotes verrouilles a l instant :", oc.n);
  console.log("index :", `${l.liens} lien(s), ${l.sources} source(s), ${l.cibles} domaine(s) cible(s) distincts`);
  console.log("hotes ouverts :", h.n);
  console.log("base :", (fs.statSync(BD).size / 1024 / 1024).toFixed(1), "Mo");
  process.exit(0);
}

if (process.argv.includes("--semer")) {
  await semer();
  process.exit(0);
}

dire(`robot demarre : bande de priorite ${PRIO_MIN}-${PRIO_MAX}, ${EN_VOL} hotes en parallele, ${DELAI_HOTE} ms entre deux pages d'un meme hote`);
const attente = bd.prepare("SELECT COUNT(*) AS n FROM file WHERE etat = 'attente' AND priorite BETWEEN ? AND ?").get(PRIO_MIN, PRIO_MAX);
dire(`${attente.n} page(s) en file`);
if (!attente.n) {
  dire(`file vide dans la bande ${PRIO_MIN}-${PRIO_MAX} : semez, ou elargissez la bande`);
  process.exit(0);
}

const minuterie = setInterval(() => {
  const f = bd.prepare("SELECT COUNT(*) AS n FROM file WHERE etat = 'attente' AND priorite BETWEEN ? AND ?").get(PRIO_MIN, PRIO_MAX);
  dire(`${pagesLues} page(s) lue(s), ${liensNotes} lien(s) note(s), ${f.n} en file dans ma bande`);
}, 60000);

await Promise.all(Array.from({ length: EN_VOL }, () => lecteur()));
clearInterval(minuterie);
dire(`termine : ${pagesLues} page(s), ${liensNotes} lien(s)`);
