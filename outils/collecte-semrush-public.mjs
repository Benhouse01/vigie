// MESURE : rien. Ce collecteur RELEVE des ESTIMATIONS de trafic, d'autorite et de mots-cles.
// SOURCE : la page publique d'apercu de Semrush, lue en simple GET, sans compte ni cle.
// NE DIT PAS : le trafic reel. L'ecart mesure avec le reel etait un facteur 24, pas 24 %.
//
// https://www.semrush.com/website/<domaine>/overview/ rend, en simple GET avec un
// User-Agent Chrome, un HTML de 350 a 440 Ko qui porte TOUT le rapport, deja calcule cote
// serveur. Aucun compte, aucune cle, aucun navigateur. C'est la source la plus riche du
// chantier et elle ne coute rien.
//
// ⛔ LES DOMAINES CITES DANS LES COMMENTAIRES SONT DES EXEMPLES, LES MESURES SONT REELLES.
//    Elles ont ete faites les 20 et 21/08/2026 sur des sites vivants, dont les noms sont
//    remplaces ici par exemple.com (le notre), concurrent-un.com (couvert par Semrush, qui
//    sert ses chiffres) et concurrent-deux.com (couvert lui aussi, mais dont Semrush
//    RETIENT les chiffres). Ce qui compte est le comportement de la source, pas l'identite
//    du site qui l'a revele.
//
// ⛔ ⛔ ⛔  RIEN DE CE QUI SORT D'ICI N'EST UNE MESURE.  ⛔ ⛔ ⛔
//    Semrush ecrit lui-meme, sur cette page, « how much traffic the website COULD get ».
//    Le 20/08/2026, sur un site dont on avait AUSSI la Search Console, les deux cotes ont
//    ete mis l'un contre l'autre : 70,4 K de visites estimees par Semrush contre 2,9 K de
//    visites REELLEMENT mesurees. Facteur 24. Ce n'est pas une imprecision, c'est un autre
//    ordre de grandeur.
//    Donc TOUTE ligne ecrite ici porte nature:"estimation" et le drapeau
//    "non_calibre_sur_le_reel". Le site n'a alors plus le droit de poser un chiffre Semrush
//    dans la meme colonne qu'un chiffre Search Console : la colonne le dira.
//
// ⛔ LA DATE DE LA DONNEE N'EST PAS LA DATE DE LA LECTURE, ET L'ECART EST GROS.
//    Chaque section porte son PROPRE displayDate. Mesure du 21/08/2026 sur
//    concurrent-un.com :
//      backlinks, visites, appareils, pays  -> 2026-07-01   (51 jours de retard)
//      mots-cles, trafic de recherche, parcours -> 2026-07-15   (37 jours)
//    Sans les deux champs, le site presenterait sept semaines de retard comme la photo du
//    jour. On lit donc le displayDate DE LA SECTION, jamais un seul pour toute la page.
//
// ⛔ UN 404 EST UNE MESURE, PAS UN ANGLE MORT. Verifie le 21/08/2026 : cinq domaines du
//    panel, dont le notre, rendent 404 (119 Ko, page « We got lost »), pendant qu'un
//    sixieme rend 200 dans la meme seconde. Ce n'est donc NI un quota NI un blocage :
//    Semrush ne couvre pas ces domaines. Le repeter en ANGLE_MORT ferait croire a une
//    panne a reparer alors que l'information est reelle et utile : « nous sommes sous le
//    radar de Semrush » est un fait de marche.
//    Le test de non-regression est dans le code, en bas : apres une salve de 404, on
//    redemande un domaine TEMOIN connu comme couvert. S'il tombe lui aussi, ce n'est plus
//    une absence, c'est un mur, et le run entier est marque a relire. Ce temoin depend de
//    votre marche, il n'est donc PAS ecrit dans ce fichier : il se donne par --temoin=, ou
//    par la cle « temoin_semrush » de la configuration. Sans lui le test ne tourne pas, et
//    le collecteur LE DIT plutot que de laisser croire qu'il a eu lieu.
//
// ⛔ LE JSON N'EST PAS DANS UN <script type="application/json">, ET LE PIEGE EST LA.
//    Le bloc <script id="sm2_initial_state" type="application/json"> existe bel et bien,
//    il fait 1,1 Ko et ne contient QUE la config de la barre de recherche et un csrfToken.
//    Un collecteur qui le trouve croit avoir gagne et rend zero metrique.
//    Les vraies donnees sont dans l'attribut props d'un <astro-island>, encode en entites
//    HTML, au format de serialisation d'Astro ou CHAQUE valeur est un couple [type, valeur].
//    D'ou deserialiser plus bas : sans elle on lit {"value":[0,12878]} et on croit que la
//    valeur est un tableau.
//
// ⛔ CE QUI COLLAPSERAIT DANS dernier(). La cle de dernier() / serie() / mouvements() est
//    (type, sujet.domaine, sujet.url, sujet.requete, objet.domaine, objet.url, metrique,
//    source). Elle ne regarde NI sujet.pays NI date_donnee. Ecrire six mois d'historique
//    sous la meme metrique, ou cinq pays sous la meme metrique, ferait donc rendre a
//    dernier() UN point au hasard parmi les six et jetterait les cinq autres en silence.
//    Regle du fichier : tout discriminant qui n'est pas dans la cle passe DANS LE NOM DE
//    LA METRIQUE, apres un @.
//      visites_mensuelles             -> le chiffre de tete, la photo du jour
//      visites_mensuelles@2026-05-01  -> le point de mai de la courbe
//      visites_pays@CH                -> la Suisse
//    Les deux familles cohabitent volontairement : serie(obs,{metrique:"visites_mensuelles"})
//    donne la courbe de NOS releves, serie(obs,{metrique:"visites_mensuelles@2026-05-01"})
//    donne les REVISIONS de mai par Semrush, qui sont une information a part entiere (il
//    revise, et un site qui affiche la derniere version sans le dire raconte une histoire
//    qui a change entre-temps).
//
// ⛔ null N'EST PAS ZERO. categoryRank.value vaut null sur concurrent-un.com : Semrush n'a
//    pas range le site dans une categorie. Ecrire 0 en ferait le premier de sa categorie.
//    Un null sert un MESURE_ABSENT. En revanche paid.value = 0 est un VRAI zero estime
//    (aucune campagne payante detectee) et se garde tel quel : c'est la seule famille de ce
//    fichier ou un zero a le droit de passer.
//
// Les cibles viennent de la configuration (config/domaines.json, ou le fichier que designe
// VIGIE_CONFIG) ou de --domaines. Aucun domaine n'est ecrit dans ce fichier.
//
// Usage :
//   node outils/collecte-semrush-public.mjs
//   node outils/collecte-semrush-public.mjs --domaines=exemple.com,concurrent-un.com --dry
//   node outils/collecte-semrush-public.mjs --roles=nous,concurrent --pause=2000
//   node outils/collecte-semrush-public.mjs --temoin=<domaine surement couvert par Semrush>

