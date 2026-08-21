// D'OU VIENNENT LES PAGES CANDIDATES.
//
// Personne ne peut recrawler le web. Ce que fait un outil payant, c'est entretenir un
// index permanent ; ce qu'on fait ici, c'est aller chercher les endroits ou une mention
// a une chance d'exister, puis OUVRIR chaque page pour lire le lien pour de vrai.
//
// ⛔ UNE MENTION N'EST PAS UN LIEN. Rien de ce que rend ce fichier n'est un backlink :
//    ce sont des candidats. Le verdict vient de la lecture du HTML, dans _robot.js.
//
// ⛔ UNE SOURCE MUETTE N'EST PAS UNE SOURCE VIDE. Chaque source rend son etat :
//      MESURE       elle a repondu a LA requete posee (zero resultat compris)
//      ANGLE_MORT   mur, delai, ou requete ignoree
//
// ⛔ ET LE PIEGE QUI A COUTE UNE DEMI-JOURNEE, LE 21/08/2026 :
//    UN MOTEUR PEUT RENDRE HTTP 200 AVEC DES RESULTATS QUI N'ONT RIEN A VOIR.
//    Interroge en RSS sur « "exemple.com" », Bing a rendu dix resultats parfaitement
//    formes : la page d'accueil de Microsoft, Outlook, la fiche Wikipedia de Microsoft.
//    Le code etait 200, le XML valide, le nombre de resultats credible. Les candidats
//    ainsi recoltes ont fait ouvrir au robot une page de wikiHow sur « comment creer un
//    lien » et un article de fandom sur le personnage Link.
//    Le controle n'est donc JAMAIS le code de retour, et jamais la forme : c'est que la
//    reponse cite la cible AILLEURS que dans l'echo de la requete. Voir `aRepondu()`.

import { AGENT, domaineDe, memeSite, MAINTENANT } from "./_commun.js";

const TIMEOUT = 9000;

async function lire(url, entetes = {}) {
  try {
    const r = await fetch(url, {
      headers: {
        "user-agent": AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "fr-FR,fr;q=0.9,en;q=0.7",
        ...entetes,
      },
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "follow",
    });
    if (!r.ok) return { ok: false, pourquoi: "HTTP " + r.status };
    return { ok: true, texte: (await r.text()).slice(0, 700000) };
  } catch (e) {
    return { ok: false, pourquoi: e.name === "TimeoutError" ? "delai depasse" : "injoignable" };
  }
}

/**
 * La reponse a-t-elle vu la requete ?
 *
 * On coupe les 900 premiers caracteres : c'est la ou vivent l'en-tete du flux et le
 * rappel de la requete, qui citent la cible sans qu'aucun resultat ne la concerne.
 * Au-dela, une citation vient d'un resultat.
 */
function aRepondu(texte, cible) {
  const marque = cible.split(".")[0];
  if (marque.length < 3) return true;          // une marque trop courte rendrait le test faux
  const corps = texte.slice(900).toLowerCase();
  let n = 0;
  let i = corps.indexOf(marque);
  while (i >= 0 && n < 2) { n++; i = corps.indexOf(marque, i + marque.length); }
  return n >= 1;
}

function urlsDe(texte) {
  const sortie = new Set();
  const re = /(?:href\s*=\s*|<link>|<loc>|<url>)["']?(https?:\/\/[^"'<>\s)]+)/gi;
  let m;
  while ((m = re.exec(texte)) !== null) {
    sortie.add(m[1].split("#")[0].replace(/&amp;/g, "&").replace(/[.,;)]+$/, ""));
  }
  return [...sortie];
}

/**
 * LES URL D'UNE PAGE DE RESULTATS, FILTREES PAR LEUR VOISINAGE.
 *
 * ⛔ LE PIEGE QUI A COUTE LE PREMIER CRAWL, MESURE LE 21/08/2026.
 *    Interroges sur « "exemple.com" », guillemets compris, les moteurs font tous de
 *    l'a-peu-pres : Brave a rendu quarante resultats concernant « Trados » (un
 *    logiciel de traduction), « Trayodashi » (une fete hindoue) et une societe
 *    homonyme. Le robot a donc ouvert une page de wikiHow, un article de fandom et
 *    douze pages de trados.com. Vingt pages ouvertes, zero lien, et le tableau
 *    affichait « 0 backlink » comme si c'etait une mesure du site.
 *
 *    Le remede ne peut pas etre dans la requete : aucun moteur grand public ne
 *    respecte plus les guillemets, et l'operateur « link: » est mort partout. Il est
 *    donc ICI : on ne retient une URL que si le domaine cible apparait dans les
 *    ~1500 caracteres qui l'entourent, c'est-a-dire dans son bloc de resultat, son
 *    URL affichee ou son extrait. Un resultat qui ne cite pas la cible dans son
 *    propre bloc ne parle pas de la cible.
 *
 *    Ce filtre coute du rappel : une page qui pointe vers la cible sans que le
 *    moteur montre le domaine dans l'extrait est perdue. C'est le bon sens du
 *    compromis : le budget d'ouverture de pages est la ressource rare, et vingt
 *    pages depensees sur un homonyme, ce sont vingt pages qu'on n'ouvre pas ailleurs.
 */
