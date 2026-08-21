// LA NOTE MAISON DE LA VIGIE SEO : note d'un LIEN (NL) et note d'un DOMAINE (ND).
//
// ⛔ CE N'EST PAS UN DOMAIN AUTHORITY, ET C'EST LE POINT DE DEPART DE TOUT LE FICHIER.
//    Le DA de Moz se calcule sur le VOLUME de backlinks. C'est la metrique la plus
//    manipulable du SEO, et c'est exactement pour cela que les fermes a liens la mettent
//    en avant : elle recompense ce qu'elles vendent. Notre doctrine est l'inverse,
//    LE TRAFIC D'ABORD, LE NOMBRE DE LIENS ENSUITE, et elle est chiffree :
//      trafic et mentions de marque    correlation 0,66 a 0,74 avec la performance
//      Domain Rating                   correlation 0,27 a 0,33
//      nombre de pages                 correlation 0,19
//    Un axe qui correle trois fois moins ne pese pas plus. Accessoirement, le trafic est
//    le seul axe qu'on ne peut pas acheter en gros.
//
// ⛔ CHAQUE COMPOSANTE S'AFFICHE AVEC SA VALEUR, SA SOURCE, SON ETAT ET SA JUSTIFICATION.
//    Un score sans son detail n'est pas exploitable, et personne ne le relit : il ne dit
//    ni d'ou il vient, ni ce qu'il faudrait changer pour le faire bouger. D'ou la forme de
//    retour : jamais un nombre nu, toujours un nombre + les composantes qui l'ont fabrique
//    + le socle de mesure qui dit combien de ce nombre est reellement mesure.
//
// ⛔ TROIS INTERDITS, ILS SONT LE PRODUIT :
//      1. jamais un ND seul sans ses cinq axes
//      2. jamais un chiffre sans sa date et sa source
//      3. jamais un 0 la ou la mesure a echoue, toujours un drapeau
//    Le troisieme est mecanique ici : un ANGLE_MORT ne prend PAS la valeur zero, il RETIRE
//    son poids du calcul et elargit la fourchette. Un domaine qu'on n'a pas mesure ne
//    descend pas dans le classement, il en SORT.
//
// ⛔ LE SOCLE COMMANDE L'AFFICHAGE. socle >= 60 % : la note s'affiche comme un nombre.
//    socle < 60 % : elle ne s'affiche PAS comme un nombre, seulement comme une fourchette,
//    et le domaine ne se classe pas. On ne range pas un domaine qu'on n'a pas mesure.
//    C'est le magasin d'observations qui le fait respecter : une ligne ANGLE_MORT ne PEUT
//    PAS porter de valeur, `observation()` leve. Le journal refuse donc physiquement de
//    transporter un nombre qui n'aurait pas le droit de s'afficher.
//
// LA VERSION DE LA FORMULE EST DANS LE CHAMP `collecteur` de chaque observation ecrite.
// C'est ce qui permet de distinguer « la note a bouge parce que le marche a bouge » de
// « la note a bouge parce que j'ai corrige la formule ». Sans ca, chaque correction
// ressemblerait a un mouvement du marche, et la courbe ne voudrait plus rien dire.
//
// Usage :
//   node outils/note.mjs --test                    controles hors ligne, sans reseau
//   node outils/note.mjs                           recalcule depuis le journal et ecrit
//   node outils/note.mjs --dry                     recalcule, affiche, n'ecrit rien
//   node outils/note.mjs --domaines=exemple.com    restreint le recalcul

import fs from "node:fs";
import path from "node:path";
import { observation, ecrire, lire, dernier, nouveauRun, config, RACINE } from "./_lib-obs.mjs";

// ⛔ LA VERSION EST LA FORMULE, PAS LE FICHIER. Toute modification d'un poids, d'un seuil
//    ou d'un lexique incremente ce numero. Une note calculee par note@1.0.0 et une note
//    calculee par note@1.1.0 ne se comparent pas sur une courbe.
export const VERSION = "note@1.0.0";

// ⛔ v1, non calibre : sur le cas reel qui a servi de reference, le recalcul rend
//    34,60 la ou la specification annoncait 37,6. L'ecart est connu et assume, il n'est
//    pas corrige par un coup de pouce sur le seuil.
export const SEUIL_UTILE = 35;
export const SEUIL_NEUTRE = 15;

/** Un domaine dont le socle est sous ce seuil ne s'affiche pas en nombre et ne se classe pas. */
export const SOCLE_AFFICHABLE = 0.60;

// ⛔ MESURE_ABSENT COMPTE COMME MESURE DANS LE SOCLE, ET C'EST UNE INTERPRETATION.
//    La specification ecrit « fraction des sous-mesures reellement en etat MESURE ».
//    Prise au pied de la lettre, elle punit deux fois le domaine hors du top 1M de
//    Tranco : une premiere fois par Tr_dom = 5, une seconde en faisant tomber son socle
//    sous 60 %, donc en le sortant du classement. Or Tranco a REPONDU, la reponse est
//    « ce domaine n'est pas dans la liste », et c'est une vraie mesure, pas un mur.
//    On ne penalise pas la mesure qui a abouti. C'est une seule ligne a changer pour qui
//    veut trancher dans l'autre sens, et c'est volontairement une seule ligne.
const POIDS_SOCLE_PAR_ETAT = { MESURE: 1, MESURE_ABSENT: 1, ANGLE_MORT: 0 };

// ================================================================================
// LES LEXIQUES DE COHERENCE EDITORIALE
// ================================================================================

/**
 * ⛔ LES LEXIQUES NE SONT PAS DANS LE CODE, ET CE N'EST PAS UN CONFORT DE RANGEMENT.
 *    La composante C repond a une seule question : « cette page parle-t-elle de MON
 *    sujet ». Les mots qui la fabriquent sont donc ceux de VOTRE secteur, et de personne
 *    d'autre. Un lexique laisse tel quel ne mesure pas votre coherence, il mesure votre
 *    coherence avec le secteur de celui qui a ecrit le fichier d'exemple. C se met alors
 *    a rendre la meme valeur partout, et un axe qui ne distingue rien coute plus cher
 *    qu'un axe absent : il occupe un poids dans la formule sans le meriter.
 *
 * ⛔ ON NE DEVINE PAS, ON ANNONCE. Quand aucun lexique a vous n'est trouve, l'exemple
 *    sert quand meme (l'outil doit demarrer sur un depot frais) mais il le DIT sur la
 *    sortie d'erreur, a chaque lancement. Une valeur par defaut silencieuse produirait
 *    exactement le genre de nombre que tout ce fichier existe pour empecher : un chiffre
 *    dont on ne sait pas ce qu'il mesure.
 *
 * Ordre de recherche :
 *   1. VIGIE_LEXIQUES              chemin complet d'un fichier json
 *   2. champ `lexiques` de votre configuration : soit l'objet ecrit directement dedans,
 *      soit un chemin, relatif au fichier de configuration
 *   3. lexiques.json POSE A COTE de domaines.json
 *   4. config/lexiques.exemple.json, avec l'avertissement ci-dessus
 *
 * ⛔ ET SI VIGIE_LEXIQUES OU LE CHAMP `lexiques` POINTE SUR UN FICHIER ABSENT, ON LEVE,
 *    au lieu de retomber en douce sur l'exemple. Meme doctrine que pour VIGIE_CONFIG :
 *    croire qu'on note avec le vocabulaire A alors qu'on note avec le vocabulaire B est
 *    plus couteux qu'un demarrage refuse.
 */
function fichierDeConfiguration() {
  return process.env.VIGIE_CONFIG
    ? path.resolve(process.env.VIGIE_CONFIG)
    : path.join(RACINE, "config", "domaines.json");
}

function validerLexiques(lex, provenance) {
  for (const niveau of ["l1", "l2"]) {
    for (const langue of ["fr", "en"]) {
      if (!Array.isArray(lex?.[niveau]?.[langue])) {
        throw new Error(
          `lexiques illisibles (${provenance}) : le champ ${niveau}.${langue} manque ou n'est pas une liste.\n` +
          "  Prenez config/lexiques.exemple.json comme gabarit : l1.fr, l1.en, l2.fr, l2.en."
        );
      }
    }
  }
  if (!lex.version) {
    throw new Error(
      `lexiques sans version (${provenance}). La version part dans le champ « collecteur » de chaque\n` +
      "  observation de note : sans elle, une correction de vocabulaire ressemble a un mouvement du marche."
    );
  }
  // ⛔ L'appariement se fait par SOUS-CHAINE : un terme de deux caracteres valide tout.
  //    « or » se trouve dans « order », « formation » et « historique ». On ne retire pas
  //    le terme en silence, ce serait modifier la mesure sans le dire : on le nomme.
  const courts = [...lex.l1.fr, ...lex.l1.en, ...lex.l2.fr, ...lex.l2.en]
    .filter((t) => String(t).trim().length < 3);
  if (courts.length) {
    console.warn(
      `[lexiques] ${courts.length} terme(s) de moins de 3 caracteres dans ${provenance} : ` +
      `${[...new Set(courts)].join(", ")}. En sous-chaine, ils valident presque tout et ` +
      "aplatissent la composante C. Allongez-les ou retirez-les."
    );
  }
  return lex;
}

function lireLexiques(fichier, provenance) {
  try {
    return validerLexiques(JSON.parse(fs.readFileSync(fichier, "utf8")), provenance);
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`lexiques illisibles (${fichier}) : ${e.message}`);
    throw e;
  }
}

// ⛔ ON CHARGE UNE SEULE FOIS PAR PROCESSUS. Sans ce cache, note.mjs et note-emetteur.mjs
//    relisent chacun le fichier et l'avertissement « aucun lexique a vous » sort deux
//    fois. Un avertissement repete se lit comme du bruit, et qui prend un avertissement
//    pour du bruit finit par ne plus lire aucun des deux.
let LEXIQUES_EN_CACHE = null;

export function chargerLexiques() {
  if (!LEXIQUES_EN_CACHE) LEXIQUES_EN_CACHE = chercherLexiques();
  return LEXIQUES_EN_CACHE;
}

function chercherLexiques() {
  const parEnv = process.env.VIGIE_LEXIQUES ? path.resolve(process.env.VIGIE_LEXIQUES) : null;
  if (parEnv) {
    if (!fs.existsSync(parEnv)) {
      throw new Error(
        `VIGIE_LEXIQUES pointe sur un fichier qui n'existe pas : ${parEnv}\n` +
        "  Corrige la variable, ou retire-la pour utiliser le lexique de ta configuration."
      );
    }
    return lireLexiques(parEnv, `VIGIE_LEXIQUES -> ${parEnv}`);
  }

  const fCfg = fichierDeConfiguration();
  if (fs.existsSync(fCfg)) {
    let champ = null;
    try { champ = JSON.parse(fs.readFileSync(fCfg, "utf8")).lexiques ?? null; } catch { champ = null; }
    if (champ && typeof champ === "object") {
      return validerLexiques(champ, `champ « lexiques » de ${fCfg}`);
    }
    if (typeof champ === "string" && champ.trim()) {
      const vise = path.resolve(path.dirname(fCfg), champ.trim());
      if (!fs.existsSync(vise)) {
        throw new Error(
          `le champ « lexiques » de ${fCfg} pointe sur un fichier absent : ${vise}\n` +
          "  Le chemin se lit depuis le dossier du fichier de configuration."
        );
      }
      return lireLexiques(vise, vise);
    }
  }

  const aCote = path.join(path.dirname(fCfg), "lexiques.json");
  if (fs.existsSync(aCote)) return lireLexiques(aCote, aCote);

  const exemple = path.join(RACINE, "config", "lexiques.exemple.json");
  const lex = lireLexiques(exemple, exemple);
  console.warn(
    "[lexiques] AUCUN LEXIQUE A VOUS : c'est config/lexiques.exemple.json qui sert, et il " +
    "porte le vocabulaire d'UN secteur (journal de trading, finance en ligne). Tant qu'il " +
    "n'est pas remplace, la composante C mesure votre proximite avec CE secteur-la, pas " +
    "avec le votre. Copiez-le en config/lexiques.json et mettez vos mots."
  );
  return lex;
}

const LEXIQUES = chargerLexiques();

// ---------------------------------------------------------------- petits outils

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 100) / 100);
const nombre = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Fabrique une composante affichable. C'est le seul objet que le site recevra, donc il
 * porte TOUT ce qu'il faut pour se relire sans revenir au code : le nom court a l'ecran,
 * la valeur, le poids, l'etat, la donnee brute d'entree, la source, la justification.
 * `sous_mesures` sert au socle : c'est la liste des choses qu'il a fallu mesurer pour
 * fabriquer cette composante, avec l'etat de chacune.
 */
function composante({
  cle, nom, valeur, poids, etat = "MESURE", brut = null, source = null,
  justification = "", plage = null, drapeaux = [], sousMesures = null,
}) {
  const v = nombre(valeur);
  const p = plage || [v ?? 0, v ?? 100];
  return {
    cle, nom,
    valeur: v === null ? null : r2(v),
    poids, etat,
    brut, source, justification,
    plage: [r2(p[0]), r2(p[1])],
    drapeaux,
    sous_mesures: sousMesures || [{ nom: cle, etat }],
    part_mesuree: partMesuree(sousMesures || [{ nom: cle, etat }]),
  };
}

function partMesuree(sousMesures) {
  if (!sousMesures.length) return 0;
  const s = sousMesures.reduce((a, m) => a + (POIDS_SOCLE_PAR_ETAT[m.etat] ?? 0), 0);
  return s / sousMesures.length;
}

/**
 * Agrege des composantes ponderees.
 *
 * ⛔ DEUX DENOMINATEURS DIFFERENTS, ET CE N'EST PAS UNE ERREUR.
 *    - la VALEUR ne se calcule que sur les composantes mesurees, dont le poids est
 *      renormalise : c'est la regle « l'angle mort retire son poids du calcul ».
 *      Elle reproduit exactement les nombres de la specification pour la composante A
 *      non applicable : 40/82 = 48,78 · 22/82 = 26,83 · 20/82 = 24,39.
 *    - la FOURCHETTE se calcule sur le poids TOTAL, en placant chaque angle mort a sa
 *      borne basse puis a sa borne haute. C'est ce qui fait qu'une fourchette large est
 *      lisible comme « je ne sais pas », et non comme « c'est moyen ».
 */
