// PREPARE LE FICHIER DES SOMMETS POUR LA RECHERCHE PAR DICHOTOMIE.
//
// Le fichier des sommets de Common Crawl porte, une ligne par domaine du web :
//     identifiant <TAB> domaine inverse <TAB> compteur
// Il est TRIE par domaine inverse, et l'identifiant EST le numero de ligne. Les deux
// colonnes sont donc croissantes en meme temps, ce qui est la propriete sur laquelle
// tout repose ici :
//
//   - chercher « tradezella.com » revient a chercher « com.tradezella » par dichotomie
//     sur la colonne 2 ;
//   - resoudre un identifiant en nom revient a chercher par dichotomie sur la colonne 1.
//
// ⛔ POURQUOI ON DECOMPRESSE AU LIEU DE TOUT CHARGER.
//    Le fichier porte plus de 300 millions de domaines. Une table nom vers identifiant
//    en memoire coute plusieurs dizaines de gigaoctets en JavaScript : impossible sur
//    une machine a 8 Go, et inutile. Un fichier trie se cherche par dichotomie avec une
//    quinzaine de lectures de 64 Ko, sans rien garder.
//
// ⛔ ET POURQUOI PAS D'INDEX D'OFFSETS.
//    Un index « numero de ligne vers position en octets » couterait 2,4 Go pour ne rien
//    apporter : puisque la colonne 1 est elle aussi croissante, la meme dichotomie par
//    sondage d'octets sert aux deux sens de recherche.
//
// Usage :
//   node serveur/graphe-index.mjs              decompresse et controle
//   node serveur/graphe-index.mjs --controle   controle seulement

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { DOSSIER, FICHIERS } from "./graphe-telecharger.mjs";

export const SOMMETS_TXT = path.join(DOSSIER, "sommets.txt");

const go = (o) => (o / 1024 / 1024 / 1024).toFixed(2) + " Go";

/** Le domaine, a l'envers, comme Common Crawl l'ecrit : exemple.com -> com.exemple */
export const inverser = (domaine) =>
  String(domaine).toLowerCase().replace(/^www\./, "").split(".").reverse().join(".");

export const remettre = (inverse) => String(inverse).split(".").reverse().join(".");

async function decompresser() {
  if (fs.existsSync(SOMMETS_TXT) && fs.statSync(SOMMETS_TXT).size > 0) {
    console.log(`sommets deja decompresses : ${go(fs.statSync(SOMMETS_TXT).size)}`);
    return;
  }
  console.log("decompression des sommets...");
  const debut = Date.now();
  await pipeline(
    fs.createReadStream(FICHIERS.sommets.local),
    zlib.createGunzip(),
    fs.createWriteStream(SOMMETS_TXT)
  );
  console.log(`  ${go(fs.statSync(SOMMETS_TXT).size)} en ${Math.round((Date.now() - debut) / 1000)} s`);
}

/* ------------------------------------------------- la dichotomie par sondage */

/**
 * Lit la ligne COMPLETE qui commence apres la position donnee.
 * Rend { debut, fin, ligne } ou null si on est au bout du fichier.
 */
function ligneApres(fd, position, taille, tampon) {
  if (position >= taille) return null;
  let p = position;
  // On recule au debut de ligne si on est tombe au milieu de l'une d'elles.
  if (p > 0) {
    const lu = fs.readSync(fd, tampon, 0, Math.min(tampon.length, taille - p), p);
    const saut = tampon.subarray(0, lu).indexOf(10);
    if (saut < 0) return null;
    p += saut + 1;
  }
  if (p >= taille) return null;
  const lu = fs.readSync(fd, tampon, 0, Math.min(tampon.length, taille - p), p);
  const fin = tampon.subarray(0, lu).indexOf(10);
  const brut = tampon.subarray(0, fin < 0 ? lu : fin).toString("utf8");
  return { debut: p, fin: p + (fin < 0 ? lu : fin) + 1, ligne: brut.replace(/\r$/, "") };
}