import { recuperer, recupererParRelais, UA_CHROME } from "./_lib-liens.mjs";
import { observation, ecrire, nouveauRun, config } from "./_lib-obs.mjs";

const VERSION = "collecte-semrush-public@1.0.0";
const SOURCE = "semrush_public";
const gabaritUrl = (d) => `https://www.semrush.com/website/${d}/overview/`;

// ⛔ Ces deux drapeaux partent avec CHAQUE ligne. Ils sont la seule chose qui empeche le
//    site d'afficher un chiffre Semrush a cote d'un chiffre Search Console comme si les
//    deux disaient la meme chose.
const DRAPEAUX = ["estimation_semrush", "non_calibre_sur_le_reel"];

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || null;
const DRY = process.argv.includes("--dry");
const PAUSE = Number(arg("pause") || 1200);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const cfg = config();

// ⛔ LE DOMAINE TEMOIN NE PEUT PAS ETRE ECRIT EN DUR, ET CE N'EST PAS UNE QUESTION DE
//    PROPRETE. Il sert a distinguer « Semrush ne couvre pas ce domaine » de « Semrush
//    vient de nous couper », donc il doit etre un site gros, ancien et surement couvert
//    DANS VOTRE MARCHE. Un temoin herite d'un autre secteur peut tomber pour ses propres
//    raisons et ferait declarer suspects des 404 parfaitement legitimes.
//    On le prend sur --temoin=, sinon sur la cle « temoin_semrush » de la configuration.
const TEMOIN = String(arg("temoin") || cfg.temoin_semrush || "").trim().toLowerCase() || null;

const demandes = arg("domaines");
const roles = (arg("roles") || "nous,concurrent,spot").split(",").map((s) => s.trim());
const cibles = demandes
  ? demandes.split(",").map((d) => ({ domaine: d.trim(), libelle: d.trim(), role: "demande" }))
  : [
      ...(roles.includes("nous") ? cfg.nous.map((d) => ({ ...d, role: "nous" })) : []),
      ...(roles.includes("concurrent") ? cfg.concurrents.map((d) => ({ ...d, role: "concurrent" })) : []),
      ...(roles.includes("spot") ? cfg.spots.map((d) => ({ ...d, role: "spot" })) : []),
    ];

// ------------------------------------------------------ deserialisation du format Astro
//
// Astro serialise les props de ses ilots en couples [code, valeur]. Le code dit COMMENT
// relire la valeur. On reproduit la table du client Astro, avec un defaut prudent : un
// code inconnu rend la valeur brute plutot que de faire tomber toute la collecte pour un
// champ exotique qu'on n'utilise probablement pas.
//   0 = objet ou primitive   1 = tableau de couples   2 = RegExp   3 = Date
//   4 = Map   5 = Set   6 = BigInt   7 = URL   8/9/10 = tableaux typees   11 = Infinity

const TABLE_ASTRO = {
  0: (v) => relireObjet(v),
  1: (v) => (Array.isArray(v) ? v.map(relireCouple) : v),
  2: (v) => String(v),
  3: (v) => String(v),
  4: (v) => (Array.isArray(v) ? Object.fromEntries(v.map(relireCouple)) : v),
  5: (v) => (Array.isArray(v) ? v.map(relireCouple) : v),
  6: (v) => String(v),
  7: (v) => String(v),
  8: (v) => v,
  9: (v) => v,
  10: (v) => v,
  11: (v) => Infinity * v,
};

function relireCouple(t) {
  if (!Array.isArray(t) || t.length !== 2 || typeof t[0] !== "number") return t;
  const f = TABLE_ASTRO[t[0]];
  return f ? f(t[1]) : t[1];
}

function relireObjet(brut) {
  if (typeof brut !== "object" || brut === null) return brut;
  if (Array.isArray(brut)) return brut.map(relireCouple);
  return Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, relireCouple(v)]));
}

/** Les entites HTML de l'attribut. ⛔ &amp; EN DERNIER, sinon &amp;quot; devient un guillemet
 *  et coupe le JSON en deux au milieu d'une valeur. */
function decoderEntites(s) {
  return s
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'").replace(/&#x2F;/gi, "/")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Extrait le rapport du HTML.
 * Rend { ok:false, raison, extrait } plutot que de lever : un echec de structure doit
 * devenir un ANGLE_MORT ECRIT dans le journal, pas une pile d'appels dans un terminal que
 * personne ne relira dans trois semaines.
 */
function extraireRapport(html) {
  // On ne capture pas <astro-island ...> en entier : l'attribut props fait 80 Ko et un
  // motif qui exige d'atteindre le > final devient fragile pour rien. On saute droit au
  // premier props= qui suit la balise.
  const ilots = [...html.matchAll(/<astro-island\b[\s\S]{0,400}?props="([^"]*)"/gi)].map((m) => m[1]);
  if (!ilots.length) {
    return { ok: false, raison: "aucun <astro-island props=...> dans la page", extrait: apercu(html) };
  }
  // ⛔ ON VERIFIE LA PRESENCE DE LA CLE ATTENDUE, PAS LE CODE HTTP. La page de marque
  //    porte elle aussi des ilots Astro (bandeau cookies, barre de recherche) : celui qui
  //    nous interesse est le seul a contenir displayDate.
  const porteur = ilots.find((p) => p.includes("displayDate")) || null;
  if (!porteur) {
    return {
      ok: false,
      raison: `${ilots.length} ilot(s) Astro trouve(s), aucun ne porte displayDate (page servie sans donnees)`,
      extrait: apercu(html),
    };
  }
  let brut;
  try {
    brut = JSON.parse(decoderEntites(porteur));
  } catch (e) {
    return { ok: false, raison: `props illisibles : ${String(e.message).slice(0, 80)}`, extrait: porteur.slice(0, 300) };
  }
  const props = relireObjet(brut);
  const data = props?.page?.data;
  if (!data || typeof data !== "object") {
    return { ok: false, raison: "props lues mais page.data absent", extrait: JSON.stringify(props).slice(0, 300) };
  }
  return { ok: true, data, meta: props?.page?.meta || {}, sections: Object.keys(data) };
}

const apercu = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);

// ------------------------------------------------------------------ fabrique de lignes

