// MESURE : sante technique, couverture de sitemap et popularite publique d'un domaine.
// SOURCE : le domaine lui-meme (HTTP, TLS, robots.txt, sitemaps), l'API Tranco, la liste CrUX.
// NE DIT PAS : ni le trafic, ni les positions, ni la valeur des liens qui pointent vers lui.
//
// C'est le collecteur le plus important de la Vigie SEO, et pour une seule raison :
// TOUTES ses valeurs sont des mesures, aucune n'est une estimation. Les outils du marche
// vendent un « Domain Authority » qu'ils calculent chez eux et qu'on ne peut ni verifier
// ni reproduire. Ici, chaque chiffre est le resultat d'un appel qu'on peut rejouer a la
// main dans un terminal, avec son code HTTP et sa date. Rien ne depend d'un abonnement,
// d'un quota, d'un navigateur pilote ailleurs, ni d'une carte bancaire.
//
// CE QU'IL MESURE, PAR DOMAINE :
//   A. technique  : code de la racine, chaine de redirections, TTFB, poids, TLS, robots
//   B. couverture : nombre d'URL au sitemap (index suivis, gzip gere), profondeur moyenne,
//                   dossiers de premier niveau, date du lastmod le plus recent
//   C. autorite   : rang Tranco (top 1M, gratuit) et bucket CrUX (Chrome, gratuit)
//
// ⛔ LES DOMAINES CITES DANS LES COMMENTAIRES SONT DES EXEMPLES, LES MESURES SONT REELLES.
//    Tout ce qui suit a ete mesure le 21/08/2026 sur des sites vivants ; leurs noms sont
//    remplaces ici par exemple.com et concurrent-un.com a concurrent-cinq.com. Ce qui
//    compte est le comportement observe, jamais l'identite du site qui l'a produit.
//
// ⛔ LES QUATRE REGLES DU MAGASIN S'APPLIQUENT ICI PLUS QU'AILLEURS, parce que c'est le
//    collecteur qui alimente les colonnes qu'on regarde en premier :
//
//  1. JAMAIS UN ZERO LA OU LA MESURE A ECHOUE. Un sitemap derriere Cloudflare rend
//     ANGLE_MORT, pas « 0 page ». Mesure du 21/08/2026 : concurrent-un.com (exemple)
//     declarait pourtant bien « Sitemap: https://www.<domaine>/sitemapIndex.xml » dans son
//     robots.txt, et cette URL rendait un HTTP 403 « Just a moment... » de Cloudflare.
//     Zero URL lue n'est PAS zero URL publiee, c'est un mur.
//
//  2. UN CHIFFRE PARTIEL N'EST JAMAIS PRESENTE COMME UN TOTAL. concurrent-deux.com
//     (exemple) publie 34 sous-sitemaps, dont des shards numerotes jusqu'a 1000000
//     (mesure du 21/08). Quand le budget est atteint, nb_url_sitemap passe en ANGLE_MORT
//     « plafond atteint », il n'affiche jamais les 200 000 premieres URL comme si c'etait
//     le compte.
//
//  3. UN 403 N'EST PAS UNE ABSENCE, et le relais n'est pas une cle passe-partout.
//     r.jina.ai sur le sitemap mure de concurrent-un.com rend le MEME 403 Cloudflare
//     (mesure du 21/08). On tente quand meme, et on enregistre les DEUX tentatives dans
//     la preuve.
//
//  4. UNE PANNE RESEAU PASSAGERE N'EST PAS UNE PANNE DE SITE. Le 21/08 a 03h52, la racine
//     d'un site du panel a rendu « Connect Timeout Error » au premier appel, puis 200 cinq
//     fois d'affilee dans la minute qui a suivi. Un collecteur sans second essai aurait
//     ecrit que ce site etait injoignable. D'ou `recupererFiable`.
//
// Les cibles ne sont JAMAIS ecrites dans ce fichier : elles viennent de la configuration
// (config/domaines.json, ou le fichier que designe VIGIE_CONFIG) ou de --domaines.
//
// Usage :
//   node outils/collecte-domaine.mjs
//   node outils/collecte-domaine.mjs --domaines=exemple.com,concurrent-un.com --dry
//   node outils/collecte-domaine.mjs --max-sitemaps=40 --max-url=200000
//   node outils/collecte-domaine.mjs --recharge-crux     (force le retelechargement)

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import tls from "node:tls";

import { observation, ecrire, nouveauRun, config, RACINE } from "./_lib-obs.mjs";
import { robots, hote, UA_CHROME } from "./_lib-liens.mjs";

const VERSION = "collecte-domaine@1.0.0";

// ⛔ LE CACHE NE VIT PAS A COTE DU CODE, ET ENCORE MOINS DANS UN CHEMIN EN DUR. Le fichier
//    CrUX pese 8,7 Mo compresse et 34 Mo decompresse, il se retelecharge tout seul et il
//    n'a RIEN a faire dans l'historique git. Il va donc dans <racine>/.cache/, cree au
//    besoin, que le .gitignore du depot ignore deja. RACINE vient du socle : c'est le
//    dossier parent de outils/, jamais un chemin d'installation ecrit ici.
const CACHE = path.join(RACINE, ".cache");

