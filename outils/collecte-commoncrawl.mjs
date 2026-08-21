// MESURE : quels domaines pointent vers un domaine, le votre comme celui d'un concurrent.
// SOURCE : le graphe de liens public de Common Crawl, publie par trimestre, en fichiers .gz.
// NE DIT PAS : ni l'URL du lien, ni son ancre, ni son rel, ni combien de liens il y a.
//
// ⛔ ⛔  AVERTISSEMENT : UN CYCLE COMPLET TELECHARGE ENVIRON 11 Go.  ⛔ ⛔
//    839 Mo pour les sommets, 9,8 Go pour les aretes, puis 839 Mo de nouveau pour la
//    resolution, qui relit les sommets une seconde fois. NE LANCEZ PAS CE COLLECTEUR SUR UN
//    PARTAGE DE CONNEXION MOBILE, sur un forfait compte au Go, ni sur une liaison facturee
//    a la consommation : une fois le transfert commence, rien ne vous le rappellera.
//    Deux garde-fous, qui ne remplacent pas la lecture de ce paragraphe :
//      - la taille annoncee par le serveur s'affiche AVANT chaque telechargement ;
//      - --max-go (12 Go par defaut) refuse un fichier plus gros que prevu avant de le lire.
//    Pour essayer sans risque : --sommets tout seul, 839 Mo, environ deux minutes.
//
// ⛔ POURQUOI CE FICHIER EXISTE, ET C'EST LE POINT CENTRAL DE L'OUTIL (21/08/2026) : pour
//    trouver ce qu'un outil payant trouve, il faut la MEME METHODE que lui, pas une astuce
//    de recoupement. Retrouver SES PROPRES backlinks en relisant ses notes de campagne
//    marche pour soi et pour personne d'autre : un concurrent ne dira jamais ou il a place
//    ses liens.
//
// CE QUE FAIT UN OUTIL DE BACKLINKS PAYANT : il crawle le web et enregistre, pour chaque
// page, ses liens sortants. CE QU'ON FAIT ICI : on prend un crawl du web deja fait, public
// et gratuit, et on lit son graphe. C'est la meme donnee, produite par le meme genre de
// robot, sans avoir a crawler le web depuis un portable.
//
// Common Crawl publie, par trimestre, deux fichiers :
//   domain-vertices.txt.gz   839 Mo : « identifiant <tab> domaine inverse <tab> compteur »
//   domain-edges.txt.gz     9,8 Go : « identifiant source <tab> identifiant cible »
// Le domaine est INVERSE : concurrent-un.com s'ecrit « com.concurrent-un ». C'est ce qui
// permet de trier tout le web par domaine et de retrouver un site en une recherche.
//
// ⛔ TROIS LIMITES A DIRE AVANT DE MONTRER LE CHIFFRE, sinon il se lit comme un total :
//   1. C'est un graphe DE DOMAINE A DOMAINE. Il donne qui pointe vers qui, jamais l'URL
//      exacte, jamais l'ancre, jamais le rel. Ces trois-la se lisent ensuite page par
//      page, avec collecte-rel.
//   2. Un domaine absent du crawl n'a pas zero backlink : il n'a pas ete crawle. Mesure
//      du 21/08/2026 : un domaine du panel, ecrit « com.exemple » dans le fichier, etait
//      ABSENT des sommets du crawl mai-juin-juillet 2026, alors qu'un outil payant lui
//      voyait au meme moment 250 sites referents. Il etait simplement trop jeune pour ce
//      trimestre-la. C'est une MESURE_ABSENTE, jamais un zero.
//   3. La donnee a l'age du crawl, pas celui du jour. Elle porte donc sa date_donnee.
//
// ⛔ ET LES ARETES SE LISENT EN FLUX, JAMAIS EN MEMOIRE : 9,8 Go compresses font environ
//    40 Go decompresses. Aucun de ces fichiers ne tient dans la memoire d'un portable.
//
// Les cibles viennent de la configuration (config/domaines.json, ou le fichier que designe
// VIGIE_CONFIG). Aucun domaine n'est ecrit dans ce fichier.
//
// Usage :
//   node outils/collecte-commoncrawl.mjs --sommets          (839 Mo, ~2 min)
//   node outils/collecte-commoncrawl.mjs --aretes           (9,8 Go, ~20 min)
//   node outils/collecte-commoncrawl.mjs --resoudre         (2e passe sommets, 839 Mo)
//   ... --crawl=cc-main-2026-may-jun-jul   --max-go=12   --dry

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { Readable } from "node:stream";
import { observation, ecrire, nouveauRun, config, RACINE } from "./_lib-obs.mjs";

