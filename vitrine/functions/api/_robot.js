// LE ROBOT, ET SON UNITE DE TRAVAIL.
//
// Il ne tourne sur aucun PC : il vit dans le nuage, et il avance par TOURS. Un tour
// fait une petite quantite de travail puis rend la main. C'est ce qui lui permet de
// tenir dans les plafonds d'un palier gratuit :
//
//   ⛔ 50 sous-requetes par invocation. Un tour de verification ouvre au plus 20
//      pages (page + robots.txt eventuel), jamais davantage.
//   ⛔ Le processeur d'une Function gratuite se compte en millisecondes. Tout le
//      temps passe ici est du temps d'attente reseau, qui ne compte pas ; aucun
//      calcul lourd n'a sa place dans ce fichier.
//
// Deux appelants : le declencheur horaire du Worker `vigie-robot`, et le bouton de
// la vitrine, qui fait un tour immediat pour que l'utilisateur voie quelque chose
// bouger tout de suite.

import {
  MAINTENANT, domaineDe, memeSite, liensVers, qualifierRel,
  reglesRobots, cheminAutorise, ouvrirPage,
} from "./_commun.js";
import { trouverCandidats } from "./_decouverte.js";


/**
 * LES PAGES OU VIVENT LES LIENS SORTANTS.
 *
 * ⛔ LE CONSTAT QUI JUSTIFIE CE SECOND NIVEAU, MESURE LE 21/08/2026 :
 *    la source « reciproque » met en file l'ACCUEIL des sites que la cible cite
 *    elle-meme. Huit accueils de partenaires ouverts, zero lien trouve. C'est normal
 *    et ce n'est pas une absence de lien : un partenaire ne met presque jamais ses
 *    liens sortants sur son accueil, il les met sur « /partenaires », « /integrations »,
 *    « /outils », « /avis ». Ces pages-la ne sont indexees nulle part et aucun moteur
 *    ne les rendra jamais en resultat.
 *
 *    On les atteint donc en descendant d'un cran : une page candidate qui s'ouvre sans
 *    porter de lien vers la cible offre ses propres liens internes, et ceux dont
 *    l'adresse ressemble a une page de liens repartent en file. UN SEUL cran : au-dela,
 *    le budget part en exploration au lieu de mesure.
 */
const PAGES_A_LIENS =
  /(partenaire|partner|integration|ecosyst|marketplace|annuaire|director|outil|tool|app|logiciel|software|ressource|resource|avis|review|comparat|alternativ|lien|link|blog|actualit|news|presse|press|a-propos|about|nos-|our-)/i;

/** Jusqu'a « combien » pages internes d'une page ouverte, qui promettent des liens. */
function pagesInternesProbables(html, hote, combien = 4) {
  const vues = new Set();
  const sortie = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null && sortie.length < combien) {
    const brut = m[1].trim();
    if (!brut || brut.startsWith("#") || /^(javascript|mailto|tel):/i.test(brut)) continue;
    let u;
    try { u = new URL(brut, "https://" + hote + "/"); } catch { continue; }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    if (domaineDe(u.href) !== hote) continue;
    const chemin = u.pathname;
    if (chemin === "/" || chemin.length > 90) continue;
    if (!PAGES_A_LIENS.test(chemin)) continue;
    if (/\.(jpe?g|png|gif|webp|svg|pdf|zip|css|js|ico)$/i.test(chemin)) continue;
    const propre = u.origin + chemin;
    if (vues.has(propre)) continue;
    vues.add(propre);
    sortie.push(propre);
  }
  return sortie;
}

// ⛔ LE PLAFOND EST DE 50 SOUS-REQUETES PAR INVOCATION, ET UNE REQUETE D1 EN EST UNE.
//    C est le piege le plus couteux de tout ce fichier, parce qu il est SILENCIEUX.
//    Un tour de dix-huit pages consommait : dix-huit lectures de robots.txt en base,
//    jusqu a dix-huit telechargements de robots.txt, dix-huit ouvertures de page, plus
//    la demi-douzaine de requetes de gestion de la file. Soixante-dix a quatre-vingts.
//    Le `bd.batch()` place APRES la boucle tombait donc systematiquement au-dela du
//    plafond : toutes les ecritures du tour, liens compris, partaient a la poubelle.
//    A l ecran, ca se lit « le robot a ouvert vingt-trois pages et trouve zero lien »,
//    ce qui ressemble exactement a un site sans backlinks.
//
//    Deux remedes, et il faut les deux. D abord un budget assume : dix pages par tour,
//    soit environ trente-cinq sous-requetes au pire. Ensuite l ecriture PAR PAQUETS AU
//    FIL DE LA BOUCLE plutot qu une seule fois a la fin : si le plafond tombe malgre
//    tout, on perd le dernier paquet, pas le tour entier.
export const BUDGET_SOUS_REQUETES = 50;
export const PAGES_PAR_TOUR = 10;
export const PLAFOND_CANDIDATS = 140;

