// QUALIFICATION D'UN BACKLINK : l'URL de la page source, le rel REEL, et les signaux de spam.
//
// C'est la brique qui repond aux deux questions qu'un tableau de backlinks laisse
// toujours ouvertes :
//   « sur chaque backlink, est-ce du dofollow ou non »
//   « lesquels sont des liens de spam »
//
// ⛔ POURQUOI CE COLLECTEUR EXISTE ALORS QUE BING DONNE DEJA LES BACKLINKS.
//    Bing Webmaster Tools rend le DOMAINE referent et l'ANCRE, et rien d'autre. Il ne
//    rend NI l'URL de la page qui porte le lien, NI l'attribut rel, NI la date. Un releve
//    du 21/08/2026 tenait en une ligne du genre « annuaire-exemple.fr -> exemple.com :
//    3 liens » (domaines d'exemple) et s'arretait la. Trois liens dont on ignore s'ils
//    valent quelque chose. Ici on va lire le HTML SERVI.
//
// ⛔ CE QUI SE JOUE, ET QUI A DEJA COUTE CHER :
//    Mesure du 17/08/2026 : un extracteur annoncait 14 dofollow sur un tableau de bord
//    d'une grande plateforme communautaire. Page privee derriere un login, et le
//    sous-domaine historique de cette plateforme interdit tout crawl dans son robots.txt.
//    Zero de ces 14 liens ne valait quoi que ce soit. Un rel propre ne suffit pas.
//    UN DOFOLLOW REEL EXIGE TROIS CONDITIONS, et ce collecteur mesure les trois :
//      1. la page est PUBLIQUE       (elle repond 200 sans cookie, pas de mur de login)
//      2. la page est CRAWLABLE      (robots.txt, meta robots, X-Robots-Tag)
//      3. l'ancre n'est pas coupee   (rel nofollow / sponsored / ugc)
//    Quand il en manque une, on DIT LAQUELLE au lieu de rendre un booleen muet.
//
// ⛔ UNE QUATRIEME CONDITION QUE PERSONNE NE REGARDE : `<meta name="robots" content="nofollow">`
//    coupe TOUS les liens de la page, meme ceux dont l'attribut rel est impeccable.
//    Un rel vide sur une page en meta-nofollow n'est pas un dofollow. On le mesure
//    separement sous le nom `suivi_effectif`, et il peut contredire `suivi`.
//
// ⛔ noopener et noreferrer NE COUPENT RIEN. Seuls nofollow, sponsored et ugc coupent.
//    C'est deja encode dans liensVers() du socle, on ne le redecide pas ici.
//
// ⛔ UN 403 N'EST PAS UNE ABSENCE DE LIEN, C'EST UN MUR. Mesure du 21/08/2026 : un site
//    marchand refusait curl en 403 et se lisait parfaitement dans un navigateur. On
//    rejoue donc par r.jina.ai. MAIS r.jina.ai rend du MARKDOWN : il permet de dire « la
//    page existe et le lien y est », il ne permet PAS de lire un rel, l'attribut n'existe
//    pas dans un rendu markdown.
//    Dans ce cas le lien est note PRESENT (mesure) et le rel est un ANGLE MORT.
//    On n'invente jamais un dofollow depuis un rendu markdown. Un mur se rejoue aussi au
//    navigateur, et c'est ce que fait collecte-murs.mjs.
//
// ⛔ ET SURTOUT : « je n'ai pas trouve la page » N'EST PAS « il n'y a pas de lien ».
//    Bing affirme qu'il y en a un. Si on ne localise pas la page portante, on ecrit un
//    ANGLE_MORT `page_portante` avec la liste de ce qu'on a essaye. Jamais un zero.
//
// Usage :
//   node outils/collecte-rel.mjs --limite=8 --dry
//   node outils/collecte-rel.mjs --cible=exemple.com --limite=40 --tri=liens
//   node outils/collecte-rel.mjs --referents=annuaire-exemple.fr,blog-exemple.com --dry
//   node outils/collecte-rel.mjs --echantillon --dry     (demonstration hors ligne)
//
// Options :
//   --cible=<domaine>      ne qualifie que les liens qui pointent vers ce domaine.
//                          Defaut : le premier domaine de role « nous » de la config.
//   --limite=<n>           nombre de domaines referents traites          (defaut 40)
//   --tri=liens|alpha      ordre de traitement                           (defaut liens)
//   --referents=a,b,c      force la liste, court-circuite le journal
//   --echantillon          domaines d'exemple, pour voir ce que produit le collecteur
//                          sans avoir rien collecte. A utiliser avec --dry.
//   --pages=<n>            candidats testes par referent au maximum      (defaut 18)
//   --mots=a,b             mots recherches dans les slugs du sitemap
//   --dry                  n'ecrit rien, affiche seulement

import zlib from "node:zlib";
import {
  recuperer, recupererParRelais, hote, liensVers, texteDe,
  indexabilite, robots, signauxSpam, UA_CHROME,
} from "./_lib-liens.mjs";
import { observation, ecrire, lire, dernier, nouveauRun, config } from "./_lib-obs.mjs";

const VERSION = "collecte-rel@1.0.0";

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || null;
const DRY = process.argv.includes("--dry");
const ECHANTILLON = process.argv.includes("--echantillon");

/**
 * ⛔ LA CIBLE PAR DEFAUT VIENT DE LA CONFIGURATION, JAMAIS D'UNE CONSTANTE. Un domaine
 *    ecrit en dur dans un fichier partage y laisse le site de celui qui a ecrit le
 *    fichier : le collecteur tourne alors normalement, il ecrit des lignes, elles
 *    parlent simplement du site de quelqu'un d'autre. C'est une panne sans message.
 */