/**
 * Cherche par dichotomie dans le fichier trie.
 * `cle` extrait la valeur comparable d'une ligne, `compare` la compare a la cible.
 * Rend la ligne trouvee, ou null.
 */
export function chercher(fd, taille, cible, cle, compare) {
  const tampon = Buffer.allocUnsafe(1 << 16);
  let bas = 0;
  let haut = taille;
  let tours = 0;

  while (bas < haut && tours < 64) {
    tours++;
    const milieu = Math.floor((bas + haut) / 2);
    const l = ligneApres(fd, milieu, taille, tampon);
    if (!l) { haut = milieu; continue; }
    const c = compare(cle(l.ligne), cible);
    if (c === 0) return l.ligne;
    if (c < 0) bas = l.fin; else haut = milieu;
  }

  // Le dernier segment se lit en clair : la dichotomie s'arrete sur un intervalle
  // court, et le balayer coute moins qu'un tour de plus.
  const tamponFin = Buffer.allocUnsafe(Math.min(1 << 20, Math.max(1, haut - bas) + 4096));
  const lu = fs.readSync(fd, tamponFin, 0, Math.min(tamponFin.length, taille - bas), bas);
  for (const ligne of tamponFin.subarray(0, lu).toString("utf8").split("\n")) {
    const propre = ligne.replace(/\r$/, "");
    if (!propre) continue;
    if (compare(cle(propre), cible) === 0) return propre;
  }
  return null;
}

const colonneNom = (ligne) => ligne.split("\t")[1] || "";
const colonneId = (ligne) => Number(ligne.split("\t")[0]);

const compareTexte = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compareNombre = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** L'identifiant Common Crawl d'un domaine, ou null s'il est absent du graphe. */
export function idDeDomaine(fd, taille, domaine) {
  const ligne = chercher(fd, taille, inverser(domaine), colonneNom, compareTexte);
  return ligne ? Number(ligne.split("\t")[0]) : null;
}

/** Le domaine d'un identifiant, ou null. */
export function domaineDeId(fd, taille, id) {
  const ligne = chercher(fd, taille, Number(id), colonneId, compareNombre);
  return ligne ? remettre(ligne.split("\t")[1] || "") : null;
}

export function ouvrirSommets() {
  const fd = fs.openSync(SOMMETS_TXT, "r");
  return { fd, taille: fs.fstatSync(fd).size };
}

/* --------------------------------------------------------------------- main */

if (process.argv[1] && process.argv[1].endsWith("graphe-index.mjs")) {
  if (!process.argv.includes("--controle")) await decompresser();

  const { fd, taille } = ouvrirSommets();
  console.log(`\ncontrole sur ${go(taille)} :`);

  // ⛔ ON CONTROLE SUR DES DOMAINES DONT ON CONNAIT DEJA LA REPONSE. Une dichotomie
  //    fausse rend « absent » pour tout, ce qui ressemble exactement a « ce domaine
  //    n'est pas dans le graphe ». Sans temoin, le bogue passe pour une mesure.
  const temoins = ["wikipedia.org", "github.com", "cloudflare.com", "lemonde.fr", "commoncrawl.org"];
  let bons = 0;
  for (const d of temoins) {
    const id = idDeDomaine(fd, taille, d);
    const retour = id === null ? null : domaineDeId(fd, taille, id);
    const ok = id !== null && retour === d;
    if (ok) bons++;
    console.log(`  ${ok ? "ok " : "KO "} ${d.padEnd(18)} id=${id === null ? "absent" : id}${retour && retour !== d ? ` (retour: ${retour})` : ""}`);
  }
  fs.closeSync(fd);

  if (bons < temoins.length) {
    console.error(`\n⛔ ${temoins.length - bons} temoin(s) en echec : la recherche est fausse, pas le graphe.`);
    process.exit(1);
  }
  console.log("\nindex utilisable. Etape suivante : node serveur/graphe-referents.mjs --cibles=exemple.com");
}
