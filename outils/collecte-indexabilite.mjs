// PART D'URL INDEXABLES, MESUREE SUR UN ECHANTILLON DU SITEMAP.
//
// A quoi ca sert : l'axe « couverture » de la note maison a besoin de savoir si les pages
// declarees au sitemap sont reellement indexables. Sans cette mesure, l'axe reste en
// angle mort MEME quand le nombre d'URL est parfaitement connu, et le domaine ne se
// classe pas. Ce n'est pas un detail de forme : un concurrent qui declare 2 000 pages
// dont la moitie porte un noindex n'a pas la couverture qu'il affiche.
//
// ⛔ CE QU'ON MESURE, ET SURTOUT CE QU'ON NE MESURE PAS. On mesure l'INDEXABILITE : la
//    page est-elle autorisee au crawl et depourvue de noindex. On NE mesure PAS
//    l'INDEXATION, c'est-a-dire la presence effective dans l'index de Google, qui n'est
//    lisible par aucun appel HTTP gratuit sur un domaine tiers (cinq moteurs testes le
//    21/08/2026, cinq murs : page-relais JS chez Google, operateur site: ignore par Bing,
//    captcha au deuxieme appel chez DuckDuckGo, captcha chez Mojeek, preuve de travail
//    chez Startpage). Le libelle affiche « indexable », jamais « indexee ».
//
// ⛔ UN 403 N'EST PAS UN noindex. C'est un mur, donc un angle mort, et l'URL SORT de
//    l'echantillon au lieu d'y compter comme non indexable. Compter un mur comme un
//    noindex ferait chuter la couverture d'un concurrent pour une raison qui ne le
//    concerne pas, et la note deviendrait un thermometre de nos propres blocages.
//
// ⛔ L'ECHANTILLON EST REPARTI SUR TOUT LE SITEMAP, jamais les N premieres URL. Les
//    premieres lignes d'un sitemap sont presque toujours la page d'accueil et les pages
//    legales, qui ne representent rien du corps du site.
//
// Usage :
//   node outils/collecte-indexabilite.mjs [--domaines=a,b] [--taille=15] [--dry]

import { recupererFiable, indexabilite, robots } from "./_lib-liens.mjs";
import { observation, ecrire, nouveauRun, config, lire, dernier } from "./_lib-obs.mjs";