const arg = (n, def = null) => {
  const v = (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  return v === undefined || v === "" ? def : v;
};
const DRY = process.argv.includes("--dry");
const RECHARGE_CRUX = process.argv.includes("--recharge-crux");
const MAX_SITEMAPS = Number(arg("max-sitemaps", 40));
const MAX_URL = Number(arg("max-url", 200000));
// Troisieme garde-fou, moins evident que les deux autres : un shard de sitemap ne dit pas
// sa taille. Mesure du 21/08 sur les 34 sous-sitemaps d'un concurrent : 33 d'entre eux
// repondent a un HEAD sans aucun Content-Length (transfert chunked). Impossible donc de
// prevoir le volume, il faut le compter PENDANT la lecture et couper.
const MAX_OCTETS = Number(arg("max-octets", 60_000_000));
const PARALLELE = Number(arg("parallele", 4));

const cfg = config();
const demandes = arg("domaines");
const cibles = demandes
  ? demandes.split(",").map((d) => ({ domaine: d.trim(), libelle: d.trim(), role: "demande" }))
  : [
      ...cfg.nous.map((d) => ({ ...d, role: "nous" })),
      ...cfg.concurrents.map((d) => ({ ...d, role: "concurrent" })),
    ];

const run = nouveauRun("domaine");

// ---------------------------------------------------------------- reseau

const DELAI = 20000;

/**
 * Un fetch qui rend l'objet Response ET le temps d'attente des en-tetes.
 * `redirect: "manual"` est volontaire : c'est la seule facon de COMPTER les sauts.
 * `recuperer()` du socle suit les redirections en silence, donc il ne peut pas dire
 * qu'un apex part sur un www, ce qui est pourtant une information SEO de premier ordre.
 */
async function appel(url, { methode = "GET", timeout = DELAI } = {}) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: methode,
      headers: {
        "user-agent": UA_CHROME,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      redirect: "manual",
      signal: ctrl.signal,
    });
    // ⛔ Le temps mesure ici couvre DNS + TCP + TLS + premier octet d'en-tete. C'est le
    //    TTFB vu depuis ce poste, pas le temps de traitement du serveur. On l'ecrit tel
    //    quel et on le dit, plutot que de le maquiller en metrique serveur.
    return { ok: true, r, ttfb: Date.now() - t0 };
  } catch (e) {
    return {
      ok: false, r: null, ttfb: Date.now() - t0,
      erreur: e.name === "AbortError" ? "delai depasse" : String(e.cause?.message || e.message || e).slice(0, 160),
    };
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Deux essais avant de declarer une panne. Voir la regle 4 de l'en-tete : sans ca, le
 * collecteur ecrit regulierement qu'un site est injoignable alors qu'il repond.
 */
async function recupererFiable(url, opts = {}) {
  let dernier = await appel(url, opts);
  if (dernier.ok) return dernier;
  await patienter(1500);
  const second = await appel(url, opts);
  return second.ok ? second : { ...second, premiereErreur: dernier.erreur };
}

const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reconnaissance d'un mur anti-robot, par opposition a une vraie reponse.
 * Cloudflare rend un HTTP 403 avec « Just a moment... » et un meta noindex : la page
 * existe, elle est simplement interdite a un client sans JavaScript. Confondre ca avec
 * une page vide est exactement l'erreur que le magasin d'observations interdit.
 */
function estMurAntiRobot(http, corps = "") {
  if (http === 429) return "HTTP 429, quota epuise";
  if (http === 202) return "HTTP 202, ecran de verification";
  if (/Just a moment|cf-browser-verification|challenge-platform|Checking your browser|Attention Required/i.test(corps)) {
    return `HTTP ${http}, ecran de verification Cloudflare`;
  }
  if (http === 403) return "HTTP 403, acces refuse a un client sans navigateur";
  return null;
}

// ---------------------------------------------------------------- A. sante technique

/**
 * Suit la chaine de redirections a la main, saut par saut.
 * Rend le code du PREMIER appel (c'est lui, « le code de https://<d>/ »), le nombre de
 * sauts, l'URL finale, le code final, le TTFB du premier saut et le poids du corps final.
 */
async function sante(domaine) {
  const depart = `https://${domaine}/`;
  const chaine = [];
  let url = depart, ttfbPremier = null, codePremier = null, erreur = null;
  let corps = "", octets = null, httpFinal = null;

  for (let saut = 0; saut < 8; saut++) {
    const a = saut === 0 ? await recupererFiable(url) : await appel(url);
    if (!a.ok) {
      erreur = a.premiereErreur ? `${a.erreur} (1er essai : ${a.premiereErreur})` : a.erreur;
      break;
    }
    if (saut === 0) { ttfbPremier = a.ttfb; codePremier = a.r.status; }
    chaine.push(`${a.r.status} ${url}`);
    httpFinal = a.r.status;
    const suivant = a.r.headers.get("location");
    if (a.r.status >= 300 && a.r.status < 400 && suivant) {
      // Le corps d'une 301 ne sert a rien, on le vide pour ne pas garder de handle ouvert.
      await a.r.arrayBuffer().catch(() => {});
      url = new URL(suivant, url).href;
      continue;
    }
    corps = await a.r.text().catch(() => "");
    octets = Buffer.byteLength(corps, "utf8");
    break;
  }

  return {
    depart, chaine, redirections: Math.max(0, chaine.length - 1),
    codePremier, httpFinal, urlFinale: url, ttfb: ttfbPremier, octets, corps, erreur,
  };
}

/**
 * Validite du certificat, mesuree par une vraie poignee de main TLS.
 * ⛔ Un fetch qui reussit ne prouve PAS grand-chose de plus, mais un fetch qui echoue ne
 *    dit pas POURQUOI. Ici on recupere authorized, authorizationError et la date
 *    d'expiration, ce qui permet de distinguer « certificat expire » de « origine en
 *    panne » : concurrent-cinq.com rend 521 avec un certificat Cloudflare valide.
 */
function certificat(domaine) {
  return new Promise((res) => {
    const s = tls.connect(
      { host: domaine, port: 443, servername: domaine, timeout: 12000, rejectUnauthorized: false },
      () => {
        const c = s.getPeerCertificate();
        const finLe = c && c.valid_to ? new Date(c.valid_to) : null;
        res({
          ok: true,
          valide: s.authorized,
          raison: s.authorizationError ? String(s.authorizationError) : null,
          emetteur: c?.issuer?.O || c?.issuer?.CN || null,
          expireLe: finLe && !Number.isNaN(finLe.getTime()) ? finLe.toISOString().slice(0, 10) : null,
        });
        s.destroy();
      }
    );
    s.on("timeout", () => { res({ ok: false, raison: "delai TLS depasse" }); s.destroy(); });
    s.on("error", (e) => res({ ok: false, raison: String(e.code || e.message).slice(0, 120) }));
  });
}

// ---------------------------------------------------------------- B. couverture

const RE_LOC = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
const RE_LASTMOD = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/gi;

/**
 * Lit un sitemap en COMPTANT AU FIL DE L'EAU au lieu de tout charger.
 *
 * ⛔ POURQUOI CE N'EST PAS UN SIMPLE await r.text(). Un shard de sitemap peut porter
 *    40 000 URL sans declarer sa taille (HEAD sans Content-Length, mesure du 21/08 sur
 *    concurrent-deux.com). Charger 26 shards en memoire pour decouvrir ensuite qu'on a depasse le
 *    budget revient a telecharger ce qu'on a justement decide de ne pas telecharger.
 *    Ici on coupe des que le budget d'octets ou d'URL est atteint.
 *
 * ⛔ ON NE SE FIE PAS AU Content-Type. concurrent-trois.com sert son sitemap en
 *    « application/rss+xml » alors que c'est un urlset parfaitement standard (mesure du
 *    21/08). On se fie a la presence de <urlset> ou <sitemapindex> dans le contenu.
 *
 * ⛔ ON NE SE FIE PAS NON PLUS A L'EXTENSION .gz. On regarde les deux octets magiques
 *    1f 8b : un sitemap gzippe peut etre servi sans extension, et un .gz peut etre
 *    deja decompresse par le serveur via Content-Encoding.
 */
async function lireSitemap(url, budget) {
  const a = await recupererFiable(url, { timeout: 30000 });
  if (!a.ok) return { etat: "ANGLE_MORT", http: null, preuve: a.erreur, locs: [], lastmods: [], estIndex: false };

  const http = a.r.status;
  if (http >= 300 && http < 400) {
    const suivant = a.r.headers.get("location");
    await a.r.arrayBuffer().catch(() => {});
    if (suivant && budget.sauts++ < 4) return lireSitemap(new URL(suivant, url).href, budget);
    return { etat: "ANGLE_MORT", http, preuve: "trop de redirections sur le sitemap", locs: [], lastmods: [], estIndex: false };
  }

  const brut = Buffer.from(await a.r.arrayBuffer().catch(() => new ArrayBuffer(0)));
  budget.octets += brut.length;

  let texte;
  if (brut.length > 1 && brut[0] === 0x1f && brut[1] === 0x8b) {
    try { texte = zlib.gunzipSync(brut).toString("utf8"); }
    catch (e) { return { etat: "ANGLE_MORT", http, preuve: `gzip illisible : ${e.message}`, locs: [], lastmods: [], estIndex: false }; }
  } else {
    texte = brut.toString("utf8");
  }

  const mur = estMurAntiRobot(http, texte.slice(0, 4000));
  if (mur) {
    // ⛔ Second essai par le relais, comme l'impose la doctrine. Il echoue souvent : le
    //    21/08, r.jina.ai sur un sitemapIndex mure rend le MEME 403 Cloudflare.
    //    On garde la trace des DEUX tentatives, c'est ce qui distingue un angle mort
    //    documente d'un angle mort suppose.
    const relais = await appel(`https://r.jina.ai/${url}`, { timeout: 30000 });
    const txtRelais = relais.ok ? await relais.r.text().catch(() => "") : "";
    if (relais.ok && relais.r.status === 200 && /<loc>|^\s*https?:\/\//im.test(txtRelais)) {
      return { etat: "MESURE", http: 200, viaRelais: true, ...extraire(txtRelais), preuve: `lu par r.jina.ai apres ${mur}` };
    }
    return {
      etat: "ANGLE_MORT", http, locs: [], lastmods: [], estIndex: false,
      preuve: `${mur} | relais r.jina.ai : ${relais.ok ? "HTTP " + relais.r.status : relais.erreur}`,
    };
  }

  if (http === 404 || http === 410) {
    // Un 404 sur un sitemap est une VRAIE mesure : ce sitemap-la n'existe pas. Ce n'est ni
    // un mur ni une absence de pages, et l'appelant en fait ce qu'il veut.
    return { etat: "MESURE_ABSENT", http, preuve: `HTTP ${http}`, locs: [], lastmods: [], estIndex: false };
  }
  if (http !== 200) {
    // ⛔ TOUT LE RESTE EST UN ANGLE MORT, ET LE 5xx EST LE CAS QUI L'A IMPOSE.
    //    Premiere version de ce fichier : concurrent-cinq.com, origine en panne, rendait 521 sur
    //    /sitemap.xml et le collecteur affichait « aucun sitemap trouve ». Un serveur qui
    //    tombe ne dit pas que le sitemap n'existe pas, il ne dit rien du tout. Confondre
    //    les deux fait disparaitre un concurrent du tableau au lieu de le signaler.
    return { etat: "ANGLE_MORT", http, preuve: `HTTP ${http}, le serveur n a pas rendu le sitemap`, locs: [], lastmods: [], estIndex: false };
  }
  if (!/<urlset|<sitemapindex/i.test(texte.slice(0, 3000))) {
    return { etat: "ANGLE_MORT", http, preuve: `HTTP 200 mais ni <urlset> ni <sitemapindex> en tete (${texte.slice(0, 60).replace(/\s+/g, " ")})`, locs: [], lastmods: [], estIndex: false };
  }
  return { etat: "MESURE", http, ...extraire(texte) };
}

function extraire(texte) {
  const locs = [];
  RE_LOC.lastIndex = 0;
  for (const m of texte.matchAll(RE_LOC)) locs.push(m[1].replace(/&amp;/g, "&").trim());
  const lastmods = [];
  RE_LASTMOD.lastIndex = 0;
  for (const m of texte.matchAll(RE_LASTMOD)) lastmods.push(m[1]);
  return { locs, lastmods, estIndex: /<sitemapindex/i.test(texte.slice(0, 3000)) };
}

/**
 * Parcourt l'arbre des sitemaps d'un domaine et rend le corpus d'URL.
 * Rend TOUJOURS `plafond` a vrai quand un budget a saute, pour que l'appelant sache que
 * le chiffre qu'il tient est un plancher et non un total.
 */
async function couverture(domaine, sitemapsDeclares) {
  // Ordre : ce que le site declare d'abord, les emplacements conventionnels ensuite.
  // On ne DEVINE une URL que si le robots.txt n'en propose aucune.
  const candidats = sitemapsDeclares.length
    ? [...sitemapsDeclares]
    : [
        `https://${domaine}/sitemap.xml`,
        `https://${domaine}/sitemap_index.xml`,
        `https://${domaine}/sitemap-index.xml`,
        `https://${domaine}/sitemap.xml.gz`,
      ];

  const budget = { octets: 0, sauts: 0 };
  const vus = new Set();
  const file = [...candidats];
  const locs = [];
  const lastmods = [];
  const journal = [];
  let lus = 0, plafond = null, murs = 0, absents = 0;

  while (file.length) {
    if (lus >= MAX_SITEMAPS) { plafond = `plafond atteint : ${MAX_SITEMAPS} sitemaps lus, ${locs.length} URL vues, ${file.length} encore en file`; break; }
    if (locs.length >= MAX_URL) { plafond = `plafond atteint : ${locs.length} URL lues (budget ${MAX_URL}), ${lus} sitemaps lus pour ${Math.round(budget.octets / 1048576)} Mo, ${file.length} encore en file`; break; }
    if (budget.octets >= MAX_OCTETS) { plafond = `plafond atteint : ${Math.round(budget.octets / 1048576)} Mo telecharges, ${file.length} sitemaps encore en file`; break; }

    const u = file.shift();
    if (vus.has(u)) continue;
    vus.add(u);

    const r = await lireSitemap(u, budget);
    lus++;
    // ⛔ LE JOURNAL PORTE LA RAISON, PAS SEULEMENT L'ETAT. Premiere version : la preuve
    //    ecrite pour un sitemap mure etait « ANGLE_MORT https://www.<domaine>/sitemapIndex.xml »,
    //    ce qui ne dit ni que c'est Cloudflare, ni que le relais a ete tente. Une preuve
    //    qui ne permet pas de rejouer la mesure a la main ne prouve rien.
    journal.push(
      `${r.etat === "MESURE" ? r.http : r.etat} ${u.slice(0, 90)}` +
      (r.locs.length ? ` (${r.locs.length} loc)` : "") +
      (r.etat === "MESURE" ? "" : ` [${r.preuve}]`)
    );
    if (r.etat === "ANGLE_MORT") { murs++; continue; }
    if (r.etat === "MESURE_ABSENT") { absents++; continue; }

    if (r.estIndex) {
      // Un index de sitemaps ne contient pas d'URL de pages : ses <loc> sont d'autres
      // sitemaps. Les compter comme des pages gonflerait de 34 le chiffre du voisin ci-dessus.
      for (const l of r.locs) if (!vus.has(l)) file.push(l);
      // Quand le robots ne declarait rien et que le premier candidat est un index valide,
      // les autres candidats devines n'ont plus lieu d'etre essayes.
      if (!sitemapsDeclares.length) for (const c of candidats) vus.add(c);
    } else {
      locs.push(...r.locs);
      lastmods.push(...r.lastmods);
      if (!sitemapsDeclares.length) for (const c of candidats) vus.add(c);
    }
  }

  // Rien lu du tout : soit tout etait mur (angle mort), soit tout etait 404 (mesure).
  const rien = locs.length === 0;
  const etat = plafond ? "ANGLE_MORT"
    : rien && murs > 0 ? "ANGLE_MORT"
    : rien ? "MESURE_ABSENT"
    : "MESURE";

  return {
    etat, plafond, locs, lastmods, murs, absents, lus,
    octets: budget.octets,
    preuve: plafond || journal.slice(0, 6).join(" | ") || "aucun sitemap trouve",
    candidats,
  };
}

/** Statistiques de forme du corpus d'URL : profondeur et dossiers de premier niveau. */
function formeDuCorpus(locs, domaine) {
  const dossiers = new Map();
  let sommeSegments = 0, comptees = 0;
  for (const u of locs) {
    let chemin;
    try { chemin = new URL(u).pathname; } catch { continue; }
    const segs = chemin.split("/").filter(Boolean);
    sommeSegments += segs.length;
    comptees++;
    // La racine « / » n'appartient a aucun dossier, on la range sous « (racine) » pour
    // qu'elle ne disparaisse pas du total.
    const cle = segs.length ? `/${segs[0]}/` : "(racine)";
    dossiers.set(cle, (dossiers.get(cle) || 0) + 1);
  }
  const tri = [...dossiers.entries()].sort((a, b) => b[1] - a[1]);
  return {
    comptees,
    profondeurMoyenne: comptees ? sommeSegments / comptees : null,
    nbDossiers: dossiers.size,
    top: tri.slice(0, 12).map(([nom, n]) => ({ nom, n })),
    domaine,
  };
}

/** Le lastmod le plus recent, en ISO. Sert de date_donnee : c'est la fraicheur du site. */
function dernierLastmod(lastmods) {
  let max = null;
  for (const l of lastmods) {
    const d = new Date(l);
    if (Number.isNaN(d.getTime())) continue;
    if (!max || d > max) max = d;
  }
  // Une date dans le futur est une erreur d'editeur, pas une mesure de fraicheur.
  if (max && max.getTime() > Date.now() + 86400000) return { iso: null, futur: max.toISOString().slice(0, 10) };
  return { iso: max ? max.toISOString().replace(/\.\d{3}Z$/, "Z") : null, futur: null };
}

// ---------------------------------------------------------------- C. autorite

const TRANCO = (d) => `https://tranco-list.eu/api/ranks/domain/${d}`;

/**
 * Rang Tranco, liste gratuite du million de domaines les plus sollicites.
 *
 * ⛔ {"ranks": []} EST UNE VRAIE MESURE, PAS UN ANGLE MORT. La reponse veut dire « ce
 *    domaine n'est pas dans le top 1M », ce qui est une information exacte et utile.
 *    Mesure du 21/08 : deux domaines du panel rendent exactement ca (l'un trop jeune,
 *    l'autre en panne d'origine), pendant que trois autres rendent 359, 186 579 et
 *    861 612.
 *    Un HTTP different de 200, lui, est un angle mort : la source n'a pas repondu.
 */
async function tranco(domaine) {
  const a = await recupererFiable(TRANCO(domaine));
  if (!a.ok) return { etat: "ANGLE_MORT", http: null, preuve: a.erreur };
  const http = a.r.status;
  const txt = await a.r.text().catch(() => "");
  if (http !== 200) return { etat: "ANGLE_MORT", http, preuve: estMurAntiRobot(http, txt) || `HTTP ${http}` };
  let json;
  try { json = JSON.parse(txt); } catch { return { etat: "ANGLE_MORT", http, preuve: `reponse non JSON : ${txt.slice(0, 80)}` }; }
  // ⛔ Verification de la CLE ATTENDUE, jamais du seul code 200 : c'est la lecon de
  //    collecte-bing-backlinks, ou une route inexistante rendait 200 avec du HTML.
  if (!("ranks" in json)) return { etat: "ANGLE_MORT", http, preuve: `cle « ranks » absente : ${txt.slice(0, 100)}` };
  const r = json.ranks || [];
  if (!r.length) return { etat: "MESURE_ABSENT", http, preuve: `{"ranks": []} : hors du top 1M Tranco` };
  // La reponse est triee du plus recent au plus ancien (mesure du 21/08).
  return { etat: "MESURE", http, dernier: r[0], precedent: r[1] || null, nbPoints: r.length };
}

const CRUX_URL = "https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/current.csv.gz";
const CRUX_GZ = path.join(CACHE, "crux-current.csv.gz");
const CRUX_META = path.join(CACHE, "crux-current.meta.json");

/**
 * Liste CrUX de Chrome, telechargee UNE fois et mise en cache.
 *
 * ⛔ LA COLONNE N'EST PAS UN RANG, C'EST UN BUCKET. Le fichier rend « origin,rank » ou
 *    rank vaut 1000, 5000, 10000, 50000, 100000, 500000 ou 1000000 : c'est le palier
 *    dans lequel tombe l'origine, pas sa place. Afficher « rang 1000 » pour un domaine du
 *    premier palier (mesure du 21/08) laisserait croire a une precision qui n'existe pas.
 *    On ecrit donc
 *    la metrique sous le nom crux_bucket et l'unite « palier ».
 *
 * ⛔ L'ORIGINE EST UNE URL COMPLETE, PAS UN DOMAINE. Le fichier contient
 *    « https://www.concurrent-un.com » et pas « concurrent-un.com ». Chercher le domaine
 *    nu ne trouve rien et ferait declarer absents des sites qui sont pourtant dans la
 *    liste : mesure du 21/08, ce domaine est au palier 50 000, sous sa seule forme www.
 */
async function chargerCrux(origines) {
  fs.mkdirSync(CACHE, { recursive: true });
  const ageJours = fs.existsSync(CRUX_GZ)
    ? (Date.now() - fs.statSync(CRUX_GZ).mtimeMs) / 86400000
    : Infinity;

  // Le depot publie une nouvelle version par mois. Au-dela de 14 jours, on rafraichit.
  if (RECHARGE_CRUX || ageJours > 14) {
    const a = await recupererFiable(CRUX_URL, { timeout: 120000 });
    if (a.ok && a.r.status === 200) {
      const buf = Buffer.from(await a.r.arrayBuffer());
      // Un fichier tronque casserait le gunzip a chaque lancement suivant : on ne remplace
      // le cache que si le nouveau fichier se decompresse.
      try {
        zlib.gunzipSync(buf);
        fs.writeFileSync(CRUX_GZ, buf);
        fs.writeFileSync(CRUX_META, JSON.stringify({ telecharge: new Date().toISOString(), octets: buf.length, date_donnee: await dateCrux() }, null, 1));
      } catch (e) {
        if (!fs.existsSync(CRUX_GZ)) return { etat: "ANGLE_MORT", preuve: `archive illisible : ${e.message}` };
      }
    } else if (!fs.existsSync(CRUX_GZ)) {
      return { etat: "ANGLE_MORT", preuve: a.ok ? `HTTP ${a.r.status} sur ${CRUX_URL}` : a.erreur };
    }
  }

  let texte;
  try { texte = zlib.gunzipSync(fs.readFileSync(CRUX_GZ)).toString("utf8"); }
  catch (e) { return { etat: "ANGLE_MORT", preuve: `cache illisible : ${e.message}` }; }

  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(CRUX_META, "utf8")); } catch { /* cache d'une version anterieure */ }

  // Une seule passe sur les 1 000 002 lignes, on ne retient que les origines demandees.
  const voulues = new Set(origines);
  const trouvees = new Map();
  let i = 0, lignes = 0;
  while (i < texte.length) {
    let j = texte.indexOf("\n", i);
    if (j < 0) j = texte.length;
    const virgule = texte.lastIndexOf(",", j);
    if (virgule > i) {
      const origine = texte.slice(i, virgule);
      // La premiere ligne est l'en-tete « origin,rank ». La compter dans le total ferait
      // annoncer 1 000 001 origines pour un fichier qui en porte 1 000 000.
      if (origine.startsWith("http")) {
        lignes++;
        if (voulues.has(origine)) trouvees.set(origine, Number(texte.slice(virgule + 1, j)));
      }
    }
    i = j + 1;
  }
  return { etat: "MESURE", trouvees, lignes, date_donnee: meta.date_donnee || null, octets: fs.statSync(CRUX_GZ).size };
}

