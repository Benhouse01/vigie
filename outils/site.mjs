// LE SITE DE LA VIGIE SEO : le generateur.
//
// Il lit le journal d'observations et rend un site statique autonome. Aucune dependance
// externe, aucun CDN, aucune police distante : le site vit derriere une authentification
// HTTP Basic, et un appel sortant y serait au mieux bloque, au pire une fuite. Tout le
// CSS et tout le JavaScript sont dans le fichier HTML lui-meme.
//
// ⛔ CE QUE LE SITE N'A PAS LE DROIT DE FAIRE. C'est sa raison d'etre, pas sa decoration.
//
//  1. AFFICHER UN ZERO LA OU LA MESURE A ECHOUE. Un angle mort sort en « ▲ » avec le
//     libelle de sa raison A L'ECRAN, pas seulement dans une infobulle. Le 16/08/2026, un
//     rapport d'annuaires a aligne les fiches propres et les fiches illisibles dans la
//     meme colonne, et la fiche la plus fausse etait celle que l'outil n'avait pas pu
//     lire. Une colonne qui melange « mesure a zero » et « mesure impossible » fabrique
//     une impression de couverture qui n'existe pas.
//
//  2. AFFICHER UNE ESTIMATION SANS LE DIRE. Le mot « estimation », la source et la date
//     de la donnee sont dans la cellule, jamais en note de bas de page. Le 20/08/2026,
//     la page publique Semrush annoncait 70,4 K de visites sur un site qui en mesurait
//     2,9 K : facteur 24. Un chiffre modelise pris pour un releve coute plus cher qu'un
//     chiffre absent.
//
//  3. PRESENTER UN PLAFOND COMME UN TOTAL. Bing s'arrete a 500 domaines referents par
//     site et annonce 500 comme si c'etait le compte, sa page 2 rendant zero ligne. Ces
//     valeurs sortent en « ≥ 500 ». Le rapport Liens de Search Console est lui aussi un
//     plancher : il annoncait 24 liens le 16/08/2026 en omettant un lien parfaitement
//     crawlable.
//
//  4. ADDITIONNER LE COMPTE DE BING ET LE COMPTE LU DANS LE HTML. Bing compte des liens
//     au niveau du DOMAINE, sans URL et sans rel. La lecture du HTML donne l'URL, le rel
//     reel et les signaux de spam, sur les seules pages qu'on a pu ouvrir. Ce sont deux
//     colonnes voisines, jamais une somme.
//
//  5. CLASSER UN DOMAINE QU'ON N'A PAS MESURE. Sous 60 % de socle, la note sort en
//     fourchette et le domaine quitte le classement au lieu d'y descendre.
//
// ⛔ LE PREMIER ECRAN EST « CE QUI A BOUGE », PAS « CE QUI EST ». Un backlink qui tombe
//    ne fait aucun bruit : aucune alerte, aucune ligne rouge, rien ne le distingue d'une
//    journee calme, et c'est pourtant l'evenement le plus couteux du referencement. Le
//    bandeau du haut sort donc les liens APPARUS et surtout les liens DISPARUS depuis le
//    releve precedent.
//
// ⛔ ET LA PRECAUTION QUI VA AVEC : on n'annonce une disparition QUE si le collecteur est
//    repasse sur cette cible. Sans deux passes, il n'y a pas de disparition, il y a une
//    absence de mesure, et les deux ne se ressemblent que sur un ecran mal fait.
//
// ⛔ AUCUN NOM DE MARQUE N'EST ECRIT DANS CE FICHIER. Le titre, le nom court affiche en
//    haut de chaque page et le chapeau du comparateur viennent de la configuration
//    (champs « titre » et « marque », et le libelle de votre domaine en role « nous »).
//    Un generateur qui porte le nom d'un projet dans son code produit un tableau de bord
//    qui parle de quelqu'un d'autre chez tous les suivants.
//
// Usage :
//   node outils/site.mjs                        genere le site dans le dossier de sortie
//   node outils/site.mjs --sortie=<dossier>      ailleurs (sinon VIGIE_SORTIE, sinon site/)
//   node outils/site.mjs --verifier --url=…      controle APRES deploiement (4 appels)

import fs from "node:fs";
import path from "node:path";

import {
  lire, dernier, serie, mouvements, config, RACINE, FICHIER_OBS,
} from "./_lib-obs.mjs";

// ⛔ ON IMPORTE LA NOTE, ON NE LA REFAIT PAS. Une seconde implementation de la formule
//    dans le generateur donnerait deux verites : celle du journal et celle de l'ecran.
//    La version de la formule voyage avec la note et s'affiche, parce qu'une note
//    calculee par note@1.0.0 et une note calculee par note@1.1.0 ne se comparent pas.
import {
  contexteDepuisJournal, noteDomaine, detail as detailNote,
  SOCLE_AFFICHABLE, SEUIL_UTILE, SEUIL_NEUTRE, VERSION as VERSION_NOTE,
} from "./note.mjs";

// ⛔ LE LIBELLE DU TRAFIC ESTIME VIENT DU MODULE, PAS D'ICI. verifierLibelle() LEVE si le
//    texte contient « trafic organique » : c'est exactement le libelle qui a fait passer
//    70,4 K de modele pour 2,9 K de releve. L'interdiction est donc executee a chaque
//    generation du site, pas seulement recommandee dans un commentaire.
import { libelleTotal, verifierLibelle } from "./trafic.mjs";

const VERSION = "site@2.0.0";

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || null;

// ⛔ LE DOSSIER DE SORTIE NE S'ECRIT PAS EN DUR, MEME PAS « le mien, en attendant ». Un
//    chemin d'espace de travail laisse dans un generateur ne casse pas : il ECRIT, dans un
//    dossier qui n'existe que sur une seule machine, et le lecteur suivant cherche
//    longtemps ou sont passees ses pages. Ordre : --sortie=, puis VIGIE_SORTIE, puis
//    <racine du depot>/site, RACINE etant deduite de l'emplacement de outils/.
const SORTIE = arg("sortie") || process.env.VIGIE_SORTIE || path.join(RACINE, "site");

// Le port du petit serveur local qui permet au bouton « Lancer le crawl » de travailler.
// Il est injecte dans le HTML genere : ecrit en dur dans le script de la page, il
// pointerait chez le premier utilisateur venu vers un port qui n'est pas le sien, et le
// bouton echouerait sans jamais dire pourquoi.
const PORT_SERVEUR = Number(process.env.VIGIE_PORT) || 9788;

/**
 * Le nom court du tableau de bord, tel qu'il s'affiche en haut de chaque page.
 *
 * ⛔ LU EN try/catch, ET C'EST VOLONTAIRE. --verifier doit pouvoir tourner sur une machine
 *    qui n'a pas la configuration sous la main (un serveur de deploiement, par exemple) :
 *    refuser un controle de fermeture pour un defaut de libelle reviendrait a laisser un
 *    site ouvert faute d'avoir su comment l'appeler.
 */
function nomCourt() {
  try { return String(config().titre || "").trim() || "Vigie"; } catch { return "Vigie"; }
}

// ⛔ AUCUNE ADRESSE DE TABLEAU DE BORD EN DUR ICI, ET CE N'EST PAS UNE QUESTION DE
//    PORTABILITE. Le nom d'un projet Cloudflare Pages devient PUBLIC par les journaux de
//    Transparence des Certificats : ecrire l'adresse d'un tableau de bord prive dans un
//    fichier partage revient a publier l'adresse de la seule page qui porte votre analyse
//    concurrentielle. Elle vient donc de --url ou de VIGIE_URL, et --verifier refuse de
//    tourner sans plutot que de controler une adresse qui n'est pas la votre.
//    Corollaire, au moment de creer le projet : prenez un nom qui ne raconte rien, six
//    caracteres tires au hasard font l'affaire, jamais « <votre-marque>-concurrents »,
//    qui se lit tout seul dans un journal de certificats public.
const URL_SITE = (arg("url") || process.env.VIGIE_URL || "").replace(/\/+$/, "");

// =====================================================================================
// --verifier : le controle d'APRES deploiement, en quatre appels
// =====================================================================================
//
// ⛔ CE CONTROLE NE SE FAIT PAS EN LOCAL. Un site genere sur le disque n'a pas de
//    middleware : c'est Cloudflare qui l'execute. Le seul test qui vaille est un appel
//    reel a l'URL publique, sans identifiants, qui doit rendre 401.
//
// ⛔ LES QUATRE APPELS NE SONT PAS REDONDANTS, chacun couvre un trou different :
//    1. l'accueil            le cas evident, celui qu'on teste toujours
//    2. un fichier statique  ⛔ LE PIEGE PRINCIPAL. Si _routes.json ne porte pas
//                            "exclude": [], le CDN sert les fichiers statiques SANS
//                            passer par la Function : l'accueil est protege et les
//                            tableaux sont publics.
//    3. robots.txt           meme piege, et c'est le fichier qu'un robot demande en
//                            premier
//    4. une route inexistante  si la page 404 est servie hors middleware, elle peut
//                            fuiter des en-tetes ou l'existence du projet
async function verifier(base) {
  const alea = Math.random().toString(36).slice(2, 10);
  const epreuves = [
    { nom: "accueil", chemin: "/" },
    { nom: "fichier statique", chemin: "/backlinks.html" },
    { nom: "robots.txt", chemin: "/robots.txt" },
    { nom: "route inexistante", chemin: `/${alea}` },
  ];

  console.log(`${nomCourt()} — controle de fermeture de ${base}`);
  console.log("  aucun identifiant n'est envoye : les quatre appels doivent rendre 401.\n");

  let tout = true;
  for (const e of epreuves) {
    let code = null, wwwAuth = null, robots = null, erreur = null;
    try {
      const r = await fetch(base + e.chemin, { redirect: "manual" });
      code = r.status;
      wwwAuth = r.headers.get("www-authenticate");
      robots = r.headers.get("x-robots-tag");
    } catch (err) {
      erreur = String(err.message || err).slice(0, 60);
    }

    const ok = code === 401;
    tout = tout && ok;
    const diagnostic =
      erreur ? `injoignable : ${erreur}`
      : code === 200 ? "⛔ SERVI EN CLAIR. Le middleware n'a pas ete compile (glisser-depose ?) ou _routes.json exclut cette route."
      : code === 503 ? "le middleware repond mais les variables manquent sur cet environnement (production ET preview sont deux jeux distincts)."
      : code === 404 ? "⛔ 404 sans authentification : la route sort du perimetre du middleware."
      : code === 401 && !wwwAuth ? "401 mais sans en-tete WWW-Authenticate : le navigateur n'affichera aucune invite."
      : "";

    console.log(
      `  ${ok ? "OK   " : "ECHEC"} ${String(code ?? "—").padEnd(5)} ${e.nom.padEnd(20)}` +
      `${wwwAuth ? ` WWW-Authenticate: ${wwwAuth}` : ""}${robots ? ` · X-Robots-Tag: ${robots}` : ""}` +
      (diagnostic ? `\n           ${diagnostic}` : "")
    );
  }

  console.log(tout
    ? "\nLes quatre appels rendent 401 : le site est en ligne et ferme a qui n'a pas le mot de passe."
    : "\n⛔ UN CONTROLE A ECHOUE, ET UN 200 SANS IDENTIFIANTS VEUT DIRE QUE L'ANALYSE DES\n" +
      "   CONCURRENTS EST PUBLIQUE. A verifier, dans cet ordre :\n" +
      "     1. le deploiement est-il parti par wrangler, depuis le dossier du site ?\n" +
      "        (le glisser-deposer ne compile pas functions/ et n'en dit rien)\n" +
      "     2. _routes.json porte-t-il bien \"exclude\": [] ?\n" +
      "     3. VIGIE_UTILISATEUR et VIGIE_MOTDEPASSE existent-ils en PRODUCTION *et* en PREVIEW ?\n" +
      "     4. Settings > Runtime est-il sur « Fail closed » ?");
  return tout;
}

if (process.argv.includes("--verifier")) {
  // ⛔ On refuse plutot que de deviner. Sans adresse, le seul repli possible serait une
  //    adresse ecrite en dur, c'est-a-dire celle de quelqu'un d'autre : le controle
  //    rendrait alors un verdict sur un site qui n'est pas le votre.
  if (!URL_SITE) {
    console.error(
      "--verifier a besoin de l'adresse publique du tableau de bord.\n" +
      "  node outils/site.mjs --verifier --url=https://<votre-projet>.pages.dev\n" +
      "  ou posez VIGIE_URL dans votre .env."
    );
    process.exit(1);
  }
  process.exit((await verifier(URL_SITE)) ? 0 : 1);
}

// =====================================================================================
// LECTURE DU JOURNAL
// =====================================================================================

// --journal= sert a regenerer le site depuis un journal ARCHIVE ou depuis une copie, sans
// jamais toucher au vrai. Lecture seule : ce script n'ecrit aucune observation.
// ⛔ C'est aussi la seule facon d'eprouver le bandeau des apparitions et des disparitions
//    avant qu'un deuxieme passage n'ait eu lieu pour de vrai. Appendre des lignes d'essai
//    au journal de production reviendrait a inventer des mesures.
const JOURNAL = arg("journal");
const { obs, illisibles } = JOURNAL ? lire({ fichier: JOURNAL }) : lire();
const photo = dernier(obs);
const cfg = config();

// ⛔ UN JOURNAL VIDE N'EST PAS UNE ERREUR, C'EST UN LUNDI MATIN AVANT LA COLLECTE. Le
//    site se genere quand meme et le dit. Planter ici obligerait a lancer une collecte
//    pour pouvoir regarder l'ecran qui explique qu'il n'y a rien.
//    ⛔ ET C'EST LE PREMIER ECRAN QUE VERRA QUICONQUE INSTALLE CET OUTIL : il n'a encore
//       rien collecte, donc son journal est vide par construction. Un tableau de bord qui
//       lui rend des cases a zero lui apprend une faussete sur son propre site des la
//       premiere minute. Toutes les cases chiffrees se remplacent donc par la marche a
//       suivre tant que le journal ne porte aucune ligne.
const VIDE = obs.length === 0;

/**
 * L'identite du tableau de bord, prise dans la configuration.
 * Defauts volontairement neutres : « Vigie » ne designe personne, et c'est ce qui doit
 * s'afficher tant que l'utilisateur n'a pas dit comment il veut appeler sa veille.
 */
const NOM_COURT = String(cfg.titre || "").trim() || "Vigie";
const MARQUE = String(cfg.marque || "").trim() || "Ma veille SEO";

const META = new Map();
for (const [role, liste] of [["nous", cfg.nous], ["concurrent", cfg.concurrents], ["spot", cfg.spots]]) {
  for (const d of liste) META.set(d.domaine, { role, libelle: d.libelle || d.domaine, note: d.note || null, angle: d.angle_mort || null, page: d.page || null });
}

/** Les domaines qui ont une page et une colonne : les notres et les concurrents. */
const DOMAINES = [
  ...cfg.nous.map((d) => d.domaine),
  ...cfg.concurrents.map((d) => d.domaine),
];
// Un domaine vu au journal mais absent de la configuration ne disparait pas en silence :
// il apparait, avec le role « hors configuration », parce que c'est le signe qu'un
// collecteur travaille sur une cible que domaines.json ne connait pas.
//
// ⛔ MAIS SEULEMENT S'IL A ETE VISE PAR UN COLLECTEUR, PAS S'IL A ETE SIMPLEMENT CONSULTE.
//    collecte-qualification interroge OpenPageRank et Majestic sur CHAQUE domaine
//    referent : 2 239 le 21/08/2026. Sans ce filtre, chacun devenait une colonne du
//    comparateur et une page du site. Resultat mesure : 2 233 pages, un index de 9 Mo et
//    47,8 Mo au total, illisible et impossible a deployer. Une ligne « autorite » sur un
//    domaine referent est un RENSEIGNEMENT SUR UN TIERS, pas un domaine suivi ; sa place
//    est dans la colonne « note du site emetteur » du tableau des backlinks.
const TYPES_SUIVI = new Set(["technique", "couverture", "position", "note"]);
// ⛔ note_emetteur est une note SUR UN TIERS, pas sur un domaine suivi. Elle porte le type
//    « note » comme les autres, donc sans cette exception les 2 216 sites emetteurs
//    redeviennent des colonnes du comparateur : 2 233 pages et 53 Mo, mesure du 21/08.
const METRIQUES_TIERS = new Set(["note_emetteur"]);
const horsConfig = new Set();
for (const o of photo) {
  const d = o.sujet?.domaine;
  if (!d || META.has(d)) continue;
  if (!TYPES_SUIVI.has(o.type)) continue;
  if (METRIQUES_TIERS.has(o.metrique)) continue;
  if (horsConfig.has(d)) continue;
  horsConfig.add(d);
  META.set(d, { role: "hors configuration", libelle: d, note: null, angle: null });
  DOMAINES.push(d);
}

const slug = (d) => d.replace(/[^a-z0-9.]/gi, "_");
const fichierDomaine = (d) => `d-${slug(d)}.html`;
// Un meme site emetteur pointe souvent vers plusieurs cibles : l'ancre porte donc le
// couple, sinon deux lignes du tableau partagent le meme identifiant et le lien du
// bandeau saute sur la mauvaise.
const ancre = (referent, cible) => `${slug(referent)}--${slug(cible)}`;

// =====================================================================================
// LECTURE HONNETE D'UNE OBSERVATION
// =====================================================================================

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const nb = (n) => (n == null ? "" : Number(n).toLocaleString("fr-FR"));
const jour = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "?");

const der = (domaine, metrique, source = null) =>
  photo.find((o) => o.sujet?.domaine === domaine && o.metrique === metrique && (!source || o.source?.nom === source)) || null;

const toutes = (domaine, metrique) =>
  photo.filter((o) => o.sujet?.domaine === domaine && o.metrique === metrique);

// ⛔ PLAFONDS CONNUS DES SOURCES, RELUS A L'AFFICHAGE ET PAS SEULEMENT A LA COLLECTE.
//    Les lignes ecrites le 21/08/2026 a 01h46 portent nature « mesure » avec la valeur
//    500 pile : elles sont sorties d'une version du collecteur anterieure au drapeau
//    « plancher ». Et elles ne peuvent PAS etre corrigees le meme jour, parce que
//    l'identifiant d'observation porte la journee et rejette la reecriture comme un
//    doublon. Le site doit donc savoir reconnaitre un plafond meme quand la ligne ne le
//    declare pas, sans quoi trois concurrents afficheraient 500 comme un total.
const PLAFONDS = { bing_webmaster: { domaines_referents: 500 } };
const auPlafond = (o) =>
  !!o && o.etat === "MESURE" && PLAFONDS[o.source?.nom]?.[o.metrique] != null &&
  Number(o.valeur) >= PLAFONDS[o.source.nom][o.metrique];

/** Le libelle court d'un angle mort ou d'une absence : il s'affiche, il ne se survole pas. */
function libelleCourt(o) {
  const dr = (o.drapeaux || []).find(Boolean);
  if (dr) return String(dr).replace(/_/g, " ");
  const p = String(o.preuve || "").trim();
  if (!p) return "raison non consignee";
  return p.length > 34 ? p.slice(0, 33) + "…" : p;
}

/**
 * LA fonction du fichier : tout chiffre du site passe par elle, donc aucun chiffre ne
 * peut sortir nu. Elle porte les cinq interdits de l'en-tete a elle seule.
 */
