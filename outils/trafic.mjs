// ESTIMATION DE TRAFIC. Le module qui a le droit de dire un chiffre qu'il n'a pas mesure,
// a la condition de ne jamais le presenter comme une mesure.
//
// ⛔ ⛔ ⛔  LA REGLE DE FOND, ELLE EST LE PRODUIT.  ⛔ ⛔ ⛔
//    Sans donnees de navigation achetees a un panel, le trafic d'un concurrent NE SE
//    MESURE PAS. Il se MODELISE : volume de recherche estime x taux de clic moyen de
//    l'industrie x multiplicateur de type de SERP. Chacun des trois facteurs est lui-meme
//    un modele. Le resultat s'affiche donc TOUJOURS avec sa methode et son incertitude,
//    et JAMAIS dans la meme colonne qu'un chiffre releve.
//
// ⛔ LE PIEGE A NE PAS REPRODUIRE, ET IL A UNE DATE ET UN FACTEUR.
//    Mesure du 20/08/2026 sur un site reel : Semrush affichait 70,4 K de « trafic
//    organique » pendant que le site mesurait 2,9 K de visites reelles. Facteur 24.
//    Le premier nombre est un modele calcule depuis les mots-cles positionnes, le second
//    est un releve. Les deux portaient le meme libelle, dans la meme unite, avec la meme
//    police. C'est le libelle qui a menti, pas le calcul.
//    Tout ce fichier est ecrit contre cette confusion : le libelle sort d'ici avec le
//    chiffre, il n'est pas laisse a l'affichage.
//
// ⛔ CE MODULE EST SEPARE DE LA NOTE, ET LA NOTE NE CONSOMME JAMAIS SA SORTIE.
//    Deux modules, deux ecrans. Une note est censee se comparer dans le temps et entre
//    domaines ; y injecter un nombre modelise ferait bouger la note quand la COURBE
//    PUBLIQUE change d'edition, pas quand le domaine change. Garantie mecanique plutot
//    que promesse : les observations sortent d'ici sous un type a elles (« estimation »,
//    voir TYPE_OBS) et portent le drapeau « interdit_dans_la_note ». Le module de note
//    importe EXCLU_DE_LA_NOTE et filtre dessus, il n'a pas a connaitre ce fichier.
//
// ⛔ LE MOT « TRAFIC ORGANIQUE » EST INTERDIT SUR LE TOTAL, et l'interdiction est
//    executee par verifierLibelle(), qui LEVE. Raison : une page en position 1 sur une
//    requete suivie est aussi classee dans le top 10 sur des centaines de requetes qu'on
//    ne suit pas. Notre total est donc un PLANCHER sur un pool fige, pas un trafic.
//    Le libelle impose est « clics estimes sur les N requetes suivies », avec le N DEDANS
//    et une fleche ↑ qui dit que le vrai chiffre est au-dessus.
//
// CE QU'IL Y A DANS CE FICHIER :
//   1. TROIS courbes de taux de clic, chacune datee, sourcee, avec sa methode et ses trous.
//   2. Une interpolation LOG-LOG entre positions entieres.
//   3. Des multiplicateurs de type de SERP EN FOURCHETTE, avec plancher de produit a 0,20.
//   4. Le volume EN FOURCHETTE, ramene au centre par la MOYENNE GEOMETRIQUE.
//   5. Une propagation d'incertitude LOG-NORMALE, en quadrature.
//   6. Une agregation au domaine qui porte son libelle et son sens de lecture.
//   7. Une phrase prete a afficher qui dit ce que le chiffre vaut et ce qu'il ne vaut pas.
//
// Usage :
//   node outils/trafic.mjs --test            calcul complet hors ligne, sur 3 exemples
//   node outils/trafic.mjs --sources         les trois courbes, leurs URL et leurs trous
//   node outils/trafic.mjs --domaine=exemple.com           lit le journal, n'ecrit rien
//   node outils/trafic.mjs --domaine=exemple.com --ecrire  ecrit les observations

import { observation, ecrire, nouveauRun, config, lire, dernier } from "./_lib-obs.mjs";

const VERSION = "trafic@1.0.0";

// ⛔ Un type d'observation A PART, et ce n'est pas cosmetique. Ecrire ces lignes sous
//    type:"trafic" les poserait dans le meme tableau que visites_mensuelles de Semrush et
//    que les clics reels de Search Console. Le type est la seule barriere qu'un futur
//    ecran ne peut pas oublier de poser.
export const TYPE_OBS = "estimation";

// -----------------------------------------------------------------------------------
// 0. LE VOCABULAIRE STATISTIQUE, POSE UNE FOIS
// -----------------------------------------------------------------------------------
//
// Tout le calcul est MULTIPLICATIF : clics = volume x taux x multiplicateur. Une erreur
// s'y exprime donc en FACTEUR (« a un facteur 3 pres »), pas en points. On travaille en
// log-normal : sigma est l'ecart-type du LOGARITHME de la valeur.
//
// ⛔ UNE FOURCHETTE PUBLIEE SE LIT COMME UN INTERVALLE A 90 %, PAS COMME UN MINIMUM ET UN
//    MAXIMUM ABSOLUS. Personne ne publie de bornes dures. z = 1,645 est le quantile a 95 %
//    d'une loi normale centree reduite, donc [centre/exp(1,645 s), centre x exp(1,645 s)]
//    couvre 90 %. Prendre z = 3 (« bornes dures ») diviserait sigma par deux et ferait
//    afficher une precision que les sources ne donnent pas.
export const Z90 = 1.645;

/** Ecart-type du log deduit d'une fourchette lue comme un intervalle a 90 %. */
export const sigmaDeFourchette = (min, max) => Math.log(max / min) / (2 * Z90);

/**
 * Moyenne geometrique. C'est LA valeur centrale d'une fourchette multiplicative.
 *
 * ⛔ LE PIEGE CHIFFRE, IL COUTE 74 % DES LE PREMIER CALCUL. Sur un palier « 100 - 1 K » :
 *      moyenne geometrique = racine(100 x 1000) = 316
 *      moyenne arithmetique = (100 + 1000) / 2  = 550
 *    Soit 74 % de surestimation, sur le tout premier facteur, avant meme le taux de clic.
 *    Et l'erreur se compose : cinq requetes en paliers, et le total est deja faux d'un
 *    facteur qui ressemble a une croissance.
 */
export const moyenneGeometrique = (a, b) => Math.sqrt(a * b);

const fr = (n, d = 0) =>
  n == null || !Number.isFinite(n) ? "n/a" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Une position s'ecrit 15 quand elle est entiere et 4,2 quand elle ne l'est pas. */
const enPosition = (p) => (Number.isInteger(p) ? String(p) : fr(p, 1));

// -----------------------------------------------------------------------------------
// 1. LES TROIS COURBES DE TAUX DE CLIC
// -----------------------------------------------------------------------------------
//
// Elles ne mesurent PAS la meme chose, et c'est exactement pour ca qu'il en faut trois :
//
//   clickstream        : toutes les SERP confondues, y compris navigationnelles, y compris
//                        celles ou personne ne clique. Denominateur le plus large donc taux
//                        les plus BAS. seoClarity, position 1 aux Etats-Unis : 9,13 %.
//   panel Search Console : uniquement les sites qui ont un compte, uniquement les requetes
//                        ou ils apparaissent. Biais de selection assume par l'auteur.
//                        Backlinko, position 1 : 27,6 %.
//   SERP propre        : meta-analyse recalee sur des pages de resultats peu encombrees.
//                        FirstPageSage, position 1 : 39,8 %.
//
// ⛔ 9,13 % ET 39,8 % DECRIVENT LA MEME POSITION 1. Facteur 4,4. Choisir une courbe sans le
//    dire, c'est choisir son resultat. Le module rend donc le CENTRE des trois et prend
//    LEUR DESACCORD comme incertitude : c'est la seule facon honnete de s'en servir, et
//    ce desaccord domine tout le reste du calcul (voir --test).
//
// ⛔ COURBE VOLONTAIREMENT ABSENTE : ADVANCED WEB RANKING. Ses valeurs absolues vivent
//    derriere une iframe JavaScript et le rapport public ne publie que des DELTAS mois par
//    mois. Coder une courbe AWR reviendrait a reconstruire des absolus a partir de
//    variations, donc a inventer. On ne la met pas.
//
// ⛔ AUCUNE DES TROIS N'A DE COURBE FRANCAISE. seoClarity segmente cinq pays (US, UK,
//    Canada, Inde, Japon), Backlinko et FirstPageSage ne segmentent pas du tout. Le marche
//    FR est donc un TROU DE SOURCE, pas un zero : il se paie en incertitude en plus
//    (ecartPays(), calcule sur l'ecart REEL entre les cinq pays de la meme etude), jamais
//    en courbe inventee.

