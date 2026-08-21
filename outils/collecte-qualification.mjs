// QUALIFIER UN DOMAINE REFERENT SANS ALLER LE CRAWLER.
//
// Deux tables publiques, gratuites, telechargees UNE FOIS, jointes ensuite en local :
//
//   OpenPageRank, top 10 000 000 de domaines
//     https://openpagerank.keywordseverywhere.com/downloads/top10milliondomains.csv.zip
//     302 vers download.openpagerank.net, 117 Mo compresses -> 337 Mo de CSV.
//     Colonnes : Rank, Domain, Extension, Open Page Rank, Referring Domains
//     ⛔ Les en-tetes portent des ESPACES (« Open Page Rank », pas « OpenPageRank ») :
//        un appariement strict sur le nom sans espace ne trouve rien et rend une colonne
//        vide, donc un score de 0 pour dix millions de domaines.
//
//   Majestic Million, top 1 000 000
//     https://downloads.majestic.com/majestic_million.csv
//     76,5 Mo de CSV nu, pas d'archive.
//     Colonnes : GlobalRank, TldRank, Domain, TLD, RefSubNets, RefIPs, IDN_Domain,
//                IDN_TLD, PrevGlobalRank, PrevTldRank, PrevRefSubNets, PrevRefIPs
//
// ⛔ ON NE CHARGE JAMAIS DIX MILLIONS DE LIGNES EN MEMOIRE. Le CSV d'OpenPageRank fait
//    337 Mo une fois decompresse : le lire d'un coup fait sauter le tas de Node avant
//    meme la premiere jointure. Tout se lit EN FLUX, ligne par ligne, et on ne retient
//    que les domaines qu'on cherche. L'archive n'est meme pas ecrite sur le disque : elle
//    est decompressee a la volee pendant le telechargement.
//
// ⛔ CROISER LES DEUX EST LE SEUL GARDE-FOU CONTRE « LES INDEX DIVERGENT ».
//    OpenPageRank et Majestic ne crawlent pas le meme web. Quand ils se contredisent
//    fortement sur un domaine, ce fichier leve un drapeau « index_divergents » sur les
//    lignes concernees, il ne choisit PAS un camp en silence. Un domaine que Majestic
//    place dans son top 1 M et qu'OpenPageRank ne voit meme pas dans son top 10 M n'est
//    pas un domaine faible : c'est un domaine sur lequel on ne sait pas.
//
// ⛔ CE FICHIER NE NOTE RIEN. Il ecrit les entrees brutes des deux tables et leurs
//    desaccords. La note de domaine (ND) et la note de lien (NL) se calculent ailleurs,
//    a partir de ces lignes, avec les roles de domaines.json. Melanger la collecte et la
//    notation rendrait impossible de rejouer une note apres un changement de formule.
//
// ⛔ « ABSENT DE LA TABLE » ET « JAMAIS CHERCHE » NE SONT PAS LA MEME CHOSE, ET C'EST LE
//    PIEGE PRINCIPAL DU CACHE. Un index compact ne garde que les domaines demandes le jour
//    ou il a ete construit. Trois semaines plus tard, un domaine referent nouvellement
//    apparu dans le journal n'y est pas, et il serait tres facile d'en conclure « pas dans
//    le top 10 M », c'est-a-dire un domaine faible, alors qu'on ne l'a simplement jamais
//    cherche. L'index memorise donc la LISTE DES DOMAINES DEMANDES :
//      demande et trouve    -> MESURE
//      demande et pas trouve -> MESURE_ABSENT (vraie information : hors du top de la table)
//      jamais demande        -> ANGLE_MORT   (on ne sait pas, il faut relire la table)
//
// ⛔ ZERO DEPENSE ET ZERO SURPRISE DE BANDE PASSANTE. Le poids est lu AVANT de telecharger,
//    par une requete Range d'un octet dont on ne garde que l'en-tete Content-Range.
//    --taille-max=<Mo> refuse tout ce qui depasse, --cache-seulement ne telecharge rien.
//
// Usage :
//   node outils/collecte-qualification.mjs                      (les deux tables)
//   node outils/collecte-qualification.mjs --taille-max=1        (prouve le refus)
//   node outils/collecte-qualification.mjs --cache-seulement     (zero reseau)
//   node outils/collecte-qualification.mjs --tables=majestic --dry
//   node outils/collecte-qualification.mjs --domaines=exemple.com,concurrent-un.com --dry

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { UA_CHROME } from "./_lib-liens.mjs";
import { observation, ecrire, nouveauRun, config, lire as lireJournal, maintenant } from "./_lib-obs.mjs";

const VERSION = "collecte-qualification@1.0.0";
const ICI = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(ICI, ".cache");

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || null;
const DRY = process.argv.includes("--dry");
const CACHE_SEUL = process.argv.includes("--cache-seulement");
// Defaut a 150 Mo : les deux tables passent, mais rien d'inattendu ne passe. Le poids est
// de toute facon annonce avant chaque telechargement.
const TAILLE_MAX_MO = Number(arg("taille-max") || 150);
const TAILLE_MAX = Math.round(TAILLE_MAX_MO * 1024 * 1024);

