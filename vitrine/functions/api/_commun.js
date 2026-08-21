// OUTILLAGE PARTAGE PAR TOUTES LES ROUTES DE L'API.
//
// Trois sujets : les comptes, la lecture d'un lien dans du HTML, et la politesse
// du robot. Chaque piege deja paye est ecrit a l'endroit ou il se rejoue.

export const MAINTENANT = () => new Date().toISOString();

/* ------------------------------------------------------------------ reponses */

export const json = (donnees, statut = 200, entetes = {}) =>
  new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...entetes },
  });

export const erreur = (message, statut = 400) => json({ erreur: message }, statut);

/* -------------------------------------------------------------- les domaines */

/**
 * Ramene une saisie libre a un domaine utilisable, ou null.
 *
 * ⛔ REFUSE les adresses IP et les noms internes. Sans ce filtre, l'API devient un
 *    relais pour aller lire les services internes de l'hebergeur : c'est la faille
 *    SSRF, et elle se paie une seule fois.
 */
export function normaliserDomaine(saisie) {
  if (typeof saisie !== "string") return null;
  let d = saisie.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].split("@").pop().split(":")[0];
  if (d.length < 4 || d.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(d)) return null;
  if (/\.(local|localhost|internal|lan|home|arpa|test|invalid|example)$/.test(d)) return null;
  if (d === "localhost") return null;
  return d;
}

/** Le domaine d'une URL, sans www, ou null si l'URL est illisible. */
export function domaineDe(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Deux domaines appartiennent-ils au meme site ? (sous-domaines compris) */
export function memeSite(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

/* ------------------------------------------------------------------- comptes */

const hexa = (tampon) =>
  [...new Uint8Array(tampon)].map((o) => o.toString(16).padStart(2, "0")).join("");

export async function sha256Hexa(texte) {
  return hexa(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)));
}

export const selNeuf = () => hexa(crypto.getRandomValues(new Uint8Array(16)));
export const jetonNeuf = () => hexa(crypto.getRandomValues(new Uint8Array(32)));
export const idNeuf = () => hexa(crypto.getRandomValues(new Uint8Array(12)));

/**
 * ⛔ POURQUOI L'ETIREMENT SE FAIT DANS LE NAVIGATEUR ET PAS ICI.
 *
 * Un PBKDF2 a 210 000 tours coute entre 50 et 150 ms de processeur. Le palier
 * gratuit de Cloudflare Workers en accorde 10 par requete : l'inscription
 * echouerait, et elle echouerait par depassement de temps, c'est-a-dire de la facon
 * la plus obscure possible a diagnostiquer.
 *
 * Le navigateur derive donc la cle (PBKDF2-SHA256, 210 000 tours, sel = l'email),
 * et n'envoie que la derivee. Le serveur la resale avec un sel propre au compte et
 * la hache une fois en SHA-256.
 *
 * Ce que ca vaut : la valeur transmise est equivalente au mot de passe, exactement
 * comme le mot de passe lui-meme le serait, et HTTPS protege les deux pareil. En
 * revanche, un vol de la base ne donne qu'un SHA-256 sale d'une valeur qui a deja
 * coute 210 000 tours a produire : pour tester un mot de passe candidat, l'attaquant
 * doit refaire ces 210 000 tours. La resistance hors ligne est donc celle d'un
 * PBKDF2 serveur, sans en payer le processeur.
 */
export async function empreinteDe(deriveeClient, sel) {
  return sha256Hexa(deriveeClient + "|" + sel);
}

