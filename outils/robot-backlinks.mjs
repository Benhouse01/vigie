// LE ROBOT : un crawl A LA DEMANDE, sur un domaine, a la recherche de ses backlinks.
//
// ⛔ CE QU'IL EST, ET CE QU'IL N'EST PAS. Ahrefs et Semrush crawlent le web en permanence
//    avec des fermes de serveurs. On ne refera pas ca depuis un portable, et le pretendre
//    serait mentir. Ce robot fait autre chose, qui donne le meme resultat sur un domaine
//    donne : au lieu de crawler le web au hasard en esperant tomber sur une mention, il
//    part des endroits ou une mention a une chance d'exister, et il les lit vraiment.
//
// LES QUATRE SOURCES DE LA FILE D'ATTENTE, par ordre de rendement mesure :
//
//   1. LES REFERENTS DES CONCURRENTS. C'est de loin la meilleure, et elle vient du graphe
//      Common Crawl deja collecte : des dizaines de milliers de domaines qui pointent vers
//      les concurrents declares dans votre configuration. Un site qui cite un outil d'un
//      secteur en cite souvent deux. C'est aussi la seule facon de repondre a « ou sont-ils
//      places, et est-ce qu'on y est ».
//   2. LES MOTEURS, sur le nom de marque. Une page qui vous nomme vous lie souvent.
//      Brave se lit en HTTP simple, sans navigateur, et repond quand Google et Bing
//      refusent l'adresse IP.
//   3. LES REFERENTS DEJA CONNUS, pour verifier qu'un lien tient toujours. Un backlink qui
//      tombe ne fait aucun bruit.
//   4. LES ANNUAIRES ET AGREGATEURS ou vivent vos fiches. Liste par defaut generaliste,
//      remplacable par le champ `annuaires` de votre configuration.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⛔ LA POLITESSE, ET ELLE N'EST PAS NEGOCIABLE.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
//    Ce programme va lire des sites qui ne vous appartiennent pas, depuis votre adresse IP,
//    et souvent des sites que vous cherchez a convaincre de vous publier. Un robot impoli
//    ne fait pas que se faire bloquer : il vous fait passer pour un mauvais citoyen aupres
//    de gens dont vous voulez quelque chose. Le cout d'un blocage n'est pas technique, il
//    est commercial, et il ne se repare pas.
//
//    CINQ REGLES, DANS CET ORDRE, ET AUCUNE N'EST OPTIONNELLE :
//
//    1. LE robots.txt EST LU AVANT LE PREMIER APPEL SUR L'HOTE, jamais apres.
//       reglesDe() est appele avant toute autre requete vers cet hote, et son resultat est
//       garde en memoire pour la duree du crawl : un hote ne voit donc son robots.txt
//       demande qu'une seule fois. Un Disallow: / fait SORTIR l'hote du crawl, et cette
//       sortie est ecrite au journal comme un ANGLE_MORT, pas comme un « rien trouve ».
//       La difference compte : « je n'ai pas eu le droit de regarder » n'est pas
//       « j'ai regarde et il n'y a rien ».
//
//    2. UNE SEULE REQUETE EN VOL PAR HOTE, ET UN DELAI ENTRE DEUX.
//       La boucle est sequentielle par construction : attendreSonTour() garde la date du
//       dernier appel par hote et dort le temps qu'il faut avant le suivant. Aucun
//       Promise.all, aucune concurrence. Le parallelisme est ce qui transforme un crawl
//       poli en petite attaque, et il ne fait gagner que du temps a celui qui crawle.
//
//    3. ON S'ANNONCE, AVEC UN MOYEN DE NOUS JOINDRE.
//       Le User-Agent vient du module commun, il nomme l'outil et porte l'adresse du
//       projet. Un administrateur qui trouve ces requetes dans ses journaux doit pouvoir
//       savoir a qui il a affaire, et pouvoir bloquer s'il le decide. C'est la
//       contrepartie normale du droit de lire son site.
//
//    4. TROIS BUDGETS QUI ARRETENT, PAS QUI RALENTISSENT.
//       Pages, minutes, hotes. Ils sont affiches au demarrage, ecrits dans le fichier
//       d'etat pendant le crawl, et testes a chaque tour de boucle. Un crawl sans limite
//       ne s'arrete pas tout seul : il tourne jusqu'a ce que quelqu'un s'en apercoive, et
//       ce quelqu'un est en general l'administrateur d'en face.
//
//    5. AU PLUS TROIS URL PAR HOTE.
//       Meme avec un delai, marteler trente pages d'un meme site pour y chercher un seul
//       lien est disproportionne. Trois suffisent, et le delai par hote reste le meme.
//
//    Ce qu'il ne faut PAS faire pour aller plus vite : baisser --delai sous la seconde,
//    lancer deux instances en parallele, ou passer un User-Agent de navigateur pour
//    contourner un blocage. Les trois marchent, les trois vous couteront plus cher que le
//    temps qu'elles font gagner.
//
// Usage :
//   node outils/robot-backlinks.mjs --cible=exemple.com
//   ... --pages=800 --minutes=20 --hotes=400 --delai=1500 --depuis=concurrents,moteurs,connus,annuaires
//   ... --etat        (avance du crawl en cours, lisible pendant qu'il tourne)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recupererFiable, liensVers, indexabilite, texteDe, signauxSpam, hote, UA } from "./_lib-liens.mjs";
import { observation, ecrire, nouveauRun, lire, dernier, config } from "./_lib-obs.mjs";

