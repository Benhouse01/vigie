// MESURE : depuis quand un lien entrant est visible, en datant les captures de sa page.
// SOURCE : l'index CDX et les captures de la Wayback Machine, plus notre propre journal.
// NE DIT PAS : la date d'acquisition d'un lien. L'archive date des PAGES, pas des liens.
//
// Un collecteur de backlinks donne le domaine referent, collecte-rel.mjs donne l'URL et le
// rel, il manque le TEMPS. Sans le temps, on ne sait pas si un lien est un acquis ancien ou
// une prise recente, et on ne sait pas non plus depuis quand un lien tombe est tombe.
//
// ⛔ LES URL CITEES DANS LES COMMENTAIRES SONT DES EXEMPLES, LES MESURES SONT REELLES.
//    Elles datent du 21/08/2026 et portent sur de vraies pages ; les adresses sont
//    remplacees ici par annuaire-exemple.fr, blog-exemple.com et partenaire-exemple.com.
//
// ⛔ CE COLLECTEUR MESURE TROIS CHOSES DIFFERENTES, ET LES CONFONDRE EST L'ERREUR MEME.
//
//   1. premiere_capture / derniere_capture  (nature : mesure)
//      Quand l'archive a photographie la PAGE. Ce n'est PAS la date du LIEN. La page
//      d'accueil d'un annuaire est archivee depuis 2014 alors que notre fiche y a au plus
//      trois mois. Publier « backlink acquis en 2014 » sur cette base serait un mensonge
//      de tableau.
//
//   2. apparition_lien_estimee              (nature : estimation)
//      La ou le lien devient visible, obtenue en telechargeant plusieurs captures et en
//      regardant dans LAQUELLE le lien apparait pour la premiere fois. C'est un
//      ENCADREMENT, pas une date : « entre le <derniere capture sans> et le <premiere
//      capture avec> ». Les deux bornes partent avec la ligne, dans valeur_min/valeur_max.
//      ⛔ La dichotomie SUPPOSE QUE LE LIEN NE DISPARAIT PAS PUIS NE REVIENT PAS. Un lien
//         retire puis remis casse l'hypothese et la dichotomie peut sauter par-dessus la
//         vraie premiere apparition. Le drapeau `dichotomie_suppose_monotone` part avec
//         chaque ligne pour que le site ne presente jamais ca comme un fait.
//
//   3. premiere_vue_par_nous                (nature : mesure)
//      La premiere fois que NOTRE journal a vu ce lien. Celle-la est fiable a 100 % : on
//      la lit dans nos propres lignes. Mais c'est un PLANCHER, pas une date d'acquisition :
//      un journal a une premiere ligne, et tout lien plus ancien qu'elle apparait « ce
//      jour-la » sans y etre ne. Le drapeau porte la date de debut du journal, lue dans le
//      journal lui-meme et non supposee.
//
// ⛔ L'ARCHIVE QUI NE REPOND RIEN N'EST PAS UN ECHEC. Un CDX qui rend « [] » est une VRAIE
//    mesure : cette URL n'a jamais ete capturee. Etat MESURE_ABSENT, pas ANGLE_MORT.
//    Mesure du 21/08/2026 : deux fiches recentes (du genre annuaire-exemple.fr/mon-produit
//    et blog-exemple.com/startups/mon-produit, exemples) rendaient toutes les deux « [] »,
//    alors que la racine du meme annuaire a 124 captures. Une page recente n'est pas
//    archivee, et ca ne veut pas dire que le lien n'existe pas.
//    Un 429 ou un delai depasse, en revanche, est un ANGLE_MORT : l'archive n'a pas
//    repondu, on n'a rien mesure du tout.
//
// ⛔ LE CDX EST LENT ET IL FAUT L'ACCEPTER. Mesures du 21/08 : 5,6 s, 28 s et 53 s pour
//    les trois formes d'appel sur la meme URL. Un timeout a 15 s (le defaut du socle)
//    transformerait la moitie des mesures en angles morts imaginaires.
//
// ⛔ AUCUNE URL D'EXEMPLE N'EST CABLEE DANS CE FICHIER. Les pages a dater viennent du
//    journal (les lignes « lien_qualifie » et « lien_present » ecrites par collecte-rel.mjs)
//    ou de --urls. Quand le journal n'en porte aucune, le collecteur s'arrete en le disant :
//    se rabattre sur une liste ecrite en dur ferait dater les liens de quelqu'un d'autre.
//
// Usage :
//   node outils/collecte-wayback.mjs --cible=exemple.com --limite=10 --dry
//   node outils/collecte-wayback.mjs --urls=https://partenaire-exemple.com/partenaires/ --dry
//
// Options :
//   --cible=<domaine>   le domaine dont on date les liens entrants. Defaut : le premier
//                       domaine du role « nous » dans la configuration.
//   --limite=<n>        nombre d URL sources traitees                  (defaut 20)
//   --urls=a,b          force la liste des pages sources
//   --tel=<n>           telechargements d archives par URL au maximum  (defaut 6, 0 = pas de dichotomie)
//   --dry               n ecrit rien, affiche seulement

