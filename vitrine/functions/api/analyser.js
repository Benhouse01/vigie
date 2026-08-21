// L'ANALYSE D'UN DOMAINE, EN DIRECT, DEPUIS LE NAVIGATEUR DE N'IMPORTE QUI.
//
// C'est le coeur du service public : quelqu'un tape un domaine, et il obtient une analyse
// mesuree, gratuitement, sans compte et sans installer quoi que ce soit.
//
// ⛔ CE QUE CETTE FONCTION MESURE, ET RIEN D'AUTRE. Elle fait des appels HTTP depuis le
//    reseau de Cloudflare : sante technique, robots.txt, sitemap, indexabilite d'un
//    echantillon, popularite. Tout est MESURE au moment de la demande, rien n'est estime.
//    Ce qui demande un crawl long ou un compte (les backlinks des concurrents, le graphe
//    du web) reste dans l'outil qu'on installe chez soi : le dire est plus honnete que de
//    faire semblant.
//
// ⛔ TROIS GARDE-FOUS CONTRE L'ABUS, parce qu'un point d'entree public qui va chercher une
//    URL arbitraire est une arme si on le laisse faire :
//    1. On refuse tout ce qui n'est pas un nom de domaine public : pas d'adresse IP, pas
//       de localhost, pas de nom interne, pas d'autre schema que http et https.
//       Sans ca, n'importe qui s'en sert pour sonder un reseau prive depuis nos serveurs.
//    2. Tout est plafonne : nombre d'appels, octets lus, duree. Un sitemap de 400 Mo ne
//       doit pas pouvoir immobiliser la fonction.
//    3. Une limite par adresse IP appelante, pour que le service reste disponible pour
//       tout le monde.
//
// ⛔ ET LA REGLE DU PROJET S'APPLIQUE ICI AUSSI : jamais un zero la ou la mesure a echoue.
//    Chaque champ rendu porte son etat : MESURE, MESURE_ABSENT ou ANGLE_MORT.

import { compteDe, tracer } from "./_commun.js";

const UA = "Mozilla/5.0 (compatible; VigieBot/1.0; +https://vigie-seo.pages.dev/ ; analyse a la demande)";
const DELAI = 8000;
const MAX_OCTETS = 3_000_000;

const FORME_DOMAINE =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

// ⛔ Les noms qu'on refuse categoriquement. Un service public qui accepte « localhost »
//    ou une adresse privee devient un outil de reconnaissance de reseau interne.
const INTERDITS = /^(localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp|metadata\..*)$/i;
const EST_IP = /^\d{1,3}(\.\d{1,3}){3}$|^\[?[0-9a-f:]+\]?$/i;

const entetes = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, max-age=300",
  "Access-Control-Allow-Origin": "*",
};

const reponse = (code, corps, extra = {}) =>
  new Response(JSON.stringify(corps), { status: code, headers: { ...entetes, ...extra } });

/** Un appel HTTP borne : delai, taille, et redirections comptees. */
async function appel(url, { methode = "GET", max = MAX_OCTETS } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: methode,
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(DELAI),
      cf: { cacheTtl: 900, cacheEverything: false },
    });
    let corps = "";
    if (methode !== "HEAD") {
      const lecteur = r.body?.getReader();
      if (lecteur) {
        const morceaux = [];
        let total = 0;
        for (;;) {
          const { done, value } = await lecteur.read();
          if (done) break;
          total += value.length;
          morceaux.push(value);
          // ⛔ On COUPE au plafond au lieu de tout avaler. Un sitemap de plusieurs
          //    centaines de Mo immobiliserait la fonction pour tout le monde.
          if (total >= max) { await lecteur.cancel(); break; }
        }
        corps = new TextDecoder("utf-8", { fatal: false }).decode(
          morceaux.reduce((a, c) => { const n = new Uint8Array(a.length + c.length); n.set(a); n.set(c, a.length); return n; }, new Uint8Array())
        );
      }
    }
    return {
      ok: true, http: r.status, urlFinale: r.url, ms: Date.now() - t0,
      octets: corps.length, corps,
      redirige: r.url !== url,
      enTetes: { xRobotsTag: r.headers.get("x-robots-tag"), type: r.headers.get("content-type") },
    };
  } catch (e) {
    const nom = String(e && e.name) === "TimeoutError" ? "delai depasse" : String((e && e.message) || e).slice(0, 120);
    return { ok: false, http: null, ms: Date.now() - t0, erreur: nom, corps: "" };
  }
}

const mesure = (valeur, preuve, source) => ({ etat: "MESURE", valeur, preuve, source });
const absente = (preuve, source) => ({ etat: "MESURE_ABSENT", valeur: null, preuve, source });
const angleMort = (preuve, source) => ({ etat: "ANGLE_MORT", valeur: null, preuve, source });