/** Date de la derniere publication du fichier CrUX, lue sur l'API publique de GitHub. */
async function dateCrux() {
  const a = await appel("https://api.github.com/repos/zakird/crux-top-lists/commits?path=data/global/current.csv.gz&per_page=1", { timeout: 15000 });
  if (!a.ok || a.r.status !== 200) return null;
  try {
    const j = JSON.parse(await a.r.text());
    return j?.[0]?.commit?.committer?.date || null;
  } catch { return null; }
}

// ---------------------------------------------------------------- une passe par domaine

async function traiter(cible, crux) {
  const d = cible.domaine;
  const obs = [];
  const ligne = { domaine: d, role: cible.role, libelle: cible.libelle || d, angles: [] };
  const src = (nom, endpoint, http) => ({ nom, endpoint, http, methode: "http" });
  const angle = (metrique, raison) => ligne.angles.push(`${metrique} : ${raison}`);

  const pousser = (o) => { obs.push(o); return o; };

  // ---- A. sante technique
  const s = await sante(d);
  const endpointRacine = `https://${d}/`;

  if (s.codePremier === null) {
    ligne.http = "▲";
    angle("http_racine", s.erreur);
    for (const m of ["http_racine", "ttfb_ms", "poids_page_octets"]) {
      pousser(observation({
        type: "technique", sujet: { domaine: d }, metrique: m,
        etat: "ANGLE_MORT", nature: "mesure_absente",
        source: src("http", endpointRacine, null),
        preuve: s.erreur, run_id: run, collecteur: VERSION, drapeaux: ["injoignable"],
      }));
    }
  } else {
    ligne.http = String(s.codePremier);
    ligne.redirections = s.redirections;
    ligne.urlFinale = s.urlFinale;
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "http_racine",
      valeur: s.codePremier, unite: "code", nature: "mesure", etat: "MESURE",
      source: src("http", endpointRacine, s.codePremier),
      preuve: s.chaine.join(" -> "), run_id: run, collecteur: VERSION,
    }));
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "redirections",
      valeur: s.redirections, unite: "saut", nature: "mesure", etat: "MESURE",
      source: src("http", endpointRacine, s.codePremier),
      preuve: s.chaine.join(" -> "), run_id: run, collecteur: VERSION,
    }));
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "url_finale",
      valeur: s.urlFinale, unite: "url", nature: "mesure", etat: "MESURE",
      source: src("http", endpointRacine, s.httpFinal),
      preuve: hote(s.urlFinale) === d ? "meme hote" : `l apex part sur ${hote(s.urlFinale)}`,
      run_id: run, collecteur: VERSION,
    }));
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "ttfb_ms",
      valeur: s.ttfb, unite: "ms", nature: "mesure", etat: "MESURE",
      source: src("http", endpointRacine, s.codePremier),
      preuve: "DNS + TCP + TLS + premier octet d en-tete, mesure depuis ce poste",
      run_id: run, collecteur: VERSION, drapeaux: ["mesure_depuis_un_seul_point"],
    }));
    ligne.ttfb = s.ttfb;

    // ⛔ LE POIDS D'UNE PAGE D'ERREUR N'EST PAS LE POIDS DE LA PAGE D'ACCUEIL.
    //    concurrent-cinq.com rend 521 avec 6 955 octets d'ecran Cloudflare (21/08).
    //    Ecrire « 6,8 Ko » dans la colonne poids ferait passer une origine en panne pour
    //    un site tres leger, ce qui est exactement le mensonge qu'on cherche a eviter.
    const mur = estMurAntiRobot(s.httpFinal, s.corps.slice(0, 4000));
    if (s.httpFinal >= 400 || mur) {
      const raison = mur || `HTTP ${s.httpFinal}, la reponse est un ecran d erreur et pas la page d accueil`;
      angle("poids_page_octets", raison);
      ligne.poids = "▲";
      pousser(observation({
        type: "technique", sujet: { domaine: d }, metrique: "poids_page_octets",
        etat: "ANGLE_MORT", nature: "mesure_absente",
        source: src("http", endpointRacine, s.httpFinal),
        preuve: raison, run_id: run, collecteur: VERSION,
        drapeaux: [s.httpFinal >= 500 ? "origine_en_panne" : "mur_anti_robot"],
      }));
    } else {
      ligne.poids = s.octets;
      pousser(observation({
        type: "technique", sujet: { domaine: d }, metrique: "poids_page_octets",
        valeur: s.octets, unite: "octet", nature: "mesure", etat: "MESURE",
        source: src("http", endpointRacine, s.httpFinal),
        preuve: `corps HTML servi sur ${s.urlFinale}`, run_id: run, collecteur: VERSION,
      }));
    }
  }

  // ---- TLS
  const c = await certificat(d);
  if (!c.ok) {
    ligne.ssl = "▲";
    angle("ssl_valide", c.raison);
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "ssl_valide",
      etat: "ANGLE_MORT", nature: "mesure_absente",
      source: src("tls", `${d}:443`, null),
      preuve: c.raison, run_id: run, collecteur: VERSION,
    }));
  } else {
    ligne.ssl = c.valide ? "ok" : "NON";
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "ssl_valide",
      valeur: c.valide, nature: "mesure", etat: "MESURE",
      source: src("tls", `${d}:443`, null),
      date_donnee: null,
      preuve: c.valide
        ? `certificat ${c.emetteur || "?"} valide jusqu au ${c.expireLe || "?"}`
        : `poignee de main refusee : ${c.raison}`,
      run_id: run, collecteur: VERSION,
    }));
  }

  // ---- robots.txt
  //
  // ⛔ LE SOCLE CLASSE UN 403 EN « MESURE », ET C'EST UN PIEGE. _lib-liens.robots() rend
  //    etat MESURE des que le fetch aboutit, meme sur un 403 ou un 429, avec sitemaps: []
  //    et bloqueTout: false. Un mur deviendrait alors « robots.txt sans restriction ».
  //    On requalifie ici, sans toucher au socle.
  let rb = await robots(d);
  if (rb.etat === "ANGLE_MORT" && rb.http === null) { await patienter(1200); rb = await robots(d); }
  const robotsEndpoint = `https://${d}/robots.txt`;
  const murRobots = rb.http && rb.http !== 200 && (rb.http === 403 || rb.http === 429 || rb.http >= 500)
    ? `HTTP ${rb.http}` : null;

  if (rb.etat === "ANGLE_MORT" || murRobots) {
    const raison = murRobots || rb.preuve;
    ligne.robots = "▲";
    angle("robots_http", raison);
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "robots_http",
      etat: "ANGLE_MORT", nature: "mesure_absente",
      source: src("robots.txt", robotsEndpoint, rb.http),
      preuve: raison, run_id: run, collecteur: VERSION,
    }));
  } else {
    // Le libelle du tableau distingue le robots.txt de l'editeur de celui que l'edge sert
    // a sa place quand l'origine est tombee : concurrent-cinq.com rend 525 sur sa racine
    // et 200 sur son robots.txt, le fichier « content signals » par defaut de Cloudflare.
    const parLEdge = s.httpFinal >= 500 && rb.http === 200;
    ligne.robots = rb.http !== 200 ? String(rb.http)
      : rb.bloqueTout ? "TOUT BLOQUE"
      : parLEdge ? "ok (edge)"
      : rb.sitemaps.length ? "ok+sitemap" : "ok";
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "robots_http",
      valeur: rb.http, unite: "code", nature: "mesure", etat: "MESURE",
      source: src("robots.txt", robotsEndpoint, rb.http),
      preuve: rb.http === 200 ? `${rb.octets} octets` : `pas de robots.txt (HTTP ${rb.http})`,
      run_id: run, collecteur: VERSION,
      // concurrent-cinq.com illustre le cas : origine en 521, robots.txt en 200 par l edge
      // Cloudflare (le fichier « content signals » par defaut). Ce robots-la n'est pas
      // celui de l editeur, et le drapeau evite d'en tirer une conclusion editoriale.
      drapeaux: parLEdge ? ["robots_servi_par_l_edge_origine_en_panne"] : [],
    }));
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "robots_declare_sitemap",
      valeur: rb.sitemaps.length > 0, nature: "mesure", etat: "MESURE",
      source: src("robots.txt", robotsEndpoint, rb.http),
      preuve: rb.sitemaps.length ? rb.sitemaps.slice(0, 3).join(" ") : "aucune ligne Sitemap:",
      run_id: run, collecteur: VERSION,
    }));
    // ⛔ « Disallow: / » integral est une MESURE, valeur true, nature mesure. Ce n'est PAS
    //    un angle mort et surtout pas zero page : le site est incartographiable PAR CHOIX
    //    DE L EDITEUR. La difference compte, parce qu'un angle mort demande de reessayer
    //    autrement alors qu'un choix editorial ne changera pas au prochain passage.
    pousser(observation({
      type: "technique", sujet: { domaine: d }, metrique: "robots_bloque_tout",
      valeur: rb.bloqueTout, nature: "mesure", etat: "MESURE",
      source: src("robots.txt", robotsEndpoint, rb.http),
      preuve: rb.bloqueTout
        ? "incartographiable par choix de l editeur : User-agent: * / Disallow: /"
        : "le crawl general n est pas interdit",
      run_id: run, collecteur: VERSION,
      drapeaux: rb.bloqueTout ? ["incartographiable_par_choix_de_l_editeur"] : [],
    }));
  }

  // ---- B. couverture
  const sitemapsDeclares = rb.etat === "MESURE" && rb.http === 200 ? rb.sitemaps : [];
  let cov = null;

  if (rb.bloqueTout && !sitemapsDeclares.length) {
    // On ne va pas deviner /sitemap.xml chez un editeur qui vient d'ecrire Disallow: /.
    ligne.urls = "n/a";
    pousser(observation({
      type: "couverture", sujet: { domaine: d }, metrique: "nb_url_sitemap",
      etat: "MESURE_ABSENT", nature: "mesure_absente",
      source: src("sitemap", `https://${d}/robots.txt`, 200),
      preuve: "incartographiable par choix de l editeur : robots.txt interdit tout et ne declare aucun sitemap",
      run_id: run, collecteur: VERSION, drapeaux: ["incartographiable_par_choix_de_l_editeur"],
    }));
  } else {
    cov = await couverture(d, sitemapsDeclares);
    const endpointSm = cov.candidats[0] || `https://${d}/sitemap.xml`;

    if (cov.etat === "ANGLE_MORT") {
      ligne.urls = "▲";
      angle("nb_url_sitemap", cov.preuve);
      pousser(observation({
        type: "couverture", sujet: { domaine: d }, metrique: "nb_url_sitemap",
        etat: "ANGLE_MORT", nature: "mesure_absente",
        source: src("sitemap", endpointSm, null),
        preuve: cov.preuve, run_id: run, collecteur: VERSION,
        drapeaux: cov.plafond ? ["plafond_atteint", "plancher_pas_un_total"] : ["mur_anti_robot"],
      }));
      // ⛔ Un plafond ne rend pas l'echantillon inutile, il rend le TOTAL inconnaissable.
      //    On garde donc la forme du corpus, mais en nature « estimation » et jamais en
      //    « mesure », et le compte de dossiers reste un angle mort : un decompte partiel
      //    presente comme un total est precisement l'erreur qu'on interdit.
      if (cov.plafond && cov.locs.length) {
        const f = formeDuCorpus(cov.locs, d);
        ligne.prof = f.profondeurMoyenne;
        ligne.dossiers = "▲";
        pousser(observation({
          type: "couverture", sujet: { domaine: d }, metrique: "profondeur_moyenne_url",
          valeur: Number(f.profondeurMoyenne.toFixed(2)), unite: "segment",
          nature: "estimation", etat: "MESURE",
          source: src("sitemap", endpointSm, 200),
          preuve: `moyenne sur les ${f.comptees} premieres URL, corpus tronque au plafond`,
          run_id: run, collecteur: VERSION, drapeaux: ["sur_echantillon_plafonne"],
        }));
        pousser(observation({
          type: "couverture", sujet: { domaine: d }, metrique: "nb_dossiers_racine",
          etat: "ANGLE_MORT", nature: "mesure_absente",
          source: src("sitemap", endpointSm, 200),
          preuve: `${f.nbDossiers} dossiers vus sur un corpus tronque : le total est inconnaissable`,
          run_id: run, collecteur: VERSION, drapeaux: ["plafond_atteint"],
        }));
        for (const t of f.top) {
          pousser(observation({
            type: "couverture", sujet: { domaine: d }, objet: { url: t.nom },
            metrique: "nb_url_dossier", valeur: t.n, unite: "url",
            nature: "estimation", etat: "MESURE",
            source: src("sitemap", endpointSm, 200),
            preuve: `${t.n} URL sous ${t.nom} dans un corpus tronque au plafond`,
            run_id: run, collecteur: VERSION, drapeaux: ["sur_echantillon_plafonne"],
          }));
        }
      } else {
        // ⛔ UNE METRIQUE QUI DISPARAIT DU JOURNAL EST PIRE QU'UN ZERO. dernier() du socle
        //    construit la photo du jour a partir des lignes presentes : si on n'ecrit rien
        //    pour profondeur_moyenne_url quand le sitemap est un mur, la colonne se vide
        //    sans que personne ne sache si elle vaut zero, si elle n'a pas ete mesuree, ou
        //    si le collecteur a plante. On ecrit donc l'angle mort, explicitement.
        ligne.prof = null; ligne.dossiers = "▲";
        for (const m of ["profondeur_moyenne_url", "nb_dossiers_racine"]) {
          pousser(observation({
            type: "couverture", sujet: { domaine: d }, metrique: m,
            etat: "ANGLE_MORT", nature: "mesure_absente",
            source: src("sitemap", endpointSm, null),
            preuve: `aucune URL lisible : ${cov.preuve}`,
            run_id: run, collecteur: VERSION, drapeaux: ["mur_anti_robot"],
          }));
        }
      }
    } else if (cov.etat === "MESURE_ABSENT") {
      ligne.urls = "·";
      pousser(observation({
        type: "couverture", sujet: { domaine: d }, metrique: "nb_url_sitemap",
        etat: "MESURE_ABSENT", nature: "mesure_absente",
        source: src("sitemap", endpointSm, null),
        preuve: `aucun sitemap lisible. Essayes : ${cov.candidats.join(" ")} | ${cov.preuve}`,
        run_id: run, collecteur: VERSION, drapeaux: ["aucun_sitemap"],
      }));
      // Pas de sitemap du tout : la forme du corpus n'est pas un angle mort, elle est
      // absente pour la meme raison mesuree. Meme motif que ci-dessus, la ligne existe.
      for (const m of ["profondeur_moyenne_url", "nb_dossiers_racine"]) {
        pousser(observation({
          type: "couverture", sujet: { domaine: d }, metrique: m,
          etat: "MESURE_ABSENT", nature: "mesure_absente",
          source: src("sitemap", endpointSm, null),
          preuve: "aucun sitemap : rien a mesurer sur la forme des URL",
          run_id: run, collecteur: VERSION, drapeaux: ["aucun_sitemap"],
        }));
      }
    } else {
      const f = formeDuCorpus(cov.locs, d);
      ligne.urls = cov.locs.length;
      ligne.prof = f.profondeurMoyenne;
      ligne.dossiers = f.nbDossiers;
      pousser(observation({
        type: "couverture", sujet: { domaine: d }, metrique: "nb_url_sitemap",
        valeur: cov.locs.length, unite: "url", nature: "mesure", etat: "MESURE",
        source: src("sitemap", endpointSm, 200),
        preuve: `${cov.lus} sitemap(s) lus, ${Math.round(cov.octets / 1024)} Ko | ${cov.preuve}`,
        run_id: run, collecteur: VERSION,
        // Un sous-sitemap mur au milieu d'un index rend le total INCOMPLET. Le chiffre
        // reste une mesure, mais le site doit pouvoir dire « au moins tant ».
        drapeaux: cov.murs ? ["total_incomplet_un_sous_sitemap_est_un_mur"] : [],
      }));
      pousser(observation({
        type: "couverture", sujet: { domaine: d }, metrique: "profondeur_moyenne_url",
        valeur: Number(f.profondeurMoyenne.toFixed(2)), unite: "segment",
        nature: "mesure", etat: "MESURE",
        source: src("sitemap", endpointSm, 200),
        preuve: `moyenne des segments de chemin sur ${f.comptees} URL`,
        run_id: run, collecteur: VERSION,
      }));
      pousser(observation({
        type: "couverture", sujet: { domaine: d }, metrique: "nb_dossiers_racine",
        valeur: f.nbDossiers, unite: "dossier", nature: "mesure", etat: "MESURE",
        source: src("sitemap", endpointSm, 200),
        // Un « dossier racine » est un premier segment de chemin distinct. Une page de
        // premier niveau comme /pricing compte donc pour un dossier : c'est voulu, la
        // metrique sert a lire la STRUCTURE, pas a compter des repertoires reels.
        preuve: `premiers segments distincts : ${f.top.slice(0, 5).map((t) => `${t.nom} ${t.n}`).join(", ")}`,
        run_id: run, collecteur: VERSION,
      }));
      // Les 12 plus gros dossiers : c'est la lecture du pSEO d'un concurrent d'un coup
      // d'oeil. Mesure du 21/08/2026 : un concurrent du panel a multiplie son trafic par 5
      // en gonflant un seul de ces dossiers, et ca se voit ici avant de se voir ailleurs.
      for (const t of f.top) {
        pousser(observation({
          type: "couverture", sujet: { domaine: d }, objet: { url: t.nom },
          metrique: "nb_url_dossier", valeur: t.n, unite: "url",
          nature: "mesure", etat: "MESURE",
          source: src("sitemap", endpointSm, 200),
          preuve: `${t.n} URL sous ${t.nom}`, run_id: run, collecteur: VERSION,
        }));
      }
      ligne.top = f.top;
    }

    // ---- date du dernier lastmod
    const lm = dernierLastmod(cov.lastmods);
    if (lm.iso) {
      ligne.lastmod = lm.iso.slice(0, 10);
      pousser(observation({
        type: "couverture", sujet: { domaine: d }, metrique: "date_derniere_modif",
        valeur: lm.iso.slice(0, 10), unite: "date", nature: "mesure", etat: "MESURE",
        source: src("sitemap", cov.candidats[0], 200),
        date_donnee: lm.iso,
        preuve: `<lastmod> le plus recent parmi ${cov.lastmods.length} declares`,
        run_id: run, collecteur: VERSION,
      }));
    } else {
      pousser(observation({
        type: "couverture", sujet: { domaine: d }, metrique: "date_derniere_modif",
        etat: "MESURE_ABSENT", nature: "mesure_absente",
        source: src("sitemap", cov.candidats[0], null),
        preuve: lm.futur
          ? `le seul lastmod trouve est dans le futur (${lm.futur}), erreur d editeur`
          : "aucune balise <lastmod> dans les sitemaps lus",
        run_id: run, collecteur: VERSION,
      }));
    }
  }

  // ---- C1. Tranco
  const t = await tranco(d);
  if (t.etat === "ANGLE_MORT") {
    ligne.tranco = "▲";
    angle("tranco_rang", t.preuve);
    pousser(observation({
      type: "autorite", sujet: { domaine: d }, metrique: "tranco_rang",
      etat: "ANGLE_MORT", nature: "mesure_absente",
      source: src("tranco", TRANCO(d), t.http),
      preuve: t.preuve, run_id: run, collecteur: VERSION,
    }));
  } else if (t.etat === "MESURE_ABSENT") {
    ligne.tranco = "hors 1M";
    pousser(observation({
      type: "autorite", sujet: { domaine: d }, metrique: "tranco_rang",
      etat: "MESURE_ABSENT", nature: "mesure_absente",
      source: src("tranco", TRANCO(d), 200),
      preuve: t.preuve, run_id: run, collecteur: VERSION,
      drapeaux: ["hors_top_1m"],
    }));
  } else {
    ligne.tranco = t.dernier.rank;
    ligne.trancoDelta = t.precedent ? t.dernier.rank - t.precedent.rank : null;
    pousser(observation({
      type: "autorite", sujet: { domaine: d }, metrique: "tranco_rang",
      valeur: t.dernier.rank, unite: "rang", nature: "mesure", etat: "MESURE",
      source: src("tranco", TRANCO(d), 200),
      // ⛔ date_donnee est la date de la LISTE, pas celle de la lecture. Tranco publie la
      //    veille : sans ce champ, le site presenterait une photo d'hier comme du jour.
      date_donnee: `${t.dernier.date}T00:00:00Z`,
      preuve: `liste du ${t.dernier.date}, ${t.nbPoints} points disponibles`,
      run_id: run, collecteur: VERSION,
    }));
    if (t.precedent) {
      // On garde le point precedent pour que la tendance soit lisible des le PREMIER
      // passage. Sans lui, il faut attendre un deuxieme releve pour voir bouger quoi que
      // ce soit, et le tableau se lit aujourd'hui.
      pousser(observation({
        type: "autorite", sujet: { domaine: d }, metrique: "tranco_rang_precedent",
        valeur: t.precedent.rank, unite: "rang", nature: "mesure", etat: "MESURE",
        source: src("tranco", TRANCO(d), 200),
        date_donnee: `${t.precedent.date}T00:00:00Z`,
        preuve: `liste du ${t.precedent.date} | variation ${t.dernier.rank - t.precedent.rank} places`,
        run_id: run, collecteur: VERSION,
      }));
    }
  }

  // ---- C2. CrUX
  const endpointCrux = CRUX_URL;
  if (crux.etat !== "MESURE") {
    ligne.crux = "▲";
    angle("crux_bucket", crux.preuve);
    pousser(observation({
      type: "autorite", sujet: { domaine: d }, metrique: "crux_bucket",
      etat: "ANGLE_MORT", nature: "mesure_absente",
      source: src("crux_top_lists", endpointCrux, null),
      preuve: crux.preuve, run_id: run, collecteur: VERSION,
    }));
  } else {
    const nu = `https://${d}`, avecWww = `https://www.${d}`;
    const rang = crux.trouvees.get(nu) ?? crux.trouvees.get(avecWww) ?? null;
    const forme = crux.trouvees.has(nu) ? nu : crux.trouvees.has(avecWww) ? avecWww : null;
    if (rang === null) {
      ligne.crux = "hors 1M";
      pousser(observation({
        type: "autorite", sujet: { domaine: d }, metrique: "crux_bucket",
        etat: "MESURE_ABSENT", nature: "mesure_absente",
        source: src("crux_top_lists", endpointCrux, 200),
        date_donnee: crux.date_donnee,
        preuve: `ni ${nu} ni ${avecWww} dans les ${crux.lignes} origines du fichier`,
        run_id: run, collecteur: VERSION, drapeaux: ["hors_top_1m"],
      }));
    } else {
      ligne.crux = rang;
      pousser(observation({
        type: "autorite", sujet: { domaine: d }, metrique: "crux_bucket",
        valeur: rang, unite: "palier", nature: "mesure", etat: "MESURE",
        source: src("crux_top_lists", endpointCrux, 200),
        date_donnee: crux.date_donnee,
        preuve: `origine ${forme}, palier ${rang} (un palier, pas un rang)`,
        run_id: run, collecteur: VERSION, drapeaux: ["palier_pas_un_rang"],
      }));
    }
  }

  return { obs, ligne };
}