function fabrique({ domaine, run, endpoint, http }) {
  const commun = {
    run_id: run,
    collecteur: VERSION,
    source: { nom: SOURCE, endpoint, http, methode: "curl" },
  };

  /**
   * Une valeur SERVIE par Semrush.
   * ⛔ valeur null ou absente -> jamais zero. C'est la regle « pas de zero la ou la mesure
   *    a echoue » appliquee au cas le plus sournois : le champ EXISTE et il est simplement
   *    vide, donc rien dans le code d'appel ne fait de bruit.
   *
   * ⛔ MAIS UN null NE VEUT PAS DIRE LA MEME CHOSE SELON CE QU'IL Y A A COTE, et c'est le
   *    piege le plus cher de cette source. Mesure du 21/08/2026 sur concurrent-deux.com :
   *      backlinks.value = null, authorityScore.value = null, visits.value = null,
   *      globalRank.value = null
   *    ... et dans la MEME reponse, backlinksHistory sert 1 025 371 liens pour juin,
   *      visitsHistory sert 3 390 773 visites, categoryRank sert 15e en Investment.
   *    Semrush A la donnee. Il la RETIENT, section par section (visible:false), pour
   *    pousser a l'inscription. Ecrire MESURE_ABSENT ferait dire au site « ce domaine n'a
   *    pas d'autorite », ce qui est faux et exactement l'inverse de la verite.
   *      null + rien autour      -> MESURE_ABSENT : la source repond « je n'ai rien »
   *      null + historique servi -> ANGLE_MORT    : la source a, et elle retient
   *    Le poids sort du calcul dans les deux cas, mais le site ne raconte pas la meme
   *    histoire, et le second se rattrape (par l'historique) alors que le premier non.
   */
  const chiffre = ({
    type, metrique, valeur, unite = null, sujet = {}, objet = null,
    date_donnee = null, preuve = null, drapeaux = [], nature = "estimation",
    retenu = null,
  }) => {
    const vide =
      valeur === null || valeur === undefined ||
      (typeof valeur === "number" && !Number.isFinite(valeur));
    if (vide && retenu) {
      return observation({
        ...commun, type, sujet: { domaine, ...sujet }, objet, metrique,
        etat: "ANGLE_MORT", nature: "mesure_absente", date_donnee,
        preuve: `Semrush retient ce chiffre : ${retenu}`,
        drapeaux: [...DRAPEAUX, ...drapeaux, "retenu_par_semrush", "chercher_dans_l_historique"],
      });
    }
    if (vide) {
      return observation({
        ...commun, type, sujet: { domaine, ...sujet }, objet, metrique,
        etat: "MESURE_ABSENT", nature: "mesure_absente", date_donnee,
        preuve: preuve || "le champ existe dans le JSON Semrush mais sa valeur est nulle",
        drapeaux: [...DRAPEAUX, ...drapeaux, "valeur_nulle_pas_zero"],
      });
    }
    return observation({
      ...commun, type, sujet: { domaine, ...sujet }, objet, metrique,
      valeur, unite, etat: "MESURE", nature, date_donnee, preuve,
      drapeaux: [...DRAPEAUX, ...drapeaux],
    });
  };

  /** Une section entiere manque : on l'ECRIT, on ne la saute pas. */
  const sectionMuette = ({ type, metrique, raison, drapeaux = [] }) =>
    observation({
      ...commun, type, sujet: { domaine }, metrique,
      etat: "ANGLE_MORT", nature: "mesure_absente",
      preuve: raison,
      drapeaux: [...DRAPEAUX, ...drapeaux, "structure_de_page_inattendue"],
    });

  return { chiffre, sectionMuette };
}

// ------------------------------------------------------------------------- moisson
//
// Chaque section rend ses lignes. Une section absente du JSON n'est PAS ignoree : elle
// produit un ANGLE_MORT nomme, parce qu'une section qui disparait veut dire que Semrush a
// change sa page, et c'est exactement le jour ou un collecteur silencieux commence a
// rendre des courbes plates que plus personne ne questionne.

const SECTIONS_ATTENDUES = [
  "summary", "backlinks", "visitorEngagement", "trafficByDevice",
  "searchTraffic", "trafficByCountry", "trafficJourney", "trafficAi",
  "competitors", "keywords",
];

// Semrush code l'intention de recherche par un chiffre. Table lue dans les libelles de la
// page elle-meme (localeMessages) et recoupee sur les donnees : le nom de marque d'un
// domaine porte le code 2 (navigationnelle, on cherche CE site) et une requete de
// definition le code 1 (informationnelle). Elle n'est pas devinee.
const INTENTIONS = { 0: "commerciale", 1: "informationnelle", 2: "navigationnelle", 3: "transactionnelle" };

/** Le mois d'un point d'historique, normalise, pour le suffixe @ de la metrique. */
const mois = (d) => String(d || "").slice(0, 10) || "date-inconnue";

/** Le domaine d'une source de trafic. « google.com__Google organic » -> « google.com ». */
const hoteDeSource = (h) => String(h || "").split("__")[0].trim().toLowerCase();

/** Un point d'historique porte-t-il au moins un vrai nombre ? */
const aDesChiffres = (liste) =>
  (liste || []).some((p) => Object.values(p || {}).some((v) => typeof v === "number" && Number.isFinite(v)));

/**
 * Semrush RETIENT-IL cette section, ou n'a-t-il vraiment rien ?
 * On tranche sur ce qui est servi A COTE dans la meme reponse : un historique plein
 * derriere un chiffre de tete vide n'est pas une absence de donnee, c'est un appat.
 * Rend la raison a inscrire dans la preuve, ou null si la section est franchement muette.
 */
function retenue(section, ...historiques) {
  const aLHistoire = historiques.some(aDesChiffres);
  if (section?.visible === false) {
    return aLHistoire
      ? "section marquee visible=false alors que son propre historique est servi dans la meme reponse"
      : "section servie avec visible=false : Semrush ne la montre pas a un visiteur anonyme";
  }
  if (aLHistoire) {
    return "chiffre de tete nul alors que l historique de la meme section porte des valeurs";
  }
  return null;
}