function agreger(comps) {
  const actives = comps.filter((k) => k.poids > 0);
  const mesurees = actives.filter((k) => k.etat !== "ANGLE_MORT" && k.valeur !== null);
  const poidsMesures = mesurees.reduce((a, k) => a + k.poids, 0);
  const poidsTotal = actives.reduce((a, k) => a + k.poids, 0);
  const valeur = poidsMesures > 0
    ? mesurees.reduce((a, k) => a + k.poids * k.valeur, 0) / poidsMesures
    : null;
  const borne = (i) => (poidsTotal > 0
    ? actives.reduce((a, k) => a + k.poids * (k.etat === "ANGLE_MORT" || k.valeur === null ? k.plage[i] : k.valeur), 0) / poidsTotal
    : null);
  let min = borne(0);
  let max = borne(1);
  // La borne basse d'un angle mort peut etre superieure au point (A vaut au minimum 5),
  // ce qui sortirait le point de sa propre fourchette. On elargit plutot que de mentir.
  if (valeur !== null && min !== null) { min = Math.min(min, valeur); max = Math.max(max, valeur); }
  return { valeur, plage: [min, max], poidsMesures, poidsTotal };
}

/**
 * Combine des morceaux ponderes A L'INTERIEUR d'une composante.
 * Chaque morceau porte trois choses et pas une : `v` le point de travail, `min` et `max`
 * ce qu'il pourrait valoir. Un morceau absent (v === null) sort du point et n'apparait
 * que dans la fourchette. C'est ce qui fait que « Tranco n'a pas repondu » elargit la
 * fourchette au lieu de tirer la note vers le bas.
 */
/**
 * Un morceau de composante : sa valeur si on l'a, sinon ses deux bornes.
 * ⛔ UN MORCEAU MESURE A UNE FOURCHETTE D'UN SEUL POINT. Sans cette regle, une composante
 *    entierement mesuree s'affichait quand meme [13,75 ; 58,75], et la fourchette ne
 *    voulait plus rien dire : elle doit se lire « voila ce que je ne sais pas », donc
 *    elle doit se refermer des que je sais.
 */
const morceau = (w, v, min, max) => ({ w, v, min: v === null || v === undefined ? min : v, max: v === null || v === undefined ? max : v });

function combiner(parts) {
  const connus = parts.filter((p) => p.v !== null && p.v !== undefined);
  const w = connus.reduce((a, p) => a + p.w, 0);
  const valeur = w > 0 ? connus.reduce((a, p) => a + p.w * p.v, 0) / w : null;
  const min = parts.reduce((a, p) => a + p.w * (p.min ?? (p.v ?? 0)), 0);
  const max = parts.reduce((a, p) => a + p.w * (p.max ?? (p.v ?? 100)), 0);
  return { valeur, min, max };
}

/** socle_composantes = Somme(poids × part_mesuree) / Somme(poids). */
function socleComposantes(comps) {
  const actives = comps.filter((k) => k.poids > 0);
  const tot = actives.reduce((a, k) => a + k.poids, 0);
  if (!tot) return 0;
  return actives.reduce((a, k) => a + k.poids * k.part_mesuree, 0) / tot;
}

// ================================================================================
// NIVEAU A : LA NOTE D'UN LIEN
// Base = 0,40·T_page + 0,22·C + 0,18·A + 0,20·P
// NL   = Base × Transmission × Malus
// Transmission et Malus sont des MULTIPLICATEURS et non des composantes additives : un
// nofollow sur une page en noindex transmet strictement zero, quelle que soit la qualite
// de la page. Additionnes, ils se feraient rattraper par une belle page ; multiplies, non.
// ================================================================================

export const POIDS_LIEN = { T_page: 40, C: 22, A: 18, P: 20 };

/**
 * Poids de position.
 *
 * ⛔ Wp EST UNE ECHELLE ORDINALE DE COMPARAISON, PAS UN TAUX DE CLIC MESURE.
 *    Elle sert a dire « la place 1 vaut davantage que la place 4 », rien d'autre. Le
 *    module de note ne multiplie JAMAIS Wp par un volume de recherche et ne sort JAMAIS
 *    un nombre exprime en visites : ce serait fabriquer une estimation de trafic maison
 *    et la presenter comme une mesure, exactement ce que la doctrine reproche aux outils
 *    payants. Somme des Wp, plafonnee, et c'est tout.
 */
export function Wp(position) {
  const p = nombre(position);
  if (p === null || p < 1) return 0;
  if (p === 1) return 0.28;
  if (p === 2) return 0.15;
  if (p === 3) return 0.10;
  if (p <= 6) return 0.06;
  if (p <= 10) return 0.02;
  if (p <= 20) return 0.005;
  return 0;
}

/**
 * Tr_dom : la notoriete du domaine source, lue dans Tranco.
 * Tr_dom = 100 · clamp((6 − log10(rang)) / 4, 0, 1)  →  rang 100 = 100, 10 000 = 50,
 * 100 000 = 25, 1 000 000 = 0.
 */
export function trDom({ rang = null, http = null, etat = null } = {}) {
  const src = "tranco (liste publique du jour)";
  // ⛔ L'ORDRE DES TROIS CAS EST LE COEUR DE LA REGLE. « Tranco a repondu et ne connait
  //    pas ce domaine » et « Tranco n'a pas repondu » donnent le meme ecran vide et n'ont
  //    rien a voir : le premier est une mesure, le second est un mur. Et « on ne l'a
  //    jamais interroge » est un troisieme cas, qui ne doit surtout pas se lire « hors
  //    top 1M » : c'est comme ca qu'un domaine jamais mesure se retrouve note 5.
  if (etat === "ANGLE_MORT" || (http !== null && http !== 200)) {
    return {
      valeur: 20, etat: "ANGLE_MORT", plage: [0, 100], source: src,
      brut: { rang, http },
      justification: `Tranco n'a pas repondu (HTTP ${http ?? "aucun"}) : 20 est une valeur de travail, pas une mesure, la fourchette va de 0 a 100`,
      drapeaux: ["tranco_injoignable"],
    };
  }
  if (rang === null && http === null && etat === null) {
    return {
      valeur: 20, etat: "ANGLE_MORT", plage: [0, 100], source: src,
      brut: { rang: null, http: null },
      justification: "Tranco n'a jamais ete interroge pour ce domaine : ce n'est ni un rang ni un « hors top 1M », c'est une mesure qui n'a pas eu lieu",
      drapeaux: ["tranco_non_interroge"],
    };
  }
  if (rang === null || rang === undefined) {
    // ⛔ {"ranks": []} EST UNE VRAIE MESURE, PAS UN ANGLE MORT. Tranco a repondu 200 et a
    //    dit « ce domaine n'est pas dans la liste ». On ecrit 5 et pas 0 : la formule
    //    donnerait 0 au rang 1 000 000 pile, et un domaine hors liste n'est pas
    //    forcement au rang 1 000 001.
    return {
      valeur: 5, etat: "MESURE_ABSENT", plage: [5, 5], source: src,
      brut: { rang: null, http: http ?? 200 },
      justification: "hors top 1M : Tranco a repondu et ne connait pas ce domaine",
      drapeaux: ["hors_top_1m"],
    };
  }
  const v = 100 * clamp((6 - Math.log10(rang)) / 4, 0, 1);
  return {
    valeur: v, etat: "MESURE", plage: [v, v], source: src,
    brut: { rang, http: http ?? 200 },
    justification: `rang Tranco ${rang}`,
    drapeaux: [],
  };
}

/** Somme des Wp d'une liste de positions, plafonnee au diviseur donne. */
function visibilite(positions, diviseur) {
  const somme = positions.reduce((a, p) => a + Wp(p), 0);
  return { valeur: 100 * Math.min(1, somme / diviseur), somme };
}

/**
 * T_page (poids 40) : ce que la page source rapporte reellement.
 * T_page = 0,60·Vis_page + 0,40·Tr_dom, Vis_page = 100 · min(1, ΣWp / 3).
 */
function compTPage({ tranco = {}, serp_page = null } = {}) {
  const t = trDom(tranco);
  const sousMesures = [{ nom: "tranco", etat: t.etat }];

  const aSerp = !!(serp_page && Array.isArray(serp_page.positions));
  sousMesures.push({ nom: "serp_page", etat: aSerp ? "MESURE" : "ANGLE_MORT" });

  // ⛔ SERP indisponible : T_page = Tr_dom SEUL, drapeau, fourchette large. Pas zero.
  //    `combiner` le fait tout seul : le morceau Vis_page sort du point (son poids est
  //    renormalise, donc T_page = Tr_dom) et reste dans la fourchette entre 0 et 100,
  //    ce qui donne exactement [0,40·Tr_dom ; 60 + 0,40·Tr_dom].
  const vis = aSerp ? visibilite(serp_page.positions, 3) : null;
  const c = combiner([
    morceau(0.60, vis ? vis.valeur : null, 0, 100),
    { w: 0.40, v: t.valeur, min: t.plage[0], max: t.plage[1] },
  ]);
  const etat = aSerp && t.etat !== "ANGLE_MORT" ? "MESURE" : "ANGLE_MORT";
  return composante({
    cle: "T_page", nom: "Trafic de la page", valeur: c.valeur, poids: POIDS_LIEN.T_page, etat,
    brut: { tranco: t.brut, positions: aSerp ? serp_page.positions : null, somme_Wp: vis ? r2(vis.somme) : null },
    source: `${t.source} + ${aSerp ? (serp_page.source || "releve de positions") : "SERP indisponible"}`,
    justification: aSerp
      ? `Vis_page ${r2(vis.valeur)} (somme des poids de position ${r2(vis.somme)} sur 3) et Tr_dom ${r2(t.valeur)} : ${t.justification}`
      : `pas de releve de positions pour cette page : on retombe sur la notoriete du domaine seule (Tr_dom = ${r2(t.valeur)}, ${t.justification})`,
    plage: [c.min, c.max],
    drapeaux: [...t.drapeaux, ...(aSerp ? [] : ["serp_page_indisponible"])],
    sousMesures,
  });
}

// ---------------------------------------------------------------- C, coherence editoriale

// ⛔ Les marques diacritiques se retirent APRES normalize("NFD") et AVANT le passage
//    des separateurs a l'espace. Dans l'autre ordre, « journee » ecrit « journée » se
//    decompose en e + accent, l'accent devient une espace, et le mot se coupe en deux.
const MARQUES_DIACRITIQUES = /[\u0300-\u036f]/g;