// ---------------------------------------------------------------- affichage

const ko = (o) => (o === null || o === undefined ? "·" : typeof o === "number" ? `${Math.round(o / 1024)} Ko` : String(o));
const num = (v) => (v === null || v === undefined ? "·" : typeof v === "number" ? v.toLocaleString("fr-FR") : String(v));

function tableau(lignes) {
  const cols = [
    ["DOMAINE", 24, (l) => l.domaine],
    ["ROLE", 11, (l) => l.role],
    ["HTTP", 5, (l) => l.http ?? "·"],
    ["RED", 4, (l) => (l.redirections === undefined ? "·" : String(l.redirections))],
    ["TTFB", 7, (l) => (l.ttfb === undefined || l.ttfb === null ? "·" : `${l.ttfb}ms`)],
    ["POIDS", 8, (l) => ko(l.poids)],
    ["SSL", 4, (l) => l.ssl ?? "·"],
    ["ROBOTS", 12, (l) => l.robots ?? "·"],
    ["URL SITEMAP", 12, (l) => num(l.urls)],
    ["PROF", 5, (l) => (typeof l.prof === "number" ? l.prof.toFixed(1) : "·")],
    ["DOSS", 5, (l) => (l.dossiers === undefined ? "·" : String(l.dossiers))],
    ["TRANCO", 10, (l) => num(l.tranco)],
    ["CrUX", 10, (l) => num(l.crux)],
  ];
  const barre = cols.map(([, w]) => "-".repeat(w)).join(" ");
  const tete = cols.map(([t, w]) => t.padEnd(w)).join(" ");
  const corps = lignes.map((l) => cols.map(([, w, f]) => String(f(l)).slice(0, w).padEnd(w)).join(" "));
  return [tete, barre, ...corps].join("\n");
}