export const COURBES = {
  // ---------------------------------------------------------------- 1. clickstream
  clickstream_seoclarity_2021: {
    id: "clickstream_seoclarity_2021",
    libelle: "Clickstream, toutes SERP confondues",
    famille: "clickstream",
    source: {
      nom: "seoClarity",
      titre: "2021 seoClarity CTR Study",
      auteurs: "Mitul Gandhi (seoClarity) et Darren Kingman (Root Digital)",
      url: "https://www.seoclarity.net/hubfs/2021%20CTR%20Study%20-%20Full%20Report%20-%20Final.pdf",
    },
    // Fenetre de 30 jours arretee en mai 2021, choisie par les auteurs pour coller au
    // paysage publicitaire du moment. C'est la donnee la plus VIEILLE des trois et la
    // plus GROSSE : 750 milliards d'impressions, 30 milliards de clics, 17 milliards de
    // mots-cles, 200 To de clickstream Google.
    date_donnee: "2021-05-31",
    echantillon: "750+ Md d impressions, 30+ Md de clics, 17+ Md de mots-cles",
    methode:
      "clickstream : toutes les SERP vues par le panel, y compris celles sans aucun clic. " +
      "Denominateur le plus large des trois, donc taux les plus bas.",
    variante_par_defaut: "us",
    variantes: {
      // Tableau « CTR by Country (All devices) », positions 1 a 20. C'est le SEUL des
      // trois jeux de donnees qui va au-dela de la position 10.
      us: { libelle: "Etats-Unis, tous appareils", pays: "US", positions: parPosition([9.13, 5.07, 3.60, 2.61, 1.95, 1.46, 1.10, 0.93, 0.75, 0.66, 0.63, 0.58, 0.43, 0.44, 0.45, 0.53, 0.60, 0.75, 0.88, 0.93]) },
      uk: { libelle: "Royaume-Uni, tous appareils", pays: "GB", positions: parPosition([10.48, 6.05, 4.49, 3.15, 2.54, 1.96, 1.55, 1.32, 1.10, 0.98, 0.91, 0.74, 0.59, 0.64, 0.73, 0.90, 1.07, 1.29, 1.36, 1.47]) },
      ca: { libelle: "Canada, tous appareils", pays: "CA", positions: parPosition([11.30, 5.93, 4.29, 3.31, 2.64, 1.95, 1.50, 1.27, 1.03, 0.95, 0.89, 0.86, 0.61, 0.64, 0.77, 0.92, 1.10, 1.25, 1.34, 1.39]) },
      in: { libelle: "Inde, tous appareils", pays: "IN", positions: parPosition([14.88, 8.22, 4.79, 3.10, 2.09, 1.52, 1.10, 0.95, 0.77, 0.70, 0.57, 0.50, 0.36, 0.41, 0.45, 0.63, 0.83, 1.14, 1.27, 1.34]) },
      jp: { libelle: "Japon, tous appareils", pays: "JP", positions: parPosition([13.94, 7.52, 4.68, 3.91, 2.98, 2.42, 2.06, 1.78, 1.46, 1.32, 1.03, 1.00, 1.07, 1.34, 1.65, 2.19, 2.54, 2.83, 2.91, 2.85]) },
      // Modeles globaux desktop et mobile, positions 1 a 10 seulement.
      // ⛔ Ces deux-la ne se melangent PAS aux cinq du dessus : le tableau pays est
      //    « tous appareils », donc reprendre desktop pour la position 3 et le tableau US
      //    pour la position 4 fabriquerait une courbe qui n'existe dans aucune etude.
      desktop: { libelle: "Modele global, ordinateur", pays: null, positions: parPosition([8.17, 3.82, 2.43, 1.63, 1.11, 0.84, 0.67, 0.54, 0.52, 0.44]) },
      mobile: { libelle: "Modele global, mobile", pays: null, positions: parPosition([6.74, 3.41, 2.50, 1.71, 1.18, 0.89, 0.75, 0.64, 0.55, 0.48]) },
    },
    notes: [
      "La remontee des positions 17 a 20 au-dessus des positions 11 a 16 est dans les cinq pays, " +
        "les auteurs l attribuent au comportement de scroll en fin de page. Ce n est pas une erreur de saisie, " +
        "et l interpolation log-log la conserve puisqu on n interpole qu entre deux entiers VOISINS.",
      "Aux Etats-Unis, 27,26 % des recherches finissent sur un clic dans le top 10 et 33,48 % au bout de la page 2. " +
        "Les deux tiers restants ne cliquent nulle part : c est ce que le denominateur clickstream inclut et que le panel Search Console exclut.",
      "Aucune courbe France. Les cinq pays servis sont US, UK, Canada, Inde, Japon.",
    ],
    drapeaux: ["courbe_2021_paysage_serp_anterieur_aux_apercus_ia"],
  },

  // ---------------------------------------------------------------- 2. panel GSC
  panel_gsc_backlinko_2025: {
    id: "panel_gsc_backlinko_2025",
    libelle: "Panel Search Console agrege",
    famille: "panel_search_console",
    source: {
      nom: "Backlinko",
      titre: "We Analyzed 4 Million Google Search Results",
      url: "https://backlinko.com/google-ctr-stats",
    },
    date_donnee: "2025-04-16",
    echantillon: "~4 M de resultats, 1 312 881 pages, 12 166 560 requetes, comptes Search Console via Semrush",
    methode:
      "agregation de comptes Search Console : ne voit que des sites qui ont un compte, et " +
      "seulement les requetes ou ils apparaissent. Biais de selection assume par l auteur.",
    variante_par_defaut: "toutes",
    variantes: {
      toutes: {
        libelle: "Toutes requetes",
        // ⛔ LA COURBE COMPLETE N'EXISTE QUE DANS UNE IMAGE. Le texte de l'article ne
        //    publie que la position 1. Les positions 2 et 3 se DEDUISENT du total top 3
        //    publie a cote, et la deduction se verifie a la decimale :
        //        27,6 + 15,8 + 11,0 = 54,4  = « the top 3 results get 54,4 % of all clicks »
        //    Une seule combinaison de valeurs citees ailleurs tombe juste, c'est ce qui
        //    autorise a coder 15,8 et 11,0. Avec 15,7 la somme fait 54,3 et ne tombe pas.
        // ⛔ LES POSITIONS 4 A 9 N'ONT AUCUNE VALEUR PUBLIEE ET NE SONT PAS INVENTEES.
        //    Elles restent des TROUS : tauxDeClic() les interpole entre 3 et 10 et marque
        //    le resultat « interpole_sur_trou ». Un trou interpole n'est pas une mesure et
        //    ne doit pas s'afficher comme telle.
        positions: { 1: 27.6, 2: 15.8, 3: 11.0, 10: 2.76 },
        origine: {
          1: "publie en clair dans le texte de l article",
          2: "deduit du total top 3 publie (27,6 + 15,8 + 11,0 = 54,4)",
          3: "deduit du total top 3 publie (27,6 + 15,8 + 11,0 = 54,4)",
          10: "derive de « searchers are 10x more likely to click the #1 result than #10 » : 27,6 / 10",
        },
        natures: { 1: "mesure", 2: "derive", 3: "derive", 10: "derive" },
      },
    },
    notes: [
      "Positions 4 a 9 : aucune valeur publiee hors de l image du graphique. Ce sont des trous declares.",
      "Positions 11 a 20 : hors couverture. L article donne 0,63 % de clics pour TOUTE la page 2, " +
        "ce qui est une part de recherches et non un taux de clic par position : ce chiffre n est donc PAS repris ici.",
      "Position 1 a 27,6 % contre 31,7 % en 2022 chez le meme auteur, sur une methode comparable.",
    ],
    drapeaux: ["courbe_incomplete_trous_declares"],
  },

  // ---------------------------------------------------------------- 3. SERP propre
  serp_propre_firstpagesage_2025: {
    id: "serp_propre_firstpagesage_2025",
    libelle: "SERP propre, sans encombrement",
    famille: "serp_propre",
    source: {
      nom: "First Page Sage",
      titre: "Google Click-Through Rates (CTRs) by Ranking Position",
      url: "https://firstpagesage.com/reports/google-click-through-rates-ctrs-by-ranking-position/",
    },
    // ⛔ LA DATE CODEE EST CELLE QUE LA PAGE IMPRIME, PAS CELLE QU'ON ATTENDAIT.
    //    Le titre de la page annonce « in 2026 » et la commande de ce chantier annoncait
    //    une edition 2025-12. Releve du 21/08/2026 : la page imprime « Last Updated:
    //    May 28, 2025 ». On code le 28/05/2025 et le module affiche la fraicheur reelle.
    //    Un titre d'annee n'est pas une date de donnee, c'est du referencement.
    date_donnee: "2025-05-28",
    echantillon: null,
    methode:
      "meta-analyse de plusieurs sources, recalee sur des pages de resultats peu encombrees. " +
      "Taille d echantillon NON publiee, methode NON detaillee.",
    variante_par_defaut: "toutes",
    variantes: {
      toutes: {
        libelle: "Toutes requetes",
        positions: parPosition([39.8, 18.7, 10.2, 7.2, 5.1, 4.4, 3.0, 2.1, 1.9, 1.6]),
      },
    },
    notes: [
      "Verification interne : 39,8 + 18,7 + 10,2 = 68,7, ce qui est exactement le total top 3 que la page publie ailleurs.",
      "Positions 11 a 20 : hors couverture, la page s arrete a 10.",
      "C est la courbe la plus HAUTE des trois, de loin. Elle decrit une page de resultats propre, " +
        "c est-a-dire de moins en moins la page moyenne.",
    ],
    drapeaux: ["echantillon_non_publie", "methode_non_detaillee"],
  },
};