function cibleParDefaut() {
  const d = config().nous?.[0]?.domaine;
  if (!d) {
    console.error(
      "aucun domaine en role « nous » dans la configuration.\n" +
      "  Indiquez la cible avec --cible=exemple.com, ou ajoutez votre domaine dans\n" +
      "  config/domaines.json (voir config/domaines.exemple.json)."
    );
    process.exit(1);
  }
  return d;
}

const CIBLE = (arg("cible") || cibleParDefaut()).replace(/^www\./i, "").toLowerCase();
const LIMITE = Number(arg("limite") || 40);
const TRI = arg("tri") || "liens";
const MAX_PAGES = Number(arg("pages") || 18);

// La marque, deduite du domaine cible : « exemple.com » -> « exemple ». Elle sert a
// fabriquer les chemins probables des annuaires et a filtrer les slugs du sitemap.
// Les deux mots qui suivent la marque sont du vocabulaire de secteur, donne a titre
// d'exemple : remplacez-les par le votre avec --mots=a,b.
const MARQUE = CIBLE.split(".")[0];
const MOTS_SLUG = (arg("mots") || `${MARQUE},trading-journal,journal`).split(",").map((m) => m.trim().toLowerCase());

// ⛔ 1,2 s entre deux requetes vers le MEME hote. Pas une politesse decorative : un
//    annuaire qui nous voit marteler 12 URL en 2 s repond 429, et un 429 devient un
//    angle mort, donc une ligne perdue. La lenteur achete de la mesure.
const DELAI_MEME_HOTE = 1200;
const dernierAppel = new Map();
async function poli(h) {
  const t = dernierAppel.get(h) || 0;
  const reste = DELAI_MEME_HOTE - (Date.now() - t);
  if (reste > 0) await new Promise((r) => setTimeout(r, reste));
  dernierAppel.set(h, Date.now());
}

// ---------------------------------------------------------------- robots.txt par chemin
//
// Le socle rend `bloqueTout`, le « Disallow: / » integral (mesure du 21/08/2026 : sur un
// site reel, ce refus tenait dans un robots.txt de 27 octets), mais pas l'autorisation
// d'un CHEMIN precis. Or un annuaire qui interdit /go/ tout en autorisant /software/ est
// le cas courant, et crawler quand meme serait malhonnete.

