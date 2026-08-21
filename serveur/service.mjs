// LE SERVICE QUI RELIE LE GRAPHE DU WEB A L'APPLICATION.
//
// Il tourne sur un serveur, en boucle, et ne recoit AUCUNE connexion entrante :
//   1. il lit la file d'attente dans la base D1, par l'API de Cloudflare ;
//   2. quand il y a du travail, il fait UNE passe sur le graphe pour toutes les cibles
//      en attente a la fois ;
//   3. il ecrit les domaines referents dans la table `referents`.
//
// ⛔ AUCUN PORT OUVERT, ET C'EST VOULU. Un service qui ecoute sur internet demande un
//    pare-feu, un certificat, un secret partage et une surveillance. Ici le serveur
//    APPELLE Cloudflare, jamais l'inverse : rien a exposer, rien a defendre.
//
// ⛔ LE TRAITEMENT EST PAR LOT PARCE QUE LA PASSE COUTE LE MEME PRIX POUR UNE CIBLE OU
//    POUR CINQUANTE MILLE : vingt minutes de lecture des 2,7 milliards d'aretes. Traiter
//    les demandes une par une multiplierait le cout par le nombre de demandes.
//
// ⛔ ET ON PLAFONNE CE QU'ON POUSSE DANS D1, PARCE QUE SON PALIER GRATUIT ACCEPTE
//    100 000 LIGNES ECRITES PAR JOUR. Un seul gros domaine en a davantage. On pousse
//    donc les meilleurs, on ecrit combien on laisse dehors, et on ne fait jamais passer
//    un plafond pour un total.
//
// Variables d'environnement obligatoires, jamais dans le depot :
//   CLOUDFLARE_ACCOUNT_ID
//   CLOUDFLARE_API_TOKEN     droit D1 en ecriture
//   VIGIE_D1                 identifiant de la base
//
// Usage :
//   node serveur/service.mjs               boucle sans fin
//   node serveur/service.mjs --une-passe   une seule passe, puis sortie
//   node serveur/service.mjs --cibles=a.com,b.com   force ces cibles

import { referentsDe } from "./graphe-referents.mjs";

const arg = (nom, defaut = null) => {
  const t = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return t ? t.slice(nom.length + 3) : defaut;
};

const COMPTE = process.env.CLOUDFLARE_ACCOUNT_ID;
const JETON = process.env.CLOUDFLARE_API_TOKEN;
const BASE = process.env.VIGIE_D1;
const PLAFOND_D1 = Number(arg("plafond-d1", 500));
const ATTENTE_MIN = Number(arg("attente", 10));

if (!COMPTE || !JETON || !BASE) {
  console.error("⛔ CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN et VIGIE_D1 sont obligatoires.");
  process.exit(2);
}

const horodate = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const dire = (m) => console.log(`[${horodate()}] ${m}`);

