// NOTE MAISON DU SITE QUI EMET UN BACKLINK.
//
// Decidee le 21/08/2026 : sur chaque backlink, on veut NOTRE note de l'autorite du site
// qui l'emet. Ce qui etait affiche jusque-la n'etait pas une note, c'etait un relais
// d'OpenPageRank, c'est-a-dire une metrique exterieure calculee sur le VOLUME de liens.
// Or la doctrine dit l'inverse : le trafic d'abord, le nombre de liens ensuite. Relayer
// OpenPageRank tel quel, c'est afficher un Domain Authority sous un autre nom.
//
// ⛔ POURQUOI CETTE NOTE EST DISTINCTE DE CELLE DE note.mjs. NL, la note d'un LIEN, exige
//    de connaitre le rel, l'indexabilite et la page portante : elle n'existe que pour les
//    liens qu'on a reellement ouverts, quelques dizaines. NE, la note d'un EMETTEUR, se
//    calcule sur ce qu'on sait de TOUS les domaines referents, soit plusieurs milliers,
//    sans ouvrir une seule page. Les deux se completent, elles ne se remplacent pas :
//    la colonne « note du lien » reste vide tant que le lien n'est pas qualifie, la
//    colonne « note de l'emetteur » est remplie partout.
//
// ⛔ ET ELLE NE PREND PAS OpenPageRank POUR ARGENT COMPTANT. OPR compte des liens, donc
//    il se manipule. Il pese ici 25 %, derriere la popularite reelle mesuree par Tranco
//    (35 %), et il est PLAFONNE quand il contredit les autres signaux : un domaine absent
//    du top 1M mondial avec un OPR de 8 est le portrait-robot d'une ferme a liens, pas
//    celui d'un site puissant. Cas mesure le 21/08/2026 sur un site de contenu financier :
//    DA affiche entre 60 et 64, et ABSENT du classement Tranco. Les deux chiffres ne
//    peuvent pas etre vrais en meme temps ; c'est celui qui se vend qui ment.
//
// LES CINQ COMPOSANTES, chacune affichee avec sa valeur :
//   POP  35 %  popularite reelle, rang Tranco (agrege de plusieurs panels)
//   OPR  25 %  autorite de liens OpenPageRank, plafonnee si elle contredit POP
//   RES  15 %  reseau : sous-reseaux referents de Majestic, resistant au spam d'un seul
//              hebergeur, la ou un simple compte de domaines ne l'est pas
//   PRO  15 %  proprete : signaux de spam mesures sur la page, quand on l'a lue
//   COH  10 %  coherence : le nom de domaine parle-t-il de VOTRE sujet, ou d'autre chose
//              (le vocabulaire vient de votre lexique, pas du code)
//
// Trois etats comme partout : MESURE, MESURE_ABSENT (la source a repondu « rien », ce qui
// est une vraie mesure de faiblesse), ANGLE_MORT (on n'a pas pu regarder, poids retire).
//
// Usage :
//   node outils/note-emetteur.mjs [--limite=4000] [--dry]

import { observation, ecrire, nouveauRun, lire, dernier, config } from "./_lib-obs.mjs";
import { chargerLexiques } from "./note.mjs";

export const VERSION = "note-emetteur@1.0.0";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r1 = (x) => Math.round(x * 10) / 10;

const POIDS = { POP: 35, OPR: 25, RES: 15, PRO: 15, COH: 10 };