import { recuperer, hote, liensVers, texteDe } from "./_lib-liens.mjs";
import { observation, ecrire, lire, nouveauRun, config } from "./_lib-obs.mjs";

const VERSION = "collecte-wayback@1.0.0";

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || null;
const DRY = process.argv.includes("--dry");

const cfg = config();
// La cible par defaut est le PREMIER domaine du role « nous » : c'est celui dont on date
// ses propres liens. --cible= sert a dater ceux d'un concurrent, la mecanique est la meme.
const CIBLE = String(arg("cible") || cfg.nous?.[0]?.domaine || "").replace(/^www\./i, "").toLowerCase();
if (!CIBLE) {
  // Une configuration sans domaine « nous » n'est pas une mesure vide, c'est une panne de
  // configuration : elle doit ressembler a une panne, pas a une absence de backlinks.
  console.error("aucune cible a dater : passe --cible=<domaine>, ou declare au moins un domaine");
  console.error("sous « nous » dans config/domaines.json (ou le fichier que designe VIGIE_CONFIG).");
  process.exit(1);
}
const LIMITE = Number(arg("limite") || 20);
const MAX_TEL = Number(arg("tel") ?? 6);

const CDX_DELAI = 70000;      // mesure : 53 s sur un appel limit=-1, le socle plafonne a 15 s
const ARCHIVE_DELAI = 45000;
const ENTRE_APPELS = 1800;    // web.archive.org repond 429 quand on le martele

let dernierAppelArchive = 0;
async function poliArchive() {
  const reste = ENTRE_APPELS - (Date.now() - dernierAppelArchive);
  if (reste > 0) await new Promise((r) => setTimeout(r, reste));
  dernierAppelArchive = Date.now();
}

const jours = (iso) => Math.round((Date.now() - Date.parse(iso)) / 86400000);