/** Un tableau [pos1, pos2, ...] devient { 1: x, 2: y, ... }. */
function parPosition(tableau) {
  const o = {};
  tableau.forEach((v, i) => { o[i + 1] = v; });
  return o;
}

/** Les trois courbes, dans l'ordre ou elles s'affichent. */
export const TROIS_COURBES = [
  "clickstream_seoclarity_2021",
  "panel_gsc_backlinko_2025",
  "serp_propre_firstpagesage_2025",
];

export function courbe(id) {
  const c = COURBES[id];
  if (!c) throw new Error(`courbe inconnue : ${id}. Connues : ${Object.keys(COURBES).join(", ")}`);
  return c;
}

function variante(id, nomVariante = null) {
  const c = courbe(id);
  const v = c.variantes[nomVariante || c.variante_par_defaut];
  if (!v) throw new Error(`variante inconnue pour ${id} : ${nomVariante}. Connues : ${Object.keys(c.variantes).join(", ")}`);
  return v;
}

/** Positions reellement servies par une courbe, triees. */
function positionsServies(id, nomVariante) {
  return Object.keys(variante(id, nomVariante).positions).map(Number).sort((a, b) => a - b);
}

// -----------------------------------------------------------------------------------
// 2. INTERPOLATION LOG-LOG
// -----------------------------------------------------------------------------------
//
// Une courbe de taux de clic est une loi de puissance : elle est une droite dans un
// repere log-log, pas dans un repere lineaire. Deux consequences pratiques :
//
//   1. Une interpolation LINEAIRE entre la position 1 (39,8 %) et la position 2 (18,7 %)
//      donnerait 29,25 % a la position 1,5. La log-log donne racine(39,8 x 18,7) = 27,3 %.
//      L'ecart est de 7 % sur un seul intervalle, et il est systematiquement dans le sens
//      de la surestimation, comme la moyenne arithmetique plus haut.
//   2. Une position moyenne Search Console est fractionnaire par construction (4,2 veut
//      dire « parfois 3, parfois 6 »). Interpoler est donc le cas NORMAL, pas le cas rare.

function interpolerLogLog(position, ancres) {
  // ancres : [[p, v], ...] triees, valeurs > 0
  const exact = ancres.find(([p]) => p === position);
  if (exact) return { valeur: exact[1], mode: "tabule", bas: exact[0], haut: exact[0] };
  const bas = [...ancres].reverse().find(([p]) => p < position);
  const haut = ancres.find(([p]) => p > position);
  if (!bas || !haut) return null;
  const t = (Math.log(position) - Math.log(bas[0])) / (Math.log(haut[0]) - Math.log(bas[0]));
  const valeur = Math.exp(Math.log(bas[1]) + t * (Math.log(haut[1]) - Math.log(bas[1])));
  // Un trou est un intervalle d'ancres NON adjacentes : entre la 3 et la 10 chez Backlinko.
  const mode = haut[0] - bas[0] === 1 ? "interpole" : "interpole_sur_trou";
  return { valeur, mode, bas: bas[0], haut: haut[0] };
}

/**
 * Taux de clic d'UNE courbe a une position donnee, en pourcent.
 *
 * ⛔ AU-DELA DE LA DERNIERE POSITION SERVIE, ON REND null, PAS ZERO ET PAS UNE
 *    EXTRAPOLATION. Une position 24 rapporte des clics, personne ne sait combien. Une
 *    extrapolation de loi de puissance donnerait un chiffre credible et faux, et il
 *    entrerait dans un total sans aucun drapeau. C'est exactement le zero silencieux du
 *    magasin d'observations, deguise en courbe.
 */
export function tauxDeClic(position, { courbe: id, variante: nomVariante = null } = {}) {
  if (!(position >= 1)) throw new Error(`position invalide : ${position}`);
  const v = variante(id, nomVariante);
  const servies = positionsServies(id, nomVariante);
  const nomV = nomVariante || courbe(id).variante_par_defaut;
  const base = {
    courbe: id, variante: nomV, position,
    couverture_max: servies[servies.length - 1],
  };
  if (position > servies[servies.length - 1]) {
    return {
      ...base, pourcent: null, taux: null, mode: "hors_couverture", nature: "mesure_absente",
      raison: `la courbe ${id} (${nomV}) s arrete a la position ${servies[servies.length - 1]}`,
    };
  }
  const ancres = servies.map((p) => [p, v.positions[p]]);
  const r = interpolerLogLog(position, ancres);
  if (!r) return { ...base, pourcent: null, taux: null, mode: "hors_couverture", nature: "mesure_absente", raison: "aucune ancre encadrante" };
  const naturePubliee = v.natures?.[position] || null;
  return {
    ...base,
    pourcent: r.valeur,
    taux: r.valeur / 100,
    mode: r.mode,
    nature: r.mode === "tabule" ? (naturePubliee || "mesure") : "estimation",
    ancres: [r.bas, r.haut],
    origine: v.origine?.[position] || null,
  };
}

// -----------------------------------------------------------------------------------
// 3. LE DESACCORD ENTRE LES COURBES, MESURE ET NON DECRETE
// -----------------------------------------------------------------------------------
//
// Deux constantes du module sont CALCULEES au chargement a partir des courbes elles-memes,
// au lieu d'etre posees a la main. Un chiffre pose a la main se demode en silence quand une
// courbe est mise a jour ; un chiffre calcule suit.

/** Ecart max/min entre les courbes disponibles a une position. */
function desaccordA(position, ids = TROIS_COURBES) {
  const vals = ids
    .map((id) => tauxDeClic(position, { courbe: id }))
    .filter((r) => r.pourcent != null)
    .map((r) => r.pourcent);
  if (vals.length < 2) return null;
  return Math.max(...vals) / Math.min(...vals);
}

/**
 * Facteur de desaccord TYPIQUE, mesure la ou au moins deux courbes se recouvrent.
 * Sert de fourchette par defaut quand UNE SEULE courbe couvre une position (11 a 20) :
 * la, le desaccord n'est pas observable, et le declarer nul reviendrait a dire que la
 * seule courbe restante est devenue exacte parce que les autres se sont tues.
 */
export const FACTEUR_DESACCORD_TYPIQUE = (() => {
  const r = [];
  for (let p = 1; p <= 20; p++) {
    const d = desaccordA(p);
    if (d) r.push(Math.log(d));
  }
  return r.length ? Math.exp(r.reduce((a, b) => a + b, 0) / r.length) : 3;
})();

/**
 * Ecart entre pays A LA MEME POSITION, dans la MEME etude (seoClarity, cinq pays).
 * C'est le prix mesure de l'absence de courbe francaise : a la position 1, de 9,13 % aux
 * Etats-Unis a 14,88 % en Inde, soit un facteur 1,63. On ne fabrique pas de courbe FR,
 * on paie ce facteur en incertitude supplementaire.
 */
export function ecartPays(position) {
  const vs = ["us", "uk", "ca", "in", "jp"]
    .map((v) => tauxDeClic(position, { courbe: "clickstream_seoclarity_2021", variante: v }))
    .filter((r) => r.pourcent != null)
    .map((r) => r.pourcent);
  if (vs.length < 2) return null;
  const min = Math.min(...vs), max = Math.max(...vs);
  return { min, max, facteur: max / min };
}

/** Les marches couverts par au moins une courbe. Tout le reste paie ecartPays(). */
export const PAYS_COUVERTS = new Set(["US", "GB", "CA", "IN", "JP"]);

/**
 * Le taux de clic retenu : centre des trois courbes, incertitude = leur desaccord.
 *
 * ⛔ LA MOYENNE GEOMETRIQUE DES TROIS N'EST PAS UNE MESURE. Les trois ne mesurent pas la
 *    meme grandeur (voir le bloc COURBES). Leur centre est un PARI pose au milieu de leur
 *    desaccord, et c'est le desaccord, pas le pari, qui est l'information utile : a la
 *    position 1 il vaut un facteur 4,4, ce qui ecrase toutes les autres sources d'erreur
 *    du calcul. Le module l'affiche pour cette raison.
 */