const TABLES = {
  openpagerank: {
    nom: "openpagerank",
    url: "https://openpagerank.keywordseverywhere.com/downloads/top10milliondomains.csv.zip",
    zip: true,
    fichier: "openpagerank.index.json",
    // Les noms sont apparies en minuscules et sans espaces : la table a deja renomme ses
    // colonnes une fois, et un appariement strict rendrait des colonnes vides sans bruit.
    colonnes: { domaine: "domain", rang: "rank", score: "openpagerank", referents: "referringdomains" },
    tailleAnnoncee: 10_000_000,
  },
  majestic: {
    nom: "majestic",
    url: "https://downloads.majestic.com/majestic_million.csv",
    zip: false,
    fichier: "majestic.index.json",
    colonnes: {
      domaine: "domain", rang: "globalrank", sousReseaux: "refsubnets",
      ips: "refips", rangPrecedent: "prevglobalrank",
    },
    tailleAnnoncee: 1_000_000,
  },
};

const tablesVoulues = (arg("tables") || "openpagerank,majestic")
  .split(",").map((s) => s.trim()).filter((s) => TABLES[s]);

// ------------------------------------------------------------- les domaines a qualifier

/**
 * Tout ce qu'on veut noter : nos domaines, les concurrents, les spots, et surtout TOUS les
 * domaines referents deja vus par les autres collecteurs. C'est ce dernier ensemble qui
 * fait le volume : le journal en portait 2 216 le 21/08/2026, tous issus de Bing.
 */
function domainesAQualifier() {
  const demandes = arg("domaines");
  if (demandes) return [...new Set(demandes.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean))];

  const c = config();
  const vus = new Set();
  for (const d of [...c.nous, ...c.concurrents, ...c.spots]) vus.add(String(d.domaine).toLowerCase());

  const { obs, illisibles } = lireJournal();
  if (illisibles) console.log(`  ⚠ ${illisibles} ligne(s) illisible(s) dans le journal, ignorees pour la selection`);
  for (const o of obs) {
    // ⛔ On ne prend que objet.domaine : c'est le domaine QUI FAIT le lien. sujet.domaine
    //    est le domaine ANALYSE, il est deja couvert par la config, et l'avaler ici
    //    melangerait « le site qu'on suit » et « le site qui nous cite ».
    const d = o.objet?.domaine;
    if (d && typeof d === "string" && d.includes(".")) vus.add(d.toLowerCase());
  }
  return [...vus].sort();
}

// ------------------------------------------------------------------------ le cache

const cheminIndex = (t) => path.join(CACHE, TABLES[t].fichier);

function lireIndex(t) {
  const p = cheminIndex(t);
  if (!fs.existsSync(p)) return null;
  try {
    const i = JSON.parse(fs.readFileSync(p, "utf8"));
    i.demandes = new Set(i.domaines_demandes || []);
    return i;
  } catch (e) {
    console.log(`  ⚠ index ${t} illisible (${String(e.message).slice(0, 60)}), il sera reconstruit`);
    return null;
  }
}

function ecrireIndex(t, index) {
  fs.mkdirSync(CACHE, { recursive: true });
  const { demandes, ...aEcrire } = index;
  fs.writeFileSync(cheminIndex(t), JSON.stringify(aEcrire), "utf8");
  return cheminIndex(t);
}

// --------------------------------------------------------------------- lecture en flux

/**
 * Le poids d'un fichier distant SANS le telecharger.
 * On demande un seul octet et on lit le Content-Range : les deux serveurs repondent 206
 * avec « bytes 0-0/122980938 ». Un HEAD serait plus propre mais les deux hotes ne le
 * servent pas de facon fiable, alors qu'un Range d'un octet marche partout et coute rien.
 */
async function poidsDistant(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA_CHROME, range: "bytes=0-0" }, redirect: "follow" });
    const cr = r.headers.get("content-range");
    const total = cr && /\/(\d+)\s*$/.exec(cr) ? Number(/\/(\d+)\s*$/.exec(cr)[1]) : Number(r.headers.get("content-length") || 0);
    return {
      ok: r.status === 200 || r.status === 206,
      http: r.status,
      octets: total || null,
      urlFinale: r.url,
      // Majestic met son fichier a jour tous les jours : Last-Modified est la DATE DE LA
      // DONNEE, distincte de la date a laquelle on la lit.
      derniereModif: r.headers.get("last-modified") || null,
      accepteRange: !!cr,
    };
  } catch (e) {
    return { ok: false, http: null, octets: null, erreur: String(e.message || e).slice(0, 120) };
  }
}