function moissonner({ domaine, data, meta, run, endpoint, http }) {
  const { chiffre, sectionMuette } = fabrique({ domaine, run, endpoint, http });
  const obs = [];
  const presentes = new Set(Object.keys(data));

  const typeDeSection = (s) => (s === "keywords" ? "requete" : s === "backlinks" ? "autorite" : "trafic");

  // Le trafic total est calcule tot : plusieurs sections en dependent, et une section peut
  // etre vide SANS aucun indice interne alors que la cause est ailleurs dans la reponse.
  const V = data.visitorEngagement;
  const rV = retenue(V, V?.visitsHistory);
  const traficTotalRetenu = V && V.visits?.value == null && rV ? rV : null;

  for (const s of SECTIONS_ATTENDUES) {
    // Section carrement absente : Semrush a change sa page, il faut le voir tout de suite.
    if (!presentes.has(s)) {
      obs.push(sectionMuette({
        type: typeDeSection(s), metrique: `section_${s}`,
        raison: `section « ${s} » absente du JSON Semrush. Sections servies : ${[...presentes].join(", ")}`,
      }));
      continue;
    }
    // Section presente mais retenue. Une seule ligne par section, pour que le tableau de
    // bord puisse ecrire « retenu par Semrush » au lieu d'une case vide qui se lit comme
    // un zero. concurrent-deux.com le 21/08 : 5 sections sur 10 retenues d'un coup.
    if (data[s]?.visible === false) {
      obs.push(sectionMuette({
        type: typeDeSection(s), metrique: `section_${s}`,
        raison: `section « ${s} » servie avec visible=false : Semrush la retient a un visiteur anonyme. Ce n est pas une absence de donnee, c est un appat pour l inscription`,
        drapeaux: ["retenu_par_semrush"],
      }));
    }
  }

  // --------------------------------------------------------------- AUTORITE (backlinks)
  const B = data.backlinks;
  if (B) {
    const dB = B.displayDate || null;
    const rB = retenue(B, B.backlinksHistory, B.referringDomainsHistory);
    obs.push(chiffre({
      type: "autorite", metrique: "autorite_semrush", valeur: B.authorityScore?.value ?? null,
      unite: "score_0_100", date_donnee: dB, retenu: rB,
      // On prend l'AS ICI et pas dans summary : les deux servent le meme nombre, mais
      // seule cette section porte la date a laquelle il a ete calcule.
      preuve: "authorityScore, score proprietaire Semrush de 0 a 100",
    }));
    obs.push(chiffre({
      type: "autorite", metrique: "backlinks", valeur: B.backlinks?.value ?? null,
      unite: "lien", date_donnee: dB, retenu: rB,
      // ⛔ Ce compte n'est PAS comparable au compte de Bing Webmaster Tools : les deux
      //    index ne voient pas les memes liens. Le drapeau interdit au site de les
      //    additionner ou de les poser dans la meme colonne.
      drapeaux: ["index_semrush_non_comparable_a_bing"],
    }));
    obs.push(chiffre({
      type: "autorite", metrique: "domaines_referents", valeur: B.referringDomains?.value ?? null,
      unite: "domaine", date_donnee: dB, retenu: rB, drapeaux: ["index_semrush_non_comparable_a_bing"],
    }));
    if (B.googlePenaltyRisk?.value != null) {
      obs.push(chiffre({
        type: "autorite", metrique: "risque_penalite_google", valeur: String(B.googlePenaltyRisk.value),
        date_donnee: dB, preuve: `googlePenaltyRisk = ${B.googlePenaltyRisk.value}`,
        drapeaux: ["valeur_textuelle"],
      }));
    }
    // La variation servie par Semrush est un CALCUL de Semrush, pas notre soustraction :
    // nature "derive" existe dans le socle exactement pour ce cas.
    for (const [champ, cle] of [["backlinks", "backlinks"], ["referringDomains", "domaines_referents"]]) {
      const v = B[champ]?.valueDiffPercent;
      if (v == null) continue;
      obs.push(chiffre({
        type: "autorite", metrique: `${cle}_variation`, valeur: v, unite: "part",
        date_donnee: dB, nature: "derive",
        preuve: `valueDiffPercent servi par Semrush pour ${champ}, calcule par lui et non par nous`,
      }));
    }
    for (const p of B.backlinksHistory || []) {
      obs.push(chiffre({
        type: "autorite", metrique: `backlinks@${mois(p.displayDate)}`, valeur: p.backlinks ?? null,
        unite: "lien", date_donnee: p.displayDate || null, drapeaux: ["point_d_historique"],
      }));
    }
    for (const p of B.referringDomainsHistory || []) {
      obs.push(chiffre({
        type: "autorite", metrique: `domaines_referents@${mois(p.displayDate)}`, valeur: p.referringDomains ?? null,
        unite: "domaine", date_donnee: p.displayDate || null, drapeaux: ["point_d_historique"],
      }));
    }
  }

  // ------------------------------------------------------------------ AUTORITE (rangs)
  const S = data.summary;
  if (S) {
    const dS = S.actualDate || null;
    const ts = S.trafficStats || {};
    // Les trois rangs vivent dans le meme objet : si l'un est servi et l'autre nul, c'est
    // une retenue, pas une absence. concurrent-deux.com le 21/08 : globalRank null,
    // countryRank 17 139e aux Etats-Unis, categoryRank 15e dans sa categorie.
    const rangsServis = [ts.globalRank, ts.countryRank, ts.categoryRank].filter((x) => typeof x?.value === "number");
    const rS = rangsServis.length
      ? `${rangsServis.length} des 3 rangs de la section summary sont servis, celui-ci non`
      : null;
    obs.push(chiffre({
      type: "autorite", metrique: "rang_mondial", valeur: ts.globalRank?.value ?? null,
      unite: "rang", date_donnee: dS, retenu: rS,
      preuve: `base ${ts.globalRank?.database || "?"}, page revue par Semrush le ${S.dateModified || "?"}`,
    }));
    if (ts.countryRank) {
      const cc = ts.countryRank.database || S.country || "??";
      obs.push(chiffre({
        type: "autorite", metrique: `rang_pays@${cc}`, valeur: ts.countryRank.value ?? null,
        unite: "rang", sujet: { pays: cc }, date_donnee: dS, retenu: rS,
        preuve: `rang dans ${ts.countryRank.name || cc}`,
      }));
    }
    // ⛔ Le rang de categorie ne suit PAS la meme regle que les deux autres, et confondre
    //    les deux ferait mentir la moitie des lignes. Compare le 21/08/2026 :
    //      concurrent-un.com   : categoryRank = {name:null, slug:null, value:null}
    //        -> Semrush n'a range ce site dans AUCUNE categorie. Absence reelle.
    //      concurrent-deux.com : categoryRank = {name:"<une categorie>", slug:"...", value:15}
    //        -> la categorie existe et le rang est servi.
    //    Donc : categorie nommee mais rang nul = retenue ; categorie non nommee = absence.
    //    Dans les deux cas, surtout pas 0, qui en ferait le numero un de sa categorie.
    const categorieNommee = !!(ts.categoryRank?.name || ts.categoryRank?.slug);
    obs.push(chiffre({
      type: "autorite", metrique: "rang_categorie", valeur: ts.categoryRank?.value ?? null,
      unite: "rang", date_donnee: dS, retenu: categorieNommee ? rS : null,
      preuve: ts.categoryRank?.value == null
        ? "categoryRank servi avec value=null : Semrush n a pas classe ce domaine dans une categorie"
        : `${ts.categoryRank?.name || "categorie inconnue"}`,
    }));
    if ((S.categories || []).length) {
      obs.push(chiffre({
        type: "autorite", metrique: "categorie_semrush",
        valeur: S.categories.map((c) => c.name).filter(Boolean).join(" / "),
        date_donnee: dS, drapeaux: ["valeur_textuelle"],
      }));
    }
    if (S.noIndex) {
      obs.push(chiffre({
        type: "autorite", metrique: "semrush_noindex", valeur: 1, unite: "booleen", date_donnee: dS,
        preuve: "Semrush met SA PROPRE page de ce domaine en noindex : elle ne nous fera aucun lien utile",
      }));
    }
  }

  // ------------------------------------------------------------------------- TRAFIC
  if (V) {
    const dV = V.displayDate || null;
    obs.push(chiffre({
      type: "trafic", metrique: "visites_mensuelles", valeur: V.visits?.value ?? null,
      unite: "visite", date_donnee: dV, retenu: rV,
      preuve: meta?.title ? String(meta.title).slice(0, 160) : null,
    }));
    if (V.visits?.valueDiffPercent != null) {
      obs.push(chiffre({
        type: "trafic", metrique: "visites_mensuelles_variation", valeur: V.visits.valueDiffPercent,
        unite: "part", nature: "derive", date_donnee: dV,
      }));
    }
    obs.push(chiffre({ type: "trafic", metrique: "pages_par_visite", valeur: V.pagesPerVisit?.value ?? null, unite: "page", date_donnee: dV, retenu: rV }));
    obs.push(chiffre({ type: "trafic", metrique: "duree_visite", valeur: V.timeOnSite?.value ?? null, unite: "seconde", date_donnee: dV, retenu: rV }));
    obs.push(chiffre({
      type: "trafic", metrique: "taux_rebond", valeur: V.bounceRate?.value ?? null, unite: "part", date_donnee: dV, retenu: rV,
      // ⛔ Semrush sert une PART de 1 (0.3796), pas un pourcentage. Un site qui affiche la
      //    valeur brute suivie d'un signe % annonce un taux de rebond de 0,38 %.
      preuve: "bounceRate servi en part de 1, pas en pourcentage",
    }));
    for (const p of V.visitsHistory || []) {
      obs.push(chiffre({
        type: "trafic", metrique: `visites_mensuelles@${mois(p.displayDate)}`, valeur: p.visits ?? null,
        unite: "visite", date_donnee: p.displayDate || null, drapeaux: ["point_d_historique"],
      }));
    }
  }

  const A = data.trafficByDevice;
  if (A) {
    // ⛔ history est servi du plus recent au plus ancien, mais on ne PARIE pas dessus : le
    //    jour ou Semrush inverse son tri, un mois vieux de six mois deviendrait le chiffre
    //    de tete, et rien dans la sortie ne le dirait.
    const h = [...(A.history || [])].sort((x, y) => String(y.displayDate).localeCompare(String(x.displayDate)));
    const rA = retenue(A, A.history);
    if (h[0]) {
      obs.push(chiffre({
        type: "trafic", metrique: "visites_desktop", valeur: h[0].desktopVisits ?? null,
        unite: "visite", sujet: { device: "desktop" }, date_donnee: h[0].displayDate || null, retenu: rA,
      }));
      obs.push(chiffre({
        type: "trafic", metrique: "visites_mobile", valeur: h[0].mobileVisits ?? null,
        unite: "visite", sujet: { device: "mobile" }, date_donnee: h[0].displayDate || null, retenu: rA,
      }));
    }
    for (const p of h) {
      obs.push(chiffre({
        type: "trafic", metrique: `visites_desktop@${mois(p.displayDate)}`, valeur: p.desktopVisits ?? null,
        unite: "visite", sujet: { device: "desktop" }, date_donnee: p.displayDate || null, drapeaux: ["point_d_historique"],
      }));
      obs.push(chiffre({
        type: "trafic", metrique: `visites_mobile@${mois(p.displayDate)}`, valeur: p.mobileVisits ?? null,
        unite: "visite", sujet: { device: "mobile" }, date_donnee: p.displayDate || null, drapeaux: ["point_d_historique"],
      }));
    }
  }

  const R = data.searchTraffic;
  if (R) {
    const dR = R.displayDate || null;
    const rR = retenue(R, R.history);
    obs.push(chiffre({ type: "trafic", metrique: "trafic_organique", valeur: R.organic?.value ?? null, unite: "visite", date_donnee: dR, retenu: rR }));
    obs.push(chiffre({
      type: "trafic", metrique: "trafic_paye", valeur: R.paid?.value ?? null, unite: "visite", date_donnee: dR, retenu: rR,
      // ⛔ Le seul zero legitime du fichier : Semrush AFFIRME zero campagne payante, il ne
      //    rate pas la mesure. La preuve le dit pour que personne n'aille le convertir en
      //    angle mort au motif que « zero, c'est louche ».
      preuve: R.paid?.value === 0 ? "zero servi par Semrush : aucune campagne payante detectee, c est une vraie valeur" : null,
    }));
    if (R.organic?.valueDiffPercent != null) {
      obs.push(chiffre({
        type: "trafic", metrique: "trafic_organique_variation", valeur: R.organic.valueDiffPercent,
        unite: "part", nature: "derive", date_donnee: dR,
      }));
    }
    for (const p of R.history || []) {
      obs.push(chiffre({
        type: "trafic", metrique: `trafic_organique@${mois(p.displayDate)}`, valeur: p.organic ?? null,
        unite: "visite", date_donnee: p.displayDate || null, drapeaux: ["point_d_historique"],
      }));
      obs.push(chiffre({
        type: "trafic", metrique: `trafic_paye@${mois(p.displayDate)}`, valeur: p.paid ?? null,
        unite: "visite", date_donnee: p.displayDate || null, drapeaux: ["point_d_historique"],
      }));
    }
  }

  const P = data.trafficByCountry;
  if (P) {
    const dP = P.displayDate || null;
    for (const c of P.series || []) {
      const cc = c.country || "??";
      obs.push(chiffre({
        type: "trafic", metrique: `visites_pays@${cc}`, valeur: c.traffic ?? null,
        unite: "visite", sujet: { pays: cc }, date_donnee: dP,
        preuve: `${c.countryName || cc} : ${Math.round((c.desktopShare ?? 0) * 100)} % desktop, ${Math.round((c.mobileShare ?? 0) * 100)} % mobile`,
      }));
      obs.push(chiffre({
        type: "trafic", metrique: `part_trafic_pays@${cc}`, valeur: c.trafficShare ?? null,
        unite: "part", sujet: { pays: cc }, date_donnee: dP,
      }));
    }
  }

  const J = data.trafficJourney;
  if (J) {
    // Cette section porte DEUX cles de date, display_date et displayDate. Elles valaient la
    // meme chose le 21/08 ; on lit la camel d'abord et on garde l'autre en secours.
    const dJ = J.displayDate || J.display_date || null;
    for (const [sens, bloc] of [["entrant", J.in], ["sortant", J.out]]) {
      for (const it of bloc?.items || []) {
        const h = hoteDeSource(it.host);
        // ⛔ Un canal (« Direct ») n'est PAS un domaine. Le poser dans objet.domaine
        //    polluerait la liste des domaines referents que collecte-qualification va
        //    ensuite aller chercher dans OpenPageRank et Majestic : on chercherait le
        //    PageRank de « direct ».
        const estDomaine = h.includes(".");
        // ⛔ LE QUALIFICATIF APRES « __ » DOIT SURVIVRE DANS LA CLE. Semrush ecrit
        //    « google.com__Google organic » : ce double souligne existe precisement pour
        //    distinguer deux canaux d'un MEME hote, et un annonceur porte aussi une ligne
        //    payante. Les reduire tous les deux a « google.com » leur donnerait la meme
        //    cle, et depuis que ecrire() dedoublonne par obs_id, la seconde ligne serait
        //    SUPPRIMEE EN SILENCE au lieu d'etre ecrite. Aucune collision observee sur les
        //    six domaines testes le 21/08/2026, mais on ne construit pas une cle sur un
        //    echantillon quand la perte est muette.
        const canal = String(it.host || "").includes("__")
          ? String(it.host).split("__").slice(1).join("__").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
          : null;
        const metrique = estDomaine
          ? (canal ? `trafic_${sens}@${canal}` : `trafic_${sens}`)
          : `trafic_${sens}@${h || "inconnu"}`;
        obs.push(chiffre({
          type: "trafic", metrique,
          valeur: it.value ?? null, unite: "visite",
          objet: estDomaine ? { domaine: h } : null,
          date_donnee: dJ,
          preuve: `libelle Semrush « ${String(it.host).slice(0, 60)} », part ${((it.share ?? 0) * 100).toFixed(1)} %, mois precedent ${it.prevValue ?? "?"}`,
          drapeaux: estDomaine ? [] : ["canal_pas_un_domaine"],
        }));
      }
    }
  }

  const IA = data.trafficAi;
  if (IA) {
    // Le canal IA se suit a part : c'est le seul dont on sait deja qu'une de ses visites
    // n'apparaitra pas dans Search Console.
    //
    // ⛔ CETTE SECTION EST LA SEULE QUI NE PORTE AUCUN INDICE SUR ELLE-MEME. Sur
    //    concurrent-deux.com le 21/08 elle vaut {items:[], other:{traffic:{value:null}}} : ni
    //    visible, ni historique, ni libelle. Lue seule, elle se lit comme « ce site ne
    //    recoit aucune visite depuis les IA », ce qui serait une affirmation forte et
    //    fausse. La cause est A COTE : le trafic total du meme domaine est retenu, donc sa
    //    decomposition l'est aussi. On importe donc le motif du voisin plutot que de
    //    conclure a une absence. L'inference est ecrite dans la preuve, pour qu'un lecteur
    //    puisse la contester.
    const dIA = data.trafficByDevice?.displayDate || null;
    const rIA = traficTotalRetenu
      ? `le trafic total du domaine est lui-meme retenu (${traficTotalRetenu}), sa decomposition par plateforme IA l est donc aussi`
      : null;
    const part = (p) => (typeof p === "number" ? `${(p * 100).toFixed(2)} % du trafic total` : "part non servie");
    for (const it of IA.items || []) {
      const h = hoteDeSource(it.id || it.name);
      obs.push(chiffre({
        type: "trafic", metrique: "trafic_ia", valeur: it.traffic?.value ?? null,
        unite: "visite", objet: { domaine: h }, date_donnee: dIA, retenu: rIA,
        preuve: `${it.name || h} : ${part(it.traffic?.share)}`,
      }));
      for (const p of it.traffic?.history || []) {
        obs.push(chiffre({
          type: "trafic", metrique: `trafic_ia@${mois(p.date)}`, valeur: p.value ?? null,
          unite: "visite", objet: { domaine: h }, date_donnee: p.date || null, drapeaux: ["point_d_historique"],
        }));
      }
    }
    if (IA.other?.traffic) {
      obs.push(chiffre({
        type: "trafic", metrique: "trafic_hors_ia", valeur: IA.other.traffic.value ?? null,
        unite: "visite", date_donnee: dIA, retenu: rIA,
        // ⛔ Pas de `?? 0` ici : une part nulle affichee « 0.00 % » se lirait comme un zero
        //    mesure alors que Semrush n'a rien servi du tout.
        preuve: part(IA.other.traffic.share),
      }));
    }
    if (!(IA.items || []).length && !rIA) {
      obs.push(chiffre({
        type: "trafic", metrique: "plateformes_ia_citantes", valeur: 0, unite: "plateforme", date_donnee: dIA,
        // Ici le zero est LEGITIME : la section est servie, elle n'est pas retenue, et elle
        // dit qu'aucune plateforme IA n'envoie assez de trafic pour etre listee.
        preuve: "items servi et vide, sans retenue detectee : aucune plateforme IA listee par Semrush",
      }));
    }
  }

  const C = data.competitors;
  if (C) {
    const dC = C.displayDate || null;
    for (const it of C.items || []) {
      const h = hoteDeSource(it.slug || it.name);
      obs.push(chiffre({
        type: "trafic", metrique: "concurrent_visites", valeur: it.visits ?? null,
        unite: "visite", objet: { domaine: h }, date_donnee: dC,
        // Le concurrent est DESIGNE PAR SEMRUSH, pas par domaines.json. Les deux listes
        // divergent et c'est interessant : Semrush voit des voisins qu'on n'a pas listes.
        preuve: `concurrent designe par Semrush pour ${domaine}, hors liste domaines.json`,
      }));
      obs.push(chiffre({
        type: "trafic", metrique: "concurrent_pertinence", valeur: it.relevance ?? null,
        unite: "part", objet: { domaine: h }, date_donnee: dC,
      }));
    }
  }

  // ----------------------------------------------------------------------- REQUETES
  const K = data.keywords;
  if (K) {
    const dK = K.displayDate || null;
    const pays = K.country || null;
    for (const k of K.series || []) {
      const sujet = { requete: k.keyword, pays };
      const codes = String(k.intents ?? "").match(/\d/g) || [];
      const dr = codes.map((i) => `intention:${INTENTIONS[Number(i)] || `code_${i}`}`);
      obs.push(chiffre({
        type: "requete", metrique: "position", valeur: k.position ?? null, unite: "rang",
        sujet, date_donnee: dK, drapeaux: dr,
        // ⛔ Ce pool de mots-cles est CHOISI PAR SEMRUSH (les 5 qui rapportent le plus au
        //    domaine), il n'est PAS le pool fige de domaines.json. Melanger les deux dans
        //    un meme graphe de positions ferait bouger la courbe parce que le pool a
        //    bouge, pas parce que le classement a bouge.
        preuve: `mot-cle choisi par Semrush (top 5 par trafic), base ${pays || "?"}, pool mouvant`,
      }));
      obs.push(chiffre({
        type: "requete", metrique: "volume_recherche", valeur: k.searchVolume ?? null,
        unite: "recherche_par_mois", sujet, date_donnee: dK, drapeaux: dr,
      }));
      obs.push(chiffre({
        type: "requete", metrique: "cpc", valeur: k.cpc ?? null, unite: "USD", sujet, date_donnee: dK, drapeaux: dr,
      }));
      obs.push(chiffre({
        type: "requete", metrique: "part_trafic_requete", valeur: k.traffic ?? null, unite: "part",
        sujet, date_donnee: dK, drapeaux: dr,
        preuve: "part du trafic organique du domaine apportee par cette requete",
      }));
    }
  }

  return obs;
}