function reglesRobots(txt) {
  if (!txt) return null;                       // pas de robots.txt = tout est autorise
  const groupes = [];
  let courant = null;
  for (const ligne of txt.split(/\r?\n/)) {
    const l = ligne.replace(/#.*$/, "").trim();
    if (!l) continue;
    const m = /^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(l);
    if (!m) continue;
    const [, cle, val] = m;
    if (/^user-agent$/i.test(cle)) {
      if (!courant || courant.regles.length) { courant = { agents: [], regles: [] }; groupes.push(courant); }
      courant.agents.push(val.toLowerCase());
    } else if (courant) {
      courant.regles.push({ type: cle.toLowerCase(), motif: val });
    }
  }
  const g = groupes.find((x) => x.agents.includes("*"));
  return g ? g.regles : [];
}

function versRegex(motif) {
  const fin = motif.endsWith("$");
  const corps = (fin ? motif.slice(0, -1) : motif)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${corps}${fin ? "$" : ""}`);
}

/**
 * Regle de Google : la regle la PLUS LONGUE l'emporte, et Allow gagne a longueur egale.
 * Un `Disallow:` vide n'interdit rien (c'est la facon standard de tout autoriser).
 */
function cheminAutorise(regles, chemin) {
  if (!regles) return { autorise: true, par: "aucun robots.txt" };
  let meilleure = null;
  for (const r of regles) {
    if (r.motif === "" ) { if (r.type === "disallow") continue; }
    if (!versRegex(r.motif).test(chemin)) continue;
    const score = r.motif.length + (r.type === "allow" ? 0.5 : 0);
    if (!meilleure || score > meilleure.score) meilleure = { ...r, score };
  }
  if (!meilleure) return { autorise: true, par: "aucune regle ne couvre ce chemin" };
  return { autorise: meilleure.type === "allow", par: `${meilleure.type}: ${meilleure.motif}` };
}

// ---------------------------------------------------------------- utilitaires d'URL

function absolutiser(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

/** Le lien pointe-t-il vers la cible, meme via www ou un sous-domaine ? */
function viseLaCible(u) {
  const h = hote(u);
  return h === CIBLE || h.endsWith(`.${CIBLE}`);
}

// ⛔ LES ANNUAIRES NE LIENT PRESQUE JAMAIS EN DIRECT. Les gros annuaires de produits
//    passent par une passerelle maison (/go/…, /out?url=…, /visit/…). L'URL ne contient
//    alors pas le domaine cible, donc liensVers(html, "exemple.com") ne voit RIEN, et on
//    conclurait « pas de lien » sur une page qui en porte un. On les repere par la forme
//    du chemin ET la presence de la marque, et on les marque comme indirects :
//    leur valeur SEO depend d'une redirection qu'on n'a pas encore suivie.
const FORMES_PASSERELLE = /(^|\/)(go|out|goto|visit|redirect|link|links|r|ref|away|url)(\/|\?|$)/i;

function liensIndirects(html, urlPage, hotePage) {
  const out = [];
  for (const l of liensVers(html, MARQUE)) {
    const abs = absolutiser(l.url, urlPage);
    if (!abs) continue;
    if (viseLaCible(abs)) continue;                       // deja capte par la passe directe
    const h = hote(abs);
    if (h !== hotePage && !h.endsWith(`.${hotePage}`)) continue;   // passerelle du referent seulement
    let u;
    try { u = new URL(abs); } catch { continue; }
    const marqueDansUrl = (u.pathname + u.search).toLowerCase().includes(MARQUE);
    if (!marqueDansUrl) continue;
    if (!FORMES_PASSERELLE.test(u.pathname) && !/[?&](url|u|to|target|dest)=/i.test(u.search)) continue;
    out.push({ ...l, url: abs, indirect: true });
  }
  return out;
}

/** Les liens DIRECTS vers la cible, avec leur href resolu en absolu. */
function liensDirects(html, urlPage) {
  return liensVers(html, CIBLE)
    .map((l) => ({ ...l, url: absolutiser(l.url, urlPage) || l.url }))
    .filter((l) => viseLaCible(l.url));
}

// ---------------------------------------------------------------- sitemaps
//
// ⛔ recuperer() du socle rend du TEXTE. Un sitemap servi en .xml.gz est un corps binaire
//    que .text() transforme en charabia : on lit alors zero <loc> et on croit le sitemap
//    vide. D'ou ce petit lecteur dedie qui degzippe avant de decoder.

async function recupererXml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA_CHROME, accept: "application/xml,text/xml,*/*" }, redirect: "follow", signal: ctrl.signal });
    const buf = Buffer.from(await r.arrayBuffer());
    const gz = url.endsWith(".gz") || (buf[0] === 0x1f && buf[1] === 0x8b);
    const txt = gz ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    return { ok: true, http: r.status, xml: txt };
  } catch (e) {
    return { ok: false, http: null, xml: "", erreur: String(e.message || e).slice(0, 120) };
  } finally { clearTimeout(t); }
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));

/**
 * Cherche dans le sitemap du referent les URL dont le slug porte un de nos mots.
 * Un index de sitemaps est suivi sur UN niveau et sur 5 sous-sitemaps au maximum.
 * ⛔ Ce plafond n'est pas une frilosite : mesure du 21/08/2026, un site tres large
 *    publiait 34 sous-sitemaps, dont plusieurs de plus d'un million d'URL. On ne
 *    telecharge pas un million d'URL pour trouver une page.
 */
async function candidatsDuSitemap(domaine, sitemapsDeclares) {
  const aTester = sitemapsDeclares.length ? sitemapsDeclares.slice(0, 3)
    : [`https://${domaine}/sitemap.xml`, `https://${domaine}/sitemap_index.xml`];
  const trouves = [];
  const journal = [];
  for (const sm of aTester) {
    await poli(hote(sm) || domaine);
    const r = await recupererXml(sm);
    journal.push(`${sm} -> ${r.http ?? r.erreur}`);
    if (!r.ok || r.http !== 200 || !r.xml.includes("<loc>")) continue;
    const urls = locs(r.xml);
    if (/<sitemapindex/i.test(r.xml)) {
      // Index : on privilegie les sous-sitemaps dont le NOM parle deja de nous.
      const sous = [...urls].sort((a, b) =>
        (MOTS_SLUG.some((m) => b.toLowerCase().includes(m)) ? 1 : 0) -
        (MOTS_SLUG.some((m) => a.toLowerCase().includes(m)) ? 1 : 0)).slice(0, 5);
      for (const s of sous) {
        await poli(hote(s) || domaine);
        const rs = await recupererXml(s);
        journal.push(`${s} -> ${rs.http ?? rs.erreur}`);
        if (!rs.ok || rs.http !== 200) continue;
        trouves.push(...locs(rs.xml));
      }
    } else {
      trouves.push(...urls);
    }
    if (trouves.length) break;
  }
  const filtres = trouves.filter((u) => MOTS_SLUG.some((m) => u.toLowerCase().includes(m)));
  return { candidats: [...new Set(filtres)].slice(0, 15), journal, totalUrls: trouves.length };
}

// ---------------------------------------------------------------- candidats de page
//
// Ordre de recherche, du moins cher au plus cher, en s'arretant des qu'on a trouve.

function cheminsProbables() {
  return [
    // -- 1. Chemins de MARQUE. Mesure du 21/08/2026 : les annuaires de produits hebergent
    //       UNE page par produit, nommee d'apres le produit. La racine de ces sites ne
    //       porte jamais le lien. Les tester en premier evite d'aller au sitemap.
    //       ⛔ SINGULIER ET PLURIEL, LES DEUX. Sur deux annuaires mesures le meme jour,
    //          l'un servait /<marque> et l'autre /startupS/<marque>, au pluriel. La
    //          premiere version de ce fichier ne testait que /startup/ : elle declarait
    //          le second annuaire « non localise » alors que sa page existait et portait
    //          bien le lien. Une lettre, une fiche perdue.
    `/software/${MARQUE}`, `/${MARQUE}`, `/startups/${MARQUE}`, `/startup/${MARQUE}`,
    `/product/${MARQUE}`, `/products/${MARQUE}`, `/tools/${MARQUE}`, `/alternatives/${MARQUE}`,
    // -- 2. Chemins generiques des sites PARTENAIRES, ou le lien vit dans une liste et
    //       non sur une page dediee. Une page du genre partenaire-exemple.com/partners/
    //       est exactement ce cas : dofollow acquis, page generique, et pourtant invisible
    //       dans le rapport Liens de Search Console.
    "/partners/", "/partnerships/", "/partner/", "/tools/", "/integrations/",
    "/resources/", "/reviews/", "/blog/", "/alternatives/",
  ];
}

// ---------------------------------------------------------------- lecture d'une page

// ⛔ CE QUI EST UN MUR, ET POURQUOI 202 EN FAIT PARTIE.
//    202 n'est pas « accepte, page vide » : c'est la reponse d'un challenge anti-robot.
//    Mesures du 21/08/2026 : un moteur de recherche repondait 202 sur son captcha, et une
//    plateforme communautaire repondait 202 sur sa propre racine.
//    Le compter comme « page absente » reviendrait a ecrire un zero la ou on s'est fait
//    refouler, ce qui est exactement l'erreur que ce collecteur existe pour interdire.
const MURS = [202, 401, 403, 405, 406, 429, 503];

/**
 * Lit une page candidate et rend ce qu'on y voit. Ne conclut RIEN : la decision
 * d'ecrire une mesure ou un angle mort se prend plus haut, avec le contexte.
 *
 * ⛔ `budgetRelais` est un compteur PARTAGE PAR REFERENT, et c'est le point important.
 *    Sans lui, un domaine qui repond 403 sur TOUT (mesure du 21/08/2026 sur un annuaire
 *    de logiciels reel) declenche 18 appels a r.jina.ai, a 25 s de delai chacun, pour
 *    reposer 18 fois la meme question a un mur qui a deja repondu. Sept minutes et demie
 *    perdues sur un seul domaine, et rien de plus mesure qu'au premier appel.
 */
async function lirePage(url, budgetRelais = { reste: 3 }) {
  const h = hote(url);
  await poli(h);
  const r = await recuperer(url);
  if (!r.ok) return { url, http: null, etat: "injoignable", raison: r.erreur, direct: [], indirect: [] };

  if (MURS.includes(r.http)) {
    if (budgetRelais.reste <= 0) {
      return { url, http: r.http, etat: "mur", raison: `HTTP ${r.http}, relais non rejoue (budget epuise sur ce domaine)`, direct: [], indirect: [] };
    }
    budgetRelais.reste--;
    const rel = await recupererParRelais(url);
    if (rel.ok && rel.http === 200 && rel.html) {
      // ⛔ r.jina.ai rend du MARKDOWN. Un lien y a la forme [ancre](url) : on peut donc
      //    affirmer qu'un LIEN existe et lire sa destination et son ancre. On ne peut
      //    PAS lire un rel, l'attribut n'existe pas dans ce rendu. Deux etats distincts.
      const md = [...rel.html.matchAll(/\[([^\]\n]{0,160})\]\((https?:\/\/[^)\s]+)\)/g)]
        .map((m) => ({ ancre: m[1].trim() || null, url: m[2] }))
        .filter((l) => viseLaCible(l.url));
      const citee = rel.html.toLowerCase().includes(CIBLE);
      return { url, http: r.http, etat: "relais", relais: "r.jina.ai", markdown: md, citee,
               raison: `HTTP ${r.http} en direct, relu par r.jina.ai`, direct: [], indirect: [] };
    }
    return { url, http: r.http, etat: "mur", raison: `HTTP ${r.http}, relais r.jina.ai ${rel.http ?? "muet"}`, direct: [], indirect: [] };
  }

  // ⛔ Le corps peut porter le challenge meme quand l'en-tete dit 200. On ne se fie pas
  //    au seul code : Cloudflare et consorts servent « Just a moment… » en 200.
  if (/just a moment|checking your browser|enable javascript and cookies|cf-browser-verification/i.test(r.html.slice(0, 4000))) {
    return { url, http: r.http, etat: "mur", raison: `HTTP ${r.http} mais le corps est un challenge anti-robot`, direct: [], indirect: [] };
  }

  if (r.http !== 200) return { url, http: r.http, etat: "absente", raison: `HTTP ${r.http}`, direct: [], indirect: [] };

  const idx = indexabilite(r.html, r.enTetes);
  const texte = texteDe(r.html);
  return {
    url, http: 200, etat: "lue", urlFinale: r.urlFinale, html: r.html, octets: r.octets,
    idx, texte,
    // ⛔ « PUBLIQUE » se mesure, on ne le suppose pas : un 200 anonyme dont l'URL finale
    //    n'est pas un mur de connexion et dont le texte ne reclame pas de compte.
    publique: !/\/(login|signin|sign-in|auth|accounts?\/)/i.test(r.urlFinale || url)
      && !/^\s*(sign in|log in|connexion)\b/i.test(texte.slice(0, 60)),
    direct: liensDirects(r.html, r.urlFinale || url),
    indirect: liensIndirects(r.html, r.urlFinale || url, hote(r.urlFinale || url)),
  };
}