const VERSION = "robot-backlinks@1.0.0";
const ICI = path.dirname(fileURLToPath(import.meta.url));
const ETAT = path.join(ICI, ".cache", "robot-etat.json");
fs.mkdirSync(path.dirname(ETAT), { recursive: true });

// ⛔ REGLE DE POLITESSE 3 : ON S'ANNONCE, AVEC UNE ADRESSE OU L'ON PEUT NOUS JOINDRE.
//    Un robot anonyme qui aspire un site se fait bloquer, et il le merite. Le User-Agent
//    est celui du module commun (`UA`, importe ci-dessus, surchargeable par VIGIE_UA) et
//    il part sur TOUTES les requetes de ce fichier : le robots.txt, les pages, les
//    moteurs. Aucune exception, y compris pour le robots.txt, parce qu'un site a le droit
//    de servir des regles differentes selon le robot qui les demande.
//
//    ⛔ ET IL N'EST PAS ECRIT EN DUR ICI. Une chaine posee dans ce fichier partirait chez
//       chaque site visite en annoncant l'adresse de celui qui a ecrit le code, pas la
//       votre. L'administrateur d'en face ecrirait alors a la mauvaise personne, et vous
//       ne sauriez jamais qu'on vous a demande d'arreter.

const arg = (n, d = null) => {
  const v = (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  return v === undefined ? d : v;
};

if (process.argv.includes("--etat")) {
  if (!fs.existsSync(ETAT)) { console.log("aucun crawl en cours ni termine."); process.exit(0); }
  const e = JSON.parse(fs.readFileSync(ETAT, "utf8"));
  console.log(JSON.stringify(e, null, 1));
  process.exit(0);
}

const CIBLE = (arg("cible") || "").replace(/^www\./i, "").toLowerCase();
if (!CIBLE) { console.error("--cible=<domaine> est obligatoire."); process.exit(1); }
const MARQUE = CIBLE.split(".")[0];

const BUDGET_PAGES = Number(arg("pages", 800));
const BUDGET_MIN = Number(arg("minutes", 20));
const BUDGET_HOTES = Number(arg("hotes", 400));
const DELAI_HOTE = Number(arg("delai", 1500));
const DEPUIS = (arg("depuis", "concurrents,moteurs,connus,annuaires") || "").split(",").map((s) => s.trim());
const DRY = process.argv.includes("--dry");

const cfg = config();
const { obs: journal } = lire();
const photo = dernier(journal);

// ---------------------------------------------------------------- la file d'attente

/** Les domaines qui pointent vers nos CONCURRENTS : le meilleur vivier qui existe. */
function depuisConcurrents() {
  const concurrents = new Set(cfg.concurrents.map((d) => d.domaine));
  const compte = new Map();
  for (const o of photo) {
    if (o.metrique !== "liens_depuis_domaine") continue;
    if (!concurrents.has(o.sujet?.domaine) || !o.objet?.domaine) continue;
    const d = o.objet.domaine;
    // Un domaine qui cite PLUSIEURS concurrents est le meilleur candidat de tous :
    // c'est un comparatif, un annuaire ou une revue du secteur.
    compte.set(d, (compte.get(d) || 0) + 1);
  }
  return [...compte.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => ({ url: `https://${d}/`, hote: d, origine: `cite ${n} concurrent(s)`, poids: 100 + n * 10 }));
}

/** Les pages qui nomment la marque, vues par un moteur. */
async function depuisMoteurs() {
  const out = [];
  // ⛔ LA REQUETE SECTORIELLE VIENT DE VOTRE CONFIGURATION, PAS DU CODE. « <marque> journal
  //    de trading » ne rend service qu'a qui vend un journal de trading : ailleurs, elle
  //    consomme une requete moteur et un delai pour ramener du hors-sujet. Renseignez
  //    `secteur` dans domaines.json pour la votre. Sans lui, on s'en tient aux trois
  //    requetes qui fonctionnent dans tous les secteurs.
  const secteur = String(cfg.secteur || "").trim();
  const requetes = [
    `"${MARQUE}"`,
    ...(secteur ? [`${MARQUE} ${secteur}`] : []),
    `${MARQUE} avis`,
    `${MARQUE} review`,
  ];
  for (const q of requetes) {
    const u = `https://search.brave.com/search?q=${encodeURIComponent(q)}&count=20`;
    const r = await recupererFiable(u, { timeout: 20000, ua: UA }, 1);
    if (!r.ok || r.http !== 200) { console.log(`  moteur : « ${q} » -> HTTP ${r.http}, on passe`); continue; }
    let n = 0;
    for (const m of r.html.matchAll(/data-type="web"[\s\S]{0,900}?href="(https?:\/\/[^"]+)"/g)) {
      let x; try { x = new URL(m[1]); } catch { continue; }
      const h = x.hostname.replace(/^www\./, "").toLowerCase();
      if (h.endsWith("brave.com") || h === CIBLE) continue;
      out.push({ url: m[1], hote: h, origine: `moteur, requete ${q}`, poids: 80 });
      n++;
    }
    console.log(`  moteur : « ${q} » -> ${n} page(s)`);
    await patienter(3000);
  }
  return out;
}