async function sql(requete, params = []) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${COMPTE}/d1/database/${BASE}/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${JETON}`, "content-type": "application/json" },
      body: JSON.stringify({ sql: requete, params }),
    }
  );
  const d = await r.json();
  if (!d.success) throw new Error(JSON.stringify(d.errors).slice(0, 300));
  return d.result?.[0]?.results || [];
}

/**
 * Les cibles qui attendent le graphe : demandees dans la file, et pas encore servies.
 * On sert aussi celles dont la derniere lecture date de plus d'un trimestre, parce que
 * le graphe est refait a ce rythme-la.
 */
async function fileDattente() {
  const forcees = arg("cibles");
  if (forcees) return forcees.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);

  const trimestre = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const lignes = await sql(
    `SELECT f.cible
       FROM file_crawl f
       LEFT JOIN (SELECT cible, MAX(vu_le) AS vu FROM referents WHERE source = 'common_crawl' GROUP BY cible) r
         ON r.cible = f.cible
      WHERE r.cible IS NULL OR r.vu < ?
      ORDER BY f.demande_le ASC
      LIMIT 5000`,
    [trimestre]
  );
  return lignes.map((l) => l.cible);
}

/** Ecrit les domaines referents d'une cible, par paquets que D1 accepte. */
async function pousser(cible, domaines, tronque, plafond) {
  const maintenant = new Date().toISOString();
  const retenus = domaines.slice(0, PLAFOND_D1);
  let ecrits = 0;

  for (let i = 0; i < retenus.length; i += 50) {
    const paquet = retenus.slice(i, i + 50);
    const valeurs = paquet.map(() => "(?, ?, ?, 'common_crawl', 'MESURE', ?, ?)").join(", ");
    // ⛔ « nature » DIT SI LE NOMBRE EST UN COMPTE OU UN PLANCHER. Des qu'on a coupe,
    //    que ce soit au plafond de la passe ou a celui de D1, ce n'est plus un total.
    const coupe = tronque > 0 || domaines.length > PLAFOND_D1;
    const params = paquet.flatMap((d) => [cible, d, null, coupe ? "plancher" : "mesure", maintenant]);
    await sql(
      `INSERT INTO referents (cible, domaine_src, liens, source, etat, nature, vu_le)
       VALUES ${valeurs}
       ON CONFLICT(cible, domaine_src, source) DO UPDATE SET vu_le = excluded.vu_le, nature = excluded.nature`,
      params
    );
    ecrits += paquet.length;
  }

  const dehors = Math.max(0, domaines.length - retenus.length) + tronque;
  const message =
    `${ecrits} domaine(s) referent(s) du graphe du web` +
    (dehors ? ` (au moins ${dehors} de plus, non charges)` : "");

  await sql(
    `UPDATE file_crawl SET phase_msg = ? WHERE cible = ?`,
    [message, cible]
  );

  return { ecrits, dehors };
}

/** Une cible demandee a la main doit exister dans la file, sinon rien ne la suivra. */
async function assurerDansLaFile(cibles) {
  const maintenant = new Date().toISOString();
  for (const c of cibles) {
    await sql(
      `INSERT INTO file_crawl (cible, etat, phase_msg, demande_le, demandeur, priorite)
       VALUES (?, 'attente', 'graphe du web demande', ?, 'serveur', 3)
       ON CONFLICT(cible) DO NOTHING`,
      [c, maintenant]
    );
  }
}

async function unePasse() {
  const cibles = await fileDattente();
  if (!cibles.length) {
    dire("file vide, rien a faire");
    return 0;
  }

  dire(`${cibles.length} cible(s) a servir : ${cibles.slice(0, 6).join(", ")}${cibles.length > 6 ? "…" : ""}`);
  await assurerDansLaFile(cibles);

  const debut = Date.now();
  const r = await referentsDe(cibles, { journal: (m) => dire("  " + m) });

  let total = 0;
  for (const [cible, v] of r.referents) {
    const { ecrits, dehors } = await pousser(cible, v.domaines, v.tronque, v.plafond);
    total += ecrits;
    dire(`  ${cible} : ${ecrits} ecrit(s)${dehors ? `, ${dehors} laisse(s) dehors` : ""}`);
  }

  // ⛔ UNE CIBLE ABSENTE DU GRAPHE N'EST PAS UNE CIBLE SANS BACKLINKS. Le graphe est
  //    refait chaque trimestre : un domaine cree entre-temps n'y est pas encore. On
  //    l'ecrit a l'ecran, on ne le compte pas comme zero.
  for (const cible of r.absentes) {
    await sql(
      `UPDATE file_crawl SET phase_msg = ? WHERE cible = ?`,
      ["▲ absent de l edition en cours du graphe du web, ce qui ne dit rien de ses backlinks", cible]
    );
    dire(`  ${cible} : absent du graphe`);
  }

  dire(`passe terminee en ${((Date.now() - debut) / 60000).toFixed(1)} min, ${total} ligne(s) ecrite(s)`);
  return total;
}

/* --------------------------------------------------------------------- main */

dire(`service demarre, plafond D1 = ${PLAFOND_D1}, attente entre passes = ${ATTENTE_MIN} min`);

if (process.argv.includes("--une-passe") || arg("cibles")) {
  await unePasse();
} else {
  for (;;) {
    try {
      await unePasse();
    } catch (e) {
      dire(`⛔ passe en echec : ${e.message}`);
    }
    await new Promise((s) => setTimeout(s, ATTENTE_MIN * 60000));
  }
}