// ---------------------------------------------------------------- fabrique d'observations

function obsLien({ referent, page, lien, robotsRef, run }) {
  const idx = page.idx || {};
  const spam = signauxSpam({ domaine: referent, url: page.url, html: page.html, http: page.http, octetsHtml: page.octets });

  const chemin = new URL(page.url).pathname;
  const crawlRobots = cheminAutorise(robotsRef.regles, chemin);

  // Les trois conditions, mesurees separement. On dit LAQUELLE manque.
  const conditions = {
    publique: page.publique,
    crawlable: crawlRobots.autorise && !idx.noindex,
    rel_non_coupant: lien.suivi === "DOFOLLOW",
  };
  const manque = Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k);

  // ⛔ meta robots nofollow (ou X-Robots-Tag nofollow) coupe TOUS les liens de la page,
  //    y compris ceux dont l'attribut rel est vide. C'est la condition que personne ne
  //    regarde, et elle peut contredire `suivi`.
  const suiviEffectif = idx.nofollowPage ? "NOFOLLOW" : lien.suivi;
  if (idx.nofollowPage && lien.suivi === "DOFOLLOW") manque.push("page_en_meta_nofollow");

  const dofollowReel = conditions.publique && conditions.crawlable && suiviEffectif === "DOFOLLOW";

  return observation({
    type: "backlink",
    sujet: { domaine: CIBLE },
    objet: {
      domaine: referent,
      url: page.url,
      ancre: lien.ancre,
      detail: {
        url_source: page.url,
        url_source_finale: page.urlFinale || page.url,
        url_destination: lien.url,
        hote_destination: hote(lien.url),
        indirect: !!lien.indirect,
        ancre: lien.ancre,
        rel_brut: lien.rel,
        suivi: lien.suivi,
        suivi_effectif: suiviEffectif,
        genre: lien.genre,
        indexabilite: {
          meta_robots: idx.metaRobots, x_robots_tag: idx.xRobotsTag,
          canonical: idx.canonical, noindex: !!idx.noindex, nofollow_page: !!idx.nofollowPage,
        },
        robots_txt: { autorise: crawlRobots.autorise, regle: crawlRobots.par, bloque_tout: robotsRef.bloqueTout },
        conditions, manque,
        dofollow_reel: dofollowReel,
        spam: {
          score: spam.score, verdict: spam.verdict,
          signaux: spam.signaux.map((s) => ({ code: s.code, poids: s.poids, preuve: s.preuve })),
          angles: spam.angles,
          octets_texte: spam.octetsTexte ?? null,
          domaines_externes_distincts: spam.nbExternesDistincts ?? null,
        },
      },
    },
    metrique: "lien_qualifie",
    valeur: 1, unite: "lien",
    nature: "mesure", etat: "MESURE",
    source: { nom: "lecture_html", endpoint: page.url, http: page.http, methode: "fetch" },
    preuve:
      `${page.url} -> ${lien.url} | rel=${lien.rel ?? "(aucun)"} | ${suiviEffectif}` +
      ` | spam ${spam.score}/${spam.verdict}` +
      (manque.length ? ` | manque : ${manque.join(", ")}` : " | 3 conditions reunies"),
    run_id: run, collecteur: VERSION,
    drapeaux: [
      dofollowReel ? "dofollow_reel" : "dofollow_incomplet",
      lien.genre,
      ...(lien.indirect ? ["destination_par_redirection"] : []),
      ...(spam.verdict === "SPAM" ? ["spam"] : spam.verdict === "DOUTEUX" ? ["spam_douteux"] : []),
      ...(spam.angles.length ? ["spam_partiellement_mesure"] : []),
    ],
  });
}