function cellule(o, { unite = "", detail = true, bulle = "longue" } = {}) {
  if (!o) return `<span class="vide" title="aucune observation : ce n'est pas un zero">—</span>`;

  if (o.etat === "ANGLE_MORT") {
    return `<span class="angle" title="${esc(o.preuve || "mesure impossible")} — source ${esc(o.source?.nom)}, essai du ${jour(o.date_mesure)}">▲ <span class="raison">${esc(libelleCourt(o))}</span></span>`;
  }
  if (o.etat === "MESURE_ABSENT") {
    return `<span class="absent" title="${esc(o.preuve || "la source a repondu : rien")} — source ${esc(o.source?.nom)}, lu le ${jour(o.date_mesure)}">rien <span class="raison">${esc(libelleCourt(o))}</span></span>`;
  }

  const plancher = o.nature === "plancher" || auPlafond(o);
  const prefixe = plancher ? "≥&nbsp;" : "";
  const chiffre = `${prefixe}${nb(o.valeur)}${unite}`;

  // ⛔ Le mot « estimation », la source et la date sont DANS la cellule. En note de bas de
  //    page, personne ne les lit, et un modele finit lu comme un releve.
  const marques = [];
  if (o.nature === "estimation") {
    marques.push(`estimation · ${esc(o.source?.nom || "source inconnue")}${o.date_donnee ? ` · donnee du ${jour(o.date_donnee)}` : ""}${o.fraicheur_jours != null && o.fraicheur_jours > 14 ? ` (${o.fraicheur_jours} j de retard)` : ""}`);
  }
  if (o.nature === "derive") marques.push("calcul, pas mesure");
  if (plancher) marques.push(`plancher : la source plafonne${o.nature === "plancher" ? "" : " a cette valeur exacte"}, le vrai nombre est au-dessus`);

  // ⛔ La bulle courte existe pour les colonnes de plusieurs milliers de lignes, ou la
  //    preuve repete mot pour mot ce que la ligne dit deja (du genre
  //    « annuaire-exemple.fr -> exemple.com : 3 », exemple). Elle garde la source et la
  //    date, qui sont ce qui ne se devine pas. Mesure : trois mille preuves redondantes
  //    pesaient 1,2 Mo de page pour zero information.
  const texteBulle = bulle === "courte"
    ? `${o.source?.nom || "source inconnue"}${o.source?.http ? ` · HTTP ${o.source.http}` : ""} · lu le ${jour(o.date_mesure)}`
    : `${o.preuve || ""} — source ${o.source?.nom}${o.source?.http ? ` (HTTP ${o.source.http})` : ""}, lu le ${jour(o.date_mesure)}`;
  return `<span title="${esc(texteBulle)}">${chiffre}</span>` +
    (detail && marques.length ? `<em class="est">${marques.map(esc).join(" · ")}</em>` : "");
}

/** La valeur triable d'une observation. Un angle mort n'est pas zero : il sort du tri. */
const triable = (o) => (o && o.etat === "MESURE" && typeof o.valeur === "number" ? o.valeur : "");

// =====================================================================================
// LES PASSES, LES APPARITIONS ET LES DISPARITIONS
// =====================================================================================
//
// ⛔ mouvements() DU SOCLE NE REND PAS LES DISPARITIONS, ET SON COMMENTAIRE DIT POURQUOI :
//    une ligne sans mesure recente peut avoir disparu, ou n'avoir simplement pas ete
//    regardee. Trancher demande de savoir si le collecteur EST REPASSE sur cette cible.
//    C'est ce que fait `passes()` : elle regroupe les observations par run, ce qui donne
//    la liste des fois ou quelqu'un a vraiment regarde.

/** Les passes du collecteur sur une cible pour une metrique, de la plus vieille a la plus recente. */
function passes(cible, metrique, source = null) {
  const l = obs.filter((o) =>
    o.sujet?.domaine === cible && o.metrique === metrique && (!source || o.source?.nom === source));
  const parRun = new Map();
  for (const o of l) {
    const cle = o.run_id || o.date_mesure.slice(0, 10);
    if (!parRun.has(cle)) parRun.set(cle, { run: cle, date: o.date_mesure, lignes: [] });
    const p = parRun.get(cle);
    if (o.date_mesure > p.date) p.date = o.date_mesure;
    p.lignes.push(o);
  }
  return [...parRun.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * La fenetre a passer a mouvements() pour qu'elle compare la DERNIERE passe a la
 * PRECEDENTE, et rien d'autre.
 *
 * ⛔ mouvements() prend un nombre de jours et coupe a Date.now() moins ce nombre. Choisir
 *    « 7 jours » a l'avance donne un resultat qui depend du rythme de la collecte et pas
 *    du domaine : deux passes quotidiennes tombent toutes les deux du meme cote du seuil,
 *    et la fonction ne voit plus rien « avant ». On calcule donc la fenetre a partir de la
 *    date reelle de la passe precedente de ce domaine.
 *
 * ⛔ ET ON REFUSE DE REPONDRE SI L'HORLOGE EST INCOHERENTE. Un journal dont les dates sont
 *    devant l'horloge de la machine (releve importe, machine mal reglee, essai) donnerait
 *    une fenetre negative, donc un seuil dans le futur, donc zero ligne recente : mouvements()
 *    rendrait « rien n'a bouge » alors qu'elle n'a rien pu regarder. On le dit a l'ecran.
 */
function fenetrePassePrecedente(d) {
  const parRun = new Map();
  for (const o of obs) {
    if (o.sujet?.domaine !== d) continue;
    const cle = o.run_id || o.date_mesure.slice(0, 10);
    const v = parRun.get(cle);
    if (!v || o.date_mesure > v) parRun.set(cle, o.date_mesure);
  }
  const dates = [...parRun.values()].sort();
  if (dates.length < 2) return null;
  const precedente = dates[dates.length - 2];
  const jours = (Date.now() - (Date.parse(precedente) + 1)) / 86400000;
  if (!(jours > 0)) {
    return { precedente, jours: null,
      raison: `le journal est date du ${jour(dates[dates.length - 1])}, soit apres l'horloge de la machine (${jour(new Date().toISOString())}). ` +
              `La comparaison par fenetre de temps ne peut pas s'appuyer sur une date future. Les apparitions et disparitions ci-dessus, elles, restent exactes : elles comparent des passes, pas des dates.` };
  }
  return { precedente, jours };
}

/**
 * Ce qui est APPARU et ce qui a DISPARU entre les deux dernieres passes sur une cible.
 *
 * ⛔ TROIS ETATS DE SORTIE, ET DEUX D'ENTRE EUX NE SONT PAS DES LISTES :
 *    - "premier releve"  : une seule passe, il n'y a rien a comparer. Ce n'est pas
 *                          « aucun changement », ce qui laisserait croire a une stabilite
 *                          qu'on n'a pas mesuree.
 *    - "passe muette"    : la derniere passe est un angle mort sur cette cible. Tous ses
 *                          liens paraitraient disparus alors que c'est la SOURCE qui n'a
 *                          pas repondu. C'est le zero silencieux, deguise en catastrophe.
 *    - "compare"         : deux passes exploitables, la difference est reelle.
 *
 * ⛔ ET UNE RESERVE QUI SUIT LA LISTE : quand une passe touche le plafond de 500 de Bing,
 *    le bas du classement est tronque. Un domaine referent peut alors « disparaitre »
 *    simplement parce qu'un autre est passe devant lui. La liste sort avec ce drapeau.
 */
// ⛔ MEMOISE, et pas pour la vitesse. `nouveautes()` est appelee par le bandeau, par le
//    tableau, par le classement et par chaque page de domaine. Recalculee a chaque fois,
//    elle resterait juste, mais toute correction future devrait etre pensee comme
//    idempotente. Une seule reponse par cible, c'est aussi une seule verite a l'ecran.
const _nouveautes = new Map();
function nouveautes(cible) {
  if (_nouveautes.has(cible)) return _nouveautes.get(cible);
  const r = calculerNouveautes(cible);
  _nouveautes.set(cible, r);
  return r;
}

function calculerNouveautes(cible) {
  const p = passes(cible, "liens_depuis_domaine", "bing_webmaster");
  if (p.length === 0) return { etat: "jamais mesure" };
  if (p.length === 1) return { etat: "premier releve", date: p[0].date, nb: p[0].lignes.length };

  const avant = p[p.length - 2];
  const apres = p[p.length - 1];

  const total = photo.find((o) => o.sujet?.domaine === cible && o.metrique === "domaines_referents");
  if (total && total.etat === "ANGLE_MORT") {
    return { etat: "passe muette", date: apres.date, preuve: total.preuve };
  }

  const cartes = (passe) => new Map(passe.lignes.filter((o) => o.etat === "MESURE" && o.objet?.domaine).map((o) => [o.objet.domaine, o]));
  const a = cartes(avant);
  const b = cartes(apres);

  const apparus = [...b.values()].filter((o) => !a.has(o.objet.domaine));
  const disparus = [...a.values()].filter((o) => !b.has(o.objet.domaine));
  const bouges = [...b.values()]
    .filter((o) => a.has(o.objet.domaine) && a.get(o.objet.domaine).valeur !== o.valeur)
    .map((o) => ({ obs: o, avant: a.get(o.objet.domaine).valeur, delta: o.valeur - a.get(o.objet.domaine).valeur }));

  const tronque = a.size >= (PLAFONDS.bing_webmaster.domaines_referents || Infinity)
    || b.size >= (PLAFONDS.bing_webmaster.domaines_referents || Infinity);

  return {
    etat: "compare", apparus, disparus, bouges, tronque,
    dateAvant: avant.date, dateApres: apres.date,
    nbAvant: a.size, nbApres: b.size,
  };
}

// =====================================================================================
// LES NOTES MAISON
// =====================================================================================
//
// ⛔ CALCULEES ICI, PAS RELUES DU JOURNAL, et ce n'est pas une redondance. Le journal
//    porte la note du dernier passage de note.mjs ; l'ecran doit montrer la note qui
//    correspond aux observations affichees a cote. Si une collecte a tourne depuis le
//    dernier recalcul, relire le journal afficherait une note et des mesures qui ne
//    parlent pas du meme jour. La COURBE, elle, se lit bien dans le journal : c'est la
//    seule chose que le calcul du jour ne peut pas fabriquer.

const NOTES = new Map();
for (const d of DOMAINES) {
  const role = META.get(d)?.role === "nous" ? "nous" : "concurrent";
  try {
    const ctx = contexteDepuisJournal(d, photo, cfg);
    const n = noteDomaine({ ...ctx, role });
    NOTES.set(d, { ...n, liens: ctx.liens || [] });
  } catch (e) {
    // Une note qui ne se calcule pas est un angle mort de plus, pas une page blanche.
    NOTES.set(d, { erreur: String(e.message || e).slice(0, 200), liens: [] });
  }
}

const POIDS_LISIBLES = "ND = 0,32·TR + 0,26·AA + 0,17·PO + 0,15·CO + 0,10·ST";

function celluleND(n) {
  if (!n) return `<span class="vide">—</span>`;
  if (n.erreur) return `<span class="angle" title="${esc(n.erreur)}">▲ <span class="raison">note impossible</span></span>`;
  if (!n.affichable) {
    return `<span class="fourchette" title="socle de mesure ${Math.round(n.socle * 100)} %, sous le seuil de ${Math.round(SOCLE_AFFICHABLE * 100)} % : la note existe mais on ne sait pas ou elle tombe dans cette fourchette">[${n.plage[0]} ; ${n.plage[1]}]</span><em class="est">fourchette · socle ${Math.round(n.socle * 100)} % · non classe</em>`;
  }
  return `<strong>${n.ND}</strong><em class="est">socle ${Math.round(n.socle * 100)} % · ${esc(n.formule)}</em>`;
}

/** Le detail du calcul, une ligne par axe. « Un score sans son detail, je ne le lirai pas. » */
function tableauNote(n) {
  if (!n || n.erreur) {
    return `<div class="avert"><strong>La note n'a pas pu etre calculee.</strong> ${esc(n?.erreur || "raison inconnue")}</div>`;
  }
  const mesures = n.axes.filter((a) => a.etat !== "ANGLE_MORT" && a.valeur !== null);
  const poidsMesures = mesures.reduce((a, k) => a + k.poids, 0);

  const lignes = n.axes.map((a) => {
    const mesure = a.etat !== "ANGLE_MORT" && a.valeur !== null;
    const partReelle = mesure && poidsMesures > 0 ? a.poids / poidsMesures : 0;
    const contribution = mesure ? a.valeur * partReelle : null;
    return `<tr class="${mesure ? "" : "eteint"}">
  <td><strong>${esc(a.cle)}</strong> ${esc(a.nom)}</td>
  <td class="n">${mesure ? a.valeur : `<span class="angle">▲ <span class="raison">hors calcul</span></span>`}</td>
  <td class="n">${a.poids} %</td>
  <td class="n">${mesure ? `${Math.round(partReelle * 1000) / 10} %` : "<span class=\"doux\">0 %</span>"}</td>
  <td class="n">${contribution == null ? "—" : (Math.round(contribution * 100) / 100)}</td>
  <td class="n">[${a.plage[0]} ; ${a.plage[1]}]</td>
  <td class="n">${Math.round(a.part_mesuree * 100)} %</td>
  <td class="libre">${esc(a.justification)}<br><span class="doux petit">source : ${esc(a.source || "—")}${a.drapeaux?.length ? ` · drapeaux : ${esc(a.drapeaux.join(", "))}` : ""}</span></td>
</tr>`;
  }).join("\n");

  const manquants = n.axes.filter((a) => a.etat === "ANGLE_MORT");

  return `
<p class="grosse-note">${n.affichable
    ? `<span class="valeur">${n.ND}</span> <span class="doux">/ 100</span>`
    : `<span class="valeur">[${n.plage[0]} ; ${n.plage[1]}]</span> <span class="doux">fourchette, non classe</span>`}
  <span class="doux petit">socle de mesure ${Math.round(n.socle * 100)} % · formule ${esc(n.formule)} · role ${esc(n.role)}</span></p>

<p class="petit doux">${esc(POIDS_LISIBLES)}. Le poids reel est le poids nominal renormalise sur les seuls axes mesures :
un axe en angle mort <strong>retire son poids du calcul</strong> au lieu de compter zero, et elargit la fourchette.
Sous ${Math.round(SOCLE_AFFICHABLE * 100)} % de socle, la note ne s'affiche plus en nombre et le domaine sort du classement.</p>

<div class="tableau"><table><thead><tr>
  <th>Axe</th><th>Valeur</th><th>Poids nominal</th><th>Poids reel</th><th>Contribution</th>
  <th>Fourchette</th><th>Part mesuree</th><th>Justification</th>
</tr></thead><tbody>
${lignes}
<tr class="somme"><td>Total</td><td class="n">${n.affichable ? n.ND : "—"}</td><td class="n">100 %</td>
  <td class="n">${poidsMesures > 0 ? "100 %" : "0 %"}</td><td class="n">${n.affichable ? n.ND : "—"}</td>
  <td class="n">[${n.plage[0]} ; ${n.plage[1]}]</td><td class="n">${Math.round(n.socle * 100)} %</td>
  <td class="libre">${n.affichable
    ? "socle suffisant : la note s'affiche en nombre et le domaine se classe."
    : `socle insuffisant : ${manquants.length} axe(s) en angle mort (${esc(manquants.map((a) => a.cle).join(", ")) || "aucun"}). La note reste une fourchette.`}</td></tr>
</tbody></table></div>`;
}

// =====================================================================================
// TRAFIC ESTIME
// =====================================================================================
//
// ⛔ DEUX ESTIMATIONS QUI NE MESURENT PAS LA MEME CHOSE, JAMAIS DANS LA MEME COLONNE :
//    - « visites/mois » vient de la page publique Semrush : c'est un modele de TOUT le
//      trafic du domaine, avec plusieurs semaines de retard.
//    - « clics estimes sur les N requetes suivies ↑ » vient de notre modele : c'est un
//      PLANCHER sur un pool fige de 40 requetes, la fleche dit que le vrai chiffre est
//      au-dessus.
//    Les confondre ferait comparer un domaine mesure sur 40 requetes a un domaine
//    modelise sur des milliers.

const METRIQUE_CLICS = `clics_estimes_requetes_suivies@${cfg.requetes?.version || "pool_inconnu"}`;

function clicsEstimes(d) {
  const o = photo.find((x) => x.sujet?.domaine === d && x.metrique === METRIQUE_CLICS);
  const n = photo.filter((x) => x.sujet?.domaine === d && x.metrique === "clics_estimes" && x.etat === "MESURE").length;
  return { obs: o, n };
}
// L'interdiction s'execute : si un jour ce titre derive vers « trafic organique », la
// generation du site s'arrete au lieu de publier le mensonge.
const TITRE_CLICS = verifierLibelle(libelleTotal(cfg.requetes ? [...(cfg.requetes.fr || []), ...(cfg.requetes.en || [])].length : 0));

// =====================================================================================
// BACKLINKS : les deux comptes, cote a cote, jamais additionnes
// =====================================================================================

/** Un index des liens qualifies par lecture du HTML, par (referent -> cible). */
const QUALIFIES = new Map();
for (const o of photo) {
  if (o.metrique !== "lien_qualifie" || !o.objet?.domaine) continue;
  const cle = `${o.objet.domaine}|${o.sujet?.domaine}`;
  if (!QUALIFIES.has(cle)) QUALIFIES.set(cle, []);
  QUALIFIES.get(cle).push(o);
}

/** L'autorite du site EMETTEUR, telle que mesuree sur lui, pas sur la cible. */
function autoriteEmetteur(referent) {
  // ⛔ ON AFFICHE NOTRE NOTE, PAS OpenPageRank. Arbitrage du 21/08/2026 : chaque backlink
  //    doit porter NOTRE note de l'autorite du site qui l'emet. OpenPageRank se calcule
  //    sur le VOLUME de liens, c'est-a-dire exactement la metrique manipulable que la
  //    doctrine de cet outil refuse. Le relayer tel quel revenait a afficher un Domain
  //    Authority sous un autre nom.
  //    note_emetteur (note-emetteur.mjs) le fait entrer comme UNE composante sur cinq,
  //    a 25 %, derriere la popularite reelle, et le PLAFONNE quand il contredit celle-ci.
  //    On retombe sur OpenPageRank seulement si la note n'a jamais ete calculee, et la
  //    colonne dit alors laquelle des deux elle montre.
  return der(referent, "note_emetteur") || der(referent, "open_page_rank") || der(referent, "rang_majestic") || null;
}

/**
 * ⛔ LA DATE DE L'ESTIMATION MONTE DANS L'EN-TETE DE COLONNE, et ce n'est pas un
 *    contournement de la regle « l'estimation porte sa date a l'ecran ». Repetee dans
 *    trois mille cellules, elle deviendrait du bruit et personne ne la lirait ; en
 *    en-tete, elle est lue une fois et elle vaut pour toute la colonne. La cellule garde
 *    sa preuve et sa date exactes dans son infobulle, et une cellule dont la source
 *    differe de l'en-tete affiche la sienne.
 */
function dateColonneAutorite() {
  const l = photo.filter((o) => o.metrique === "open_page_rank");
  if (!l.length) return null;
  const d = l.reduce((a, o) => ((o.date_donnee || o.date_mesure) > a ? (o.date_donnee || o.date_mesure) : a), "");
  return { date: d, n: l.length };
}

/** La note de lien calculee par note.mjs pour ce couple, s'il y en a une. */
function noteDuLien(cible, referent) {
  const n = NOTES.get(cible);
  if (!n || !n.liens) return null;
  return n.liens.find((l) => l.domaine_source === referent || l.domaine === referent) || null;
}

// ⛔ Les infobulles constantes restent COURTES : repetees sur trois mille lignes, une
//    phrase d'explication pese plus lourd que toutes les donnees de la page. L'explication
//    longue est dans l'encart en haut de l'ecran, ou elle se lit une fois.
const puceSuivi = (s, raison) =>
  s === "DOFOLLOW" ? '<span class="puce df">dofollow</span>'
  : s === "NOFOLLOW" ? '<span class="puce nf">nofollow</span>'
  : raison
    ? `<span class="puce nonlu" title="${esc(raison.aide)}">${esc(raison.court)}</span>`
    : '<span class="puce nonlu" title="la page qui porte ce lien n a pas encore ete ouverte">pas encore lu</span>';

const puceSpam = (v) =>
  v === "SPAM" ? '<span class="puce spam">spam</span>'
  : v === "DOUTEUX" ? '<span class="puce douteux">douteux</span>'
  : v === "PROPRE" ? '<span class="puce propre">propre</span>'
  : v === "NON LU" ? '<span class="puce nonlu" title="page illisible : un mur, ni propre ni sale">non lu</span>'
  : '<span class="puce nonlu" title="page jamais ouverte">non qualifie</span>';

/**
 * Toutes les lignes de la page backlinks : un couple (referent -> cible) par ligne, les
 * liens DISPARUS compris, parce qu'un backlink qui tombe ne fait aucun bruit autrement.
 */
let _lignesBacklinks = null;
function lignesBacklinks() {
  if (_lignesBacklinks) return _lignesBacklinks;
  _lignesBacklinks = calculerLignesBacklinks();
  return _lignesBacklinks;
}

function calculerLignesBacklinks() {
  const out = [];
  const vus = new Set();

  // ⛔ UN LIEN DISPARU EST TOUJOURS DANS LA PHOTO, ET C'EST LE PIEGE DE CE FICHIER.
  //    `dernier()` rend le DERNIER ETAT CONNU de chaque cle, pas ce que la derniere passe
  //    a vu. Un backlink tombe hier garde donc sa ligne d'avant-hier dans la photo, avec
  //    sa valeur intacte : rien ne le distingue d'un lien vivant, sinon sa date. Lire la
  //    photo seule ferait afficher comme presents des liens qu'on sait tombes, ce qui est
  //    exactement le silence qu'on cherche a casser. Le statut vient donc de la
  //    comparaison des passes, jamais de la presence dans la photo.
  // ⛔ UN DOMAINE VU PAR DEUX SOURCES N'EST PAS DEUX DOMAINES. Mesure du 21/08/2026 : Bing
  //    et Search Console voyaient tous les deux le meme forum referent, et sans fusion sa
  //    ligne sortait EN DOUBLE, ce qui rendait le compte de domaines referents faux par
  //    exces. C'est la moitie d'un ecart releve le meme jour entre le tableau, qui
  //    annoncait 11 backlinks, et ce que le journal portait reellement ; l'autre moitie
  //    etait de n'afficher qu'une seule source.
  //    On garde donc UNE ligne par couple, avec le detail par source et, comme compte,
  //    le MAXIMUM des sources : un index qui en voit 8 et un autre 3 ne prouvent pas 11.
  const parCouple = new Map();
  for (const o of photo) {
    if (o.metrique !== "liens_depuis_domaine" || !o.objet?.domaine) continue;
    const cible = o.sujet?.domaine, referent = o.objet.domaine;
    const cle = `${referent}|${cible}`;
    if (!parCouple.has(cle)) parCouple.set(cle, []);
    parCouple.get(cle).push(o);
  }
  for (const [cle, liste] of parCouple) {
    const [referent, cible] = cle.split("|");
    vus.add(cle);
    // La source qui en voit le plus porte la ligne ; les autres restent citees.
    const meilleure = liste.slice().sort((a, b) => (b.valeur || 0) - (a.valeur || 0))[0];
    const l = ligneBacklink(referent, cible, meilleure, estDisparu(cible, referent) ? "disparu" : "present");
    l.sources = liste.map((o) => ({
      nom: o.source?.nom || "?", valeur: o.valeur, nature: o.nature, date: o.date_mesure,
    }));
    out.push(l);
  }

  // Et par securite, ceux que la photo ne porterait pas du tout.
  for (const d of DOMAINES) {
    const n = nouveautes(d);
    if (n.etat !== "compare") continue;
    for (const o of n.disparus) {
      const cle = `${o.objet.domaine}|${d}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      out.push(ligneBacklink(o.objet.domaine, d, o, "disparu"));
    }
  }
  return out;
}

/**
 * Pourquoi un lien n'a pas ete lu. ⛔ « Non qualifie » ne decrit pas le lien, ca decrit
 * NOTRE echec. Constat du 21/08/2026 : un lien est forcement dofollow, nofollow, sponsored
 * ou ugc, donc une colonne qui affiche « non qualifie » ne parle pas du lien, elle parle
 * de nous. Tant qu'on n'a pas lu, on n'invente pas de verdict, mais on dit exactement CE
 * QUI NOUS EN EMPECHE : un mur, un robots.txt, une page introuvable. Trois choses
 * differentes, trois suites differentes a donner.
 */
const RAISONS = new Map();
for (const o of photo) {
  if (o.metrique !== "page_portante" || o.etat !== "ANGLE_MORT") continue;
  const cle = `${o.objet?.domaine}|${o.sujet?.domaine}`;
  const dr = o.drapeaux || [];
  const p = String(o.preuve || "");
  let court = "page introuvable", aide = p;
  if (dr.includes("robots_txt_interdit_tout")) { court = "crawl interdit"; }
  else if (/403|429/.test(p)) { court = "mur 403"; }
  else if (/robots\.txt/i.test(p)) { court = "chemin interdit"; }
  RAISONS.set(cle, { court, aide });
}

function ligneBacklink(referent, cible, o, statut) {
  const q = (QUALIFIES.get(`${referent}|${cible}`) || [])[0];
  const det = q?.objet?.detail || {};
  const nl = noteDuLien(cible, referent);
  const aut = autoriteEmetteur(referent);
  const nouv = statut === "present" && estApparu(cible, referent);
  return {
    referent, cible, statut,
    nouveau: nouv,
    liensBing: o.etat === "MESURE" ? o.valeur : null,
    obsBing: o,
    liensQualifies: (QUALIFIES.get(`${referent}|${cible}`) || []).length,
    suivi: det.suivi_effectif || det.suivi || null,
    spam: det.spam?.verdict || null,
    scoreSpam: det.spam?.score ?? null,
    signaux: det.spam?.signaux || [],
    urlSource: det.url_source || q?.objet?.url || null,
    ancre: det.ancre || q?.objet?.ancre || null,
    nl, aut,
    raisonNonLu: RAISONS.get(`${referent}|${cible}`) || null,
  };
}

const APPARUS = new Map();
const DISPARUS = new Map();
for (const d of DOMAINES) {
  const n = nouveautes(d);
  if (n.etat !== "compare") continue;
  APPARUS.set(d, new Set(n.apparus.map((o) => o.objet.domaine)));
  DISPARUS.set(d, new Set(n.disparus.map((o) => o.objet.domaine)));
}
/**
 * UNION DES SOURCES : combien de domaines DISTINCTS pointent vers `cible`, vus par AU
 * MOINS une source.
 *
 * ⛔ C'EST LA SEULE PHRASE VRAIE QU'ON PUISSE ECRIRE. Les index divergent : mesure du
 *    21/08/2026 sur un meme site reel, Bing voyait 8 domaines referents, Search Console
 *    11, et Ahrefs en annoncait 240 le 16/08. Aucun des trois n'est le total. Afficher le
 *    chiffre d'une seule source le fait lire comme un compte, ce qui est faux par defaut ; les
 *    additionner serait faux par exces, puisqu'ils se recoupent.
 *    On rend donc l'UNION, et on l'affiche « au moins N ».
 */
function unionReferents(cible) {
  const parSource = new Map();
  const nommes = new Set();
  for (const o of photo) {
    if (o.metrique !== "liens_depuis_domaine" || o.sujet?.domaine !== cible || !o.objet?.domaine) continue;
    nommes.add(o.objet.domaine);
    const src = o.source?.nom || "?";
    if (!parSource.has(src)) parSource.set(src, new Set());
    parSource.get(src).add(o.objet.domaine);
  }
  for (const [cle] of QUALIFIES) {
    const [ref, cib] = cle.split("|");
    if (cib !== cible) continue;
    nommes.add(ref);
    if (!parSource.has("lecture_html")) parSource.set("lecture_html", new Set());
    parSource.get("lecture_html").add(ref);
  }

  // ⛔ LE MEILLEUR COMPTE N'EST PAS L'UNION DES DOMAINES NOMMES, ET C'ETAIT L'ERREUR.
  //    Bing et Search Console nomment leurs referents un par un, donc on peut les unir.
  //    Ahrefs, lui, rend un COMPTE (250 sur le site mesure le 21/08/2026) et seulement
  //    trois exemples d'URL : impossible d'unir un compte avec une liste. Afficher l'union
  //    des noms revenait a annoncer 15 la ou Ahrefs en voit 250, soit un facteur seize.
  //    On affiche donc le plus grand compte connu, avec la source qui le porte, et a
  //    cote le nombre de referents qu'on sait NOMMER. Les deux chiffres repondent a deux
  //    questions differentes : « combien » et « lesquels ».
  const comptes = [];
  for (const o of photo) {
    if (o.metrique !== "domaines_referents" || o.sujet?.domaine !== cible) continue;
    if (o.etat !== "MESURE" || o.valeur == null) continue;
    comptes.push({ nom: o.source?.nom || "?", valeur: o.valeur, nature: o.nature, obs: o });
  }
  comptes.sort((a, b) => b.valeur - a.valeur);
  const meilleur = comptes[0] || null;

  return {
    // `total` reste le meilleur compte connu : c'est lui qu'on montre et qu'on compare.
    total: meilleur ? meilleur.valeur : nommes.size,
    source: meilleur ? meilleur.nom : null,
    plafond: meilleur ? auPlafond(meilleur.obs) : false,
    nommes: nommes.size,
    comptes,
    parSource: [...parSource.entries()].map(([nom, x]) => ({ nom, n: x.size })).sort((a, b) => b.n - a.n),
  };
}

const estApparu = (cible, referent) => APPARUS.get(cible)?.has(referent) || false;
const estDisparu = (cible, referent) => DISPARUS.get(cible)?.has(referent) || false;

// =====================================================================================
// MISE EN PAGE
// =====================================================================================

const CSS = `
/* =====================================================================================
   LA VIGIE — feuille de style.

   ⛔ AUCUNE RESSOURCE EXTERIEURE. Le site vit derriere une authentification HTTP Basic :
      une police Google ou un CDN y serait au mieux bloque, au pire une fuite (chaque
      chargement dirait a un tiers qu'on consulte cette page, et a quelle heure).
      Tout est en ligne dans le HTML : polices systeme, SVG ecrits a la main, zero requete.

   ⛔ LES DEUX THEMES SONT CHOISIS, PAS INVERSES. Le sombre n'est pas le clair retourne :
      ses couleurs de serie sont re-echelonnees pour son fond, et validees contre lui.
      Palette passee au validateur du systeme dataviz, les six controles au vert dans les
      deux modes : bande de clarte, plancher de chroma, separation daltonisme (ΔE 24,7
      clair / 26,8 sombre, cible 8), plancher vision normale (33,6 / 31,8, plancher 15),
      contraste sur le fond (≥ 3:1).

   ⛔ LA COULEUR SUIT L'ENTITE, JAMAIS SON RANG. Vos domaines sont orange partout, les
      concurrents bleus partout. Un filtre qui change le nombre de lignes ne doit pas
      repeindre les survivants.

   ⛔ LE TEXTE PORTE DES JETONS DE TEXTE, JAMAIS LA COULEUR D'UNE SERIE. Un chiffre en
      bleu vif se lit mal et ne veut rien dire de plus ; c'est la pastille a cote qui
      porte l'identite.
   ===================================================================================== */

:root{
  color-scheme: light;

  /* --- surfaces et encres --- */
  --fond:#f7f7f5;
  --carte:#ffffff;
  --carte2:#fbfbf9;
  --bord:#e4e2dc;
  --bord-fort:#cfccc4;
  --texte:#14140f;
  --texte2:#54524b;
  --doux:#7b786f;

  /* --- series, palette validee --- */
  --nous:#eb6834;          /* nos domaines, slot 2 : orange */
  --eux:#2a78d6;           /* concurrents, slot 1 : bleu */
  --nous-voile:#fdeee7;
  --eux-voile:#e8f0fb;

  /* --- etats, reserves : jamais reutilises comme « serie 3 » --- */
  --ok:#116b40;
  --ok-fond:#e4f3ea;
  --attention:#7d6110;
  --attention-fond:#faf1d8;
  --grave:#96331a;
  --grave-fond:#fbe9e3;
  --neutre-fond:#efeeea;

  --ombre:0 1px 2px rgba(20,20,15,.05), 0 4px 14px rgba(20,20,15,.045);
  --ombre-h:0 2px 6px rgba(20,20,15,.08), 0 10px 26px rgba(20,20,15,.07);
  --arrondi:12px;
}

@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme: dark;
    --fond:#131316;
    --carte:#1b1b1f;
    --carte2:#202025;
    --bord:#2f2f36;
    --bord-fort:#43434c;
    --texte:#f2f1ee;
    --texte2:#b9b7b0;
    --doux:#8d8a83;
    --nous:#d95926;
    --eux:#3987e5;
    --nous-voile:#2a1a12;
    --eux-voile:#121e2e;
    --ok:#4cc389;
    --ok-fond:#13301f;
    --attention:#d8b755;
    --attention-fond:#2f2712;
    --grave:#ea8a6d;
    --grave-fond:#331a12;
    --neutre-fond:#26262c;
    --ombre:0 1px 2px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.3);
    --ombre-h:0 2px 8px rgba(0,0,0,.5), 0 12px 30px rgba(0,0,0,.4);
  }
}

*{box-sizing:border-box}
html,body{max-width:100%;overflow-x:hidden}
body{
  margin:0;background:var(--fond);color:var(--texte);
  font:15px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
  font-variant-numeric:tabular-nums;
}

/* ------------------------------------------------------------------ ossature */
.enveloppe{max-width:1320px;margin:0 auto;padding:0 20px 96px}

.barre{
  position:sticky;top:0;z-index:40;
  background:color-mix(in srgb, var(--fond) 86%, transparent);
  backdrop-filter:saturate(180%) blur(12px);
  border-bottom:1px solid var(--bord);
  margin:0 -20px 0;padding:0 20px;
}
.barre .dedans{
  max-width:1320px;margin:0 auto;
  display:flex;align-items:center;gap:18px;
  min-height:58px;flex-wrap:wrap;
}
.marque{display:flex;align-items:center;gap:9px;font-weight:650;letter-spacing:-.2px;font-size:15px}
.marque .oeil{
  width:22px;height:22px;border-radius:7px;flex:none;
  background:linear-gradient(140deg,var(--nous),var(--eux));
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);
}
.marque .sous{color:var(--doux);font-weight:450;font-size:12.5px;letter-spacing:0}
nav.onglets{display:flex;gap:3px;margin-left:auto;flex-wrap:wrap}
nav.onglets a{
  color:var(--texte2);text-decoration:none;font-size:13.5px;font-weight:500;
  padding:6px 13px;border-radius:999px;white-space:nowrap;
}
nav.onglets a:hover{background:var(--neutre-fond);color:var(--texte)}
nav.onglets a.ici{background:var(--texte);color:var(--fond);font-weight:600}

/* ------------------------------------------------------------------ titres */
.entete{padding:34px 0 4px}
h1{font-size:clamp(26px,3.4vw,36px);margin:0 0 6px;letter-spacing:-.9px;line-height:1.12;font-weight:680}
.chapeau{color:var(--texte2);font-size:16px;max-width:74ch;margin:0}
h2{font-size:19px;margin:40px 0 4px;letter-spacing:-.35px;font-weight:640}
h2 + .sous-titre{color:var(--doux);font-size:13.5px;margin:0 0 14px}
h3{font-size:12px;margin:26px 0 9px;color:var(--doux);text-transform:uppercase;letter-spacing:.08em;font-weight:640}
p{margin:.55em 0}
a{color:var(--eux)}
.doux{color:var(--doux)}
.petit{font-size:12.5px}
code{font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:var(--neutre-fond);padding:1px 5px;border-radius:5px}

/* ------------------------------------------------------------------ cartes de tete */
.grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:22px 0 6px}
.carte{
  background:var(--carte);border:1px solid var(--bord);border-radius:var(--arrondi);
  padding:17px 18px 16px;box-shadow:var(--ombre);position:relative;overflow:hidden;
}
.carte .chiffre{
  font-size:clamp(28px,3.6vw,38px);font-weight:700;letter-spacing:-1.4px;line-height:1.05;
  display:block;
}
.carte .quoi{color:var(--texte2);font-size:13px;margin-top:7px;line-height:1.45}
.carte .note{color:var(--doux);font-size:11.5px;margin-top:9px;padding-top:9px;border-top:1px solid var(--bord)}
.carte.vedette{border-color:color-mix(in srgb,var(--nous) 42%,var(--bord))}
.carte.vedette:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--nous)}