/** Les referents deja connus : on repasse pour verifier que le lien tient toujours. */
function depuisConnus() {
  const out = [];
  const vus = new Set();
  for (const o of photo) {
    if (o.sujet?.domaine !== CIBLE) continue;
    const u = o.objet?.url || o.objet?.detail?.url_source;
    const d = o.objet?.domaine;
    if (!d) continue;
    const cle = u || `https://${d}/`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push({ url: cle, hote: d, origine: "referent deja connu, on verifie qu'il tient", poids: 120 });
  }
  return out;
}

/**
 * Les annuaires et agregateurs ou vivent les fiches produit.
 *
 * ⛔ CETTE LISTE PAR DEFAUT EST GENERALISTE, ET C'EST SA LIMITE. Ce sont des annuaires de
 *    logiciels, valables pour a peu pres n'importe quel outil en ligne. Les annuaires qui
 *    rapportent vraiment sont ceux de VOTRE metier, et personne ne peut les deviner a
 *    votre place : mettez-les dans le champ `annuaires` de domaines.json, sous forme
 *    d'URL completes, et cette liste-ci est alors remplacee.
 * ⛔ ON POSE L'URL EXACTE DE LA PAGE OU LA FICHE VIT, pas la racine du site. Un annuaire
 *    n'affiche jamais une fiche sur son accueil, et le robot ne lit que trois URL par hote.
 */
const ANNUAIRES_PAR_DEFAUT = [
  "https://alternativeto.net/software/", "https://www.saashub.com/", "https://betalist.com/",
  "https://pitchwall.co/", "https://justlaunched.fyi/", "https://www.launchingnext.com/",
  "https://peerpush.net/", "https://viberank.dev/", "https://microlaunch.net/",
  "https://www.producthunt.com/", "https://slashdot.org/software/",
];