// ---------------------------------------------------------------- traitement d'un referent

/**
 * Resume les essais en une ligne qui tient dans les 400 caracteres que le socle garde
 * pour `preuve`. Lister 18 chemins un par un fait tronquer la preuve au milieu d'un mot
 * et perdre justement la fin, qui est l'endroit ou se trouve le sitemap.
 * ⛔ On signale au passage le PIEGE DU 200 UNIVERSEL : un hote qui rend son application
 *    sur toute route inconnue donne 200 partout sans jamais porter la page demandee.
 *    Mesure du 21/08/2026 : une plateforme communautaire repondait ainsi 200 sur chacun
 *    des chemins essayes. C'est le meme piege que les routes inventees d'une API qui
 *    renvoie son HTML d'application au lieu d'un 404.
 */
function resumerEssais(essais) {
  const parCode = new Map();
  for (const e of essais) {
    const code = (e.split("->")[1] || "?").trim();
    parCode.set(code, (parCode.get(code) || 0) + 1);
  }
  const codes = [...parCode].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n}x ${c}`).join(", ");
  const deuxCents = parCode.get("200") || 0;
  const piege = deuxCents >= 5 ? ` ⛔ ${deuxCents} candidats en 200 sans aucun lien : cet hote rend probablement son application sur toute route inconnue, le code 200 ne prouve rien.` : "";
  return `${essais.length} candidats testes (${codes})${piege}`;
}

/**
 * Les URL exactes de pages qui portent un lien vers la cible, deja connues au journal.
 * Elles viennent de collecte-ahrefs-gratuit (metrique « page_portante_connue ») ou d'une
 * qualification precedente. On les reessaie en premier : une page qui portait le lien
 * hier le porte probablement encore, et si elle ne le porte plus, c'est une DISPARITION,
 * ce qui est justement l'information la plus utile.
 */
function urlsConnues(referent) {
  const out = [];
  for (const o of PHOTO) {
    if (o.objet?.domaine !== referent) continue;
    if (o.sujet?.domaine !== CIBLE) continue;
    const u = o.objet?.url || o.objet?.detail?.url_source;
    if (!u || !/^https?:/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 6);
}

async function qualifier(referent, nbLiensBing, run) {
  const obs = [];
  const essais = [];
  const budgetRelais = { reste: 3 };

  // 1. robots.txt du referent. On le respecte AVANT de le crawler, ce n'est pas negociable.
  const rb = await robots(referent);
  const regles = rb.http === 200 ? reglesRobots(rb.texte) : null;
  const robotsRef = { regles, bloqueTout: rb.bloqueTout, http: rb.http };

  if (rb.bloqueTout) {
    // ⛔ « Disallow: / » integral est une MESURE, pas une panne : l'editeur a choisi
    //    d'etre incartographiable. Mais pour NOUS le rel devient illisible, donc la
    //    ligne qui sort est un angle mort, avec sa vraie raison.
    obs.push(observation({
      type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: referent },
      metrique: "page_portante", etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "lecture_html", endpoint: `https://${referent}/robots.txt`, http: rb.http, methode: "fetch" },
      preuve: `robots.txt interdit tout crawl (Disallow: / sous User-agent: *). Bing compte ${nbLiensBing} lien(s) depuis ce domaine, on ne les qualifiera pas sans desobeir.`,
      run_id: run, collecteur: VERSION,
      drapeaux: ["robots_txt_interdit_tout", "page_portante_non_localisee"],
    }));
    return { obs, resume: "robots.txt interdit tout crawl" };
  }

  // 2. Les candidats, du moins cher au plus cher.
  //
  // ⛔ LES URL EXACTES CONNUES PASSENT DEVANT LES CHEMINS DEVINES, ET C'EST LA CORRECTION
  //    LA PLUS UTILE DE CE FICHIER. Avant, on ne faisait que DEVINER des chemins probables
  //    (/partners/, /blog/, le sitemap). Sur un fil de forum, dont l'URL ressemble a
  //    forum-exemple.org/index.php?topic=5519917.2580 (domaine d'exemple), aucun chemin
  //    devine ne tombe juste. Mesure du 21/08/2026 : un lien de cette forme ressortait
  //    « non qualifie » alors qu'il etait parfaitement DOFOLLOW, sans aucun rel, sur une
  //    page indexable, verifie dans le HTML servi. La page existait, le lien aussi, et
  //    seule notre facon de chercher etait en cause.
  //    Le verificateur gratuit d'Ahrefs (collecte-ahrefs-gratuit.mjs) donne ces URL
  //    exactes, et une URL exacte vaut mieux que dix chemins devines.
  const connues = urlsConnues(referent);
  const candidats = [...connues, `https://${referent}/`, ...cheminsProbables().map((c) => `https://${referent}${c}`)];

  let trouve = null;
  let restant = MAX_PAGES;

  // ⛔ UN HTTP 200 NE PROUVE PAS QU'UNE PAGE EXISTE. Mesure du 21/08/2026, sur un annuaire
  //    de produits reel : deux URL ne differant que par la barre oblique finale rendaient
  //    l'une 200 et l'autre 404, avec LE MEME corps de 33 036 octets. Le 200 servait donc
  //    une page d'erreur deguisee, octet pour octet identique au 404 d'a cote.
  //    Un candidat n'est retenu que s'il porte VRAIMENT un lien vers la cible, jamais sur
  //    la foi de son code de retour.
  for (const u of candidats) {
    if (restant-- <= 0) break;
    const chemin = new URL(u).pathname;
    const ok = cheminAutorise(regles, chemin);
    if (!ok.autorise) { essais.push(`${chemin} interdit par robots.txt (${ok.par})`); continue; }
    const p = await lirePage(u, budgetRelais);
    essais.push(`${chemin} -> ${p.http ?? p.raison}`);
    if (p.etat === "lue" && (p.direct.length || p.indirect.length)) { trouve = p; break; }
    if (p.etat === "relais" && (p.markdown?.length || p.citee)) { trouve = p; break; }
  }

  // 3. Le sitemap, en dernier : c'est le plus cher en requetes.
  let sitemapJournal = [];
  if (!trouve) {
    const s = await candidatsDuSitemap(referent, rb.sitemaps || []);
    sitemapJournal = s.journal;
    for (const u of s.candidats) {
      if (restant-- <= 0) break;
      let chemin;
      try { chemin = new URL(u).pathname; } catch { continue; }
      const ok = cheminAutorise(regles, chemin);
      if (!ok.autorise) { essais.push(`sitemap ${chemin} interdit par robots.txt`); continue; }
      const p = await lirePage(u, budgetRelais);
      essais.push(`sitemap ${chemin} -> ${p.http ?? p.raison}`);
      if (p.etat === "lue" && (p.direct.length || p.indirect.length)) { trouve = p; break; }
      if (p.etat === "relais" && (p.markdown?.length || p.citee)) { trouve = p; break; }
    }
  }

  // 4. Rien trouve. ⛔ On ecrit « page portante non localisee », JAMAIS « pas de lien ».
  if (!trouve) {
    obs.push(observation({
      type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: referent },
      metrique: "page_portante", etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "lecture_html", endpoint: `https://${referent}/`, http: null, methode: "fetch" },
      preuve: `page portante non localisee, ce n est PAS une absence de lien : Bing compte ${nbLiensBing} lien(s) depuis ce domaine. ${resumerEssais(essais)}${sitemapJournal.length ? " | sitemap : " + sitemapJournal.slice(0, 3).join(" ; ") : " | aucun sitemap exploitable"}`,
      run_id: run, collecteur: VERSION,
      drapeaux: ["page_portante_non_localisee"],
    }));
    return { obs, resume: `page portante non localisee (${essais.length} essais)` };
  }

  // 5a. Page lue en direct : le rel est LISIBLE, on qualifie pour de bon.
  if (trouve.etat === "lue") {
    const liens = [...trouve.direct, ...trouve.indirect];
    for (const l of liens) obs.push(obsLien({ referent, page: trouve, lien: l, robotsRef, run }));
    const dofollowReels = obs.filter((o) => o.drapeaux.includes("dofollow_reel")).length;
    obs.push(observation({
      type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: referent, url: trouve.url },
      metrique: "liens_dofollow_reels", valeur: dofollowReels, unite: "lien",
      nature: "mesure", etat: "MESURE",
      source: { nom: "lecture_html", endpoint: trouve.url, http: 200, methode: "fetch" },
      preuve: `${liens.length} lien(s) vers ${CIBLE} lus dans le HTML servi de ${trouve.url}, dont ${dofollowReels} reunissant les trois conditions`,
      run_id: run, collecteur: VERSION,
      // ⛔ Ce compte ne vaut que POUR CETTE PAGE. Le site peut porter d'autres pages
      //    liantes qu'on n'a pas localisees : ce n'est pas le total du domaine.
      drapeaux: ["compte_sur_une_seule_page"],
    }));
    return { obs, resume: `${liens.length} lien(s), ${dofollowReels} dofollow reel(s)` };
  }

  // 5b. Page lue par le RELAIS : la presence se mesure, le rel non.
  const md = trouve.markdown || [];
  for (const l of (md.length ? md : [{ url: null, ancre: null }])) {
    obs.push(observation({
      type: "backlink", sujet: { domaine: CIBLE },
      objet: {
        domaine: referent, url: trouve.url, ancre: l.ancre,
        detail: { url_source: trouve.url, url_destination: l.url, ancre: l.ancre, relais: "r.jina.ai" },
      },
      metrique: "lien_present",
      valeur: md.length ? 1 : null, unite: "lien",
      nature: md.length ? "mesure" : "mesure_absente",
      etat: md.length ? "MESURE" : "ANGLE_MORT",
      source: { nom: "r.jina.ai", endpoint: `https://r.jina.ai/${trouve.url}`, http: 200, methode: "relais" },
      preuve: md.length
        ? `le direct rend ${trouve.http}, le relais rend un lien markdown [${l.ancre ?? ""}](${l.url})`
        : `le direct rend ${trouve.http}, le relais cite « ${CIBLE} » dans le texte mais pas sous forme de lien : impossible de trancher entre lien et simple mention`,
      run_id: run, collecteur: VERSION,
      drapeaux: ["lu_par_relais"],
    }));
  }
  // ⛔ Et le rel, lui, reste un angle mort. Un rendu markdown n'a pas d'attributs.
  obs.push(observation({
    type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: referent, url: trouve.url },
    metrique: "lien_qualifie", etat: "ANGLE_MORT", nature: "mesure_absente",
    source: { nom: "r.jina.ai", endpoint: `https://r.jina.ai/${trouve.url}`, http: 200, methode: "relais" },
    preuve: `rel non lisible : le direct rend ${trouve.http} et r.jina.ai rend du markdown, ou l attribut rel n existe pas. Ne jamais deduire un dofollow de ce rendu.`,
    run_id: run, collecteur: VERSION,
    drapeaux: ["rel_illisible_rendu_markdown", "lu_par_relais"],
  }));
  return { obs, resume: `lu par relais (direct ${trouve.http}), rel en angle mort` };
}

