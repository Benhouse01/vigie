// PUBLIE LA CAPACITE REELLE DU MOTEUR, POUR QU'ELLE SOIT AFFICHEE.
//
// ⛔ CE FICHIER EXISTE PARCE QU'UN OUTIL QUI CACHE SA CAPACITE MENT PAR OMISSION.
//    Semrush crawle dix milliards de pages par jour, Ahrefs sept a huit. Vigie en fait
//    quelques millions. Taire ce rapport laisserait croire que l'index voit tout, et
//    l'utilisateur decouvrirait le trou au pire moment, en concluant que son site n'a
//    pas de backlinks alors que c'est nous qui ne les avons pas encore lus.
//    La cadence mesuree part donc a l'ecran, a cote de celle des outils payants, meme
//    quand le rapport est de un a quatre mille.
//
// ⛔ ET LES CHIFFRES SONT MESURES, JAMAIS ANNONCES. La cadence se calcule sur les dates
//    reelles de lecture des pages, pas sur une capacite theorique. Une capacite
//    theorique est un argument commercial ; une cadence mesuree est une mesure.
//
// Usage :
//   node serveur/rapporter.mjs               une fois
//   node serveur/rapporter.mjs --boucle      toutes les dix minutes

import { DatabaseSync } from "node:sqlite";

const arg = (nom, defaut = null) => {
  const t = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return t ? t.slice(nom.length + 3) : defaut;
};

const BD_LOCALE = (process.env.VIGIE_DONNEES || "C:/vigie/donnees") + "/index.sqlite";
const COMPTE = process.env.CLOUDFLARE_ACCOUNT_ID;
const JETON = process.env.CLOUDFLARE_API_TOKEN;
const BASE = process.env.VIGIE_D1;

if (!COMPTE || !JETON || !BASE) {
  console.error("⛔ CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN et VIGIE_D1 sont obligatoires.");
  process.exit(2);
}

const dire = (m) => console.log(`[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${m}`);

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

function mesurer() {
  const bd = new DatabaseSync(BD_LOCALE, { readOnly: true });

  const heure = new Date(Date.now() - 3600000).toISOString();
  const jour = new Date(Date.now() - 86400000).toISOString();

  const pagesHeure = bd.prepare("SELECT COUNT(*) AS n FROM file WHERE lu_le > ?").get(heure).n;
  const pagesJour = bd.prepare("SELECT COUNT(*) AS n FROM file WHERE lu_le > ?").get(jour).n;
  const total = bd.prepare("SELECT COUNT(*) AS n FROM file WHERE lu_le IS NOT NULL").get().n;
  const liens = bd.prepare("SELECT COUNT(*) AS n FROM liens").get();
  const cibles = bd.prepare("SELECT COUNT(DISTINCT domaine_dest) AS n FROM liens").get().n;
  const sources = bd.prepare("SELECT COUNT(DISTINCT domaine_src) AS n FROM liens").get().n;
  const hotes = bd.prepare("SELECT COUNT(*) AS n FROM hotes WHERE mur = 0").get().n;
  const enFile = bd.prepare("SELECT COUNT(*) AS n FROM file WHERE etat = 'attente'").get().n;

  // ⛔ LA CADENCE SE MESURE SUR LA DERNIERE HEURE, PAS DEPUIS LE DEBUT. Une moyenne
  //    depuis le premier jour lisse les arrets, les reprises et les montees en charge :
  //    elle decrit un passe qui n'existe plus. La derniere heure decrit ce que la
  //    machine fait maintenant, ce qui est la seule chose qu'on puisse promettre.
  const cadenceJour = pagesHeure * 24;

  bd.close();

  return {
    pages_derniere_heure: pagesHeure,
    pages_dernier_jour: pagesJour,
    pages_depuis_le_debut: total,
    cadence_pages_par_jour: cadenceJour,
    liens_indexes: liens.n,
    domaines_cibles: cibles,
    domaines_sources: sources,
    hotes_ouverts: hotes,
    pages_en_file: enFile,
  };
}

async function publier() {
  const m = mesurer();
  const maintenant = new Date().toISOString();

  for (const [cle, valeur] of Object.entries(m)) {
    await sql(
      `INSERT INTO metriques (cle, valeur, maj_le) VALUES (?, ?, ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le`,
      [cle, String(valeur), maintenant]
    );
  }

  dire(
    `${m.pages_derniere_heure.toLocaleString("fr-FR")} pages/h, ` +
      `${m.cadence_pages_par_jour.toLocaleString("fr-FR")} pages/jour, ` +
      `${m.liens_indexes.toLocaleString("fr-FR")} liens sur ${m.domaines_cibles.toLocaleString("fr-FR")} domaines`
  );
  return m;
}

if (process.argv.includes("--boucle")) {
  for (;;) {
    try { await publier(); } catch (e) { dire(`⛔ publication en echec : ${e.message}`); }
    await new Promise((s) => setTimeout(s, Number(arg("attente", 1)) * 60000));
  }
} else {
  await publier();
}
