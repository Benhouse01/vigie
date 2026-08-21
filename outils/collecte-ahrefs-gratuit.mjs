// LE VERIFICATEUR DE BACKLINKS GRATUIT D'AHREFS, ET POURQUOI IL CHANGE TOUT.
//
// ⛔ CE QU'IL CORRIGE, ET C'EST UN GROS ECART. Mesure du 21/08/2026, sur un domaine reel :
//    le tableau annoncait « 15 domaines referents », l'union de ce que voyaient Bing (8)
//    et Search Console (11). Le verificateur gratuit d'Ahrefs, interroge le meme jour sur
//    le meme domaine, en comptait **281 backlinks** et **250 sites referents**, DR 25.
//    Un facteur SEIZE avec ce qui etait affiche. Ni Bing ni Google ne mentaient : ils ne
//    montrent qu'une partie, et le tort etait de presenter cette partie comme le tout.
//
// ⛔ ET LES POURCENTAGES COMPTENT PLUS QUE LES TOTAUX : 11 % des backlinks et 8 % des
//    sites referents sont en dofollow. 250 sites, c'est donc une vingtaine de domaines
//    qui transmettent, et 230 qui ne transmettent rien. Un compte de backlinks sans son
//    taux de dofollow ne dit presque rien.
//
// ⛔ CE QU'IL DONNE EN PLUS, ET QUI VAUT AUTANT QUE LES CHIFFRES : les URL EXACTES de
//    quelques pages qui vous lient. C'est ce qui debloque la qualification du rel.
//    Le collecteur de rel, sans elles, ne fait que DEVINER des chemins probables
//    (/partners/, /blog/, le sitemap). Sur un fil de forum, dont l'URL ressemble a
//    forum-exemple.org/index.php?topic=5519917.2580 (domaine d'exemple), aucun chemin
//    devine ne tombe juste. Mesure du 21/08/2026 : un lien de cette forme ressortait
//    « non qualifie » alors qu'il etait parfaitement dofollow, sans aucun rel, sur une
//    page indexable, verifie dans le HTML servi.
//    Ces URL sont donc ecrites comme « page_portante_connue » et collecte-rel les lit.
//
// ⛔ TROISIEME INDEX, TROISIEME CHIFFRE, TOUJOURS PAS DE TOTAL. Ahrefs a le deuxieme
//    robot le plus actif du web apres Google, donc c'est le plus large des trois, mais
//    « le plus large » n'est pas « exhaustif ». Chaque ligne porte sa source.
//
// ⛔ L'OUTIL GRATUIT NE SE PILOTE PAS PAR SON API : `stGetFreeBacklinksOverview` rend
//    200 avec `["Error",["InvalidCaptcha"]]`. Il faut un vrai navigateur, et c'est
//    pour ca que ce collecteur passe par CDP.
//
// Usage :
//   CDP_URL=http://127.0.0.1:9674 node outils/collecte-ahrefs-gratuit.mjs
//   ... --domaines=exemple.com,concurrent-un.com   --pause=9000   --dry
//
// Sans --domaines, les cibles sont les domaines de role « nous » puis « concurrent »
// de config/domaines.json. Le port ci-dessus n'est qu'un exemple : prenez le votre.

import { evaluer, assurer, patienter } from "./_cdp.mjs";
import { observation, ecrire, nouveauRun, config } from "./_lib-obs.mjs";

const VERSION = "collecte-ahrefs-gratuit@1.0.0";
const PAGE = "https://ahrefs.com/backlink-checker/";
const MOTIF = "ahrefs.com/backlink-checker";

const CDP = process.env.CDP_URL;
if (!CDP) {
  console.error(
    "CDP_URL est obligatoire.\n" +
    "  Prenez un port DEDIE avec son propre profil : le verificateur d'Ahrefs limite par\n" +
    "  adresse IP, et deux scripts sur le meme Chrome se volent les onglets.\n" +
    "  CDP_URL=http://127.0.0.1:9674 node outils/collecte-ahrefs-gratuit.mjs\n" +
    "  Voir docs/bing.md pour la ligne de lancement complete du navigateur."
  );
  process.exit(1);
}
const PORT = new URL(CDP).port;