export function tauxRetenu(position, { courbes = TROIS_COURBES, variantes = {} } = {}) {
  const parCourbe = {};
  const dispo = [];
  const drapeaux = [];
  for (const id of courbes) {
    const r = tauxDeClic(position, { courbe: id, variante: variantes[id] || null });
    parCourbe[id] = r;
    if (r.pourcent != null) dispo.push(r);
    if (r.mode === "interpole_sur_trou") drapeaux.push(`trou_interpole:${id}`);
  }
  if (!dispo.length) {
    return {
      position, pourcent: null, taux: null, sigma: null, etat: "ANGLE_MORT",
      parCourbe, drapeaux: ["position_hors_couverture_des_trois_courbes"],
      raison: `aucune des ${courbes.length} courbes ne couvre la position ${position}`,
    };
  }
  const vals = dispo.map((r) => r.pourcent);
  const centre = Math.exp(vals.reduce((a, v) => a + Math.log(v), 0) / vals.length);
  let min = Math.min(...vals), max = Math.max(...vals), sigma;
  // ⛔ fourchette_observee dit si les bornes viennent de courbes PUBLIEES ou d'un defaut.
  //    Sans ce drapeau, la phrase affichee ecrirait « les courbes publiees vont de 0,24 %
  //    a 0,86 % » alors qu'une seule courbe publie 0,45 % et que les deux bornes sortent
  //    de notre facteur par defaut. Ce serait exactement le genre de phrase que ce module
  //    existe pour empecher, et sur son propre ecran.
  let fourchette_observee = true;
  if (dispo.length >= 2) {
    sigma = sigmaDeFourchette(min, max);
  } else {
    // Une seule courbe : on applique le desaccord TYPIQUE mesure ailleurs, centre sur elle.
    const f = Math.sqrt(FACTEUR_DESACCORD_TYPIQUE);
    min = centre / f; max = centre * f;
    sigma = sigmaDeFourchette(min, max);
    fourchette_observee = false;
    drapeaux.push("une_seule_courbe_couvre_cette_position");
  }
  return {
    position, pourcent: centre, taux: centre / 100,
    min_pourcent: min, max_pourcent: max, facteur_desaccord: max / min,
    fourchette_observee,
    sigma, etat: "MESURE", nombre_de_courbes: dispo.length, parCourbe, drapeaux,
  };
}

// -----------------------------------------------------------------------------------
// 4. MULTIPLICATEURS DE TYPE DE SERP
// -----------------------------------------------------------------------------------
//
// ⛔ TOUS EN FOURCHETTE, SANS EXCEPTION, PARCE QUE LES ETUDES SE CONTREDISENT FRONTALEMENT.
//    Sur l'apercu IA, quatre sources publiees donnent, pour la meme question :
//      Ahrefs, decembre 2025, 300 000 requetes    : jusqu a -58 % sur le premier resultat
//      Ahrefs, mars 2025,     300 000 requetes    : -34,5 %
//      Pew Research, juillet 2025, 900 panelistes : 8 % de visites avec clic contre 15 %
//                                                   sans apercu, soit -47 %
//      First Page Sage, mai 2025                  : 38,9 % avec apercu contre 39,8 % sans,
//                                                   soit -2 %
//    Un multiplicateur unique ici serait un choix d'auteur deguise en donnee. La fourchette
//    dit la verite : entre « ca ne change presque rien » et « ca coupe plus de la moitie ».

export const MULTIPLICATEURS_SERP = {
  apercu_ia: {
    libelle: "Apercu IA (AI Overview) present",
    min: 0.42, max: 0.98,
    sources: [
      "Ahrefs, donnees de decembre 2025 sur 300 000 requetes : jusqu a -58 % de clics sur le premier resultat, -50,8 % en 2e, -46,4 % en 3e (https://ahrefs.com/blog/ai-overviews-reduce-clicks/)",
      "Pew Research Center, juillet 2025, navigation reelle de 900 adultes en mars 2025 : clic sur un resultat classique dans 8 % des visites avec apercu contre 15 % sans (https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/)",
      "First Page Sage, mai 2025 : position 1 a 38,9 % avec apercu contre 39,8 % sans, soit -2 % seulement",
    ],
  },
  extrait_optimise_pas_nous: {
    libelle: "Extrait optimise present, et ce n est pas nous qui l occupons",
    min: 0.65, max: 1.00,
    sources: [
      "Ahrefs, etude de 2 millions d extraits optimises : le premier resultat organique passe de 26 % a 19,6 % de taux de clic quand un extrait est present, soit x0,754 ; l extrait lui-meme capte 8,6 % (https://ahrefs.com/blog/featured-snippets-study/)",
      "First Page Sage : la position 2 MONTE a 27,4 % sous un extrait contre 18,7 % sans, d ou une borne haute a 1,00 et pas en dessous",
    ],
  },
  extrait_optimise_c_est_nous: {
    libelle: "Extrait optimise present, et c est nous qui l occupons",
    min: 1.05, max: 1.60,
    sources: [
      "First Page Sage : 42,9 % pour un extrait en tete contre 39,8 % pour une position 1 ordinaire, soit x1,08",
      "Ahrefs : l extrait capte 8,6 points en plus des 19,6 points du premier resultat, soit x1,45 environ pour qui tient les deux",
    ],
  },
  pack_local: {
    libelle: "Pack local (carte et trois fiches) en tete",
    min: 0.45, max: 0.75,
    sources: [
      "First Page Sage : position 1 organique a 23,7 % quand un pack local est present contre 39,8 % sans, soit x0,595 ; les trois fiches du pack captent 17,6 %, 15,4 % et 15,1 %",
    ],
  },
};

/**
 * ⛔ PLANCHER DE PRODUIT A 0,20. Empiler apercu IA, extrait optimise et pack local donne
 *    0,42 x 0,65 x 0,45 = 0,123, c'est-a-dire l'affirmation qu'il ne reste que 12 % des
 *    clics. Aucune des trois etudes n'a mesure cet empilement : le produit de trois
 *    fourchettes independantes n'est pas une mesure de la combinaison, c'est une
 *    supposition d'independance. Le plancher dit « en dessous de 20 %, nous ne savons
 *    plus », ce qui est la seule chose vraie a cet endroit.
 */
export const PLANCHER_PRODUIT_SERP = 0.20;

export function multiplicateurSerp(types = []) {
  const inconnus = types.filter((t) => !MULTIPLICATEURS_SERP[t]);
  if (inconnus.length) {
    throw new Error(
      `type de SERP inconnu : ${inconnus.join(", ")}. Connus : ${Object.keys(MULTIPLICATEURS_SERP).join(", ")}`
    );
  }
  if (!types.length) {
    return { types: [], min: 1, max: 1, central: 1, sigma: 0, plancher_applique: false, sources: [] };
  }
  let min = 1, max = 1;
  const sources = [];
  for (const t of types) {
    min *= MULTIPLICATEURS_SERP[t].min;
    max *= MULTIPLICATEURS_SERP[t].max;
    sources.push(...MULTIPLICATEURS_SERP[t].sources);
  }
  const brutMin = min, brutMax = max;
  const plancher_applique = min < PLANCHER_PRODUIT_SERP;
  min = Math.max(min, PLANCHER_PRODUIT_SERP);
  max = Math.max(max, PLANCHER_PRODUIT_SERP);
  return {
    types, min, max, brutMin, brutMax,
    central: moyenneGeometrique(min, max),
    sigma: max > min ? sigmaDeFourchette(min, max) : 0,
    plancher_applique, sources,
  };
}

// -----------------------------------------------------------------------------------
// 5. LE VOLUME DE RECHERCHE
// -----------------------------------------------------------------------------------

const UNITES = { k: 1e3, m: 1e6 };

/** « 100 - 1 K » ou « 10K-100K » devient { min, max }. */
export function palier(texte) {
  const m = String(texte).toLowerCase().replace(/\s+/g, "").match(/^([\d.,]+)([km]?)[-–]([\d.,]+)([km]?)$/);
  if (!m) throw new Error(`palier illisible : ${texte}`);
  const n = (v, u) => parseFloat(v.replace(",", ".")) * (UNITES[u] || 1);
  return { min: n(m[1], m[2]), max: n(m[3], m[4]) };
}

/**
 * Ramene un volume a son centre et a son incertitude.
 *
 * Trois formes acceptees, et elles ne disent PAS la meme chose :
 *   { min, max }        un palier d outil, centre = moyenne geometrique
 *   { valeur }          un nombre unique CRACHE PAR UN OUTIL. Ce n est pas une mesure :
 *                       Semrush, Ahrefs et le planificateur de Google donnent trois
 *                       nombres differents pour la meme requete. On lui pose donc une
 *                       bande par defaut d un facteur 2 au total, et un drapeau.
 *   { valeur, exact }   des impressions Search Console, comptees. sigma = 0.
 */
export function volumeCentral(volume) {
  const drapeaux = [];
  if (volume == null) throw new Error("volume manquant");
  if (volume.exact) {
    return { min: volume.valeur, max: volume.valeur, central: volume.valeur, sigma: 0, drapeaux: ["volume_mesure_impressions"] };
  }
  let min = volume.min, max = volume.max;
  if (min == null && max == null && volume.valeur != null) {
    const f = Math.sqrt(2);
    min = volume.valeur / f; max = volume.valeur * f;
    drapeaux.push("volume_sans_fourchette_bande_par_defaut_facteur_2");
  }
  // ⛔ Une borne basse a zero ferait une moyenne geometrique nulle, donc un total nul,
  //    donc un zero la ou il n y a pas d absence. Un palier « 0 - 10 » d un outil veut
  //    dire « moins de 10 », pas « rien ».
  if (!(min > 0)) { min = 1; drapeaux.push("borne_basse_nulle_remplacee_par_1"); }
  const central = moyenneGeometrique(min, max);
  return { min, max, central, sigma: max > min ? sigmaDeFourchette(min, max) : 0, drapeaux };
}