// ⛔ LE VOCABULAIRE VIENT DE VOTRE CONFIGURATION, PAS DU CODE. Voir config/
//    lexiques.exemple.json et le chargeur de note.mjs pour l'ordre de recherche.
//    Le bloc utilise ici est `court`, et il est court expres : il ne sert qu'a dire
//    « ce domaine parle de notre sujet », sans juger la qualite editoriale. Le lexique
//    long (l1 / l2) sert a la note d'un LIEN, qui elle ouvre la page.
//
// ⛔ ET IL S'APPLIQUE A UN NOM DE DOMAINE, PAS A UN CHEMIN D'URL. C'est pour cela qu'il
//    a ses propres mots : une expression comme « journal de trading » ne se rencontre
//    jamais dans un host, alors qu'elle est parfaitement utile dans un slug. A defaut de
//    bloc `court`, on retombe sur l1, ce qui fonctionne mais mesure moins bien.
const LEXIQUES = chargerLexiques();
const MOTS_SUJET = (Array.isArray(LEXIQUES.court) && LEXIQUES.court.length)
  ? LEXIQUES.court.map((m) => String(m).toLowerCase())
  : [...LEXIQUES.l1.fr, ...LEXIQUES.l1.en].map((m) => String(m).toLowerCase());

/**
 * @param {object} c contexte du domaine emetteur
 *   c.tranco        {rang, etat}       rang Tranco, etat MESURE / MESURE_ABSENT / ANGLE_MORT
 *   c.opr           {valeur, etat}     OpenPageRank 0 a 10
 *   c.refSubNets    {valeur, etat}     sous-reseaux referents (Majestic)
 *   c.spam          {verdict, score, etat}
 *   c.domaine       string
 */