function urlsDeResultats(texte, cible) {
  const gardees = new Set();
  const bas = texte.toLowerCase();
  const aiguille = cible.toLowerCase();
  const re = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(texte)) !== null) {
    const debut = Math.max(0, m.index - 1500);
    const fenetre = bas.slice(debut, m.index + 1500);
    if (fenetre.includes(aiguille)) {
      gardees.add(m[1].split("#")[0].replace(/&amp;/g, "&").replace(/[.,;)]+$/, ""));
    }
  }
  return [...gardees];
}

/** Les moteurs emballent leurs liens ; on les deballe avant de juger. */
function deballer(url) {
  try {
    const u = new URL(url);
    for (const cle of ["uddg", "url", "u", "r", "q"]) {
      const dedans = u.searchParams.get(cle);
      if (dedans && /^https?:\/\//i.test(dedans)) return dedans;
    }
  } catch { /* url illisible */ }
  return url;
}

const A_ECARTER = [
  "duckduckgo.com", "mojeek.com", "marginalia.nu", "marginalia-search.com", "google.com",
  "googleusercontent.com", "bing.com", "msn.com", "yahoo.com", "yandex.com", "brave.com",
  "search.brave.com", "startpage.com", "ecosia.org", "qwant.com", "presearch.com",
  "searx.be", "priv.au", "searxng.site", "tiekoetter.com", "yep.com", "rightdao.com",
  "algolia.com", "stackexchange.com", "w3.org", "schema.org", "creativecommons.org",
  "gstatic.com", "googleapis.com", "cloudflare.com", "gravatar.com", "wp.com",
  "doubleclick.net", "googletagmanager.com", "google-analytics.com", "ip2location.com",
  "microsoft.com", "office.com", "live.com", "apple.com", "adobe.com",
];

const ecarte = (d) => A_ECARTER.some((m) => d === m || d.endsWith("." + m));

class Panier {
  constructor(cible, plafond) {
    this.cible = cible;
    this.plafond = plafond;
    this.vus = new Set();
    this.liste = [];
  }
  get plein() { return this.liste.length >= this.plafond; }
  /** `force` sert aux sources ou le domaine ecarte EST le resultat (Wikipedia). */
  ajouter(url, origine, force = false) {
    if (this.plein) return false;
    const propre = deballer(String(url || "")).split("#")[0];
    if (!/^https?:\/\//i.test(propre) || propre.length > 400) return false;
    const dom = domaineDe(propre);
    if (!dom || memeSite(dom, this.cible)) return false;
    if (!force && ecarte(dom)) return false;
    const cle = propre.toLowerCase();
    if (this.vus.has(cle)) return false;
    this.vus.add(cle);
    this.liste.push({ url: propre, origine });
    return true;
  }
}

/** Le squelette commun a tous les moteurs qui rendent une page de resultats. */
async function moteur(panier, cible, nom, urls) {
  let total = 0;
  let dernierMur = null;
  let decor = false;
  for (const u of urls) {
    if (panier.plein) break;
    const r = await lire(u);
    if (!r.ok) { dernierMur = r.pourquoi; continue; }
    if (!aRepondu(r.texte, cible)) { decor = true; continue; }
    for (const lien of urlsDeResultats(r.texte, cible)) if (panier.ajouter(lien, nom)) total++;
  }
  if (total > 0) return { etat: "MESURE", trouves: total };
  if (dernierMur) return { etat: "ANGLE_MORT", pourquoi: dernierMur };
  if (decor) return { etat: "ANGLE_MORT", pourquoi: "requete ignoree, resultats sans rapport" };
  return { etat: "MESURE", trouves: 0, detail: "a repondu, aucun resultat ne cite la cible" };
}

/* ------------------------------------------------------------------ les sources */

const q = (s) => encodeURIComponent(s);

/** Brave a son propre index et il est le plus fourni des moteurs interrogeables. */
const brave = (p, c) =>
  moteur(p, c, "brave", [
    `https://search.brave.com/search?q=${q('"' + c + '"')}`,
    `https://search.brave.com/search?q=${q('"' + c + '"')}&offset=1`,
  ]);

/** Marginalia indexe le web independant, celui que les gros moteurs ne montrent plus. */
const marginalia = (p, c) =>
  moteur(p, c, "marginalia", [
    `https://search.marginalia.nu/search?query=${q(c)}`,
    `https://old-search.marginalia.nu/search?query=${q(c)}`,
  ]);

/** Des instances SearXNG publiques, qui agregent plusieurs index a la fois. */
const searx = (p, c) =>
  moteur(p, c, "searx", [
    `https://priv.au/search?q=${q('"' + c + '"')}`,
    `https://searx.be/search?q=${q('"' + c + '"')}`,
  ]);

/** La version legere de DuckDuckGo rend du HTML simple, sans JavaScript. */
async function duckduckgo(panier, cible) {
  const r = await lire(`https://lite.duckduckgo.com/lite/?q=${q('"' + cible + '"')}`);
  if (!r.ok) return { etat: "ANGLE_MORT", pourquoi: r.pourquoi };
  if (/anomaly_modal|captcha|unusual traffic/i.test(r.texte.slice(0, 6000))) {
    return { etat: "ANGLE_MORT", pourquoi: "controle anti-robot" };
  }
  if (!aRepondu(r.texte, cible)) return { etat: "ANGLE_MORT", pourquoi: "requete ignoree" };
  let n = 0;
  for (const u of urlsDeResultats(r.texte, cible)) if (panier.ajouter(u, "duckduckgo")) n++;
  return { etat: "MESURE", trouves: n };
}

const mojeek = (p, c) => moteur(p, c, "mojeek", [`https://www.mojeek.com/search?q=${q('"' + c + '"')}`]);

/**
 * Wikipedia expose officiellement la liste des pages qui pointent vers un domaine
 * (`list=exturlusage`). C'est la seule source de cette liste qui soit exacte et gratuite,
 * et un lien depuis Wikipedia vaut d'etre vu meme s'il est nofollow.
 */
async function wikipedia(panier, cible) {
  let n = 0;
  let muettes = 0;
  for (const langue of ["fr", "en"]) {
    const r = await lire(
      `https://${langue}.wikipedia.org/w/api.php?action=query&list=exturlusage` +
        `&euquery=${q(cible)}&eulimit=50&format=json&origin=*`
    );
    if (!r.ok) { muettes++; continue; }
    try {
      for (const p of JSON.parse(r.texte)?.query?.exturlusage || []) {
        if (!p.title) continue;
        const u = `https://${langue}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`;
        if (panier.ajouter(u, "wikipedia", true)) n++;
      }
    } catch { muettes++; }
  }
  return muettes === 2 ? { etat: "ANGLE_MORT", pourquoi: "API muette" } : { etat: "MESURE", trouves: n };
}

/** Hacker News expose une recherche plein texte gratuite et sans compte. */
async function hackernews(panier, cible) {
  const r = await lire(`https://hn.algolia.com/api/v1/search?query=${q(cible)}&hitsPerPage=40`);
  if (!r.ok) return { etat: "ANGLE_MORT", pourquoi: r.pourquoi };
  let n = 0;
  try {
    for (const h of JSON.parse(r.texte)?.hits || []) {
      if (h.url && panier.ajouter(h.url, "hackernews")) n++;
      if (h.objectID && panier.ajouter(`https://news.ycombinator.com/item?id=${h.objectID}`, "hackernews", true)) n++;
    }
  } catch { return { etat: "ANGLE_MORT", pourquoi: "reponse illisible" }; }
  return { etat: "MESURE", trouves: n };
}

/** Google News rend un flux RSS ouvert. Il ne voit que la presse, mais il la voit bien. */
async function presse(panier, cible) {
  const r = await lire(`https://news.google.com/rss/search?q=${q('"' + cible + '"')}&hl=fr&gl=FR&ceid=FR:fr`);
  if (!r.ok) return { etat: "ANGLE_MORT", pourquoi: r.pourquoi };
  if (!/<item>/i.test(r.texte)) return { etat: "MESURE", trouves: 0 };
  if (!aRepondu(r.texte, cible)) return { etat: "ANGLE_MORT", pourquoi: "requete ignoree" };
  let n = 0;
  for (const u of urlsDeResultats(r.texte, cible)) if (panier.ajouter(u, "presse")) n++;
  return { etat: "MESURE", trouves: n };
}

/**
 * LA RECIPROQUE. Les partenaires, les integrations, les annuaires ou l'on s'est inscrit
 * soi-meme : on les a presque toujours cites en premier. On lit le site, on releve ses
 * domaines sortants, et on va voir si le lien revient.
 *
 * ⛔ SA LIMITE, MESUREE : on ne peut mettre en file que la page d'ACCUEIL du partenaire,
 *    et un partenaire met rarement le lien sur son accueil. Sur un premier essai, huit
 *    accueils ouverts ont rendu zero lien. La source garde sa valeur pour les annuaires
 *    et les petits sites, ou l'accueil porte tout ; elle ne remplace pas un moteur.
 */
async function reciproque(panier, cible) {
  const domaines = new Set();
  let pages = 0;

  const accueil = await lire(`https://${cible}/`);
  if (!accueil.ok) return { etat: "ANGLE_MORT", pourquoi: "accueil " + accueil.pourquoi };
  pages++;
  ramasser(accueil.texte, cible, domaines);

  const plan = await lire(`https://${cible}/sitemap.xml`);
  if (plan.ok) {
    const internes = urlsDe(plan.texte)
      .filter((u) => { const d = domaineDe(u); return d && memeSite(d, cible); })
      .filter((u) => !/\.(jpe?g|png|gif|webp|svg|pdf|zip|xml)$/i.test(u));
    // On echantillonne au lieu de prendre les premieres : les premieres URL d'un
    // sitemap se ressemblent toutes et portent exactement les memes liens sortants.
    const pas = Math.max(1, Math.floor(internes.length / 6));
    for (let i = 0; i < internes.length && pages < 7; i += pas) {
      const p = await lire(internes[i]);
      pages++;
      if (p.ok) ramasser(p.texte, cible, domaines);
    }
  }

  let n = 0;
  for (const d of [...domaines].slice(0, 60)) if (panier.ajouter(`https://${d}/`, "reciproque")) n++;
  return { etat: "MESURE", trouves: n, detail: `${pages} page(s) du site, ${domaines.size} domaine(s) sortant(s)` };
}

function ramasser(html, cible, dans) {
  for (const u of urlsDe(html)) {
    const d = domaineDe(u);
    if (d && !memeSite(d, cible) && !ecarte(d)) dans.add(d);
  }
}

/**
 * L'INDEX PARTAGE, et c'est ce qui fait grandir l'outil. Une page qui cite deja un site
 * du meme secteur est un candidat serieux. C'est la seule source qui s'ameliore toute
 * seule avec le nombre d'utilisateurs.
 */
async function depuisIndex(panier, cible, bd) {
  if (!bd) return { etat: "ANGLE_MORT", pourquoi: "base indisponible" };
  let n = 0;
  try {
    const voisines = await bd
      .prepare(
        `SELECT DISTINCT b2.url_src AS url
           FROM backlinks b1 JOIN backlinks b2 ON b2.domaine_src = b1.domaine_src
          WHERE b1.cible = ? AND b2.cible <> ? LIMIT 60`
      )
      .bind(cible, cible)
      .all();
    for (const l of voisines.results || []) if (panier.ajouter(l.url, "index", true)) n++;

    // Les pages deja connues pour citer la cible : on les relit. Un lien retire est une
    // information, pas une absence de mesure.
    const anciennes = await bd
      .prepare(`SELECT DISTINCT url_src AS url FROM backlinks WHERE cible = ? LIMIT 80`)
      .bind(cible)
      .all();
    for (const l of anciennes.results || []) if (panier.ajouter(l.url, "index", true)) n++;
  } catch (e) {
    return { etat: "ANGLE_MORT", pourquoi: e.message };
  }
  return { etat: "MESURE", trouves: n };
}

/* --------------------------------------------------------------------- l'entree */

export async function trouverCandidats(bd, cible, plafond = 140) {
  const panier = new Panier(cible, plafond);

  // L'ordre compte : les sources qui rapportent le plus passent en premier, pour que le
  // plafond de candidats ne soit pas mange par les sources marginales.
  const sources = [
    ["brave", () => brave(panier, cible)],
    ["marginalia", () => marginalia(panier, cible)],
    ["searx", () => searx(panier, cible)],
    ["duckduckgo", () => duckduckgo(panier, cible)],
    ["mojeek", () => mojeek(panier, cible)],
    ["wikipedia", () => wikipedia(panier, cible)],
    ["hackernews", () => hackernews(panier, cible)],
    ["presse", () => presse(panier, cible)],
    ["index", () => depuisIndex(panier, cible, bd)],
    ["reciproque", () => reciproque(panier, cible)],
  ];

  const rapport = [];
  for (const [nom, faire] of sources) {
    if (panier.plein) {
      rapport.push({ source: nom, etat: "NON_LANCEE", pourquoi: "plafond de candidats atteint" });
      continue;
    }
    try {
      rapport.push({ source: nom, ...(await faire()) });
    } catch (e) {
      rapport.push({ source: nom, etat: "ANGLE_MORT", pourquoi: e.message });
    }
  }

  return { candidats: panier.liste, rapport, quand: MAINTENANT() };
}