// -----------------------------------------------------------------------------------
// 6. ESTIMATION D'UNE REQUETE
// -----------------------------------------------------------------------------------
//
// clics = volume x taux de clic x multiplicateur de SERP
//
// ⛔ PROPAGATION EN QUADRATURE, DANS L'ESPACE DES LOGARITHMES. Le modele etant un produit,
//    ln(clics) = ln(volume) + ln(taux) + ln(multiplicateur) : une SOMME. Les ecarts-types
//    de termes independants s'ajoutent alors en quadrature,
//        sigma = racine(sv^2 + sc^2 + sm^2 + sp^2)
//    et surtout PAS lineairement. Additionner les sigmas supposerait que les trois erreurs
//    se trompent toujours dans le meme sens le meme jour, ce qui ferait une fourchette
//    deux fois trop large, donc inutilisable, donc ignoree par le lecteur.
//    Le quatrieme terme sp est l absence de courbe pour le marche vise (voir ecartPays).

export function estimerRequete({
  domaine = null, requete, pays = null, position, volume, serp = [],
  courbes = TROIS_COURBES, variantes = {},
}) {
  const drapeaux = ["modelise_pas_mesure", "interdit_dans_la_note"];
  const v = volumeCentral(volume);
  drapeaux.push(...v.drapeaux);

  const c = tauxRetenu(position, { courbes, variantes });
  drapeaux.push(...c.drapeaux);

  if (c.etat === "ANGLE_MORT") {
    // ⛔ ANGLE MORT, VALEUR null, ET LA REQUETE SORT DU TOTAL AVEC SON POIDS.
    //    Elle ne compte pas zero clic : elle compte « on ne sait pas ». L agregation
    //    l annonce separement, faute de quoi un domaine classe 24e partout afficherait
    //    zero et se lirait comme un domaine sans aucun classement.
    return {
      domaine, requete, pays, position, etat: "ANGLE_MORT", central: null, bas: null, haut: null,
      volume: v, ctr: c, serp: null, raison: c.raison,
      drapeaux: [...drapeaux, "exclue_du_total"],
    };
  }

  const m = multiplicateurSerp(serp);
  if (m.plancher_applique) drapeaux.push("plancher_produit_serp_applique");

  // Marche sans courbe : le prix mesure de ce trou, pas une invention.
  let sigmaPays = 0;
  let ecart = null;
  if (!pays) {
    // ⛔ On ne SAIT PAS si le marche est couvert, donc on ne peut pas chiffrer ce terme.
    //    Le mettre a zero en silence ferait passer l ignorance pour une certitude : la
    //    fourchette sortirait plus etroite parce qu on a omis une information, pas parce
    //    qu on en a gagne une. Le drapeau part avec la ligne.
    drapeaux.push("pays_non_renseigne_ecart_de_marche_non_chiffre");
  } else if (!PAYS_COUVERTS.has(pays)) {
    ecart = ecartPays(position);
    if (ecart) {
      sigmaPays = sigmaDeFourchette(1 / Math.sqrt(ecart.facteur), Math.sqrt(ecart.facteur));
      drapeaux.push(`aucune_courbe_pour_${pays}`);
    }
  }

  const sigma = Math.sqrt(v.sigma ** 2 + c.sigma ** 2 + m.sigma ** 2 + sigmaPays ** 2);
  const central = v.central * c.taux * m.central;

  return {
    domaine, requete, pays, position, etat: "MESURE",
    volume: v, ctr: c, serp: m,
    pays_hors_courbe: !!ecart, ecart_pays: ecart,
    sigmas: { volume: v.sigma, taux: c.sigma, serp: m.sigma, pays: sigmaPays, total: sigma },
    central,
    bas: central * Math.exp(-Z90 * sigma),
    haut: central * Math.exp(Z90 * sigma),
    facteur_incertitude: Math.exp(Z90 * sigma),
    drapeaux,
  };
}

// -----------------------------------------------------------------------------------
// 7. AGREGATION AU DOMAINE
// -----------------------------------------------------------------------------------

/**
 * ⛔ LE LIBELLE FAIT PARTIE DU CHIFFRE. Il sort d'ici, il n'est pas laisse a l'affichage.
 *    Le N est DANS le libelle parce que le total ne vaut que pour ce pool-la, et la
 *    fleche ↑ dit que le vrai chiffre est au-dessus : un domaine classe sur nos 20
 *    requetes est aussi classe sur des centaines d'autres qu'on ne suit pas.
 */
export function libelleTotal(n) {
  return verifierLibelle(`clics estimés sur les ${n} requêtes suivies ↑`);
}

/**
 * ⛔ INTERDICTION EXECUTEE, PAS RECOMMANDEE. « trafic organique » sur ce nombre est le
 *    libelle exact qui a fait passer 70,4 K de modele pour 2,9 K de releve le 20/08/2026.
 *    La fonction LEVE, comme observation() leve sur un angle mort porteur de valeur.
 */
export function verifierLibelle(texte) {
  if (/trafic\s*organique/i.test(texte)) {
    throw new Error(
      `libelle interdit : « ${texte} ». Ce nombre est un plancher modelise sur un pool fige, ` +
      `pas un trafic. Libelle impose : « clics estimes sur les N requetes suivies ↑ ».`
    );
  }
  return texte;
}

export function estimerDomaine({ domaine, requetes = [], pool = null, courbes = TROIS_COURBES, variantes = {} }) {
  const lignes = requetes.map((r) => estimerRequete({ domaine, courbes, variantes, ...r }));
  const retenues = lignes.filter((l) => l.etat === "MESURE");
  const ecartees = lignes.filter((l) => l.etat !== "MESURE");

  const central = retenues.reduce((a, l) => a + l.central, 0);

  // ⛔ DEUX AGREGATIONS D'INCERTITUDE, ET C'EST LA CORRELEE QU'ON AFFICHE.
  //    L erreur dominante du calcul est le desaccord entre les courbes de taux de clic.
  //    Or c est LA MEME courbe qui sert pour les vingt requetes : si elle est trop haute,
  //    elle est trop haute partout, en meme temps. Cette erreur-la ne se compense donc
  //    pas en s additionnant, et traiter les vingt requetes comme independantes
  //    retrecirait la fourchette d un facteur racine(20) pour une raison fausse.
  //    On additionne donc les bornes (hypothese correlee). La version independante est
  //    calculee aussi, mais seulement pour montrer l ecart entre les deux lectures.
  const bas = retenues.reduce((a, l) => a + l.bas, 0);
  const haut = retenues.reduce((a, l) => a + l.haut, 0);
  const demiIndep = Math.sqrt(retenues.reduce((a, l) => a + ((l.haut - l.bas) / 2) ** 2, 0));

  const n = retenues.length;
  const agg = {
    domaine,
    pool: pool || config().requetes?.version || null,
    n_retenues: n,
    n_ecartees: ecartees.length,
    libelle: libelleTotal(n),
    // nature « estimation » et pas « plancher », et l arbitrage est volontaire : des deux
    // erreurs de lecture possibles, prendre un modele pour un releve coute plus cher
    // (le facteur 24 mesure le 20/08/2026) que prendre un plancher pour un total.
    // Le caractere plancher est porte par le libelle, la fleche et le drapeau.
    nature: "estimation",
    central, bas, haut,
    demi_largeur_correlee: (haut - bas) / 2,
    demi_largeur_independante: demiIndep,
    facteur_incertitude: central > 0 ? haut / central : null,
    lignes, retenues, ecartees,
    drapeaux: ["modelise_pas_mesure", "plancher_pool_suivi", "interdit_dans_la_note"],
  };
  agg.phrase = phraseHonnete(agg);
  return agg;
}

/**
 * La phrase affichee sous le chiffre. Elle dit ce qu'il vaut ET ce qu'il ne vaut pas.
 * Elle est ecrite ici et pas dans le generateur du site : un chiffre qui voyage sans sa
 * phrase finit tot ou tard dans une colonne ou il ne devrait pas etre.
 */