/** Ouvre l'entree unique d'une archive ZIP servie en flux, sans jamais l'ecrire sur disque. */
async function ouvrirZip(lecteur) {
  let tampon = Buffer.alloc(0);
  let entete = null;
  while (!entete) {
    const { value, done } = await lecteur.read();
    if (done) throw new Error("archive ZIP tronquee avant la fin de son en-tete local");
    tampon = Buffer.concat([tampon, Buffer.from(value)]);
    if (tampon.length < 30) continue;
    const signature = tampon.readUInt32LE(0);
    // ⛔ 0x04034b50 = « PK\x03\x04 ». Une page d'erreur HTML servie en 200 a la place de
    //    l'archive commencerait par « <!DO » : on le voit ici et on le dit, au lieu de
    //    laisser inflateRaw rendre un « incorrect header check » incomprehensible.
    if (signature !== 0x04034b50) {
      throw new Error(
        `signature ZIP inattendue 0x${signature.toString(16)} (« ${tampon.slice(0, 12).toString("latin1")} ») : ` +
        "la reponse n est pas une archive, c est probablement une page d erreur servie en 200"
      );
    }
    const nomLen = tampon.readUInt16LE(26);
    const extraLen = tampon.readUInt16LE(28);
    const debut = 30 + nomLen + extraLen;
    if (tampon.length < debut) continue;
    entete = {
      methode: tampon.readUInt16LE(8),
      nom: tampon.slice(30, 30 + nomLen).toString("latin1"),
      tailleBrute: tampon.readUInt32LE(22),
      debut,
    };
  }

  const reste = tampon.subarray(entete.debut);
  const source = Readable.from((async function* () {
    yield reste;
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) return;
      yield Buffer.from(value);
    }
  })());

  if (entete.methode === 0) return { entete, flux: source };
  if (entete.methode === 8) return { entete, flux: source.pipe(zlib.createInflateRaw()) };
  throw new Error(`compression ZIP ${entete.methode} non geree (seuls 0 stocke et 8 deflate le sont)`);
}

/** Appariement d'en-tetes tolerant : minuscules, sans espace, sans souligne. */
const clef = (s) => String(s).replace(/^﻿/, "").trim().toLowerCase().replace(/[\s_-]+/g, "");

/**
 * Telecharge une table en flux et n'en garde que les domaines voulus.
 * Rend l'index, ou { ok:false, raison } : un echec doit devenir une ligne du journal, pas
 * une exception qui laisse le run a moitie fait.
 */
async function moissonnerTable(def, voulus) {
  const poids = await poidsDistant(def.url);
  if (!poids.ok) {
    return { ok: false, raison: `poids illisible : HTTP ${poids.http}${poids.erreur ? ` (${poids.erreur})` : ""}`, http: poids.http };
  }
  const mo = poids.octets ? (poids.octets / 1024 / 1024).toFixed(1) : "?";
  if (poids.octets && poids.octets > TAILLE_MAX) {
    return {
      ok: false, http: poids.http, refuseParTaille: true,
      raison: `${mo} Mo a telecharger, au-dela de la limite --taille-max=${TAILLE_MAX_MO} Mo. Rien n a ete telecharge.`,
    };
  }
  console.log(`    telechargement de ${mo} Mo (limite ${TAILLE_MAX_MO} Mo)${poids.derniereModif ? `, fichier date du ${poids.derniereModif}` : ""}…`);

  const r = await fetch(def.url, { headers: { "user-agent": UA_CHROME }, redirect: "follow" });
  if (!r.ok || !r.body) {
    return { ok: false, http: r.status, raison: `telechargement refuse : HTTP ${r.status}` };
  }

  let octetsRecus = 0;
  const lecteur = r.body.getReader();
  const compteur = {
    async read() {
      const m = await lecteur.read();
      if (m.value) octetsRecus += m.value.length;
      return m;
    },
  };

  let flux;
  let entete = null;
  if (def.zip) {
    const z = await ouvrirZip(compteur);
    flux = z.flux;
    entete = z.entete;
  } else {
    flux = Readable.from((async function* () {
      for (;;) {
        const { value, done } = await compteur.read();
        if (done) return;
        yield Buffer.from(value);
      }
    })());
  }

  const cherches = new Set(voulus);
  const entrees = {};
  let colonnes = null;
  let lignes = 0;
  let ignorees = 0;

  const rl = readline.createInterface({ input: flux, crlfDelay: Infinity });
  for await (const ligne of rl) {
    if (!ligne) continue;
    if (!colonnes) {
      const tetes = decouper(ligne).map(clef);
      colonnes = {};
      for (const [role, attendu] of Object.entries(def.colonnes)) {
        const i = tetes.indexOf(clef(attendu));
        if (i >= 0) colonnes[role] = i;
      }
      if (colonnes.domaine === undefined) {
        rl.close();
        return { ok: false, http: r.status, raison: `colonne du domaine introuvable. En-tetes lus : ${tetes.join(", ")}` };
      }
      // Une colonne attendue qui manque n'arrete pas la moisson, mais elle est DITE : la
      // metrique correspondante deviendra un angle mort au lieu d'un zero.
      const manquantes = Object.keys(def.colonnes).filter((k) => colonnes[k] === undefined);
      if (manquantes.length) console.log(`    ⚠ colonnes absentes de la table : ${manquantes.join(", ")}`);
      continue;
    }
    lignes++;
    const cellules = decouper(ligne);
    const d = String(cellules[colonnes.domaine] || "").trim().toLowerCase().replace(/^www\./, "");
    if (!d) { ignorees++; continue; }
    if (!cherches.has(d)) continue;
    const e = {};
    for (const [role, i] of Object.entries(colonnes)) {
      if (role === "domaine") continue;
      const v = Number(String(cellules[i] ?? "").trim());
      e[role] = Number.isFinite(v) ? v : null;
    }
    entrees[d] = e;
  }

  return {
    ok: true,
    table: def.nom,
    url: def.url,
    http: r.status,
    date_telechargement: maintenant(),
    date_donnee: poids.derniereModif ? new Date(poids.derniereModif).toISOString().replace(/\.\d{3}Z$/, "Z") : null,
    octets_source: poids.octets,
    octets_recus: octetsRecus,
    entree_zip: entete ? { nom: entete.nom, methode: entete.methode, taille_brute: entete.tailleBrute } : null,
    lignes_lues: lignes,
    lignes_sans_domaine: ignorees,
    colonnes_trouvees: Object.keys(colonnes),
    domaines_demandes: [...cherches].sort(),
    entrees,
  };
}

