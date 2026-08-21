// LES COMPTES : inscription, connexion, deconnexion, et « qui suis-je ».
//
// Une seule route pour les quatre, parce qu'elles partagent tout et qu'un fichier de
// plus dans `functions/` est une invocation de plus a maintenir.
//
//   POST /api/compte  { action: "inscription", email, derivee }
//   POST /api/compte  { action: "connexion",   email, derivee }
//   POST /api/compte  { action: "deconnexion" }
//   GET  /api/compte                                    -> le compte courant, ou null
//
// ⛔ `derivee` N'EST PAS UN MOT DE PASSE EN CLAIR. Le navigateur a deja passe
//    210 000 tours de PBKDF2 dessus, avec l'email pour sel. Le serveur ne voit
//    jamais le mot de passe, et n'a pas le processeur pour l'etirer lui-meme.
//    Le pourquoi complet est dans _commun.js, fonction empreinteDe.

import {
  json, erreur, MAINTENANT, sha256Hexa, empreinteDe, selNeuf, jetonNeuf, idNeuf,
  cookieSession, cookieVide, compteDe, tracer,
} from "./_commun.js";

const EMAIL_OK = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const DUREE_SESSION_JOURS = 30;

export async function onRequestGet({ request, env }) {
  const compte = await compteDe(request, env.vigie);
  if (!compte) return json({ connecte: false });
  return json({
    connecte: true,
    email: compte.email,
    depuis: compte.cree_le,
    analyses: compte.analyses,
    crawls: compte.crawls,
    admin: estAdmin(env, compte.email),
  });
}

export function estAdmin(env, email) {
  const liste = (env.VIGIE_ADMINS || "").toLowerCase().split(/[,\s]+/).filter(Boolean);
  return liste.includes((email || "").toLowerCase());
}

export async function onRequestPost({ request, env }) {
  const bd = env.vigie;
  if (!bd) return erreur("base indisponible", 503);

  let corps;
  try { corps = await request.json(); } catch { return erreur("corps illisible"); }
  const action = String(corps.action || "");

  if (action === "deconnexion") {
    const jeton = (request.headers.get("cookie") || "").match(/vigie_s=([0-9a-f]{64})/)?.[1];
    if (jeton) await bd.prepare("DELETE FROM sessions WHERE jeton = ?").bind(jeton).run();
    return json({ ok: true }, 200, { "set-cookie": cookieVide() });
  }

  const email = String(corps.email || "").trim().toLowerCase();
  const derivee = String(corps.derivee || "");
  if (!EMAIL_OK.test(email) || email.length > 190) return erreur("Cette adresse ne ressemble pas a une adresse email.");
  // La derivee du navigateur fait toujours 64 caracteres hexa. Une autre longueur veut
  // dire que le navigateur n'a pas fait son travail : refuser plutot que d'enregistrer
  // une empreinte faible sans le dire.
  if (!/^[0-9a-f]{64}$/.test(derivee)) return erreur("Le navigateur n'a pas pu preparer le mot de passe. Reessayez.");

  const pays = request.headers.get("cf-ipcountry") || null;

  if (action === "inscription") {
    const deja = await bd.prepare("SELECT id FROM comptes WHERE email = ?").bind(email).first();
    if (deja) return erreur("Un compte existe deja avec cette adresse. Connectez-vous.", 409);

    const sel = selNeuf();
    const id = idNeuf();
    await bd
      .prepare(
        `INSERT INTO comptes (id, email, empreinte, sel, cree_le, vu_le, pays, provenance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, email, await empreinteDe(derivee, sel), sel, MAINTENANT(), MAINTENANT(), pays,
        (request.headers.get("referer") || "").slice(0, 200) || null)
      .run();

    await tracer(bd, { compte: id, email, action: "inscription", pays });
    return ouvrirSession(bd, id, email, pays, true);
  }

  if (action === "connexion") {
    const ligne = await bd
      .prepare("SELECT id, empreinte, sel FROM comptes WHERE email = ?")
      .bind(email)
      .first();
    // Le message reste le meme que le compte existe ou non : dire « cette adresse est
    // inconnue » revient a offrir un annuaire des inscrits a qui le demande.
    if (!ligne) return erreur("Adresse ou mot de passe incorrect.", 401);
    const attendu = await empreinteDe(derivee, ligne.sel);
    if (!egalitePrudente(attendu, ligne.empreinte)) return erreur("Adresse ou mot de passe incorrect.", 401);

    await bd.prepare("UPDATE comptes SET vu_le = ? WHERE id = ?").bind(MAINTENANT(), ligne.id).run();
    await tracer(bd, { compte: ligne.id, email, action: "connexion", pays });
    return ouvrirSession(bd, ligne.id, email, pays, false);
  }

  return erreur("action inconnue");
}

async function ouvrirSession(bd, id, email, pays, neuf) {
  const jeton = jetonNeuf();
  const expire = new Date(Date.now() + DUREE_SESSION_JOURS * 24 * 3600 * 1000).toISOString();
  await bd
    .prepare("INSERT INTO sessions (jeton, compte, cree_le, expire_le) VALUES (?, ?, ?, ?)")
    .bind(jeton, id, MAINTENANT(), expire)
    .run();
  // Le menage des sessions mortes se fait ici, une ligne a la fois, plutot que par une
  // tache dediee qu'il faudrait surveiller.
  await bd.prepare("DELETE FROM sessions WHERE expire_le < ?").bind(MAINTENANT()).run();
  return json({ ok: true, email, neuf }, 200, { "set-cookie": cookieSession(jeton, DUREE_SESSION_JOURS) });
}

/** Comparaison a temps constant : une comparaison naive fuit l'empreinte octet par octet. */
function egalitePrudente(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export { sha256Hexa };