export function phraseHonnete(agg) {
  // ⛔ ON NE CITE COMME « DESACCORD ENTRE LES ETUDES » QUE LES POSITIONS OU PLUSIEURS
  //    COURBES PUBLIENT VRAIMENT. Aux positions 11 a 20, une seule courbe repond et les
  //    deux bornes viennent de notre facteur par defaut : les citer comme publiees
  //    reproduirait ici meme la confusion que le module combat ailleurs.
  const observees = agg.retenues.filter((l) => l.ctr.fourchette_observee);
  const pire = [...observees].sort((a, b) => (b.ctr.facteur_desaccord || 0) - (a.ctr.facteur_desaccord || 0))[0];
  const imposees = agg.retenues.filter((l) => !l.ctr.fourchette_observee);
  const morceaux = [];
  morceaux.push(
    `Modélisé, pas mesuré. ${fr(Math.round(agg.central))} clics par mois est le centre d'une fourchette ` +
    `de ${fr(Math.round(agg.bas))} à ${fr(Math.round(agg.haut))}, obtenue en multipliant un volume de recherche ` +
    `lui-même estimé par une courbe publique de taux de clic.`
  );
  morceaux.push(
    `Personne n'a compté ces visites : sans données de navigation achetées à un panel, le trafic d'un ` +
    `concurrent ne se mesure pas, il se modélise.`
  );
  morceaux.push(
    `Le chiffre ne couvre que les ${agg.n_retenues} requêtes suivies, donc le vrai total est plus haut (↑).`
  );
  if (agg.n_ecartees) {
    morceaux.push(
      `${agg.n_ecartees} requête${agg.n_ecartees > 1 ? "s" : ""} sur ${agg.lignes.length} ${agg.n_ecartees > 1 ? "sont sorties" : "est sortie"} ` +
      `du calcul faute de courbe à cette position : ${agg.n_ecartees > 1 ? "elles ne comptent" : "elle ne compte"} pas zéro clic, ` +
      `${agg.n_ecartees > 1 ? "elles comptent" : "elle compte"} « on ne sait pas ».`
    );
  }
  if (pire) {
    morceaux.push(
      `La plus grosse source d'erreur n'est pas notre calcul : à la position ${enPosition(pire.position)}, ` +
      `les courbes publiées vont de ${fr(pire.ctr.min_pourcent, 2)} % à ${fr(pire.ctr.max_pourcent, 2)} % ` +
      `de taux de clic, soit un facteur ${fr(pire.ctr.facteur_desaccord, 1)}. C'est le désaccord entre les études, pas le nôtre.`
    );
  }
  if (imposees.length) {
    morceaux.push(
      `${imposees.length} requête${imposees.length > 1 ? "s sont" : " est"} au-delà de la position 10, ` +
      `où une seule des trois études publie encore une valeur : leur fourchette n'est pas observée, ` +
      `elle leur applique le désaccord typique mesuré ailleurs (facteur ${fr(FACTEUR_DESACCORD_TYPIQUE, 1)}).`
    );
  }
  morceaux.push(
    `Repère : le 20/08/2026, un outil du marché affichait 70,4 K de trafic estimé sur un site qui mesurait ` +
    `2,9 K de visites réelles, facteur 24. Ce chiffre-ci est de la même famille que le premier.`
  );
  return morceaux.join(" ");
}

// -----------------------------------------------------------------------------------
// 8. VERS LE MAGASIN D'OBSERVATIONS
// -----------------------------------------------------------------------------------

/** Metriques que le module de note doit filtrer. Il importe ceci, pas ce fichier entier. */
export const EXCLU_DE_LA_NOTE = new Set(["clics_estimes", "clics_estimes_requetes_suivies"]);

export function versObservations(agg, { run = nouveauRun("trafic") } = {}) {
  const obs = [];
  const commun = {
    run_id: run, collecteur: VERSION,
    source: {
      nom: "modele_vigie", endpoint: "outils/trafic.mjs", http: null,
      methode: `volume x taux de clic (${TROIS_COURBES.join(" + ")}) x multiplicateur de SERP`,
    },
  };

  for (const l of agg.lignes) {
    const sujet = { domaine: agg.domaine, requete: l.requete, pays: l.pays };
    if (l.etat === "ANGLE_MORT") {
      obs.push(observation({
        ...commun, type: TYPE_OBS, sujet, metrique: "clics_estimes",
        etat: "ANGLE_MORT", nature: "mesure_absente",
        preuve: l.raison, drapeaux: l.drapeaux,
      }));
      continue;
    }
    obs.push(observation({
      ...commun, type: TYPE_OBS, sujet, metrique: "clics_estimes",
      valeur: Math.round(l.central * 100) / 100,
      valeur_min: Math.round(l.bas * 100) / 100,
      valeur_max: Math.round(l.haut * 100) / 100,
      unite: "clic_par_mois", nature: "estimation", etat: "MESURE",
      preuve:
        `position ${l.position} · taux retenu ${l.ctr.pourcent.toFixed(2)} % ` +
        `(${l.ctr.nombre_de_courbes} courbe(s), de ${l.ctr.min_pourcent.toFixed(2)} a ${l.ctr.max_pourcent.toFixed(2)} %` +
        `${l.ctr.fourchette_observee ? " observees" : ", fourchette IMPOSEE par defaut faute de seconde courbe"}) ` +
        `· volume ${Math.round(l.volume.central)} (${Math.round(l.volume.min)} a ${Math.round(l.volume.max)}) ` +
        `· SERP ${l.serp.types.join("+") || "nue"} x${l.serp.central.toFixed(2)} ` +
        `· sigma ${l.sigmas.total.toFixed(3)}`,
      drapeaux: l.drapeaux,
    }));
  }

  // ⛔ LE DISCRIMINANT QUI N EST PAS DANS LA CLE DE dernier() PASSE DANS LE NOM DE LA
  //    METRIQUE, APRES UN @. La cle de dernier() ne regarde ni le pool ni la version des
  //    courbes ; deux pools different sous le meme nom de metrique feraient rendre a
  //    dernier() un point au hasard entre les deux, et la courbe du site sauterait sans
  //    que rien n ait bouge sur le domaine. Le pool est fige et versionne dans
  //    domaines.json pour exactement cette raison.
  const metrique = `clics_estimes_requetes_suivies@${agg.pool || "pool_inconnu"}`;
  obs.push(observation({
    ...commun, type: TYPE_OBS, sujet: { domaine: agg.domaine },
    metrique,
    valeur: Math.round(agg.central),
    valeur_min: Math.round(agg.bas),
    valeur_max: Math.round(agg.haut),
    unite: "clic_par_mois", nature: agg.nature, etat: "MESURE",
    preuve:
      `${agg.libelle} · ${agg.n_retenues} retenues, ${agg.n_ecartees} en angle mort · ` +
      `fourchette a 90 % correlee ${Math.round(agg.bas)} a ${Math.round(agg.haut)}`,
    drapeaux: agg.drapeaux,
  }));
  return obs;
}

// -----------------------------------------------------------------------------------
// 9. LECTURE DU JOURNAL (positions et volumes deja collectes)
// -----------------------------------------------------------------------------------

/**
 * Reconstitue les entrees d'estimation depuis le journal d'observations.
 * ⛔ Lecture seule. Rien n est ecrit sans --ecrire.
 *
 * ⛔ LE TOTAL NE PORTE QUE LE POOL FIGE, ET LE JOURNAL CONTIENT AUTRE CHOSE.
 *    Les positions ecrites par collecte-semrush-public viennent d'un pool CHOISI PAR
 *    SEMRUSH (ses cinq mots-cles les plus rentables pour le domaine), qui change d'un
 *    releve a l'autre. Les verser dans un total libelle « sur les N requetes suivies »
 *    ferait bouger ce total parce que le pool a bouge, pas parce que le domaine a bouge,
 *    et le libelle mentirait sur ce que N designe. On garde donc UNIQUEMENT les requetes
 *    du pool fige de domaines.json, et on rend les autres a part pour qu'elles soient
 *    visibles au lieu d'etre jetees en silence.
 */
export function requetesDepuisLeJournal(domaine, { poolSeul = true } = {}) {
  const { obs } = lire();
  const photo = dernier(obs);
  const cfg = config();
  const pool = new Set([...(cfg.requetes?.fr || []), ...(cfg.requetes?.en || [])].map((r) => r.toLowerCase()));
  const horsPool = [];
  const positions = photo.filter(
    (o) => o.type === "requete" && o.metrique === "position" && o.sujet?.domaine === domaine && o.etat === "MESURE" && o.valeur != null
  ).filter((o) => {
    if (!poolSeul) return true;
    const dans = pool.has(String(o.sujet?.requete || "").toLowerCase());
    if (!dans) horsPool.push(o.sujet?.requete);
    return dans;
  });
  const volumes = new Map();
  for (const o of photo) {
    if (o.type === "requete" && o.metrique === "volume_recherche" && o.etat === "MESURE" && o.valeur != null) {
      volumes.set(`${o.sujet?.requete}|${o.sujet?.pays || ""}`, o.valeur);
    }
  }
  const sorties = [];
  const sansVolume = [];
  for (const p of positions) {
    const v = volumes.get(`${p.sujet?.requete}|${p.sujet?.pays || ""}`);
    if (v == null) { sansVolume.push(p.sujet?.requete); continue; }
    sorties.push({
      requete: p.sujet.requete,
      pays: p.sujet.pays || null,
      position: p.valeur,
      // ⛔ Un volume servi par un outil est un nombre unique, donc une bande par defaut et
      //    un drapeau. Ce n est pas une mesure : trois outils donnent trois nombres.
      volume: { valeur: v },
      serp: [],
    });
  }
  return { requetes: sorties, sansVolume, horsPool, pool: cfg.requetes?.version || null };
}

// -----------------------------------------------------------------------------------
// 10. LIGNE DE COMMANDE
// -----------------------------------------------------------------------------------

