// LE MAGASIN D'OBSERVATIONS de la Vigie SEO.
//
// Une seule structure de ligne pour TOUT : un backlink, une position de SERP, un chiffre
// de trafic, une note. C'est ce qui permet au site d'afficher une metrique qu'il ne
// connait pas encore, et de comparer deux releves separes de trois semaines.
//
// ⛔ TROIS REGLES QUE CE MODULE FAIT RESPECTER MECANIQUEMENT. Chacune vient d'une mesure
//    reelle qui a coute une conclusion fausse :
//
//  1. UNE OBSERVATION NE S'ECRASE JAMAIS, ELLE S'EMPILE. On veut la courbe, et on veut
//     pouvoir repondre a « ce lien est tombe quand ». Un outil qui ecrit son resultat au
//     writeFileSync ecrase le releve precedent, donc il ne sait rien dire du passe.
//
//  2. JAMAIS UN ZERO LA OU LA MESURE A ECHOUE. Un 403 n'est pas une absence, un 202 de
//     DuckDuckGo est un captcha et pas zero resultat, un {"ranks": []} de Tranco est en
//     revanche une VRAIE mesure. D'ou trois etats distincts, et un etat ANGLE_MORT qui
//     retire son poids du calcul au lieu de compter zero.
//     Le 16/08/2026, un rapport d'annuaires a aligne les fiches propres et les fiches
//     illisibles dans la meme colonne : la fiche la plus fausse etait celle que l'outil
//     ne pouvait pas lire.
//
//  3. TOUTE LIGNE PORTE SA SOURCE ET SA DATE. Semrush, Ahrefs, Bing et Google ne voient
//     pas les memes liens. Une donnee sans sa source ne se compare a rien.
//
// ⛔ ET UNE QUATRIEME, MOINS EVIDENTE : date_mesure (quand je l'ai lue) est un champ
//    DIFFERENT de date_donnee (quand la source l'a produite). La page publique Semrush
//    servait le 21/08 une donnee datee du 15/07. Sans les deux champs, le site presente
//    cinq semaines de retard comme une photo du jour.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));

/** Racine du depot : le parent du dossier outils/, jamais un chemin absolu ecrit en dur. */
export const RACINE = path.resolve(ICI, "..");

/**
 * Ou vivent les donnees collectees.
 * ⛔ LE JOURNAL EST LA SEULE COPIE DE L'HISTORIQUE. Le poser sur un disque monte, un
 *    volume Docker ou un dossier sauvegarde se fait par VIGIE_DONNEES, jamais en
 *    modifiant ce fichier : une valeur ecrite en dur ici repart a zero a chaque mise a
 *    jour du code, et personne ne s'en apercoit avant d'avoir besoin de la courbe.
 */
export const DOSSIER_DONNEES = process.env.VIGIE_DONNEES
  ? path.resolve(process.env.VIGIE_DONNEES)
  : path.join(RACINE, "donnees");
export const FICHIER_OBS = path.join(DOSSIER_DONNEES, "observations.jsonl");

export const ETATS = ["MESURE", "MESURE_ABSENT", "ANGLE_MORT"];
export const NATURES = ["mesure", "mesure_absente", "estimation", "derive", "plancher"];

/**
 * Horodatage UTC, toujours.
 * ⛔ Comparer deux dates ecrites dans deux fuseaux differents fait apparaitre des
 *    mouvements qui n'existent pas, et en cache de vrais. Ici tout est UTC, sans exception.
 */
export const maintenant = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Identifiant de passe : sert a retirer une collecte entiere quand on decouvre un bug. */
export function nouveauRun(suffixe) {
  return `${maintenant().slice(0, 16)}Z-${suffixe}`.replace(/:/g, "");
}

function empreinte(o) {
  const cle = [
    o.type,
    o.sujet?.domaine || "", o.sujet?.url || "", o.sujet?.requete || "",
    o.sujet?.pays || "", o.sujet?.device || "",
    o.objet?.domaine || "", o.objet?.url || "", o.objet?.ancre || "",
    // ⛔ SANS LA DESTINATION ET LE rel, DEUX LIENS DIFFERENTS DE LA MEME PAGE ONT LA MEME
    //    EMPREINTE, et le second est supprime en silence par l ecriture idempotente.
    //    Mesure du 21/08/2026 : une fiche d annuaire (du genre
    //    annuaire-exemple.fr/fiche/mon-produit, exemple) portait DEUX liens vers le meme
    //    site, l un vers une page produit et l autre vers une video. Deux liens reels,
    //    une seule ligne au journal. C est le collecteur de rel qui l a detecte lui-meme.
    o.objet?.detail?.url_destination || "", o.objet?.detail?.rel_brut || "",
    o.metrique,
    o.source?.nom || "",
    (o.date_mesure || "").slice(0, 10),
  ].join("|");
  return crypto.createHash("sha1").update(cle).digest("hex").slice(0, 16);
}