/** Decoupage CSV minimal, mais qui tient les guillemets : un domaine n'a pas de virgule,
 *  une categorie en a. Les deux tables sont propres, on ne se fie pas a ca pour autant. */
function decouper(ligne) {
  if (!ligne.includes('"')) return ligne.split(",");
  const out = [];
  let cour = "";
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') {
      if (dansGuillemets && ligne[i + 1] === '"') { cour += '"'; i++; }
      else dansGuillemets = !dansGuillemets;
    } else if (c === "," && !dansGuillemets) { out.push(cour); cour = ""; }
    else cour += c;
  }
  out.push(cour);
  return out;
}

// ------------------------------------------------------------------ le croisement
//
// ⛔ PREMIERE VERSION DE CE BLOC, ET POURQUOI ELLE ETAIT FAUSSE. Elle normalisait chaque
//    rang par la taille de sa table (rang / 10 000 000 contre rang / 1 000 000) puis
//    comparait les centiles. Resultat mesure le 21/08/2026 : 53 divergences sur 2 239
//    domaines, dont ameblo.jp, 213e sur dix millions chez OpenPageRank et 770e sur un
//    million chez Majestic. Les deux index disent « site tres fort », mais la division par
//    deux profondeurs differentes transformait un facteur 3,6 sur les rangs en facteur 36
//    sur les centiles. L'outil criait au loup neuf fois sur dix.
//    La cause : le top 1 M de Majestic couvre a peu pres le meme web reel que le top 1 M
//    d'OpenPageRank. Les deux tables n'ont pas des granularites differentes sur le meme
//    univers, elles ont des PROFONDEURS differentes. On compare donc RANG A RANG.
//
// ⛔ MAIS LES DEUX RANGS NE SONT PAS ALIGNES NON PLUS, ET LE DECALAGE EST SYSTEMATIQUE.
//    Mesure du 21/08/2026 sur les 705 domaines presents dans les deux tables :
//      mediane de log10(rang OpenPageRank / rang Majestic) = 0,157, soit un facteur 1,44
//      ecart absolu median (MAD)                            = 0,169
//      quantiles : p5 = -0,345 · p25 = -0,015 · p75 = 0,323 · p95 = 0,625 · p100 = 2,331
//    Le seuil est donc pose a 5 MAD autour de la mediane, soit un facteur 7 par rapport a
//    la relation attendue. Il retient 14 domaines sur 705, soit 2 %.
//    Ces deux constantes ne sont PAS figees dans le code comme une verite : elles sont
//    RECALCULEES a chaque passe sur les domaines effectivement apparies, et ne servent de
//    secours que lorsqu'il y a trop peu de paires pour estimer quoi que ce soit.
//
// ⛔ CE QUE LE DRAPEAU ATTRAPE VRAIMENT, ET C'EST SA VALEUR. Les outliers du 21/08 ne sont
//    pas du bruit : responseshub.com (OPR 8 371 379, Majestic 277 956), celebinsightz.com
//    (2 541 707 contre 82 421), spreadingwisdom.com (4 019 490 contre 93 582),
//    planetfitnessprices.com (9 932 107 contre 85 411). Majestic compte des liens,
//    OpenPageRank modelise la circulation du PageRank : une ferme de liens monte tres haut
//    chez le premier et reste au fond chez le second. Le desaccord entre les deux index
//    est donc un signal de spam a lui tout seul, et c'est exactement pour ca qu'il ne faut
//    surtout pas choisir un camp en silence.
//
// ⛔ L'ABSENCE N'EST PAS SYMETRIQUE. Majestic ne publie que son top 1 M : etre absent de
//    Majestic tout en etant 3 000 000e chez OpenPageRank est parfaitement coherent. Etre
//    dans le top 1 M de Majestic et introuvable dans le top 10 M d'OpenPageRank ne l'est
//    pas : au facteur 1,44 mesure, un domaine du bas de Majestic devrait sortir vers le
//    rang 1 400 000 chez OpenPageRank, tres loin de sa limite de dix millions.

const DECALAGE_DE_SECOURS = 0.157;   // mediane mesuree le 21/08/2026, en log10
const DISPERSION_DE_SECOURS = 0.169; // ecart absolu median mesure le meme jour
const SEUIL_EN_MAD = 5;
const PAIRES_MINIMUM = 30;           // en dessous, une mediane ne veut rien dire