/**
 * Ecrit un paquet d enonces et VIDE le tableau, en place.
 *
 * ⛔ UN ECHEC D ECRITURE NE DOIT JAMAIS PASSER POUR UN RESULTAT VIDE. Si le paquet
 *    ne passe pas, on le dit dans le compte rendu du tour : « n ecriture(s) perdue(s) »
 *    est une information, « 0 lien trouve » serait un mensonge.
 */
async function viderEcritures(bd, ecritures) {
  if (!ecritures.length) return 0;
  const paquet = ecritures.splice(0, ecritures.length);
  try {
    await bd.batch(paquet);
    return 0;
  } catch (e) {
    console.log("ecriture refusee :", e.message);
    return paquet.length;
  }
}

/** Met la cible en file, ou remonte sa priorite si elle y est deja. */
export async function demanderCrawl(bd, cible, demandeur) {
  const existe = await bd
    .prepare("SELECT cible, etat FROM file_crawl WHERE cible = ?")
    .bind(cible)
    .first();

  if (!existe) {
    await bd
      .prepare(
        `INSERT INTO file_crawl (cible, etat, phase_msg, demande_le, demandeur, priorite)
         VALUES (?, 'attente', 'en file', ?, ?, 1)`
      )
      .bind(cible, MAINTENANT(), demandeur || null)
      .run();
    return { etat: "attente", neuf: true };
  }

  if (existe.etat === "fini" || existe.etat === "mur") {
    await bd
      .prepare(
        `UPDATE file_crawl SET etat = 'attente', phase_msg = 'reprise demandee',
           demande_le = ?, demandeur = ?, priorite = 1 WHERE cible = ?`
      )
      .bind(MAINTENANT(), demandeur || null, cible)
      .run();
    return { etat: "attente", neuf: false };
  }

  return { etat: existe.etat, neuf: false };
}

/** L'etat lisible d'une cible en file. */
export async function etatCrawl(bd, cible) {
  const l = await bd
    .prepare(
      `SELECT etat, phase_msg, demande_le, passe_le, fini_le, pages_lues,
              candidats_vus, liens_trouves, rapport FROM file_crawl WHERE cible = ?`
    )
    .bind(cible)
    .first();
  if (!l) return null;
  const restants = await bd
    .prepare("SELECT COUNT(*) AS n FROM candidats WHERE cible = ? AND etat = 'attente'")
    .bind(cible)
    .first();
  let sources = null;
  try { sources = l.rapport ? JSON.parse(l.rapport) : null; } catch { sources = null; }
  return { ...l, rapport: undefined, sources, restants: restants?.n ?? 0 };
}

/**
 * UN TOUR DE ROBOT sur la cible donnee, ou sur la premiere de la file.
 * Rend toujours un compte rendu, jamais une exception.
 */
