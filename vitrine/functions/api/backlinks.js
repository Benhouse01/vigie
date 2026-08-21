// LES BACKLINKS D'UN DOMAINE.
//
//   GET  /api/backlinks?d=exemple.com[&page=0&rel=dofollow&tri=note]
//        Rend ce que l'index partage sait DEJA, plus l'etat du robot sur cette cible.
//
//   POST /api/backlinks  { domaine }
//        Met la cible en file et fait un tour immediat, pour que quelque chose bouge
//        tout de suite a l'ecran. La suite se fait toute seule dans le nuage.
//
// ⛔ CE QUI SORT D'ICI N'EST JAMAIS UN TOTAL. C'est ce qui a ete confirme a ce jour,
//    et l'ecart avec la realite est affiche comme tel. Un outil qui annonce « 270
//    backlinks » sans pouvoir en montrer 270 ment ; celui-ci montre ce qu'il a lu.

import { json, erreur, normaliserDomaine, compteDe, tracer, MAINTENANT } from "./_commun.js";
import { demanderCrawl, etatCrawl, unTour } from "./_robot.js";

const PAR_PAGE = 200;
const CRAWLS_PAR_JOUR = 12;

export async function onRequestGet({ request, env }) {
  const bd = env.vigie;
  if (!bd) return erreur("base indisponible", 503);

  const compte = await compteDe(request, bd);
  if (!compte) return erreur("Connectez-vous pour voir les backlinks.", 401);

  const url = new URL(request.url);
  const cible = normaliserDomaine(url.searchParams.get("d") || "");
  if (!cible) return erreur("Domaine illisible.");

  const page = Math.max(0, Math.min(50, parseInt(url.searchParams.get("page") || "0", 10) || 0));
  const filtreRel = url.searchParams.get("rel") || "";

  let ou = "WHERE cible = ?";
  const params = [cible];
  if (filtreRel === "dofollow") { ou += " AND rel = 'dofollow'"; }
  else if (filtreRel === "nofollow") { ou += " AND rel <> 'dofollow'"; }

  const [lignes, compte_total, parDomaine, parRel] = await Promise.all([
    bd.prepare(
      `SELECT domaine_src, url_src, url_dest, ancre, rel, rel_brut, vu_le, source_donnee
         FROM backlinks ${ou} ORDER BY domaine_src ASC, url_src ASC LIMIT ? OFFSET ?`
    ).bind(...params, PAR_PAGE, page * PAR_PAGE).all(),
    bd.prepare(`SELECT COUNT(*) AS n FROM backlinks ${ou}`).bind(...params).first(),
    bd.prepare(
      `SELECT domaine_src, COUNT(*) AS liens, MIN(vu_le) AS depuis,
              SUM(CASE WHEN rel = 'dofollow' THEN 1 ELSE 0 END) AS suivis
         FROM backlinks WHERE cible = ? GROUP BY domaine_src ORDER BY liens DESC LIMIT 400`
    ).bind(cible).all(),
    bd.prepare(
      `SELECT rel, COUNT(*) AS n FROM backlinks WHERE cible = ? GROUP BY rel`
    ).bind(cible).all(),
  ]);

  const etat = await etatCrawl(bd, cible);

  return json({
    cible,
    liens: lignes.results || [],
    page,
    par_page: PAR_PAGE,
    total_affichable: compte_total?.n ?? 0,
    domaines: parDomaine.results || [],
    repartition_rel: parRel.results || [],
    robot: etat,
    // La phrase que l'interface doit reprendre telle quelle. Elle dit ce que ce
    // nombre est, et surtout ce qu'il n'est pas.
    nature:
      "Liens confirmes par lecture du HTML servi. Ce n'est pas un total : c'est ce que " +
      "le robot a ouvert et lu a ce jour.",
    quand: MAINTENANT(),
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const bd = env.vigie;
  if (!bd) return erreur("base indisponible", 503);

  const compte = await compteDe(request, bd);
  if (!compte) return erreur("Connectez-vous pour lancer le robot.", 401);

  let corps;
  try { corps = await request.json(); } catch { return erreur("corps illisible"); }
  const cible = normaliserDomaine(corps.domaine || "");
  if (!cible) return erreur("Domaine illisible.");

  // Un plafond par compte et par jour. Le robot ouvre de vraies pages chez de vrais
  // gens : le volume n'est pas gratuit pour eux, meme s'il l'est pour nous.
  const hier = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recents = await bd
    .prepare("SELECT COUNT(*) AS n FROM usages WHERE compte = ? AND action = 'crawl' AND quand > ?")
    .bind(compte.id, hier)
    .first();
  if ((recents?.n ?? 0) >= CRAWLS_PAR_JOUR) {
    return erreur(
      `Vous avez lance ${CRAWLS_PAR_JOUR} crawls en 24 h, c'est le plafond. ` +
      `Il se rouvre au fil des heures. Les crawls deja lances continuent tout seuls.`,
      429
    );
  }

  const mise = await demanderCrawl(bd, cible, compte.id);
  await bd.prepare("UPDATE comptes SET crawls = crawls + 1 WHERE id = ?").bind(compte.id).run();
  await tracer(bd, {
    compte: compte.id, email: compte.email, action: "crawl", cible,
    pays: request.headers.get("cf-ipcountry"), detail: mise.neuf ? "neuf" : "reprise",
  });

  // Un tour tout de suite, pour que l'ecran montre quelque chose. Le budget est
  // volontairement plus court qu'un tour du declencheur horaire : cette requete a un
  // utilisateur qui attend devant.
  // Deux tours enchaines : la decouverte, puis une premiere lecture de pages, pour que
  // l ecran montre de vrais liens tout de suite plutot qu une file d attente. Le reste
  // se fait au declencheur horaire, sans que personne ait a laisser la page ouverte.
  const tours = [];
  try {
    tours.push(await unTour(bd, cible, 10));
    if (tours[0]?.fait === "decouverte") tours.push(await unTour(bd, cible, 8, true));
  } catch (e) {
    tours.push({ fait: "erreur", pourquoi: e.message });
  }

  return json({ ok: true, cible, mise, tours, robot: await etatCrawl(bd, cible) });
}