// ---------------------------------------------------------------- execution

console.log(`Vigie SEO · sante, couverture et popularite · ${cibles.length} domaine(s) · run ${run}`);
console.log(`budgets : ${MAX_SITEMAPS} sitemaps, ${MAX_URL.toLocaleString("fr-FR")} URL, ${Math.round(MAX_OCTETS / 1048576)} Mo par domaine · ${PARALLELE} en parallele${DRY ? " · --dry" : ""}\n`);

// La liste CrUX est chargee UNE fois pour tout le lot : 8,7 Mo compresses, 34 Mo une fois
// ouverts, 1 000 002 lignes. La telecharger par domaine serait 24 fois le meme fichier.
const originesVoulues = cibles.flatMap((c) => [`https://${c.domaine}`, `https://www.${c.domaine}`]);
process.stdout.write("chargement de la liste CrUX ... ");
const crux = await chargerCrux(originesVoulues);
console.log(crux.etat === "MESURE"
  ? `${crux.lignes.toLocaleString("fr-FR")} origines, publiee le ${(crux.date_donnee || "?").slice(0, 10)}, cache ${Math.round(crux.octets / 1048576 * 10) / 10} Mo`
  : `▲ ${crux.preuve}`);
console.log("");

const resultats = [];
const toutes = [];