// ---------------------------------------------------------------- selection des referents

// DES DOMAINES D'EXEMPLE, ET RIEN D'AUTRE. Cette liste ne sert qu'a --echantillon, pour
// montrer la forme de ce que produit le collecteur quand le journal est encore vide. Ces
// domaines n'existent pas : lances pour de vrai, ils rendront des angles morts
// « injoignable », ce qui est exactement le comportement attendu. A utiliser avec --dry.
//
// ⛔ ET CETTE LISTE NE SERT JAMAIS DE SECOURS AUTOMATIQUE. Une version precedente y
//    basculait toute seule quand le journal etait vide. Le collecteur tournait alors sans
//    la moindre erreur, il ecrivait des lignes, et ces lignes parlaient de domaines
//    choisis par l'auteur du fichier, pas par celui qui le lance. Un secours qui invente
//    ses referents fabrique des mesures fausses en silence, ce qui est pire que rien.
const ECHANTILLON_DEMO = [
  ["annuaire-exemple.fr", 3], ["blog-exemple.com", 2],
  ["forum-exemple.org", 1], ["partenaire-exemple.com", 1],
];

// La photo du journal, chargee UNE fois : urlsConnues() et referents() la partagent.
const PHOTO = (() => {
  const { obs } = lire();
  return dernier(obs);
})();

