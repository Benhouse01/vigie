// LECTURE D'UNE PAGE SOURCE : le rel REEL, l'indexabilite, et les signaux de spam.
//
// ⛔ LE rel SE LIT DANS LE HTML SERVI, JAMAIS DANS UN BADGE D'EXTENSION.
//    Mesure du 17/08/2026 : une extension de navigateur annoncait 14 liens dofollow sur
//    un tableau de bord accessible seulement apres connexion, et dont la version publique
//    interdit tout crawl. Aucun de ces 14 liens n'existe pour un moteur.
//    Un badge vert ne vaut rien tant que TROIS conditions ne sont pas reunies, et une
//    extension n'en teste qu'une :
//      1. la page est PUBLIQUE (pas derriere un login)
//      2. la page est CRAWLABLE (robots.txt, meta robots, X-Robots-Tag)
//      3. l'ancre n'a pas de rel nofollow / ugc / sponsored   <- la seule que l'extension voit
//
// ⛔ UN 403 N'EST PAS UNE ABSENCE DE LIEN, C'EST UN MUR. Mesure du 21/08/2026 : un site
//    marchand refusait tout appel en ligne de commande et servait la meme page,
//    parfaitement lisible, dans un navigateur. Conclure « pas de lien » sur un 403 fait
//    declarer morte une campagne qui ne l'est peut-etre pas. On rend ANGLE_MORT et on
//    reessaie par un relais de lecture avant de rendre la main.
//
// ⛔ noopener et noreferrer N'ONT AUCUN EFFET SEO. Seuls nofollow, sponsored et ugc coupent.

// ---------------------------------------------------------------- identite du robot
//
// ⛔ ON S'ANNONCE POUR CE QU'ON EST. Le defaut dit « robot », donne le nom de l'outil et
//    l'adresse du projet : un administrateur qui trouve ces requetes dans ses journaux
//    peut savoir a qui il a affaire et nous bloquer s'il le souhaite. C'est la contrepartie
//    normale d'un outil qui lit des sites qui ne lui appartiennent pas.
// ⛔ MAIS CERTAINS HEBERGEURS REFUSENT TOUT CE QUI N'EST PAS UN NAVIGATEUR, et rendent
//    alors un 403 qui ressemble a une page absente. D'ou VIGIE_UA : on peut se declarer
//    autrement, en connaissance de cause, sans toucher au code.
const UA_PROJET = "https://github.com/vigie-seo/vigie-seo";
export const UA_DEFAUT = `Mozilla/5.0 (compatible; VigieSEO/1.0; +${UA_PROJET})`;
export const UA = process.env.VIGIE_UA || UA_DEFAUT;

/**
 * Ancien nom du meme User-Agent, garde pour les collecteurs qui l'importent tel quel.
 * ⛔ Il ne designe plus un navigateur : c'est bien la valeur configurable ci-dessus.
 */
export const UA_CHROME = UA;

const DELAI = 15000;