// ⛔ QUATRE DOMAINES A LA FOIS AU MAXIMUM. Au-dela, on se fait jeter : Cloudflare compte
//    les connexions par IP, et un lot de 24 domaines lances ensemble fabriquerait des
//    HTTP 429 qui ressembleraient a des murs anti-robot alors qu'ils viendraient de nous.
//    Un angle mort qu'on s'est inflige soi-meme est le pire de tous : il est indiscernable.
for (let i = 0; i < cibles.length; i += PARALLELE) {
  const lot = cibles.slice(i, i + PARALLELE);
  const rs = await Promise.all(lot.map(async (c) => {
    try {
      return await traiter(c, crux);
    } catch (e) {
      console.log(`  ${c.domaine.padEnd(24)} ECHEC : ${String(e.message).slice(0, 140)}`);
      return { obs: [], ligne: { domaine: c.domaine, role: c.role, http: "▲", angles: [`collecteur : ${String(e.message).slice(0, 120)}`] } };
    }
  }));
  for (const r of rs) {
    resultats.push(r.ligne);
    toutes.push(...r.obs);
    const a = r.ligne.angles?.length ? ` ▲${r.ligne.angles.length}` : "";
    console.log(`  ${r.ligne.domaine.padEnd(24)} ${String(r.ligne.http).padEnd(4)} ${String(num(r.ligne.urls)).padStart(8)} URL${a}`);
  }
}