function depuisAnnuaires() {
  const aVous = Array.isArray(cfg.annuaires) ? cfg.annuaires.filter((u) => typeof u === "string" && u.trim()) : [];
  const seeds = aVous.length ? aVous : ANNUAIRES_PAR_DEFAUT;
  const out = [];
  for (const u of seeds) {
    // ⛔ ON EXIGE UNE URL ABSOLUE, ET LE TEST NE PEUT PAS ETRE hote() SEUL. hote() resout
    //    ce qu'on lui donne contre une base fictive : la chaine « mon annuaire prefere » en
    //    ressort avec un hote parfaitement valide, et le robot irait crawler ce faux hote
    //    sans que rien n'ait l'air casse. Une entree de configuration mal ecrite doit se
    //    voir, pas se transformer en requete silencieuse vers un site au hasard.
    const h = /^https?:\/\//i.test(u.trim()) ? hote(u.trim()) : "";
    if (!h) { console.log(`  annuaire ignore, ce n'est pas une URL http(s) complete : ${String(u).slice(0, 80)}`); continue; }
    out.push({ url: u, hote: h, origine: aVous.length ? "annuaire de votre configuration" : "annuaire generaliste par defaut", poids: 60 });
  }
  return out;
}

const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

/** Quels concurrents cette page lie-t-elle ? C'est ce qui transforme un « rien trouve »
 *  en liste de prospection. */
