// QUI SE SERT DE L'OUTIL.
//
// GET /api/admin  -> comptes, usage, file du robot, taille de l'index.
//
// Reserve aux adresses listees dans la variable d'environnement VIGIE_ADMINS.
// ⛔ Le controle porte sur le COMPTE CONNECTE, pas sur une cle passee dans l'URL :
//    une cle dans une URL finit dans les journaux du serveur, dans l'historique du
//    navigateur et dans l'en-tete Referer de la page suivante.

import { json, erreur, compteDe } from "./_commun.js";
import { estAdmin } from "./compte.js";

export async function onRequestGet({ request, env }) {
  const bd = env.vigie;
  if (!bd) return erreur("base indisponible", 503);

  const compte = await compteDe(request, bd);
  if (!compte) return erreur("non connecte", 401);
  if (!estAdmin(env, compte.email)) return erreur("reserve", 403);

  const jour = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const semaine = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [comptes, recents, actions24, top, file, index, sources] = await Promise.all([
    bd.prepare(
      `SELECT id, email, cree_le, vu_le, analyses, crawls, pays
         FROM comptes ORDER BY cree_le DESC LIMIT 300`
    ).all(),
    bd.prepare(
      `SELECT quand, email, action, cible, pays FROM usages ORDER BY id DESC LIMIT 200`
    ).all(),
    bd.prepare(
      `SELECT action, COUNT(*) AS n FROM usages WHERE quand > ? GROUP BY action`
    ).bind(jour).all(),
    bd.prepare(
      `SELECT cible, COUNT(*) AS n FROM usages
        WHERE cible IS NOT NULL AND quand > ? GROUP BY cible ORDER BY n DESC LIMIT 40`
    ).bind(semaine).all(),
    bd.prepare(
      `SELECT cible, etat, phase_msg, demande_le, pages_lues, liens_trouves
         FROM file_crawl ORDER BY demande_le DESC LIMIT 80`
    ).all(),
    bd.prepare(
      `SELECT COUNT(*) AS liens, COUNT(DISTINCT cible) AS cibles,
              COUNT(DISTINCT domaine_src) AS domaines FROM backlinks`
    ).first(),
    bd.prepare(
      `SELECT source_donnee, COUNT(*) AS n FROM backlinks GROUP BY source_donnee ORDER BY n DESC`
    ).all(),
  ]);

  return json({
    comptes: comptes.results || [],
    total_comptes: (comptes.results || []).length,
    recents: recents.results || [],
    actions_24h: actions24.results || [],
    domaines_demandes_7j: top.results || [],
    file_robot: file.results || [],
    index,
    rendement_par_source: sources.results || [],
  });
}
