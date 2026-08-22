// LIRE LE LIEN REEL SANS RECRAWLER LE WEB.
//
// Le graphe de Common Crawl dit QUI pointe vers une cible. Il ne dit ni depuis quelle
// page, ni avec quelle ancre, ni avec quel `rel`. C'est pour ca que la moitie du tableau
// de Vigie affiche « annonce » au lieu de « lu » : on connait le domaine emetteur et rien
// d'autre.
//
// Common Crawl a pourtant DEJA la page. Son index CDX donne, pour n'importe quelle URL,
// le fichier WARC exact, la position en octets et la longueur de l'enregistrement. Une
// seule requete HTTP avec un en-tete `Range` extrait ces octets-la, et rien d'autre : on
// telecharge 40 a 200 Ko au lieu des 90 To de l'archive, et on obtient le HTML servi le
// jour du crawl.
//
// ⛔ C'EST CE QUI FAIT PASSER UN DOMAINE DE « ANNONCE » A « LU », sans ouvrir une seule
//    connexion vers le site concerne. On ne derange personne, et on lit ce que le robot
//    de Common Crawl a vu, avec sa date.
//
// ⛔ TROIS REGLES QUE COMMON CRAWL DEMANDE, ET QU'ON TIENT :
//    1. Rester sous dix requetes par seconde. On vise cinq, avec une attente entre
//       chaque : le service est gratuit et partage, le saturer le ferait fermer.
//    2. Un `User-Agent` qui dit qui on est et ou nous joindre.
//    3. Ne pas retelecharger ce qu'on a deja : chaque enregistrement lu est ecrit en base,
//       et une seconde passe sur la meme page ne redemande rien.
//
// ⛔ ET LE PIEGE QUI COUTE UNE HEURE SI ON NE LE SAIT PAS : la reponse d'une requete Range
//    sur un WARC est UN MEMBRE GZIP COMPLET, pas un morceau de flux. Il se decompresse
//    seul, avec gunzip, et surtout PAS avec un decompresseur de flux qui attendrait la
//    suite. Le symptometre est une erreur « unexpected end of file » sur des octets
//    pourtant complets.
//
// Usage :
//   node serveur/warc-liens.mjs --cible=tradoshi.com --domaines=20
//   node serveur/warc-liens.mjs --cible=tradoshi.com --dry

import zlib from "node:zlib";
import { promisify } from "node:util";

const gunzip = promisify(zlib.gunzip);

const arg = (nom, defaut = null) => {
  const t = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return t ? t.slice(nom.length + 3) : defaut;
};
const drapeau = (n) => process.argv.includes(`--${n}`);

const COMPTE = process.env.CLOUDFLARE_ACCOUNT_ID;
const JETON = process.env.CLOUDFLARE_API_TOKEN;
const BASE = process.env.VIGIE_D1;

const INDEX = arg("index", "CC-MAIN-2026-30");
const CIBLE = (arg("cible") || "").toLowerCase().replace(/^www\./, "");
const MAX_DOMAINES = Number(arg("domaines", 25));
const MAX_PAGES_PAR_DOMAINE = Number(arg("pages", 3));
const DRY = drapeau("dry");

const UA = "VigieBot/1.0 (+https://vigie-seo.pages.dev/ ; lecture ciblee de l archive, contact@tradoshi.com)";

// Cinq requetes par seconde au plus : Common Crawl en tolere dix, on garde la moitie.
const ENTRE_APPELS = 200;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const horodate = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const dire = (m) => console.log(`[${horodate()}] ${m}`);

// ── D1 ────────────────────────────────────────────────────────────────────────
async function sql(requete, params = []) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${COMPTE}/d1/database/${BASE}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${JETON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: requete, params }),
    }
  );
  const d = await r.json();
  if (!d.success) throw new Error(JSON.stringify(d.errors).slice(0, 300));
  return d.result?.[0]?.results || [];
}