const VERSION = "collecte-commoncrawl@1.0.0";

// ⛔ LE CACHE VA DANS <racine>/.cache/, JAMAIS DANS UN CHEMIN D'INSTALLATION EN DUR. Les
//    trois fichiers d'etat ci-dessous evitent de retelecharger 11 Go a chaque etape : ils
//    doivent donc SURVIVRE entre deux lancements, sans pour autant entrer dans l'historique
//    git (le .gitignore du depot les ignore deja). RACINE vient du socle, c'est le dossier
//    parent de outils/. Le dossier est cree au besoin.
const CACHE = path.join(RACINE, ".cache");
fs.mkdirSync(CACHE, { recursive: true });

const arg = (n, d = null) => {
  const v = (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  return v === undefined ? d : v;
};
const DRY = process.argv.includes("--dry");
const CRAWL = arg("crawl", "cc-main-2026-may-jun-jul");
const MAX_GO = Number(arg("max-go", 12));
const BASE = `https://data.commoncrawl.org/projects/hyperlinkgraph/${CRAWL}/domain`;
const URL_SOMMETS = `${BASE}/${CRAWL}-domain-vertices.txt.gz`;
const URL_ARETES = `${BASE}/${CRAWL}-domain-edges.txt.gz`;

const F_IDS = path.join(CACHE, `cc-${CRAWL}-ids.json`);
const F_SOURCES = path.join(CACHE, `cc-${CRAWL}-sources.json`);
const F_RESOLU = path.join(CACHE, `cc-${CRAWL}-resolu.json`);

const cfg = config();
const CIBLES = [...cfg.nous.map((d) => d.domaine), ...cfg.concurrents.map((d) => d.domaine)];

/** concurrent-un.com -> com.concurrent-un. C'est la forme du fichier, pas un detail. */
const inverse = (d) => d.split(".").reverse().join(".");

/**
 * Lit un .gz distant EN FLUX, ligne par ligne.
 * ⛔ Jamais de fichier complet en memoire : 9,8 Go compresses font environ 40 Go decompresses.
 */
async function parLigne(url, surLigne, { etiquette = "" } = {}) {
  const tete = await fetch(url, { method: "HEAD" });
  const taille = Number(tete.headers.get("content-length") || 0);
  if (taille / 1e9 > MAX_GO) {
    throw new Error(`${etiquette} pese ${(taille / 1e9).toFixed(1)} Go, au-dela du plafond de ${MAX_GO} Go. Relance avec --max-go=<n> si c'est voulu.`);
  }
  process.stdout.write(`  ${etiquette} ${(taille / 1e6).toFixed(0)} Mo … `);
  const t0 = Date.now();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${etiquette} : HTTP ${r.status}`);

  let lus = 0, lignes = 0, dernierPoint = Date.now();
  const flux = Readable.fromWeb(r.body);
  flux.on("data", (c) => {
    lus += c.length;
    if (Date.now() - dernierPoint > 20000) {
      dernierPoint = Date.now();
      process.stdout.write(`${Math.round((lus / taille) * 100)}% `);
    }
  });
  const rl = readline.createInterface({ input: flux.pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const ligne of rl) { lignes++; surLigne(ligne); }
  console.log(`fini · ${lignes.toLocaleString("fr-FR")} lignes en ${Math.round((Date.now() - t0) / 1000)} s`);
  return { lignes, octets: taille };
}

// ---------------------------------------------------------------- etape 1 : sommets

if (process.argv.includes("--sommets")) {
  const vise = new Map(CIBLES.map((d) => [inverse(d), d]));
  const trouves = {};
  await parLigne(URL_SOMMETS, (l) => {
    // ⛔ LE FICHIER A TROIS COLONNES, PAS DEUX : « id <tab> domaine inverse <tab> compteur ».
    //    Premiere version : elle prenait tout ce qui suit la premiere tabulation, donc
    //    « com.concurrent-un<tab>1 » au lieu de « com.concurrent-un », et AUCUN des
    //    domaines surveilles ne correspondait. Zero sur tout le panel, y compris des sites
    //    massifs qui sont evidemment dans Common Crawl (mesure du 21/08/2026). Un
    //    decoupage faux ne leve aucune erreur : il rend « absent », et
    //    « absent » se lit comme « pas de backlinks ».
    const c = l.split("\t");
    if (c.length < 2) return;
    const d = vise.get(c[1]);
    if (d) trouves[d] = Number(c[0]);
  }, { etiquette: "sommets" });
  fs.writeFileSync(F_IDS, JSON.stringify(trouves, null, 1), "utf8");
  console.log(`\n${Object.keys(trouves).length} domaine(s) sur ${CIBLES.length} presents dans le graphe :`);
  for (const d of CIBLES) {
    console.log(`  ${d.padEnd(22)} ${trouves[d] != null ? trouves[d] : "ABSENT du crawl — ce n est PAS zero backlink, c est un domaine non crawle"}`);
  }
}

// ---------------------------------------------------------------- etape 2 : aretes

if (process.argv.includes("--aretes")) {
  if (!fs.existsSync(F_IDS)) { console.error("lance d'abord --sommets."); process.exit(1); }
  const ids = JSON.parse(fs.readFileSync(F_IDS, "utf8"));
  const parId = new Map(Object.entries(ids).map(([d, i]) => [i, d]));
  const sources = new Map();                       // domaine cible -> Set d'identifiants sources
  for (const d of Object.keys(ids)) sources.set(d, new Set());

  await parLigne(URL_ARETES, (l) => {
    const c = l.split("\t");
    if (c.length < 2) return;
    const d = parId.get(Number(c[1]));
    if (!d) return;
    sources.get(d).add(Number(c[0]));
  }, { etiquette: "aretes" });

  const sortie = {};
  for (const [d, s] of sources) sortie[d] = [...s];
  fs.writeFileSync(F_SOURCES, JSON.stringify(sortie), "utf8");
  console.log("\nDomaines referents trouves dans le graphe :");
  for (const d of Object.keys(ids)) console.log(`  ${d.padEnd(22)} ${sortie[d].length.toLocaleString("fr-FR")}`);
}

// ---------------------------------------------------------------- etape 3 : resolution

if (process.argv.includes("--resoudre")) {
  if (!fs.existsSync(F_SOURCES)) { console.error("lance d'abord --aretes."); process.exit(1); }
  const sources = JSON.parse(fs.readFileSync(F_SOURCES, "utf8"));
  const aResoudre = new Set();
  for (const l of Object.values(sources)) for (const i of l) aResoudre.add(i);
  console.log(`  ${aResoudre.size.toLocaleString("fr-FR")} identifiant(s) source a resoudre en noms de domaine`);

  const noms = new Map();
  await parLigne(URL_SOMMETS, (l) => {
    const c = l.split("\t");
    if (c.length < 2) return;
    const id = Number(c[0]);
    if (!aResoudre.has(id)) return;
    // On remet le domaine a l'endroit : com.concurrent-un -> concurrent-un.com
    noms.set(id, c[1].split(".").reverse().join("."));
  }, { etiquette: "sommets (resolution)" });

  const resolu = {};
  for (const [d, l] of Object.entries(sources)) {
    resolu[d] = l.map((i) => noms.get(i)).filter(Boolean);
  }
  fs.writeFileSync(F_RESOLU, JSON.stringify(resolu), "utf8");

  const run = nouveauRun("commoncrawl");
  // La date de la donnee est celle du crawl, pas celle du jour. Le nom du crawl la porte :
  // cc-main-2026-may-jun-jul -> le trimestre se termine fin juillet.
  const m = /(\d{4})-([a-z]{3})-([a-z]{3})-([a-z]{3})/.exec(CRAWL);
  const MOIS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const dateDonnee = m ? `${m[1]}-${MOIS[m[4]] || "07"}-28T00:00:00Z` : null;

  const obs = [];
  for (const [cible, refs] of Object.entries(resolu)) {
    const uniques = [...new Set(refs)];
    obs.push(observation({
      type: "backlink", sujet: { domaine: cible }, metrique: "domaines_referents",
      valeur: uniques.length, unite: "domaine",
      // ⛔ « plancher » : un crawl du web ouvert est large, il n'est pas exhaustif.
      nature: "plancher", etat: "MESURE", valeur_min: uniques.length,
      source: { nom: "common_crawl", endpoint: URL_ARETES, http: 200, methode: "fichier" },
      date_donnee: dateDonnee,
      preuve: `${uniques.length} domaines referents lus dans le graphe de liens ${CRAWL}. Graphe DOMAINE A DOMAINE : ni URL, ni ancre, ni rel`,
      run_id: run, collecteur: VERSION,
      drapeaux: ["granularite_domaine_sans_url_ni_rel", "graphe_common_crawl"],
    }));
    for (const r of uniques) {
      obs.push(observation({
        type: "backlink", sujet: { domaine: cible }, objet: { domaine: r },
        metrique: "liens_depuis_domaine", valeur: 1, unite: "lien",
        nature: "plancher", etat: "MESURE",
        source: { nom: "common_crawl", endpoint: URL_ARETES, http: 200, methode: "fichier" },
        date_donnee: dateDonnee,
        preuve: `${r} -> ${cible}, arete du graphe ${CRAWL}. Le graphe ne compte pas les liens, il dit qu'il en existe au moins un`,
        run_id: run, collecteur: VERSION,
        drapeaux: ["granularite_domaine_sans_url_ni_rel", "graphe_common_crawl"],
      }));
    }
  }
  // Les cibles absentes du graphe : une mesure, pas un trou.
  const ids = JSON.parse(fs.readFileSync(F_IDS, "utf8"));
  for (const d of CIBLES) {
    if (ids[d] != null) continue;
    obs.push(observation({
      type: "backlink", sujet: { domaine: d }, metrique: "domaines_referents",
      unite: "domaine", nature: "mesure_absente", etat: "MESURE_ABSENT",
      source: { nom: "common_crawl", endpoint: URL_SOMMETS, http: 200, methode: "fichier" },
      date_donnee: dateDonnee,
      preuve: `domaine ABSENT des sommets du crawl ${CRAWL} : il n'a pas ete crawle sur ce trimestre. Ce n'est PAS zero backlink`,
      run_id: run, collecteur: VERSION, drapeaux: ["absent_du_crawl"],
    }));
  }

  console.log("\nDomaines referents resolus :");
  for (const [d, l] of Object.entries(resolu)) {
    const u = [...new Set(l)];
    console.log(`  ${d.padEnd(22)} ${String(u.length).padStart(6)}  ex. ${u.slice(0, 4).join(", ")}`);
  }
  console.log(DRY ? `\n--dry : ${obs.length} observations NON ecrites.` : `\n${ecrire(obs)} observation(s) ecrite(s) (${obs.length} calculee(s)).`);
}

if (!["--sommets", "--aretes", "--resoudre"].some((a) => process.argv.includes(a))) {
  console.log("Rien a faire. Etapes, dans l'ordre :");
  console.log(`  --sommets    839 Mo, ~2 min  : trouve l identifiant de vos ${CIBLES.length} domaine(s) dans le graphe`);
  console.log("  --aretes     9,8 Go, ~20 min : collecte les identifiants qui pointent vers eux");
  console.log("  --resoudre   839 Mo, ~2 min  : remet des noms de domaine sur ces identifiants");
  console.log("");
  // ⛔ L'AVERTISSEMENT EST REPETE ICI PARCE QUE C'EST L'ECRAN QUE VOIT CELUI QUI LANCE LE
  //    COLLECTEUR SANS ARGUMENT, donc la derniere occasion de le prevenir avant les 11 Go.
  console.log("⛔ un cycle complet telecharge environ 11 Go.");
  console.log("   Sur un partage de connexion mobile ou un forfait compte au Go : --sommets seul,");
  console.log(`   839 Mo, et rien d autre. Plafond en vigueur : --max-go=${MAX_GO}.`);
}