const mediane = (xs) => {
  if (!xs.length) return null;
  const t = [...xs].sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
};

/**
 * Recale la relation entre les deux tables sur les domaines reellement apparies de CETTE
 * passe. Les tables bougent (Majestic est quotidien, OpenPageRank trimestriel) : un seuil
 * fige finirait par mesurer le vieillissement des tables plutot que le desaccord des index.
 */
function calibrer(paires) {
  if (paires.length < PAIRES_MINIMUM) {
    return {
      decalage: DECALAGE_DE_SECOURS, dispersion: DISPERSION_DE_SECOURS,
      origine: `${paires.length} paire(s) seulement, calibration du 21/08/2026 reprise telle quelle`,
    };
  }
  const d = mediane(paires);
  const disp = mediane(paires.map((x) => Math.abs(x - d))) || DISPERSION_DE_SECOURS;
  return {
    decalage: d,
    // Une dispersion nulle ou minuscule rendrait le seuil infiniment sensible.
    dispersion: Math.max(disp, 0.05),
    origine: `recalculee sur ${paires.length} domaines presents dans les deux tables`,
  };
}

function croiser({ opr, maj, tailleOpr, cal, chercheOpr }) {
  const rO = opr?.rang || null;
  const rM = maj?.rang || null;
  const seuil = SEUIL_EN_MAD * cal.dispersion;

  if (rO && rM) {
    const ecart = Math.log10(rO / rM) - cal.decalage;
    if (Math.abs(ecart) < seuil) return null;
    const sens = ecart > 0 ? "OpenPageRank le juge bien plus faible que Majestic" : "Majestic le juge bien plus faible qu OpenPageRank";
    return {
      ecart: Number(ecart.toFixed(2)),
      nature: "derive",
      etat: "MESURE",
      preuve:
        `rang OpenPageRank ${rO.toLocaleString("fr-FR")} contre rang Majestic ${rM.toLocaleString("fr-FR")} : ` +
        `${Math.round(10 ** Math.abs(ecart))} fois plus loin que la relation habituelle entre les deux tables ` +
        `(facteur median ${(10 ** cal.decalage).toFixed(2)}, seuil a ${SEUIL_EN_MAD} ecarts medians). ${sens}`,
    };
  }

  if (rM && chercheOpr && !opr) {
    // On sait que le desaccord vaut AU MOINS ceci : OpenPageRank s'arrete a dix millions,
    // donc le vrai rang est au-dela, on ne sait pas de combien. C'est un plancher.
    const attendu = rM * 10 ** cal.decalage;
    const ecart = Math.log10(tailleOpr / attendu);
    return {
      ecart: Number(Math.max(ecart, 0).toFixed(2)),
      nature: "plancher",
      etat: "MESURE",
      preuve:
        `present dans le Majestic Million au rang ${rM.toLocaleString("fr-FR")}, donc attendu vers le rang ` +
        `${Math.round(attendu).toLocaleString("fr-FR")} chez OpenPageRank, et ABSENT de ses ` +
        `${tailleOpr.toLocaleString("fr-FR")} lignes. Ecart d au moins un facteur ${Math.round(10 ** ecart)}, ` +
        "le vrai ecart est inconnu car la table s arrete la",
    };
  }

  // L'inverse est normal : Majestic s'arrete a un million.
  return null;
}

// --------------------------------------------------------------- filet anti-collision
//
// ⛔ DEPUIS LE 21/08/2026, ecrire() DEDOUBLONNE PAR obs_id ET NE DIT RIEN. Deux
//    observations distinctes qui tombent sur la meme empreinte ne font donc plus un
//    doublon visible : la seconde DISPARAIT. Ici le risque est faible (un domaine par
//    ligne, des metriques nommees a la main) mais il n'est pas nul, et une perte muette
//    dans un fichier qui sert a noter des domaines coute plus cher qu'un controle de
//    quinze lignes. On refuse d'ecrire plutot que de laisser passer.
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
    console.error(`   ${a.sujet.domaine} · ${a.metrique} · ${a.valeur} contre ${b.valeur}`.slice(0, 200));
  }
  return false;
}

// ------------------------------------------------------------------------ execution

const voulus = domainesAQualifier();
const run = nouveauRun("qualification");

console.log(`Vigie SEO — qualification par tables publiques · run ${run}`);
console.log(`${voulus.length} domaine(s) a qualifier · tables : ${tablesVoulues.join(", ")}`);
console.log(`limite de telechargement : ${TAILLE_MAX_MO} Mo${CACHE_SEUL ? " · --cache-seulement : AUCUN acces reseau" : ""}\n`);

const index = {};
const incidents = [];