// --------------------------------------------------------------------------- lecture

function ligneSeule({ domaine, run, endpoint, http, etat, preuve, drapeaux }) {
  return observation({
    run_id: run, collecteur: VERSION,
    type: "trafic", sujet: { domaine }, metrique: "rapport_semrush",
    etat, nature: "mesure_absente",
    source: { nom: SOURCE, endpoint, http, methode: "curl" },
    preuve, drapeaux: [...DRAPEAUX, ...drapeaux],
  });
}

async function lire(domaine, run) {
  const url = gabaritUrl(domaine);
  const endpoint = `/website/${domaine}/overview/`;
  const r = await recuperer(url, { ua: UA_CHROME, timeout: 25000 });

  // --- aucune reponse : reseau, DNS, delai depasse.
  if (!r.ok) {
    const relais = await recupererParRelais(url);
    return {
      etat: "ANGLE_MORT", http: null,
      obs: [ligneSeule({
        domaine, run, endpoint, http: null, etat: "ANGLE_MORT",
        preuve: `aucune reponse (${r.erreur}). Second essai r.jina.ai : ${relais.ok ? `HTTP ${relais.http}, ${relais.octets} o` : relais.erreur}`,
        drapeaux: ["pas_de_reponse"],
      })],
    };
  }

  // --- 404 : MESURE, pas angle mort. Semrush ne couvre pas ce domaine.
  if (r.http === 404) {
    return {
      etat: "MESURE_ABSENT", http: 404,
      obs: [ligneSeule({
        domaine, run, endpoint, http: 404, etat: "MESURE_ABSENT",
        preuve: `404, domaine hors couverture Semrush (page « We got lost », ${r.octets} o, aucun ilot de donnees)`,
        drapeaux: ["hors_couverture_semrush"],
      })],
    };
  }

  // --- 403, 429, 5xx : un mur, jamais une absence.
  if (r.http !== 200) {
    const relais = await recupererParRelais(url);
    return {
      etat: "ANGLE_MORT", http: r.http,
      obs: [ligneSeule({
        domaine, run, endpoint, http: r.http, etat: "ANGLE_MORT",
        preuve: `HTTP ${r.http}. Second essai r.jina.ai : ${relais.ok ? `HTTP ${relais.http}, ${relais.octets} o` : relais.erreur}`,
        drapeaux: [r.http === 429 ? "quota_ou_cadence" : "mur"],
      })],
    };
  }

  // --- 200 : reste a verifier que la page porte VRAIMENT le rapport.
  const rap = extraireRapport(r.html);
  if (!rap.ok) {
    // ⛔ Un HTTP 200 ne prouve pas qu'une donnee existe. Le second essai par r.jina.ai ne
    //    peut PAS recuperer les props (le relais rend du markdown, il perd les attributs) :
    //    il sert uniquement a trancher « mur anti-robot » contre « page reellement vide ».
    //    On ne fabrique JAMAIS une valeur a partir de lui.
    const relais = await recupererParRelais(url);
    const parle = relais.ok && relais.html.toLowerCase().includes(domaine.toLowerCase());
    return {
      etat: "ANGLE_MORT", http: 200,
      obs: [ligneSeule({
        domaine, run, endpoint, http: 200, etat: "ANGLE_MORT",
        preuve: `structure de page inattendue : ${rap.raison} | ${r.octets} o servis | relais r.jina.ai : ${relais.ok ? (parle ? "la page parle bien du domaine" : "page sans mention du domaine") : relais.erreur} | extrait : ${rap.extrait}`,
        drapeaux: ["structure_de_page_inattendue"],
      })],
    };
  }

  return {
    etat: "MESURE", http: 200, sections: rap.sections,
    obs: moissonner({ domaine, data: rap.data, meta: rap.meta, run, endpoint, http: 200 }),
  };
}