export function lireCookie(requete, nom) {
  const brut = requete.headers.get("cookie") || "";
  for (const morceau of brut.split(";")) {
    const [c, ...v] = morceau.trim().split("=");
    if (c === nom) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function cookieSession(jeton, jours = 30) {
  const age = jours * 24 * 3600;
  return `vigie_s=${jeton}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
}

export const cookieVide = () => "vigie_s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";

/** Le compte derriere la requete, ou null. Nettoie les sessions expirees au passage. */
export async function compteDe(requete, bd) {
  const jeton = lireCookie(requete, "vigie_s");
  if (!jeton || jeton.length !== 64) return null;
  const ligne = await bd
    .prepare(
      `SELECT c.id, c.email, c.cree_le, c.analyses, c.crawls, s.expire_le
         FROM sessions s JOIN comptes c ON c.id = s.compte
        WHERE s.jeton = ?`
    )
    .bind(jeton)
    .first();
  if (!ligne) return null;
  if (ligne.expire_le < MAINTENANT()) {
    await bd.prepare("DELETE FROM sessions WHERE jeton = ?").bind(jeton).run();
    return null;
  }
  return ligne;
}

/** Ecrit une ligne au journal d'usage. N'echoue jamais bruyamment. */
export async function tracer(bd, { compte, email, action, cible, pays, detail }) {
  try {
    await bd
      .prepare(
        `INSERT INTO usages (quand, compte, email, action, cible, pays, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(MAINTENANT(), compte || null, email || null, action, cible || null, pays || null, detail || null)
      .run();
  } catch (e) {
    console.log("journal d'usage indisponible :", e.message);
  }
}

/* ------------------------------------------------- lire un lien dans du HTML */

export const AGENT =
  "Mozilla/5.0 (compatible; VigieBot/1.0; +https://vigie-seo.pages.dev/robot)";

/**
 * Tous les liens d'un HTML vers un domaine donne.
 *
 * ⛔ ON PART DE LA BALISE OUVRANTE, JAMAIS DE LA PAIRE <a>…</a>.
 *    L'expression /<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/ semble evidente et elle est
 *    fausse : elle rate tout lien dont le contenu depasse 400 caracteres, ce qui est
 *    le cas de tous les liens qui enveloppent un bloc (une carte, une image avec
 *    legende, un article entier). Mesure du jour ou le piege a ete corrige :
 *    3 liens qualifies sont devenus 21 sur le meme jeu de pages.
 */
export function liensVers(html, cible) {
  const trouves = [];
  const re = /<a\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attributs = m[1];
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributs);
    if (!href) continue;
    const url = (href[2] ?? href[3] ?? href[4] ?? "").trim();
    if (!url || url.startsWith("#") || /^(javascript|mailto|tel):/i.test(url)) continue;
    if (!url.includes(cible)) continue;

    const relAttr = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributs);
    const relBrut = relAttr ? (relAttr[2] ?? relAttr[3] ?? relAttr[4] ?? "").trim() : "";

    // L'ancre : le texte jusqu'a la fermeture, si elle est proche. Un lien qui
    // enveloppe un bloc n'a pas d'ancre lisible, et ce n'est pas une erreur.
    const apres = html.slice(re.lastIndex, re.lastIndex + 600);
    const fin = apres.indexOf("</a>");
    const ancre =
      fin >= 0
        ? apres.slice(0, fin).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)
        : "";

    trouves.push({ url, relBrut, ancre });
  }
  return trouves;
}

/**
 * ⛔ « non qualifie » N'EST PAS UNE VALEUR ACCEPTABLE dans la colonne rel.
 *    Un lien est dofollow, nofollow, ugc ou sponsored, point. L'absence d'attribut
 *    `rel` est la definition meme de dofollow, pas une inconnue.
 */
export function qualifierRel(relBrut) {
  const mots = (relBrut || "").toLowerCase().split(/\s+/).filter(Boolean);
  const retenus = mots.filter((x) => ["nofollow", "ugc", "sponsored"].includes(x));
  return retenus.length ? [...new Set(retenus)].sort().join("+") : "dofollow";
}

/* -------------------------------------------------- la politesse, non negociable */

/**
 * Le robots.txt d'un hote, mis en cache une journee dans la base.
 *
 * ⛔ UN 403 N'EST PAS UN robots.txt PERMISSIF. Seul un 404 dit « aucune
 *    restriction ». Un mur qui repond 403 sur /robots.txt est un hote qu'on
 *    n'ouvre pas : le prendre pour une autorisation, c'est se faire bannir.
 */