/* ------------------------------------------------------------------ encarts */
.avert{
  background:var(--carte2);border:1px solid var(--bord);border-left:3px solid var(--attention);
  padding:14px 16px;border-radius:10px;margin:20px 0;font-size:13.5px;line-height:1.6;color:var(--texte2);
}
.avert strong{color:var(--texte)}
.encart{
  background:var(--carte);border:1px solid var(--bord);border-radius:var(--arrondi);
  padding:18px 20px;margin:20px 0;box-shadow:var(--ombre);
}
.encart h2{margin-top:0}

/* ------------------------------------------------------------------ tableaux */
.tableau{
  overflow-x:auto;border:1px solid var(--bord);border-radius:var(--arrondi);
  background:var(--carte);box-shadow:var(--ombre);
  -webkit-overflow-scrolling:touch;
}
table{border-collapse:separate;border-spacing:0;width:100%;font-size:13.5px;white-space:nowrap}
th,td{padding:10px 13px;text-align:left;border-bottom:1px solid var(--bord);vertical-align:top}
thead th{
  background:var(--carte2);font-weight:620;font-size:11px;text-transform:uppercase;
  letter-spacing:.07em;color:var(--doux);position:sticky;top:0;z-index:5;
  border-bottom:1px solid var(--bord-fort);white-space:normal;line-height:1.35;
}
/* ⛔ « top:58px » RECOUVRAIT LA PREMIERE LIGNE DE DONNEES. Un conteneur en overflow
   devient son PROPRE scrollport : un sticky s'y positionne par rapport a la boite, pas
   par rapport a la barre de navigation. Le decalage de 58 px poussait donc l'en-tete
   58 px A L'INTERIEUR du tableau, par-dessus la ligne 1, et une ligne cachee ne se
   remarque pas : on croit simplement que le domaine n'y est pas.
   Corollaire : pour qu'un en-tete collant serve a quelque chose, sa boite doit pouvoir
   defiler VERTICALEMENT. D'ou .tableau.haut sur les longs tableaux. */
.tableau.haut{max-height:74vh;overflow:auto}
table[data-triable] thead th{cursor:pointer;user-select:none}
table[data-triable] thead th:hover{color:var(--texte)}
thead th[aria-sort]:after{content:"";margin-left:5px;opacity:.75}
thead th[aria-sort=ascending]:after{content:"↑"}
thead th[aria-sort=descending]:after{content:"↓"}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover td{background:var(--carte2)}
td.n{text-align:right;font-variant-numeric:tabular-nums}
td.libre,th.libre-th{white-space:normal;min-width:190px}
tr.section td{
  background:var(--neutre-fond);font-size:10.5px;font-weight:700;text-transform:uppercase;
  letter-spacing:.1em;color:var(--doux);padding:7px 13px;
}
td.fixe{
  position:sticky;left:0;background:var(--carte);z-index:3;
  border-right:1px solid var(--bord);white-space:normal;min-width:200px;font-weight:520;
}
tbody tr:hover td.fixe{background:var(--carte2)}
th.fixe-th{position:sticky;left:0;z-index:8;background:var(--carte2);border-right:1px solid var(--bord-fort)}
.col-nous{background:var(--nous-voile)}
tbody tr:hover td.col-nous{background:color-mix(in srgb,var(--nous-voile) 80%, var(--carte2))}

/* ------------------------------------------------------------------ pastilles */
.puce{
  display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;
  border:1px solid var(--bord-fort);color:var(--texte2);background:var(--carte2);line-height:1.5;
}
.puce.df{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent);background:var(--ok-fond)}
.puce.nf{color:var(--doux)}
.puce.spam{color:var(--grave);border-color:color-mix(in srgb,var(--grave) 45%,transparent);background:var(--grave-fond)}
.puce.douteux{color:var(--attention);border-color:color-mix(in srgb,var(--attention) 45%,transparent);background:var(--attention-fond)}
.puce.propre{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent);background:var(--ok-fond)}
.puce.nonlu{color:var(--doux);border-style:dashed;background:transparent}
.puce.neuf{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent);background:var(--ok-fond);margin-left:7px}
.puce.perdu{color:var(--grave);border-color:color-mix(in srgb,var(--grave) 45%,transparent);background:var(--grave-fond);margin-left:7px}