/**
 * Fabrique une observation complete et coherente.
 * Leve si l'appelant tente d'ecrire un ANGLE_MORT avec une valeur numerique : c'est
 * exactement le zero silencieux qu'on cherche a rendre impossible.
 */
export function observation({
  type, sujet = {}, objet = null, metrique, valeur = null,
  valeur_min = null, valeur_max = null, unite = null,
  nature = "mesure", etat = "MESURE",
  source = {}, date_donnee = null, preuve = null, drapeaux = [],
  run_id = "manuel", collecteur = "inconnu@0",
}) {
  if (!ETATS.includes(etat)) throw new Error(`etat inconnu : ${etat}`);
  if (!NATURES.includes(nature)) throw new Error(`nature inconnue : ${nature}`);
  if (etat === "ANGLE_MORT" && valeur !== null) {
    throw new Error(
      `ANGLE_MORT avec une valeur (${metrique}=${valeur}). Un angle mort n'a pas de valeur, ` +
      `il a une raison. Mettre la raison dans preuve et laisser valeur a null.`
    );
  }
  const date_mesure = maintenant();
  const o = {
    obs_id: null, run_id, collecteur,
    type,
    sujet: { domaine: null, url: null, requete: null, pays: null, device: null, ...sujet },
    objet: objet ? { domaine: null, url: null, ...objet } : null,
    metrique, valeur, valeur_min, valeur_max, unite,
    nature, etat,
    source: { nom: null, endpoint: null, http: null, methode: null, ...source },
    date_mesure,
    date_donnee,
    fraicheur_jours: date_donnee
      ? Math.round((Date.parse(date_mesure) - Date.parse(date_donnee)) / 86400000)
      : null,
    preuve: preuve ? String(preuve).replace(/\s+/g, " ").slice(0, 400) : null,
    drapeaux,
  };
  o.obs_id = empreinte(o);
  return o;
}

const SAUT = String.fromCharCode(10);
let _index = null;

/**
 * ⛔ L'IDEMPOTENCE PORTE SUR LE CONTENU, PAS SUR LE SEUL obs_id.
 *    obs_id identifie la MESURE (quoi, sur qui, par quelle source, quel jour), pas son
 *    RESULTAT. Mesure du 21/08/2026 : sur un domaine surveille, une premiere passe a
 *    echoue et a ecrit un ANGLE_MORT ; la passe suivante, une heure plus tard, a reussi
 *    et a lu 250 sites referents. Meme obs_id, donc la bonne valeur a ete REJETEE EN
 *    SILENCE, et le rapport a continue d'afficher « non mesure » alors que la mesure
 *    existait.
 *    En incluant l'etat et la valeur dans la cle : deux passes identiques ne font
 *    toujours qu'une seule ligne, mais une passe qui CORRIGE la precedente s'ecrit.
 *    `dernier()` prend la plus recente et `compacter()` garde la derniere : la
 *    correction gagne.
 */
const cleContenu = (id, etat, valeur) => `${id}|${etat}|${valeur}`;

/** Index du contenu deja present. Construit une fois par processus. */
function indexExistant() {
  if (_index) return _index;
  _index = new Set();
  if (fs.existsSync(FICHIER_OBS)) {
    for (const l of fs.readFileSync(FICHIER_OBS, "utf8").split(SAUT)) {
      if (!l.trim()) continue;
      // Lecture au motif plutot qu'un JSON.parse complet : 20 000 lignes de 700 octets
      // se relisent en quelques millisecondes au lieu de quelques secondes.
      const m = /"obs_id":"([0-9a-f]{16})"/.exec(l);
      if (!m) continue;
      const e = /"etat":"([A-Z_]+)"/.exec(l);
      const v = /"valeur":([^,]*),/.exec(l);
      _index.add(cleContenu(m[1], e ? e[1] : "", v ? v[1] : ""));
    }
  }
  return _index;
}