console.log(`\n${tableau(resultats)}`);
console.log(`\n  · = mesure absente (la source a repondu « rien », c est une vraie mesure)`);
console.log(`  ▲ = angle mort (la source n a pas repondu, la valeur est nulle et son poids retire du calcul)`);

const avecAngles = resultats.filter((l) => l.angles?.length);
if (avecAngles.length) {
  console.log(`\nANGLES MORTS : ${avecAngles.reduce((a, l) => a + l.angles.length, 0)} mesure(s) impossible(s) sur ${avecAngles.length} des ${resultats.length} domaines`);
  for (const l of avecAngles) {
    console.log(`  ${l.domaine}`);
    for (const a of l.angles) console.log(`     ▲ ${a.slice(0, 150)}`);
  }
}

// Les plus gros dossiers, c'est la lecture pSEO immediate d'un concurrent.
const avecTop = resultats.filter((l) => l.top?.length >= 2 && l.top[0].n >= 3).slice(0, 8);
if (avecTop.length) {
  console.log(`\nDOSSIERS LES PLUS FOURNIS (lecture pSEO)`);
  for (const l of avecTop) {
    console.log(`  ${l.domaine.padEnd(22)} ${l.top.slice(0, 5).map((t) => `${t.nom} ${t.n}`).join("  ")}`);
  }
}