/* ------------------------------------------------------------------ etats de mesure */
.angle{color:var(--attention);font-weight:650;cursor:help}
.angle .raison{font-weight:450;font-size:11.5px;color:var(--doux)}
.absent{color:var(--doux);font-style:italic;cursor:help}
.vide{color:var(--bord-fort)}
.est{
  color:var(--doux);font-size:10.5px;margin-left:6px;border:1px solid var(--bord);
  border-radius:4px;padding:0 4px;cursor:help;font-style:normal;vertical-align:1px;
}
.fourchette{color:var(--texte2);font-weight:600}
.li-disparu td{opacity:.62}

/* ------------------------------------------------------------------ barres et graphiques */
.barre-mesure{
  display:inline-block;height:8px;border-radius:3px;vertical-align:middle;margin-right:8px;
  min-width:2px;background:var(--eux);
}
.barre-mesure.moi{background:var(--nous)}

.graphe{width:100%;overflow:visible}
.graphe .fond{fill:var(--neutre-fond)}
.graphe .barre{fill:var(--eux)}
.graphe .barre.moi{fill:var(--nous)}
.graphe .etiq{fill:var(--texte2);font-size:12px}
.graphe .etiq.moi{fill:var(--texte);font-weight:640}
.graphe .val{fill:var(--texte);font-size:12px;font-weight:620}
.graphe .val.pale{fill:var(--doux);font-weight:450}
.graphe .regle{stroke:var(--bord);stroke-width:1}
.graphe .plafond{fill:var(--doux);font-size:10.5px}

.legende{display:flex;gap:16px;align-items:center;margin:10px 0 2px;font-size:12.5px;color:var(--texte2);flex-wrap:wrap}
.legende .item{display:flex;align-items:center;gap:6px}
.legende .pastille{width:11px;height:11px;border-radius:3px;flex:none}
.legende .pastille.nous{background:var(--nous)}
.legende .pastille.eux{background:var(--eux)}

.spark{vertical-align:middle}
.spark .trait{fill:none;stroke:var(--eux);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.spark .pt{fill:var(--eux)}
.spark .trou{fill:var(--attention)}

/* ------------------------------------------------------------------ detail d'un lien */
tr.detail > td{background:var(--carte2);padding:0}
tr.ouverte td{background:var(--carte2)}
tr.ouverte td:first-child{box-shadow:inset 3px 0 0 var(--nous)}
.detail-bloc{padding:16px 18px;white-space:normal}
.detail-lien{border:1px solid var(--bord);border-radius:10px;padding:12px 14px;margin:10px 0;background:var(--carte)}
.detail-tete{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-bottom:9px}
.detail-tete code{font-size:12px}
.detail-table{width:100%;font-size:13px;border-collapse:collapse;white-space:normal}
.detail-table td{border:none;padding:4px 0;vertical-align:top}
.detail-table td.k{color:var(--doux);width:190px;padding-right:14px;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.detail-table a{word-break:break-all}

/* ------------------------------------------------------------------ filtres */
.filtres{
  display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:16px 0 12px;
  padding:13px 14px;background:var(--carte);border:1px solid var(--bord);
  border-radius:var(--arrondi);box-shadow:var(--ombre);
}
input[type=search],select{
  background:var(--carte2);color:var(--texte);border:1px solid var(--bord-fort);
  border-radius:8px;padding:7px 11px;font-size:13.5px;font-family:inherit;
}
input[type=search]{min-width:230px}
input[type=search]:focus,select:focus{outline:2px solid var(--eux);outline-offset:1px}
.bascule{
  display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;
  border:1px solid var(--bord-fort);background:var(--carte2);font-size:13px;cursor:pointer;
  color:var(--texte2);
}
.bascule input{margin:0;accent-color:var(--eux)}
.bascule:hover{border-color:var(--doux)}
.compteur{color:var(--doux);font-size:13px;margin-left:auto}

/* ------------------------------------------------------------------ note maison */
.note-vedette{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:8px 0 4px}
.note-vedette .nd{font-size:clamp(38px,5vw,52px);font-weight:700;letter-spacing:-2px;line-height:1}
.note-vedette .sur{color:var(--doux);font-size:17px}
.note-vedette .socle{color:var(--texte2);font-size:13px}

/* ------------------------------------------------------------------ pied */
footer{
  margin-top:52px;padding:18px 0 0;border-top:1px solid var(--bord);
  color:var(--doux);font-size:12.5px;line-height:1.7;
}
footer strong{color:var(--texte2)}

@media (max-width:640px){
  .enveloppe{padding:0 14px 70px}
  thead th{position:static}
  td.fixe{position:static;border-right:none}
  .compteur{margin-left:0;width:100%}
}
`;

// ⛔ Le tri renvoie TOUJOURS les lignes hors classement a la fin, dans les deux sens.
//    Sans cette regle, un tri croissant remonterait en tete les domaines qu'on n'a pas
//    mesures, ce qui les ferait passer pour les meilleurs.
const TRI = `
document.querySelectorAll('table[data-triable]').forEach(function(t){
  t.querySelectorAll('th').forEach(function(th,i){
    if(th.classList.contains('libre-th')) return;
    th.addEventListener('click',function(){
      var croissant = th.dataset.sens !== 'asc';
      t.querySelectorAll('th').forEach(function(x){ delete x.dataset.sens; x.removeAttribute('aria-sort'); });
      th.dataset.sens = croissant ? 'asc' : 'desc';
      th.setAttribute('aria-sort', croissant ? 'ascending' : 'descending');
      var corps = t.tBodies[0];
      var rangs = Array.prototype.slice.call(corps.rows);
      rangs.sort(function(a,b){
        var ha = a.dataset.horsClassement === '1', hb = b.dataset.horsClassement === '1';
        if(ha !== hb) return ha ? 1 : -1;
        var x=a.cells[i], y=b.cells[i];
        if(!x || !y) return 0;
        var vx = (x.dataset.v !== undefined && x.dataset.v !== '') ? parseFloat(x.dataset.v) : NaN;
        var vy = (y.dataset.v !== undefined && y.dataset.v !== '') ? parseFloat(y.dataset.v) : NaN;
        var mx = isNaN(vx), my = isNaN(vy);
        if(mx !== my) return mx ? 1 : -1;
        if(!mx && !my) return croissant ? vx-vy : vy-vx;
        var tx=(x.innerText||'').trim().toLowerCase(), ty=(y.innerText||'').trim().toLowerCase();
        return croissant ? tx.localeCompare(ty) : ty.localeCompare(tx);
      });
      rangs.forEach(function(r){ corps.appendChild(r); });
    });
  });
});
`;

const DATE_RELEVE = photo.reduce((a, o) => (o.date_mesure > a ? o.date_mesure : a), "");

/**
 * LE PREMIER ECRAN D'UNE INSTALLATION NEUVE.
 *
 * ⛔ TANT QUE LE JOURNAL EST VIDE, C'EST LA SEULE CHOSE QUE LA PAGE A LE DROIT DE DIRE.
 *    La personne qui vient d'installer l'outil n'a pas encore collecte : son journal est
 *    vide par construction, et c'est le seul ecran qu'elle verra avant de decider si
 *    l'outil sert a quelque chose. Un tableau de bord qui lui rend des cases a zero lui
 *    enseigne une faussete sur son propre site des la premiere minute, et c'est
 *    exactement l'interdit numero 1 de ce fichier applique a son cas le plus visible.
 *    On remplace donc les chiffres par la marche a suivre, commande par commande.
 */
const BANDEAU_VIDE = `<div class="encart" style="border-color:var(--bord-fort)">
  <h2 style="margin-top:0">Aucune mesure au journal : rien n'a encore ete collecte</h2>
  <p>Ce n'est pas un site a zero, c'est un site <strong>qu'on n'a pas encore regarde</strong>.
  Les pages ci-dessous sont deja en place, elles se rempliront a la premiere collecte.
  Aucun chiffre n'est affiche tant qu'aucune source n'a repondu.</p>
  <p class="sous-titre" style="margin-bottom:8px">La premiere passe ne demande aucun compte et aucune cle :</p>
  <pre style="margin:0;padding:12px;background:var(--carte2);border:1px solid var(--bord);border-radius:9px;
    font:12px/1.7 ui-monospace,Menlo,Consolas,monospace;overflow:auto">node outils/collecte-domaine.mjs
node outils/collecte-tranco-liste.mjs
node outils/note.mjs
node outils/site.mjs</pre>
  <p class="doux petit" style="margin-bottom:0">Elle donne la sante technique, la couverture de contenu et la
  popularite de tous les domaines de votre <code>config/domaines.json</code>. Les backlinks arrivent ensuite,
  avec <code>collecte-bing-backlinks.mjs</code> puis <code>collecte-rel.mjs</code>.
  Les apparitions et les disparitions demandent <strong>deux</strong> passes : c'est au deuxieme
  passage que ce tableau de bord commence a servir a quelque chose.</p>
</div>`;

function page(titre, corps, actif, { scripts = "", chapeau = null } = {}) {
  const onglets = [
    ["index.html", "Comparateur"],
    ["backlinks.html", "Backlinks"],
    ["opportunites.html", "Opportunites"],
    ["note.html", "La note"],
    ["methode.html", "Methode"],
  ];
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<meta name="referrer" content="no-referrer">
<title>${esc(titre)} · ${esc(NOM_COURT)}</title><style>${CSS}</style></head><body>
<div class="barre"><div class="dedans">
  <a class="marque" href="index.html" style="text-decoration:none;color:inherit">
    <span class="oeil"></span>${esc(NOM_COURT)} <span class="sous">· ${esc(MARQUE)}</span></a>
  <nav class="onglets">${onglets.map(([u, l]) =>
    `<a href="${u}"${u === actif ? ' class="ici"' : ""}>${l}</a>`).join("")}</nav>
</div></div>
<div class="enveloppe">
<div class="entete"><h1>${esc(titre)}</h1>${chapeau ? `<p class="chapeau">${chapeau}</p>` : ""}</div>
${VIDE ? BANDEAU_VIDE : ""}
${corps}
<footer>
  <strong>Dernier releve :</strong> ${DATE_RELEVE
    ? `${esc(DATE_RELEVE.slice(0, 16).replace("T", " a "))} UTC · ${nb(photo.length)} observation${photo.length > 1 ? "s" : ""} l'alimentent, sur ${nb(obs.length)} au journal${illisibles ? `, ${illisibles} ligne(s) illisible(s)` : ""}`
    : "aucun, le journal est vide"} ·
  ${nb(DOMAINES.length)} domaines suivis · genere par ${esc(VERSION)}, note ${esc(VERSION_NOTE)}.<br>
  <strong>▲</strong> = angle mort : la mesure a echoue, ce n'est pas un zero ·
  <strong>≥</strong> = plancher : la source plafonne, le vrai nombre est au-dessus ·
  <strong>estimation</strong> = modele, jamais un releve.
</footer></div><script>${TRI}${scripts}</script></body></html>`;
}

/**
 * Graphique a barres horizontales, en SVG ecrit a la main.
 *
 * ⛔ UNE SEULE SERIE, DONC UNE SEULE TEINTE. La couleur ne code pas le rang, elle code
 *    l'IDENTITE : vos domaines sont orange, les concurrents sont bleus, et ca ne bouge
 *    pas quand on trie. Un graphique qui repeint ses barres au tri fait croire a un
 *    changement qui n'a pas eu lieu.
 * ⛔ CHAQUE BARRE PORTE SON CHIFFRE EN CLAIR, a droite. Une barre sans son nombre oblige
 *    a viser un axe a l'oeil, et un plafond « ≥ » ne se lit pas du tout sur un axe.
 */
function barres(donnees, { hauteurLigne = 30, largeurEtiq = 168, largeur = 900 } = {}) {
  const vus = donnees.filter((d) => d.valeur != null);
  if (!vus.length) return `<p class="doux petit">Aucune valeur mesuree a tracer.</p>`;
  const max = Math.max(...vus.map((d) => d.valeur), 1);
  const h = donnees.length * hauteurLigne + 10;
  const largeurBarre = largeur - largeurEtiq - 96;
  const lignes = donnees.map((d, i) => {
    const y = i * hauteurLigne + 6;
    const l = d.valeur == null ? 0 : Math.max(2, (d.valeur / max) * largeurBarre);
    const etiqVal = d.valeur == null
      ? `<text class="val pale" x="${largeurEtiq + largeurBarre + 10}" y="${y + 13}">▲ non mesure</text>`
      : `<text class="val" x="${largeurEtiq + l + 9}" y="${y + 13}">${d.plancher ? "≥ " : ""}${nb(d.valeur)}</text>`;
    return `<g>
      <text class="etiq${d.moi ? " moi" : ""}" x="0" y="${y + 13}">${esc(d.nom.slice(0, 24))}</text>
      <rect class="fond" x="${largeurEtiq}" y="${y + 3}" width="${largeurBarre}" height="14" rx="4"/>
      ${d.valeur == null ? "" : `<rect class="barre${d.moi ? " moi" : ""}" x="${largeurEtiq}" y="${y + 3}" width="${l.toFixed(1)}" height="14" rx="4"><title>${esc(d.nom)} : ${d.plancher ? "au moins " : ""}${nb(d.valeur)}${d.aide ? " — " + esc(d.aide) : ""}</title></rect>`}
      ${etiqVal}
    </g>`;
  }).join("");
  return `<svg class="graphe" viewBox="0 0 ${largeur} ${h}" width="100%" height="${h}" role="img"
    aria-label="comparaison, ${donnees.length} domaines"><g>${lignes}</g></svg>`;
}

/** Courbe minuscule, en SVG ecrit a la main : aucune bibliotheque, le site est hors ligne. */
function sparkline(points, { largeur = 130, hauteur = 26 } = {}) {
  const val = points.filter((p) => p.y != null).map((p) => p.y);
  if (val.length < 2) return "";
  const min = Math.min(...val), max = Math.max(...val);
  const ampl = max - min || 1;
  const x = (i) => (points.length === 1 ? 0 : (i * (largeur - 4)) / (points.length - 1)) + 2;
  const y = (v) => hauteur - 3 - ((v - min) / ampl) * (hauteur - 6);
  let d = "", ouvert = false;
  points.forEach((p, i) => {
    if (p.y == null) { ouvert = false; return; }
    d += `${ouvert ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)} `;
    ouvert = true;
  });
  const trous = points.map((p, i) => (p.y == null
    ? `<rect class="trou" x="${(x(i) - 1.5).toFixed(1)}" y="${(hauteur / 2 - 1.5).toFixed(1)}" width="3" height="3"/>` : "")).join("");
  const dernier = [...points].reverse().find((p) => p.y != null);
  const iDernier = points.lastIndexOf(dernier);
  return `<svg class="spark" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="evolution de ${nb(points[0]?.y)} a ${nb(dernier?.y)}">
<path class="trait" d="${d.trim()}"/>${trous}<circle class="pt" cx="${x(iDernier).toFixed(1)}" cy="${y(dernier.y).toFixed(1)}" r="2"/></svg>`;
}

// =====================================================================================
// LE BANDEAU « NOUVEAU DEPUIS LE DERNIER RELEVE »
// =====================================================================================

function bandeauNouveautes(cibles, { titre = "Depuis le releve precedent", compact = false } = {}) {
  const blocs = [];
  let totalApparus = 0, totalDisparus = 0, comparees = 0;
  let premiers = 0, datePremier = "";

  for (const d of cibles) {
    const n = nouveautes(d);
    if (n.etat === "jamais mesure") continue;

    if (n.etat === "premier releve") {
      premiers++;
      if (n.date > datePremier) datePremier = n.date;
      if (!compact) {
        blocs.push(`<p class="rien"><strong>${esc(META.get(d)?.libelle || d)}</strong> · premier releve du ${jour(n.date)}, ${nb(n.nb)} domaines referents vus.
        Rien a comparer : l'ecart apparaitra au deuxieme passage. Ce n'est pas « aucun changement ».</p>`);
      }
      continue;
    }
    if (n.etat === "passe muette") {
      blocs.push(`<p class="rien"><strong class="angle">▲ ${esc(META.get(d)?.libelle || d)}</strong> · la source n'a pas repondu au dernier passage (${esc(String(n.preuve || "").slice(0, 140))}).
      <strong>Aucune disparition n'est affirmee</strong> : tous ces liens paraitraient tombes alors que c'est la mesure qui manque.</p>`);
      continue;
    }

    comparees++;
    totalApparus += n.apparus.length;
    totalDisparus += n.disparus.length;
    if (!n.apparus.length && !n.disparus.length && compact) continue;

    const puces = (liste, classe, signe) => liste.slice(0, 30).map((o) =>
      `<a class="puce ${classe}" href="backlinks.html#${esc(ancre(o.objet.domaine, d))}" title="${esc(o.preuve || "")}">${signe} ${esc(o.objet.domaine)} <span class="doux">${nb(o.valeur)}</span></a>`).join(" ")
      + (liste.length > 30 ? ` <span class="doux petit">et ${liste.length - 30} autres</span>` : "");

    blocs.push(`<div class="bloc-nouv">
  <p><strong>${esc(META.get(d)?.libelle || d)}</strong>
    <span class="doux petit">${jour(n.dateAvant)} → ${jour(n.dateApres)} · ${nb(n.nbAvant)} → ${nb(n.nbApres)} domaines referents</span></p>
  ${n.disparus.length ? `<div class="ligne"><span class="doux petit">disparus :</span> ${puces(n.disparus, "perdu", "−")}</div>` : ""}
  ${n.apparus.length ? `<div class="ligne"><span class="doux petit">apparus :</span> ${puces(n.apparus, "neuf", "+")}</div>` : ""}
  ${!n.apparus.length && !n.disparus.length ? `<p class="rien">aucun mouvement de domaine referent entre ces deux passes.</p>` : ""}
  ${n.tronque ? `<p class="rien">⛔ Une des deux passes touche le plafond de ${PLAFONDS.bing_webmaster.domaines_referents} domaines de Bing :
     le bas de liste est tronque, un referent peut « disparaitre » simplement parce qu'un autre est passe devant lui. A ne pas lire comme une perte de lien.</p>` : ""}
</div>`);
  }

  // ⛔ « Rien a signaler » et « je n'ai regarde qu'une fois » se ressemblent a l'ecran et
  //    n'ont rien a voir. Le premier dit que le profil de liens est stable, le second dit
  //    qu'on ne sait pas encore. Tant qu'une cible n'a qu'une passe, le bandeau annonce
  //    le premier releve, sa date, et ce qu'il faut attendre pour avoir un ecart.
  //    Et le cas zero passe se distingue lui aussi du cas une passe : « premier releve sur
  //    0 domaine » n'a aucun sens a l'ecran, alors que « le collecteur n'est jamais passe »
  //    dit exactement ou l'on en est.
  const resume = premiers === 0 && comparees === 0
    ? `<span class="doux">Le collecteur de backlinks n'est encore jamais passe : il n'y a ni mouvement, ni absence de mouvement, il n'y a <strong>aucune mesure</strong>.
       Lancez <code>node outils/collecte-bing-backlinks.mjs</code> pour ouvrir la premiere passe.</span>`
    : comparees === 0
    ? `<span class="doux">Premier releve${datePremier ? ` du ${jour(datePremier)}` : ""} sur ${nb(premiers)} domaine(s) : aucun ecart n'est calculable.
       <strong>Ce n'est pas « aucun changement »</strong>, c'est « je n'ai regarde qu'une fois ». Le second passage du collecteur ouvrira la comparaison.</span>`
    : `<span class="puce neuf">+ ${nb(totalApparus)} apparus</span> <span class="puce perdu">− ${nb(totalDisparus)} disparus</span>
       <span class="doux petit">sur ${nb(comparees)} domaine(s) repasse(s)${premiers ? `, ${nb(premiers)} encore au premier releve` : ""}</span>`;

  const rien = comparees === 0
    ? ""
    : `<p class="rien">Rien a signaler sur les domaines repasses.</p>`;

  return `<div class="bandeau">