/** Un fetch qui dit la verite sur son echec au lieu de rendre une page vide. */
export async function recuperer(url, { timeout = DELAI, ua = UA } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const html = await r.text();
    return {
      ok: true, url, urlFinale: r.url, http: r.status, ms: Date.now() - t0,
      octets: Buffer.byteLength(html, "utf8"), html,
      enTetes: {
        xRobotsTag: r.headers.get("x-robots-tag"),
        contentType: r.headers.get("content-type"),
      },
    };
  } catch (e) {
    return {
      ok: false, url, http: null, ms: Date.now() - t0,
      erreur: e.name === "AbortError" ? "delai depasse" : String(e.message || e).slice(0, 120),
      html: "",
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * `recuperer` avec un second et un troisieme essai sur panne RESEAU seulement.
 *
 * ⛔ MESURE DU 21/08/2026 A 03H52 : un site surveille a rendu « Connect Timeout Error »
 *    puis 200 cinq fois de suite dans la meme minute, sans que rien ne change de son
 *    cote. Sans reprise, un collecteur ecrit regulierement qu'un site parfaitement en
 *    ligne est injoignable, et la courbe de sante technique se met a clignoter pour une
 *    raison qui n'a rien a voir avec le site.
 * ⛔ On NE REESSAIE PAS sur un code HTTP. Un 403 est une reponse, pas un incident :
 *    le rejouer trois fois ne fait que confirmer le mur et ralentit la passe.
 */
export async function recupererFiable(url, options = {}, essais = 3) {
  let derniere = null;
  for (let i = 0; i < essais; i++) {
    const r = await recuperer(url, options);
    if (r.ok) return i ? { ...r, reprises: i } : r;
    derniere = r;
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  return { ...derniere, reprises: essais - 1 };
}

/**
 * Second essai quand curl est refuse. r.jina.ai rend le markdown de la page.
 * ⛔ Il rend du TEXTE, donc il ne permet PAS de lire un rel. Il sert uniquement a
 *    trancher « la page existe et parle de nous » contre « la page est vide ».
 */
export async function recupererParRelais(url) {
  const r = await recuperer(`https://r.jina.ai/${url}`, { timeout: 25000 });
  return { ...r, relais: "r.jina.ai", relEstLisible: false };
}

/** Domaine nu, sans www, en minuscules. */
export function hote(u) {
  try { return new URL(u, "https://x/").hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return ""; }
}

/**
 * Tous les liens sortants d'une page dont l'href contient `motif`.
 * On lit l'attribut TEL QUE SERVI, on ne normalise rien avant de l'avoir enregistre.
 */
export function liensVers(html, motif) {
  const out = [];
  // ⛔ ON PART DE LA BALISE OUVRANTE, JAMAIS DE LA PAIRE <a>…</a>.
  //    Premiere version : /<a([^>]*)>([\s\S]{0,400}?)<\/a>/ . Elle exigeait un </a>
  //    a moins de 400 caracteres, donc TOUT LIEN QUI ENVELOPPE UN BLOC etait invisible.
  //    Mesure du 21/08/2026 : sur deux pages reelles, une page « partenaires » et une
  //    fiche d'annuaire, la balise ouvrante du genre
  //    <a href="https://exemple.com/?ref=xxxx"> enveloppait un <div> de carte entier
  //    (exemple reconstitue). Les deux liens EXISTENT, les deux sont DOFOLLOW, et
  //    l'extracteur rendait zero.
  //    Un extracteur qui rate un lien ne se plaint pas : il rend une liste plus courte,
  //    et on conclut que le site partenaire n'a jamais publie le lien promis.
  const re = /<a\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!href) continue;
    const url = href[1].replace(/&amp;/g, "&");
    if (motif && !url.toLowerCase().includes(motif.toLowerCase())) continue;
    const rel = /rel\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const relBrut = rel ? rel[1].trim() : null;

    // L'ancre : le texte lisible qui suit, jusqu'au </a> s'il arrive vite, sinon les
    // 300 premiers caracteres de contenu. Une ancre absente n'invalide pas le lien :
    // une carte cliquable est un lien parfaitement valable pour un moteur.
    const suite = html.slice(m.index + m[0].length, m.index + m[0].length + 1200);
    const finA = suite.search(/<\/a\s*>/i);
    const dedans = finA >= 0 ? suite.slice(0, finA) : suite.slice(0, 300);
    const ancre = dedans.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);

    out.push({
      url,
      hote: hote(url),
      ancre: ancre || null,
      rel: relBrut,
      // ⛔ noopener et noreferrer ne coupent RIEN. Seuls ces trois-la coupent.
      suivi: /(nofollow|sponsored|ugc)/i.test(relBrut || "") ? "NOFOLLOW" : "DOFOLLOW",
      genre: /sponsored/i.test(relBrut || "") ? "sponsored"
           : /ugc/i.test(relBrut || "") ? "ugc"
           : /nofollow/i.test(relBrut || "") ? "nofollow" : "dofollow",
      // Une carte cliquable n'a pas d'ancre textuelle : on le dit au lieu de laisser
      // croire a une ancre vide, qui se lit comme un defaut du lien.
      sansAncre: !ancre,
    });
  }
  const vus = new Set();
  return out.filter((l) => {
    const k = `${l.url}|${l.rel}|${l.ancre}`;
    if (vus.has(k)) return false;
    vus.add(k);
    return true;
  });
}