for (const t of tablesVoulues) {
  const def = TABLES[t];
  process.stdout.write(`  ${t.padEnd(14)} `);
  const cache = lireIndex(t);

  // Ce que le cache ne couvre pas : ni trouve, ni meme cherche le jour de sa construction.
  const nonCouverts = cache ? voulus.filter((d) => !cache.demandes.has(d)) : voulus;

  if (cache && !nonCouverts.length) {
    index[t] = cache;
    console.log(`cache complet · ${Object.keys(cache.entrees).length} entrees sur ${cache.domaines_demandes.length} demandes · table du ${cache.date_telechargement.slice(0, 10)}`);
    continue;
  }

  if (CACHE_SEUL) {
    index[t] = cache;
    if (cache) {
      // Cache partiel : la table SERT quand meme pour les domaines qu'elle couvre. On ne
      // pose pas de ligne au niveau de la table, sinon elle dirait « rien n a pu etre
      // qualifie » alors que la plupart l'ont ete. Chaque domaine non couvert porte deja
      // sa propre ligne d'angle mort, avec son motif.
      console.log(`cache partiel · ${nonCouverts.length} domaine(s) jamais cherches, non retelecharges (--cache-seulement)`);
    } else {
      const msg = "aucun index en cache et --cache-seulement : rien n a ete telecharge";
      console.log(msg);
      incidents.push({ table: t, http: null, raison: msg, drapeau: "cache_seulement", total: true });
    }
    continue;
  }

  // ⛔ ON RELIT L'UNION, PAS SEULEMENT CE QU'ON VEUT AUJOURD'HUI. Sans ca, un simple
  //    « --domaines=exemple.com » declencherait une relecture de la table et reecrirait
  //    l'index avec UN domaine, detruisant la couverture des 2 239 autres. La passe
  //    suivante les verrait alors comme « jamais cherches » et redemanderait 194 Mo. Le
  //    perimetre du cache ne doit que grandir.
  const aChercher = [...new Set([...voulus, ...(cache?.domaines_demandes || [])])].sort();
  if (cache) {
    console.log(
      `cache incomplet (${nonCouverts.length} domaine(s) jamais cherches) → relecture de la table ` +
      `pour ${aChercher.length} domaines (perimetre precedent conserve)`
    );
  } else {
    console.log("aucun cache → premier telechargement");
  }

  const t0 = Date.now();
  let res;
  try {
    res = await moissonnerTable(def, aChercher);
  } catch (e) {
    res = { ok: false, http: null, raison: `lecture interrompue : ${String(e.message).slice(0, 160)}` };
  }

  if (!res.ok) {
    // On NE fabrique PAS de lignes par domaine dans ce cas : ce serait 2 200 angles morts
    // pour une seule cause. Une ligne par table, avec le motif.
    console.log(`    ▲ ${res.raison}${cache ? ` · l index du ${cache.date_telechargement.slice(0, 10)} sert de secours` : ""}`);
    index[t] = cache || null;
    incidents.push({
      table: t, http: res.http,
      raison: res.raison + (cache ? ` L index en cache du ${cache.date_telechargement.slice(0, 10)} a servi de secours.` : ""),
      drapeau: res.refuseParTaille ? "refuse_par_taille_max" : "table_indisponible",
      // Sans cache de secours, aucun domaine n'est qualifiable par cette table. Avec, la
      // plupart le restent : la nuance change ce que le site a le droit d'afficher.
      total: !cache,
    });
    continue;
  }

  const chemin = ecrireIndex(t, res);
  res.demandes = new Set(res.domaines_demandes);
  index[t] = res;
  console.log(
    `    ${res.lignes_lues.toLocaleString("fr-FR")} lignes lues en ${((Date.now() - t0) / 1000).toFixed(1)} s · ` +
    `${Object.keys(res.entrees).length} domaine(s) retrouves · ${(res.octets_recus / 1024 / 1024).toFixed(1)} Mo recus · ` +
    `index ecrit (${(fs.statSync(chemin).size / 1024).toFixed(0)} Ko)`
  );
}

// --------------------------------------------------------------- fabrication des lignes

const obs = [];

for (const inc of incidents) {
  obs.push(observation({
    run_id: run, collecteur: VERSION,
    type: "autorite", sujet: { domaine: null }, metrique: `table_${inc.table}`,
    etat: "ANGLE_MORT", nature: "mesure_absente",
    source: { nom: inc.table, endpoint: TABLES[inc.table].url, http: inc.http, methode: "flux" },
    preuve: inc.total
      ? `${inc.raison} Aucun des ${voulus.length} domaines n a pu etre qualifie par cette table.`
      : `${inc.raison} Les domaines couverts par le cache restent qualifies, les autres portent leur propre ligne.`,
    drapeaux: inc.total ? [inc.drapeau, "aucune_qualification_par_cette_table"] : [inc.drapeau],
  }));
}

const tailles = {
  openpagerank: index.openpagerank?.lignes_lues || TABLES.openpagerank.tailleAnnoncee,
  majestic: index.majestic?.lignes_lues || TABLES.majestic.tailleAnnoncee,
};

const compte = { MESURE: 0, MESURE_ABSENT: 0, ANGLE_MORT: 0, divergents: 0 };