const VERSION = "collecte-indexabilite@1.0.0";
const arg = (n, d = null) => {
  const v = (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  return v === undefined ? d : v;
};
const DRY = process.argv.includes("--dry");
const TAILLE = Number(arg("taille", 15));

const cfg = config();
const demandes = arg("domaines");
const cibles = demandes
  ? demandes.split(",").map((s) => s.trim())
  : [...cfg.nous.map((d) => d.domaine), ...cfg.concurrents.map((d) => d.domaine)];

const { obs: toutes } = lire();
const photo = dernier(toutes);

/** Recupere des URL du sitemap, en descendant les index de sitemaps. */
async function urlsDuSitemap(domaine, n) {
  const rb = await robots(domaine);
  const depart = rb.sitemaps?.length ? rb.sitemaps.slice(0, 3) : [`https://${domaine}/sitemap.xml`];
  const vues = new Set();
  const urls = [];
  const file = [...depart];
  let lus = 0;
  while (file.length && urls.length < n * 6 && lus < 6) {
    const u = file.shift();
    if (vues.has(u)) continue;
    vues.add(u);
    const r = await recupererFiable(u, { timeout: 20000 }, 2);
    lus++;
    if (!r.ok || r.http !== 200) continue;
    const estIndex = /<sitemapindex/i.test(r.html);
    for (const m of r.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const v = m[1].replace(/&amp;/g, "&");
      if (estIndex) { if (file.length < 6) file.push(v); }
      else if (urls.length < n * 6) urls.push(v);
    }
  }
  if (urls.length <= n) return { urls, rb };
  const pas = urls.length / n;
  return { urls: Array.from({ length: n }, (_, i) => urls[Math.floor(i * pas)]), rb };
}

/** Le robots.txt interdit-il ce chemin ? Lecture volontairement simple et PRUDENTE. */
function interditPar(texteRobots, url) {
  if (!texteRobots) return false;
  let chemin;
  try { chemin = new URL(url).pathname; } catch { return false; }
  const bloc = /user-agent:\s*\*([\s\S]*?)(?=\nuser-agent:|$)/i.exec(texteRobots);
  if (!bloc) return false;
  for (const m of bloc[1].matchAll(/^\s*disallow:\s*(\S+)\s*$/gim)) {
    const motif = m[1];
    if (motif === "/") return true;
    // ⛔ On ne gere que le prefixe simple, sans joker. En cas de doute on repond NON :
    //    un faux « interdit » ferait chuter la couverture d'un concurrent a tort, et une
    //    note faussement basse est plus dangereuse qu'une note absente.
    if (!motif.includes("*") && chemin.startsWith(motif)) return true;
  }
  return false;
}

const run = nouveauRun("indexabilite");
console.log(`Vigie SEO — indexabilite · ${cibles.length} domaine(s) · echantillon de ${TAILLE} URL${DRY ? " · --dry" : ""}\n`);

const sortie = [];
for (const d of cibles) {
  // Si collecte-domaine a deja constate qu'aucun sitemap n'est lisible, on ne refait pas
  // le mur : on ecrit l'angle mort en citant sa cause, et on passe.
  const nbUrl = photo.find((o) => o.sujet?.domaine === d && o.metrique === "nb_url_sitemap");
  if (nbUrl && nbUrl.etat === "ANGLE_MORT") {
    sortie.push(observation({
      type: "couverture", sujet: { domaine: d }, metrique: "part_url_indexables",
      etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "echantillon_sitemap", endpoint: `https://${d}/sitemap.xml`, http: null, methode: "http" },
      preuve: `sitemap deja en angle mort a la collecte precedente : ${String(nbUrl.preuve).slice(0, 180)}`,
      run_id: run, collecteur: VERSION, drapeaux: ["sitemap_illisible"],
    }));
    console.log(`  ${d.padEnd(24)} ▲ sitemap illisible, rien a echantillonner`);
    continue;
  }

  const { urls, rb } = await urlsDuSitemap(d, TAILLE);
  if (!urls.length) {
    sortie.push(observation({
      type: "couverture", sujet: { domaine: d }, metrique: "part_url_indexables",
      etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "echantillon_sitemap", endpoint: `https://${d}/sitemap.xml`, http: rb.http, methode: "http" },
      preuve: `aucune URL extraite du sitemap (robots.txt HTTP ${rb.http})`,
      run_id: run, collecteur: VERSION, drapeaux: ["sitemap_illisible"],
    }));
    console.log(`  ${d.padEnd(24)} ▲ aucune URL extraite`);
    continue;
  }

  let indexables = 0, murs = 0, lues = 0;
  const detail = [];
  for (const u of urls) {
    if (interditPar(rb.texte, u)) { lues++; detail.push("robots"); continue; }  // vraie mesure : interdit
    const r = await recupererFiable(u, { timeout: 15000 }, 2);
    if (!r.ok || r.http >= 400) { murs++; detail.push(String(r.http || "reseau")); continue; }
    lues++;
    const ix = indexabilite(r.html, r.enTetes);
    if (ix.indexable) { indexables++; detail.push("ok"); } else detail.push("noindex");
    await new Promise((s) => setTimeout(s, 400));
  }

  if (!lues) {
    sortie.push(observation({
      type: "couverture", sujet: { domaine: d }, metrique: "part_url_indexables",
      etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "echantillon_sitemap", endpoint: `https://${d}/`, http: null, methode: "http" },
      preuve: `${urls.length} URL tentees, aucune lisible (${murs} mur(s)). Ce n est PAS zero page indexable, c est zero page LUE`,
      run_id: run, collecteur: VERSION, drapeaux: ["echantillon_mur"],
    }));
    console.log(`  ${d.padEnd(24)} ▲ ${urls.length} URL tentees, ${murs} mur(s), rien de lisible`);
    continue;
  }

  const part = indexables / lues;
  sortie.push(observation({
    type: "couverture", sujet: { domaine: d }, metrique: "part_url_indexables",
    valeur: Math.round(part * 1000) / 1000, unite: "part",
    nature: "mesure", etat: "MESURE",
    source: { nom: "echantillon_sitemap", endpoint: `https://${d}/`, http: 200, methode: "http" },
    preuve: `${indexables} indexables sur ${lues} URL lues (echantillon de ${urls.length} reparti sur tout le sitemap, ${murs} mur(s) ecarte(s)) : ${detail.slice(0, 15).join(",")}`,
    run_id: run, collecteur: VERSION,
    drapeaux: murs ? ["echantillon_partiel"] : [],
  }));
  sortie.push(observation({
    type: "couverture", sujet: { domaine: d }, metrique: "taille_echantillon_indexabilite",
    valeur: lues, unite: "url", nature: "mesure", etat: "MESURE",
    source: { nom: "echantillon_sitemap", endpoint: `https://${d}/`, http: 200, methode: "http" },
    preuve: `${lues} URL lues, ${murs} ecartee(s) pour mur`,
    run_id: run, collecteur: VERSION,
  }));
  console.log(`  ${d.padEnd(24)} ${String(Math.round(part * 100)).padStart(3)} % indexables (${indexables}/${lues}${murs ? `, ${murs} mur(s)` : ""})`);
}

console.log(DRY
  ? `\n--dry : ${sortie.length} observations NON ecrites.`
  : `\n${ecrire(sortie)} observation(s) ecrite(s) (${sortie.length} calculee(s)).`);