const CONCURRENTS = cfg.concurrents.map((d) => d.domaine);
function concurrentsCites(html, hoteDeLaPage) {
  const out = [];
  for (const c of CONCURRENTS) {
    // ⛔ UN SITE QUI SE CITE LUI-MEME N'EST PAS UNE OPPORTUNITE. Sans ce test, le robot
    //    annoncait « concurrent-un.com cite concurrent-un.com et pas nous », ce qui est
    //    parfaitement vrai et parfaitement inutile : un concurrent ne vous publiera pas.
    if (c === hoteDeLaPage) continue;
    if (liensVers(html, c).length) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- politesse

/**
 * REGLE DE POLITESSE 1 : le robots.txt, LU AVANT le premier appel sur l'hote.
 *
 * ⛔ UNE SEULE LECTURE PAR HOTE ET PAR CRAWL. Le cache n'est pas une optimisation, c'est
 *    la politesse elle-meme : redemander le robots.txt a chaque URL tripleraient le
 *    nombre de requetes vues par le site.
 * ⛔ UN robots.txt ILLISIBLE OU ABSENT AUTORISE, ET C'EST LA NORME DU PROTOCOLE. Un site
 *    sans robots.txt n'a rien interdit. Refuser par defaut donnerait un crawl qui ne
 *    trouve rien, sans jamais dire pourquoi.
 * ⛔ ON NE LIT QUE LE BLOC user-agent: *. Ecrire un bloc a notre nom serait pretendre a un
 *    traitement particulier que personne ne nous a accorde : on prend les regles du
 *    tout-venant, qui sont les plus strictes.
 * ⛔ LES MOTIFS AVEC * NE SONT PAS INTERPRETES, ILS SONT IGNORES. Un motif mal compris
 *    autoriserait ce qui est interdit ; mieux vaut ne pas pretendre le comprendre. Les
 *    prefixes simples, eux, sont respectes a la lettre.
 */
const robotsParHote = new Map();
async function reglesDe(h) {
  if (robotsParHote.has(h)) return robotsParHote.get(h);
  const r = await recupererFiable(`https://${h}/robots.txt`, { timeout: 12000, ua: UA }, 1);
  let regles = { autorise: () => true, bloqueTout: false, lisible: false };
  if (r.ok && r.http === 200) {
    const txt = r.html.slice(0, 200000);
    const bloc = /user-agent:\s*\*([\s\S]*?)(?=\nuser-agent:|$)/i.exec(txt);
    const interdits = bloc
      ? [...bloc[1].matchAll(/^\s*disallow:\s*(\S+)\s*$/gim)].map((m) => m[1]).filter(Boolean)
      : [];
    const bloqueTout = interdits.includes("/");
    regles = {
      lisible: true,
      bloqueTout,
      autorise: (chemin) => !bloqueTout && !interdits.some((i) => i !== "/" && !i.includes("*") && chemin.startsWith(i)),
    };
  }
  robotsParHote.set(h, regles);
  return regles;
}

/**
 * REGLE DE POLITESSE 2 : une seule requete en vol par hote, et un delai entre deux.
 *
 * ⛔ IL N'Y A AUCUN PARALLELISME DANS CE FICHIER, ET C'EST VOULU. La boucle principale est
 *    un for..of avec des await : a tout instant, une seule requete est en vol, tous hotes
 *    confondus. Un Promise.all ferait gagner quelques minutes et transformerait un crawl
 *    poli en petite attaque vue depuis l'autre bout.
 * ⛔ LE DELAI SE COMPTE DEPUIS LE DERNIER APPEL, PAS APRES CHAQUE APPEL. Dormir
 *    systematiquement ferait attendre pour rien quand l'hote a change entre-temps ; ici on
 *    ne dort que le reste effectivement du.
 */
const dernierAppel = new Map();
async function attendreSonTour(h) {
  const t = dernierAppel.get(h) || 0;
  const reste = DELAI_HOTE - (Date.now() - t);
  if (reste > 0) await patienter(reste);
  dernierAppel.set(h, Date.now());
}

// ---------------------------------------------------------------- le crawl

const run = nouveauRun("robot");
const t0 = Date.now();
console.log(`Vigie SEO — robot de recherche de backlinks`);
console.log(`cible ${CIBLE} · budgets : ${BUDGET_PAGES} pages, ${BUDGET_MIN} min, ${BUDGET_HOTES} hotes, ${DELAI_HOTE} ms par hote`);
console.log(`sources : ${DEPUIS.join(", ")}${DRY ? " · --dry" : ""}\n`);

console.log("Construction de la file d'attente :");
let file = [];
if (DEPUIS.includes("connus")) { const l = depuisConnus(); console.log(`  referents connus : ${l.length}`); file.push(...l); }
if (DEPUIS.includes("concurrents")) { const l = depuisConcurrents(); console.log(`  referents de concurrents : ${l.length}`); file.push(...l); }
if (DEPUIS.includes("annuaires")) { const l = depuisAnnuaires(); console.log(`  annuaires : ${l.length}`); file.push(...l); }
if (DEPUIS.includes("moteurs")) { const l = await depuisMoteurs(); console.log(`  moteurs : ${l.length}`); file.push(...l); }

// ⛔ ON DEDOUBLONNE PAR URL, PAS PAR HOTE, avec un plafond de trois URL par hote.
//    Premiere version : une seule entree par hote. Comme toutes les entrees « referent
//    connu » ont le meme poids, c'est la premiere rencontree qui gagnait, souvent la page
//    d'accueil, alors que l'URL EXACTE de la page qui nous cite etait juste a cote dans la
//    file. Le robot lisait donc l'accueil de l'annuaire au lieu de la page exacte ou vit
//    la fiche produit, ne trouvait rien, et concluait a tort que le lien avait disparu.
//    Trois URL par hote suffisent, et on ne martele personne : le delai par hote reste le
//    meme, c'est la regle de politesse 5.
const parHote = new Map();
file = file.sort((a, b) => b.poids - a.poids).filter((x) => {
  const n = (parHote.get(x.hote) || 0) + 1;
  if (n > 3) return false;
  parHote.set(x.hote, n);
  return true;
});
// Le budget d'hotes se compte en HOTES, pas en URL.
const hotesRetenus = new Set();
file = file.filter((x) => {
  if (hotesRetenus.has(x.hote)) return true;
  if (hotesRetenus.size >= BUDGET_HOTES) return false;
  hotesRetenus.add(x.hote);
  return true;
});

console.log(`\nFile prete : ${file.length} hote(s) a visiter.\n`);

const obs = [];
let dejaEcrites = 0;
let pagesLues = 0, trouves = 0, murs = 0, interdits = 0, opportunites = 0;
const journalEtat = () => fs.writeFileSync(ETAT, JSON.stringify({
  version: VERSION, cible: CIBLE, run,
  demarre: new Date(t0).toISOString(),
  ecoule_s: Math.round((Date.now() - t0) / 1000),
  file: file.length, pages_lues: pagesLues, hotes_faits: fait,
  liens_trouves: trouves, murs, interdits,
  budget: { pages: BUDGET_PAGES, minutes: BUDGET_MIN, hotes: BUDGET_HOTES },
  fini: false,
}, null, 1), "utf8");

let fait = 0;
for (const cand of file) {
  // REGLE DE POLITESSE 4 : les budgets ARRETENT, ils ne ralentissent pas. Testes a chaque
  // tour, avant toute requete. Le budget d'hotes, lui, a deja ete applique en tronquant la
  // file plus haut : on ne construit pas une file qu'on n'a pas l'intention de finir.
  if (pagesLues >= BUDGET_PAGES) { console.log(`\n⏹ budget de ${BUDGET_PAGES} pages atteint.`); break; }
  if ((Date.now() - t0) / 60000 >= BUDGET_MIN) { console.log(`\n⏹ budget de ${BUDGET_MIN} minutes atteint.`); break; }
  fait++;

  // REGLE DE POLITESSE 1 : le robots.txt AVANT tout le reste. Cette ligne est la premiere
  // requete faite vers cet hote, et rien ne doit jamais passer devant elle.
  const regles = await reglesDe(cand.hote);
  if (regles.bloqueTout) {
    interdits++;
    obs.push(observation({
      type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: cand.hote },
      metrique: "page_portante", etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "robot", endpoint: `https://${cand.hote}/robots.txt`, http: 200, methode: "robot" },
      preuve: `robots.txt interdit tout crawl. Candidat retenu parce que : ${cand.origine}`,
      run_id: run, collecteur: VERSION, drapeaux: ["robots_txt_interdit_tout"],
    }));
    continue;
  }

  // Une page d'accueil, et si elle nous nomme sans nous lier, on tente sa page de liens.
  const aVisiter = [cand.url];
  let trouveIci = 0;
  let derniereLecture = null;

  for (const u of aVisiter) {
    if (pagesLues >= BUDGET_PAGES) break;
    let chemin;
    try { chemin = new URL(u).pathname; } catch { continue; }
    if (!regles.autorise(chemin)) continue;

    await attendreSonTour(cand.hote);
    const r = await recupererFiable(u, { timeout: 15000, ua: UA }, 1);
    pagesLues++;
    if (!r.ok || r.http !== 200) { if (r.http === 403 || r.http === 429) murs++; continue; }

    const liens = liensVers(r.html, CIBLE);
    if (!liens.length) derniereLecture = { url: u, rivaux: concurrentsCites(r.html, cand.hote) };
    if (liens.length) {
      const ix = indexabilite(r.html, r.enTetes);
      const spam = signauxSpam({ domaine: cand.hote, url: u, html: r.html, http: 200, octetsHtml: r.octets });
      for (const l of liens) {
        trouves++; trouveIci++;
        obs.push(observation({
          type: "backlink", sujet: { domaine: CIBLE },
          objet: {
            domaine: cand.hote, url: u, ancre: l.ancre,
            detail: {
              url_source: u, url_destination: l.url, ancre: l.ancre,
              rel_brut: l.rel, suivi: l.suivi, suivi_effectif: ix.indexable ? l.suivi : "NOFOLLOW",
              genre: l.genre,
              indexabilite: { meta_robots: ix.metaRobots, x_robots_tag: ix.xRobotsTag, noindex: ix.noindex },
              spam: { verdict: spam.verdict, score: spam.score, signaux: spam.signaux },
              trouve_par: "robot", origine_candidat: cand.origine,
            },
          },
          metrique: "lien_qualifie", valeur: 1, unite: "lien",
          nature: "mesure", etat: "MESURE",
          source: { nom: "robot", endpoint: u, http: 200, methode: "robot" },
          preuve: `rel=${JSON.stringify(l.rel)} lu dans le HTML servi. Candidat retenu parce que : ${cand.origine}`,
          run_id: run, collecteur: VERSION,
          drapeaux: ix.indexable ? ["trouve_par_robot"] : ["trouve_par_robot", "page_en_noindex"],
        }));
      }
      console.log(`  ✅ ${cand.hote.padEnd(30)} ${liens.length} lien(s), ${liens.filter((l) => l.suivi === "DOFOLLOW").length} dofollow  · ${cand.origine}`);
      // ⛔ ON REGARDE AUSSI QUI D'AUTRE EST CITE SUR CETTE PAGE. Une page qui nous lie
      //    et qui lie aussi trois concurrents ne vaut pas la meme chose qu'une page qui
      //    ne lie que nous : la premiere est un comparatif, la seconde une citation.
      const rivaux = concurrentsCites(r.html, cand.hote);
      if (rivaux.length) {
        obs.push(observation({
          type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: cand.hote, url: u },
          metrique: "voisins_sur_la_page", valeur: rivaux.length, unite: "concurrent",
          nature: "mesure", etat: "MESURE",
          source: { nom: "robot", endpoint: u, http: 200, methode: "robot" },
          preuve: `cette page nous lie ET lie ${rivaux.length} concurrent(s) : ${rivaux.join(", ")}`,
          run_id: run, collecteur: VERSION, drapeaux: ["page_comparative"],
        }));
      }
    } else if (u === cand.url) {
      // Pas de lien sur l'accueil, mais le nom y est-il ? Si oui, la page qui nous cite
      // existe ailleurs sur le site, et on la cherche par les chemins usuels.
      const texte = texteDe(r.html).toLowerCase();
      if (texte.includes(MARQUE)) {
        for (const c of ["/tools/", "/resources/", "/partners/", "/blog/", `/${MARQUE}`, `/software/${MARQUE}`]) {
          if (aVisiter.length < 7) aVisiter.push(`https://${cand.hote}${c}`);
        }
      }
    }
  }

  // ⛔ ZERO LIEN N'EST PAS UN ECHEC, C'EST LA LISTE DE PROSPECTION. Un site qui cite un
  //    concurrent et pas nous est exactement la cible a demarcher : il parle du sujet, il
  //    a deja publie un lien vers un journal de trading, et il ne nous connait pas. Sans
  //    cette ligne, le robot rendrait « 0 trouve » et on jetterait son travail le plus
  //    utile. C'est aussi la seule chose que Semrush ne fait pas a notre place.
  const estUnConcurrent = CONCURRENTS.includes(cand.hote);
  if (!trouveIci && !estUnConcurrent && derniereLecture && derniereLecture.rivaux.length) {
    obs.push(observation({
      type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: cand.hote, url: derniereLecture.url },
      metrique: "opportunite_backlink",
      valeur: derniereLecture.rivaux.length, unite: "concurrent",
      nature: "mesure", etat: "MESURE",
      source: { nom: "robot", endpoint: derniereLecture.url, http: 200, methode: "robot" },
      preuve: `cite ${derniereLecture.rivaux.length} concurrent(s) et PAS nous : ${derniereLecture.rivaux.join(", ")}. Candidat retenu parce que : ${cand.origine}`,
      run_id: run, collecteur: VERSION, drapeaux: ["opportunite"],
    }));
    opportunites++;
    console.log(`  🎯 ${cand.hote.padEnd(30)} cite ${derniereLecture.rivaux.join(", ")} et pas nous`);
  }

  if (!trouveIci && fait % 25 === 0) {
    console.log(`  … ${fait}/${file.length} hotes, ${pagesLues} pages lues, ${trouves} lien(s) trouve(s)`);
  }
  if (!DRY && obs.length > dejaEcrites) { ecrire(obs.slice(dejaEcrites)); dejaEcrites = obs.length; }
  journalEtat();
}