/** « 20240612093015 » -> « 2024-06-12T09:30:15Z ». */
function versIso(ts) {
  const s = String(ts);
  if (!/^\d{14}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
}

// ---------------------------------------------------------------- appels CDX

/**
 * Un appel au CDX. Rend { etat, lignes } avec les trois etats du chantier :
 *   MESURE        la reponse est un tableau exploitable
 *   MESURE_ABSENT la reponse est « [] » : l archive n a jamais capture cette URL
 *   ANGLE_MORT    429, timeout, ou corps illisible : on n a rien mesure
 */
async function cdx(url, params) {
  const endpoint = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&${params}`;

  // ⛔ UN SEUL ESSAI TRANSFORME UNE PANNE PASSAGERE EN ANGLE MORT DEFINITIF. Mesure du
  //    21/08/2026 : le meme appel qui rendait 200 en 5,6 s a rendu 503 puis 504 dix
  //    minutes plus tard, sur deux URL differentes. Le CDX est un service surcharge, pas
  //    un mur. On rejoue UNE fois apres 5 s, et si ca echoue encore c'est un vrai angle
  //    mort qu'on assume, avec les deux codes dans la preuve.
  let r = null, premierCode = null;
  for (let essai = 0; essai < 2; essai++) {
    if (essai) await new Promise((x) => setTimeout(x, 5000));
    await poliArchive();
    r = await recuperer(endpoint, { timeout: CDX_DELAI });
    if (r.ok && r.http === 200) break;
    if (premierCode === null) premierCode = r.ok ? r.http : r.erreur;
  }
  const historique = premierCode !== null ? ` (premier essai : ${premierCode})` : "";

  if (!r.ok) return { etat: "ANGLE_MORT", endpoint, http: null, preuve: `l archive n a pas repondu : ${r.erreur}${historique}` };
  if (r.http === 429) return { etat: "ANGLE_MORT", endpoint, http: 429, preuve: `429 : l archive nous limite, la mesure n a pas eu lieu${historique}` };
  if (r.http !== 200) return { etat: "ANGLE_MORT", endpoint, http: r.http, preuve: `HTTP ${r.http} sur le CDX${historique}` };

  const corps = r.html.trim();
  if (!corps || corps === "[]") {
    // ⛔ VRAIE MESURE : l archive dit « rien », comme Tranco dit {"ranks": []}.
    return { etat: "MESURE_ABSENT", endpoint, http: 200, lignes: [], preuve: "le CDX rend un tableau vide : cette URL n a jamais ete capturee" };
  }
  let j;
  try { j = JSON.parse(corps); } catch {
    return { etat: "ANGLE_MORT", endpoint, http: 200, preuve: `le CDX a rendu autre chose que du JSON : ${corps.slice(0, 120)}` };
  }
  if (!Array.isArray(j) || j.length < 2) {
    return { etat: "MESURE_ABSENT", endpoint, http: 200, lignes: [], preuve: "le CDX rend un en-tete sans aucune ligne" };
  }
  const entete = j[0];
  const lignes = j.slice(1).map((l) => Object.fromEntries(entete.map((c, i) => [c, l[i]])));
  return { etat: "MESURE", endpoint, http: 200, lignes, preuve: `${lignes.length} ligne(s) rendues par le CDX` };
}

// ---------------------------------------------------------------- lecture d une archive

/**
 * Telecharge une capture et dit si le lien vers la cible y est.
 *
 * ⛔ LE SUFFIXE `id_` EST OBLIGATOIRE. Sans lui, la Wayback Machine reecrit tous les
 *    href en /web/<ts>/<url> et injecte sa propre barre d outils : on lit alors une page
 *    que personne n a jamais servie. Avec `id_`, on recoit l original octet pour octet,
 *    donc le vrai href et le vrai rel. On garde quand meme un repli sans `id_`, parce
 *    que certaines captures ne sont servies que par la voie reecrite.
 */
async function captureContientLeLien(ts, url) {
  for (const suffixe of ["id_", ""]) {
    const u = `https://web.archive.org/web/${ts}${suffixe}/${url}`;
    await poliArchive();
    const r = await recuperer(u, { timeout: ARCHIVE_DELAI });
    if (!r.ok || r.http !== 200 || !r.html) continue;
    // La page « cette URL n a pas ete archivee » est servie en 200 avec un corps court.
    if (r.html.length < 1500 && /wayback machine|has not archived/i.test(r.html)) continue;
    const liens = liensVers(r.html, CIBLE);
    return {
      lu: true, url: u, octets: r.octets, reecrite: suffixe === "",
      present: liens.length > 0,
      // La citation sans lien est une autre information : la page parle de nous mais ne lie pas.
      cite: texteDe(r.html).toLowerCase().includes(CIBLE),
      exemple: liens[0] ? `${liens[0].url} rel=${liens[0].rel ?? "(aucun)"}` : null,
    };
  }
  return { lu: false, url: `https://web.archive.org/web/${ts}id_/${url}`, present: null };
}

/**
 * Cherche la PREMIERE capture qui porte le lien, par dichotomie, dans un budget ferme.
 * Rend l encadrement { avant, apres } : derniere capture SANS le lien, premiere AVEC.
 */