/** Tous les liens EXTERNES d'une page, pour mesurer la saturation. */
export function liensExternes(html, domaineDeLaPage) {
  const tous = liensVers(html, "");
  const d = (domaineDeLaPage || "").replace(/^www\./i, "").toLowerCase();
  const ext = tous.filter((l) => l.hote && l.hote !== d && !l.hote.endsWith(`.${d}`));
  return { tous: tous.length, externes: ext, nbExternesDistincts: new Set(ext.map((l) => l.hote)).size };
}

/** Le texte lisible d'une page, pour la coherence editoriale et le ratio liens/texte. */
export function texteDe(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** meta robots + X-Robots-Tag + canonical. Une des trois conditions du dofollow reel. */
export function indexabilite(html, enTetes = {}) {
  const meta = (html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i) || [])[1] || null;
  const xr = enTetes.xRobotsTag || null;
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i) || [])[1] || null;
  const ensemble = `${meta || ""} ${xr || ""}`;
  return {
    metaRobots: meta,
    xRobotsTag: xr,
    canonical,
    noindex: /noindex/i.test(ensemble),
    nofollowPage: /\bnofollow\b/i.test(ensemble),
    indexable: !/noindex/i.test(ensemble),
  };
}

/** robots.txt : le crawl est-il autorise, et le sitemap est-il declare ? */
export async function robots(domaine) {
  const r = await recuperer(`https://${domaine}/robots.txt`);
  if (!r.ok || r.http !== 200) {
    // ⛔ UN 403 SUR robots.txt N'EST PAS « robots.txt sans restriction ».
    //    Premiere version de cette fonction : elle classait en MESURE tout fetch qui
    //    aboutissait, 403 compris, et rendait alors sitemaps:[] et bloqueTout:false.
    //    Un mur anti-robot ressortait donc comme un site parfaitement ouvert.
    //    Mesure du 21/08/2026 : sur un site reel, /robots.txt rendait 403 avec la page
    //    d'attente « Just a moment... » d'un pare-feu applicatif.
    //    Seul un 404 est une vraie mesure : le fichier n'existe pas, donc rien n'est
    //    interdit. Tout le reste est un angle mort.
    const vraiment404 = r.ok && r.http === 404;
    return {
      http: r.http,
      etat: vraiment404 ? "MESURE" : "ANGLE_MORT",
      texte: null, sitemaps: [], bloqueTout: false,
      preuve: vraiment404
        ? "HTTP 404 : aucun robots.txt, donc aucune restriction declaree"
        : (r.erreur || `HTTP ${r.http}, le fichier n a pas pu etre lu`),
    };
  }
  const txt = r.html.slice(0, 200000);
  const sitemaps = [...txt.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  // ⛔ « Disallow: / » sous « User-agent: * » = incartographiable PAR CHOIX DE L EDITEUR.
  //    C'est une MESURE, pas un angle mort. Des sites tres frequentes font exactement ca,
  //    en 27 octets : zero URL cartographiee n'est PAS zero page.
  const blocEtoile = /user-agent:\s*\*([\s\S]*?)(?=\nuser-agent:|$)/i.exec(txt);
  const bloqueTout = !!blocEtoile && /^\s*disallow:\s*\/\s*$/im.test(blocEtoile[1]);
  return { http: 200, etat: "MESURE", texte: txt, sitemaps, bloqueTout, octets: r.octets, preuve: txt.slice(0, 200) };
}

// ---------------------------------------------------------------- SIGNAUX DE SPAM
//
// « Filtrer les liens douteux », mais sans jamais decider a l'impression : chaque signal
// est BINAIRE et MESURE. Le score de spam est la somme ponderee des signaux declenches,
// et chaque signal s'affiche avec sa preuve.
//
// ⛔ DEUX PIEGES DEJA PAYES, encodes ici :
//    1. Le ratio liens/texte est FAUX sur une page rendue en JavaScript.
//       Mesure du 21/08/2026, sur une page « partenaires » parfaitement legitime :
//       154 125 o de HTML pour 3,0 Ko de texte et 68 liens externes, soit 22,5 liens/Ko,
//       ce qui declencherait a tort l'alarme ferme a liens.
//       Regle : texte < 5 Ko ET html > 100 Ko -> le ratio est un ANGLE MORT et l'alarme
//       ne se declenche pas. Le compte ABSOLU de liens, lui, reste valable.
//    2. La detection de vente de liens ne vaut QUE si la page repond 200.
//       Mesure du 21/08/2026 : sur un blog reel, les 4 sondes rendent 404 et la regex
//       trouve quand meme le mot « Price » dans la page d'erreur du site.

const TLD_A_RISQUE = /\.(tk|ml|ga|cf|gq|xyz|top|buzz|click|link|loan|work|bid|win|cam|rest|icu|monster|sbs)$/i;

const MOTS_VENTE = /(guest\s*post|sponsored\s*post|paid\s*(post|link|article)|buy\s*(a\s*)?link|link\s*building\s*service|insertion\s*de\s*lien|article\s*sponsoris|achat\s*de\s*lien|publication\s*payante)/i;
const PRIX = /[$€£]\s?\d{2,5}|\d{2,5}\s?(usd|eur|€|\$)/i;
const MOTS_CONTEXTE_VENTE = /(link|post|article|guest|sponsored|lien|publication|insertion)/i;

/**
 * Analyse une page source et rend ses signaux de spam.
 * `html` peut etre vide : dans ce cas tout ce qui en depend passe en angle mort.
 */
export function signauxSpam({ domaine, url, html = "", http = null, octetsHtml = 0 }) {
  const signaux = [];
  const angles = [];

  // -- 1. L'hote est une ADRESSE IP. Vu tel quel dans un profil de liens reel, un
  //       referent servi sous la forme « https://203.0.113.45 » (exemple). Un site
  //       legitime a un nom.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domaine || "")) {
    signaux.push({ code: "hote_adresse_ip", poids: 30, preuve: `l hote est une adresse IP nue : ${domaine}` });
  }

  // -- 2. TLD a risque. Signal FAIBLE seul, il ne condamne pas, il s'additionne.
  if (TLD_A_RISQUE.test(domaine || "")) {
    signaux.push({ code: "tld_a_risque", poids: 10, preuve: `extension ${(domaine.match(TLD_A_RISQUE) || [])[0]}` });
  }

  // -- 3. Sous-domaine jetable d'une plateforme gratuite utilisee en masse.
  if (/\.(blogspot\.com|wordpress\.com|weebly\.com|wixsite\.com|000webhostapp\.com|github\.io)$/i.test(domaine || "")) {
    signaux.push({ code: "hebergement_gratuit", poids: 8, preuve: `sous-domaine gratuit : ${domaine}` });
  }

  // -- 4. Warez, cracks, APK pirates. Vu dans un profil de liens reel : un referent dont
  //       le nom de domaine annoncait des applications piratees.
  if (/(apk|crack|nulled|warez|torrent|keygen|mod-?apk|free-?download)/i.test(domaine || "")) {
    signaux.push({ code: "domaine_piratage", poids: 35, preuve: `le nom de domaine annonce du contenu pirate : ${domaine}` });
  }

  if (!html || http !== 200) {
    angles.push({
      code: "page_non_lue",
      raison: http === null ? "aucune reponse" : `HTTP ${http}`,
      // ⛔ On ne conclut RIEN sur le contenu. Un 403 n'est pas un site propre,
      //    ce n'est pas non plus un site sale : c'est un mur.
    });
    return { score: total(signaux), signaux, angles, verdict: verdict(total(signaux), angles) };
  }

  const texte = texteDe(html);
  const octetsTexte = Buffer.byteLength(texte, "utf8");
  const { externes, nbExternesDistincts } = liensExternes(html, domaine);

  // -- 5. Saturation ABSOLUE de liens sortants. Les deux fermes desavouees en 2026
  //       portaient 18 600 et 18 081 liens sortants pour 8 Mo, sans contenu.
  if (nbExternesDistincts >= 300) {
    signaux.push({ code: "saturation_liens", poids: 30, preuve: `${nbExternesDistincts} domaines externes distincts sur une seule page` });
  } else if (nbExternesDistincts >= 120) {
    signaux.push({ code: "saturation_liens", poids: 15, preuve: `${nbExternesDistincts} domaines externes distincts sur une seule page` });
  }

  // -- 6. Ratio liens / texte. ⛔ Neutralise sur une page rendue en JS.
  const pageRendueJs = octetsTexte < 5000 && octetsHtml > 100000;
  if (pageRendueJs) {
    angles.push({ code: "ratio_liens_texte", raison: `page rendue en JS (${Math.round(octetsTexte / 1024)} Ko de texte pour ${Math.round(octetsHtml / 1024)} Ko de HTML), le ratio n est pas calculable` });
  } else if (octetsTexte > 0) {
    const ratio = externes.length / (octetsTexte / 1024);
    if (ratio > 12) {
      signaux.push({ code: "ratio_liens_texte", poids: 25, preuve: `${ratio.toFixed(1)} liens externes par Ko de texte` });
    } else if (ratio > 6) {
      signaux.push({ code: "ratio_liens_texte", poids: 12, preuve: `${ratio.toFixed(1)} liens externes par Ko de texte` });
    }
  }

  // -- 7. Page maigre. Un article de 400 signes qui place un lien n'est pas un article.
  if (octetsTexte < 900 && !pageRendueJs) {
    signaux.push({ code: "page_maigre", poids: 15, preuve: `${octetsTexte} octets de texte lisible` });
  }

  // -- 8. Le site VEND des liens, et il le dit. ⛔ Uniquement sur un HTTP 200.
  const mv = MOTS_VENTE.exec(texte);
  if (mv) signaux.push({ code: "vend_des_liens", poids: 40, preuve: `« ${texte.slice(Math.max(0, mv.index - 40), mv.index + 80).trim()} »` });
  else {
    const mp = PRIX.exec(texte);
    if (mp) {
      const autour = texte.slice(Math.max(0, mp.index - 200), mp.index + 200);
      if (MOTS_CONTEXTE_VENTE.test(autour)) {
        signaux.push({ code: "tarif_a_cote_du_mot_lien", poids: 22, preuve: `« ${autour.trim().slice(0, 160)} »` });
      }
    }
  }

  // -- 9. Casino, adulte, pharmacie : la ligne editoriale d'une ferme qui prend tout.
  const horsSujet = /(casino|betting|poker|viagra|cialis|escort|porn|xxx|payday\s*loan|crypto\s*airdrop)/i.exec(texte.slice(0, 40000));
  if (horsSujet) {
    signaux.push({ code: "voisinage_hors_sujet", poids: 25, preuve: `le mot « ${horsSujet[0]} » apparait sur la page` });
  }

  // -- 10. Texte genere : la meme phrase d'accroche repetee.
  const phrases = texte.split(/[.!?]\s/).filter((p) => p.length > 40);
  if (phrases.length > 12) {
    const uniques = new Set(phrases.map((p) => p.slice(0, 60)));
    const repet = 1 - uniques.size / phrases.length;
    if (repet > 0.35) signaux.push({ code: "texte_repetitif", poids: 18, preuve: `${Math.round(repet * 100)} % des phrases commencent pareil` });
  }

  return { score: total(signaux), signaux, angles, verdict: verdict(total(signaux), angles), octetsTexte, nbExternesDistincts, pageRendueJs };
}

const total = (s) => Math.min(100, s.reduce((a, x) => a + x.poids, 0));

function verdict(score, angles) {
  // ⛔ Un score de 0 obtenu SANS avoir pu lire la page n'est pas « propre ».
  if (angles.some((a) => a.code === "page_non_lue")) return "NON LU";
  if (score >= 55) return "SPAM";
  if (score >= 25) return "DOUTEUX";
  return "PROPRE";
}