// --------------------------------------------------------------- filet anti-collision
//
// ⛔ DEPUIS LE 21/08/2026, ecrire() DEDOUBLONNE PAR obs_id ET NE DIT RIEN. C'est une bonne
//    chose (relancer une collecte deux fois dans la journee n'ajoute plus 6 000 lignes
//    inutiles), mais ca change la nature d'une erreur de cle : deux observations DIFFERENTES
//    qui tombent sur la meme empreinte ne provoquent plus un doublon visible, elles
//    provoquent une DISPARITION silencieuse. Or l'empreinte ignore sujet.pays, sujet.device
//    et date_donnee : c'est tout l'interet des suffixes @ de ce fichier, et c'est aussi ce
//    qui casse le jour ou une source ajoute une ligne qu'on n'avait pas prevue.
//    Ce controle ne corrige rien, il REFUSE de laisser passer sans le dire.
function verifierCollisions(liste) {
  const vus = new Map();
  const collisions = [];
  for (const o of liste) {
    const p = vus.get(o.obs_id);
    if (p) collisions.push([p, o]);
    else vus.set(o.obs_id, o);
  }
  if (!collisions.length) return true;
  console.error(`\n⛔ ${collisions.length} COLLISION(S) D EMPREINTE DANS CE LOT.`);
  console.error("   Deux observations distinctes partagent la meme cle : la seconde serait");
  console.error("   effacee sans bruit par ecrire(). Il manque un discriminant dans la metrique.");
  for (const [a, b] of collisions.slice(0, 8)) {
    console.error(`   ${a.sujet.domaine} · ${a.metrique} · ${a.valeur} contre ${b.valeur} (${b.preuve || ""})`.slice(0, 200));
  }
  return false;
}