async function chercherApparition(captures, url, budget) {
  const journal = [];
  let restant = budget;
  if (!captures.length || restant <= 0) return { etat: "budget", journal, restant };

  // 1. La capture la PLUS RECENTE. Si le lien n y est pas, il n y a rien a dater :
  //    soit il a ete retire, soit l archive ne rend pas la partie de page qui le porte.
  const derniere = captures[captures.length - 1];
  restant--;
  const cd = await captureContientLeLien(derniere.timestamp, url);
  journal.push(`${derniere.timestamp} ${cd.lu ? (cd.present ? "lien PRESENT" : cd.cite ? "cite sans lien" : "sans lien") : "non lue"}`);
  if (!cd.lu) return { etat: "archive_illisible", journal, restant };
  if (!cd.present) return { etat: "absent_partout", journal, restant, derniere, cd };

  // 2. La capture la PLUS ANCIENNE. Si le lien y est deja, il precede l archive : on ne
  //    peut donner qu une borne haute, et on le dit au lieu de renvoyer cette date.
  const premiere = captures[0];
  if (premiere.timestamp === derniere.timestamp) {
    return { etat: "capture_unique", journal, restant, apres: derniere };
  }
  restant--;
  const cp = await captureContientLeLien(premiere.timestamp, url);
  journal.push(`${premiere.timestamp} ${cp.lu ? (cp.present ? "lien PRESENT" : "sans lien") : "non lue"}`);
  if (cp.lu && cp.present) {
    return { etat: "avant_l_archive", journal, restant, apres: premiere };
  }

  // 3. Dichotomie entre « connue sans » (lo) et « connue avec » (hi).
  let lo = cp.lu ? 0 : 0;                 // index de la derniere capture SANS le lien
  let hi = captures.length - 1;           // index de la premiere capture AVEC le lien
  let loConnu = cp.lu && !cp.present;
  while (hi - lo > 1 && restant > 0) {
    const mid = Math.floor((lo + hi) / 2);
    restant--;
    const c = await captureContientLeLien(captures[mid].timestamp, url);
    journal.push(`${captures[mid].timestamp} ${c.lu ? (c.present ? "lien PRESENT" : "sans lien") : "non lue"}`);
    if (!c.lu) { lo = mid; continue; }     // capture illisible : on la traite comme non concluante
    if (c.present) hi = mid; else { lo = mid; loConnu = true; }
  }
  return {
    etat: hi - lo > 1 ? "encadrement_grossier" : "encadre",
    journal, restant,
    avant: loConnu ? captures[lo] : null,
    apres: captures[hi],
  };
}

// ---------------------------------------------------------------- notre propre journal

/**
 * Depuis quand NOTRE journal connait ce lien. Fiable, mais c est un plancher : il ne
 * peut rien dire d anterieur a sa premiere ligne.
 */
function premiereVueParNous(obsToutes, url, referent) {
  const debutJournal = obsToutes.reduce((m, o) => (!m || o.date_mesure < m ? o.date_mesure : m), null);
  const surUrl = obsToutes.filter((o) => o.objet?.url === url);
  const surDomaine = obsToutes.filter((o) =>
    o.type === "backlink" && o.sujet?.domaine === CIBLE && o.objet?.domaine === referent);
  const lot = surUrl.length ? surUrl : surDomaine;
  if (!lot.length) return { trouve: false, debutJournal };
  const plusAncienne = lot.reduce((m, o) => (o.date_mesure < m.date_mesure ? o : m));
  return {
    trouve: true, debutJournal,
    date: plusAncienne.date_mesure,
    granularite: surUrl.length ? "url" : "domaine",
    obs_id: plusAncienne.obs_id,
    collecteur: plusAncienne.collecteur,
    metrique: plusAncienne.metrique,
  };
}

// ---------------------------------------------------------------- traitement d une URL