function referents() {
  const force = arg("referents");
  if (force) return force.split(",").map((d) => ({ domaine: d.trim().replace(/^www\./i, "").toLowerCase(), liens: null, origine: "--referents" }));
  if (ECHANTILLON) return ECHANTILLON_DEMO.map(([domaine, liens]) => ({ domaine, liens, origine: "echantillon de demonstration" }));

  const photo = PHOTO.filter((o) =>
    o.type === "backlink" && o.metrique === "liens_depuis_domaine" &&
    o.etat === "MESURE" && o.sujet?.domaine === CIBLE && o.objet?.domaine);
  if (!photo.length) {
    console.log(
      `  ⚠ aucun « liens_depuis_domaine » vers ${CIBLE} dans le journal : il n y a rien a qualifier.\n` +
      `    Collectez d abord les domaines referents, par exemple avec\n` +
      `      CDP_URL=http://127.0.0.1:<port> node outils/collecte-bing-backlinks.mjs\n` +
      `    ou donnez la liste a la main : --referents=annuaire-exemple.fr,blog-exemple.com`
    );
    return [];
  }
  const parDomaine = new Map();
  for (const o of photo) {
    const d = o.objet.domaine.replace(/^www\./i, "").toLowerCase();
    parDomaine.set(d, Math.max(parDomaine.get(d) || 0, Number(o.valeur) || 0));
  }
  const liste = [...parDomaine].map(([domaine, liens]) => ({ domaine, liens, origine: "journal" }));
  return TRI === "alpha"
    ? liste.sort((a, b) => a.domaine.localeCompare(b.domaine))
    : liste.sort((a, b) => b.liens - a.liens || a.domaine.localeCompare(b.domaine));
}