export function noteEmetteur(c = {}) {
  const comp = [];

  // --- POP, popularite reelle -------------------------------------------------------
  // Echelle logarithmique, parce que le trafic web suit une loi de puissance.
  // Reperes : rang 100 -> 100 · 1 000 -> 75 · 10 000 -> 50 · 100 000 -> 25 · 1 M -> 0.
  {
    const t = c.tranco || {};
    if (t.etat === "MESURE" && t.rang > 0) {
      const v = 100 * clamp((6 - Math.log10(t.rang)) / 4, 0, 1);
      comp.push({ cle: "POP", nom: "Popularite", valeur: v, poids: POIDS.POP, etat: "MESURE",
        brut: `rang Tranco ${t.rang.toLocaleString("fr-FR")}`, source: "tranco",
        dit: `${t.rang.toLocaleString("fr-FR")}e domaine mondial selon Tranco` });
    } else if (t.etat === "MESURE_ABSENT") {
      // ⛔ Absent du top 1 million est une VRAIE mesure, et une mesure severe : le domaine
      //    n'a pas assez de trafic pour y figurer. On note bas, on ne met pas d'angle mort.
      comp.push({ cle: "POP", nom: "Popularite", valeur: 5, poids: POIDS.POP, etat: "MESURE_ABSENT",
        brut: "hors top 1M Tranco", source: "tranco",
        dit: "absent du million de domaines les plus frequentes : c'est une mesure, pas un trou" });
    } else {
      comp.push({ cle: "POP", nom: "Popularite", valeur: null, poids: POIDS.POP, etat: "ANGLE_MORT",
        plage: [0, 100], brut: "non interroge", source: "tranco",
        dit: "Tranco n'a pas ete interroge sur ce domaine" });
    }
  }

  // --- OPR, autorite de liens, plafonnee ---------------------------------------------
  {
    const o = c.opr || {};
    const pop = comp.find((x) => x.cle === "POP");
    if (o.etat === "MESURE" && o.valeur != null) {
      let v = clamp(Number(o.valeur) / 10, 0, 1) * 100;
      let plafonne = null;
      // ⛔ LE PLAFOND EST LE COEUR DE CETTE NOTE. Un OpenPageRank eleve sur un domaine que
      //    personne ne visite est le signal d'une ferme a liens, pas d'une autorite. On
      //    ne laisse donc jamais OPR depasser de plus de 25 points la popularite reelle.
      if (pop && pop.valeur != null && v > pop.valeur + 25) {
        plafonne = v;
        v = pop.valeur + 25;
      }
      comp.push({ cle: "OPR", nom: "Autorite de liens", valeur: v, poids: POIDS.OPR, etat: "MESURE",
        brut: `OpenPageRank ${o.valeur}/10`, source: "openpagerank",
        dit: plafonne
          ? `OpenPageRank ${o.valeur}/10, soit ${r1(plafonne)} sur 100, PLAFONNE a ${r1(v)} : l'autorite de liens depasse de trop la popularite reelle, c'est le portrait d'une ferme a liens`
          : `OpenPageRank ${o.valeur}/10` });
    } else if (o.etat === "MESURE_ABSENT") {
      comp.push({ cle: "OPR", nom: "Autorite de liens", valeur: 8, poids: POIDS.OPR, etat: "MESURE_ABSENT",
        brut: "hors des 10 millions de domaines OpenPageRank", source: "openpagerank",
        dit: "absent des dix millions de domaines classes : mesure de faiblesse, pas un trou" });
    } else {
      comp.push({ cle: "OPR", nom: "Autorite de liens", valeur: null, poids: POIDS.OPR, etat: "ANGLE_MORT",
        plage: [0, 100], brut: "non interroge", source: "openpagerank",
        dit: "la table OpenPageRank n'a pas ete consultee pour ce domaine" });
    }
  }

  // --- RES, largeur du reseau referent ------------------------------------------------
  {
    const m = c.refSubNets || {};
    if (m.etat === "MESURE" && m.valeur != null) {
      // Sous-RESEAUX et non domaines : mille domaines poses sur le meme hebergeur ne font
      // qu'un seul sous-reseau. C'est ce qui rend cette mesure resistante au spam en gros.
      const v = 100 * clamp(Math.log10(1 + Number(m.valeur)) / Math.log10(1 + 20000), 0, 1);
      comp.push({ cle: "RES", nom: "Reseau referent", valeur: v, poids: POIDS.RES, etat: "MESURE",
        brut: `${Number(m.valeur).toLocaleString("fr-FR")} sous-reseaux referents`, source: "majestic_million",
        dit: `${Number(m.valeur).toLocaleString("fr-FR")} sous-reseaux distincts pointent vers ce domaine` });
    } else if (m.etat === "MESURE_ABSENT") {
      comp.push({ cle: "RES", nom: "Reseau referent", valeur: 5, poids: POIDS.RES, etat: "MESURE_ABSENT",
        brut: "hors Majestic Million", source: "majestic_million",
        dit: "absent du million de domaines Majestic" });
    } else {
      comp.push({ cle: "RES", nom: "Reseau referent", valeur: null, poids: POIDS.RES, etat: "ANGLE_MORT",
        plage: [0, 100], brut: "non interroge", source: "majestic_million",
        dit: "la table Majestic n'a pas ete consultee pour ce domaine" });
    }
  }

  // --- PRO, proprete ------------------------------------------------------------------
  {
    const s = c.spam || {};
    if (s.etat === "MESURE" && s.verdict) {
      // Le score de spam est deja 0-100, croissant. On l'inverse.
      const v = 100 - clamp(Number(s.score ?? 0), 0, 100);
      comp.push({ cle: "PRO", nom: "Proprete", valeur: v, poids: POIDS.PRO, etat: "MESURE",
        brut: `${s.verdict}, score de spam ${s.score}`, source: "lecture_html",
        dit: `page lue : verdict ${s.verdict}${s.raisons ? `, ${s.raisons}` : ""}` });
    } else {
      // ⛔ NE PAS AVOIR LU LA PAGE N'EST PAS « PROPRE ». C'est un angle mort, son poids
      //    sort du socle, et la fourchette dit ce que ca couterait si le site etait sale.
      comp.push({ cle: "PRO", nom: "Proprete", valeur: null, poids: POIDS.PRO, etat: "ANGLE_MORT",
        plage: [0, 100], brut: "page non lue", source: "lecture_html",
        dit: "la page portante n'a pas ete ouverte : ni propre ni sale, non regarde" });
    }
  }

  // --- COH, coherence de sujet, lue sur le seul nom de domaine ------------------------
  {
    // ⛔ On ne lit QUE le nom de domaine, et on l'assume : lire la page couterait une
    //    requete par domaine referent, soit plusieurs milliers, et ce module existe
    //    justement pour noter les milliers de referents qu'on n'ouvrira jamais.
    // ⛔ UN NOM QUI NE PARLE PAS DE NOTRE SUJET N'EST PAS UNE FAUTE, d'ou une note neutre
    //    a 45 et jamais zero : un magazine generaliste ou un site d'actualite peut tres
    //    bien nous citer, et son lien vaut souvent mieux que celui d'un blog de niche.
    const d = String(c.domaine || "").toLowerCase();
    const touche = MOTS_SUJET.filter((m) => d.includes(m));
    const v = touche.length ? 100 : 45;
    comp.push({ cle: "COH", nom: "Coherence de sujet", valeur: v, poids: POIDS.COH, etat: "MESURE",
      brut: touche.length ? touche.slice(0, 3).join(", ") : "aucun terme du sujet",
      source: "nom_de_domaine",
      dit: touche.length
        ? `le nom de domaine porte « ${touche.slice(0, 3).join(" », « ")} »`
        : "le nom de domaine ne dit rien de notre sujet, ce qui n'est pas une faute : neutre" });
  }

  // --- agregation ---------------------------------------------------------------------
  const utiles = comp.filter((x) => x.valeur != null);
  const poidsUtiles = utiles.reduce((a, x) => a + x.poids, 0);
  const NE = poidsUtiles ? utiles.reduce((a, x) => a + x.valeur * x.poids, 0) / poidsUtiles : null;

  const poidsTotal = Object.values(POIDS).reduce((a, b) => a + b, 0);
  const socle = poidsUtiles / poidsTotal;

  // Fourchette : chaque angle mort a sa borne basse puis sa borne haute.
  const bas = comp.reduce((a, x) => a + (x.valeur != null ? x.valeur : (x.plage?.[0] ?? 0)) * x.poids, 0) / poidsTotal;
  const haut = comp.reduce((a, x) => a + (x.valeur != null ? x.valeur : (x.plage?.[1] ?? 100)) * x.poids, 0) / poidsTotal;

  return {
    NE: NE == null ? null : r1(NE),
    classe: NE == null ? "NON NOTE" : NE >= 55 ? "SOLIDE" : NE >= 30 ? "MOYEN" : "FAIBLE",
    socle: Math.round(socle * 100) / 100,
    // ⛔ Sous 50 % de socle on n'affiche pas un nombre : on affiche la fourchette. On ne
    //    range pas un domaine qu'on n'a pas mesure.
    affichable: socle >= 0.5,
    plage: [r1(bas), r1(haut)],
    composantes: comp,
    version: VERSION,
  };
}

