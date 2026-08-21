// LA CAPACITE REELLE DU MOTEUR, EN ACCES LIBRE.
//
// ⛔ CETTE ROUTE N'EXIGE PAS DE COMPTE, ET C'EST VOULU. Elle ne dit rien sur un domaine
//    particulier : elle dit ce que l'outil sait faire, et ce qu'il ne sait pas faire.
//    La cacher derriere une inscription reviendrait a faire creer un compte a quelqu'un
//    pour qu'il decouvre ensuite que la couverture ne lui suffit pas.
//
// ⛔ ET LES CHIFFRES DE COMPARAISON PORTENT LEUR SOURCE. Un chiffre sur un concurrent
//    sans sa source est une affirmation ; avec sa source, c'est une citation.

import { json, MAINTENANT } from "./_commun.js";

// Ce que les outils payants publient eux-memes sur leur propre crawl.
const REPERES = [
  {
    nom: "Semrush",
    pages_par_jour: 10_000_000_000,
    citation: "our own proprietary backlink crawler… approximately 10 billion web pages daily",
    source: "https://www.semrush.com/kb/997-semrush-data",
  },
  {
    nom: "Ahrefs",
    pages_par_jour: 7_500_000_000,
    citation: "We have our own crawlers and index",
    source: "https://help.ahrefs.com/en/articles/78119",
    note: "7 a 8 milliards de pages par jour",
  },
];

export async function onRequestGet({ env }) {
  const bd = env.vigie;
  if (!bd) return json({ erreur: "base indisponible" }, 503);

  const [metriques, index, file, comptes] = await Promise.all([
    bd.prepare("SELECT cle, valeur, maj_le FROM metriques").all(),
    bd.prepare(
      `SELECT (SELECT COUNT(*) FROM backlinks) AS liens_confirmes,
              (SELECT COUNT(*) FROM referents) AS domaines_annonces,
              (SELECT COUNT(DISTINCT cible) FROM backlinks) AS domaines_couverts`
    ).first(),
    bd.prepare("SELECT COUNT(*) AS n FROM file_crawl").first(),
    bd.prepare("SELECT COUNT(*) AS n FROM comptes").first(),
  ]);

  const m = {};
  let mesureLe = null;
  for (const l of metriques.results || []) {
    const n = Number(l.valeur);
    m[l.cle] = Number.isFinite(n) ? n : l.valeur;
    if (!mesureLe || l.maj_le > mesureLe) mesureLe = l.maj_le;
  }

  const notre = m.cadence_pages_par_jour || 0;

  return json({
    mesure_le: mesureLe,
    quand: MAINTENANT(),

    // Notre moteur, mesure sur la derniere heure reelle.
    moteur: {
      cadence_pages_par_jour: notre,
      pages_derniere_heure: m.pages_derniere_heure ?? null,
      pages_depuis_le_debut: m.pages_depuis_le_debut ?? null,
      liens_indexes: m.liens_indexes ?? null,
      domaines_cibles: m.domaines_cibles ?? null,
      domaines_sources: m.domaines_sources ?? null,
      hotes_ouverts: m.hotes_ouverts ?? null,
      pages_en_file: m.pages_en_file ?? null,
      // ⛔ « ANGLE_MORT » SI LE SERVEUR N'A RIEN PUBLIE DEPUIS DEUX HEURES. Afficher la
      //    derniere cadence connue comme si elle etait actuelle laisserait croire que le
      //    moteur tourne alors qu'il est peut-etre arrete.
      etat:
        !mesureLe ? "ANGLE_MORT"
        : Date.parse(mesureLe) < Date.now() - 7200000 ? "ANGLE_MORT"
        : "MESURE",
    },

    // Ce que l'application sert aujourd'hui.
    service: {
      liens_confirmes: index?.liens_confirmes ?? 0,
      domaines_annonces: index?.domaines_annonces ?? 0,
      domaines_couverts: index?.domaines_couverts ?? 0,
      domaines_en_file: file?.n ?? 0,
      comptes: comptes?.n ?? 0,
    },

    // Les outils payants, avec leur propre chiffre et sa source.
    reperes: REPERES.map((r) => ({
      ...r,
      rapport: notre ? Math.round(r.pages_par_jour / notre) : null,
    })),

    // La phrase que l'interface doit reprendre telle quelle.
    verdict:
      "Un quatre-millieme de la cadence d'un outil payant. Ils crawlent le web entier pour " +
      "tout le monde ; ce moteur crawle un perimetre choisi, et il y repasse plus souvent " +
      "qu'eux. C'est le seul angle ou un outil gratuit peut faire mieux.",
  });
}