// ── L'index CDX : ou se trouve la page dans l'archive ─────────────────────────
/**
 * Rend les emplacements d'une URL ou d'un motif : fichier WARC, position, longueur.
 *
 * ⛔ VISER LA BONNE PAGE, PAS UNE PAGE DU DOMAINE. Premiere version de ce script :
 *    j'interrogeais `<domaine>/*` et je lisais trois pages au hasard. Sur trois annuaires
 *    qui citent pourtant la cible, resultat ZERO lien — parce que la page d'accueil de
 *    saashub.com ne parle evidemment pas de tradoshi, seule /tradoshi le fait. Lire
 *    l'archive ne sert a rien si on lit la mauvaise page. On interroge donc l'URL EXACTE
 *    quand on la connait, et un motif filtre sur le nom de la marque sinon.
 */
async function emplacements(motif, combien, filtre = null) {
  // ⛔ L'INDEX N'ACCEPTE QUE DEUX FORMES, ET IL REFUSE LES AUTRES PAR UN 404 MUET.
  //    Mesure du 22/08/2026, quatre formes essayees a la main :
  //      `https://www.adafruit.com/faq`      200, l'URL exacte marche
  //      `trustpilot.com/*`                  200, le prefixe avec une seule etoile marche
  //      `trustpilot.com`                    404, un domaine nu n'est pas une URL capturee
  //      `domaine.com/*marque*`              404, DEUX etoiles ne sont pas supportees
  //    Ma premiere version construisait la quatrieme forme. Elle rendait donc 404 sur
  //    TOUS les domaines annonces, et le script concluait « absent de l'archive » alors
  //    que c'etait sa requete qui etait invalide. Un 404 de cet index veut dire « aucune
  //    capture », jamais « ta syntaxe est fausse » : les deux se ressemblent exactement.
  //    On demande donc le prefixe, et on filtre nous-memes sur le nom de la marque.
  const large = filtre ? Math.max(combien * 40, 200) : combien * 6;
  const url =
    `https://index.commoncrawl.org/${INDEX}-index` +
    `?url=${encodeURIComponent(motif)}&output=json&limit=${large}`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (r.status === 404) return { etat: "absent", pages: [] };
  if (!r.ok) return { etat: `HTTP ${r.status}`, pages: [] };

  const texte = await r.text();
  const pages = [];
  for (const ligne of texte.split("\n")) {
    if (!ligne.trim()) continue;
    let o;
    try { o = JSON.parse(ligne); } catch { continue; }
    if (o.status !== "200") continue;
    if (o.mime && !/html/i.test(o.mime)) continue;
    // Quand on ne connait pas la page exacte, on ne garde que celles dont l'adresse
    // nomme la marque : un annuaire appelle sa fiche d'apres le produit.
    if (filtre && !o.url.toLowerCase().includes(filtre)) continue;
    pages.push({
      url: o.url,
      fichier: o.filename,
      position: Number(o.offset),
      longueur: Number(o.length),
      quand: o.timestamp,
    });
    if (pages.length >= combien) break;
  }
  return { etat: "ok", pages };
}

// ── L'enregistrement WARC, par requete Range ──────────────────────────────────
async function lireEnregistrement(p) {
  const fin = p.position + p.longueur - 1;
  const r = await fetch(`https://data.commoncrawl.org/${p.fichier}`, {
    headers: { "User-Agent": UA, Range: `bytes=${p.position}-${fin}` },
  });
  // ⛔ 206 est le SUCCES attendu ici. Un 200 voudrait dire que le serveur a ignore le
  //    Range et s apprete a envoyer le fichier ENTIER, soit environ un gigaoctet : on
  //    abandonne plutot que de le telecharger.
  if (r.status === 200) throw new Error("Range ignore, le serveur enverrait tout le fichier");
  if (r.status !== 206) throw new Error(`HTTP ${r.status}`);

  const octets = Buffer.from(await r.arrayBuffer());
  // ⛔ Un membre gzip COMPLET, pas un morceau de flux. gunzip, jamais un decompresseur
  //    de flux qui attendrait la suite.
  const brut = (await gunzip(octets)).toString("utf8");

  // WARC : en-tetes WARC, ligne vide, en-tetes HTTP, ligne vide, corps.
  const coupe = brut.indexOf("\r\n\r\n");
  if (coupe < 0) return null;
  const apresWarc = brut.slice(coupe + 4);
  const coupe2 = apresWarc.indexOf("\r\n\r\n");
  if (coupe2 < 0) return null;
  return { html: apresWarc.slice(coupe2 + 4), octets: octets.length };
}