// ------------------------------------------------------------------------- execution

const run = nouveauRun("semrush");
console.log(`Vigie SEO — page publique Semrush · ${cibles.length} domaine(s) · run ${run}`);
console.log("⛔ tout ce qui suit est une ESTIMATION, pas une mesure (ecart x24 constate le 20/08/2026)\n");

const toutes = [];
const compte = { MESURE: 0, MESURE_ABSENT: 0, ANGLE_MORT: 0 };

for (const c of cibles) {
  process.stdout.write(`  ${c.domaine.padEnd(24)} … `);
  let r;
  try {
    r = await lire(c.domaine, run);
  } catch (e) {
    console.log(`ECHEC INATTENDU : ${String(e.message).slice(0, 140)}`);
    continue;
  }
  compte[r.etat]++;
  toutes.push(...r.obs);

  if (r.etat === "MESURE") {
    const v = r.obs.find((o) => o.metrique === "visites_mensuelles");
    const a = r.obs.find((o) => o.metrique === "autorite_semrush");
    const d = r.obs.find((o) => o.metrique === "domaines_referents");
    const frais = v?.fraicheur_jours ?? a?.fraicheur_jours;
    const retenus = r.obs.filter((o) => o.drapeaux.includes("retenu_par_semrush")).length;
    const rattrapes = r.obs.filter((o) => o.etat === "MESURE" && o.drapeaux.includes("point_d_historique")).length;
    console.log(
      `${String(r.obs.length).padStart(3)} obs · visites ~${v?.valeur ?? "n/a"} · AS ${a?.valeur ?? "n/a"} · ` +
      `dom.ref ${d?.valeur ?? "n/a"} · donnee du ${v?.date_donnee || a?.date_donnee || "?"} (${frais ?? "?"} j de retard)` +
      // Quand Semrush retient les chiffres de tete, la seule chose qui sauve le domaine est
      // son historique. On l'affiche pour que l'operateur voie tout de suite si le
      // rattrapage a marche ou si le domaine est reellement muet.
      (retenus ? ` · ⚠ ${retenus} retenus par Semrush, ${rattrapes} valeurs rattrapees dans l historique` : "")
    );
  } else if (r.etat === "MESURE_ABSENT") {
    console.log("404 · hors couverture Semrush (MESURE_ABSENT, pas un zero)");
  } else {
    console.log(`▲ ANGLE MORT · ${String(r.obs[0]?.preuve || "").slice(0, 120)}`);
  }
  await dormir(PAUSE);
}