const { pathToFileURL } = await import("node:url");
// ⛔ argv[1] est INDEFINI quand le module est importe depuis « node -e » : sans la
//    garde, pathToFileURL leve et le module devient inimportable hors ligne de commande.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || null;

  if (process.argv.includes("--sources")) {
    afficherSources();
  } else if (process.argv.includes("--test")) {
    test();
  } else if (arg("domaine")) {
    const d = arg("domaine");
    const { requetes, sansVolume, horsPool, pool } = requetesDepuisLeJournal(d);
    if (!requetes.length) {
      console.log(`aucune requete exploitable pour ${d} dans le journal (pool fige ${pool}).`);
      if (horsPool.length) console.log(`  ${horsPool.length} position(s) HORS du pool fige, volontairement ecartees : ${horsPool.slice(0, 6).join(", ")}`);
      if (sansVolume.length) console.log(`  ${sansVolume.length} position(s) sans volume associe : ${sansVolume.slice(0, 6).join(", ")}`);
      process.exit(0);
    }
    const agg = estimerDomaine({ domaine: d, requetes, pool });
    console.log(`\n${d} · ${agg.libelle}`);
    console.log(`  ${fr(Math.round(agg.central))}  [${fr(Math.round(agg.bas))} a ${fr(Math.round(agg.haut))}]`);
    if (horsPool.length) console.log(`  ${horsPool.length} requete(s) hors du pool fige ${pool}, ecartees du total.`);
    if (sansVolume.length) console.log(`  ${sansVolume.length} requete(s) sans volume, hors calcul.`);
    console.log(`\n${agg.phrase}\n`);
    if (process.argv.includes("--ecrire")) {
      const n = ecrire(versObservations(agg));
      console.log(`${n} observations ecrites.`);
    } else {
      console.log(`(rien ecrit. Ajouter --ecrire pour poser ${versObservations(agg).length} observations.)`);
    }
  } else {
    console.log("actions : --test | --sources | --domaine=<domaine> [--ecrire]");
  }
}

// -----------------------------------------------------------------------------------
// 11. --sources
// -----------------------------------------------------------------------------------

function afficherSources() {
  const aujourdhui = Date.now();
  console.log("\nVIGIE SEO · les trois courbes de taux de clic\n");
  for (const id of TROIS_COURBES) {
    const c = courbe(id);
    const age = Math.round((aujourdhui - Date.parse(c.date_donnee)) / 86400000);
    console.log(`${c.libelle}  [${id}]`);
    console.log(`  source     ${c.source.nom} · ${c.source.titre}`);
    console.log(`  url        ${c.source.url}`);
    console.log(`  donnee du  ${c.date_donnee}  (${age} jours)`);
    console.log(`  echantillon ${c.echantillon || "NON PUBLIE"}`);
    console.log(`  methode    ${c.methode}`);
    for (const [nom, v] of Object.entries(c.variantes)) {
      const ps = Object.keys(v.positions).map(Number).sort((a, b) => a - b);
      console.log(`  variante ${nom.padEnd(8)} positions ${ps[0]} a ${ps[ps.length - 1]}` +
        (ps.length !== ps[ps.length - 1] - ps[0] + 1 ? `  (TROUS : ${trous(ps).join(", ")})` : ""));
    }
    c.notes.forEach((n) => console.log(`  note       ${n}`));
    if (c.drapeaux.length) console.log(`  drapeaux   ${c.drapeaux.join(", ")}`);
    console.log("");
  }
  console.log("Courbe volontairement absente : Advanced Web Ranking.");
  console.log("  Ses valeurs absolues sont derriere une iframe JavaScript et le rapport public ne");
  console.log("  publie que des deltas mensuels. Reconstruire des absolus depuis des variations,");
  console.log("  c est inventer. Elle n est donc pas codee.\n");
}

function trous(positions) {
  const t = [];
  for (let p = positions[0]; p <= positions[positions.length - 1]; p++) if (!positions.includes(p)) t.push(p);
  return t;
}

// -----------------------------------------------------------------------------------
// 12. --test : le calcul complet, hors ligne
// -----------------------------------------------------------------------------------