<h2>${esc(titre)}</h2>
<p>${resume}</p>
${blocs.join("\n") || rien}
<p class="rien">Un backlink qui tombe ne fait aucun bruit : c'est la seule ligne de ce site qui se lit meme quand elle est vide.
Une disparition n'est annoncee que si le collecteur est <strong>repasse</strong> sur la cible.</p>
</div>`;
}

// =====================================================================================
// PAGE 1 : LE COMPARATEUR, DOMAINES EN COLONNES
// =====================================================================================

function ordreDomaines() {
  const notre = DOMAINES.filter((d) => META.get(d)?.role === "nous");
  const autres = DOMAINES.filter((d) => META.get(d)?.role !== "nous").sort((a, b) => {
    const na = NOTES.get(a), nb2 = NOTES.get(b);
    const va = na?.affichable ? na.ND : -1, vb = nb2?.affichable ? nb2.ND : -1;
    if (va !== vb) return vb - va;
    const ra = der(a, "domaines_referents")?.valeur ?? -1;
    const rb = der(b, "domaines_referents")?.valeur ?? -1;
    return rb - ra;
  });
  return [...notre, ...autres];
}

function comparateur() {
  const cols = ordreDomaines();
  // ⛔ LE REPLI EST UN DOMAINE DE LA CONFIGURATION, JAMAIS UN DOMAINE ECRIT EN DUR. Un nom
  //    de site laisse la comme valeur par defaut fait afficher a chaque installation la
  //    fiche d'un site qui n'appartient a personne d'autre qu'a son auteur d'origine.
  //    Sans role « nous » declare, on prend le premier domaine suivi ; s'il n'y en a
  //    aucun, la carte le dit au lieu de fabriquer un lien vers une page inexistante.
  const nousLa = cols.find((d) => META.get(d)?.role === "nous") || cols[0] || null;
  const nNous = nousLa ? NOTES.get(nousLa) : null;
  const uNous = unionReferents(nousLa);

  const devant = cols.filter((d) => META.get(d)?.role !== "nous" &&
    unionReferents(d).total > uNous.total).length;
  const spammy = lignesBacklinks().filter((r) => r.spam === "SPAM" || r.spam === "DOUTEUX").length;
  const qualifies = lignesBacklinks().filter((r) => r.suivi).length;
  const dofollow = lignesBacklinks().filter((r) => r.suivi === "DOFOLLOW").length;

  // ---------------------------------------------------------------- cartes de tete
  //
  // ⛔ SUR UN JOURNAL VIDE, CES QUATRE CARTES NE SORTENT PAS DU TOUT. Elles rendraient
  //    « 0 site pointe vers vous », « 0 concurrent devant vous » et « 0 dofollow », c'est
  //    a dire trois affirmations fausses sur le site de quelqu'un qui vient d'installer
  //    l'outil et n'a encore rien collecte. Le bandeau du premier ecran prend leur place
  //    et dit quoi lancer : une case absente qui explique vaut mieux qu'un zero qui ment.
  const cartes = VIDE ? "" : `<div class="grille">
  <div class="carte vedette">
    <span class="chiffre">${nNous && nNous.affichable ? nNous.ND : "—"}<span class="doux" style="font-size:.45em;font-weight:500"> / 100</span></span>
    <div class="quoi">Note maison de ${esc(nousLa ? (META.get(nousLa)?.libelle || nousLa) : "votre domaine")}</div>
    <div class="note"><a href="note.html">Comment elle se calcule</a>${nousLa ? ` · <a href="${fichierDomaine(nousLa)}">le detail chiffre</a>` : ""}</div>
  </div>
  <div class="carte">
    <span class="chiffre">${uNous.source ? nb(uNous.total) : "—"}</span>
    <div class="quoi">${uNous.source
      ? `sites qui pointent vers nous, vus par ${esc(nomSource(uNous.source))}`
      : "sites qui pointent vers nous : aucune source n'a encore repondu"}</div>
    <div class="note">${uNous.source
      ? `${uNous.comptes.map((c) => `${esc(nomSource(c.nom))} ${nb(c.valeur)}`).join(" · ")} —
      les index divergent, aucun ne voit tout. On sait en <strong>nommer ${nb(uNous.nommes)}</strong>, les autres sont un compte sans liste.`
      : "ce n'est pas zero backlink, c'est zero mesure. Lancez <code>collecte-bing-backlinks.mjs</code>."}</div>
  </div>
  <div class="carte">
    <span class="chiffre">${uNous.source ? nb(devant) : "—"}</span>
    <div class="quoi">concurrents devant nous sur ce critere</div>
    <div class="note">${uNous.source
      ? `sur ${nb(cols.filter((d) => META.get(d)?.role === "concurrent").length)} concurrents suivis`
      : `sur ${nb(cols.filter((d) => META.get(d)?.role === "concurrent").length)} concurrents suivis, aucun encore mesure sur ce critere`}</div>
  </div>
  <div class="carte">
    <span class="chiffre">${qualifies ? nb(dofollow) : "—"}</span>
    <div class="quoi">dofollow verifies dans le HTML servi</div>
    <div class="note">${qualifies
      ? `sur ${nb(qualifies)} lien(s) reellement ouverts · ${nb(spammy)} spam ou douteux ecarte(s)`
      : "aucune page portante n'a encore ete ouverte : un lien non lu n'est ni dofollow ni nofollow, il est non lu."}</div>
  </div>
</div>`;

  // ---------------------------------------------------------------- le graphique
  const donneesBarres = cols.map((d) => {
    const u = unionReferents(d);
    const bing = der(d, "domaines_referents", "bing_webmaster");
    return {
      nom: META.get(d)?.libelle || d,
      valeur: u.total || null,
      plancher: u.plafond,
      moi: META.get(d)?.role === "nous",
      aide: u.comptes.map((x) => `${nomSource(x.nom)} ${x.valeur}`).join(", ") + (auPlafond(bing) ? " — Bing plafonne a 500" : ""),
    };
  }).sort((a, b) => (b.valeur || 0) - (a.valeur || 0));

  const donneesNotes = cols.map((d) => {
    const n = NOTES.get(d);
    return {
      nom: META.get(d)?.libelle || d,
      valeur: n && n.affichable ? n.ND : null,
      moi: META.get(d)?.role === "nous",
      aide: n && !n.affichable ? `socle ${Math.round((n.socle || 0) * 100)} %, pas assez mesure pour se classer` : null,
    };
  }).sort((a, b) => (b.valeur ?? -1) - (a.valeur ?? -1));

  const legende = `<div class="legende">
    <span class="item"><span class="pastille nous"></span>${esc(nousLa ? (META.get(nousLa)?.libelle || nousLa) : "nos domaines")}</span>
    <span class="item"><span class="pastille eux"></span>concurrents</span>
  </div>`;

  // ---------------------------------------------------------------- le tableau
  const classementLignes = cols.map((d) => {
    const m = META.get(d) || {};
    const n = NOTES.get(d);
    const u = unionReferents(d);
    const tr = der(d, "tranco_rang");
    const nouv = nouveautes(d);
    const hors = !(n && n.affichable);
    return `<tr data-hors-classement="${hors ? 1 : 0}">
  <td class="fixe ${m.role === "nous" ? "col-nous" : ""}">
    <a href="${fichierDomaine(d)}"><strong>${esc(m.libelle || d)}</strong></a>
    <br><span class="doux petit">${esc(d)}</span></td>
  <td>${m.role === "nous" ? '<span class="puce df">nous</span>' : m.role === "concurrent" ? "concurrent" : esc(m.role || "")}</td>
  <td class="n" data-v="${n && n.affichable ? n.ND : ""}">${celluleND(n)}</td>
  <td class="n" data-v="${u.total}">${u.plafond ? "≥&nbsp;" : ""}${nb(u.total)}<br><span class="doux petit">${u.source ? esc(nomSource(u.source)) : "aucune source"}${u.nommes ? ` · ${nb(u.nommes)} nomme(s)` : ""}</span></td>
  <td class="n" data-v="${tr && tr.etat === "MESURE" ? tr.valeur : ""}">${cellule(tr)}</td>
  <td class="n" data-v="${nouv.etat === "compare" ? nouv.apparus.length : ""}">${nouv.etat === "compare" ? `<span class="puce neuf">+${nouv.apparus.length}</span>` : `<span class="doux petit">1er releve</span>`}</td>
  <td class="n" data-v="${nouv.etat === "compare" ? nouv.disparus.length : ""}">${nouv.etat === "compare" ? `<span class="puce perdu">−${nouv.disparus.length}</span>` : `<span class="doux petit">—</span>`}</td>
</tr>`;
  }).join("\n");

  return page("Comparateur", `
${cartes}
${bandeauNouveautes(DOMAINES, { compact: true })}

<h2>Qui recoit le plus de liens</h2>
<p class="sous-titre">Sites qui pointent vers chaque domaine, d apres la source qui en voit le plus. Survole une barre pour voir ce que dit chaque source.</p>
${legende}
${barres(donneesBarres)}
<div class="avert"><strong>Quatre index, quatre chiffres, et aucun n'est le total.</strong>
Mesure du 21/08/2026, sur un seul et meme site reel, le meme jour : <strong>Ahrefs 250</strong> sites referents,
Search Console 11, Bing 8. Un facteur trente entre le plus large et le plus etroit.
Ahrefs a le deuxieme robot le plus actif du web, c'est donc le plus complet des quatre,
ce qui ne veut pas dire complet.
On affiche le <strong>plus grand compte connu</strong> et on nomme le sous-ensemble qu'on sait nommer :
« combien » et « lesquels » sont deux questions differentes.
Et Bing s'arrete a 500 sites par domaine : au-dela, sa valeur est un plafond, pas un compte.</div>

<h2>La note maison</h2>
<p class="sous-titre">Zero a cent. Ce n'est pas un Domain Authority : le trafic passe devant le nombre de liens.
<a href="note.html">Voir comment elle se calcule</a>${nousLa ? `, et <a href="${fichierDomaine(nousLa)}">le detail chiffre de la notre</a>` : ""}.</p>
${legende}
${barres(donneesNotes)}
<p class="doux petit">Un domaine sans barre n'a pas une note de zero : il n'est pas assez mesure pour en porter une.
Sa page dit exactement ce qui manque.</p>

<h2>Le tableau</h2>
<p class="sous-titre">Clique un en-tete pour trier. Clique un domaine pour ouvrir sa fiche et le detail de sa note.</p>
<div class="tableau"><table data-triable><thead><tr>
  <th class="fixe-th">Domaine</th><th>Role</th><th>Note</th>
  <th>Domaines referents<br><span class="doux petit">union des sources</span></th>
  <th>Rang Tranco</th><th>Apparus</th><th>Disparus</th>
</tr></thead><tbody>
${classementLignes}
</tbody></table></div>
`, "index.html", {
    // ⛔ LE CHAPEAU NOMME VOTRE DOMAINE, PRIS DANS LA CONFIGURATION. Une marque ecrite en
    //    dur ici presenterait a chaque installation le site de quelqu'un d'autre comme le
    //    sien, sur la toute premiere ligne de la toute premiere page.
    chapeau: `${esc(nousLa ? (META.get(nousLa)?.libelle || nousLa) : "Vos domaines")} et ${nb(cols.filter((d) => META.get(d)?.role === "concurrent").length)} concurrents, mesures a la meme heure, avec les memes regles.
      Chaque chiffre porte sa source et sa date ; ce qui n'a pas pu etre mesure s'affiche <strong>▲</strong> et jamais zero.`,
  });
}

/** Le nom d'une source, en francais lisible. */
function nomSource(n) {
  return ({
    bing_webmaster: "Bing",
    search_console: "Search Console",
    lecture_html: "lecture HTML",
    semrush_public: "Semrush",
    ahrefs_gratuit: "Ahrefs",
    openpagerank: "OpenPageRank",
    majestic_million: "Majestic",
    tranco_liste: "Tranco",
    vigie_note_emetteur: "note maison",
    echantillon_sitemap: "echantillon de sitemap",
    tranco: "Tranco", tranco_liste: "Tranco",
    openpagerank: "OpenPageRank", majestic_million: "Majestic",
    google_uule: "Google", bing_serp: "Bing", brave_serp: "Brave",
    echantillon_sitemap: "echantillon", sitemap: "sitemap", http: "sonde HTTP",
  })[n] || n;
}

// =====================================================================================
// PAGE 2 : LES BACKLINKS, AVEC LEURS FILTRES
// =====================================================================================

// ⛔ PLAFOND DU TABLEAU, ET IL S'AFFICHE. Depuis que le graphe Common Crawl est branche,
//    le journal porte 40 000 couples : la page pesait 44,9 Mo, c'est-a-dire illisible dans
//    un navigateur. On plafonne donc PAR CIBLE, on garde TOUJOURS la totalite de nos
//    propres domaines, et on ECRIT combien de lignes sont masquees et pourquoi.
//    Un plafond silencieux se lit comme une couverture complete : c'est exactement le
//    piege qu'on reproche a Bing avec ses 500.
const PLAFOND_PAR_CIBLE = 400;

/**
 * LE BLOC « CRAWLER CE DOMAINE » : le bouton qui lance le robot.
 *
 * ⛔ LE SITE EST STATIQUE, IL NE PEUT RIEN LANCER TOUT SEUL. Le bouton appelle un petit
 *    serveur qui tourne sur votre propre machine (outils/serveur-vigie.mjs). Si ce serveur
 *    n'est pas demarre, le bouton ne fait pas semblant : il dit exactement quelle commande
 *    lancer. Un bouton qui echoue en silence est pire qu'un bouton absent.
 *
 * ⛔ UN NAVIGATEUR EN HTTPS PEUT APPELER http://127.0.0.1, et seulement cette adresse-la :
 *    les navigateurs la traitent comme une origine de confiance. Le meme montage avec
 *    l'adresse du reseau local serait bloque comme contenu mixte.
 */
function blocRobot(domaine) {
  return `
<div class="encart" id="robot">
  <h2 style="margin-top:0">Chercher de nouveaux backlinks</h2>
  <p class="sous-titre" style="margin-bottom:14px">Le robot part des ${nb(voisinsConcurrents())} domaines qui citent nos concurrents,
  des pages qui nomment la marque dans un moteur, et des referents deja connus. Il lit chaque page pour de vrai,
  respecte le robots.txt de chaque site, et s'arrete au bout de 700 pages ou 25 minutes.</p>
  <div class="filtres" style="margin:0">
    <select id="robot-domaine">
      ${DOMAINES.map((d) => `<option value="${esc(d)}"${d === domaine ? " selected" : ""}>${esc(META.get(d)?.libelle || d)} — ${esc(d)}</option>`).join("")}
    </select>
    <button class="bascule" id="robot-go" style="font-weight:600">Lancer le crawl</button>
    <span class="compteur" id="robot-etat">serveur local non contacte</span>
  </div>
  <pre id="robot-journal" style="display:none;margin:14px 0 0;padding:12px;background:var(--carte2);
    border:1px solid var(--bord);border-radius:9px;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;
    max-height:280px;overflow:auto;white-space:pre-wrap"></pre>
</div>`;
}

/** Combien de domaines citent au moins un concurrent : la taille du vivier du robot. */
function voisinsConcurrents() {
  const concurrents = new Set(DOMAINES.filter((d) => META.get(d)?.role === "concurrent"));
  const v = new Set();
  for (const o of photo) {
    if (o.metrique !== "liens_depuis_domaine" || !o.objet?.domaine) continue;
    if (concurrents.has(o.sujet?.domaine)) v.add(o.objet.domaine);
  }
  return v.size;
}

// ⛔ LE PORT EST INJECTE A LA GENERATION, PAS ECRIT DANS LE SCRIPT. Le serveur local se
//    deplace par VIGIE_PORT ; un port fige dans le HTML ferait echouer le bouton chez
//    quiconque a choisi le sien, sans que la page sache dire que c'est le port le
//    probleme. 127.0.0.1 en revanche ne bouge pas, et c'est voulu : c'est la seule
//    adresse qu'un navigateur en HTTPS accepte d'appeler en clair.
// La commande affichee porte le port SEULEMENT s'il a ete change : recopier un
// « --port=9788 » qui ne sert a rien apprend au lecteur un reglage dont il n'a pas besoin.
const CMD_SERVEUR = `node outils/serveur-vigie.mjs${PORT_SERVEUR === 9788 ? "" : ` --port=${PORT_SERVEUR}`}`;

const SCRIPT_ROBOT = `
(function(){
  var BASE = 'http://127.0.0.1:${PORT_SERVEUR}';
  var go = document.getElementById('robot-go');
  if (!go) return;
  var etat = document.getElementById('robot-etat');
  var journal = document.getElementById('robot-journal');
  var sel = document.getElementById('robot-domaine');
  var minuteur = null;

  function dire(t, classe){ etat.textContent = t; etat.className = 'compteur' + (classe ? ' ' + classe : ''); }

  function absent(e){
    // ⛔ On ne dit pas « erreur », on dit QUOI FAIRE. Le serveur n'est pas un bug, il est
    //    juste eteint, et personne ne peut le deviner depuis cette page.
    dire('serveur local eteint — lancez : ${CMD_SERVEUR}');
    journal.style.display = 'block';
    journal.textContent = 'Le bouton appelle un serveur qui tourne sur votre machine.\\n' +
      'Ouvrez un terminal dans le dossier du projet et lancez :\\n\\n' +
      '    ${CMD_SERVEUR}\\n\\n' +
      'Laissez la fenetre ouverte, puis recliquez.';
  }

  function suivre(){
    fetch(BASE + '/vigie/etat').then(function(r){ return r.json(); }).then(function(e){
      var c = e.dernierCrawl || {};
      if (e.occupe) {
        dire('crawl en cours sur ' + e.enCours.domaine + ' — ' + (c.pages_lues || 0) + ' pages, ' +
             (c.liens_trouves || 0) + ' lien(s) trouve(s)');
      } else {
        dire('crawl termine — ' + (c.pages_lues || 0) + ' pages lues, ' + (c.liens_trouves || 0) +
             ' lien(s) trouve(s). Relance la collecte pour voir le resultat dans le tableau.');
        clearInterval(minuteur); minuteur = null;
        go.disabled = false;
      }
      return fetch(BASE + '/vigie/journal');
    }).then(function(r){ return r ? r.json() : null; }).then(function(j){
      if (!j) return;
      journal.style.display = 'block';
      journal.textContent = (j.lignes || []).join('\\n');
      journal.scrollTop = journal.scrollHeight;
    }).catch(absent);
  }

  go.addEventListener('click', function(){
    go.disabled = true;
    dire('demande envoyee…');
    fetch(BASE + '/vigie/crawler', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domaine: sel.value })
    }).then(function(r){ return r.json().then(function(j){ return { code: r.status, j: j }; }); })
      .then(function(x){
        if (x.code >= 400) { dire(x.j.erreur || 'refus'); go.disabled = false; return; }
        dire('crawl lance sur ' + x.j.domaine);
        journal.style.display = 'block';
        if (minuteur) clearInterval(minuteur);
        minuteur = setInterval(suivre, 4000);
        suivre();
      }).catch(function(){ absent(); go.disabled = false; });
  });

  // Au chargement : on regarde si le serveur repond, sans rien lancer.
  fetch(BASE + '/vigie/etat').then(function(r){ return r.json(); }).then(function(e){
    var c = e.dernierCrawl || {};
    if (e.occupe) { dire('un crawl tourne deja sur ' + e.enCours.domaine); go.disabled = true; minuteur = setInterval(suivre, 4000); suivre(); }
    else if (c.cible) dire('serveur pret — dernier crawl : ' + c.cible + ', ' + (c.pages_lues || 0) + ' pages, ' + (c.liens_trouves || 0) + ' lien(s)');
    else dire('serveur pret');
  }).catch(function(){ dire('serveur local eteint — lancez : ${CMD_SERVEUR}'); });
})();
`;

/**
 * LE DETAIL D'UN BACKLINK, replie sous sa ligne.
 *
 * ⛔ ARBITRAGE DU 21/08/2026 : un tableau qui dit « 8 liens » sans dire LESQUELS ne sert a
 *    rien. On ne peut ni verifier le chiffre, ni relancer le site qui porte le lien, ni
 *    comprendre pourquoi la note est ce qu'elle est. Le detail se replie sous la ligne,
 *    au clic, comme le font les outils payants du marche.
 *
 * Ce qu'on affiche, pour chaque lien reellement lu : la page qui le porte, l'ancre,
 * l'URL de destination exacte, le rel tel qu'il est servi, l'indexabilite de la page,
 * les signaux de spam avec leur preuve, et par quel moyen on l'a lu.
 * Quand rien n'a ete lu, on affiche ce que chaque source dit du couple, et pourquoi la
 * lecture a echoue : c'est encore de l'information.
 */
function detailLignes(r) {
  const liens = QUALIFIES.get(`${r.referent}|${r.cible}`) || [];
  const id = ancre(r.referent, r.cible);

  const entetes = `<tr class="detail" id="d-${esc(id)}" hidden><td colspan="12" class="libre">`;

  if (!liens.length) {
    const parSource = (r.sources || []).map((s) =>
      `<li><strong>${esc(nomSource(s.nom))}</strong> compte ${nb(s.valeur)} lien(s) depuis ce domaine, releve du ${esc(String(s.date).slice(0, 10))}${s.nature === "plancher" ? " (plancher, la source plafonne)" : ""}</li>`).join("");
    return `${entetes}