// Le bilan du crawl est lui-meme une observation : sans lui, on ne saurait pas
// distinguer « ce domaine n'a pas de backlink » de « le robot n'y est jamais alle ».
obs.push(observation({
  type: "backlink", sujet: { domaine: CIBLE }, metrique: "robot_pages_lues",
  valeur: pagesLues, unite: "page", nature: "mesure", etat: "MESURE",
  source: { nom: "robot", endpoint: "crawl a la demande", http: 200, methode: "robot" },
  preuve: `${fait} hote(s) visite(s) sur ${file.length} en file, ${pagesLues} page(s) lue(s), ${trouves} lien(s) trouve(s), ${murs} mur(s), ${interdits} robots.txt bloquant(s), en ${Math.round((Date.now() - t0) / 1000)} s`,
  run_id: run, collecteur: VERSION,
}));
if (!DRY) ecrire(obs.slice(dejaEcrites));

fs.writeFileSync(ETAT, JSON.stringify({
  version: VERSION, cible: CIBLE, run, fini: true,
  ecoule_s: Math.round((Date.now() - t0) / 1000),
  hotes_faits: fait, file: file.length, pages_lues: pagesLues,
  liens_trouves: trouves, murs, interdits,
}, null, 1), "utf8");

console.log(`\n${fait} hote(s), ${pagesLues} page(s) lue(s), ${trouves} lien(s) trouve(s), ${murs} mur(s), ${interdits} interdit(s) par robots.txt`);
console.log(DRY ? `--dry : ${obs.length} observations NON ecrites.` : `${obs.length} observation(s), ${dejaEcrites} posee(s) au fil de l eau.`);