// ⛔ TEST DE NON-REGRESSION. Une salve de 404 peut vouloir dire deux choses opposees :
//    « ces domaines ne sont pas couverts » ou « Semrush vient de nous couper ». On tranche
//    en redemandant un domaine temoin connu comme couvert. Sans ce test, une coupure se
//    lirait dans le journal comme la disparition pure et simple de nos concurrents.
if (compte.MESURE_ABSENT > 0 && TEMOIN && !cibles.some((c) => c.domaine === TEMOIN)) {
  const t = await recuperer(gabaritUrl(TEMOIN), { ua: UA_CHROME, timeout: 25000 });
  const vivant = t.ok && t.http === 200 && t.html.includes("displayDate");
  console.log(
    `\n  temoin ${TEMOIN} : HTTP ${t.http} ` +
    (vivant ? "avec donnees → les 404 sont bien des absences de couverture"
            : "SANS donnees → les 404 de ce run sont suspects")
  );
  if (!vivant) {
    toutes.push(ligneSeule({
      domaine: TEMOIN, run, endpoint: `/website/${TEMOIN}/overview/`, http: t.http, etat: "ANGLE_MORT",
      preuve: `le domaine temoin ne rend plus de donnees (HTTP ${t.http}) : les MESURE_ABSENT de ce run viennent peut-etre d un blocage et non d une absence de couverture`,
      drapeaux: ["temoin_tombe", "run_a_relire"],
    }));
  }
} else if (compte.MESURE_ABSENT > 0 && !TEMOIN) {
  // ⛔ PAS DE TEMOIN, PAS DE TEST, ET SURTOUT PAS DE SILENCE. Sans temoin on ne peut pas
  //    trancher entre « ces domaines ne sont pas couverts » et « Semrush vient de nous
  //    couper », et ne rien dire reviendrait a presenter la premiere lecture comme
  //    acquise. Les lignes MESURE_ABSENT restent ecrites, elles ne sont juste pas
  //    corroborees.
  console.log(
    `\n  ${compte.MESURE_ABSENT} domaine(s) en 404 et AUCUN temoin configure : le test de` +
    ` non-regression n a pas eu lieu.\n  Ces 404 se lisent comme des absences de couverture,` +
    ` sans preuve que Semrush repondait encore.\n  Passe --temoin=<domaine surement couvert>,` +
    ` ou ajoute « temoin_semrush » a ta configuration.`
  );
}

console.log(
  `\n${compte.MESURE} domaine(s) mesures · ${compte.MESURE_ABSENT} hors couverture · ${compte.ANGLE_MORT} angle(s) mort(s)`
);

const cleSaine = verifierCollisions(toutes);

if (DRY) {
  const parEtat = toutes.reduce((a, o) => ((a[o.etat] = (a[o.etat] || 0) + 1), a), {});
  console.log(`--dry : ${toutes.length} observations NON ecrites. Etats : ${JSON.stringify(parEtat)}`);

  // ⛔ On liste TOUTES les lignes qui ne sont pas une mesure, avec leur motif. C'est le
  //    seul moyen de verifier a l'oeil qu'aucun trou n'a ete rempli par un zero, et c'est
  //    la premiere chose a relire quand un chiffre du tableau de bord parait faux.
  const trous = toutes.filter((o) => o.etat !== "MESURE");
  if (trous.length) {
    console.log(`\n  ${trous.length} ligne(s) sans valeur, et pourquoi :`);
    for (const o of trous) {
      console.log(
        `   ${o.etat.padEnd(13)} ${String(o.sujet.domaine).padEnd(16)} ${String(o.metrique).padEnd(24)} ${String(o.preuve || "").slice(0, 96)}`
      );
    }
  }
  const echantillon = [
    toutes.find((o) => o.metrique === "visites_mensuelles" && o.etat === "MESURE"),
    toutes.find((o) => o.type === "requete"),
  ].filter(Boolean);
  console.log("\n  deux lignes completes, pour montrer la forme :");
  console.log(JSON.stringify(echantillon, null, 1));
} else if (!cleSaine) {
  // On n'ecrit RIEN plutot que d'ecrire un lot dont une partie sera avalee en silence.
  console.error("\nRien n a ete ecrit : corriger les cles avant de relancer.");
  process.exitCode = 1;
} else {
  const n = ecrire(toutes);
  console.log(
    `${n} observations ecrites` +
    (n < toutes.length
      ? ` (${toutes.length - n} deja presentes aujourd hui, ecartees par le dedoublonnage du socle).`
      : ".")
  );
}