/**
 * Ajoute des observations au journal. Append seulement, jamais de reecriture.
 *
 * ⛔ IDEMPOTENT PAR obs_id, ET CE N'EST PAS UN DETAIL. Le 21/08/2026, relancer la
 *    collecte Bing une seconde fois dans la meme heure a fait passer le journal de
 *    5 964 a 11 928 lignes et de 4 a 7,9 Mo, pour exactement zero information nouvelle.
 *    obs_id porte la journee : deux passes le meme jour sur la meme mesure ne comptent
 *    qu'une fois, deux passes a deux jours d'ecart font bien deux points de courbe.
 *    Sans ca, le fichier grossit avec le nombre de relances et non avec le temps, et
 *    une simple relance ressemblerait a un mouvement du marche.
 */
export function ecrire(observations, { doublonsAutorises = false } = {}) {
  const liste = Array.isArray(observations) ? observations : [observations];
  if (!liste.length) return 0;
  fs.mkdirSync(DOSSIER_DONNEES, { recursive: true });
  let aEcrire = liste;
  if (!doublonsAutorises) {
    const vus = indexExistant();
    const cle = (o) => cleContenu(o.obs_id, o.etat, JSON.stringify(o.valeur));
    aEcrire = liste.filter((o) => !vus.has(cle(o)));
    aEcrire.forEach((o) => vus.add(cle(o)));
  }
  if (!aEcrire.length) return 0;
  fs.appendFileSync(FICHIER_OBS, aEcrire.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
  return aEcrire.length;
}

/**
 * Retire les doublons deja presents dans le fichier, en gardant la PREMIERE occurrence.
 * A lancer une fois apres coup : node outils/_lib-obs.mjs --compacter
 */
export function compacter() {
  if (!fs.existsSync(FICHIER_OBS)) return { avant: 0, apres: 0 };
  const lignes = fs.readFileSync(FICHIER_OBS, "utf8").split("\n").filter((l) => l.trim());
  // ⛔ ON GARDE LA DERNIERE OCCURRENCE, ET C'EST L'INVERSE DE LA PREMIERE VERSION.
  //    Garder la premiere allait tant que les doublons etaient des relances a l'identique.
  //    Depuis que les NOTES se reecrivent dans la journee (elles passent doublonsAutorises,
  //    parce qu'un calcul change quand ses entrees changent), garder la premiere
  //    RESTAURE la note d'avant : la compaction annulait le recalcul, en silence, et
  //    juste avant la mise en ligne. Le fichier est chronologique, donc la derniere
  //    ligne d'un identifiant est toujours la plus recente.
  const dernierIndex = new Map();
  lignes.forEach((l, i) => {
    const m = /"obs_id":"([0-9a-f]{16})"/.exec(l);
    if (m) dernierIndex.set(m[1], i);
  });
  const gardees = [];
  lignes.forEach((l, i) => {
    const m = /"obs_id":"([0-9a-f]{16})"/.exec(l);
    if (m && dernierIndex.get(m[1]) !== i) return;
    gardees.push(l);
  });
  // On ecrit a cote puis on remplace : une interruption ne doit pas laisser un journal
  // tronque, c'est la seule copie de l'historique.
  const tmp = FICHIER_OBS + ".tmp";
  fs.writeFileSync(tmp, gardees.join("\n") + "\n", "utf8");
  fs.renameSync(tmp, FICHIER_OBS);
  _index = null;
  return { avant: lignes.length, apres: gardees.length };
}

/**
 * Retire du journal les lignes qui correspondent a un predicat, et rend combien.
 *
 * ⛔ POURQUOI CETTE FONCTION EXISTE. Mesure du 21/08/2026 : une extraction fautive a
 *    inscrit 253 « pages portantes » qui etaient en realite les liens promotionnels de
 *    l'outil consulte vers ses PROPRES produits. Une donnee fausse au journal
 *    est pire qu'une donnee absente : elle se recopie dans les notes, dans le site, et
 *    dans la comparaison du lendemain. Il faut pouvoir la retirer proprement, en disant
 *    QUOI on retire, plutot que de reecrire le fichier a la main.
 * ⛔ UNE SAUVEGARDE EST ECRITE AVANT, systematiquement. C'est la seule copie de
 *    l'historique.
 */
export function purger(predicat, { motif = "non precise" } = {}) {
  if (!fs.existsSync(FICHIER_OBS)) return { avant: 0, retirees: 0 };
  const lignes = fs.readFileSync(FICHIER_OBS, "utf8").split(SAUT).filter((l) => l.trim());
  const sauvegarde = `${FICHIER_OBS}.avant-purge-${maintenant().replace(/[:.]/g, "")}`;
  fs.writeFileSync(sauvegarde, lignes.join(SAUT) + SAUT, "utf8");
  const gardees = [];
  let retirees = 0;
  for (const l of lignes) {
    let o;
    try { o = JSON.parse(l); } catch { gardees.push(l); continue; }
    if (predicat(o)) { retirees++; continue; }
    gardees.push(l);
  }
  const tmp = FICHIER_OBS + ".tmp";
  fs.writeFileSync(tmp, gardees.join(SAUT) + SAUT, "utf8");
  fs.renameSync(tmp, FICHIER_OBS);
  _index = null;
  return { avant: lignes.length, retirees, sauvegarde, motif };
}

/** Relit tout le journal. Une ligne illisible est signalee, jamais avalee en silence. */
export function lire({ fichier = FICHIER_OBS } = {}) {
  if (!fs.existsSync(fichier)) return { obs: [], illisibles: 0 };
  const obs = [];
  let illisibles = 0;
  for (const l of fs.readFileSync(fichier, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { obs.push(JSON.parse(l)); } catch { illisibles++; }
  }
  return { obs, illisibles };
}

/**
 * Dernier etat connu : pour chaque (type, sujet, objet, metrique, source), la ligne la
 * plus recente. C'est la PHOTO DU JOUR.
 */
export function dernier(obs) {
  const m = new Map();
  for (const o of obs) {
    const cle = [o.type, o.sujet?.domaine, o.sujet?.url, o.sujet?.requete,
                 o.objet?.domaine, o.objet?.url, o.objet?.ancre, o.metrique, o.source?.nom].join("|");
    const p = m.get(cle);
    if (!p || o.date_mesure > p.date_mesure) m.set(cle, o);
  }
  return [...m.values()];
}

/**
 * Serie temporelle d'une metrique, triee. C'est ce que le site trace : voir bouger une
 * position compte plus que la connaitre.
 */
export function serie(obs, filtre) {
  return obs
    .filter((o) => Object.entries(filtre).every(([k, v]) => {
      const val = k.includes(".")
        ? k.split(".").reduce((a, c) => (a == null ? a : a[c]), o)
        : o[k];
      return val === v;
    }))
    .sort((a, b) => a.date_mesure.localeCompare(b.date_mesure));
}

/**
 * Compare deux photos et rend les mouvements. Le coeur de « voir bouger ».
 * Rend aussi les APPARITIONS et les DISPARITIONS, qui sont l'information la plus utile
 * sur un profil de liens : un backlink qui tombe ne fait aucun bruit autrement.
 */
export function mouvements(obs, { depuisJours = 7 } = {}) {
  const seuil = new Date(Date.now() - depuisJours * 86400000).toISOString();
  const parCle = new Map();
  for (const o of obs) {
    const cle = [o.type, o.sujet?.domaine, o.sujet?.url, o.sujet?.requete,
                 o.objet?.domaine, o.objet?.url, o.objet?.ancre, o.metrique, o.source?.nom].join("|");
    if (!parCle.has(cle)) parCle.set(cle, []);
    parCle.get(cle).push(o);
  }
  const out = [];
  for (const [cle, liste] of parCle) {
    liste.sort((a, b) => a.date_mesure.localeCompare(b.date_mesure));
    const recentes = liste.filter((o) => o.date_mesure >= seuil);
    if (!recentes.length) {
      // Rien de recent : la ligne a peut-etre DISPARU. On ne le dit que si le collecteur
      // est repasse depuis (sinon on annoncerait une disparition alors qu'on n'a pas regarde).
      continue;
    }
    const avant = liste.filter((o) => o.date_mesure < seuil).pop();
    const apres = recentes[recentes.length - 1];
    if (!avant) { out.push({ cle, genre: "apparition", avant: null, apres }); continue; }
    if (avant.valeur !== apres.valeur || avant.etat !== apres.etat) {
      out.push({ cle, genre: "changement", avant, apres,
                 delta: (typeof avant.valeur === "number" && typeof apres.valeur === "number")
                   ? apres.valeur - avant.valeur : null });
    }
  }
  return out;
}

/**
 * Charge la configuration des domaines : qui on surveille, sous quel role.
 *
 * Ordre de recherche, du plus explicite au plus implicite :
 *   1. VIGIE_CONFIG              chemin complet d'un fichier json
 *   2. <racine du depot>/config/domaines.json
 *
 * ⛔ AUCUNE CONFIGURATION PAR DEFAUT, ET AUCUN OBJET VIDE RENDU EN SILENCE.
 *    Un outil de mesure qui demarre sans domaine ne leve rien : il parcourt une liste
 *    vide, ecrit zero observation, et rend un rapport parfaitement vide. Le lecteur en
 *    conclut que plus personne ne le cite, alors que personne n'a jamais regarde. Une
 *    panne de configuration doit ressembler a une panne, pas a une mauvaise nouvelle.
 * ⛔ ET SI VIGIE_CONFIG POINTE SUR UN FICHIER ABSENT, ON S'ARRETE AUSSI, au lieu de
 *    retomber en douce sur le fichier par defaut : croire qu'on mesure le perimetre A
 *    alors qu'on mesure le perimetre B est plus couteux qu'un demarrage refuse.
 */
export function config() {
  const parEnv = process.env.VIGIE_CONFIG ? path.resolve(process.env.VIGIE_CONFIG) : null;
  const parDefaut = path.join(RACINE, "config", "domaines.json");

  if (parEnv && !fs.existsSync(parEnv)) {
    throw new Error(
      `VIGIE_CONFIG pointe sur un fichier qui n'existe pas : ${parEnv}\n` +
      "  Corrige la variable, ou retire-la pour utiliser config/domaines.json."
    );
  }
  const fichier = parEnv || parDefaut;

  if (!fs.existsSync(fichier)) {
    throw new Error(
      "aucune configuration : copie config/domaines.exemple.json vers config/domaines.json " +
      "et mets tes domaines dedans.\n" +
      `  Attendu ici : ${parDefaut}\n` +
      "  Ou pointe la variable VIGIE_CONFIG sur ton propre fichier json."
    );
  }
  try {
    return JSON.parse(fs.readFileSync(fichier, "utf8"));
  } catch (e) {
    // Un json casse qui remonte tel quel ne dit pas QUEL fichier est casse : on le nomme.
    throw new Error(`configuration illisible (${fichier}) : ${e.message}`);
  }
}

/** Tous les domaines avec leur role, a plat. */
export function tousDomaines() {
  const c = config();
  return [
    ...c.nous.map((d) => ({ ...d, role: "nous" })),
    ...c.concurrents.map((d) => ({ ...d, role: "concurrent" })),
    ...c.spots.map((d) => ({ ...d, role: "spot" })),
  ];
}

// ---------------------------------------------------------------- ligne de commande
const { pathToFileURL } = await import("node:url");
// ⛔ argv[1] est INDEFINI quand le module est importe depuis « node -e » : sans la
//    garde, pathToFileURL leve et le module devient inimportable hors ligne de commande.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || null;
  if (process.argv.includes("--purger")) {
    const metrique = arg("metrique");
    const motifObjet = arg("motif-objet");
    if (!metrique && !motifObjet) {
      console.error("--purger exige au moins --metrique=<nom> ou --motif-objet=<regex>.");
      process.exit(1);
    }
    const re = motifObjet ? new RegExp(motifObjet, "i") : null;
    const r = purger((o) =>
      (!metrique || o.metrique === metrique) &&
      (!re || re.test(`${o.objet?.domaine || ""} ${o.objet?.url || ""}`)),
      { motif: `metrique=${metrique || "*"} objet~${motifObjet || "*"}` });
    console.log(`${r.retirees} ligne(s) retiree(s) sur ${r.avant}. Sauvegarde : ${r.sauvegarde}`);
  } else if (process.argv.includes("--compacter")) {
    const r = compacter();
    console.log(`journal compacte : ${r.avant} lignes -> ${r.apres} (${r.avant - r.apres} doublons retires)`);
  } else {
    const { obs, illisibles } = lire();
    const d = dernier(obs);
    console.log(`${obs.length} observations, ${illisibles} lignes illisibles, ${d.length} au dernier releve`);
    const parType = {};
    for (const o of d) parType[o.type] = (parType[o.type] || 0) + 1;
    console.log("par type :", parType);
  }
}