// ---------------------------------------------------------------- ligne de commande
const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n, d = null) => {
    const v = (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
    return v === undefined ? d : v;
  };
  const DRY = process.argv.includes("--dry");
  const LIMITE = Number(arg("limite", 6000));

  const { obs } = lire();
  const photo = dernier(obs);

  // Les domaines EMETTEURS : ceux qui apparaissent comme objet d'un backlink.
  const emetteurs = [...new Set(
    photo.filter((o) => o.metrique === "liens_depuis_domaine" && o.objet?.domaine).map((o) => o.objet.domaine)
  )].slice(0, LIMITE);

  // ⛔ LES NOMS DE METRIQUES SE LISENT DANS LE JOURNAL, ILS NE SE DEVINENT PAS. Premiere
  //    version de ce fichier : elle cherchait « openpagerank » et « majestic_refsubnets »,
  //    qui n'existent pas. Les vrais noms sont « open_page_rank » et
  //    « sous_reseaux_referents ». Une cle mal nommee ne leve aucune erreur, elle rend
  //    simplement undefined, et toutes les notes seraient sorties en angle mort sans que
  //    rien ne le signale.
  const index = new Map();
  for (const o of photo) {
    const d = o.sujet?.domaine;
    if (!d) continue;
    if (!index.has(d)) index.set(d, {});
    index.get(d)[o.metrique] = o;
  }

  // Les signaux de spam vivent dans le DETAIL d'un lien qualifie, indexe par le domaine
  // EMETTEUR (objet.domaine), et pas par le sujet. On les remonte a part.
  const spamParEmetteur = new Map();
  for (const o of photo) {
    if (o.metrique !== "lien_qualifie") continue;
    const e = o.objet?.domaine;
    const d = o.objet?.detail;
    if (!e || !d || !d.spam) continue;
    const v = d.spam.verdict || d.spam;
    const sc = typeof d.spam.score === "number" ? d.spam.score : null;
    const prec = spamParEmetteur.get(e);
    // Le pire verdict l'emporte : un site qui porte une page sale ne se rachete pas
    // avec une page propre.
    if (!prec || (sc != null && sc > (prec.score ?? -1))) {
      spamParEmetteur.set(e, {
        verdict: v, score: sc,
        raisons: Array.isArray(d.spam.signaux) ? d.spam.signaux.map((x) => x.code).slice(0, 3).join(", ") : null,
      });
    }
  }

  const run = nouveauRun("note-emetteur");
  console.log(`Vigie SEO — note des sites emetteurs · ${emetteurs.length} domaine(s)${DRY ? " · --dry" : ""}\n`);

  const sortie = [];
  const repartition = { SOLIDE: 0, MOYEN: 0, FAIBLE: 0, "NON NOTE": 0 };
  for (const d of emetteurs) {
    const s = index.get(d) || {};
    const sp = spamParEmetteur.get(d) || null;
    const n = noteEmetteur({
      domaine: d,
      tranco: s.tranco_rang ? { rang: s.tranco_rang.valeur, etat: s.tranco_rang.etat } : { etat: null },
      opr: s.open_page_rank ? { valeur: s.open_page_rank.valeur, etat: s.open_page_rank.etat } : { etat: null },
      refSubNets: s.sous_reseaux_referents
        ? { valeur: s.sous_reseaux_referents.valeur, etat: s.sous_reseaux_referents.etat } : { etat: null },
      spam: sp ? { verdict: sp.verdict, score: sp.score, raisons: sp.raisons, etat: "MESURE" } : { etat: null },
    });
    repartition[n.classe]++;
    sortie.push(observation({
      type: "note", sujet: { domaine: d }, metrique: "note_emetteur",
      valeur: n.affichable ? n.NE : null,
      valeur_min: n.plage[0], valeur_max: n.plage[1],
      unite: "point",
      nature: "derive",
      etat: n.affichable ? "MESURE" : "ANGLE_MORT",
      source: { nom: "vigie_note_emetteur", endpoint: VERSION, http: null, methode: "jointure" },
      preuve: n.composantes.map((c) => `${c.cle} ${c.valeur == null ? "▲" : r1(c.valeur)} (${c.brut})`).join(" · "),
      run_id: run, collecteur: VERSION,
      drapeaux: n.affichable ? [] : ["socle_insuffisant"],
    }));
  }

  console.log(`  solides ${repartition.SOLIDE} · moyens ${repartition.MOYEN} · faibles ${repartition.FAIBLE} · non notes ${repartition["NON NOTE"]}`);
  console.log(DRY
    ? `\n--dry : ${sortie.length} observations NON ecrites.`
    // ⛔ doublonsAutorises POUR LES NOTES, et c'est le contraire de la regle generale.
    //    obs_id porte la journee : une note recalculee le meme jour porte le meme
    //    identifiant qu'une note calculee deux heures plus tot, et l'ecriture idempotente
    //    la REJETTE. Mesure du 21/08/2026 : apres avoir enfin obtenu les rangs Tranco des
    //    2 216 emetteurs, le recalcul a rendu « 0 observation ecrite » et le site a
    //    continue d'afficher les notes d'avant, calculees sans ces rangs. Une note n'est
    //    pas une mesure, c'est un CALCUL sur des mesures : il change quand ses entrees
    //    changent, et il doit pouvoir s'ecrire plusieurs fois dans la journee.
    : `\n${ecrire(sortie, { doublonsAutorises: true })} observation(s) ecrite(s) (${sortie.length} calculee(s)).`);
}