/** robots.txt : bloque-t-il tout, et declare-t-il un sitemap ? */
async function lireRobots(d) {
  const r = await appel(`https://${d}/robots.txt`, { max: 300_000 });
  if (!r.ok) return { etat: angleMort(r.erreur, "robots.txt"), sitemaps: [], texte: "" };
  if (r.http === 404) {
    // ⛔ Un 404 sur robots.txt est une VRAIE mesure : aucun fichier, donc aucune
    //    restriction declaree. Ce n'est pas un echec de lecture.
    return { etat: mesure(false, "HTTP 404 : aucun robots.txt, donc aucune restriction declaree", "robots.txt"), sitemaps: [], texte: "" };
  }
  if (r.http !== 200) return { etat: angleMort(`HTTP ${r.http}`, "robots.txt"), sitemaps: [], texte: "" };
  const bloc = /user-agent:\s*\*([\s\S]*?)(?=\nuser-agent:|$)/i.exec(r.corps);
  const bloqueTout = !!bloc && /^\s*disallow:\s*\/\s*$/im.test(bloc[1]);
  const sitemaps = [...r.corps.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((m) => m[1]).slice(0, 5);
  return {
    etat: mesure(bloqueTout, bloqueTout
      ? "Disallow: / integral sous User-agent: * : le site est incartographiable PAR CHOIX DE L EDITEUR"
      : `${sitemaps.length} sitemap(s) declare(s)`, "robots.txt"),
    sitemaps, texte: r.corps,
  };
}

/** Compte les <loc> d'un sitemap, en descendant au plus un niveau d'index. */
async function compterSitemap(d, declares) {
  const depart = declares.length ? declares.slice(0, 2) : [`https://${d}/sitemap.xml`];
  let total = 0, lus = 0, plafond = false;
  const file = [...depart];
  const vus = new Set();
  while (file.length && lus < 4) {
    const u = file.shift();
    if (vus.has(u)) continue;
    vus.add(u);
    const r = await appel(u, { max: 2_000_000 });
    lus++;
    if (!r.ok || r.http !== 200) continue;
    if (r.octets >= 2_000_000) plafond = true;
    const estIndex = /<sitemapindex/i.test(r.corps);
    const locs = [...r.corps.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (estIndex) { for (const l of locs.slice(0, 3)) if (file.length < 4) file.push(l); }
    else total += locs.length;
  }
  if (!lus || (!total && !plafond)) {
    return angleMort("aucun sitemap lisible : ce n est PAS zero page, c est une carte introuvable", "sitemap");
  }
  return {
    etat: "MESURE", valeur: total, source: "sitemap",
    preuve: plafond
      ? `${total} URL comptees, mais un fichier a atteint le plafond de lecture : le vrai nombre est au-dessus`
      : `${total} URL comptees dans ${lus} fichier(s)`,
    plancher: plafond,
  };
}

/** Le rang de popularite, mesure par un panel public. */
async function tranco(d) {
  const r = await appel(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(d)}`, { max: 200_000 });
  if (!r.ok || r.http !== 200) return angleMort(`Tranco : ${r.erreur || "HTTP " + r.http}`, "tranco");
  let j;
  try { j = JSON.parse(r.corps); } catch { return angleMort("reponse Tranco illisible", "tranco"); }
  const ranks = j && j.ranks;
  if (!Array.isArray(ranks) || !ranks.length) {
    // ⛔ Une liste vide est une MESURE, et une mesure severe : le domaine a ete cherche
    //    et il n'est pas dans le million le plus frequente.
    return absente("absent du million de domaines les plus frequentes : le domaine a ete cherche, il n y est pas", "tranco");
  }
  const dernier = ranks[ranks.length - 1];
  return mesure(dernier.rank, `rang ${dernier.rank} au ${dernier.date}`, "tranco");
}

/** La sante technique, sur le bareme du projet. */
function santeTechnique(racine, rb, sm) {
  const points = [];
  const ajouter = (nom, obtenu, sur, dit) => points.push({ nom, obtenu, sur, dit });

  if (racine.ok) {
    ajouter("reponse", racine.http === 200 ? 25 : 0, 25,
      `HTTP ${racine.http}${racine.redirige ? ", avec redirection" : ", sans redirection"}`);
    ajouter("temps de reponse", racine.ms <= 600 ? 20 : racine.ms <= 1200 ? 15 : racine.ms <= 2500 ? 5 : 0, 20,
      `${racine.ms} ms`);
    ajouter("poids de la page", racine.octets <= 300 * 1024 ? 15 : racine.octets <= 600 * 1024 ? 7 : 0, 15,
      `${Math.round(racine.octets / 1024)} Ko`);
    ajouter("certificat", 10, 10, "HTTPS accepte");
  } else {
    return angleMort(`la racine n a pas repondu : ${racine.erreur}`, "sondes HTTP");
  }
  ajouter("robots.txt", rb.etat.etat === "MESURE" ? (rb.sitemaps.length ? 15 : 8) : 0, 15,
    rb.etat.etat === "MESURE" ? (rb.sitemaps.length ? "present et declare un sitemap" : "present, sans Sitemap declare") : "illisible");
  ajouter("sitemap", sm.etat === "MESURE" ? 15 : 0, 15,
    sm.etat === "MESURE" ? "lisible et analysable" : "introuvable ou illisible");

  const total = points.reduce((a, p) => a + p.obtenu, 0);
  return { etat: "MESURE", valeur: total, source: "sondes HTTP, TLS, robots, sitemap", preuve: `${total}/100`, detail: points };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...entetes, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  }

  // ⛔ LE COMPTE EST OBLIGATOIRE, ET IL EST GRATUIT.
  //    Pas pour vendre quoi que ce soit : parce que ce point d entree ouvre de vraies
  //    pages chez de vrais gens, et qu il declenche un robot. Savoir qui demande quoi
  //    est ce qui permet de couper un abus sans couper le service pour tout le monde.
  const compte = env.vigie ? await compteDe(request, env.vigie) : null;
  if (!compte) {
    return reponse(401, { erreur: "Creez un compte gratuit pour analyser un domaine. Une adresse email suffit, rien d autre ne vous sera demande." });
  }

  const u = new URL(request.url);
  const brut = (u.searchParams.get("domaine") || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");

  if (!brut) return reponse(400, { erreur: "Indiquez un domaine, par exemple exemple.com" });
  if (brut.length > 253) return reponse(400, { erreur: "Ce nom est trop long pour etre un domaine." });
  if (EST_IP.test(brut)) {
    return reponse(400, { erreur: "Les adresses IP ne sont pas acceptees, seulement des noms de domaine publics." });
  }
  if (INTERDITS.test(brut) || !FORME_DOMAINE.test(brut)) {
    return reponse(400, { erreur: `« ${brut.slice(0, 60)} » n a pas la forme d un domaine public.` });
  }

  await tracer(env.vigie, {
    compte: compte.id, email: compte.email, action: "analyse", cible: brut,
    pays: request.headers.get("cf-ipcountry"),
  });
  context.waitUntil(env.vigie.prepare("UPDATE comptes SET analyses = analyses + 1, vu_le = ? WHERE id = ?")
    .bind(new Date().toISOString(), compte.id).run().catch(() => {}));

  const t0 = Date.now();
  const racine = await appel(`https://${brut}/`, { max: 1_500_000 });
  const rb = await lireRobots(brut);
  const sm = rb.etat.etat === "MESURE" && rb.etat.valeur === true
    ? angleMort("le robots.txt interdit tout crawl : la carte du site n est pas lisible, PAR CHOIX DE L EDITEUR", "sitemap")
    : await compterSitemap(brut, rb.sitemaps);
  const tr = await tranco(brut);
  const st = santeTechnique(racine, rb, sm);

  // L'indexabilite de la page d'accueil, lue dans ce qui est servi.
  let ix = angleMort("la racine n a pas pu etre lue", "meta robots");
  let liensExternes = angleMort("la racine n a pas pu etre lue", "lecture HTML");
  if (racine.ok && racine.http === 200) {
    const meta = (racine.corps.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i) || [])[1] || null;
    const xr = racine.enTetes.xRobotsTag;
    const noindex = /noindex/i.test(`${meta || ""} ${xr || ""}`);
    ix = mesure(!noindex, noindex
      ? `NOINDEX : la page d accueil demande a ne pas etre indexee (${meta || xr})`
      : meta ? `indexable, meta robots : ${meta}` : "indexable, aucune meta robots", "meta robots");

    const hotes = new Set();
    for (const m of racine.corps.matchAll(/<a\b[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
      try {
        const h = new URL(m[1]).hostname.replace(/^www\./, "").toLowerCase();
        if (h !== brut && !h.endsWith("." + brut)) hotes.add(h);
      } catch { /* href malforme */ }
    }
    liensExternes = mesure(hotes.size, `${hotes.size} domaine(s) externe(s) distinct(s) lie(s) depuis l accueil`, "lecture HTML");
  }

  return reponse(200, {
    domaine: brut,
    mesure_le: new Date().toISOString(),
    duree_ms: Date.now() - t0,
    resultats: {
      sante_technique: st,
      reponse_http: racine.ok
        ? mesure(racine.http, `${racine.http} en ${racine.ms} ms${racine.redirige ? `, redirige vers ${racine.urlFinale}` : ""}`, "sonde HTTP")
        : angleMort(racine.erreur, "sonde HTTP"),
      poids_accueil: racine.ok ? mesure(racine.octets, `${Math.round(racine.octets / 1024)} Ko`, "sonde HTTP") : angleMort(racine.erreur, "sonde HTTP"),
      robots_bloque_tout: rb.etat,
      pages_au_sitemap: sm,
      indexable: ix,
      liens_externes_accueil: liensExternes,
      popularite_tranco: tr,
    },
    // ⛔ On dit ce qu'on ne mesure PAS ici. Un service qui tait ses angles morts laisse
    //    croire que ce qu'il montre est tout ce qui existe.
    non_mesure_ici: [
      "Les positions : elles demandent un releve de moteur avec la localisation forcee.",
      "Le trafic : il ne se mesure pas de l exterieur, il se modelise, et une estimation n a pas sa place a cote de mesures.",
    ],
  });
}
