// FAIT MONTER LES LIENS TROUVES PAR NOTRE ROBOT DANS LA BASE DE L'APPLICATION.
//
// Le robot (crawler.mjs) note TOUS les liens sortants de chaque page qu'il ouvre, dans
// un index local. Ce fichier-ci prend, pour les domaines que quelqu'un a demandes, les
// liens qui pointent vers eux, et les ecrit dans D1 comme LIENS LUS : URL de la page,
// destination exacte, ancre, et rel reel.
//
// ⛔ CE SONT DES LIENS LUS, PAS DES DOMAINES ANNONCES. Ils entrent dans `backlinks` et
//    jamais dans `referents`. Un lien lu porte son URL et son rel ; un domaine annonce
//    par un index n'a ni l'un ni l'autre. Les melanger donnerait a un chiffre d'index
//    l'apparence d'une mesure.
//
// ⛔ ET ON NE POUSSE QUE CE QUI EST DEMANDE. L'index local grossit de plusieurs millions
//    de liens par jour ; D1 accepte 100 000 lignes ecrites par jour sur le palier
//    gratuit. On sert donc la file, pas l'index entier.
//
// Usage :
//   node serveur/pousser-liens.mjs                boucle : toutes les 10 minutes
//   node serveur/pousser-liens.mjs --une-passe
//   node serveur/pousser-liens.mjs --cibles=a.com,b.com

import { DatabaseSync } from "node:sqlite";

const arg = (nom, defaut = null) => {
  const t = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return t ? t.slice(nom.length + 3) : defaut;
};

const BD_LOCALE = (process.env.VIGIE_DONNEES || "C:/vigie/donnees") + "/index.sqlite";
const COMPTE = process.env.CLOUDFLARE_ACCOUNT_ID;
const JETON = process.env.CLOUDFLARE_API_TOKEN;
const BASE = process.env.VIGIE_D1;
const PAR_CIBLE = Number(arg("par-cible", 400));
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

// ⛔ D1 N'ACCEPTE QUE CENT VARIABLES LIEES PAR REQUETE, et un lien en coute six. Seize
//    lignes par requete, marge comprise. Le message d'erreur, quand on depasse, ne nomme
//    ni la limite ni la requete et arrive apres la moitie du travail.
const LIGNES_PAR_LOT = 15;

async function pousserCible(bd, cible) {
  const liens = bd
    .prepare(
      `SELECT url_src, domaine_src, url_dest, ancre, rel, vu_le
         FROM liens WHERE domaine_dest = ? ORDER BY vu_le DESC LIMIT ?`
    )
    .all(cible, PAR_CIBLE);

  if (!liens.length) return 0;

  let ecrits = 0;
  for (let i = 0; i < liens.length; i += LIGNES_PAR_LOT) {
    const lot = liens.slice(i, i + LIGNES_PAR_LOT);
    const valeurs = lot
      .map((_, k) => {
        const b = k * 6 + 2;
        return `(?1, ?${b}, ?${b + 1}, ?${b + 2}, ?${b + 3}, ?${b + 4}, ?${b + 4}, 'MESURE', ?${b + 5}, 'robot_vigie')`;
      })
      .join(", ");
    const params = [cible];
    for (const l of lot) params.push(l.domaine_src, l.url_src, l.url_dest, l.ancre, l.rel, l.vu_le);
    await sql(
      `INSERT INTO backlinks (cible, domaine_src, url_src, url_dest, ancre, rel, rel_brut, etat, vu_le, source_donnee)
       VALUES ${valeurs}
       ON CONFLICT(cible, url_src, url_dest) DO UPDATE SET
         rel = excluded.rel, ancre = excluded.ancre, vu_le = excluded.vu_le`,
      params
    );
    ecrits += lot.length;
  }
  return ecrits;
}

async function unePasse() {
  const bd = new DatabaseSync(BD_LOCALE, { readOnly: true });

  const forcees = arg("cibles");
  const cibles = forcees
    ? forcees.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)
    : (await sql("SELECT cible FROM file_crawl ORDER BY demande_le DESC LIMIT 300")).map((l) => l.cible);

  dire(`${cibles.length} cible(s) a servir depuis l index du robot`);
  let total = 0;
  let servies = 0;

  for (const cible of cibles) {
    try {
      const n = await pousserCible(bd, cible);
      if (n) {
        total += n;
        servies++;
        dire(`  ${cible} : ${n} lien(s) lu(s) pousse(s)`);
      }
    } catch (e) {
      dire(`  ${cible} : echec, ${e.message}`);
    }
    // ⛔ LE PALIER GRATUIT DE D1 PLAFONNE A 100 000 LIGNES ECRITES PAR JOUR. On s'arrete
    //    largement avant, plutot que de se faire couper au milieu d'une cible.
    if (total > 40000) { dire("  plafond d ecriture du jour approche, on s arrete la"); break; }
  }

  bd.close();
  dire(`${total} lien(s) pousse(s) sur ${servies} cible(s)`);
  return total;
}

dire(`pousseur demarre : ${PAR_CIBLE} liens par cible au plus`);

if (process.argv.includes("--une-passe") || arg("cibles")) {
  await unePasse();
} else {
  for (;;) {
    try { await unePasse(); } catch (e) { dire(`⛔ passe en echec : ${e.message}`); }
    await new Promise((s) => setTimeout(s, ATTENTE_MIN * 60000));
  }
}