async function dater(url, obsToutes, run) {
  const obs = [];
  const referent = hote(url);
  const commun = {
    type: "backlink",
    sujet: { domaine: CIBLE },
    run_id: run, collecteur: VERSION,
  };

  // --- 1. premiere capture. Sans filtre : la toute premiere fois que l archive a vu
  //        cette URL, meme si elle rendait alors un 403 (cas vu sur un annuaire en 2010).
  const p = await cdx(url, "fl=timestamp,original,statuscode&limit=1");
  const l0 = p.lignes?.[0];
  obs.push(observation({
    ...commun,
    objet: { domaine: referent, url, detail: p.etat === "MESURE" ? { timestamp: l0.timestamp, statuscode: l0.statuscode, original: l0.original } : null },
    metrique: "premiere_capture",
    valeur: p.etat === "MESURE" ? jours(versIso(l0.timestamp)) : null,
    unite: "jour",
    nature: p.etat === "MESURE" ? "mesure" : p.etat === "MESURE_ABSENT" ? "mesure_absente" : "mesure_absente",
    etat: p.etat,
    source: { nom: "wayback_cdx", endpoint: p.endpoint, http: p.http, methode: "fetch" },
    date_donnee: p.etat === "MESURE" ? versIso(l0.timestamp) : null,
    preuve: p.etat === "MESURE"
      ? `premiere capture de la PAGE le ${versIso(l0.timestamp)} (HTTP ${l0.statuscode} a l epoque). ⛔ ce n est pas la date du LIEN.`
      : p.preuve,
    drapeaux: ["date_de_la_page_pas_du_lien"],
  }));

  // --- 2. derniere capture.
  //     ⛔ On demande limit=-1, PAS &from=<date recente>. Le brief proposait &from=, mais
  //        &from= rend la PREMIERE capture posterieure a la date, ce qui n est pas la
  //        derniere : sur une page capturee tous les mois, &from= repond une date vieille
  //        de plusieurs semaines et on l afficherait comme « vu pour la derniere fois ».
  //        limit=-1 est la forme documentee pour lire la queue de l index. On garde &from=
  //        en repli, avec son drapeau, pour le cas ou la queue serait refusee.
  let d = await cdx(url, "fl=timestamp,original,statuscode&limit=-1");
  let replFrom = false;
  if (d.etat === "ANGLE_MORT") {
    const depuis = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
    d = await cdx(url, `fl=timestamp,original,statuscode&from=${depuis}&limit=1`);
    replFrom = true;
  }
  const l1 = d.lignes?.[0];
  obs.push(observation({
    ...commun,
    objet: { domaine: referent, url, detail: d.etat === "MESURE" ? { timestamp: l1.timestamp, statuscode: l1.statuscode } : null },
    metrique: "derniere_capture",
    valeur: d.etat === "MESURE" ? jours(versIso(l1.timestamp)) : null,
    unite: "jour",
    nature: d.etat === "MESURE" ? "mesure" : "mesure_absente",
    etat: d.etat,
    source: { nom: "wayback_cdx", endpoint: d.endpoint, http: d.http, methode: "fetch" },
    date_donnee: d.etat === "MESURE" ? versIso(l1.timestamp) : null,
    preuve: d.etat === "MESURE"
      ? `derniere capture de la PAGE le ${versIso(l1.timestamp)} (HTTP ${l1.statuscode})${replFrom ? ", obtenue par le repli &from= : ce n est pas forcement la toute derniere" : ""}`
      : d.preuve,
    drapeaux: ["date_de_la_page_pas_du_lien", ...(replFrom ? ["repli_from_pas_la_queue"] : [])],
  }));

  // --- 3. l apparition du LIEN, par dichotomie sur les captures reussies.
  if (MAX_TEL > 0 && p.etat === "MESURE") {
    const liste = await cdx(url, "fl=timestamp,statuscode&filter=statuscode:200&collapse=timestamp:6&limit=300");
    if (liste.etat !== "MESURE") {
      obs.push(observation({
        ...commun, objet: { domaine: referent, url },
        metrique: "apparition_lien_estimee", etat: liste.etat === "MESURE_ABSENT" ? "MESURE_ABSENT" : "ANGLE_MORT",
        nature: "mesure_absente",
        source: { nom: "wayback_cdx", endpoint: liste.endpoint, http: liste.http, methode: "fetch" },
        preuve: `aucune capture en HTTP 200 a comparer : ${liste.preuve}`,
        drapeaux: ["pas_de_capture_200"],
      }));
    } else {
      const captures = liste.lignes.filter((c) => /^\d{14}$/.test(String(c.timestamp)));
      const r = await chercherApparition(captures, url, MAX_TEL);
      const tel = MAX_TEL - r.restant;
      const socle = {
        ...commun, objet: { domaine: referent, url, detail: { captures_disponibles: captures.length, telechargements: tel, journal: r.journal } },
        metrique: "apparition_lien_estimee",
        source: { nom: "wayback_archive", endpoint: `https://web.archive.org/web/<timestamp>id_/${url}`, http: 200, methode: "fetch" },
      };

      if (r.etat === "absent_partout") {
        // ⛔ TROIS EXPLICATIONS, ET LA PLUS PROBABLE EST SOUVENT LA TROISIEME. Mesure du
        //    21/08/2026 sur une page partenaires reelle (du genre
        //    partenaire-exemple.com/partenaires/, exemple) : derniere capture le 13/04/2026,
        //    soit 129 jours avant la mesure. Un lien pose depuis avril ne PEUT PAS y
        //    figurer. Ecrire « lien retire » sur cette base ferait declarer morte une
        //    campagne vivante, exactement l erreur que le chantier interdit.
        const ageDerniere = jours(versIso(r.derniere.timestamp));
        obs.push(observation({
          ...socle, etat: "MESURE_ABSENT", nature: "mesure_absente",
          preuve: `la capture la plus recente (${versIso(r.derniere.timestamp)}, il y a ${ageDerniere} j) ne porte aucun lien vers ${CIBLE}${r.cd?.cite ? " alors que la page nous cite en texte" : ""}. Trois lectures possibles et on ne tranche pas : le lien a ete pose APRES cette capture, ou il a ete retire avant, ou il est injecte par du JavaScript que l archive ne rejoue pas. ${tel} telechargement(s).`,
          drapeaux: [
            "lien_absent_des_captures",
            ...(ageDerniere > 45 ? ["archive_en_retard_sur_la_page"] : []),
          ],
        }));
      } else if (r.etat === "archive_illisible") {
        obs.push(observation({
          ...socle, etat: "ANGLE_MORT", nature: "mesure_absente",
          preuve: `la capture la plus recente (${captures[captures.length - 1].timestamp}) n a pas pu etre telechargee. Journal : ${r.journal.join(" ; ")}`,
          drapeaux: ["capture_non_telechargeable"],
        }));
      } else if (r.etat === "avant_l_archive") {
        const iso = versIso(r.apres.timestamp);
        obs.push(observation({
          ...socle, etat: "MESURE", nature: "estimation",
          valeur: jours(iso), valeur_min: jours(iso), valeur_max: null, unite: "jour",
          date_donnee: iso,
          preuve: `le lien est deja present dans la PLUS ANCIENNE capture disponible (${r.apres.timestamp}) : il est donc anterieur au ${iso}, on ne peut pas remonter plus haut. ${tel} telechargement(s). Journal : ${r.journal.join(" ; ")}`,
          drapeaux: ["borne_gauche_hors_archive", "dichotomie_suppose_monotone"],
        }));
      } else {
        const isoApres = versIso(r.apres.timestamp);
        const isoAvant = r.avant ? versIso(r.avant.timestamp) : null;
        obs.push(observation({
          ...socle, etat: "MESURE", nature: "estimation",
          valeur: jours(isoApres), unite: "jour",
          valeur_min: jours(isoApres),
          valeur_max: isoAvant ? jours(isoAvant) : null,
          date_donnee: isoApres,
          preuve:
            `le lien est ABSENT de la capture du ${isoAvant ?? "(aucune capture sans lien identifiee)"} et PRESENT dans celle du ${isoApres}` +
            ` : il est apparu entre les deux. ${tel} telechargement(s) sur ${captures.length} capture(s). Journal : ${r.journal.join(" ; ")}`,
          drapeaux: [
            "dichotomie_suppose_monotone",
            ...(r.etat === "encadrement_grossier" ? ["encadrement_grossier_budget_epuise"] : []),
            ...(r.etat === "capture_unique" ? ["une_seule_capture"] : []),
          ],
        }));
      }
    }
  }

  // --- 4. la premiere fois que NOUS avons vu ce lien. Fiable, mais plancher.
  const v = premiereVueParNous(obsToutes, url, referent);
  obs.push(observation({
    ...commun,
    objet: { domaine: referent, url, detail: v.trouve ? { obs_id: v.obs_id, collecteur: v.collecteur, metrique: v.metrique, granularite: v.granularite } : null },
    metrique: "premiere_vue_par_nous",
    valeur: v.trouve ? jours(v.date) : null,
    unite: "jour",
    nature: v.trouve ? "mesure" : "mesure_absente",
    etat: v.trouve ? "MESURE" : "MESURE_ABSENT",
    // ⛔ L'ENDPOINT EST UN NOM DE FICHIER, PAS UN CHEMIN, ET C'EST UNE REGLE DE FUITE.
    //    Ce champ part dans CHAQUE ligne produite ici, et un journal d'observations se
    //    partage, s'exporte et parfois se publie. Y ecrire le chemin complet du disque
    //    reviendrait a diffuser l'arborescence de la machine qui a fait la mesure, alors
    //    que le nom du fichier suffit largement a rejouer la lecture. Le chemin reel se
    //    resout par le socle (VIGIE_DONNEES, sinon <racine>/donnees).
    source: { nom: "journal_vigie", endpoint: "observations.jsonl", http: null, methode: "lecture_locale" },
    date_donnee: v.trouve ? v.date : null,
    preuve: v.trouve
      ? `premiere ligne de notre journal citant ce lien : ${v.obs_id} du ${v.date}, ${v.collecteur}, metrique ${v.metrique}, granularite ${v.granularite}. ⛔ notre journal commence le ${v.debutJournal} : un lien plus ancien apparait quand meme a cette date.`
      : `aucune ligne de notre journal ne cite cette URL ni ce domaine referent pour ${CIBLE}. Notre journal commence le ${v.debutJournal ?? "(journal vide)"}.`,
    drapeaux: ["plancher_debut_du_journal", ...(v.granularite === "domaine" ? ["vu_au_domaine_pas_a_l_url"] : [])],
  }));

  return obs;
}