// Calibration : la relation entre les deux tables se mesure sur les domaines apparies de
// CETTE passe, avant de juger le moindre desaccord.
const paires = [];
if (index.openpagerank && index.majestic) {
  for (const d of voulus) {
    const o = index.openpagerank.entrees[d];
    const m = index.majestic.entrees[d];
    if (o?.rang && m?.rang) paires.push(Math.log10(o.rang / m.rang));
  }
}
const cal = calibrer(paires);
if (index.openpagerank && index.majestic) {
  console.log(
    `\ncalibration du croisement : ${cal.origine} · facteur median ${(10 ** cal.decalage).toFixed(2)} · ` +
    `seuil a ${SEUIL_EN_MAD} ecarts medians, soit un facteur ${Math.round(10 ** (SEUIL_EN_MAD * cal.dispersion))}`
  );
}

for (const d of voulus) {
  const iO = index.openpagerank;
  const iM = index.majestic;
  const chercheO = !!iO?.demandes?.has(d);
  const chercheM = !!iM?.demandes?.has(d);
  const opr = chercheO ? iO.entrees[d] || null : null;
  const maj = chercheM ? iM.entrees[d] || null : null;

  // ⛔ Le croisement n'a de sens que si les DEUX tables ont ete lues. Avec une seule, on ne
  //    peut pas savoir si elles divergent, et surtout on ne doit pas conclure qu'elles
  //    s'accordent : c'est le meme piege que le zero a la place de l'angle mort.
  const div = (iO && iM)
    ? croiser({ opr, maj, tailleOpr: tailles.openpagerank, cal, chercheOpr: chercheO })
    : null;
  if (div) compte.divergents++;
  const drapeauxDiv = div ? ["index_divergents"] : [];

  // ------------------------------------------------------------------ OpenPageRank
  if (tablesVoulues.includes("openpagerank")) {
    const src = { nom: "openpagerank", endpoint: TABLES.openpagerank.url, http: iO?.http ?? null, methode: "flux" };
    const base = {
      run_id: run, collecteur: VERSION, type: "autorite", sujet: { domaine: d },
      source: src, date_donnee: iO?.date_donnee || null,
    };
    if (!iO) {
      // La table n'a pas ete lue du tout : deja dit une fois plus haut, on ne repete pas
      // par domaine. Rien a ecrire ici.
    } else if (!chercheO) {
      obs.push(observation({
        ...base, metrique: "open_page_rank", etat: "ANGLE_MORT", nature: "mesure_absente",
        preuve: `domaine absent de l index en cache ET jamais cherche lors de sa construction du ${iO.date_telechargement.slice(0, 10)} : « pas dans le top ${tailles.openpagerank} » serait une conclusion abusive`,
        drapeaux: ["hors_perimetre_du_cache", ...drapeauxDiv],
      }));
      compte.ANGLE_MORT++;
    } else if (!opr) {
      // ⛔ VRAIE information, et une des plus utiles du fichier : le domaine a bien ete
      //    cherche dans dix millions d'entrees et il n'y est pas. C'est un signal de
      //    faiblesse mesure, pas un trou.
      obs.push(observation({
        ...base, metrique: "open_page_rank", etat: "MESURE_ABSENT", nature: "mesure_absente",
        preuve: `cherche dans les ${tailles.openpagerank.toLocaleString("fr-FR")} lignes de la table et absent : hors du top 10 M OpenPageRank`,
        drapeaux: ["hors_table", ...drapeauxDiv],
      }));
      compte.MESURE_ABSENT++;
    } else {
      obs.push(observation({
        ...base, metrique: "open_page_rank", valeur: opr.score, unite: "score_0_10",
        nature: "estimation", etat: "MESURE",
        preuve: div ? div.preuve : `rang ${opr.rang} sur ${tailles.openpagerank.toLocaleString("fr-FR")}`,
        drapeaux: drapeauxDiv,
      }));
      obs.push(observation({
        ...base, metrique: "rang_openpagerank", valeur: opr.rang, unite: "rang",
        nature: "estimation", etat: "MESURE", drapeaux: drapeauxDiv,
      }));
      obs.push(observation({
        ...base, metrique: "domaines_referents", valeur: opr.referents, unite: "domaine",
        // ⛔ nature "plancher" et pas "mesure" : un compte de domaines referents issu d'un
        //    index est ce que CET index a vu, jamais ce qui existe. Le socle porte cette
        //    nature exactement pour ca, et le site doit ecrire « au moins N ».
        nature: "plancher", etat: "MESURE",
        preuve: "compte vu par le crawl OpenPageRank : un plancher, jamais un total",
        drapeaux: drapeauxDiv,
      }));
      compte.MESURE++;
    }
  }

  // ---------------------------------------------------------------------- Majestic
  if (tablesVoulues.includes("majestic")) {
    const src = { nom: "majestic", endpoint: TABLES.majestic.url, http: iM?.http ?? null, methode: "flux" };
    const base = {
      run_id: run, collecteur: VERSION, type: "autorite", sujet: { domaine: d },
      source: src, date_donnee: iM?.date_donnee || null,
    };
    if (!iM) {
      // idem : dit une fois par table, pas par domaine.
    } else if (!chercheM) {
      obs.push(observation({
        ...base, metrique: "rang_majestic", etat: "ANGLE_MORT", nature: "mesure_absente",
        preuve: `domaine absent de l index en cache ET jamais cherche lors de sa construction du ${iM.date_telechargement.slice(0, 10)}`,
        drapeaux: ["hors_perimetre_du_cache", ...drapeauxDiv],
      }));
      compte.ANGLE_MORT++;
    } else if (!maj) {
      obs.push(observation({
        ...base, metrique: "rang_majestic", etat: "MESURE_ABSENT", nature: "mesure_absente",
        preuve: `cherche dans les ${tailles.majestic.toLocaleString("fr-FR")} lignes du Majestic Million et absent : hors du top 1 M`,
        drapeaux: ["hors_table", ...drapeauxDiv],
      }));
      compte.MESURE_ABSENT++;
    } else {
      obs.push(observation({
        ...base, metrique: "rang_majestic", valeur: maj.rang, unite: "rang",
        nature: "estimation", etat: "MESURE",
        preuve: div ? div.preuve : `rang ${maj.rang} sur ${tailles.majestic.toLocaleString("fr-FR")}`,
        drapeaux: drapeauxDiv,
      }));
      obs.push(observation({
        ...base, metrique: "sous_reseaux_referents", valeur: maj.sousReseaux, unite: "sous_reseau",
        // Le compte de sous-reseaux distincts est le seul des trois qui resiste au reseau
        // de sites d'un meme proprietaire : mille liens depuis un seul /24 valent un.
        nature: "plancher", etat: "MESURE",
        preuve: "sous-reseaux /24 distincts vus par Majestic : un plancher, et le compte le plus dur a gonfler",
        drapeaux: drapeauxDiv,
      }));
      obs.push(observation({
        ...base, metrique: "ips_referentes", valeur: maj.ips, unite: "ip",
        nature: "plancher", etat: "MESURE", drapeaux: drapeauxDiv,
      }));
      if (typeof maj.rangPrecedent === "number" && maj.rangPrecedent > 0) {
        obs.push(observation({
          ...base, metrique: "rang_majestic_variation", valeur: maj.rangPrecedent - maj.rang, unite: "rang",
          // Positif = le domaine a GAGNE des places (son rang a baisse). Le dire, sinon la
          // moitie des lecteurs lira le signe a l'envers.
          nature: "derive", etat: "MESURE",
          preuve: `rang precedent ${maj.rangPrecedent}, rang actuel ${maj.rang} : un delta positif veut dire des places GAGNEES`,
          drapeaux: drapeauxDiv,
        }));
      }
      compte.MESURE++;
    }
  }

  // ------------------------------------------------------------------ le desaccord
  if (div) {
    obs.push(observation({
      run_id: run, collecteur: VERSION,
      type: "autorite", sujet: { domaine: d }, metrique: "divergence_opr_majestic",
      valeur: div.ecart, unite: "log10_ecart_de_rang",
      // ⛔ Cette ligne ne tranche PAS. Elle dit « les deux index ne racontent pas la meme
      //    chose sur ce domaine », pour que la note qui sera calculee plus tard puisse
      //    refuser de noter, ou noter a la baisse, plutot que de choisir un camp au hasard.
      nature: div.nature, etat: div.etat,
      source: { nom: "vigie_croisement", endpoint: "openpagerank x majestic", http: null, methode: "local" },
      preuve: `${div.preuve} · calibration : ${cal.origine}`,
      drapeaux: ["index_divergents", "ne_pas_noter_sans_arbitrage"],
    }));
  }
}

