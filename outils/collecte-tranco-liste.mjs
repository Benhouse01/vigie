// RANG TRANCO DE TOUS LES DOMAINES CONNUS, PAR LA LISTE COMPLETE.
//
// Pourquoi une liste plutot que l'API : l'API de Tranco repond un domaine a la fois. Pour
// les 2 200 domaines qui pointent vers nous ou vers nos concurrents, ce serait 2 200
// appels reseau, plusieurs dizaines de minutes, et un risque de limitation. La liste
// complete pese 9,7 Mo compresses, se telecharge en une fois, et rend ensuite tous les
// rangs instantanement, sans un seul appel de plus.
//
// A quoi ca sert : la note du site emetteur repose a 35 % sur la POPULARITE REELLE. Sans
// ce rang, cette composante reste en angle mort sur presque tous les domaines referents,
// et la note se replie sur OpenPageRank, c'est-a-dire sur du volume de liens, c'est-a-dire
// exactement la metrique manipulable qu'on refuse de reproduire.
//
// ⛔ ABSENT DE LA LISTE N'EST PAS UN ANGLE MORT, C'EST UNE MESURE. Tranco couvre le
//    million de domaines les plus frequentes. Un domaine absent a ete regarde et n'y est
//    pas : c'est une mesure de faiblesse (MESURE_ABSENT), pas un trou de collecte. La
//    distinction change la note : un angle mort retire son poids du calcul, une mesure
//    absente entre au calcul a sa valeur basse.
//
// ⛔ ON COMPARE LE DOMAINE NU. La liste porte « example.com », jamais « www.example.com »
//    ni un sous-domaine. Comparer sans normaliser ferait sortir la moitie des domaines en
//    « absent » alors qu'ils sont dans la liste.
//
// Usage :
//   node outils/collecte-tranco-liste.mjs [--recharger] [--dry]

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { observation, ecrire, nouveauRun, lire, dernier } from "./_lib-obs.mjs";

const VERSION = "collecte-tranco-liste@1.0.0";
const ICI = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(ICI, ".cache");
const ZIP = path.join(CACHE, "tranco-top1m.zip");
const URL_LISTE = "https://tranco-list.eu/top-1m.csv.zip";

const DRY = process.argv.includes("--dry");
const RECHARGER = process.argv.includes("--recharger");

fs.mkdirSync(CACHE, { recursive: true });

// Une liste de la veille reste parfaitement utilisable : le classement bouge de quelques
// pour cent par jour. On ne retelecharge que si elle a plus de sept jours.
const frais = fs.existsSync(ZIP) && (Date.now() - fs.statSync(ZIP).mtimeMs) < 7 * 86400000;
if (!frais || RECHARGER) {
  process.stdout.write(`telechargement de la liste Tranco … `);
  const r = await fetch(URL_LISTE, { redirect: "follow" });
  if (!r.ok) {
    console.log(`ECHEC HTTP ${r.status}`);
    process.exit(1);
  }
  fs.writeFileSync(ZIP, Buffer.from(await r.arrayBuffer()));
  console.log(`${(fs.statSync(ZIP).size / 1048576).toFixed(1)} Mo`);
} else {
  console.log(`liste Tranco en cache (${Math.round((Date.now() - fs.statSync(ZIP).mtimeMs) / 3600000)} h)`);
}

/**
 * Extraction du CSV depuis le ZIP, sans dependance.
 * ⛔ Un ZIP n'est pas un gzip : il porte des en-tetes locaux avant chaque fichier. On
 *    lit donc l'en-tete pour connaitre la taille des champs variables, puis on inflate
 *    en RAW (inflateRawSync), parce que le flux d'un ZIP n'a pas d'en-tete zlib.
 */
function csvDuZip(chemin) {
  const buf = fs.readFileSync(chemin);
  const sig = buf.readUInt32LE(0);
  if (sig !== 0x04034b50) throw new Error("ce fichier n'est pas un ZIP (signature inattendue)");
  const methode = buf.readUInt16LE(8);
  const tailleNom = buf.readUInt16LE(26);
  const tailleExtra = buf.readUInt16LE(28);
  const debut = 30 + tailleNom + tailleExtra;
  const corps = buf.subarray(debut);
  if (methode === 0) return corps.toString("utf8");
  return zlib.inflateRawSync(corps).toString("utf8");
}

process.stdout.write("lecture de la liste … ");
const csv = csvDuZip(ZIP);
const rangs = new Map();
for (const ligne of csv.split("\n")) {
  const v = ligne.indexOf(",");
  if (v < 1) continue;
  const rang = Number(ligne.slice(0, v));
  const dom = ligne.slice(v + 1).trim().toLowerCase();
  if (rang && dom) rangs.set(dom, rang);
}
console.log(`${rangs.size.toLocaleString("fr-FR")} domaines`);

// Tous les domaines qu'on connait : les nôtres, les concurrents, et surtout les emetteurs.
const { obs } = lire();
const photo = dernier(obs);
const connus = new Set();
for (const o of photo) {
  if (o.sujet?.domaine) connus.add(o.sujet.domaine);
  if (o.objet?.domaine) connus.add(o.objet.domaine);
}
// On ne repasse pas ceux que l'API a deja mesures aujourd'hui : sa donnee est plus fine
// (elle porte l'historique), et deux sources sur la meme metrique le meme jour se
// marcheraient dessus dans la photo.
const dejaParApi = new Set(
  photo.filter((o) => o.metrique === "tranco_rang" && o.source?.nom === "tranco").map((o) => o.sujet?.domaine)
);

const run = nouveauRun("tranco-liste");
const sortie = [];
let trouves = 0, absents = 0;
for (const d of connus) {
  if (!d || dejaParApi.has(d)) continue;
  const nu = d.replace(/^www\./i, "").toLowerCase();
  const rang = rangs.get(nu) ?? null;
  if (rang) {
    trouves++;
    sortie.push(observation({
      type: "autorite", sujet: { domaine: d }, metrique: "tranco_rang",
      valeur: rang, unite: "rang", nature: "mesure", etat: "MESURE",
      source: { nom: "tranco_liste", endpoint: URL_LISTE, http: 200, methode: "fichier" },
      preuve: `rang ${rang.toLocaleString("fr-FR")} dans la liste Tranco du jour (${rangs.size.toLocaleString("fr-FR")} domaines)`,
      run_id: run, collecteur: VERSION,
    }));
  } else {
    absents++;
    sortie.push(observation({
      type: "autorite", sujet: { domaine: d }, metrique: "tranco_rang",
      unite: "rang", nature: "mesure_absente", etat: "MESURE_ABSENT",
      source: { nom: "tranco_liste", endpoint: URL_LISTE, http: 200, methode: "fichier" },
      preuve: `absent du million de domaines Tranco : le domaine a ete cherche et il n y est pas`,
      run_id: run, collecteur: VERSION,
    }));
  }
}

console.log(`\n${trouves.toLocaleString("fr-FR")} domaine(s) classe(s), ${absents.toLocaleString("fr-FR")} hors du top 1M (mesure, pas angle mort)`);
console.log(DRY
  ? `--dry : ${sortie.length} observations NON ecrites.`
  : `${ecrire(sortie)} observation(s) ecrite(s) (${sortie.length} calculee(s)).`);