<div class="detail-bloc">
  <p><strong>Aucun lien n'a encore ete ouvert et lu sur ce domaine.</strong>
  ${r.raisonNonLu ? `Raison : <em>${esc(r.raisonNonLu.court)}</em> — ${esc(r.raisonNonLu.aide.slice(0, 300))}` : "Le collecteur n'y est pas encore passe."}</p>
  <p class="doux petit">Ce que les index disent quand meme :</p>
  <ul class="petit">${parSource || "<li>aucune source</li>"}</ul>
  <p class="doux petit">Pour l'ouvrir : <code>node outils/collecte-rel.mjs --cible=${esc(r.cible)} --referents=${esc(r.referent)}</code>,
  ou <code>node outils/collecte-murs.mjs</code> si c'est un mur, ou le bouton « Lancer le crawl » en haut de page.</p>
</div></td></tr>`;
  }

  const lignes = liens.map((o) => {
    const d = o.objet?.detail || {};
    const sp = d.spam || {};
    const ix = d.indexabilite || {};
    return `<div class="detail-lien">
  <div class="detail-tete">
    <span class="puce ${d.suivi === "DOFOLLOW" ? "df" : "nf"}">${esc(d.suivi || "?")}</span>
    <code>rel=${esc(JSON.stringify(d.rel_brut ?? null))}</code>
    ${ix.noindex ? '<span class="puce spam" title="la page porte un noindex : le lien ne transmet rien, quel que soit son rel">page en noindex</span>' : ""}
    ${sp.verdict ? `<span class="puce ${sp.verdict === "SPAM" ? "spam" : sp.verdict === "DOUTEUX" ? "douteux" : "propre"}">${esc(sp.verdict)}${sp.score != null ? ` ${sp.score}` : ""}</span>` : ""}
    <span class="doux petit">lu ${esc(String(o.date_mesure).slice(0, 10))} par ${esc(nomSource(o.source?.nom))}${d.lu_par ? ` (${esc(d.lu_par)})` : ""}${d.trouve_par ? ` · trouve par ${esc(d.trouve_par)}` : ""}</span>
  </div>
  <table class="detail-table"><tbody>
    <tr><td class="k">Page qui porte le lien</td><td>${d.url_source
      ? `<a href="${esc(d.url_source)}" target="_blank" rel="noreferrer noopener">${esc(d.url_source)}</a>` : '<span class="vide">—</span>'}</td></tr>
    <tr><td class="k">Pointe vers</td><td>${d.url_destination
      ? `<a href="${esc(d.url_destination)}" target="_blank" rel="noreferrer noopener">${esc(d.url_destination)}</a>` : '<span class="vide">—</span>'}</td></tr>
    <tr><td class="k">Ancre</td><td>${d.ancre ? esc(d.ancre) : '<span class="doux">aucune ancre textuelle : une carte ou une image cliquable, ce qui reste un lien valable</span>'}</td></tr>
    <tr><td class="k">Indexabilite de la page</td><td>${ix.noindex
      ? '<strong>noindex</strong> — Google ne l indexera pas, donc ce lien ne transmet rien'
      : `indexable${ix.meta_robots ? ` (meta robots : ${esc(ix.meta_robots)})` : " (aucune meta robots)"}`}</td></tr>
    ${sp.signaux?.length ? `<tr><td class="k">Signaux de spam</td><td>${sp.signaux.map((x) =>
      `<div>· <strong>${esc(x.code)}</strong> (+${x.poids}) — ${esc(String(x.preuve).slice(0, 200))}</div>`).join("")}</td></tr>` : ""}
    ${o.preuve ? `<tr><td class="k">Preuve</td><td class="doux">${esc(o.preuve)}</td></tr>` : ""}
  </tbody></table>
</div>`;
  }).join("");

  return `${entetes}<div class="detail-bloc">
  <p class="doux petit">${nb(liens.length)} lien(s) reellement ouvert(s) et lu(s) sur ce domaine.</p>
  ${lignes}
</div></td></tr>`;
}

const SCRIPT_DETAIL = `
document.querySelectorAll('#t tbody tr[id]').forEach(function(tr){
  var cible = document.getElementById('d-' + tr.id);
  if (!cible) return;
  tr.style.cursor = 'pointer';
  tr.addEventListener('click', function(e){
    // Un clic sur un vrai lien ouvre le lien, il ne replie pas la ligne.
    if (e.target.closest('a')) return;
    cible.hidden = !cible.hidden;
    tr.classList.toggle('ouverte', !cible.hidden);
  });
});
`;

function pageBacklinks() {
  const toutes = lignesBacklinks().sort((a, b) => {
    if (a.statut !== b.statut) return a.statut === "disparu" ? -1 : 1;
    if (a.nouveau !== b.nouveau) return a.nouveau ? -1 : 1;
    return (b.liensBing || 0) - (a.liensBing || 0);
  });

  const gardees = [];
  const masquees = new Map();
  const compte = new Map();
  for (const r of toutes) {
    const nous = META.get(r.cible)?.role === "nous";
    const n = (compte.get(r.cible) || 0) + 1;
    compte.set(r.cible, n);
    // Nos domaines ne se plafonnent jamais : c'est la page qu'on ouvre tous les jours.
    // Et un lien DISPARU ou NOUVEAU passe toujours, quel que soit son rang.
    if (nous || n <= PLAFOND_PAR_CIBLE || r.statut === "disparu" || r.nouveau) gardees.push(r);
    else masquees.set(r.cible, (masquees.get(r.cible) || 0) + 1);
  }
  const rangees = gardees;
  const totalMasquees = [...masquees.values()].reduce((a, b) => a + b, 0);

  const cibles = [...new Set(rangees.map((r) => r.cible))].sort();
  const nbQualifies = rangees.filter((r) => r.suivi).length;
  const nbSpam = rangees.filter((r) => r.spam === "SPAM").length;
  const nbDouteux = rangees.filter((r) => r.spam === "DOUTEUX").length;
  const nbNeufs = rangees.filter((r) => r.nouveau).length;
  const nbPerdus = rangees.filter((r) => r.statut === "disparu").length;

  const corps = rangees.map((r) => {
    const nlTitre = r.nl ? detailNote(r.nl) : "";
    const autTitre = r.aut ? `${r.aut.preuve || ""} — ${r.aut.source?.nom}, lu le ${jour(r.aut.date_mesure)}` : "";
    return `<tr id="${esc(ancre(r.referent, r.cible))}" class="${r.statut === "disparu" ? "li-disparu" : ""}"
  data-cible="${esc(r.cible)}" data-suivi="${esc(r.suivi || "__nq")}" data-spam="${esc(r.spam || "__nq")}"
  data-statut="${esc(r.statut)}" data-neuf="${r.nouveau ? "1" : "0"}">
  <td>${r.urlSource
      ? `<a href="${esc(r.urlSource)}" rel="noreferrer noopener" target="_blank">${esc(r.referent)}</a>`
      : esc(r.referent)}${r.statut === "disparu" ? '<span class="puce perdu" title="present a la passe precedente, absent a la derniere">disparu</span>' : ""}${r.nouveau ? '<span class="puce neuf" title="absent a la passe precedente">nouveau</span>' : ""}</td>
  <td>${esc(r.cible)}</td>
  <td data-v="${(r.sources || []).length}">${(r.sources || []).length
      ? (r.sources || []).map((x) => `<span class="puce" title="${esc(nomSource(x.nom))} : ${nb(x.valeur)} lien(s), releve du ${esc(String(x.date).slice(0, 10))}">${esc(nomSource(x.nom))}</span>`).join(" ")
      : `<span class="vide">—</span>`}</td>
  <td class="n" data-v="${r.liensBing ?? ""}">${r.statut === "disparu" ? `<span class="doux">${nb(r.liensBing)}</span>` : cellule(r.obsBing, { detail: false, bulle: "courte" })}</td>
  <td class="n" data-v="${r.liensQualifies || ""}">${r.liensQualifies || `<span class="vide" title="zero lecture, pas zero lien">—</span>`}</td>
  <td>${puceSuivi(r.suivi, r.raisonNonLu)}</td>
  <td>${puceSpam(r.spam)}</td>
  <td class="n" data-v="${r.scoreSpam ?? ""}"${r.signaux?.length ? ` title="${esc(r.signaux.map((s) => `${s.code} (+${s.poids}) ${s.preuve}`).join(" | "))}"` : ""}>${r.scoreSpam == null ? `<span class="vide">—</span>` : r.scoreSpam}</td>
  <td class="n" data-v="${r.aut && r.aut.etat === "MESURE" ? r.aut.valeur : ""}">${cellule(r.aut, { detail: false })}${r.aut && r.aut.nature === "estimation" ? "" : ""}</td>
  <td class="n" data-v="${r.nl && r.nl.affichable ? r.nl.NL : ""}"${nlTitre ? ` title="${esc(nlTitre)}"` : ""}>${
      !r.nl ? `<span class="vide" title="la note d un lien exige son rel reel">—</span>`
      : r.nl.affichable ? `${r.nl.NL} <span class="doux petit">${esc(r.nl.classe)}</span>`
      : `<span class="fourchette">[${r.nl.plage[0]} ; ${r.nl.plage[1]}]</span><em class="est">socle ${Math.round(r.nl.socle * 100)} % · non note</em>`}</td>
  <td class="libre">${r.ancre ? esc(String(r.ancre).slice(0, 90)) : `<span class="vide">—</span>`}</td>
</tr>
${detailLignes(r)}`;
  }).join("\n");

  const script = `
(function(){
  var q=document.getElementById('q'), fc=document.getElementById('cible'),
      fs=document.getElementById('suivi'), fp=document.getElementById('spam'),
      bn=document.getElementById('neufs'), bd=document.getElementById('perdus'),
      cpt=document.getElementById('compteur'),
      rangs=Array.prototype.slice.call(document.querySelectorAll('#t tbody tr'));
  function passe(r){
    if(q.value && (r.innerText||'').toLowerCase().indexOf(q.value.toLowerCase())<0) return false;
    if(fc.value && r.dataset.cible!==fc.value) return false;
    if(fs.value && r.dataset.suivi!==fs.value) return false;
    if(fp.value==='__sain'){ if(r.dataset.spam==='SPAM'||r.dataset.spam==='DOUTEUX') return false; }
    else if(fp.value==='__suspect'){ if(r.dataset.spam!=='SPAM'&&r.dataset.spam!=='DOUTEUX') return false; }
    else if(fp.value && r.dataset.spam!==fp.value) return false;
    if(bn.checked && r.dataset.neuf!=='1') return false;
    if(bd.checked && r.dataset.statut!=='disparu') return false;
    return true;
  }
  function appliquer(){
    var n=0;
    rangs.forEach(function(r){ var ok=passe(r); r.style.display=ok?'':'none'; if(ok)n++; });
    cpt.textContent=n+' ligne'+(n>1?'s':'')+' affichee'+(n>1?'s':'')+' sur '+rangs.length+
      (n<rangs.length ? ' — '+(rangs.length-n)+' masquee(s) par les filtres' : '');
  }
  [q,fc,fs,fp,bn,bd].forEach(function(e){ e.addEventListener('input',appliquer); e.addEventListener('change',appliquer); });
  appliquer();
  if(location.hash){ var c=document.getElementById(location.hash.slice(1)); if(c) c.scrollIntoView({block:'center'}); }
})();
`;

  // ⛔ AUCUN COUPLE CONNU N'EST UN ETAT DE LA MESURE, PAS UN ETAT DU SITE. « 0 backlink »
  //    est la conclusion la plus decourageante et la plus fausse qu'on puisse servir a
  //    quelqu'un qui n'a simplement pas encore branche de source de liens. Les quatre
  //    cartes disparaissent donc au profit de ce qu'il faut lancer.
  const aucunLien = rangees.length === 0;

  return page("Backlinks", `
${aucunLien ? `<div class="avert"><strong>Aucun couple site emetteur vers cible n'est encore au journal.</strong>
Ce n'est pas « zero backlink », c'est « aucune source de liens n'a encore repondu ».
Les deux comptes ci-dessous se remplissent avec <code>node outils/collecte-bing-backlinks.mjs</code>,
qui nomme les domaines referents de n'importe quel site, puis <code>node outils/collecte-rel.mjs</code>,
qui ouvre les pages une par une pour lire le <code>rel</code> reel.</div>` : `<div class="grille">
  <div class="carte"><div class="chiffre">${nb(rangees.length)}</div><div class="quoi">couples (site emetteur → cible) connus</div></div>
  <div class="carte"><div class="chiffre">${nbQualifies ? nb(nbQualifies) : "—"}</div><div class="quoi">qualifies par lecture du HTML : rel reel connu</div></div>
  <div class="carte"><div class="chiffre">${nbQualifies ? nb(nbSpam + nbDouteux) : "—"}</div><div class="quoi">${nbQualifies ? `spam (${nb(nbSpam)}) ou douteux (${nb(nbDouteux)})` : "spam ou douteux : aucune page lue, donc aucun verdict"}</div></div>
  <div class="carte"><div class="chiffre">+${nb(nbNeufs)} / −${nb(nbPerdus)}</div><div class="quoi">apparus / disparus depuis la passe precedente</div></div>
</div>`}

<div class="avert">
  <strong>Deux comptes qui ne mesurent pas la meme chose, jamais additionnes.</strong>
  « Liens (Bing) » compte au niveau du <em>domaine</em> : Bing ne rend ni l'URL de la page source, ni l'attribut
  <code>rel</code>, ni la date de decouverte. « Liens qualifies » compte les pages qu'on a reellement ouvertes et lues :
  c'est de la que viennent le dofollow, le verdict de spam et la note du lien.
  ${aucunLien
    ? "Aucun des deux n'a encore de ligne : les liens qu'on n'a pas cherches ne sont pas de mauvais liens."
    : `${nbQualifies} ligne(s) sur ${rangees.length} sont qualifiees a ce jour ; les autres ne sont pas de mauvais liens,
  ce sont des liens <strong>qu'on n'a pas encore lus</strong>.`} Un HTTP 403 est un mur, pas une absence.
</div>

${blocRobot(DOMAINES.find((d) => META.get(d)?.role === "nous") || DOMAINES[0])}