/** Minuscules, accents retires, tout separateur devient une espace. */
export function normaliser(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(MARQUES_DIACRITIQUES, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SUFFIXES = new Set([
  "com", "net", "org", "io", "co", "app", "ai", "fr", "uk", "us", "sg", "vip", "info",
  "biz", "dev", "me", "tech", "store", "online", "site", "xyz", "top", "cloud", "digital",
  "agency", "eu", "ch", "be", "ca", "de", "es", "it", "www",
]);

/**
 * ⛔ RETIRER LE HOST DU SLUG AVANT TOUT APPARIEMENT. C'EST LA PRECAUTION LA PLUS CHERE
 *    DU FICHIER. Mesure du 21/08/2026 sur un domaine reel dont le nom de marque CONTIENT
 *    un terme du lexique : sans retrait, c1 = 1,0000 sur les 2 605 slugs de son sitemap,
 *    parce que chaque slug repete le nom du site. Le domaine s'AUTO-VALIDE,
 *    et la composante de coherence editoriale ne mesure plus rien du tout, elle recopie
 *    le nom de domaine. Apres retrait : c1 = 0,9225, ce qui est une mesure.
 *    On ne retire QUE les etiquettes propres du host, jamais le suffixe : retirer « com »
 *    amputerait « commande », « comparatif » et « comment ».
 */
export function retirerHote(slug, domaine) {
  let s = normaliser(slug);
  const parts = normaliser(domaine).split(" ").filter(Boolean);
  // La derniere etiquette est le suffixe (com, fr, sg) : elle sort d'office. Les suffixes
  // composes (com.sg) laissent un « com » au milieu, que la liste attrape.
  const etiquettes = (parts.length > 1 ? parts.slice(0, -1) : parts).filter((p) => !SUFFIXES.has(p));
  for (const e of etiquettes) if (e.length >= 3) s = s.split(e).join(" ");
  return s.replace(/\s+/g, " ").trim();
}

const TERMES_L1 = [...LEXIQUES.l1.fr, ...LEXIQUES.l1.en].map(normaliser);
const TERMES_L2 = [...LEXIQUES.l2.fr, ...LEXIQUES.l2.en].map(normaliser);

/** Termes DISTINCTS trouves dans un texte deja normalise. Appariement par sous-chaine. */
function termesTrouves(texteNormalise, liste) {
  const vus = new Set();
  for (const t of liste) if (t && texteNormalise.includes(t)) vus.add(t);
  return [...vus];
}

/**
 * c1 = part des slugs portant un terme L1
 * c2 = part des slugs portant un terme L2 SANS terme L1 (on ne compte pas deux fois)
 * C_site = 100 · min(1, c1 + 0,40·c2)
 */
export function coherenceSite(slugs, domaine) {
  if (!Array.isArray(slugs) || !slugs.length) return null;
  let n1 = 0;
  let n2 = 0;
  for (const s of slugs) {
    const t = retirerHote(s, domaine);
    const a1 = TERMES_L1.some((x) => t.includes(x));
    if (a1) { n1++; continue; }
    if (TERMES_L2.some((x) => t.includes(x))) n2++;
  }
  const c1 = n1 / slugs.length;
  const c2 = n2 / slugs.length;
  return { valeur: 100 * Math.min(1, c1 + 0.40 * c2), c1, c2, n: slugs.length, n1, n2 };
}

/**
 * C_page = 100 · min(1, n1/12 + 0,40·(n2/12)), n1 et n2 = termes DISTINCTS.
 * Distincts et non occurrences : une page qui repete douze fois « trading » n'est pas une
 * page qui couvre douze sujets. Le texte genere fait exactement ca.
 */
export function coherencePage(texte, domaine) {
  if (texte === null || texte === undefined) return null;
  const t = retirerHote(texte, domaine || "");
  const l1 = termesTrouves(t, TERMES_L1);
  const l2 = termesTrouves(t, TERMES_L2).filter((x) => !l1.includes(x));
  return {
    valeur: 100 * Math.min(1, l1.length / 12 + 0.40 * (l2.length / 12)),
    n1: l1.length, n2: l2.length, exemples: [...l1.slice(0, 6), ...l2.slice(0, 4)],
  };
}

function compC({ page = {}, site = {} } = {}) {
  const cp = coherencePage(page.texte ?? null, page.domaine || site.domaine);
  const cs = coherenceSite(site.slugs ?? null, site.domaine || page.domaine);
  const sousMesures = [
    { nom: "C_page", etat: cp ? "MESURE" : "ANGLE_MORT" },
    { nom: "C_site", etat: cs ? "MESURE" : "ANGLE_MORT" },
  ];
  if (!cp && !cs) {
    return composante({
      cle: "C", nom: "Coherence editoriale", valeur: null, poids: POIDS_LIEN.C,
      etat: "ANGLE_MORT", plage: [0, 100],
      brut: { texte_page: null, slugs: null },
      source: "lecture HTML de la page + sitemap du domaine source",
      justification: "ni le texte de la page ni le sitemap du domaine n'ont ete lus : la coherence editoriale n'est pas mesuree",
      drapeaux: ["coherence_non_mesuree"], sousMesures,
    });
  }
  // Une seule des deux mesures disponible : on garde la formule et on remplace la
  // manquante par sa fourchette, jamais par zero.
  const vp = cp ? cp.valeur : null;
  const vs = cs ? cs.valeur : null;
  const v = vp !== null && vs !== null ? 0.65 * vp + 0.35 * vs : (vp !== null ? vp : vs);
  const plage = vp !== null && vs !== null
    ? [v, v]
    : vp !== null ? [0.65 * vp, 0.65 * vp + 35] : [0.35 * vs, 0.35 * vs + 65];
  return composante({
    cle: "C", nom: "Coherence editoriale", valeur: v, poids: POIDS_LIEN.C,
    etat: vp !== null && vs !== null ? "MESURE" : "ANGLE_MORT",
    brut: {
      C_page: cp ? { valeur: r2(cp.valeur), termes_L1_distincts: cp.n1, termes_L2_distincts: cp.n2, exemples: cp.exemples } : null,
      C_site: cs ? { valeur: r2(cs.valeur), slugs: cs.n, c1: r2(cs.c1 * 100) / 100, c2: r2(cs.c2 * 100) / 100 } : null,
      lexiques: LEXIQUES.version,
    },
    source: "lecture HTML de la page + sitemap du domaine source",
    justification: [
      cp ? `page : ${cp.n1} termes coeur et ${cp.n2} termes peripheriques distincts (${r2(cp.valeur)})` : "page non lue",
      cs ? `site : ${cs.n1}/${cs.n} slugs portent un terme coeur (c1 = ${cs.c1.toFixed(4)}), host retire avant appariement (${r2(cs.valeur)})` : "sitemap non lu",
    ].join(" · "),
    plage,
    drapeaux: vp !== null && vs !== null ? [] : ["coherence_partielle"],
    sousMesures,
  });
}

// ---------------------------------------------------------------- A, auteurs

/**
 * A, auteurs (poids 18).
 *
 * ⛔ UN AUTEUR UNIQUE NE SUFFIT PAS A DECLARER UNE FERME, ET LE CONTRE-EXEMPLE EST MESURE.
 *    Mesure du 21/08/2026, premier site : un blog de formation, 536 URL, six articles
 *    signes du meme prenom, donc UN SEUL auteur distinct. Ce n'est pas une ferme : la page
 *    d'archive nomme deux fondateurs avec leur role, l'identite est reelle, et le domaine
 *    est au rang Tranco 722 529.
 *    Meme jour, second site : un auteur unique lui aussi, mais sous un pseudonyme
 *    invérifiable, publiant des articles hors sujet par rapport au reste du site, un DA
 *    affiche de 60 a 64, et ABSENT du top 1M de Tranco. Celui-la vaut A = 5.
 *    C'est la CONJONCTION auteur unique ET identite invérifiable qui fait la ferme, jamais
 *    le compte d'auteurs tout seul.
 *
 * ⛔ SOUS 30 URL DE FORME EDITORIALE, LA COMPOSANTE EST NON APPLICABLE, PAS NULLE. Un
 *    annuaire n'a pas d'auteurs, et lui reprocher serait une erreur de categorie. Son
 *    poids se redistribue au prorata (48,78 / 26,83 / 24,39), ce que `agreger` fait tout
 *    seul en retirant un poids nul.
 */
function compA({
  urls_editoriales = null, auteurs_distincts = null, identite_verifiable = null,
  pseudonyme = null, nb_pages = null, echantillon_possible = true, source = "lecture des pages editoriales",
} = {}) {
  const nonApplicable = (n) => composante({
    cle: "A", nom: "Auteurs", valeur: null, poids: 0, etat: "MESURE_ABSENT",
    brut: { urls_editoriales: n }, source,
    justification: `${n === null ? "aucun" : n} contenu de forme editoriale au sitemap, moins que les 30 exiges : la composante auteurs NE S'APPLIQUE PAS et son poids se redistribue (48,78 / 26,83 / 24,39)`,
    plage: [0, 0], drapeaux: ["auteurs_non_applicable"],
    sousMesures: [{ nom: "auteurs", etat: "MESURE_ABSENT" }],
  });

  if (urls_editoriales !== null && urls_editoriales < 30) return nonApplicable(urls_editoriales);

  if (!echantillon_possible || auteurs_distincts === null) {
    return composante({
      cle: "A", nom: "Auteurs", valeur: 50, poids: POIDS_LIEN.A, etat: "ANGLE_MORT",
      brut: { urls_editoriales, auteurs_distincts, echantillon_possible }, source,
      justification: "impossible d'echantillonner les signatures (pages non lues ou mur anti-robot) : 50 est une valeur de travail, la fourchette va de 5 a 100",
      plage: [5, 100], drapeaux: ["auteurs_non_echantillonnables"],
      sousMesures: [{ nom: "auteurs", etat: "ANGLE_MORT" }],
    });
  }

  let v;
  let pourquoi;
  const dr = [];
  if (auteurs_distincts >= 4) { v = 100; pourquoi = `${auteurs_distincts} auteurs distincts`; }
  else if (auteurs_distincts === 3) { v = 85; pourquoi = "3 auteurs distincts"; }
  else if (auteurs_distincts === 2) { v = 70; pourquoi = "2 auteurs distincts"; }
  else if (auteurs_distincts === 1) {
    if (pseudonyme === true && identite_verifiable !== true) {
      v = 5;
      pourquoi = "auteur unique ET pseudonyme invérifiable : c'est la conjonction qui signe la ferme, pas le compte d'auteurs";
      dr.push("ferme_probable");
    } else if (nb_pages !== null && nb_pages > 800) {
      v = 30;
      pourquoi = `auteur unique pour ${nb_pages} pages : une seule plume ne produit pas ce volume`;
      dr.push("volume_incompatible_avec_un_auteur");
    } else {
      v = 60;
      pourquoi = `auteur unique mais VERIFIABLE pour ${nb_pages ?? "moins de 800"} pages : cas mesure d'un vrai blog d'auteur, ce n'est pas une ferme`;
    }
  } else if (identite_verifiable === true) {
    v = 45; pourquoi = "aucune signature d'auteur mais une identite d'entreprise verifiable";
  } else {
    v = 10; pourquoi = "aucun auteur et aucune identite verifiable";
    dr.push("aucune_identite");
  }

  return composante({
    cle: "A", nom: "Auteurs", valeur: v, poids: POIDS_LIEN.A, etat: "MESURE",
    brut: { urls_editoriales, auteurs_distincts, identite_verifiable, pseudonyme, nb_pages },
    source, justification: pourquoi, plage: [v, v], drapeaux: dr,
    sousMesures: [{ nom: "auteurs", etat: "MESURE" }],
  });
}

// ---------------------------------------------------------------- P, profondeur et saturation

/**
 * P (poids 20) = 0,40·Prof_source + 0,35·Satur + 0,25·Dest
 *
 * ⛔ Dest = 55 ET NON 0 POUR UN LIEN VERS « / » OU « /en/ ». Le 16/08/2026, les 24 liens
 *    vus par Search Console pointaient TOUS sur ces deux pages. Le PageRank ne cumule pas
 *    sur une meme cible, donc le 25e lien vers l'accueil n'apporte presque rien en
 *    referencement classique. Mais la couverture et la citation par un modele de langue,
 *    elles, cumulent. Redondant n'est pas nul.
 *
 * ⛔ Satur se calcule sur les liens externes DISTINCTS, pas sur le compte d'ancres : une
 *    page qui repete douze fois le meme lien de menu n'est pas saturee.
 */
function compP({
  profondeur_source = null, liens_externes_distincts = null,
  destination_profonde = null, url_destination = null,
  page_rendue_js = false, source = "lecture HTML de la page source",
} = {}) {
  const sm = [];

  let prof = null;
  if (profondeur_source !== null && profondeur_source !== undefined) {
    prof = profondeur_source >= 2 ? 100 : profondeur_source === 1 ? 70 : 40;
    sm.push({ nom: "profondeur", etat: "MESURE" });
  } else sm.push({ nom: "profondeur", etat: "ANGLE_MORT" });

  let sat = null;
  if (liens_externes_distincts !== null && liens_externes_distincts !== undefined) {
    sat = 100 * clamp(1 - (liens_externes_distincts - 5) / 95, 0, 1);
    sm.push({ nom: "saturation", etat: "MESURE" });
  } else sm.push({ nom: "saturation", etat: "ANGLE_MORT" });

  let dest = null;
  if (destination_profonde !== null && destination_profonde !== undefined) {
    dest = destination_profonde ? 100 : 55;
    sm.push({ nom: "destination", etat: "MESURE" });
  } else if (url_destination) {
    const chemin = (() => { try { return new URL(url_destination).pathname; } catch { return "/"; } })();
    const racine = /^\/(en|fr)?\/?$/i.test(chemin);
    dest = racine ? 55 : 100;
    sm.push({ nom: "destination", etat: "MESURE" });
  } else sm.push({ nom: "destination", etat: "ANGLE_MORT" });

  // Bornes basses non nulles : une page a AU MOINS 40 (accueil) et une destination vaut
  // AU MOINS 55 (l'accueil de la cible). Un inconnu n'a pas le droit de descendre plus
  // bas que le pire cas reellement possible.
  const c = combiner([
    morceau(0.40, prof, 40, 100),
    morceau(0.35, sat, 0, 100),
    morceau(0.25, dest, 55, 100),
  ]);
  const valeur = c.valeur;
  const min = c.min;
  const max = c.max;
  const etat = [prof, sat, dest].every((x) => x !== null) ? "MESURE" : "ANGLE_MORT";

  return composante({
    cle: "P", nom: "Profondeur et saturation", valeur, poids: POIDS_LIEN.P, etat,
    brut: {
      profondeur_source, liens_externes_distincts, destination_profonde, url_destination,
      Prof_source: prof, Satur: r2(sat), Dest: dest, page_rendue_js,
    },
    source,
    justification: [
      prof === null ? "profondeur inconnue" : `page a ${profondeur_source} segment(s) de chemin (Prof ${prof})`,
      sat === null ? "saturation inconnue" : `${liens_externes_distincts} liens externes distincts (Satur ${r2(sat)})`,
      dest === null ? "destination inconnue" : dest === 55 ? "le lien pointe sur l'accueil : redondant, pas nul" : "le lien pointe sur une page profonde",
      // ⛔ Le compte ABSOLU de liens reste valable sur une page rendue en JS, c'est le
      //    RATIO liens/texte qui ne l'est pas. Satur se calcule donc quand meme, et le
      //    drapeau dit que l'alarme ferme, elle, ne s'est pas declenchee.
      page_rendue_js ? "page rendue en JS : le ratio liens/texte est un angle mort, l'alarme ferme ne s'est pas declenchee, le compte absolu reste valable" : null,
    ].filter(Boolean).join(" · "),
    plage: valeur === null ? [min, max] : [Math.min(min, valeur), Math.max(max, valeur)],
    drapeaux: page_rendue_js ? ["ratio_liens_texte_non_calculable"] : [],
    sousMesures: sm,
  });
}

// ---------------------------------------------------------------- Transmission

export const TRANSMISSION = {
  dofollow_indexee_crawlable: 1.00,
  dofollow_non_indexee_vue_au_crawl: 0.45,
  dofollow_noindex_ou_robots: 0.05,
  sponsored: 0.15,
  ugc: 0.15,
  nofollow: 0.10,
  monte_en_js: 0.00,
  indexation_non_mesurable: 0.70,
};

/**
 * Transmission : est-ce que ce lien transmet quelque chose, et combien.
 *
 * ⛔ 0,10 ET NON 0 POUR UN NOFOLLOW. Une mention de marque correle 0,66 a 0,71 avec la
 *    citation par un modele de langue, contre 0,27 pour le Domain Rating. Un nofollow ne
 *    transmet pas d'autorite de lien, mais il EXISTE comme mention, et la mention est
 *    devenue le canal qui compte. Le mettre a zero reviendrait a noter le web de 2019.
 *
 * ⛔ 0,45 POUR « DOFOLLOW MAIS PAS ENCORE INDEXEE ». Mesure du 16/08/2026 : sur une page
 *    partenaires reelle et parfaitement crawlable, le lien etait bien present, bien
 *    dofollow, et Search Console ne le rapportait pas encore. Il existait, il etait valide,
 *    il n'etait juste pas encore vu. Zero aurait declare morte une campagne qui ne l'etait
 *    pas.
 *
 * ⛔ L'ORDRE DES TESTS EST LA REGLE. Un lien monte en JavaScript vaut 0 meme s'il est
 *    dofollow sur une page parfaite : il n'existe pas dans le HTML servi, donc il n'existe
 *    pas pour un robot qui ne rend pas la page.
 */
export function transmission({
  present_html_brut = null, genre = null, suivi = null,
  indexee = null, noindex = null, robots_txt_autorise = null,
  vue_au_crawl_public = null, page_lue = true,
} = {}) {
  if (!page_lue) {
    // ⛔ On ne devine pas un rel qu'on n'a pas lu. 0,70 est une valeur de travail, la
    //    fourchette dit la verite : ce lien peut valoir zero comme il peut tout valoir.
    return {
      valeur: 0.70, cas: "page_non_lue", etat: "ANGLE_MORT", plage: [0.00, 1.00],
      drapeaux: ["transmission_non_mesuree"], regles: [],
      justification: "la page source n'a pas ete lue : ni le rel ni l'indexabilite ne sont mesures",
    };
  }

  // Chaque fait mesure pose SA regle. Elles ne s'excluent pas : un nofollow sur une page
  // en noindex en declenche deux.
  const regles = [];
  const pose = (cas, valeur, justification, etat = "MESURE", plage = null) =>
    regles.push({ cas, valeur, justification, etat, plage: plage || [valeur, valeur] });

  if (present_html_brut === false) {
    pose("monte_en_js", TRANSMISSION.monte_en_js,
      "le lien est absent du HTML brut et n'apparait qu'apres execution du JavaScript : il ne transmet rien");
  }
  if (genre === "sponsored" || /sponsored/i.test(suivi || "")) {
    pose("sponsored", TRANSMISSION.sponsored, "rel=sponsored : le lien est declare paye");
  }
  if (genre === "ugc" || /ugc/i.test(suivi || "")) {
    pose("ugc", TRANSMISSION.ugc, "rel=ugc : contenu depose par un utilisateur");
  }
  if (genre === "nofollow" || suivi === "NOFOLLOW" || /nofollow/i.test(suivi || "")) {
    pose("nofollow", TRANSMISSION.nofollow,
      "rel=nofollow : aucune autorite transmise, mais la mention existe et la mention compte");
  }
  if (noindex === true || robots_txt_autorise === false) {
    pose("noindex_ou_robots", TRANSMISSION.dofollow_noindex_ou_robots,
      noindex === true ? "la page est en noindex" : "la page est interdite au crawl par robots.txt");
  } else if (indexee === true) {
    pose("indexee_crawlable", TRANSMISSION.dofollow_indexee_crawlable,
      "page indexee et crawlable : rien ne coupe du cote de la page");
  } else if (indexee === false && vue_au_crawl_public === true) {
    pose("non_indexee_vue_au_crawl", TRANSMISSION.dofollow_non_indexee_vue_au_crawl,
      "crawlable mais pas encore indexee : cas mesure le 16/08 sur une page partenaires reelle, le lien existe bel et bien");
  } else {
    pose("indexation_non_mesurable", TRANSMISSION.indexation_non_mesurable,
      "l'indexation de la page n'est pas mesurable depuis ici", "ANGLE_MORT",
      [TRANSMISSION.dofollow_noindex_ou_robots, TRANSMISSION.dofollow_indexee_crawlable]);
  }

  // ⛔ LA PLUS BASSE APPLICABLE L'EMPORTE, exactement comme pour le Malus. C'est ce qui
  //    donne son sens a la phrase de doctrine « un nofollow sur une page en noindex ne
  //    transmet rien » : le tableau de la specification ne nomme que « dofollow + noindex »,
  //    il ne dit pas ce que vaut un nofollow sur cette meme page. Prendre le minimum rend
  //    la table TOTALE, garde chacune de ses lignes intacte, et reste monotone : une page
  //    coupee ne peut jamais valoir plus qu'une page saine.
  const gagnante = regles.reduce((a, r) => (r.valeur < a.valeur ? r : a));
  // Une regle en angle mort ne compte comme incertitude que si elle peut encore changer
  // la reponse, c'est-a-dire si sa borne basse passe SOUS la gagnante.
  const incertaines = regles.filter((r) => r.etat === "ANGLE_MORT" && r.plage[0] < gagnante.valeur);
  const min = Math.min(...regles.map((r) => r.plage[0]));
  const max = Math.min(...regles.map((r) => r.plage[1]));
  return {
    valeur: gagnante.valeur, cas: gagnante.cas,
    etat: incertaines.length ? "ANGLE_MORT" : "MESURE",
    plage: [min, max],
    drapeaux: incertaines.map((r) => r.cas),
    regles: regles.map((r) => `${r.cas}=${r.valeur}`),
    justification: regles.length > 1
      ? `${gagnante.justification} (la plus basse l'emporte sur : ${regles.filter((r) => r !== gagnante).map((r) => `${r.cas} ${r.valeur}`).join(", ")})`
      : gagnante.justification,
  };
}

// ---------------------------------------------------------------- Malus, vente de liens

export const MALUS = {
  aucun_signal: 1.00,
  sponsoring_declare_sans_tarif: 0.70,
  // ⛔ 0,55 et non 0,20 pour un tarif public sur un site SAIN. Un annuaire qui affiche
  //    ses tarifs et fait par ailleurs un vrai travail editorial n'est pas une ferme :
  //    afficher son prix est plus honnete que le negocier par courriel. La doctrine a
  //    valide au moins une cible payante de ce type. Calibration provisoire.
  tarif_public_site_sain: 0.55,
  tarif_public_et_ferme: 0.20,
  desavoue_ou_pbn: 0.05,
};

/**
 * ⛔ DETECTION UNIQUEMENT SI LA PAGE REPOND 200. Mesure du 21/08/2026 sur un blog reel :
 *    les quatre sondes de vente de liens rendent 404, et la regex trouve quand meme le mot
 *    « Price » dans la page d'erreur, qui porte un menu et un pied de page. Conclure
 *    « ce site vend des liens » depuis une page 404 est une accusation fabriquee de toutes
 *    pieces par l'outil.
 *
 * ⛔ LA PLUS BASSE APPLICABLE L'EMPORTE, ON NE PUNIT PAS DEUX FOIS LE MEME FAIT. Et un
 *    rel=sponsored ne declenche AUCUN malus : il est deja compte dans Transmission a 0,15.
 */
export function malus({
  http = null, desavoue = false, pbn_affiche = false,
  tarif_public = false, sponsoring_declare = false, signal_ferme = false,
} = {}) {
  if (desavoue || pbn_affiche) {
    return { valeur: MALUS.desavoue_ou_pbn, cas: "desavoue_ou_pbn", etat: "MESURE",
      plage: [MALUS.desavoue_ou_pbn, MALUS.desavoue_ou_pbn], drapeaux: ["desavoue"],
      justification: desavoue ? "lien desavoue" : "reseau de sites prive assume" };
  }
  if (http !== 200) {
    return { valeur: MALUS.aucun_signal, cas: "non_mesurable", etat: "ANGLE_MORT",
      plage: [MALUS.desavoue_ou_pbn, MALUS.aucun_signal], drapeaux: ["malus_non_mesurable"],
      justification: `page non lue (HTTP ${http ?? "aucun"}) : on ne cherche pas la vente de liens dans une page d'erreur, elle y trouverait n'importe quoi` };
  }
  if (tarif_public && signal_ferme) {
    return { valeur: MALUS.tarif_public_et_ferme, cas: "tarif_public_et_ferme", etat: "MESURE",
      plage: [MALUS.tarif_public_et_ferme, MALUS.tarif_public_et_ferme], drapeaux: ["vend_des_liens", "ferme"],
      justification: "tarif public affiche ET signal de ferme sur la meme page" };
  }
  if (tarif_public) {
    return { valeur: MALUS.tarif_public_site_sain, cas: "tarif_public_site_sain", etat: "MESURE",
      plage: [MALUS.tarif_public_site_sain, MALUS.tarif_public_site_sain], drapeaux: ["vend_des_liens"],
      justification: "tarif public affiche, mais sur un site par ailleurs sain : afficher son prix n'est pas un signal de ferme" };
  }
  if (sponsoring_declare) {
    return { valeur: MALUS.sponsoring_declare_sans_tarif, cas: "sponsoring_declare_sans_tarif", etat: "MESURE",
      plage: [MALUS.sponsoring_declare_sans_tarif, MALUS.sponsoring_declare_sans_tarif], drapeaux: ["sponsoring_declare"],
      justification: "le site annonce accepter des publications sponsorisees, sans afficher de tarif" };
  }
  return { valeur: MALUS.aucun_signal, cas: "aucun_signal", etat: "MESURE",
    plage: [1, 1], drapeaux: [], justification: "aucun signal de vente de liens sur la page lue" };
}

/**
 * Traduit les signaux du detecteur de spam du socle en entrees de `malus`.
 * ⛔ On ne fabrique pas de signal : chaque correspondance est nommee, et ce que le
 *    detecteur ne sait pas voir reste faux, jamais « probablement vrai ».
 */
export function malusDepuisSpam(spam = {}, { http = null, desavoue = false } = {}) {
  const codes = new Set((spam.signaux || []).map((s) => s.code));
  const ferme = ["saturation_liens", "ratio_liens_texte", "texte_repetitif", "voisinage_hors_sujet", "page_maigre", "domaine_piratage", "hote_adresse_ip"]
    .some((c) => codes.has(c));
  return malus({
    http, desavoue,
    pbn_affiche: false,
    tarif_public: codes.has("vend_des_liens") || codes.has("tarif_a_cote_du_mot_lien"),
    sponsoring_declare: false,
    signal_ferme: ferme,
  });
}

// ---------------------------------------------------------------- classement d'un lien

/**
 * ⛔ UN SPAM NOFOLLOW NON SOLLICITE NE SE TRANSMET PAS, DONC NE SE PUNIT PAS. Tout site
 *    recoit des liens qu'il n'a pas demandes. Les compter comme toxiques ferait baisser
 *    la note d'un site qui n'a rien fait, et surtout ferait croire a un probleme la ou il
 *    n'y en a pas.
 */
export function classer(NL, transmissionValeur, affichable = true) {
  // ⛔ UN LIEN DONT LE SOCLE EST TROP FAIBLE NE SE CLASSE PAS, EXACTEMENT COMME UN DOMAINE.
  //    Sans cette ligne, un lien dont on ne connait que la profondeur ressort « UTILE »,
  //    entre dans la masse de AA, et fait monter la note du domaine sur une seule mesure.
  //    C'est le meme zero silencieux qu'ailleurs, retourne : une opinion presentee comme
  //    une mesure. Un lien NON NOTE ne compte ni comme utile, ni comme toxique : il
  //    compte comme un lien qu'il reste a qualifier, et il elargit la fourchette de AA.
  if (NL === null || !affichable) return "NON NOTE";
  if (NL >= SEUIL_UTILE) return "UTILE";
  if (NL >= SEUIL_NEUTRE) return "NEUTRE";
  return transmissionValeur >= 0.40 ? "TOXIQUE" : "NEUTRE";
}

/**
 * NOTE D'UN LIEN.
 * contexte = { cible, lien, page, site, tranco, serp_page, auteurs, spam, desavoue }
 * Chaque bloc absent devient un ANGLE_MORT nomme, jamais un zero.
 */
export function noteLien(contexte = {}) {
  const {
    cible = null, lien = {}, page = {}, site = {},
    tranco = {}, serp_page = null, auteurs = {}, spam = null, desavoue = false,
  } = contexte;

  const comps = [
    compTPage({ tranco, serp_page }),
    compC({ page: { texte: page.texte ?? null, domaine: page.domaine || site.domaine }, site }),
    compA(auteurs),
    compP({
      profondeur_source: page.profondeur ?? null,
      liens_externes_distincts: page.liens_externes_distincts ?? null,
      destination_profonde: lien.destination_profonde ?? null,
      url_destination: lien.url_destination ?? null,
      page_rendue_js: page.rendue_js ?? false,
    }),
  ];

  const tr = transmission({
    present_html_brut: lien.present_html_brut ?? null,
    genre: lien.genre ?? null,
    suivi: lien.suivi_effectif ?? lien.suivi ?? null,
    indexee: lien.indexee ?? null,
    noindex: lien.noindex ?? null,
    robots_txt_autorise: lien.robots_txt_autorise ?? null,
    vue_au_crawl_public: lien.vue_au_crawl_public ?? null,
    page_lue: page.http === 200 || (page.http == null && page.texte != null),
  });
  const ml = spam ? malusDepuisSpam(spam, { http: page.http ?? null, desavoue })
                  : malus({ http: page.http ?? null, desavoue, ...(contexte.malus || {}) });

  const base = agreger(comps);
  const NL = base.valeur === null ? null : base.valeur * tr.valeur * ml.valeur;
  const plage = [
    base.plage[0] === null ? 0 : base.plage[0] * tr.plage[0] * ml.plage[0],
    base.plage[1] === null ? 100 : base.plage[1] * tr.plage[1] * ml.plage[1],
  ];

  // socle = socle des composantes × facteur des multiplicateurs
  const mesures = [tr.etat !== "ANGLE_MORT", ml.etat !== "ANGLE_MORT"].filter(Boolean).length;
  const facteurMult = mesures === 2 ? 1.00 : mesures === 1 ? 0.80 : 0.65;
  const socle = socleComposantes(comps) * facteurMult;

  const drapeaux = [
    ...comps.flatMap((c) => c.drapeaux),
    ...tr.drapeaux, ...ml.drapeaux,
    ...(socle < SOCLE_AFFICHABLE ? ["socle_insuffisant"] : []),
  ];

  return {
    type: "lien",
    cible, url_source: lien.url_source ?? page.url ?? null, url_destination: lien.url_destination ?? null,
    domaine_source: page.domaine || site.domaine || null,
    NL: r2(NL), Base: r2(base.valeur),
    classe: classer(NL === null ? null : r2(NL), tr.valeur, socle >= SOCLE_AFFICHABLE),
    composantes: comps,
    multiplicateurs: [
      { cle: "Transmission", nom: "Transmission", valeur: tr.valeur, cas: tr.cas, etat: tr.etat,
        plage: tr.plage, justification: tr.justification, brut: lien, source: "lecture du HTML servi" },
      { cle: "Malus", nom: "Malus vente de liens", valeur: ml.valeur, cas: ml.cas, etat: ml.etat,
        plage: ml.plage, justification: ml.justification, brut: spam ? { signaux: (spam.signaux || []).map((s) => s.code), verdict: spam.verdict } : (contexte.malus || null), source: "signaux de spam mesures sur la page" },
    ],
    socle: r2(socle * 100) / 100,
    plage: [r2(plage[0]), r2(plage[1])],
    affichable: socle >= SOCLE_AFFICHABLE && NL !== null,
    drapeaux: [...new Set(drapeaux)],
    formule: VERSION,
  };
}

// ================================================================================
// NIVEAU B : LA NOTE D'UN DOMAINE
// ND = 0,32·TR + 0,26·AA + 0,17·PO + 0,15·CO + 0,10·ST
// ================================================================================

export const POIDS_DOMAINE = { TR: 0.32, AA: 0.26, PO: 0.17, CO: 0.15, ST: 0.10 };

/**
 * AA, autorite acquise. Le seul axe qui regarde les liens, et il ne compte pas des liens.
 *
 * ⛔ MASSE QUADRATIQUE : un lien a 80 vaut QUATRE fois un lien a 40, pas deux. C'est le
 *    coeur de la doctrine « le trafic d'abord, le nombre de liens ensuite » applique a
 *    l'interieur meme du profil de liens.
 * ⛔ VOLUME LOGARITHMIQUE : les dix premiers liens utiles comptent plus que les cent
 *    suivants. C'est ce qui rend l'achat de volume non rentable dans cette note.
 * ⛔ SECOND LIEN D'UN MEME DOMAINE A 0,25 : dix liens depuis un seul site ne valent pas
 *    dix sites. C'est la difference entre « domaines referents » et « liens », que Bing
 *    ne sait pas faire et que le journal garde separee.
 * ⛔ TOLERANCE DE 0,15 SUR LA TOXICITE : tout site recoit du spam qu'il n'a pas demande.
 *    La note ne reagit qu'a un MOTIF INSTALLE, jamais a un accident. C'est ce qui fait
 *    qu'un lien de ferme de plus ne bouge rien, et que cent en bougent beaucoup.
 */
export function autoriteAcquise(liens = [], {
  domaines_referents_connus = null, plancher = false,
  source = "qualification des liens (lecture HTML)",
} = {}) {
  // Un lien NON NOTE n'entre NI au numerateur NI au denominateur : il n'est pas utile, il
  // n'est pas toxique, il est a qualifier. Le compter au denominateur de la toxicite
  // ferait baisser T et donc EMBELLIRAIT la note a chaque lien qu'on n'a pas su lire.
  const notes = liens.filter((l) => l.classe && l.classe !== "NON NOTE");
  const nonNotes = liens.length - notes.length;
  const total = notes.length;
  if (!total) {
    return composante({
      cle: "AA", nom: "Autorite acquise", valeur: null, poids: POIDS_DOMAINE.AA * 100,
      etat: "ANGLE_MORT", plage: [0, 100],
      brut: { liens_connus: liens.length, liens_notes: 0, liens_non_notes: nonNotes, domaines_referents_connus },
      source,
      justification: nonNotes
        ? `${nonNotes} lien(s) lu(s) mais aucun ne reunit assez de mesures pour porter une note : rien a compter, et surtout pas zero`
        : domaines_referents_connus
          ? `${domaines_referents_connus} domaines referents connus mais AUCUN lien qualifie : la granularite domaine de Bing ne porte ni URL ni rel, on ne peut donc pas noter ces liens. Ce n'est pas zero autorite, c'est zero mesure.`
          : "aucun lien connu et aucun lien qualifie",
      drapeaux: ["profil_de_liens_non_qualifie"],
      sousMesures: [{ nom: "profil_de_liens", etat: "ANGLE_MORT" }],
    });
  }

  const utiles = notes.filter((l) => l.classe === "UTILE");
  const parDomaine = new Map();
  for (const l of utiles) {
    const d = l.domaine || l.domaine_source || "?";
    if (!parDomaine.has(d)) parDomaine.set(d, []);
    parDomaine.get(d).push(l);
  }
  let MU = 0;
  for (const [, liste] of parDomaine) {
    // Le meilleur lien du domaine porte la masse pleine. Trier evite qu'un ordre de
    // lecture arbitraire decide lequel des deux liens compte pour un quart.
    liste.sort((a, b) => b.NL - a.NL);
    liste.forEach((l, i) => { MU += Math.pow(l.NL / 100, 2) * (i === 0 ? 1 : 0.25); });
  }
  const V = 100 * Math.min(1, Math.log(1 + MU) / Math.log(1 + 25));
  const Q = utiles.length ? utiles.reduce((a, l) => a + l.NL, 0) / utiles.length : 0;

  // Un lien desavoue compte 0,25 : il n'a pas disparu, il est signale a Google.
  const nbToxiques = notes.reduce((a, l) => a + (l.classe === "TOXIQUE" ? (l.desavoue ? 0.25 : 1) : 0), 0);
  const T = nbToxiques / total;
  const Ptox = Math.pow(1 - Math.max(0, T - 0.15) / 0.85, 1.5);
  const AA = (0.45 * Q + 0.55 * V) * Ptox;

  const domainesQualifies = new Set(notes.map((l) => l.domaine || l.domaine_source || "?")).size;
  const inconnus = domaines_referents_connus === null
    ? (nonNotes ? nonNotes : null)
    : Math.max(0, domaines_referents_connus - domainesQualifies);

  let etat = "MESURE";
  let plage = [AA, AA];
  const dr = [];
  if (nonNotes) dr.push("liens_lus_mais_non_notables");
  if (inconnus === null) {
    dr.push("couverture_du_profil_non_verifiee");
    plage = [AA, 100];
    etat = "ANGLE_MORT";
  } else if (inconnus > 0) {
    // Fourchette honnete : au pire tous les liens non qualifies sont toxiques, au mieux
    // ce sont autant de liens parfaits sur autant de domaines distincts.
    const Tpire = (nbToxiques + inconnus) / (total + inconnus);
    const Ppire = Math.pow(1 - Math.max(0, Tpire - 0.15) / 0.85, 1.5);
    plage = [(0.45 * Q + 0.55 * V) * Ppire, 100];
    // Au-dela d'un cinquieme du profil non qualifie, on ne dit plus « mesure » : la part
    // manquante peut a elle seule renverser la note, la fourchette ci-dessus le montre.
    const assiette = domaines_referents_connus ?? (domainesQualifies + inconnus);
    etat = assiette > 0 && inconnus / assiette > 0.20 ? "ANGLE_MORT" : "MESURE";
    dr.push("profil_partiellement_qualifie");
  }

  // ⛔ UN PLANCHER N'EST PAS UN TOTAL, ET C'EST LE PIEGE LE PLUS SILENCIEUX DE BING.
  //    L'API rend au plus 500 domaines referents par site et annonce 500 comme total.
  //    Prendre ce 500 pour une assiette ferait conclure « profil qualifie a 100 % » a un
  //    outil qui n'en a qualifie qu'une fraction inconnue. Tant que le compte de reference
  //    est un plancher, la couverture n'est PAS mesuree, quoi qu'en dise l'arithmetique.
  if (plancher) {
    etat = "ANGLE_MORT";
    plage = [plage[0], 100];
    dr.push("compte_de_referents_est_un_plancher");
  }

  const s = (n) => (n > 1 ? "s" : "");
  return composante({
    cle: "AA", nom: "Autorite acquise", valeur: AA, poids: POIDS_DOMAINE.AA * 100, etat,
    brut: {
      liens_notes: total, liens_non_notes: nonNotes, utiles: utiles.length, toxiques: r2(nbToxiques),
      domaines_utiles: parDomaine.size, domaines_qualifies: domainesQualifies,
      domaines_referents_connus, non_qualifies: inconnus,
      MU: r2(MU), V: r2(V), Q: r2(Q), T: r2(T * 100) / 100, P_tox: r2(Ptox * 100) / 100,
    },
    source,
    justification: `${utiles.length} lien${s(utiles.length)} utile${s(utiles.length)} sur ${parDomaine.size} domaine${s(parDomaine.size)} (masse ${r2(MU)} → volume ${r2(V)}), qualite moyenne ${r2(Q)}, ${r2(nbToxiques)} toxique${s(nbToxiques)} sur ${total} note${s(total)} (${r2(T * 100)} %) → penalite ${r2(Ptox * 100) / 100}`
      + (nonNotes ? ` · ${nonNotes} lien${s(nonNotes)} lu${s(nonNotes)} mais pas assez mesure${s(nonNotes)} pour etre note${s(nonNotes)}, ni compte${s(nonNotes)} ni puni${s(nonNotes)}` : "")
      + (inconnus ? ` · ${inconnus} domaine${s(inconnus)} referent${s(inconnus)} encore a qualifier` : ""),
    plage, drapeaux: dr,
    sousMesures: [{ nom: "profil_de_liens", etat }],
  });
}

/**
 * TR, trafic. Le premier axe, celui qui pese le plus.
 *
 * ⛔ LES « VISITS » DE LA PAGE PUBLIQUE SEMRUSH S'AFFICHENT A COTE, ET N'ENTRENT PAS DANS
 *    TR. Ce sont des estimations modelisees. Les melanger a une note comparative
 *    importerait le biais du modele Semrush dans notre classement, et le classement ne
 *    dirait plus que ce que Semrush pense. Elles partent avec leur date_donnee, parce
 *    que la page servait le 21/08 une donnee du 15/07.
 */
function axeTR({ tranco = {}, serp = null, trafic_estime = null, pool = 8 } = {}) {
  const t = trDom(tranco);
  const sm = [{ nom: "tranco", etat: t.etat }];

  const aSerp = !!(serp && Array.isArray(serp.requetes) && serp.requetes.length);
  sm.push({ nom: "visibilite_pool", etat: aSerp ? "MESURE" : "ANGLE_MORT" });

  const vis = aSerp ? visibilite(serp.requetes.map((r) => r.position), pool) : null;
  const c = combiner([
    { w: 0.55, v: t.valeur, min: t.plage[0], max: t.plage[1] },
    morceau(0.45, vis ? vis.valeur : null, 0, 100),
  ]);
  const etat = aSerp && t.etat !== "ANGLE_MORT" ? "MESURE" : "ANGLE_MORT";
  const aCote = trafic_estime
    ? ` · a cote, NON compte dans la note : ${trafic_estime.visites} visites estimees par ${trafic_estime.source || "semrush_public"}, donnee du ${String(trafic_estime.date_donnee || "?").slice(0, 10)}`
    : "";
  return composante({
    cle: "TR", nom: "Trafic", valeur: c.valeur, poids: POIDS_DOMAINE.TR * 100, etat,
    brut: {
      tranco: t.brut, somme_Wp: vis ? r2(vis.somme) : null, Vis_dom: vis ? r2(vis.valeur) : null,
      Tr_dom: r2(t.valeur), requetes_mesurees: aSerp ? serp.requetes.length : 0,
      version_pool: serp?.version_pool || null,
      estimation_non_retenue: trafic_estime,
    },
    source: `${t.source} + ${aSerp ? `${serp.source || "releve de positions"} (pool ${serp.version_pool || "?"})` : "aucun releve de positions"}`,
    justification: aSerp
      ? `Tr_dom ${r2(t.valeur)} (${t.justification}) et Vis_dom ${r2(vis.valeur)} (somme des poids de position ${r2(vis.somme)} sur ${pool})${aCote}`
      : `aucune position relevee sur le pool : seul Tr_dom est connu (${r2(t.valeur)}, ${t.justification})${aCote}`,
    plage: [c.min, c.max],
    drapeaux: [...t.drapeaux, ...(aSerp ? [] : ["serp_pool_indisponible"])],
    sousMesures: sm,
  });
}

/**
 * PO, positions. PO = 100 · (3·top3 + 1,5·top10 + 0,5·top20) / (3 × N)
 * ⛔ LES TROIS TRANCHES SONT EXCLUSIVES. Comptees en cumul, une requete en position 1
 *    compterait dans les trois et le numerateur depasserait son propre plafond.
 * ⛔ N NE COMPTE QUE LES REQUETES REELLEMENT INTERROGEES. Une requete dont le releve a
 *    echoue sort du denominateur ; elle ne vaut pas « absent des resultats ».
 */
function axePO({ serp = null } = {}) {
  if (!serp || !Array.isArray(serp.requetes) || !serp.requetes.length) {
    return composante({
      cle: "PO", nom: "Positions", valeur: null, poids: POIDS_DOMAINE.PO * 100,
      etat: "ANGLE_MORT", plage: [0, 100],
      brut: { requetes_mesurees: 0, pool: serp?.version_pool || null },
      source: "releve de positions",
      justification: "aucune requete du pool n'a ete relevee : l'axe est INDISPONIBLE, son poids sort du denominateur, il ne vaut pas zero",
      drapeaux: ["serp_pool_indisponible"],
      sousMesures: [{ nom: "positions_pool", etat: "ANGLE_MORT" }],
    });
  }
  const mesurees = serp.requetes.filter((r) => r.etat !== "ANGLE_MORT");
  const N = mesurees.length;
  if (!N) {
    return composante({
      cle: "PO", nom: "Positions", valeur: null, poids: POIDS_DOMAINE.PO * 100,
      etat: "ANGLE_MORT", plage: [0, 100],
      brut: { requetes_tentees: serp.requetes.length, requetes_mesurees: 0 },
      source: serp.source || "releve de positions",
      justification: `${serp.requetes.length} requetes tentees, aucune aboutie : INDISPONIBLE, jamais zero`,
      drapeaux: ["serp_pool_en_echec"],
      sousMesures: [{ nom: "positions_pool", etat: "ANGLE_MORT" }],
    });
  }
  let t3 = 0; let t10 = 0; let t20 = 0;
  for (const r of mesurees) {
    const p = nombre(r.position);
    if (p === null || p < 1) continue;
    if (p <= 3) t3++;
    else if (p <= 10) t10++;
    else if (p <= 20) t20++;
  }
  const v = 100 * (3 * t3 + 1.5 * t10 + 0.5 * t20) / (3 * N);
  const perdues = serp.requetes.length - N;
  return composante({
    cle: "PO", nom: "Positions", valeur: v, poids: POIDS_DOMAINE.PO * 100, etat: "MESURE",
    brut: { N, top3: t3, pos_4_10: t10, pos_11_20: t20, hors_top_20: N - t3 - t10 - t20, requetes_non_relevees: perdues, version_pool: serp.version_pool || null },
    source: serp.source || "releve de positions",
    justification: `${t3} requetes en top 3, ${t10} entre 4 et 10, ${t20} entre 11 et 20, sur ${N} requetes du pool ${serp.version_pool || ""}${perdues ? ` (${perdues} requetes retirees du denominateur, releve en echec)` : ""}`,
    plage: [v, v],
    drapeaux: perdues ? ["pool_partiellement_releve"] : [],
    sousMesures: [{ nom: "positions_pool", etat: "MESURE" }],
  });
}

/**
 * CO, couverture. CO = 100 · min(1, ln(1+n)/ln(1201)) · (0,5 + 0,5·s) · (0,6 + 0,4·i)
 *   n = nombre d'URL du sitemap
 *   s = part du sitemap reellement exploitable (0 absent, 1 lu et parsable, fraction si
 *       une partie des sous-sitemaps seulement a repondu : cas mesure d'un grand site
 *       dont l'index de sitemap pointait 34 sous-sitemaps, tous a telecharger)
 *   i = part indexable de l'echantillon d'URL (ni noindex, ni interdite au crawl)
 *
 * ⛔ PLAFOND BAS A DESSEIN, A 1 200 URL. Le nombre de pages est le levier le plus faible
 *    de tout le modele (correlation 0,19). Une note qui recompenserait la masse
 *    inviterait au pSEO creux, c'est-a-dire exactement a ce que fait le concurrent qu'on
 *    regarde, et pas a ce qui marche.
 */
function axeCO({ nb_url = null, sitemap_exploitable = null, part_indexable = null, source = "sitemap", etat_nb_url = null, echantillon = null } = {}) {
  const sm = [
    { nom: "nb_url", etat: etat_nb_url || (nb_url === null ? "ANGLE_MORT" : "MESURE") },
    { nom: "sitemap", etat: sitemap_exploitable === null ? "ANGLE_MORT" : "MESURE" },
    { nom: "indexabilite", etat: part_indexable === null ? "ANGLE_MORT" : "MESURE" },
  ];
  if (nb_url === null) {
    return composante({
      cle: "CO", nom: "Couverture", valeur: null, poids: POIDS_DOMAINE.CO * 100,
      etat: "ANGLE_MORT", plage: [0, 100],
      brut: { nb_url: null, sitemap_exploitable, part_indexable }, source,
      justification: "aucun sitemap lu : le nombre de pages est inconnu. Zero URL mesuree n'est PAS zero page, et un robots.txt de 27 octets en Disallow integral suffit a rendre un tres gros site incartographiable",
      drapeaux: ["couverture_non_mesuree"], sousMesures: sm,
    });
  }
  const s = sitemap_exploitable === null ? 1 : clamp(sitemap_exploitable, 0, 1);
  const i = part_indexable === null ? 1 : clamp(part_indexable, 0, 1);
  const f = Math.min(1, Math.log(1 + nb_url) / Math.log(1 + 1200));
  const v = 100 * f * (0.5 + 0.5 * s) * (0.6 + 0.4 * i);
  const inconnus = sm.filter((m) => m.etat === "ANGLE_MORT").length;
  // Si s ou i manquent, on les a pris a 1 pour le point : la fourchette dit ce que ca
  // couterait s'ils valaient 0.
  const vmin = 100 * f * (sitemap_exploitable === null ? 0.5 : 0.5 + 0.5 * s) * (part_indexable === null ? 0.6 : 0.6 + 0.4 * i);
  return composante({
    cle: "CO", nom: "Couverture", valeur: v, poids: POIDS_DOMAINE.CO * 100,
    etat: inconnus ? "ANGLE_MORT" : "MESURE",
    brut: { nb_url, s: r2(s * 100) / 100, i: r2(i * 100) / 100, plafond: 1200, echantillon },
    source,
    justification: `${nb_url} URL au sitemap (plafond 1 200), sitemap exploitable a ${Math.round(s * 100)} %, ${Math.round(i * 100)} % d'URL indexables${echantillon ? ` sur un echantillon de ${echantillon}` : ""}`,
    plage: inconnus ? [vmin, v] : [v, v],
    drapeaux: inconnus ? ["couverture_partielle"] : [],
    sousMesures: sm,
  });
}

/**
 * ST, sante technique. 100 % mesurable, donc aucune excuse : c'est le seul axe ou un
 * angle mort signale une panne de notre collecte et pas une limite du web.
 * Bareme : racine 200 avec au plus 1 redirection 25 · TTFB 20/15/5 · poids 15/7 ·
 * robots.txt 200 declarant un Sitemap 15 · sitemap 200 et parsable 15 · certificat 10.
 */
function axeST(t = {}) {
  const items = [
    {
      nom: "racine", points: 25, connu: t.racine_http !== null && t.racine_http !== undefined,
      obtenu: t.racine_http === 200 && (t.redirections ?? 0) <= 1 ? 25 : 0,
      dit: () => `racine HTTP ${t.racine_http} avec ${t.redirections ?? "?"} redirection(s)`,
    },
    {
      nom: "ttfb", points: 20, connu: nombre(t.ttfb_ms) !== null,
      obtenu: t.ttfb_ms <= 600 ? 20 : t.ttfb_ms <= 1200 ? 15 : t.ttfb_ms <= 2500 ? 5 : 0,
      dit: () => `TTFB ${t.ttfb_ms} ms`,
    },
    {
      nom: "poids", points: 15, connu: nombre(t.poids_octets) !== null,
      obtenu: t.poids_octets <= 300 * 1024 ? 15 : t.poids_octets <= 600 * 1024 ? 7 : 0,
      dit: () => `page d'accueil ${Math.round((t.poids_octets || 0) / 1024)} Ko`,
    },
    {
      nom: "robots", points: 15, connu: t.robots_http !== null && t.robots_http !== undefined,
      obtenu: t.robots_http === 200 && t.robots_declare_sitemap === true ? 15 : 0,
      dit: () => `robots.txt HTTP ${t.robots_http}, ${t.robots_declare_sitemap ? "declare" : "ne declare pas"} de Sitemap:`,
    },
    {
      nom: "sitemap", points: 15, connu: t.sitemap_http !== null && t.sitemap_http !== undefined,
      obtenu: t.sitemap_http === 200 && t.sitemap_parsable === true ? 15 : 0,
      dit: () => `sitemap HTTP ${t.sitemap_http}, ${t.sitemap_parsable ? "parsable" : "illisible"}`,
    },
    {
      nom: "certificat", points: 10, connu: t.ssl_valide !== null && t.ssl_valide !== undefined,
      obtenu: t.ssl_valide === true ? 10 : 0,
      dit: () => `certificat ${t.ssl_valide ? "valide" : "invalide"}`,
    },
  ];
  const connus = items.filter((x) => x.connu);
  const dispo = connus.reduce((a, x) => a + x.points, 0);
  const obtenus = connus.reduce((a, x) => a + x.obtenu, 0);
  const manquants = 100 - dispo;
  const sm = items.map((x) => ({ nom: x.nom, etat: x.connu ? "MESURE" : "ANGLE_MORT" }));

  if (!dispo) {
    return composante({
      cle: "ST", nom: "Sante technique", valeur: null, poids: POIDS_DOMAINE.ST * 100,
      etat: "ANGLE_MORT", plage: [0, 100], brut: t, source: "sondes HTTP, TLS, robots.txt, sitemap",
      justification: "aucune sonde technique n'a tourne sur ce domaine",
      drapeaux: ["technique_non_mesuree"], sousMesures: sm,
    });
  }
  // Renormalisation sur les points DISPONIBLES : une sonde qui n'a pas tourne ne fait pas
  // perdre ses points, elle sort du bareme et elargit la fourchette.
  const v = 100 * obtenus / dispo;
  return composante({
    cle: "ST", nom: "Sante technique", valeur: v, poids: POIDS_DOMAINE.ST * 100,
    etat: manquants ? "ANGLE_MORT" : "MESURE",
    brut: { detail: connus.map((x) => `${x.nom} ${x.obtenu}/${x.points}`), points_obtenus: obtenus, points_disponibles: dispo },
    source: "sondes HTTP, TLS, robots.txt, sitemap",
    justification: connus.map((x) => `${x.dit()} → ${x.obtenu}/${x.points}`).join(" · ")
      + (manquants ? ` · ${manquants} points non sondes, retires du bareme` : ""),
    plage: manquants ? [obtenus, obtenus + manquants] : [v, v],
    drapeaux: manquants ? ["technique_partielle"] : [],
    sousMesures: sm,
  });
}

/**
 * NOTE D'UN DOMAINE.
 * ⛔ REFUSE DE NOTER UN SPOT. domaines.json le dit : « Le calculateur REFUSE de noter un
 *    domaine dont le role ne correspond pas a la formule appelee. » Un spot est une cible
 *    de lien, il se note en NL, pas en ND. Confondre les deux ferait comparer un annuaire
 *    a un concurrent dans la meme colonne.
 */
export function noteDomaine(contexte = {}) {
  const { domaine = null, role = null, forcer = false } = contexte;
  if (role === "spot" && !forcer) {
    throw new Error(
      `${domaine} porte le role "spot" : un spot se note en NL (note de lien), pas en ND. ` +
      `Passer { forcer: true } seulement si on sait pourquoi.`
    );
  }

  const axes = [
    axeTR({ tranco: contexte.tranco || {}, serp: contexte.serp || null, trafic_estime: contexte.trafic_estime || null }),
    autoriteAcquise(contexte.liens || [], contexte.profil || {}),
    axePO({ serp: contexte.serp || null }),
    axeCO(contexte.couverture || {}),
    axeST(contexte.technique || {}),
  ];

  const agg = agreger(axes);
  // ⛔ PAS DE FACTEUR DE MULTIPLICATEURS AU NIVEAU DOMAINE, ET C'EST VOULU. Le ND n'a pas
  //    de multiplicateur : ses cinq axes sont additifs. Transmission et Malus vivent au
  //    niveau du LIEN, ou ils degradent deja son socle ; un lien dont le socle tombe sous
  //    60 % passe NON NOTE et sort de AA, qui bascule alors en angle mort et perd son
  //    poids ici. L'incertitude est donc deja portee une fois. La compter une seconde
  //    fois en rabotant le socle du domaine punirait deux fois le meme fait, ce que la
  //    doctrine interdit explicitement pour le Malus et qui ne vaut pas moins ici.
  const socle = socleComposantes(axes);

  const drapeaux = [...new Set([
    ...axes.flatMap((a) => a.drapeaux),
    ...(socle < SOCLE_AFFICHABLE ? ["socle_insuffisant", "non_classable"] : []),
  ])];

  return {
    type: "domaine", domaine, role,
    ND: r2(agg.valeur),
    axes,
    socle: r2(socle * 100) / 100,
    plage: [r2(agg.plage[0] ?? 0), r2(agg.plage[1] ?? 100)],
    classable: socle >= SOCLE_AFFICHABLE && agg.valeur !== null,
    affichable: socle >= SOCLE_AFFICHABLE && agg.valeur !== null,
    a_cote: contexte.trafic_estime
      ? [{ libelle: "visites estimees (Semrush, hors note)", valeur: contexte.trafic_estime.visites,
           nature: "estimation", source: contexte.trafic_estime.source || "semrush_public",
           date_donnee: contexte.trafic_estime.date_donnee || null }]
      : [],
    drapeaux,
    formule: VERSION,
  };
}

// ================================================================================
// AFFICHAGE
// ================================================================================

/**
 * ⛔ SOUS 60 % DE SOCLE, LA NOTE NE S'AFFICHE PAS COMME UN NOMBRE. C'est la regle qui
 *    empeche le tableau de mentir par mise en page : un 38 fabrique a partir d'un seul
 *    axe mesure a exactement la meme allure qu'un 38 mesure sur cinq axes, et personne ne
 *    lit la colonne « socle » quand il y a un nombre a cote.
 */
export function afficherNote(n) {
  const nom = n.type === "domaine" ? "ND" : "NL";
  const socle = `socle ${Math.round(n.socle * 100)} %`;
  if (!n.affichable) {
    return `${nom} ∈ [${n.plage[0]} ; ${n.plage[1]}] · ${socle} · NON ${n.type === "domaine" ? "CLASSABLE" : "AFFICHABLE"}`;
  }
  return `${nom} ${n.type === "domaine" ? n.ND : n.NL} [${n.plage[0]} ; ${n.plage[1]}] · ${socle}`;
}

/** Le detail, une ligne par composante. C'est la seule vue qu'on relit vraiment : le
 *  nombre seul ne dit pas quoi corriger, la liste des composantes si. */
export function detail(n) {
  const lignes = [];
  const liste = n.type === "domaine" ? n.axes : [...n.composantes, ...n.multiplicateurs];
  for (const c of liste) {
    const marque = c.etat === "ANGLE_MORT" ? "▲" : c.etat === "MESURE_ABSENT" ? "·" : " ";
    const val = c.valeur === null ? "  n/a " : String(c.valeur).padStart(6);
    const poids = c.poids !== undefined ? `p${String(c.poids).padStart(3)}` : `×${c.valeur}`;
    lignes.push(`   ${marque} ${String(c.nom).padEnd(26)} ${val}  ${poids}  [${c.plage[0]} ; ${c.plage[1]}]  ${c.justification || ""}`);
  }
  return lignes.join("\n");
}

// ================================================================================
// OBSERVATIONS : ce que le recalcul depose dans le journal
// ================================================================================

function obsAxe(domaine, axe, run) {
  const angle = axe.etat === "ANGLE_MORT";
  return observation({
    type: "note", sujet: { domaine }, metrique: `axe_${axe.cle}`,
    // ⛔ Un axe en angle mort part SANS valeur. observation() leve si on essaie, et c'est
    //    voulu : le journal refuse de transporter un chiffre que le tableau n'aurait pas
    //    le droit d'afficher.
    valeur: angle ? null : axe.valeur,
    valeur_min: axe.plage[0], valeur_max: axe.plage[1], unite: "point_0_100",
    nature: angle ? "mesure_absente" : "derive",
    etat: axe.etat,
    source: { nom: "note_maison", endpoint: axe.source, http: null, methode: "calcul" },
    preuve: `${axe.nom} = ${axe.valeur ?? "n/a"} (poids ${axe.poids}) | ${axe.justification} | brut ${JSON.stringify(axe.brut).slice(0, 160)}`,
    run_id: run, collecteur: VERSION,
    drapeaux: axe.drapeaux,
  });
}

export function observationsDeNoteDomaine(n, run) {
  const obs = n.axes.map((a) => obsAxe(n.domaine, a, run));
  obs.push(observation({
    type: "note", sujet: { domaine: n.domaine }, metrique: "socle_de_mesure",
    valeur: Math.round(n.socle * 100), unite: "pourcent", nature: "derive", etat: "MESURE",
    source: { nom: "note_maison", endpoint: "socle = socle_composantes × facteur_multiplicateurs", http: null, methode: "calcul" },
    preuve: n.axes.map((a) => `${a.cle}:${Math.round(a.part_mesuree * 100)}%`).join(" "),
    run_id: run, collecteur: VERSION,
    drapeaux: n.classable ? [] : ["socle_insuffisant"],
  }));
  obs.push(observation({
    type: "note", sujet: { domaine: n.domaine }, metrique: "note_domaine",
    valeur: n.classable ? n.ND : null,
    valeur_min: n.plage[0], valeur_max: n.plage[1], unite: "point_0_100",
    nature: n.classable ? "derive" : "mesure_absente",
    etat: n.classable ? "MESURE" : "ANGLE_MORT",
    source: { nom: "note_maison", endpoint: "ND = 0,32TR + 0,26AA + 0,17PO + 0,15CO + 0,10ST", http: null, methode: "calcul" },
    preuve: n.classable
      ? `ND ${n.ND} · ` + n.axes.map((a) => `${a.cle} ${a.valeur ?? "n/a"}`).join(" · ")
      : `socle ${Math.round(n.socle * 100)} % < 60 % : la note ne s'affiche pas en nombre, seulement ND ∈ [${n.plage[0]} ; ${n.plage[1]}]. Axes en angle mort : ${n.axes.filter((a) => a.etat === "ANGLE_MORT").map((a) => a.cle).join(", ") || "aucun"}`,
    run_id: run, collecteur: VERSION,
    drapeaux: n.drapeaux,
  }));
  return obs;
}

export function observationsDeNoteLien(n, run) {
  return [observation({
    type: "note", sujet: { domaine: n.cible },
    objet: { domaine: n.domaine_source, url: n.url_source },
    metrique: "note_lien",
    valeur: n.affichable ? n.NL : null,
    valeur_min: n.plage[0], valeur_max: n.plage[1], unite: "point_0_100",
    nature: n.affichable ? "derive" : "mesure_absente",
    etat: n.affichable ? "MESURE" : "ANGLE_MORT",
    source: { nom: "note_maison", endpoint: "NL = (0,40T + 0,22C + 0,18A + 0,20P) × Transmission × Malus", http: null, methode: "calcul" },
    preuve: `${n.classe} · Base ${n.Base ?? "n/a"} × T ${n.multiplicateurs[0].valeur} (${n.multiplicateurs[0].cas}) × M ${n.multiplicateurs[1].valeur} (${n.multiplicateurs[1].cas}) · socle ${Math.round(n.socle * 100)} %`,
    run_id: run, collecteur: VERSION,
    drapeaux: [...n.drapeaux, `classe_${n.classe.toLowerCase()}`],
  })];
}

// ================================================================================
// RECALCUL DEPUIS LE JOURNAL
// ================================================================================

const trouver = (photo, f) => photo.find(f) || null;

function profondeurDe(url) {
  try { return new URL(url).pathname.split("/").filter(Boolean).length; } catch { return null; }
}

/** Reconstruit le contexte d'un domaine a partir de la photo du jour. */
export function contexteDepuisJournal(d, photo, cfg) {
  const pour = (type, metrique, src = null) => trouver(photo, (o) =>
    o.type === type && o.sujet?.domaine === d && o.metrique === metrique && (!src || o.source?.nom === src));

  const tr = pour("autorite", "tranco_rang");
  // ⛔ AUCUNE LIGNE AU JOURNAL N'EST PAS UN ECHEC DE TRANCO, C'EST UNE ABSENCE DE PASSAGE.
  //    On rend donc etat: null, que trDom lit comme « jamais interroge ». Ecrire
  //    ANGLE_MORT ici ferait dire au tableau « Tranco n'a pas repondu » pour un domaine
  //    que personne n'a jamais demande a Tranco, et enverrait chercher une panne qui
  //    n'existe pas.
  const tranco = tr
    ? { rang: tr.valeur, http: tr.source?.http ?? null, etat: tr.etat }
    : { rang: null, http: null, etat: null };

  // --- SERP : uniquement les requetes du POOL FIGE. Une requete hors pool ne se compare
  //     a rien dans le temps, elle ne doit pas entrer dans PO.
  const pool = [...(cfg.requetes?.fr || []), ...(cfg.requetes?.en || [])];
  const dansPool = new Set(pool.map((q) => q.toLowerCase()));
  const lignesSerp = photo.filter((o) =>
    // Trois noms de type pour la meme chose, et c'est un piege muet : collecte-serp ecrit
    // type:"position", d'autres sources ecrivent "requete" ou "serp". Une condition qui
    // n'en connait que deux rend l'axe PO en angle mort alors que la donnee est au
    // journal, et rien ne le signale.
    (o.type === "requete" || o.type === "serp" || o.type === "position") && o.metrique === "position" &&
    o.sujet?.domaine === d && o.sujet?.requete && dansPool.has(String(o.sujet.requete).toLowerCase()));
  const serp = lignesSerp.length
    ? {
        version_pool: cfg.requetes?.version || null,
        source: lignesSerp[0].source?.nom || "serp",
        requetes: lignesSerp.map((o) => ({ requete: o.sujet.requete, position: o.valeur, etat: o.etat })),
      }
    : null;

  // --- liens qualifies : c'est la SEULE source qui permet de noter un lien. Le compte de
  //     Bing, lui, ne porte ni URL ni rel : il sert a mesurer la COUVERTURE de la
  //     qualification, jamais a la remplacer.
  const qualifies = photo.filter((o) =>
    o.type === "backlink" && o.metrique === "lien_qualifie" && o.sujet?.domaine === d && o.etat === "MESURE");
  const liens = qualifies.map((o) => {
    const dt = o.objet?.detail || {};
    const n = noteLien({
      cible: d,
      lien: {
        url_source: dt.url_source || o.objet?.url,
        url_destination: dt.url_destination || null,
        genre: dt.genre || null,
        suivi_effectif: dt.suivi_effectif || dt.suivi || null,
        present_html_brut: true,
        noindex: dt.indexabilite?.noindex ?? null,
        robots_txt_autorise: dt.robots_txt?.autorise ?? null,
        indexee: null, vue_au_crawl_public: dt.conditions?.publique ?? null,
      },
      page: {
        domaine: o.objet?.domaine, url: dt.url_source || o.objet?.url, http: o.source?.http ?? null,
        profondeur: profondeurDe(dt.url_source || o.objet?.url || ""),
        liens_externes_distincts: dt.spam?.domaines_externes_distincts ?? null,
        rendue_js: (dt.spam?.angles || []).some((a) => a.code === "ratio_liens_texte"),
        texte: null,
      },
      site: { domaine: o.objet?.domaine, slugs: null },
      spam: dt.spam || null,
    });
    return { ...n, domaine: o.objet?.domaine, NL: n.NL, classe: n.classe, desavoue: false };
  });

  const domRef = pour("backlink", "domaines_referents", "bing_webmaster")
    || pour("autorite", "domaines_referents");

  const nbUrl = pour("couverture", "nb_url_sitemap");
  const partIx = pour("couverture", "part_url_indexables");
  const tailleIx = pour("couverture", "taille_echantillon_indexabilite");
  const robotsSm = pour("technique", "robots_declare_sitemap");
  const robotsHttp = pour("technique", "robots_http");
  const racine = pour("technique", "http_racine");
  const redir = pour("technique", "redirections");
  const ttfb = pour("technique", "ttfb_ms");
  const poids = pour("technique", "poids_page_octets");
  const ssl = pour("technique", "ssl_valide");
  const visites = pour("trafic", "visites_mensuelles");

  return {
    domaine: d,
    tranco, serp,
    liens,
    profil: {
      domaines_referents_connus: domRef && domRef.etat === "MESURE" ? domRef.valeur : null,
      // nature "plancher" = le collecteur a touche le plafond de sa source. Le nombre est
      // un minimum, jamais un total, et la note doit le savoir.
      plancher: domRef ? domRef.nature === "plancher" : false,
      source: domRef ? `${domRef.source?.nom} (${domRef.nature})` : "aucune source de profil",
    },
    couverture: {
      nb_url: nbUrl && nbUrl.etat === "MESURE" ? nbUrl.valeur : null,
      etat_nb_url: nbUrl ? nbUrl.etat : null,
      sitemap_exploitable: nbUrl && nbUrl.etat === "MESURE" ? 1 : null,
      // ⛔ part_indexable etait CODE EN DUR A null, donc l'axe CO restait en angle mort
      //    meme sur un domaine dont le sitemap etait parfaitement lu. Consequence
      //    mesuree le 21/08/2026 : aucun concurrent n'atteignait 60 % de socle, donc
      //    aucun ne se classait, donc le comparateur ne comparait rien. La donnee existe,
      //    elle est produite par collecte-indexabilite.mjs.
      part_indexable: partIx && partIx.etat === "MESURE" ? partIx.valeur : null,
      echantillon: tailleIx && tailleIx.etat === "MESURE" ? tailleIx.valeur : null,
      source: nbUrl ? nbUrl.source?.endpoint || "sitemap" : "sitemap",
    },
    technique: {
      racine_http: racine && racine.etat === "MESURE" ? racine.valeur : null,
      redirections: redir && redir.etat === "MESURE" ? redir.valeur : null,
      ttfb_ms: ttfb && ttfb.etat === "MESURE" ? ttfb.valeur : null,
      poids_octets: poids && poids.etat === "MESURE" ? poids.valeur : null,
      robots_http: robotsHttp && robotsHttp.etat === "MESURE" ? robotsHttp.valeur : null,
      robots_declare_sitemap: robotsSm && robotsSm.etat === "MESURE" ? robotsSm.valeur : null,
      sitemap_http: nbUrl && nbUrl.etat === "MESURE" ? 200 : null,
      sitemap_parsable: nbUrl && nbUrl.etat === "MESURE" ? true : null,
      ssl_valide: ssl && ssl.etat === "MESURE" ? ssl.valeur : null,
    },
    trafic_estime: visites && visites.etat === "MESURE"
      ? { visites: visites.valeur, source: visites.source?.nom || "semrush_public", date_donnee: visites.date_donnee }
      : null,
  };
}

/** Ce qu'il manque, et QUEL collecteur le remplirait. Sans ca, un tableau vide n'apprend rien. */
const QUI_REMPLIT = {
  TR: "collecte-domaine.mjs (Tranco) + un collecteur de positions",
  AA: "collecte-rel.mjs (qualification des liens : URL, rel, indexabilite)",
  PO: "un collecteur de positions sur le pool fige",
  CO: "collecte-domaine.mjs (sitemap)",
  ST: "collecte-domaine.mjs (sondes HTTP, TLS, robots, sitemap)",
};

// ================================================================================
// CONTROLES (--test) : ils tournent HORS LIGNE, sans reseau et sans journal.
// ================================================================================

function lienFactice(NL, domaine, transmissionValeur, { desavoue = false } = {}) {
  return { NL, domaine, classe: classer(NL, transmissionValeur), desavoue, drapeaux: [] };
}

/**
 * LE PROFIL DE DEPART ET SON DOMAINE.
 *
 * ⛔ LES QUATRE AUTRES AXES SONT CALCULES POUR DE VRAI, PAS INJECTES. C'est ce qui rend
 *    le controle probant : si la chaine Tranco → Tr_dom, positions → Vis_dom, sitemap → CO
 *    ou sondes → ST se casse, le controle tombe. Les entrees brutes ci-dessous ont ete
 *    choisies pour que les axes tombent sur 25 / 20 / 75 / 25, qui est le point de
 *    reference de la specification.
 */
function domaineDeControle(liens) {
  const positions = [
    ...Array.from({ length: 7 }, (_, i) => ({ requete: `q1-${i}`, position: 1, etat: "MESURE" })),
    ...Array.from({ length: 2 }, (_, i) => ({ requete: `q8-${i}`, position: 8, etat: "MESURE" })),
    ...Array.from({ length: 31 }, (_, i) => ({ requete: `qx-${i}`, position: null, etat: "MESURE_ABSENT" })),
  ];
  return {
    domaine: "controle.test", role: "concurrent",
    tranco: { rang: 100000, http: 200, etat: "MESURE" },
    serp: { version_pool: "v-controle", source: "releve de controle", requetes: positions },
    liens,
    // Tous les domaines referents connus ont ete qualifies : la couverture du profil est
    // complete, donc AA est une MESURE et pas une estimation sur un echantillon.
    profil: { domaines_referents_connus: new Set(liens.map((l) => l.domaine)).size, source: "profil de controle" },
    couverture: { nb_url: 203, sitemap_exploitable: 1, part_indexable: 1, source: "sitemap de controle", echantillon: 203 },
    technique: {
      racine_http: 200, redirections: 3, ttfb_ms: 3100, poids_octets: 920 * 1024,
      robots_http: 200, robots_declare_sitemap: false,
      sitemap_http: 200, sitemap_parsable: true, ssl_valide: true,
    },
  };
}

function controles() {
  const ok = [];
  const ko = [];
  const dire = (nom, obtenu, attendu, tolerance = 0) => {
    const bon = typeof attendu === "number"
      ? Math.abs(obtenu - attendu) <= tolerance
      : String(obtenu) === String(attendu);
    (bon ? ok : ko).push({ nom, obtenu, attendu });
    console.log(`  ${bon ? "ok  " : "ECHEC"} ${String(nom).padEnd(52)} obtenu ${String(obtenu).padStart(9)}   attendu ${attendu}`);
    return bon;
  };

  // ---- profil de depart : 30 liens, 12 UTILES a 55 sur 12 domaines, 18 NEUTRES a 22
  const depart = [
    ...Array.from({ length: 12 }, (_, i) => lienFactice(55, `utile${i}.com`, 1.00)),
    ...Array.from({ length: 18 }, (_, i) => lienFactice(22, `neutre${i}.com`, 1.00)),
  ];

  console.log("\n1. PROFIL DE DEPART  ·  30 liens, 12 utiles a 55 sur 12 domaines, 18 neutres a 22, 0 toxique\n");
  const nDepart = noteDomaine(domaineDeControle(depart));
  console.log(`   ${afficherNote(nDepart)}`);
  console.log(detail(nDepart));
  console.log("");
  const aa = nDepart.axes.find((a) => a.cle === "AA");
  dire("AA (autorite acquise)", aa.valeur, 50.62, 0.005);
  dire("ND (note de domaine)", nDepart.ND, 38.31, 0.005);
  dire("TR calcule depuis Tranco 100 000 + 7 places 1 et 2 places 8", nDepart.axes.find((a) => a.cle === "TR").valeur, 25, 0.005);
  dire("PO calcule sur un pool de 40 requetes", nDepart.axes.find((a) => a.cle === "PO").valeur, 20, 0.005);
  dire("ST calcule sur 6 sondes", nDepart.axes.find((a) => a.cle === "ST").valeur, 25, 0.005);

  // ---- les quatre pieges
  console.log("\n2. LES QUATRE PIEGES  ·  seul le profil de liens change, les quatre autres axes ne bougent pas\n");
  const cas = [
    {
      nom: "+1 lien de ferme (dofollow, indexe, donc TOXIQUE)",
      liens: [...depart, lienFactice(8, "ferme-unique.com", 1.00)],
      attendu: nDepart.ND, note: "sous la tolerance de 0,15, un accident ne fait pas un motif",
    },
    {
      nom: "+100 annuaires nofollow",
      liens: [...depart, ...Array.from({ length: 100 }, (_, i) => lienFactice(4, `annuaire${i}.com`, 0.10))],
      attendu: nDepart.ND, note: "NL < 15 mais transmission < 0,40 : NEUTRES, ni comptes ni punis",
    },
    {
      nom: "+100 bons liens (NL 60, 100 domaines)",
      liens: [...depart, ...Array.from({ length: 100 }, (_, i) => lienFactice(60, `bon${i}.com`, 1.00))],
      attendu: 46.41, note: "le volume plafonne : cent bons liens rapportent 8,10 points",
    },
    {
      nom: "+100 liens de fermes, dofollow ET indexes",
      liens: [...depart, ...Array.from({ length: 100 }, (_, i) => lienFactice(8, `ferme${i}.com`, 1.00))],
      attendu: 27.01, note: "motif installe : cent mauvais liens coutent 11,30 points",
    },
  ];
  for (const c of cas) {
    const n = noteDomaine(domaineDeControle(c.liens));
    const delta = r2(n.ND - nDepart.ND);
    dire(c.nom, n.ND, c.attendu, 0.005);
    console.log(`        ND ${n.ND}  (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})  AA ${n.axes.find((a) => a.cle === "AA").valeur}  ·  ${c.note}`);
  }

  // ⛔ L'ASYMETRIE EST VOULUE. Cent bons liens rapportent 8,10 points, cent mauvais en
  //    coutent 11,30. Acheter du volume doit couter plus cher que gagner de la qualite,
  //    sinon la note recompense exactement ce qu'elle est censee detecter.
  const gain = r2(noteDomaine(domaineDeControle(cas[2].liens)).ND - nDepart.ND);
  const perte = r2(noteDomaine(domaineDeControle(cas[3].liens)).ND - nDepart.ND);
  console.log("");
  dire("asymetrie : la perte depasse le gain", Math.abs(perte) > gain, true);

  // ---- controles complementaires : les pieges du niveau A
  console.log("\n3. CONTROLES COMPLEMENTAIRES  ·  les precautions du niveau A\n");

  const parfaite = {
    tranco: { rang: 500, http: 200, etat: "MESURE" },
    serp_page: { positions: [1, 2, 3], source: "controle" },
    page: { domaine: "exemple.com", texte: "trading journal backtest drawdown prop firm order flow mt5 tradingview forex futures spread leverage", profondeur: 3, liens_externes_distincts: 8, http: 200 },
    site: { domaine: "exemple.com", slugs: ["/blog/trading-journal/", "/blog/backtest/", "/blog/drawdown/"] },
    auteurs: { urls_editoriales: 120, auteurs_distincts: 5, identite_verifiable: true, nb_pages: 120 },
  };
  const bon = noteLien({ ...parfaite, lien: { url_destination: "https://exemple.com/fonctionnalites/journal", genre: "dofollow", suivi_effectif: "DOFOLLOW", present_html_brut: true, indexee: true, noindex: false, robots_txt_autorise: true } });
  dire("lien parfait : classe", bon.classe, "UTILE");

  // Deux regles s'appliquent : nofollow (0,10) et page en noindex (0,05). La plus basse
  // l'emporte, donc 0,05, et le lien ne transmet quasiment rien malgre une page parfaite.
  const coupe = noteLien({ ...parfaite, lien: { url_destination: "https://exemple.com/fonctionnalites/journal", genre: "nofollow", suivi_effectif: "NOFOLLOW", present_html_brut: true, noindex: true } });
  dire("nofollow sur page en noindex : transmission", coupe.multiplicateurs[0].valeur, 0.05, 0.001);
  dire("nofollow sur page en noindex : NL", coupe.NL, r2(bon.Base * 0.05), 0.01);

  const js = noteLien({ ...parfaite, lien: { url_destination: "https://exemple.com/x", genre: "dofollow", suivi_effectif: "DOFOLLOW", present_html_brut: false, indexee: true } });
  dire("lien monte en JS : NL", js.NL, 0, 0.001);
  dire("lien monte en JS : classe", js.classe, "NEUTRE");

  // ⛔ Un lien qu'on n'a pas su noter ne doit RIEN apporter a AA, ni en bien ni en mal.
  //    C'est la porte par laquelle une opinion entrerait dans la note du domaine.
  const douze = Array.from({ length: 12 }, (_, i) => lienFactice(55, `utile${i}.com`, 1.00));
  const aaSeul = autoriteAcquise(douze, { domaines_referents_connus: 12 });
  const aaPlusNonNote = autoriteAcquise(
    [...douze, { NL: null, classe: "NON NOTE", domaine: "illisible.com" }],
    { domaines_referents_connus: 12 });
  dire("un lien NON NOTE ne change pas AA", aaPlusNonNote.valeur, aaSeul.valeur, 0.001);

  // ⛔ Page non lue : Transmission ET Malus tombent, le facteur des multiplicateurs
  //    plafonne le socle a 0,65, donc la note ne s'affiche pas en nombre.
  const nonLu = noteLien({
    ...parfaite, page: { ...parfaite.page, http: 403, texte: null },
    lien: { url_destination: "https://exemple.com/fonctionnalites/journal" },
  });
  dire("page non lue : Transmission en angle mort", nonLu.multiplicateurs[0].etat, "ANGLE_MORT");
  dire("page non lue : Malus en angle mort", nonLu.multiplicateurs[1].etat, "ANGLE_MORT");
  dire("page non lue : socle plafonne a 0,65", nonLu.socle <= 0.65, true);
  dire("page non lue : classe", nonLu.classe, "NON NOTE");

  // ⛔ Le piege du 21/08, reproduit sur un domaine d'exemple de meme forme que le cas
  //    reel : le nom de marque « tradehub » CONTIENT le terme de lexique « trade », et
  //    chaque slug repete le nom de marque. Sans retrait du host, le site s'auto-valide.
  const slugsTL = ["/tradehub-partners/", "/tradehub-about/", "/tradehub-legal/", "/tradehub-careers/"];
  const sansRetrait = slugsTL.filter((s) => TERMES_L1.some((t) => normaliser(s).includes(t))).length / slugsTL.length;
  const avecRetrait = coherenceSite(slugsTL, "tradehub-exemple.com");
  dire("host NON retire : c1 (auto-validation)", sansRetrait.toFixed(4), "1.0000");
  dire("host retire : c1 tombe", avecRetrait.c1.toFixed(4), "0.0000");

  // ⛔ Tranco : {"ranks": []} est une MESURE, un 403 est un ANGLE MORT. Jamais confondus.
  dire("Tranco hors top 1M : etat", trDom({ rang: null, http: 200 }).etat, "MESURE_ABSENT");
  dire("Tranco hors top 1M : valeur", trDom({ rang: null, http: 200 }).valeur, 5);
  dire("Tranco 403 : etat", trDom({ rang: null, http: 403 }).etat, "ANGLE_MORT");
  dire("Tranco 403 : fourchette haute", trDom({ rang: null, http: 403 }).plage[1], 100);

  // ⛔ Un axe non mesure ne vaut pas zero : il sort du calcul et elargit la fourchette.
  const creux = noteDomaine({ domaine: "vide.test", role: "concurrent" });
  dire("domaine sans aucune mesure : ND", String(creux.ND), "null");
  dire("domaine sans aucune mesure : classable", creux.classable, false);
  dire("domaine sans aucune mesure : fourchette", `${creux.plage[0]}-${creux.plage[1]}`, "0-100");
  dire("domaine sans aucune mesure : affichage", afficherNote(creux).includes("NON CLASSABLE"), true);

  // ⛔ Le journal doit REFUSER de porter la valeur d'un angle mort.
  let leve = false;
  try { observation({ type: "note", metrique: "essai", etat: "ANGLE_MORT", valeur: 42 }); }
  catch { leve = true; }
  dire("le journal refuse une valeur sur un ANGLE_MORT", leve, true);

  // ⛔ Un spot ne se note pas en ND.
  let refus = false;
  try { noteDomaine({ domaine: "annuaire-exemple.fr", role: "spot" }); } catch { refus = true; }
  dire("noteDomaine refuse un domaine de role spot", refus, true);

  console.log(`\n${ok.length} controles passes, ${ko.length} en echec.\n`);
  if (ko.length) {
    console.log("Ecarts :");
    for (const k of ko) console.log(`  · ${k.nom} : obtenu ${k.obtenu}, attendu ${k.attendu}`);
  }
  return ko.length === 0;
}

// ================================================================================
// LIGNE DE COMMANDE
// ================================================================================

const { pathToFileURL } = await import("node:url");
// ⛔ process.argv[1] est ABSENT sous `node -e` et dans un worker. Sans la garde, importer
//    ce module depuis un tel contexte fait lever pathToFileURL et le module ne se charge
//    pas du tout, ce qui ressemble a une erreur de la fonction appelee et pas du chargeur.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || null;
  const DRY = process.argv.includes("--dry");

  if (process.argv.includes("--test")) {
    console.log(`Vigie SEO — controles de la note maison · ${VERSION} · lexiques ${LEXIQUES.version}`);
    process.exit(controles() ? 0 : 1);
  }

  const cfg = config();
  const demandes = arg("domaines");
  const cibles = demandes
    ? demandes.split(",").map((x) => ({ domaine: x.trim(), role: "concurrent" }))
    : [
        ...cfg.nous.map((x) => ({ ...x, role: "nous" })),
        ...cfg.concurrents.map((x) => ({ ...x, role: "concurrent" })),
      ];

  const { obs, illisibles } = lire();
  const photo = dernier(obs);
  console.log(`Vigie SEO — recalcul des notes · ${VERSION}`);
  console.log(`journal : ${obs.length} observations, ${photo.length} au dernier releve${illisibles ? `, ${illisibles} lignes illisibles` : ""}\n`);

  const run = nouveauRun("note");
  const toutes = [];
  const classables = [];

  for (const c of cibles) {
    const ctx = contexteDepuisJournal(c.domaine, photo, cfg);
    const n = noteDomaine({ ...ctx, role: c.role });
    toutes.push(...observationsDeNoteDomaine(n, run));
    for (const l of ctx.liens) toutes.push(...observationsDeNoteLien(l, run));
    if (n.classable) classables.push(n);

    console.log(`${c.domaine.padEnd(22)} ${afficherNote(n)}`);
    const manquants = n.axes.filter((a) => a.etat === "ANGLE_MORT");
    if (manquants.length) {
      console.log(`   ${manquants.length} axe(s) en angle mort : ` +
        manquants.map((a) => `${a.cle} ← ${QUI_REMPLIT[a.cle]}`).join(" · "));
    } else {
      console.log(detail(n));
    }
  }

  if (classables.length) {
    console.log("\nCLASSEMENT (seuls les domaines dont le socle atteint 60 %) :");
    classables.sort((a, b) => b.ND - a.ND)
      .forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}. ${n.domaine.padEnd(22)} ${n.ND}`));
  } else {
    console.log(`\nAUCUN domaine classable : aucun n'atteint 60 % de socle de mesure.`);
    console.log(`On ne range pas un domaine qu'on n'a pas mesure. Lancer les collecteurs manquants d'abord.`);
  }

  if (DRY) {
    console.log(`\n--dry : ${toutes.length} observations NON ecrites.`);
  } else {
    // ⛔ doublonsAutorises POUR LES NOTES. obs_id porte la journee : une note recalculee
    //    le meme jour porte le meme identifiant et l'ecriture idempotente la REJETTE.
    //    Le 21/08/2026, apres avoir obtenu les rangs Tranco manquants, le recalcul a
    //    rendu « 0 observation ecrite » et le site a continue d'afficher les notes
    //    d'avant. Une note n'est pas une mesure, c'est un calcul SUR des mesures.
    const n = ecrire(toutes, { doublonsAutorises: true });
    console.log(`\n${n} observations de note ecrites (${toutes.length} calculees, le reste etait deja au journal aujourd'hui).`);
  }
}
