// TELECHARGE LE GRAPHE DE LIENS DU WEB, ET C'EST LA PIECE QUI CHANGE TOUT.
//
// ⛔ LE CONSTAT QUI JUSTIFIE CE FICHIER, MESURE LE 21/08/2026.
//    On a d'abord cherche les backlinks en interrogeant des moteurs de recherche depuis
//    un Worker Cloudflare. Resultat en production : Brave HTTP 429, Mojeek HTTP 403,
//    SearX requete ignoree, Google News HTTP 503. Vingt-trois pages ouvertes, ZERO lien
//    confirme, sur un domaine qui en a des milliers.
//    Ce n'etait pas un reglage a corriger : c'etait la mauvaise methode. Ahrefs, Semrush
//    et Majestic n'interrogent pas de moteurs. Ils font tourner LEUR PROPRE robot sur le
//    web entier et gardent le graphe des liens. Aucun operateur « link: » ne survit dans
//    les moteurs grand public, et aucun ne respecte plus les guillemets.
//
//    L'equivalent gratuit de ce crawl existe et il est public : le graphe hyperliens de
//    COMMON CRAWL, reconstruit chaque trimestre sur des milliards de pages. C'est la meme
//    methode, avec un trimestre de retard au lieu du temps reel.
//
// Deux fichiers, et ils ne se lisent pas de la meme facon :
//   domain-vertices.txt.gz  ~840 Mo : « identifiant <TAB> domaine inverse <TAB> compteur »
//                                     trie par domaine inverse, donc l'identifiant EST le
//                                     numero de ligne. C'est ce qui permet de chercher un
//                                     domaine par dichotomie sans charger 300 millions de
//                                     noms en memoire.
//   domain-edges.txt.gz     ~9,8 Go : « identifiant source <TAB> identifiant cible »
//                                     trie par SOURCE. On cherche par CIBLE, donc il faut
//                                     le parcourir en entier a chaque passe. Vingt minutes.
//
// ⛔ NE JAMAIS CHARGER CES FICHIERS EN MEMOIRE. 9,8 Go compresses font environ 40 Go
//    decompresses, pour 2,7 milliards d'aretes. Tout se lit en FLUX, ligne a ligne.
//
// ⛔ ET NE JAMAIS LANCER CECI SUR UN PARTAGE DE CONNEXION MOBILE NI SUR UN FORFAIT AU Go.
//    Onze gigaoctets partent au premier lancement.
//
// Usage :
//   node serveur/graphe-telecharger.mjs                 telecharge ce qui manque
//   node serveur/graphe-telecharger.mjs --etat          dit ce qui est present, sans rien faire
//   node serveur/graphe-telecharger.mjs --crawl=<nom>   vise une autre edition

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const arg = (nom, defaut = null) => {
  const t = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return t ? t.slice(nom.length + 3) : defaut;
};

export const CRAWL = arg("crawl", process.env.VIGIE_CRAWL || "cc-main-2026-may-jun-jul");
export const DOSSIER = arg("dossier", process.env.VIGIE_GRAPHE || "C:/vigie/graphe");

const BASE = `https://data.commoncrawl.org/projects/hyperlinkgraph/${CRAWL}/domain`;

export const FICHIERS = {
  sommets: { url: `${BASE}/${CRAWL}-domain-vertices.txt.gz`, local: path.join(DOSSIER, "sommets.txt.gz") },
  aretes: { url: `${BASE}/${CRAWL}-domain-edges.txt.gz`, local: path.join(DOSSIER, "aretes.txt.gz") },
};

const go = (o) => (o / 1024 / 1024 / 1024).toFixed(2) + " Go";

/** La taille annoncee par le serveur, ou null. */
async function tailleDistante(url) {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!r.ok) return null;
    const n = Number(r.headers.get("content-length"));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Telecharge en REPRENANT ou ca s'est arrete.
 *
 * ⛔ UNE COUPURE A 9 Go SUR 9,8 NE DOIT PAS FAIRE TOUT RECOMMENCER. Le serveur de
 *    Common Crawl accepte l'en-tete Range ; sans reprise, une seule coupure reseau
 *    coute une heure et l'echec est silencieux (on se retrouve avec un fichier tronque
 *    qui se decompresse en partie, donc qui a l'air de marcher).
 */
async function telecharger(url, destination) {
  const attendue = await tailleDistante(url);
  let deja = 0;
  try { deja = fs.statSync(destination).size; } catch { /* pas encore la */ }

  if (attendue && deja === attendue) {
    console.log(`  deja complet : ${go(deja)}`);
    return;
  }
  if (deja > 0 && attendue && deja > attendue) {
    console.log(`  fichier plus gros que la source, on repart de zero`);
    fs.rmSync(destination);
    deja = 0;
  }

  const entetes = { "user-agent": "VigieBot/1.0 (+https://vigie-seo.pages.dev/)" };
  if (deja > 0) entetes.range = `bytes=${deja}-`;

  const r = await fetch(url, { headers: entetes, redirect: "follow" });
  if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status} sur ${url}`);
  if (deja > 0 && r.status !== 206) {
    console.log("  le serveur ignore la reprise, on repart de zero");
    fs.rmSync(destination);
    deja = 0;
  }

  const total = attendue || deja + Number(r.headers.get("content-length") || 0);
  let recu = deja;
  let dernier = Date.now();
  const debut = Date.now();

  const sortie = fs.createWriteStream(destination, { flags: deja > 0 ? "a" : "w" });
  const compteur = new TransformStream({
    transform(morceau, ctrl) {
      recu += morceau.length;
      if (Date.now() - dernier > 15000) {
        dernier = Date.now();
        const vitesse = (recu - deja) / ((Date.now() - debut) / 1000) / 1024 / 1024;
        const part = total ? ((recu / total) * 100).toFixed(1) + " %" : "?";
        console.log(`  ${go(recu)} / ${total ? go(total) : "?"} (${part}) a ${vitesse.toFixed(1)} Mo/s`);
      }
      ctrl.enqueue(morceau);
    },
  });

  await pipeline(r.body.pipeThrough(compteur), sortie);
  console.log(`  termine : ${go(fs.statSync(destination).size)}`);
}

/* --------------------------------------------------------------------- main */

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("graphe-telecharger.mjs")) {
  fs.mkdirSync(DOSSIER, { recursive: true });

  if (process.argv.includes("--etat")) {
    console.log(`edition : ${CRAWL}`);
    console.log(`dossier : ${DOSSIER}`);
    for (const [nom, f] of Object.entries(FICHIERS)) {
      let taille = 0;
      try { taille = fs.statSync(f.local).size; } catch { /* absent */ }
      const attendue = await tailleDistante(f.url);
      const etat = !taille ? "ABSENT" : attendue && taille === attendue ? "COMPLET" : "PARTIEL";
      console.log(`  ${nom.padEnd(8)} ${etat.padEnd(8)} ${go(taille)} / ${attendue ? go(attendue) : "?"}`);
    }
    process.exit(0);
  }

  const libre = (() => {
    try { return fs.statfsSync(DOSSIER).bavail * fs.statfsSync(DOSSIER).bsize; } catch { return null; }
  })();
  if (libre !== null && libre < 30 * 1024 ** 3) {
    console.error(`⛔ ${go(libre)} libres seulement. Il en faut 30 pour tenir le graphe et son index.`);
    process.exit(1);
  }

  for (const [nom, f] of Object.entries(FICHIERS)) {
    console.log(`${nom} : ${f.url}`);
    await telecharger(f.url, f.local);
  }
  console.log("\ngraphe complet. Etape suivante : node serveur/graphe-index.mjs");
}