${totalMasquees ? `<div class="avert"><strong>${nb(totalMasquees)} ligne(s) ne sont pas dans ce tableau, et voici lesquelles.</strong>
Depuis que le graphe de liens de Common Crawl est branche, le journal porte ${nb(toutes.length)} couples site emetteur vers cible.
Les afficher tous ferait une page de 45 Mo, illisible. Le tableau garde donc les ${nb(PLAFOND_PAR_CIBLE)} premiers par cible,
plus la totalite de nos propres domaines, plus tout ce qui est apparu ou disparu.
Masques : ${[...masquees.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${esc(c)} ${nb(n)}`).join(" · ")}.
Le journal, lui, les porte tous : <code>node outils/_lib-obs.mjs</code>.</div>` : ""}

<div class="filtres">
  <input type="search" id="q" placeholder="filtrer un domaine ou une ancre…">
  <select id="cible"><option value="">toutes les cibles</option>
    ${/* ⛔ LA PAGE S'OUVRE SUR NOS LIENS, PAS SUR CEUX DU PLUS GROS CONCURRENT SUIVI. Le
          tri par defaut etant le nombre de liens, mesure du 21/08/2026 : les 3 000 lignes
          d'un seul concurrent occupaient tout le premier ecran, et il fallait filtrer a la
          main pour voir les huit lignes qui nous concernaient. Un outil qui demande une
          manipulation pour montrer l'essentiel n'est pas lu. */""}
    ${cibles.map((c) => `<option value="${esc(c)}"${c === (DOMAINES.find((d) => META.get(d)?.role === "nous")) ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
  <select id="suivi"><option value="">dofollow et nofollow</option>
    <option value="DOFOLLOW">dofollow seulement</option>
    <option value="NOFOLLOW">nofollow seulement</option>
    <option value="__nq">non qualifies</option></select>
  <select id="spam"><option value="">tous les liens</option>
    <option value="__sain">masquer spam et douteux</option>
    <option value="__suspect">spam et douteux seulement</option>
    <option value="SPAM">spam seulement</option>
    <option value="DOUTEUX">douteux seulement</option>
    <option value="PROPRE">propres seulement</option>
    <option value="NON LU">non lus (mur, pas propre)</option></select>
  <label class="bascule"><input type="checkbox" id="neufs"> nouveaux seulement</label>
  <label class="bascule chaud"><input type="checkbox" id="perdus"> disparus seulement</label>
  <span class="compteur" id="compteur"></span>
</div>

<div class="tableau haut"><table id="t" data-triable><thead><tr>
  <th>Site emetteur</th><th>Pointe vers</th>
  <th>Vu par<br><span class="doux petit">index qui connaissent ce lien</span></th>
  <th>Liens<br><span class="doux petit">granularite domaine</span></th>
  <th>Liens qualifies<br><span class="doux petit">lecture HTML</span></th>
  <th>Dofollow</th><th>Verdict spam</th><th>Score spam<br><span class="doux petit">0 a 100</span></th>
  <th>Note emetteur<br><span class="doux petit">note maison, 0 a 100</span></th>
  <th>Note du lien<br><span class="doux petit">NL, seuil utile ${SEUIL_UTILE}</span></th>
  <th class="libre-th">Ancre</th>
</tr></thead><tbody>
${corps || `<tr><td colspan="10" class="doux">Aucun backlink au journal. Lance <code>collecte-bing-backlinks.mjs</code>, puis <code>collecte-rel.mjs</code> pour la qualification.</td></tr>`}
</tbody></table></div>

<p class="doux petit">La colonne « Note du site emetteur » est <strong>notre</strong> note, calculee sur le site qui emet le lien et
pas sur la cible. Elle combine cinq composantes, visibles en survolant la valeur : la popularite reelle du domaine (rang Tranco, 35 %),
son autorite de liens OpenPageRank (25 %, <strong>plafonnee</strong> des qu'elle depasse de plus de 25 points la popularite reelle,
parce qu'une forte autorite de liens sur un domaine que personne ne visite est le portrait d'une ferme a liens), la largeur de son
reseau referent en sous-reseaux distincts (15 %), sa proprete mesuree sur la page quand on a pu la lire (15 %), et la coherence de son
nom avec notre sujet (10 %). Une cellule vide veut dire que ce domaine n'a pas encore ete cherche, jamais qu'il vaut zero.
« NON NOTE » sur la note d'un lien veut dire que son socle de mesure est sous ${Math.round(SOCLE_AFFICHABLE * 100)} % :
il ne compte ni comme utile, ni comme toxique, il compte comme un lien qu'il reste a qualifier.</p>
`, "backlinks.html", { scripts: script + SCRIPT_ROBOT + SCRIPT_DETAIL });
}

// =====================================================================================
// PAGE 3 : UNE PAGE PAR DOMAINE
// =====================================================================================

function evolution(d, metrique, libelle) {
  const s = serie(obs, { "sujet.domaine": d, metrique });
  if (s.length < 2) return null;
  const points = s.map((o) => ({ x: o.date_mesure, y: o.etat === "MESURE" ? o.valeur : null }));
  const lignes = s.map((o, i) => {
    const prec = i ? s[i - 1] : null;
    const delta = prec && prec.etat === "MESURE" && o.etat === "MESURE" ? o.valeur - prec.valeur : null;
    const versionChangee = prec && prec.collecteur !== o.collecteur;
    return `<tr><td>${esc(o.date_mesure.slice(0, 16).replace("T", " "))}</td>
      <td class="n">${cellule(o, { detail: false })}</td>
      <td class="n">${delta == null ? `<span class="doux">—</span>` : (delta > 0 ? "+" : "") + nb(delta)}</td>
      <td class="libre">${esc(o.collecteur)}${versionChangee ? ` <span class="puce douteux" title="la version qui produit ce chiffre a change : l'ecart peut venir de la formule et non du marche">version changee</span>` : ""}</td></tr>`;
  }).join("");
  return `<h3>${esc(libelle)} ${sparkline(points)}</h3>
<div class="tableau"><table><thead><tr><th>Releve</th><th>Valeur</th><th>Ecart</th><th class="libre-th">Produit par</th></tr></thead>
<tbody>${lignes}</tbody></table></div>`;
}

function pageDomaine(d) {
  const meta = META.get(d) || { libelle: d, role: "?" };
  const n = NOTES.get(d);

  const mesures = [...new Set(photo.filter((o) => o.sujet?.domaine === d)
    .map((o) => o.metrique))]
    .filter((m) => !["liens_depuis_domaine", "ancre", "lien_qualifie", "clics_estimes"].includes(m))
    .sort();

  const refs = photo.filter((o) => o.sujet?.domaine === d && o.metrique === "liens_depuis_domaine")
    .sort((a, b) => (b.valeur || 0) - (a.valeur || 0));
  const ancres = toutes(d, "ancre").sort((a, b) => (b.valeur || 0) - (a.valeur || 0)).slice(0, 40);

  // ⛔ mouvements() COMPARE « AVANT LE SEUIL » A « APRES LE SEUIL », PAS « PASSE
  //    PRECEDENTE » A « DERNIERE PASSE ». Avec une fenetre de 8 jours et une collecte
  //    quotidienne, les DEUX passes tombent du meme cote du seuil : il n'y a alors plus
  //    rien « avant », et la fonction rend TOUTE ligne comme une apparition. C'est ce qui
  //    s'est vu a l'essai : un backlink qu'on savait tombe ressortait « nouveau ».
  //    D'ou deux corrections, et pas une :
  //      1. la fenetre est ANCREE sur la passe precedente de ce domaine, pas sur un
  //         nombre de jours choisi a l'avance ;
  //      2. on ne garde que le genre « changement ». Les apparitions et les disparitions
  //         viennent de la comparaison de passes, qui les connait exactement, alors que
  //         l'apparition de mouvements() veut seulement dire « rien avant le seuil ».
  const fen = fenetrePassePrecedente(d);
  const changements = fen && fen.jours != null
    ? mouvements(obs, { depuisJours: fen.jours })
        .filter((m) => m.apres?.sujet?.domaine === d && m.genre === "changement")
        .slice(0, 80)
    : [];
  const nouv = nouveautes(d);
  const bougesLiens = nouv.etat === "compare" ? nouv.bouges.slice(0, 80) : [];

  const evolutions = [
    evolution(d, "domaines_referents", "Domaines referents"),
    evolution(d, "liens_totaux", "Liens vus par Bing"),
    evolution(d, "note_domaine", "Note maison ND"),
    evolution(d, "visites_mensuelles", "Visites/mois estimees"),
    evolution(d, "tranco_rang", "Rang Tranco"),
  ].filter(Boolean);

  const liensNotes = (n?.liens || []).slice(0, 60);

  return page(meta.libelle || d, `
<p class="doux">${esc(d)} · role ${esc(meta.role)}${meta.note ? ` · ${esc(meta.note)}` : ""}</p>
${meta.angle ? `<div class="avert"><strong>Angle mort connu, consigne dans domaines.json.</strong> ${esc(meta.angle)}</div>` : ""}

${bandeauNouveautes([d], { titre: "Ce qui a bouge sur ce domaine" })}

<h2>Note maison, et le detail de son calcul</h2>
${tableauNote(n)}

<h2>Les mesures du dernier releve</h2>
<div class="tableau"><table data-triable><thead><tr>
  <th>Mesure</th><th>Valeur</th><th>Nature</th><th>Etat</th><th>Source</th><th>HTTP</th><th>Lue le</th><th>Donnee du</th><th class="libre-th">Preuve</th>
</tr></thead><tbody>
${mesures.map((m) => toutes(d, m).map((o) => `<tr>
  <td>${esc(m.replace(/_/g, " "))}</td>
  <td class="n" data-v="${triable(o)}">${cellule(o)}</td>
  <td>${esc(o.nature)}</td><td>${esc(o.etat)}</td>
  <td>${esc(o.source?.nom || "")}</td><td class="n">${o.source?.http ?? ""}</td>
  <td>${jour(o.date_mesure)}</td>
  <td>${o.date_donnee ? `${jour(o.date_donnee)} <span class="doux petit">(${o.fraicheur_jours} j)</span>` : `<span class="doux">—</span>`}</td>
  <td class="libre">${esc(o.preuve || "")}</td></tr>`).join("")).join("") ||
  `<tr><td colspan="9" class="doux">Aucune mesure pour ce domaine. Les collecteurs ne sont pas encore passes dessus.</td></tr>`}
</tbody></table></div>

<h2>Evolution</h2>
${evolutions.length ? evolutions.join("\n")
    : `<p class="doux petit">Un seul releve pour l'instant : la courbe apparaitra au deuxieme passage.
       C'est le but de l'outil, voir bouger compte plus que connaitre.</p>`}

${bougesLiens.length ? `<h2>Des liens qui ont change de nombre <span class="doux petit">(${bougesLiens.length})</span></h2>
<p class="doux petit">Comparaison exacte entre les deux dernieres passes du collecteur, sans fenetre de temps.</p>
<div class="tableau"><table data-triable><thead><tr><th>Site emetteur</th><th>Avant</th><th>Apres</th><th>Ecart</th></tr></thead><tbody>
${bougesLiens.map((b) => `<tr><td>${esc(b.obs.objet.domaine)}</td>
  <td class="n">${nb(b.avant)}</td><td class="n">${nb(b.obs.valeur)}</td>
  <td class="n" data-v="${b.delta}">${b.delta > 0 ? "+" : ""}${nb(b.delta)}</td></tr>`).join("")}
</tbody></table></div>` : ""}

${changements.length ? `<h2>Ce qui a change depuis la passe precedente <span class="doux petit">(${changements.length})</span></h2>
<p class="doux petit">Fenetre ancree sur le releve du ${esc(jour(fen.precedente))}, pas sur un nombre de jours arbitraire.
Seuls les <em>changements de valeur</em> figurent ici : les apparitions et les disparitions sont dans le bandeau du haut, qui les connait exactement.</p>
<div class="tableau"><table data-triable><thead><tr><th>Quoi</th><th>Avant</th><th>Apres</th><th>Ecart</th><th class="libre-th">Preuve</th></tr></thead><tbody>
${changements.map((m) => `<tr>
  <td>${esc(m.apres.metrique.replace(/_/g, " "))}${m.apres.objet?.domaine ? ` <span class="doux">${esc(m.apres.objet.domaine)}</span>` : ""}${m.apres.objet?.ancre ? ` <span class="doux">« ${esc(String(m.apres.objet.ancre).slice(0, 40))} »</span>` : ""}</td>
  <td class="n">${m.avant ? cellule(m.avant, { detail: false, bulle: "courte" }) : `<span class="doux">—</span>`}</td>
  <td class="n">${cellule(m.apres, { detail: false, bulle: "courte" })}</td>
  <td class="n" data-v="${m.delta ?? ""}">${m.delta == null ? `<span class="doux">—</span>` : (m.delta > 0 ? "+" : "") + nb(m.delta)}</td>
  <td class="libre">${esc(m.apres.preuve || "")}</td></tr>`).join("")}
</tbody></table></div>` : ""}
${fen && fen.jours == null ? `<div class="avert"><strong>Comparaison dans le temps indisponible.</strong> ${esc(fen.raison)}</div>` : ""}

<h2>Sites qui pointent vers ${esc(d)} <span class="doux petit">(${refs.length} vus par Bing)</span></h2>
<p class="doux petit">Le detail complet, avec le dofollow, le spam et les filtres, est sur
<a href="backlinks.html">la page Backlinks</a>.</p>
<div class="tableau"><table data-triable><thead><tr><th>Site emetteur</th><th>Liens (Bing)</th><th>Dofollow</th><th>Spam</th><th>Autorite emetteur</th><th>Etat</th></tr></thead><tbody>
${refs.slice(0, 300).map((o) => {
    const r = ligneBacklink(o.objet.domaine, d, o, "present");
    return `<tr><td>${esc(o.objet.domaine)}</td>
    <td class="n" data-v="${triable(o)}">${cellule(o, { detail: false })}</td>
    <td>${puceSuivi(r.suivi, r.raisonNonLu)}</td><td>${puceSpam(r.spam)}</td>
    <td class="n" data-v="${r.aut && r.aut.etat === "MESURE" ? r.aut.valeur : ""}">${cellule(r.aut, { detail: false })}</td>
    <td>${r.nouveau ? '<span class="puce neuf">nouveau</span>' : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="doux">Aucun domaine referent connu pour ce domaine.</td></tr>`}
</tbody></table></div>
${refs.length > 300 ? `<p class="doux petit">300 premiers sur ${nb(refs.length)}. La liste entiere est sur la page Backlinks.</p>` : ""}

${liensNotes.length ? `<h2>Le detail de chaque lien note <span class="doux petit">(${liensNotes.length})</span></h2>
${liensNotes.map((l) => `<details><summary>${esc(l.domaine_source || "?")} — ${l.affichable ? `NL ${l.NL} · ${esc(l.classe)}` : `[${l.plage[0]} ; ${l.plage[1]}] · non note`} <span class="doux petit">socle ${Math.round(l.socle * 100)} %</span></summary>
<pre>${esc(detailNote(l))}</pre></details>`).join("\n")}` : ""}

${ancres.length ? `<h2>Ancres <span class="doux petit">(${toutes(d, "ancre").length} distinctes vues par Bing)</span></h2>
<div class="tableau"><table data-triable><thead><tr><th class="libre-th">Ancre</th><th>Liens</th></tr></thead><tbody>
${ancres.map((o) => `<tr><td class="libre">${esc(o.objet?.ancre || "(vide)")}</td><td class="n" data-v="${triable(o)}">${cellule(o, { detail: false })}</td></tr>`).join("")}
</tbody></table></div>` : ""}
`, null);
}

// =====================================================================================
// PAGE 4 : LA METHODE
// =====================================================================================

function pageMethode() {
  return page("Methode", `
<p>Cet outil remplace un abonnement Semrush a 130 € par mois sur ce qui compte ici : voir les backlinks,
le trafic et les positions de vos domaines et de vos concurrents, et surtout <strong>voir ce qui bouge</strong>.
Il ne cherche pas a etre exhaustif. Il cherche a ne jamais mentir sur ce qu'il sait.</p>

<h2>Ce que chaque source apporte, et ce qu'elle ne dit pas</h2>
<div class="tableau"><table><thead><tr><th>Source</th><th class="libre-th">Ce qu'elle donne</th><th class="libre-th">Ce qu'elle ne donne pas</th></tr></thead><tbody>
<tr><td>Bing Webmaster Tools</td>
  <td class="libre">Les domaines referents et les ancres de <em>n'importe quel</em> site, y compris ceux qu'on ne possede pas. Gratuit.</td>
  <td class="libre">Ni l'URL de la page source, ni l'attribut <code>rel</code>, ni la date de decouverte. Et il <strong>plafonne a ${PLAFONDS.bing_webmaster.domaines_referents} domaines referents par site</strong> : au-dela il annonce ${PLAFONDS.bing_webmaster.domaines_referents} comme si c'etait le total, et sa page 2 rend zero ligne. La troncature est definitive et silencieuse.</td></tr>
<tr><td>Lecture du HTML servi</td>
  <td class="libre">L'attribut <code>rel</code> reel, l'ancre exacte, l'URL de destination, l'indexabilite de la page, les signaux de spam.</td>
  <td class="libre">Il faut d'abord trouver la page qui porte le lien. Un HTTP 403 est un mur, pas une absence : la ligne sort « non lu », jamais « pas de lien ». Un badge vert d'extension ne vaut rien : le rel n'est que la troisieme des trois conditions du dofollow reel.</td></tr>
<tr><td>Tranco</td><td class="libre">Un rang de popularite agrege sur plusieurs panels.</td>
  <td class="libre">Il s'arrete au premier million. Un domaine absent n'a pas un mauvais rang, il est <em>hors panel</em> : c'est une mesure, pas un angle mort, et elle vaut 5 et non 0.</td></tr>
<tr><td>OpenPageRank</td><td class="libre">Une estimation d'autorite de 0 a 10 sur dix millions de domaines.</td>
  <td class="libre">Un domaine hors de la table a bien ete cherche et n'y est pas : c'est un signal de faiblesse mesure. Un domaine jamais cherche, lui, n'a aucune valeur, et surtout pas zero.</td></tr>
<tr><td>Page publique Semrush</td><td class="libre">Une estimation de visites, un score d'autorite, quelques mots-cles.</td>
  <td class="libre">C'est un <strong>modele</strong>, pas un releve. Le 20/08/2026 elle annoncait 70,4 K de visites sur un site qui en mesurait 2,9 K, soit un facteur 24. Sa donnee a plusieurs semaines de retard : d'ou deux dates distinctes partout, celle de la lecture et celle de la donnee.</td></tr>
<tr><td>Notre modele de trafic</td><td class="libre">${esc(TITRE_CLICS)}, avec une fourchette a 90 %.</td>
  <td class="libre">C'est un <strong>plancher</strong> sur un pool fige de requetes : un domaine classe sur nos requetes est aussi classe sur des centaines d'autres qu'on ne suit pas. Le mot « trafic organique » est interdit sur ce nombre, et l'interdiction est executee par le code, pas recommandee.</td></tr>
<tr><td>Search Console</td><td class="libre">Les seuls chiffres reels sur nos propres domaines : clics, impressions, positions.</td>
  <td class="libre">Son rapport Liens est un <strong>plancher</strong>. Mesure du 16/08/2026 : il annoncait 24 liens, en omettant un lien deja acquis sur un site partenaire, parfaitement crawlable et servi en dofollow. Ce que Search Console n'a pas encore vu n'a pas cesse d'exister.</td></tr>
</tbody></table></div>

<h2>Les trois etats d'une mesure</h2>
<p><strong>Mesure.</strong> La source a repondu, la valeur entre au calcul.</p>
<p><strong>Rien.</strong> La source a repondu « rien ». C'est une <em>vraie</em> mesure : elle entre au calcul a sa valeur basse.
Un domaine absent de Tranco est dans ce cas.</p>
<p><strong>▲ Angle mort.</strong> La source n'a pas pu repondre : un 403, un captcha, un delai depasse, une page rendue en JavaScript.
La valeur est nulle, <strong>son poids sort du calcul</strong> et la fourchette s'elargit. <strong>Jamais un zero.</strong>
Le magasin d'observations le fait respecter mecaniquement : une ligne en angle mort ne <em>peut pas</em> porter de valeur, l'ecriture leve.</p>

<h2>Pourquoi la note maison n'est pas un Domain Authority</h2>
<p>Le DA de Moz se calcule sur le <em>volume</em> de backlinks. C'est la metrique la plus manipulable du SEO,
et c'est exactement pour cela que les fermes a liens la mettent en avant : elle recompense ce qu'elles vendent.
Ici la correlation mesuree commande les poids :</p>
<div class="tableau"><table><thead><tr><th class="libre-th">Signal</th><th>Correlation avec la performance</th><th>Poids retenu</th></tr></thead><tbody>
<tr><td class="libre">Trafic et mentions de marque</td><td class="n">0,66 a 0,74</td><td class="n">32 %</td></tr>
<tr><td class="libre">Domain Rating</td><td class="n">0,27 a 0,33</td><td class="n">26 % (autorite acquise)</td></tr>
<tr><td class="libre">Nombre de pages</td><td class="n">0,19</td><td class="n">15 % (couverture)</td></tr>
</tbody></table></div>
<p>${esc(POIDS_LISIBLES)}. Un lien ne compte que s'il est <em>transmis</em> : un nofollow sur une page en noindex
transmet strictement zero, quelle que soit la qualite de la page. Et cent liens de fermes font <strong>baisser</strong>
la note au lieu de la monter. Un lien se classe UTILE au-dessus de ${SEUIL_UTILE}, NEUTRE au-dessus de ${SEUIL_NEUTRE},
TOXIQUE en dessous s'il transmet vraiment.</p>

<h2>Les regles d'affichage, qui sont le produit</h2>
<ul class="petit">
<li>Jamais un <strong>0</strong> la ou la mesure a echoue : un <strong>▲</strong> et le libelle de l'angle mort, a l'ecran.</li>
<li>Toute estimation porte le mot <strong>estimation</strong>, sa source et sa date <em>dans la cellule</em>, jamais en note de bas de page.</li>
<li>Une note dont le socle de mesure est sous <strong>${Math.round(SOCLE_AFFICHABLE * 100)} %</strong> s'affiche en <strong>fourchette</strong>,
    et son domaine ne se classe pas : il reste en bas du tri, dans les deux sens.</li>
<li>Le compte de liens vu par Bing et le compte de liens qualifies par lecture du HTML sont <strong>deux colonnes</strong>, jamais une somme.</li>
<li>Le rapport Liens de Search Console s'affiche toujours comme <strong>« au moins N »</strong>.</li>
<li>Une observation <strong>s'empile, elle ne s'ecrase jamais</strong> : c'est ce qui permet de repondre a « ce lien est tombe quand ».</li>
<li>Une <strong>disparition</strong> n'est annoncee que si le collecteur est repasse sur la cible. Sinon, c'est une mesure qui manque, pas un lien qui tombe.</li>
</ul>

<h2>Les spots</h2>
<p class="doux petit">Ces domaines ne sont pas des concurrents : ce sont des cibles de lien. Ils se notent en NL (note de lien)
et pas en ND (note de domaine), et le calculateur <em>refuse</em> de les confondre.</p>
<div class="tableau"><table><thead><tr><th>Domaine</th><th class="libre-th">Pourquoi il est suivi</th></tr></thead><tbody>
${cfg.spots.map((s) => `<tr><td>${esc(s.domaine)}</td><td class="libre">${esc(s.note || s.libelle || "")}</td></tr>`).join("")}
</tbody></table></div>

<h2>Le pool de requetes</h2>
<p class="doux petit">Version <strong>${esc(cfg.requetes?.version || "?")}</strong>, fige : on ne compare des positions dans le temps
que si le pool ne bouge pas. Toute requete ajoutee demarre une nouvelle version, et les deux ne se comparent pas.</p>
<p class="petit">${[...(cfg.requetes?.fr || []), ...(cfg.requetes?.en || [])].map((r) => `<span class="puce">${esc(r)}</span>`).join(" ")}</p>
`, "methode.html");
}

// =====================================================================================
// ECRITURE
// =====================================================================================

fs.mkdirSync(SORTIE, { recursive: true });

// =====================================================================================
// PAGE : LA NOTE, ET RIEN D'AUTRE
//
// ⛔ POURQUOI CETTE PAGE EXISTE. Le comparateur affichait les cinq axes de la note en
//    colonnes, avec leurs poids et leurs angles morts, et il est devenu illisible :
//    arbitrage du 21/08/2026, une note doit etre UN chiffre a l'endroit ou l'on compare.
//    Un tableau de comparaison sert a comparer, pas a demontrer. Le chiffre reste donc sur
//    le comparateur, la demonstration vient ici, et la fiche de chaque domaine porte SON
//    calcul a lui.
// =====================================================================================

function pageNote() {
  // Meme repli que le comparateur : un domaine de la configuration, jamais un nom ecrit
  // en dur, et rien du tout si la configuration ne suit aucun domaine.
  const nousLa = DOMAINES.find((d) => META.get(d)?.role === "nous") || DOMAINES[0] || null;
  const n = nousLa ? NOTES.get(nousLa) : null;

  const axes = [
    ["TR", "Trafic", 32,
      "Le rang de popularite du domaine (Tranco, agrege de plusieurs panels) et sa visibilite sur les requetes suivies.",
      "C'est le seul axe qu'on ne peut pas acheter en gros. La correlation mesuree du trafic avec la performance est de 0,66 a 0,74 ; celle du Domain Rating, de 0,27 a 0,33. Un axe qui correle trois fois moins ne pese pas plus."],
    ["AA", "Autorite acquise", 26,
      "La qualite du profil de liens : chaque lien recoit sa propre note, on additionne leurs masses, et on retranche le spam.",
      "La masse est quadratique, donc un lien a 80 vaut quatre fois un lien a 40 et pas deux. Le volume est logarithmique, donc les dix premiers bons liens comptent plus que les cent suivants."],
    ["PO", "Positions", 17,
      "Combien de requetes du pool figé placent le domaine dans les trois, dix ou vingt premiers resultats.",
      "Le pool est fige et versionne : on ne compare des positions dans le temps que si la liste des requetes ne bouge pas."],
    ["CO", "Couverture", 15,
      "Le nombre d'URL au sitemap, et la part de ces URL reellement indexables.",
      "Plafonne bas a dessein. Le nombre de pages est le levier le plus faible, correlation 0,19 : une note qui recompenserait la masse inviterait au contenu creux."],
    ["ST", "Sante technique", 10,
      "Code de reponse, redirections, temps de reponse, poids de la page, robots.txt, sitemap, certificat.",
      "C'est le seul axe mesurable a 100 %, donc le seul ou un angle mort signale une panne de NOTRE collecte et pas une limite du web."],
  ];

  const tableauAxes = axes.map(([cle, nom, poids, quoi, pourquoi]) => `<tr>
  <td class="fixe"><strong>${cle}</strong> &middot; ${esc(nom)}</td>
  <td class="n">${poids}&nbsp;%</td>
  <td class="libre">${esc(quoi)}</td>
  <td class="libre doux">${esc(pourquoi)}</td>
</tr>`).join("\n");

  return page("La note maison", `
<div class="encart">
  <h2 style="margin-top:0">Ce que la note n'est pas</h2>
  <p>Ce n'est <strong>pas un Domain Authority</strong>. Le DA de Moz se calcule sur le <em>volume</em> de backlinks,
  c'est la metrique la plus manipulable du referencement, et c'est precisement pour cela que les fermes a liens la
  mettent en avant. Ici la doctrine est inverse : <strong>le trafic d'abord, le nombre de liens ensuite</strong>.</p>
  <p>Consequence chiffree, verifiee par un test qui tourne a chaque calcul :
  <strong>cent bons liens rapportent 8,10 points, cent liens de fermes en coutent 11,30.</strong>
  L'asymetrie est voulue. Acheter du volume doit couter plus cher que gagner de la qualite.</p>
</div>

<h2>La formule</h2>
<p class="sous-titre">Cinq axes, cinq poids, rien d'autre.</p>
<div class="encart" style="text-align:center">
  <code style="font-size:16px;padding:9px 15px;display:inline-block">ND = 0,32&middot;TR + 0,26&middot;AA + 0,17&middot;PO + 0,15&middot;CO + 0,10&middot;ST</code>
</div>

<div class="tableau"><table><thead><tr>
  <th class="fixe-th">Axe</th><th>Poids</th><th class="libre-th">Ce qu'il mesure</th><th class="libre-th">Pourquoi ce poids</th>
</tr></thead><tbody>
${tableauAxes}
</tbody></table></div>

<h2>Les trois etats d'une mesure</h2>
<p class="sous-titre">C'est ce qui separe cette note d'un score de marche.</p>
<div class="grille">
  <div class="carte"><span class="chiffre" style="font-size:23px">Mesure</span>
    <div class="quoi">La source a repondu. La valeur entre au calcul.</div></div>
  <div class="carte"><span class="chiffre" style="font-size:23px">Rien</span>
    <div class="quoi">La source a repondu &laquo;&nbsp;rien&nbsp;&raquo;. C'est une <strong>vraie mesure</strong>, et une mesure severe :
    un domaine absent du million Tranco n'y est pas parce qu'il n'a pas assez de trafic. Il entre au calcul a sa valeur basse.</div></div>
  <div class="carte"><span class="chiffre" style="font-size:23px">&#9650; Angle mort</span>
    <div class="quoi">La source n'a pas pu repondre : un 403, un captcha, un delai. Le poids de l'axe
    <strong>sort du calcul</strong> au lieu de compter zero, et la note s'elargit en fourchette.</div></div>
</div>

<div class="avert"><strong>Un domaine pas assez mesure ne se classe pas.</strong>
Sous ${Math.round(SOCLE_AFFICHABLE * 100)}&nbsp;% de socle de mesure, la note ne s'affiche plus comme un nombre mais comme une
fourchette, et le domaine quitte le classement au lieu d'y descendre. On ne range pas un domaine qu'on n'a pas regarde.</div>

${nousLa ? `<h2>Un exemple complet : ${esc(META.get(nousLa)?.libelle || nousLa)}</h2>
<p class="sous-titre">Le calcul reel du dernier releve, axe par axe.
<a href="${fichierDomaine(nousLa)}">Sa fiche</a> porte en plus les mesures brutes et leurs preuves.</p>
${n && !n.erreur && !VIDE ? tableauNote(n) : `<p class="doux">Aucune note calculee pour ${esc(nousLa)} : ${VIDE ? "le journal ne porte encore aucune mesure." : "voir sa fiche pour le detail de ce qui manque."}</p>`}` : ""}

<h2>La note d'un lien</h2>
<p class="sous-titre">L'axe AA est bati dessus : chaque backlink recoit sa propre note, sur le meme principe.</p>
<div class="tableau"><table><thead><tr>
  <th class="fixe-th">Composante</th><th>Poids</th><th class="libre-th">Ce qu'elle regarde</th>
</tr></thead><tbody>
<tr><td class="fixe"><strong>T_page</strong> &middot; trafic de la page</td><td class="n">40&nbsp;%</td>
  <td class="libre">Le trafic de la <strong>page</strong> qui porte le lien, pas du domaine. Une page morte sur un gros site ne transmet rien.</td></tr>
<tr><td class="fixe"><strong>C</strong> &middot; coherence</td><td class="n">22&nbsp;%</td>
  <td class="libre">La page source parle-t-elle du meme sujet que le votre, ou d'autre chose.</td></tr>
<tr><td class="fixe"><strong>A</strong> &middot; auteurs</td><td class="n">18&nbsp;%</td>
  <td class="libre">Combien d'auteurs identifiables signent le site. Un auteur unique et pseudonyme signant des centaines d'articles est une ferme a contenu.
  Mais un auteur unique ne suffit pas a le conclure : il faut la conjonction auteur unique <strong>et</strong> identite invérifiable.</td></tr>
<tr><td class="fixe"><strong>P</strong> &middot; profondeur</td><td class="n">20&nbsp;%</td>
  <td class="libre">Un lien depuis une page profonde pertinente vaut mieux qu'un lien de plus sur une page d'accueil deja saturee.</td></tr>
<tr><td class="fixe"><strong>&times; Transmission</strong></td><td class="n">multiplicateur</td>
  <td class="libre">dofollow sur page indexee <strong>1,00</strong> &middot; dofollow pas encore indexee 0,45 &middot; sponsored ou ugc 0,15 &middot;
  nofollow 0,10 &middot; lien monte en JavaScript <strong>0,00</strong>.
  Un multiplicateur et non une composante : un nofollow sur une page en noindex transmet strictement zero, quelle que soit la qualite de la page.</td></tr>
<tr><td class="fixe"><strong>&times; Malus</strong></td><td class="n">multiplicateur</td>
  <td class="libre">Le site vend-il des liens. Aucun signal 1,00 &middot; tarif public sur site sain 0,55 &middot; tarif public plus signal de ferme 0,20 &middot; desavoue 0,05.</td></tr>
</tbody></table></div>
<p class="doux petit">Un lien est <strong>UTILE</strong> au-dessus de ${SEUIL_UTILE}, <strong>NEUTRE</strong> entre 15 et ${SEUIL_UTILE - 1},
et <strong>TOXIQUE</strong> sous 15 s'il transmet quand meme. Un spam en nofollow ne transmet rien, donc il ne se punit pas.</p>

<h2>La note du site emetteur</h2>
<p class="sous-titre">Celle qui s'affiche sur chaque ligne de la page Backlinks. Elle se calcule sur les milliers de domaines
qui nous lient, sans ouvrir une seule page.</p>
<div class="tableau"><table><thead><tr>
  <th class="fixe-th">Composante</th><th>Poids</th><th class="libre-th">Ce qu'elle regarde</th>
</tr></thead><tbody>
<tr><td class="fixe">Popularite</td><td class="n">35&nbsp;%</td><td class="libre">Le rang Tranco du domaine.</td></tr>
<tr><td class="fixe">Autorite de liens</td><td class="n">25&nbsp;%</td>
  <td class="libre">OpenPageRank, <strong>plafonne</strong> des qu'il depasse de plus de 25 points la popularite reelle.
  Une forte autorite de liens sur un domaine que personne ne visite est le portrait d'une ferme, pas d'une autorite.</td></tr>
<tr><td class="fixe">Reseau referent</td><td class="n">15&nbsp;%</td>
  <td class="libre">Le nombre de <strong>sous-reseaux</strong> distincts qui pointent vers lui. Mille domaines sur le meme hebergeur
  ne font qu'un sous-reseau : c'est ce qui rend la mesure resistante au spam en gros.</td></tr>
<tr><td class="fixe">Proprete</td><td class="n">15&nbsp;%</td>
  <td class="libre">Les signaux de spam mesures sur la page, quand on a pu l'ouvrir.
  Ne pas avoir lu la page n'est <strong>pas</strong> &laquo;&nbsp;propre&nbsp;&raquo; : c'est un angle mort.</td></tr>
<tr><td class="fixe">Coherence de sujet</td><td class="n">10&nbsp;%</td>
  <td class="libre">Le nom du domaine parle-t-il de notre sujet. Un nom generaliste n'est pas une faute : la note y est neutre, jamais nulle.</td></tr>
</tbody></table></div>
`, "note.html", {
    chapeau: `Zero a cent, et le detail de chaque point. Cette page existe pour que le chiffre du comparateur
      reste un chiffre : la demonstration est ici, pas dans le tableau de comparaison.`,
  });
}

// =====================================================================================
// PAGE : LES OPPORTUNITES
//
// ⛔ C'EST LA PAGE LA PLUS UTILE DE TOUT L'OUTIL, et elle est nee d'un resultat qui
//    ressemblait a un echec. Mesure : le robot a lu 400 sites qui citent nos concurrents
//    et n'a trouve AUCUN lien vers nous. « Zero trouve » se jette a la poubelle. Or ces
//    400 sites parlent exactement de notre sujet, ils ont deja publie un lien vers un
//    produit comme le notre, et ils ne nous connaissent pas : c'est une liste de
//    demarchage qualifiee, pas un echec de mesure.
//    Et c'est la seule chose qu'aucun outil du marche ne fait a notre place : Semrush
//    montre les backlinks d'un concurrent, il ne dit pas « ceux-la parlent de lui et pas
//    de toi, va les voir ».
// =====================================================================================

function pageOpportunites() {
  const brut = photo.filter((o) => o.metrique === "opportunite_backlink");

  // Un meme hote peut ressortir plusieurs fois : on garde le releve le plus riche.
  const parHote = new Map();
  for (const o of brut) {
    const h = o.objet?.domaine;
    if (!h) continue;
    const p = parHote.get(h);
    if (!p || (o.valeur || 0) > (p.valeur || 0)) parHote.set(h, o);
  }

  const rangees = [...parHote.values()].filter((o) =>
    META.get(o.objet?.domaine)?.role !== "concurrent" && META.get(o.objet?.domaine)?.role !== "nous"
  ).map((o) => {
    // ⛔ Un domaine contient des POINTS : decouper la preuve sur le premier point coupait
    //    une liste du genre « concurrent-un.com, concurrent-deux.com » (exemple) en plein
    //    milieu, sur le point de « .com », et rendait la colonne vide. On borne donc
    //    explicitement entre « PAS nous : » et « . Candidat ».
    const rivaux = /PAS nous\s*:\s*([\s\S]*?)\.\s*Candidat/.exec(String(o.preuve || ""));
    const note = der(o.objet.domaine, "note_emetteur");
    const tr = der(o.objet.domaine, "tranco_rang");
    return {
      hote: o.objet.domaine,
      url: o.objet.url,
      nbRivaux: o.valeur || 0,
      rivaux: rivaux ? rivaux[1].split(",").map((x) => x.trim()) : [],
      note: note && note.etat === "MESURE" ? note.valeur : null,
      tranco: tr && tr.etat === "MESURE" ? tr.valeur : null,
      date: o.date_mesure,
    };
  }).sort((a, b) =>
    // ⛔ On classe par NOMBRE DE CONCURRENTS CITES d'abord, pas par autorite. Un site qui
    //    en cite six est un comparatif du secteur : c'est la porte la plus large, meme
    //    s'il est moins populaire qu'un site generaliste qui en cite un.
    (b.nbRivaux - a.nbRivaux) || ((b.note ?? -1) - (a.note ?? -1)));

  const corps = rangees.map((r) => `<tr>
  <td class="fixe"><a href="${esc(r.url || `https://${r.hote}/`)}" target="_blank" rel="noreferrer noopener">${esc(r.hote)}</a></td>
  <td class="n" data-v="${r.nbRivaux}"><strong>${nb(r.nbRivaux)}</strong></td>
  <td class="libre">${r.rivaux.map((x) => `<span class="puce">${esc(x)}</span>`).join(" ")}</td>
  <td class="n" data-v="${r.note ?? ""}">${r.note == null ? '<span class="vide">—</span>' : nb(Math.round(r.note))}</td>
  <td class="n" data-v="${r.tranco ?? ""}">${r.tranco == null ? '<span class="doux petit">hors top 1M</span>' : nb(r.tranco)}</td>
  <td class="doux petit">${esc(String(r.date).slice(0, 10))}</td>
</tr>`).join("\n");

  const gros = rangees.filter((r) => r.nbRivaux >= 3).length;

  // ⛔ « 0 opportunite » ET « aucun robot n'est encore passe » NE SE RESSEMBLENT QU'A
  //    L'ECRAN. Le premier veut dire que 400 pages ont ete ouvertes et qu'aucune ne cite
  //    un concurrent sans nous citer, ce qui serait une excellente nouvelle. Le second
  //    veut dire que personne n'a regarde. Tant que le robot n'a rien produit, la carte
  //    porte un tiret et la marche a suivre, jamais un zero.
  const jamaisCherche = brut.length === 0;

  return page("Opportunites", `
<div class="grille">
  <div class="carte vedette"><span class="chiffre">${jamaisCherche ? "—" : nb(rangees.length)}</span>
    <div class="quoi">sites qui citent un concurrent et pas nous</div>
    <div class="note">${jamaisCherche
      ? "le robot n a pas encore tourne : ce n est pas zero occasion, c est zero recherche"
      : "chacun a ete OUVERT et LU, ce n est pas une liste devinee"}</div></div>
  <div class="carte"><span class="chiffre">${jamaisCherche ? "—" : nb(gros)}</span>
    <div class="quoi">en citent au moins trois</div>
    <div class="note">${jamaisCherche
      ? "lancez le serveur local, puis le bouton « Lancer le crawl » de la page Backlinks"
      : "un comparatif du secteur, la porte la plus large"}</div></div>
</div>

<div class="avert"><strong>D ou vient cette liste.</strong>
Le graphe de liens du web donne les domaines qui pointent vers les concurrents de votre configuration.
Le robot les ouvre un par un, lit leur HTML, et regarde qui ils citent. Quand un site cite un concurrent
et pas nous, il atterrit ici. Il parle deja de notre sujet, il a deja publie un lien vers un produit
comme le notre, et il ne nous connait pas.
⛔ Cette page se lit avec la doctrine netlinking : le trafic d abord, le nombre de liens ensuite,
et un site sans trafic avec une grosse autorite de liens est une ferme, pas une occasion.</div>

<div class="tableau haut"><table data-triable><thead><tr>
  <th class="fixe-th">Site</th>
  <th>Concurrents cites</th>
  <th class="libre-th">Lesquels</th>
  <th>Note emetteur</th>
  <th>Rang Tranco</th>
  <th>Vu le</th>
</tr></thead><tbody>
${corps || `<tr><td colspan="6" class="doux">Aucune opportunite relevee. Lance le robot depuis la page Backlinks.</td></tr>`}
</tbody></table></div>
`, "opportunites.html", {
    chapeau: `Les sites qui parlent de nos concurrents et jamais de nous. C est la seule page de cet outil
      qui ne decrit pas l existant : elle dit ou aller.`,
  });
}

const fichiers = [
  ["index.html", comparateur()],
  ["backlinks.html", pageBacklinks()],
  ["opportunites.html", pageOpportunites()],
  ["note.html", pageNote()],
  ["methode.html", pageMethode()],
  ...DOMAINES.map((d) => [fichierDomaine(d), pageDomaine(d)]),
];

for (const [nom, contenu] of fichiers) fs.writeFileSync(path.join(SORTIE, nom), contenu, "utf8");

console.log(`${NOM_COURT} — site genere dans ${SORTIE}`);
console.log(`  ${fichiers.length} pages · ${nb(obs.length)} observations au journal, ${nb(photo.length)} au dernier releve · ${DOMAINES.length} domaines`);
let total = 0;
for (const [nom, c] of fichiers) {
  const o = Buffer.byteLength(c);
  total += o;
  if (["index.html", "backlinks.html", "methode.html"].includes(nom)) {
    console.log(`  ${nom.padEnd(22)} ${(o / 1024).toFixed(1)} Ko`);
  }
}
console.log(`  ${(total / 1024 / 1024).toFixed(2)} Mo au total`);

// ⛔ LE GENERATEUR VERIFIE QUE LA SERRURE EST ENCORE LA. Les quatre fichiers ci-dessous ne
//    sont pas produits par ce script : ils sont ecrits a la main et versionnes. S'ils
//    disparaissent (un nettoyage, une copie de dossier, un .gitignore trop large), le
//    prochain deploiement publie l'analyse des concurrents EN CLAIR sans que rien ne le
//    signale. Le controle coute quatre appels a existsSync ; l'oubli a coute une mise en
//    ligne publique le 21/08/2026 a 04h12.
const SERRURE = [
  ["functions/_middleware.js", "l'authentification par mot de passe. SANS LUI LE SITE EST PUBLIC."],
  ["_routes.json", "sans \"exclude\": [], les fichiers statiques sont servis hors du middleware."],
  ["_headers", "les en-tetes noindex et de securite."],
  ["robots.txt", "le Disallow integral."],
];
const manquants = SERRURE.filter(([f]) => !fs.existsSync(path.join(SORTIE, f)));
if (manquants.length) {
  console.error(`\n⛔ ${manquants.length} FICHIER(S) DE PROTECTION MANQUANT(S) DANS ${SORTIE} :`);
  for (const [f, quoi] of manquants) console.error(`   · ${f} — ${quoi}`);
  console.error("   NE PAS DEPLOYER en l'etat. Ces fichiers sont dans le depot, les restaurer avant.");
  process.exitCode = 2;
} else {
  console.log("  serrure en place : middleware, routes, en-tetes et robots.txt sont presents.");
}

// ⛔ LE JOURNAL VIDE SE DIT AUSSI DANS LE TERMINAL, PAS SEULEMENT DANS LA PAGE. Quelqu'un
//    qui vient d'installer l'outil lance cette commande AVANT d'ouvrir le navigateur : si
//    le terminal se contente d'annoncer « site genere », il ouvre un tableau de bord vide
//    sans savoir que c'est normal, et il en conclut que l'outil ne marche pas. On lui
//    donne donc la commande suivante, ici et sur chaque page.
if (VIDE) {
  console.log("\n⚠ Le journal est vide : le site est genere, mais il n'affiche aucune mesure.");
  console.log("  Ce n'est pas une panne : rien n'a encore ete collecte.");
  console.log("  La premiere passe, qui ne demande aucun compte ni aucune cle :");
  console.log("     node outils/collecte-domaine.mjs");
  console.log("     node outils/collecte-tranco-liste.mjs");
  console.log("     node outils/note.mjs");
  console.log("     node outils/site.mjs");
  console.log(`  Puis rouvrez ${path.join(SORTIE, "index.html")}`);
}