export async function reglesRobots(bd, hote) {
  const veille = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  try {
    const cache = await bd
      .prepare("SELECT interdit, delai, lu_le FROM robots_cache WHERE hote = ?")
      .bind(hote)
      .first();
    if (cache && cache.lu_le > veille) {
      return { interdit: (cache.interdit || "").split("\n").filter(Boolean), delai: cache.delai, mur: cache.interdit === "*MUR*" };
    }
  } catch { /* la base peut etre indisponible, on relit alors la source */ }

  let interdit = [];
  let delai = 0;
  let mur = false;
  try {
    const r = await fetch(`https://${hote}/robots.txt`, {
      headers: { "user-agent": AGENT, accept: "text/plain" },
      signal: AbortSignal.timeout(6000),
      cf: { cacheTtl: 3600 },
    });
    if (r.status === 404 || r.status === 410) {
      interdit = [];
    } else if (r.ok) {
      const texte = (await r.text()).slice(0, 60000);
      let concerne = false;
      for (const ligneBrute of texte.split(/\r?\n/)) {
        const ligne = ligneBrute.split("#")[0].trim();
        const sep = ligne.indexOf(":");
        if (sep < 0) continue;
        const cle = ligne.slice(0, sep).trim().toLowerCase();
        const val = ligne.slice(sep + 1).trim();
        if (cle === "user-agent") {
          concerne = val === "*" || /vigie/i.test(val);
        } else if (concerne && cle === "disallow" && val) {
          interdit.push(val);
        } else if (concerne && cle === "crawl-delay") {
          const n = parseFloat(val);
          if (Number.isFinite(n)) delai = Math.min(n, 30);
        }
      }
    } else {
      mur = true;
    }
  } catch {
    mur = true;
  }

  try {
    await bd
      .prepare(
        `INSERT INTO robots_cache (hote, interdit, delai, lu_le) VALUES (?, ?, ?, ?)
         ON CONFLICT(hote) DO UPDATE SET interdit = excluded.interdit, delai = excluded.delai, lu_le = excluded.lu_le`
      )
      .bind(hote, mur ? "*MUR*" : interdit.join("\n"), delai, MAINTENANT())
      .run();
  } catch { /* le cache est un confort, pas une condition */ }

  return { interdit, delai, mur };
}

export function cheminAutorise(regles, chemin) {
  if (regles.mur) return false;
  for (const motif of regles.interdit) {
    if (motif === "/") return false;
    const prefixe = motif.split("*")[0];
    if (prefixe && chemin.startsWith(prefixe)) return false;
  }
  return true;
}

/**
 * Ouvre une page en lecture, avec plafond d'octets et de temps.
 * Rend { html } ou { mur: "raison" }. Jamais d'exception vers l'appelant.
 */
export async function ouvrirPage(url, plafondOctets = 900000) {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": AGENT, accept: "text/html,application/xhtml+xml", "accept-language": "fr,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return { mur: "HTTP " + r.status };
    const type = r.headers.get("content-type") || "";
    if (type && !/html|xml|text\/plain/i.test(type)) return { mur: "type " + type.split(";")[0] };

    const lecteur = r.body?.getReader();
    if (!lecteur) return { mur: "corps vide" };
    const morceaux = [];
    let total = 0;
    while (total < plafondOctets) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      total += value.length;
    }
    try { await lecteur.cancel(); } catch { /* deja close */ }
    return { html: new TextDecoder("utf-8", { fatal: false }).decode(concat(morceaux, total)) };
  } catch (e) {
    return { mur: e.name === "TimeoutError" ? "delai depasse" : "injoignable" };
  }
}

function concat(morceaux, total) {
  const sortie = new Uint8Array(total);
  let i = 0;
  for (const m of morceaux) {
    sortie.set(m.subarray(0, Math.min(m.length, total - i)), i);
    i += m.length;
    if (i >= total) break;
  }
  return sortie;
}