console.log(
  `\n${compte.MESURE} qualification(s) · ${compte.MESURE_ABSENT} hors table (vraie mesure de faiblesse) · ` +
  `${compte.ANGLE_MORT} hors perimetre du cache · ${compte.divergents} domaine(s) ou les deux index divergent`
);

// Le controle tourne AUSSI en --dry : c'est justement la passe ou l'on veut apprendre
// qu'une cle est mal construite, avant d'ecrire quoi que ce soit.
const cleSaine = verifierCollisions(obs);

if (DRY) {
  const parEtat = obs.reduce((a, o) => ((a[o.etat] = (a[o.etat] || 0) + 1), a), {});
  console.log(`--dry : ${obs.length} observations NON ecrites. Etats : ${JSON.stringify(parEtat)}`);
  const divs = obs.filter((o) => o.metrique === "divergence_opr_majestic").slice(0, 12);
  if (divs.length) {
    console.log(`\n  premiers desaccords entre les deux index :`);
    for (const o of divs) console.log(`   ${String(o.sujet.domaine).padEnd(30)} ${o.preuve}`);
  }
  const ex = obs.filter((o) => o.etat === "MESURE" && o.metrique === "open_page_rank").slice(0, 1);
  if (ex.length) console.log("\n  une ligne complete :\n" + JSON.stringify(ex[0], null, 1));
} else if (!cleSaine) {
  console.error("\nRien n a ete ecrit : corriger les cles avant de relancer.");
  process.exitCode = 1;
} else {
  const n = ecrire(obs);
  console.log(
    `${n} observations ecrites` +
    (n < obs.length
      ? ` (${obs.length - n} deja presentes aujourd hui, ecartees par le dedoublonnage du socle).`
      : ".")
  );
}