if (DRY) {
  console.log(`\n--dry : ${toutes.length} observations NON ecrites.`);
  const parEtat = toutes.reduce((a, o) => ((a[o.etat] = (a[o.etat] || 0) + 1), a), {});
  console.log(`   repartition : ${Object.entries(parEtat).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(JSON.stringify(toutes.slice(0, 2), null, 1));
} else {
  // ⛔ RELANCABLE SANS RIEN CASSER, ET C'EST LE SOCLE QUI LE GARANTIT DEPUIS LE 21/08.
  //    obs_id est un hachage qui inclut la DATE DU JOUR : relancer le collecteur deux fois
  //    le meme jour refabrique exactement les memes identifiants, et ecrire() les ignore.
  //    Deux passes a deux jours d'ecart font bien deux points de courbe, deux passes dans
  //    la meme heure n'en font qu'un. On ne refait donc PAS le filtrage ici : le dedoublonner
  //    une seconde fois dans chaque collecteur, c'est deux verites possibles pour une seule
  //    regle, et c'est comme ca qu'elles finissent par diverger.
  const n = ecrire(toutes);
  console.log(`
${n} observations ecrites (${toutes.length - n} deja au journal aujourd hui, ignorees par ecrire()).`);
}

// Le cache CrUX vit dans <racine>/.cache/, que le .gitignore du depot ignore deja : 8,7 Mo
// qui se regenerent tout seuls n'ont rien a faire dans un historique de code.