// ---------------------------------------------------------------- selection des URL

/**
 * Les pages a dater : celles que --urls impose, sinon celles que NOTRE journal connait
 * deja comme portant un lien vers la cible.
 * ⛔ AUCUN REPLI SUR UNE LISTE ECRITE EN DUR. Une liste d'URL cablee dans le code daterait
 *    les liens de celui qui a ecrit le fichier, pas ceux de celui qui le lance, et la
 *    sortie aurait l'air parfaitement normale. Rendre une liste vide est la seule reponse
 *    honnete : l'appelant s'arrete et dit quoi faire.
 */
function urlsSources(obsToutes) {
  const force = arg("urls");
  if (force) return force.split(",").map((u) => u.trim()).filter(Boolean);
  const vues = new Set();
  for (const o of obsToutes) {
    if (o.type !== "backlink" || o.sujet?.domaine !== CIBLE) continue;
    if (!["lien_qualifie", "lien_present"].includes(o.metrique)) continue;
    if (o.objet?.url) vues.add(o.objet.url);
  }
  return [...vues];
}

// ---------------------------------------------------------------- execution

const run = nouveauRun("wayback");
const { obs: obsToutes, illisibles } = lire();
if (illisibles) console.log(`  ⚠ ${illisibles} ligne(s) illisible(s) dans le journal, signalees et non avalees.`);