function test() {
  const T = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);
  const ok = (b) => (b ? "OK" : "ECHEC");

  console.log("VIGIE SEO · module trafic · mode --test, hors ligne, aucune ecriture\n");

  // -------------------------------------------------------------- A. les courbes
  T("A. LES TROIS COURBES, POSITION PAR POSITION");
  console.log("pos │ clickstream │  panel GSC  │ SERP propre │  retenu  │ desaccord");
  console.log("    │  seoClarity │  Backlinko  │ FirstPageS. │ (centre) │  (max/min)");
  console.log("────┼─────────────┼─────────────┼─────────────┼──────────┼───────────");
  for (let p = 1; p <= 20; p++) {
    const r = tauxRetenu(p);
    const cell = (id) => {
      const x = r.parCourbe[id];
      if (x.pourcent == null) return "      .      ";
      const marque = x.mode === "tabule" ? " " : x.mode === "interpole_sur_trou" ? "~" : "·";
      return ` ${marque}${x.pourcent.toFixed(2).padStart(6)} %   `;
    };
    const retenu = r.pourcent == null ? "  ANGLE▲" : `${r.pourcent.toFixed(2).padStart(6)} %`;
    const des = r.facteur_desaccord ? `x${r.facteur_desaccord.toFixed(2)}` : "  .";
    // ⛔ « defaut » et pas rien : aux positions 11 a 20 ce facteur n est PAS observe.
    const seule = r.ctr_impose || !r.fourchette_observee ? " par defaut" : " observe";
    console.log(`${String(p).padStart(3)} │${cell("clickstream_seoclarity_2021")}│${cell("panel_gsc_backlinko_2025")}│${cell("serp_propre_firstpagesage_2025")}│ ${retenu} │ ${des}${seule}`);
  }
  console.log("    ~ = interpole sur un TROU declare de la courbe (Backlinko ne publie pas 4 a 9)");
  console.log("    · = interpole entre deux positions voisines tabulees");
  console.log("    . = position hors couverture de cette courbe. Jamais un zero.");
  console.log(`\n  Desaccord typique mesure la ou au moins deux courbes se recouvrent : x${FACTEUR_DESACCORD_TYPIQUE.toFixed(2)}`);
  console.log(`  C est cette valeur, et pas une constante posee a la main, qui sert de fourchette`);
  console.log(`  par defaut aux positions 11 a 20 ou seule seoClarity repond.`);
  const e1 = ecartPays(1), e13 = ecartPays(13);
  console.log(`  Ecart entre pays dans la MEME etude : position 1, de ${e1.min} % a ${e1.max} % (x${e1.facteur.toFixed(2)}) ;`);
  console.log(`  position 13, de ${e13.min} % a ${e13.max} % (x${e13.facteur.toFixed(2)}). Aucune courbe France : ce facteur est le prix du trou.`);

  // -------------------------------------------------------------- B. interpolation
  T("B. L INTERPOLATION EST BIEN LOG-LOG");
  const p1 = tauxDeClic(1, { courbe: "serp_propre_firstpagesage_2025" }).pourcent;
  const p2 = tauxDeClic(2, { courbe: "serp_propre_firstpagesage_2025" }).pourcent;
  const mid = tauxDeClic(Math.sqrt(1 * 2), { courbe: "serp_propre_firstpagesage_2025" }).pourcent;
  const attendu = Math.sqrt(p1 * p2);
  console.log(`  positions 1 et 2 de FirstPageSage : ${p1} % et ${p2} %`);
  console.log(`  au milieu GEOMETRIQUE (position ${Math.sqrt(2).toFixed(4)}) : ${mid.toFixed(4)} %`);
  console.log(`  attendu racine(${p1} x ${p2}) = ${attendu.toFixed(4)} %   ${ok(Math.abs(mid - attendu) < 1e-9)}`);
  const lin = (p1 + p2) / 2;
  console.log(`  une interpolation LINEAIRE aurait rendu ${lin.toFixed(2)} %, soit ${((lin / attendu - 1) * 100).toFixed(1)} % de trop.`);
  const exact = tauxDeClic(7, { courbe: "serp_propre_firstpagesage_2025" });
  console.log(`  a un entier tabule, la valeur est rendue TELLE QUELLE : position 7 = ${exact.pourcent} % (${exact.mode})  ${ok(exact.mode === "tabule" && exact.pourcent === 3.0)}`);
  const trou = tauxDeClic(5, { courbe: "panel_gsc_backlinko_2025" });
  console.log(`  dans le trou Backlinko, position 5 : ${trou.pourcent.toFixed(2)} % en mode « ${trou.mode} », ancres ${trou.ancres.join(" et ")}  ${ok(trou.mode === "interpole_sur_trou")}`);
  const hors = tauxDeClic(14, { courbe: "serp_propre_firstpagesage_2025" });
  console.log(`  au-dela de la couverture, position 14 : valeur ${hors.pourcent} (${hors.mode}), raison « ${hors.raison} »  ${ok(hors.pourcent === null)}`);

  // -------------------------------------------------------------- C. moyenne geometrique
  T("C. LE PIEGE DE LA MOYENNE, SUR LE PALIER « 100 - 1 K »");
  const pal = palier("100 - 1 K");
  const geo = moyenneGeometrique(pal.min, pal.max);
  const ari = (pal.min + pal.max) / 2;
  console.log(`  palier lu        : ${pal.min} a ${pal.max}`);
  console.log(`  moyenne geometrique : ${geo.toFixed(1)}   <- valeur centrale retenue`);
  console.log(`  moyenne arithmetique: ${ari.toFixed(1)}   soit +${((ari / geo - 1) * 100).toFixed(0)} % des le premier facteur  ${ok(Math.round(geo) === 316 && ari === 550)}`);

  // -------------------------------------------------------------- D. multiplicateurs
  T("D. MULTIPLICATEURS DE SERP, EN FOURCHETTE, AVEC PLANCHER");
  for (const [k, v] of Object.entries(MULTIPLICATEURS_SERP)) {
    console.log(`  ${k.padEnd(28)} x${v.min.toFixed(2)} a x${v.max.toFixed(2)}   ${v.libelle}`);
  }
  const empile = multiplicateurSerp(["apercu_ia", "extrait_optimise_pas_nous", "pack_local"]);
  console.log(`  les trois empiles : produit brut x${empile.brutMin.toFixed(3)} a x${empile.brutMax.toFixed(3)}`);
  console.log(`  apres plancher    : x${empile.min.toFixed(2)} a x${empile.max.toFixed(2)}   plancher applique : ${empile.plancher_applique}  ${ok(empile.plancher_applique && empile.min === 0.20)}`);
  console.log(`  raison : aucune etude n a mesure cet empilement. En dessous de 0,20 on ne sait plus.`);

  // -------------------------------------------------------------- E. trois exemples
  T("E. TROIS EXEMPLES COMPLETS");

  const exemples = [
    {
      titre: "1. Cas courant : bonne position, marche francais, apercu IA sur la SERP",
      entree: { requete: "journal de trading", pays: "FR", position: 4.2, volume: palier("100 - 1 K"), serp: ["apercu_ia"] },
    },
    {
      titre: "2. Deuxieme page : une seule courbe couvre encore la position",
      entree: { requete: "journal de trading mt5", pays: "FR", position: 15, volume: { valeur: 210 }, serp: [] },
    },
    {
      titre: "3. Hors couverture : aucune courbe ne va jusque-la",
      entree: { requete: "backtesting journal", pays: "US", position: 24, volume: palier("1 K - 10 K"), serp: ["extrait_optimise_pas_nous"] },
    },
  ];

  const lignes = [];
  for (const ex of exemples) {
    console.log(`\n  ${ex.titre}`);
    const r = estimerRequete({ domaine: "exemple.com", ...ex.entree });
    lignes.push(ex.entree);
    console.log(`     requete            « ${r.requete} »  ·  pays ${r.pays}  ·  position ${r.position}`);
    if (r.etat === "ANGLE_MORT") {
      console.log(`     etat               ANGLE_MORT ▲`);
      console.log(`     raison             ${r.raison}`);
      console.log(`     valeur             null. PAS zero. La requete sort du total avec son poids.`);
      console.log(`     drapeaux           ${r.drapeaux.join(", ")}`);
      continue;
    }
    console.log(`     volume             ${fr(Math.round(r.volume.central))}  [${fr(Math.round(r.volume.min))} a ${fr(Math.round(r.volume.max))}]  sigma ${r.sigmas.volume.toFixed(3)}`);
    console.log(`     taux de clic       ${r.ctr.pourcent.toFixed(2)} %  [${r.ctr.min_pourcent.toFixed(2)} a ${r.ctr.max_pourcent.toFixed(2)} %]  sigma ${r.sigmas.taux.toFixed(3)}  (${r.ctr.nombre_de_courbes} courbe(s), desaccord x${r.ctr.facteur_desaccord.toFixed(2)})`);
    for (const id of TROIS_COURBES) {
      const c = r.ctr.parCourbe[id];
      console.log(`        ${courbe(id).source.nom.padEnd(16)} ${c.pourcent == null ? "hors couverture ▲" : `${c.pourcent.toFixed(2)} % (${c.mode})`}`);
    }
    console.log(`     SERP               ${r.serp.types.join(" + ") || "nue"}  x${r.serp.central.toFixed(2)}  [${r.serp.min.toFixed(2)} a ${r.serp.max.toFixed(2)}]  sigma ${r.sigmas.serp.toFixed(3)}`);
    console.log(`     marche             ${r.pays_hors_courbe ? `aucune courbe pour ${r.pays}, ecart mesure entre pays x${r.ecart_pays.facteur.toFixed(2)}` : "couvert par une courbe"}  sigma ${r.sigmas.pays.toFixed(3)}`);
    const s = r.sigmas;
    const quad = Math.sqrt(s.volume ** 2 + s.taux ** 2 + s.serp ** 2 + s.pays ** 2);
    console.log(`     QUADRATURE         racine(${s.volume.toFixed(3)}² + ${s.taux.toFixed(3)}² + ${s.serp.toFixed(3)}² + ${s.pays.toFixed(3)}²) = ${quad.toFixed(4)}`);
    console.log(`                        somme lineaire (FAUSSE) = ${(s.volume + s.taux + s.serp + s.pays).toFixed(4)}, soit ${(((s.volume + s.taux + s.serp + s.pays) / quad - 1) * 100).toFixed(0)} % de fourchette en trop`);
    console.log(`                        sigma retenu = ${s.total.toFixed(4)}   ${ok(Math.abs(quad - s.total) < 1e-12)}`);
    console.log(`     clics/mois         ${fr(Math.round(r.central))}  [${fr(Math.round(r.bas))} a ${fr(Math.round(r.haut))}]  soit /${r.facteur_incertitude.toFixed(1)} et x${r.facteur_incertitude.toFixed(1)}`);
    const part = (x) => `${((x ** 2 / s.total ** 2) * 100).toFixed(0)} %`;
    console.log(`     part de variance   volume ${part(s.volume)} · taux de clic ${part(s.taux)} · SERP ${part(s.serp)} · marche ${part(s.pays)}`);
  }

  // -------------------------------------------------------------- F. agregation
  T("F. AGREGATION AU DOMAINE");
  // Les trois exemples ci-dessus, plus trois requetes ordinaires : a six lignes, l ecart
  // entre les deux facons d agreger l incertitude devient lisible.
  lignes.push(
    { requete: "carnet de trading", pays: "FR", position: 2, volume: palier("100 - 1 K"), serp: ["extrait_optimise_pas_nous"] },
    { requete: "trading journal", pays: "US", position: 8, volume: palier("10 K - 100 K"), serp: ["apercu_ia", "extrait_optimise_pas_nous"] },
    { requete: "meilleur journal de trading", pays: "FR", position: 6.5, volume: { valeur: 90 }, serp: [] },
  );
  const agg = estimerDomaine({ domaine: "exemple.com", requetes: lignes, pool: "v1-2026-08-21" });
  console.log(`  ${agg.libelle}`);
  console.log(`  ${fr(Math.round(agg.central))} clics/mois   [${fr(Math.round(agg.bas))} a ${fr(Math.round(agg.haut))}]`);
  console.log(`  ${agg.n_retenues} requete(s) retenue(s), ${agg.n_ecartees} en angle mort (exclue(s) du total, PAS comptee(s) zero)`);
  console.log(`  demi-largeur correlee     ${fr(Math.round(agg.demi_largeur_correlee))}   <- affichee`);
  console.log(`  demi-largeur independante ${fr(Math.round(agg.demi_largeur_independante))}   (rejetee : la meme courbe sert partout, l erreur ne se compense pas)`);
  console.log(`  nature ${agg.nature} · drapeaux ${agg.drapeaux.join(", ")}`);

  T("G. LE LIBELLE EST VERROUILLE");
  try {
    verifierLibelle("trafic organique estime");
    console.log(`  ECHEC : le libelle interdit est passe.`);
  } catch (e) {
    console.log(`  verifierLibelle(« trafic organique estime ») a leve, comme prevu.`);
    console.log(`    ${String(e.message).slice(0, 150)}`);
  }
  console.log(`  libelle impose : « ${agg.libelle} »   ${ok(/\d+ requêtes suivies ↑$/.test(agg.libelle))}`);

  T("H. LA PHRASE AFFICHEE");
  console.log("  " + agg.phrase.replace(/(.{100} )/g, "$1\n  "));

  T("I. CE QUI PARTIRAIT AU JOURNAL (rien n est ecrit ici)");
  const obs = versObservations(agg, { run: "test-hors-ligne" });
  for (const o of obs) {
    console.log(`  ${o.type} · ${o.metrique.padEnd(38)} ${o.etat === "ANGLE_MORT" ? "▲ null" : String(o.valeur).padStart(8)}  ${o.nature}`);
    console.log(`      sujet ${JSON.stringify({ d: o.sujet.domaine, r: o.sujet.requete, p: o.sujet.pays })}`);
    console.log(`      preuve ${o.preuve}`);
  }
  const angle = obs.find((o) => o.etat === "ANGLE_MORT");
  console.log(`\n  Le magasin d observations refuse une valeur sur un angle mort. Verification :`);
  try {
    observation({ type: TYPE_OBS, metrique: "clics_estimes", etat: "ANGLE_MORT", nature: "mesure_absente", valeur: 0 });
    console.log(`  ECHEC : un ANGLE_MORT porteur de zero est passe.`);
  } catch (e) {
    console.log(`  observation(ANGLE_MORT, valeur 0) a leve : ${String(e.message).slice(0, 110)}`);
  }
  console.log(`  la ligne en angle mort du test porte bien valeur=${angle ? angle.valeur : "aucune"}  ${ok(angle && angle.valeur === null)}`);

  console.log("");
}