const arg = (n, d = null) => {
  const v = (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  return v === undefined ? d : v;
};
const DRY = process.argv.includes("--dry");
const PAUSE = Number(arg("pause", 9000));

const cfg = config();
const demandes = arg("domaines");
const cibles = demandes
  ? demandes.split(",").map((s) => s.trim())
  : [...cfg.nous.map((d) => d.domaine), ...cfg.concurrents.map((d) => d.domaine)];

const run = nouveauRun("ahrefs");
console.log(`Vigie SEO — verificateur gratuit d'Ahrefs · ${cibles.length} domaine(s)${DRY ? " · --dry" : ""}`);
console.log(`Chrome dedie : ${CDP}\n`);

await assurer(PORT, MOTIF, PAGE);

// Le bandeau de cookies masque le formulaire tant qu'il n'est pas ferme. Une fois.
await evaluer(PORT, MOTIF, `(function(){
  var b = [].slice.call(document.querySelectorAll('button,a')).filter(function (e) {
    return /accept all/i.test(e.innerText || '');
  })[0];
  if (b) { b.click(); return 'cookies acceptes'; }
  return 'pas de bandeau';
})()`, { urlSecours: PAGE });
await patienter(1500);

/** Lance une verification et rend le texte de la fenetre de resultat. */
async function verifier(domaine) {
  // ⛔ PAS BESOIN DE REMPLIR LE FORMULAIRE : le parametre `input` de l'URL ouvre la
  //    fenetre de resultat tout seul, une fois le bandeau de cookies accepte. Remplir le
  //    champ et cliquer marchait aussi, mais ajoutait deux points de casse pour rien.
  const url = `${PAGE}?input=${encodeURIComponent(domaine)}&mode=subdomains`;
  await evaluer(PORT, MOTIF, `location.assign(${JSON.stringify("URL_ICI")});'ok'`.replace("URL_ICI", url), { urlSecours: url });
  await patienter(3000);

  // La fenetre de resultat met quelques secondes. On attend qu'elle porte son titre.
  for (let i = 0; i < 14; i++) {
    await patienter(2000);
    const t = await evaluer(PORT, MOTIF, `(function(){
      var t = document.body.innerText;
      var i = t.indexOf('Backlink profile for');
      return i < 0 ? '' : t.slice(i, i + 2600);
    })()`, { urlSecours: PAGE });
    if (t && /Linking websites/i.test(t)) return { ok: true, texte: t };
  }
  return { ok: false, raison: "la fenetre de resultat n'est pas apparue (limite d'adresse IP ou captcha)" };
}

/**
 * Les URL EXACTES des pages qui lient la cible, lues dans le tableau d'exemple.
 *
 * ⛔ ON VISE LE TABLEAU, JAMAIS « TOUS LES LIENS DE LA PAGE ». Premiere version : elle
 *    prenait tous les a[href^=http] hors ahrefs.com, et a ramene letaido.com,
 *    firehose.com, ahrefsevolve.com et wordcount.com, c'est-a-dire les liens PROMO
 *    d'Ahrefs vers ses propres produits, qui ne portent pas son nom de domaine. Douze
 *    URL par domaine, aucune vraie. Un filtre par liste noire ne tient pas : il faut
 *    partir de la STRUCTURE, ici la ligne du tableau dont l'en-tete dit « Referring page ».
 * ⛔ Et dans une ligne, le PREMIER lien est la page referente, les suivants pointent vers
 *    la cible : on ne garde que le premier, et on jette tout ce qui pointe vers la cible.
 */
async function pagesExemple(domaine) {
  const json = await evaluer(PORT, MOTIF, `(function(){
    var tables = [].slice.call(document.querySelectorAll('table'));
    var t = tables.filter(function (x) { return /Referring page/i.test(x.innerText || ''); })[0];
    if (!t) return JSON.stringify([]);
    var out = [], vus = {};
    var rows = [].slice.call(t.querySelectorAll('tr')).slice(1);
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i].querySelector('a[href^="http"]');
      if (!a) continue;
      var h = a.href;
      if (h.indexOf(${JSON.stringify(domaine)}) >= 0) continue;
      if (/ahrefs|letaido|firehose|wordcount/i.test(h)) continue;
      if (vus[h]) continue; vus[h] = 1;
      out.push({ url: h, texte: (a.innerText || '').trim().slice(0, 90) });
    }
    return JSON.stringify(out.slice(0, 10));
  })()`, { urlSecours: PAGE });
  try { return JSON.parse(json); } catch { return []; }
}

const nombre = (s) => {
  if (s == null) return null;
  // Ahrefs abrege : 4.2K, 1.3M. Un parseFloat nu rendrait 4 et 1.
  const m = /^([\d.,]+)\s*([KMB])?$/i.exec(String(s).trim());
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
  return Math.round(n * mult);
};

const obs = [];
let dejaEcrites = 0;
for (const d of cibles) {
  process.stdout.write(`  ${d.padEnd(24)}`);
  let r;
  try { r = await verifier(d); } catch (e) { r = { ok: false, raison: String(e.message).slice(0, 90) }; }

  if (!r.ok) {
    // ⛔ Un refus d'Ahrefs n'est pas « zero backlink ». C'est un angle mort.
    for (const m of ["domaines_referents", "liens_totaux", "domain_rating"]) {
      obs.push(observation({
        type: m === "domain_rating" ? "autorite" : "backlink",
        sujet: { domaine: d }, metrique: m,
        etat: "ANGLE_MORT", nature: "mesure_absente",
        source: { nom: "ahrefs_gratuit", endpoint: PAGE, http: null, methode: "cdp" },
        preuve: r.raison, run_id: run, collecteur: VERSION, drapeaux: ["ahrefs_refuse"],
      }));
    }
    if (!DRY) { ecrire(obs.slice(dejaEcrites)); dejaEcrites = obs.length; }
    console.log(`▲ ${String(r.raison).slice(0, 60)}`);
    await patienter(PAUSE);
    continue;
  }

  const t = r.texte;
  const dr = nombre((/Domain Rating\s*\n\s*([\d.,KMB]+)/i.exec(t) || [])[1]);
  const bl = nombre((/Backlinks\s*\n\s*([\d.,KMB]+)/i.exec(t) || [])[1]);
  const blDf = parseFloat((/Backlinks[\s\S]{0,40}?([\d.]+)\s*%\s*dofollow/i.exec(t) || [])[1]);
  const ls = nombre((/Linking websites\s*\n\s*([\d.,KMB]+)/i.exec(t) || [])[1]);
  const lsDf = parseFloat((/Linking websites[\s\S]{0,40}?([\d.]+)\s*%\s*dofollow/i.exec(t) || [])[1]);

  const src = { nom: "ahrefs_gratuit", endpoint: PAGE, http: 200, methode: "cdp" };
  const pousse = (type, metrique, valeur, unite, preuve, drapeaux = []) => {
    if (valeur == null || Number.isNaN(valeur)) return;
    obs.push(observation({
      type, sujet: { domaine: d }, metrique, valeur, unite,
      // ⛔ « plancher » : le plus large des index n'est pas l'exhaustivite.
      nature: "plancher", etat: "MESURE", valeur_min: valeur,
      source: src, preuve, run_id: run, collecteur: VERSION,
      drapeaux: ["index_ahrefs", ...drapeaux],
    }));
  };
  pousse("backlink", "domaines_referents", ls, "domaine",
    `${ls} sites referents vus par Ahrefs, dont ${lsDf} % en dofollow. Ahrefs a le deuxieme robot le plus actif du web, c'est le plus large de nos index, ce n'est pas pour autant un total`);
  pousse("backlink", "liens_totaux", bl, "lien",
    `${bl} backlinks vus par Ahrefs, dont ${blDf} % en dofollow`);
  pousse("autorite", "domain_rating", dr, "point",
    `Domain Rating ${dr} sur 100, metrique proprietaire d'Ahrefs calculee sur le VOLUME de liens. Affichee pour memoire, elle n'entre PAS dans notre note`);
  if (Number.isFinite(lsDf)) {
    obs.push(observation({
      type: "backlink", sujet: { domaine: d }, metrique: "part_domaines_dofollow",
      valeur: lsDf / 100, unite: "part", nature: "estimation", etat: "MESURE",
      source: src,
      preuve: `${lsDf} % des ${ls} sites referents transmettent, soit environ ${Math.round((ls * lsDf) / 100)} domaine(s). Les ${100 - lsDf} % restants ne transmettent rien`,
      run_id: run, collecteur: VERSION, drapeaux: ["index_ahrefs"],
    }));
  }

  // Les pages d'exemple : peu nombreuses, mais ce sont des URL EXACTES, et une URL
  // exacte vaut mieux que dix chemins devines.
  const pages = await pagesExemple(d);
  let gardees = 0;
  for (const p of pages) {
    let hote;
    try { hote = new URL(p.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { continue; }
    if (hote.endsWith("ahrefs.com")) continue;
    gardees++;
    obs.push(observation({
      type: "backlink", sujet: { domaine: d }, objet: { domaine: hote, url: p.url },
      metrique: "page_portante_connue",
      valeur: 1, unite: "page", nature: "mesure", etat: "MESURE",
      source: src,
      preuve: `URL exacte donnee par Ahrefs : ${p.url.slice(0, 200)}`,
      run_id: run, collecteur: VERSION,
      drapeaux: ["url_exacte_a_qualifier"],
    }));
  }

  // ⛔ ON POSE CE QU'ON A DES QU'ON L'A. Un collecteur qui garde tout en memoire jusqu'a
  //    la derniere ligne perd la totalite de sa passe si le moteur coupe au milieu, et
  //    Ahrefs limite par adresse IP au bout de quelques verifications.
  if (!DRY) { ecrire(obs.slice(dejaEcrites)); dejaEcrites = obs.length; }

  console.log(`DR ${String(dr ?? "?").padStart(3)} · ${String(ls ?? "?").padStart(5)} sites (${lsDf ?? "?"} % df) · ${String(bl ?? "?").padStart(6)} liens · ${gardees} URL exacte(s)`);
  await patienter(PAUSE);
}

console.log(DRY
  ? `\n--dry : ${obs.length} observations NON ecrites.`
  : `\n${ecrire(obs)} observation(s) ecrite(s) (${obs.length} calculee(s)).`);