const urls = urlsSources(obsToutes).slice(0, LIMITE);

if (!urls.length) {
  console.log(`aucune URL source pour ${CIBLE} : le journal ne porte ni « lien_qualifie » ni`);
  console.log(`« lien_present » pour ce domaine, et --urls n a rien impose.`);
  console.log(`  Lance d abord collecte-rel.mjs sans --dry pour peupler le journal,`);
  console.log(`  ou passe --urls=https://une-page/,https://une-autre/ pour dater des pages precises.`);
  process.exit(1);
}

console.log(`Vigie SEO — datation des liens par l archive du web`);
console.log(`cible ${CIBLE} · ${urls.length} URL source(s) · ${MAX_TEL} telechargement(s) max par URL · run ${run}`);
console.log(`⛔ la date d une CAPTURE n est pas la date d un LIEN, les deux sortent sur des lignes distinctes\n`);

const toutes = [];
for (const u of urls) {
  process.stdout.write(`  ${u}\n`);
  try {
    const obs = await dater(u, obsToutes, run);
    toutes.push(...obs);
    for (const o of obs) {
      const val = o.etat === "MESURE" ? `${o.valeur} j (${(o.date_donnee || "").slice(0, 10)})` : o.etat;
      console.log(`      ${o.metrique.padEnd(26)} ${String(val).padEnd(24)} ${o.preuve.slice(0, 110)}`);
    }
  } catch (e) {
    console.log(`      ECHEC : ${String(e.message).slice(0, 160)}`);
    toutes.push(observation({
      type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: hote(u), url: u },
      metrique: "apparition_lien_estimee", etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "wayback_cdx", endpoint: "https://web.archive.org/cdx/search/cdx", http: null, methode: "fetch" },
      preuve: `le collecteur a leve : ${String(e.message).slice(0, 200)}`,
      run_id: run, collecteur: VERSION, drapeaux: ["collecteur_en_erreur"],
    }));
  }
}

const parEtat = toutes.reduce((a, o) => ({ ...a, [o.etat]: (a[o.etat] || 0) + 1 }), {});
console.log(`\n${toutes.length} observation(s) : ${JSON.stringify(parEtat)}`);
if (DRY) {
  console.log(`--dry : rien n'est ecrit.`);
  const ex = toutes.find((o) => o.metrique === "apparition_lien_estimee" && o.etat === "MESURE") || toutes[0];
  if (ex) console.log(JSON.stringify(ex, null, 1));
} else {
  console.log(`${ecrire(toutes)} observation(s) ecrite(s).`);
}