export async function unTour(bd, cibleVoulue = null, budgetPages = PAGES_PAR_TOUR, ignorerBail = false) {
  const tache = cibleVoulue
    ? await bd.prepare("SELECT * FROM file_crawl WHERE cible = ?").bind(cibleVoulue).first()
    : await bd
        .prepare(
          `SELECT * FROM file_crawl WHERE etat IN ('attente','candidats','verification')
            ORDER BY priorite ASC, demande_le ASC LIMIT 1`
        )
        .first();

  if (!tache) return { fait: "rien", pourquoi: "file vide" };
  const cible = tache.cible;

  // ⛔ ON PREND UN BAIL AVANT DE TRAVAILLER, ET C EST OBLIGATOIRE.
  //    Deux appelants existent en permanence : le bouton de la vitrine et le
  //    declencheur horaire. Sans bail, ils se sont lances sur la meme cible a dix
  //    secondes d intervalle et ont TOUS DEUX refait la phase de decouverte : les
  //    memes moteurs interroges deux fois, et la phase de lecture jamais atteinte.
  //    La mise a jour ci-dessous ne passe que si personne n a touche la ligne depuis
  //    quatre-vingt-dix secondes ; sinon on rend la main sans rien faire. Le delai
  //    est plus long qu un tour, pour qu un tour lent ne se fasse pas voler sa tache,
  //    et plus court qu un abandon, pour qu un tour mort ne bloque pas la file.
  // `ignorerBail` sert au CHAINAGE : la vitrine enchaine decouverte puis lecture dans
  // la meme requete, et le second tour ne doit pas buter sur le bail que le premier
  // vient de poser lui-meme.
  const bail = new Date(Date.now() - (ignorerBail ? -1000 : 90000)).toISOString();
  const pris = await bd
    .prepare("UPDATE file_crawl SET passe_le = ? WHERE cible = ? AND (passe_le IS NULL OR passe_le < ?)")
    .bind(MAINTENANT(), cible, bail)
    .run();
  if (!pris.meta || pris.meta.changes === 0) {
    return { fait: "rien", cible, pourquoi: "un autre tour travaille deja sur cette cible" };
  }

  // ---------------------------------------------------------- phase 1 : trouver
  if (tache.etat === "attente" || tache.etat === "candidats") {
    const { candidats, rapport } = await trouverCandidats(bd, cible, PLAFOND_CANDIDATS);

    if (candidats.length) {
      // D1 n'aime pas les insertions unitaires en boucle : on groupe.
      const lots = [];
      for (const c of candidats) {
        lots.push(
          bd
            .prepare(
              `INSERT INTO candidats (cible, url, origine, etat, ajoute_le)
               VALUES (?, ?, ?, 'attente', ?)
               ON CONFLICT(cible, url) DO NOTHING`
            )
            .bind(cible, c.url, c.origine, MAINTENANT())
        );
      }
      await bd.batch(lots);
    }

    const muettes = rapport.filter((x) => x.etat === "ANGLE_MORT").map((x) => x.source);
    const message =
      `${candidats.length} pages a ouvrir` +
      (muettes.length ? ` · ${muettes.length} source(s) muette(s) : ${muettes.join(", ")}` : "");

    await bd
      .prepare(
        `UPDATE file_crawl SET etat = 'verification', phase_msg = ?, rapport = ?,
                candidats_vus = candidats_vus + ?
          WHERE cible = ?`
      )
      .bind(message, JSON.stringify(rapport), candidats.length, cible)
      .run();

    return { fait: "decouverte", cible, candidats: candidats.length, rapport };
  }

  // ---------------------------------------------------- phase 2 : ouvrir et lire
  const aLire = await bd
    .prepare("SELECT url, origine FROM candidats WHERE cible = ? AND etat = 'attente' LIMIT ?")
    .bind(cible, budgetPages)
    .all();

  const pages = aLire.results || [];
  if (!pages.length) {
    const total = await bd
      .prepare("SELECT COUNT(*) AS n FROM backlinks WHERE cible = ?")
      .bind(cible)
      .first();
    await bd
      .prepare(
        `UPDATE file_crawl SET etat = 'fini', fini_le = ?, phase_msg = ? WHERE cible = ?`
      )
      .bind(MAINTENANT(), `${total?.n ?? 0} liens confirmes`, cible)
      .run();
    return { fait: "fini", cible, liens: total?.n ?? 0 };
  }

  let lus = 0;
  let murs = 0;
  let liens = 0;
  let perdues = 0;
  let descendus = 0;
  let mentions = 0;
  const ecritures = [];

  for (const page of pages) {
    const hote = domaineDe(page.url);
    if (!hote || memeSite(hote, cible)) {
      ecritures.push(bd.prepare("UPDATE candidats SET etat = 'vide' WHERE cible = ? AND url = ?").bind(cible, page.url));
      continue;
    }

    // ⛔ LA POLITESSE PASSE AVANT LA MESURE. Un robot qui ignore robots.txt fait
    //    bannir l'adresse, et il grille le site aupres de celui qu'on voulait
    //    justement convaincre de nous publier.
    const regles = await reglesRobots(bd, hote);
    let chemin = "/";
    try { chemin = new URL(page.url).pathname; } catch { /* garde "/" */ }
    if (!cheminAutorise(regles, chemin)) {
      murs++;
      ecritures.push(bd.prepare("UPDATE candidats SET etat = 'mur' WHERE cible = ? AND url = ?").bind(cible, page.url));
      continue;
    }

    const res = await ouvrirPage(page.url);
    lus++;

    if (res.mur) {
      murs++;
      ecritures.push(bd.prepare("UPDATE candidats SET etat = 'mur' WHERE cible = ? AND url = ?").bind(cible, page.url));
      continue;
    }

    const trouves = liensVers(res.html, cible);
    // On ne garde que les liens qui pointent VRAIMENT vers le domaine cible : le
    // simple fait que la chaine apparaisse dans l'URL ne suffit pas (un lien vers
    // « annuaire.fr/fiche/exemple.com » n'est pas un lien vers exemple.com).
    const retenus = [];
    for (const t of trouves) {
      let absolue;
      try { absolue = new URL(t.url, page.url).toString(); } catch { continue; }
      const dest = domaineDe(absolue);
      if (!dest || !memeSite(dest, cible)) continue;
      retenus.push({ ...t, url: absolue });
    }

    if (retenus.length) {
      for (const t of retenus.slice(0, 12)) {
        liens++;
        ecritures.push(
          bd
            .prepare(
              `INSERT INTO backlinks
                 (cible, domaine_src, url_src, url_dest, ancre, rel, rel_brut, etat, vu_le, source_donnee)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'MESURE', ?, ?)
               ON CONFLICT(cible, url_src, url_dest) DO UPDATE SET
                 ancre = excluded.ancre, rel = excluded.rel, rel_brut = excluded.rel_brut,
                 etat = 'MESURE', vu_le = excluded.vu_le`
            )
            .bind(
              cible, hote, page.url, t.url, t.ancre || null,
              qualifierRel(t.relBrut), t.relBrut || "", MAINTENANT(), page.origine
            )
        );
      }
      ecritures.push(bd.prepare("UPDATE candidats SET etat = 'lu' WHERE cible = ? AND url = ?").bind(cible, page.url));
      // On vide des que le paquet est consequent : une ecriture differee jusqu a la fin
      // du tour est une ecriture qu on perd entierement si le plafond tombe avant.
      if (ecritures.length >= 25) perdues += await viderEcritures(bd, ecritures);
    } else {
      // ⛔ « AUCUN LIEN » ET « AUCUNE MENTION » NE SONT PAS LA MEME CHOSE.
      //    Une page peut nommer le domaine en toutes lettres sans qu aucune balise <a>
      //    ne pointe vers lui. Trois causes, toutes vues le 21/08/2026 : le lien est
      //    pose par du JavaScript et n existe pas dans le HTML servi ; il passe par un
      //    redirecteur d affiliation, donc son adresse ne contient pas le domaine ; ou
      //    le site cite sans lier. Ranger ces pages avec les pages reellement vides
      //    reviendrait a affirmer « personne ne parle de vous » alors qu on a lu le
      //    contraire. Elles sortent donc dans leur propre categorie.
      const citee = res.html.toLowerCase().includes(cible.toLowerCase());
      ecritures.push(
        bd.prepare("UPDATE candidats SET etat = ? WHERE cible = ? AND url = ?")
          .bind(citee ? "mention" : "vide", cible, page.url)
      );
      if (citee) mentions++;

      // ...et on descend d'un cran, une seule fois, vers ses pages a liens.
      if (!String(page.origine).endsWith("-p2")) {
        for (const interne of pagesInternesProbables(res.html, hote)) {
          ecritures.push(
            bd
              .prepare(
                `INSERT INTO candidats (cible, url, origine, etat, ajoute_le)
                 VALUES (?, ?, ?, 'attente', ?) ON CONFLICT(cible, url) DO NOTHING`
              )
              .bind(cible, interne, page.origine + "-p2", MAINTENANT())
          );
          descendus++;
        }
      }
    }
  }

  // Le reste du paquet, s il en reste.
  await viderEcritures(bd, ecritures);

  const restants = await bd
    .prepare("SELECT COUNT(*) AS n FROM candidats WHERE cible = ? AND etat = 'attente'")
    .bind(cible)
    .first();

  await bd
    .prepare(
      `UPDATE file_crawl
          SET pages_lues = pages_lues + ?, liens_trouves = liens_trouves + ?,
              phase_msg = ?, etat = ?
        WHERE cible = ?`
    )
    .bind(
      lus, liens,
      `${restants?.n ?? 0} pages restantes`,
      (restants?.n ?? 0) > 0 ? "verification" : "fini",
      cible
    )
    .run();

  if ((restants?.n ?? 0) === 0) {
    await bd.prepare("UPDATE file_crawl SET fini_le = ? WHERE cible = ?").bind(MAINTENANT(), cible).run();
  }

  return { fait: "verification", cible, pages_lues: lus, murs, liens, descendus, mentions, perdues, restants: restants?.n ?? 0 };
}