// ── Extraire les liens vers la cible ──────────────────────────────────────────
/**
 * ⛔ ON LIT LE `rel` TEL QU'IL EST ECRIT, et on le range ensuite. Un lien sans `rel` est
 *    dofollow ; c'est l'ABSENCE qui vaut suivi, pas la presence d'un mot. Beaucoup
 *    d'outils cherchent « dofollow » dans l'attribut, ne le trouvent jamais, et
 *    concluent nofollow partout.
 */
function liensVers(html, cible) {
  const trouves = [];
  const motif = /<a\s([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]{0,400}?)<\/a>/gi;
  let m;
  while ((m = motif.exec(html))) {
    const href = m[2];
    if (!href.toLowerCase().includes(cible)) continue;
    const attributs = (m[1] + " " + m[3]);
    const rel = (attributs.match(/\brel\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const ancre = m[4].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    trouves.push({
      url_dest: href,
      ancre,
      rel_brut: rel || null,
      rel: /nofollow/i.test(rel) ? "nofollow" : (/sponsored|ugc/i.test(rel) ? rel.toLowerCase() : "dofollow"),
    });
    if (trouves.length >= 12) break;
  }
  return trouves;
}

// ── Programme ─────────────────────────────────────────────────────────────────
async function main() {
  if (!CIBLE) throw new Error("passer --cible=exemple.com");
  if (!DRY && (!COMPTE || !JETON || !BASE)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN et VIGIE_D1 sont requis (ou --dry)");
  }
  dire(`cible ${CIBLE} · index ${INDEX} · ${MAX_DOMAINES} domaine(s) au plus`);

  /*
    TROIS POPULATIONS, DANS CET ORDRE, ET LA PREMIERE EST LA PLUS PRECIEUSE.

    1. `candidats` en etat « mur » : des pages que le robot a essaye d'ouvrir et qui lui
       ont oppose un 403, un captcha ou un delai. Elles sont perdues pour lui a jamais,
       et Common Crawl les a peut-etre. C'est le seul moyen de les lire sans se faire
       passer pour quelqu'un d'autre.
    2. `candidats` en etat « attente » : pas encore essayees.
    3. Les domaines seulement ANNONCES, sans URL connue. La on ne peut que deviner, avec
       un motif filtre sur le nom de la marque : un annuaire nomme sa fiche d'apres le
       produit, donc `<domaine>/*tradoshi*` a de bonnes chances de tomber juste.
  */
  const marque = CIBLE.split(".")[0];
  let visees = [];

  if (DRY) {
    visees = (arg("test") || "https://saashub.com/tradoshi,https://betalist.com/startups/tradoshi")
      .split(",").map((u) => ({ motif: u.trim(), dom: u.replace(/^https?:\/\//, "").split("/")[0], quoi: "essai" }));
  } else {
    const murs = await sql(
      "SELECT url FROM candidats WHERE cible = ?1 AND etat = 'mur' ORDER BY ajoute_le DESC LIMIT ?2",
      [CIBLE, MAX_DOMAINES]
    );
    visees.push(...murs.map((l) => ({
      motif: l.url, dom: String(l.url).replace(/^https?:\/\//, "").split("/")[0], quoi: "mur",
    })));

    if (visees.length < MAX_DOMAINES) {
      const attente = await sql(
        "SELECT url FROM candidats WHERE cible = ?1 AND etat = 'attente' ORDER BY ajoute_le DESC LIMIT ?2",
        [CIBLE, MAX_DOMAINES - visees.length]
      );
      visees.push(...attente.map((l) => ({
        motif: l.url, dom: String(l.url).replace(/^https?:\/\//, "").split("/")[0], quoi: "attente",
      })));
    }

    if (visees.length < MAX_DOMAINES) {
      const annonces = await sql(
        `SELECT r.domaine_src FROM referents r
          WHERE r.cible = ?1
            AND NOT EXISTS (SELECT 1 FROM backlinks b
                             WHERE b.cible = r.cible AND b.domaine_src = r.domaine_src)
          ORDER BY r.vu_le DESC LIMIT ?2`,
        [CIBLE, MAX_DOMAINES - visees.length]
      );
      visees.push(...annonces.map((l) => ({
        motif: `${l.domaine_src}/*`, filtre: marque, dom: l.domaine_src, quoi: "annonce",
      })));
    }
  }

  const parQuoi = visees.reduce((a, v) => (a[v.quoi] = (a[v.quoi] || 0) + 1, a), {});
  dire(`${visees.length} cible(s) a lire dans l archive : ` +
    Object.entries(parQuoi).map(([k, v]) => `${v} ${k}`).join(", "));
  if (!visees.length) return;
  const candidats = visees;

  let lus = 0, confirmes = 0, sansTrace = 0, octetsTotal = 0;
  const aEcrire = [];

  for (const v of candidats) {
    const dom = v.dom;
    await dormir(ENTRE_APPELS);
    let emp;
    try { emp = await emplacements(v.motif, MAX_PAGES_PAR_DOMAINE, v.filtre || null); }
    catch (e) { dire(`  ${dom} : index illisible (${e.message})`); continue; }

    if (!emp.pages.length) {
      // ⛔ Absent de l'archive n'est PAS « pas de lien ». C'est une page que Common Crawl
      //    n'a pas visitee ce trimestre-la. On le compte a part, jamais en zero.
      sansTrace++;
      continue;
    }

    let trouvesIci = 0;
    for (const p of emp.pages) {
      await dormir(ENTRE_APPELS);
      let enr;
      try { enr = await lireEnregistrement(p); }
      catch (e) { dire(`  ${dom} : ${p.url.slice(0, 60)} illisible (${e.message})`); continue; }
      if (!enr) continue;
      lus++; octetsTotal += enr.octets;

      for (const l of liensVers(enr.html, CIBLE)) {
        trouvesIci++;
        aEcrire.push({
          cible: CIBLE, domaine_src: dom, url_src: p.url, url_dest: l.url_dest,
          ancre: l.ancre, rel: l.rel, rel_brut: l.rel_brut,
          // La date du CRAWL, pas celle d'aujourd'hui : c'est quand la page portait ce lien.
          vu_le: p.quand
            ? `${p.quand.slice(0,4)}-${p.quand.slice(4,6)}-${p.quand.slice(6,8)}T${p.quand.slice(8,10)}:${p.quand.slice(10,12)}:${p.quand.slice(12,14)}Z`
            : new Date().toISOString(),
        });
      }
    }
    if (trouvesIci) { confirmes++; dire(`  ✅ ${dom} : ${trouvesIci} lien(s) lu(s) dans l archive`); }
  }

  dire(`${lus} enregistrement(s) lu(s), ${(octetsTotal/1048576).toFixed(1)} Mo transferes`);
  dire(`${confirmes} domaine(s) CONFIRMES, ${aEcrire.length} lien(s) avec ancre et rel`);
  dire(`${sansTrace} domaine(s) absent(s) de cette edition de l archive (ce n est pas une absence de lien)`);

  if (DRY) { console.log(JSON.stringify(aEcrire.slice(0, 6), null, 2)); return; }
  if (!aEcrire.length) return;

  // ⛔ D1 n accepte que cent variables liees par requete : huit colonnes font douze lignes
  //    par lot, pas davantage.
  let ecrits = 0;
  for (let i = 0; i < aEcrire.length; i += 11) {
    const lot = aEcrire.slice(i, i + 11);
    const trous = lot.map(() => "(?, ?, ?, ?, ?, ?, ?, 'MESURE', ?, 'warc')").join(", ");
    const params = lot.flatMap((l) => [l.cible, l.domaine_src, l.url_src, l.url_dest, l.ancre, l.rel, l.rel_brut, l.vu_le]);
    await sql(
      `INSERT INTO backlinks (cible, domaine_src, url_src, url_dest, ancre, rel, rel_brut, etat, vu_le, source_donnee)
       VALUES ${trous}
       ON CONFLICT(cible, url_src, url_dest) DO UPDATE SET
         ancre = excluded.ancre, rel = excluded.rel, rel_brut = excluded.rel_brut,
         vu_le = excluded.vu_le, source_donnee = excluded.source_donnee`,
      params
    );
    ecrits += lot.length;
  }
  dire(`${ecrits} lien(s) ecrit(s) en base, desormais « lus » et plus « annonces »`);
}

main().catch((e) => { console.error("ECHEC :", e.message); process.exit(1); });
