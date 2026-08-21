// LE ROBOT DE VIGIE, DANS LE NUAGE.
//
// ⛔ IL NE TOURNE SUR AUCUN PC. C'est un Worker Cloudflare reveille par un declencheur
//    horaire. Aucune machine a laisser allumee, aucune adresse IP domestique a faire
//    bannir, et le service continue d'avancer quand tout le monde dort.
//
// Il fait UN TOUR a chaque reveil : il prend la premiere cible de la file, decouvre ses
// pages candidates si c'est le debut, sinon en ouvre un paquet et lit les liens pour de
// vrai. Puis il rend la main. Le decoupage en tours n'est pas une precaution de style,
// c'est ce qui le fait tenir dans les plafonds du palier gratuit :
//
//   50 sous-requetes par invocation, et 30 secondes de processeur pour un declencheur
//   horaire. Un tour ouvre au plus 18 pages, robots.txt compris.
//
// Deploiement :
//   npx wrangler deploy            (depuis ce dossier)
//   npx wrangler tail              (pour regarder ce qu'il fait)

import { unTour } from "../vitrine/functions/api/_robot.js";

export default {
  /** Le reveil periodique. C'est le mode normal. */
  async scheduled(evenement, env, contexte) {
    contexte.waitUntil(travailler(env, "declencheur"));
  },

  /**
   * Une entree HTTP, uniquement pour pousser un tour a la main pendant une mise au
   * point. Elle exige le meme secret que celui pose dans le tableau de bord, sans quoi
   * n'importe qui pourrait faire tourner le robot a notre place.
   */
  async fetch(requete, env) {
    const url = new URL(requete.url);
    if (url.pathname === "/sante") {
      const file = await env.vigie
        .prepare("SELECT etat, COUNT(*) AS n FROM file_crawl GROUP BY etat")
        .all();
      return Response.json({ vivant: true, file: file.results || [] });
    }
    if (url.searchParams.get("cle") !== env.CLE_ROBOT || !env.CLE_ROBOT) {
      return new Response("non", { status: 403 });
    }
    return Response.json(await travailler(env, "manuel"));
  },
};

async function travailler(env, origine) {
  try {
    const rapport = await unTour(env.vigie);
    console.log(origine, JSON.stringify(rapport));
    return rapport;
  } catch (e) {
    // Un tour qui casse ne doit pas bloquer la file : on le dit et le reveil suivant
    // reprendra la meme cible. Une tache qui echoue en silence est une file morte.
    console.log(origine, "TOUR EN ECHEC :", e.message);
    return { fait: "erreur", pourquoi: e.message };
  }
}