// ---------------------------------------------------------------- execution

const run = nouveauRun("rel");
const liste = referents().slice(0, LIMITE);

console.log(`Vigie SEO — qualification des liens (rel, indexabilite, spam)`);
console.log(`cible ${CIBLE} · ${liste.length} referent(s) · tri ${TRI} · ${MAX_PAGES} pages max/referent · run ${run}`);
console.log(`source des referents : ${liste[0]?.origine ?? "aucune"}\n`);

const toutes = [];
for (const r of liste) {
  process.stdout.write(`  ${r.domaine.padEnd(28)} `);
  try {
    const { obs, resume } = await qualifier(r.domaine, r.liens ?? "?", run);
    toutes.push(...obs);
    console.log(resume);
    for (const o of obs.filter((x) => x.metrique === "lien_qualifie" && x.etat === "MESURE")) {
      const d = o.objet.detail;
      console.log(`      ${d.suivi_effectif.padEnd(8)} rel=${String(d.rel_brut ?? "(aucun)").padEnd(22)} spam ${String(d.spam.score).padStart(3)}/${d.spam.verdict.padEnd(8)} ${d.url_source}`);
      if (d.manque.length) console.log(`               manque : ${d.manque.join(", ")}`);
    }
    for (const o of obs.filter((x) => x.etat === "ANGLE_MORT")) {
      console.log(`      ▲ ${o.metrique} : ${o.preuve.slice(0, 150)}`);
    }
  } catch (e) {
    // ⛔ Un plantage n'est pas une absence de lien non plus : il laisse une trace ecrite.
    console.log(`ECHEC : ${String(e.message).slice(0, 140)}`);
    toutes.push(observation({
      type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: r.domaine },
      metrique: "page_portante", etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "lecture_html", endpoint: `https://${r.domaine}/`, http: null, methode: "fetch" },
      preuve: `le collecteur a leve : ${String(e.message).slice(0, 200)}`,
      run_id: run, collecteur: VERSION, drapeaux: ["collecteur_en_erreur"],
    }));
  }
}

// ⛔ COLLISION D'EMPREINTE : LE SEUL ENDROIT OU CE COLLECTEUR PEUT PERDRE UNE LIGNE.
//    empreinte() du socle fabrique obs_id a partir de (type, sujet, objet.domaine,
//    objet.url, objet.ancre, destination, rel, metrique, source, jour). La destination et
//    le rel n'y ont pas toujours figure, et c'est ce controle-ci qui a impose de les
//    ajouter. Mesure du 21/08/2026, sur une fiche d'annuaire reelle : deux liens partaient
//    de la meme page vers la meme destination, l'un avec l'ancre « Visit website » en
//    dofollow, l'autre avec « Visit official website » en nofollow. Les ancres differaient,
//    donc rien n'a collisionne ce jour-la ; deux ancres identiques auraient suffi, et
//    ecrire(), idempotent par obs_id, en aurait avale une EN SILENCE.
//    Le controle reste en place, parce qu'une cle d'empreinte peut toujours reperdre une
//    dimension le jour ou quelqu'un la simplifiera. On ne corrige pas depuis ici, ce
//    serait falsifier objet.ancre : on DETECTE, et on CRIE.
const parEmpreinte = new Map();
for (const o of toutes) parEmpreinte.set(o.obs_id, (parEmpreinte.get(o.obs_id) || 0) + 1);
const collisions = [...parEmpreinte].filter(([, n]) => n > 1);
if (collisions.length) {
  console.log(`\n⛔ ${collisions.length} empreinte(s) en double dans cette passe : autant de liens qu ecrire() supprimerait en silence.`);
  for (const [id] of collisions) {
    for (const o of toutes.filter((x) => x.obs_id === id)) {
      console.log(`   ${id} · ${o.objet?.url} · ancre « ${o.objet?.ancre} » · ${o.objet?.detail?.url_destination} · rel=${o.objet?.detail?.rel_brut ?? "(aucun)"}`);
    }
  }
  console.log(`   Correctif : la cle de empreinte(), dans _lib-obs.mjs, ne distingue plus ce qui distingue ces liens. Elle doit au minimum porter objet.detail.url_destination et objet.detail.rel_brut.`);
}

const mesures = toutes.filter((o) => o.etat === "MESURE").length;
const angles = toutes.filter((o) => o.etat === "ANGLE_MORT").length;
const dofollow = toutes.filter((o) => o.drapeaux.includes("dofollow_reel")).length;

console.log(`\n${toutes.length} observation(s) : ${mesures} mesure(s), ${angles} angle(s) mort(s), ${dofollow} dofollow reel(s).`);
if (DRY) {
  console.log(`--dry : rien n'est ecrit.`);
  const ex = toutes.find((o) => o.metrique === "lien_qualifie" && o.etat === "MESURE") || toutes[0];
  if (ex) console.log(JSON.stringify(ex, null, 1));
} else {
  console.log(`${ecrire(toutes)} observation(s) ecrite(s).`);
}
