// LES LIENS VUS PAR SEARCH CONSOLE, ET POURQUOI ON LES AJOUTE A CEUX DE BING.
//
// ⛔ LE PROBLEME QUE CE FICHIER REGLE, MESURE LE 21/08/2026. Le tableau de bord affichait
//    « Liens 11 » et cette ligne se lisait comme le nombre de backlinks du site. Ce n'en
//    etait pas un : c'etait la vue d'un SEUL index, Bing, et le plus etroit des trois.
//    L'exploitant du site savait de source sure qu'il en avait davantage, et il avait
//    raison.
//
// ⛔ LES INDEX DIVERGENT, ET AUCUN N'EST LE BON. Mesure du 16/08/2026 sur un meme domaine :
//    Search Console annoncait 24 liens sur 11 sites et OMETTAIT un dofollow, situe sur la
//    page partenaires d'un editeur, parfaitement crawlable et verifie dans le HTML brut.
//    Le verificateur gratuit d'Ahrefs voyait 240 domaines referents le meme jour. Bing en
//    voyait 8. Trois sources, trois chiffres, aucun total.
//    La seule phrase vraie est « AU MOINS N, vus par au moins une source ».
//
// Ce collecteur lit donc la troisieme source, celle de Google, et le site affiche
// ensuite l'UNION des trois, jamais leur somme (un meme domaine vu par deux sources ne
// fait pas deux domaines).
//
// ⛔ ET LE RAPPORT DE GOOGLE RESTE UN PLANCHER. Il est echantillonne et en retard. Toute
//    ligne qui en sort porte nature:"plancher" et s'affiche « au moins ». Ne jamais
//    conclure « ce lien n'existe pas » de son absence : le HTML de la page source
//    tranche, lui seul.
//
// Usage :
//   CDP_URL=http://127.0.0.1:9674 node outils/collecte-gsc-liens.mjs [--dry]

import { evaluer, assurer, patienter } from "./_cdp.mjs";
import { observation, ecrire, nouveauRun, config } from "./_lib-obs.mjs";

const VERSION = "collecte-gsc-liens@1.1.0";
const DRY = process.argv.includes("--dry");

const CDP = process.env.CDP_URL;
if (!CDP) {
  console.error(
    "CDP_URL est obligatoire.\n" +
    "  Lancez un Chrome dedie, sur un port dedie et un profil dedie, connectez-vous a\n" +
    "  Search Console, puis :\n" +
    "  CDP_URL=http://127.0.0.1:9674 node outils/collecte-gsc-liens.mjs"
  );
  process.exit(1);
}
const PORT = new URL(CDP).port;

const cfg = config();
const notre = cfg.nous.find((d) => d.gsc);
if (!notre) { console.error("aucun domaine avec propriete Search Console."); process.exit(1); }

const PROP = encodeURIComponent(notre.gsc);
// ⛔ LE BON ECRAN EST « type=DOMAIN », PAS « type=EXTERNAL ». EXTERNAL rend les PAGES
//    CIBLES de notre site (deux lignes), DOMAIN rend les SITES QUI NOUS LIENT (onze).
//    Confondre les deux fait conclure « deux sites nous lient » et c'est faux.
//    La page /links resumee, elle, ne montre que les CINQ premieres lignes de chaque
//    tableau : la lire donnerait 5 referents au lieu de 11.
const URL_SITES = `https://search.google.com/search-console/links/drilldown?resource_id=${PROP}&type=DOMAIN&target=&domain=`;
const MOTIF = "search-console/links";
const run = nouveauRun("gsc-liens");

console.log(`Vigie SEO — liens vus par Search Console · ${notre.domaine}${DRY ? " · --dry" : ""}`);
console.log(`Chrome pilote : ${CDP}`);

await assurer(PORT, MOTIF, URL_SITES);
await evaluer(PORT, MOTIF, `location.assign(${JSON.stringify(URL_SITES)});'ok'`, { urlSecours: URL_SITES });

// L'ecran charge son tableau par paquets : on attend qu'il cesse de grandir.
let lignesBrutes = [];
let stable = 0;
for (let i = 0; i < 14; i++) {
  await patienter(2500);
  let json;
  try {
    json = await evaluer(PORT, MOTIF, `(function(){
      window.scrollTo(0, document.body.scrollHeight);
      var t = document.querySelector('table');
      if (!t) return JSON.stringify([]);
      return JSON.stringify([].slice.call(t.querySelectorAll('tr')).map(function (y) {
        return [].slice.call(y.querySelectorAll('td,th')).map(function (c) { return (c.innerText || '').trim(); });
      }));
    })()`, { urlSecours: URL_SITES });
  } catch { continue; }
  const l = JSON.parse(json);
  if (l.length === lignesBrutes.length && l.length > 1) { if (++stable >= 2) break; } else stable = 0;
  lignesBrutes = l;
}

const obs = [];
const referents = new Map();

// ⛔ On reconnait une ligne a sa FORME (un domaine puis un nombre), jamais a sa position.
//    La mise en page de Search Console change sans prevenir, et un decoupage par numero
//    de ligne se casserait en silence en rendant zero referent.
for (const c of lignesBrutes) {
  if (c.length < 2) continue;
  const dom = String(c[0]).toLowerCase().replace(/^www\./, "").trim();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(dom)) continue;
  if (dom === notre.domaine) continue;
  const n = Number(String(c[1]).replace(/\s| /g, ""));
  if (!Number.isFinite(n)) continue;
  referents.set(dom, Math.max(referents.get(dom) || 0, n));
}

const total = [...referents.values()].reduce((a, b) => a + b, 0);

for (const [dom, n] of referents) {
  obs.push(observation({
    type: "backlink",
    sujet: { domaine: notre.domaine },
    objet: { domaine: dom },
    metrique: "liens_depuis_domaine",
    valeur: n, unite: "lien",
    // ⛔ « plancher » et pas « mesure » : le rapport est echantillonne. Le 16/08 il
    //    omettait un dofollow parfaitement crawlable.
    nature: "plancher", etat: "MESURE",
    valeur_min: n, valeur_max: null,
    source: { nom: "search_console", endpoint: "search-console/links", http: 200, methode: "cdp" },
    preuve: `${dom} -> ${notre.domaine} : ${n} lien(s) vus par Google. Rapport ECHANTILLONNE : c'est un plancher`,
    run_id: run, collecteur: VERSION,
    drapeaux: ["plancher_search_console", "granularite_domaine_sans_url_ni_rel"],
  }));
}

obs.push(observation({
  type: "backlink", sujet: { domaine: notre.domaine }, metrique: "domaines_referents",
  valeur: referents.size, unite: "domaine", nature: "plancher", etat: "MESURE",
  valeur_min: referents.size, valeur_max: null,
  source: { nom: "search_console", endpoint: "search-console/links", http: 200, methode: "cdp" },
  // ⛔ La preuve part dans CHAQUE ligne du journal, et un journal se partage. Elle nomme
  //    donc la mesure, jamais le domaine qui l'a subie.
  preuve: `${referents.size} site(s) referent(s) lus dans le rapport Liens. PLANCHER : le 16/08/2026 ce rapport omettait un dofollow pose sur la page partenaires d'un editeur, parfaitement crawlable et verifie dans le HTML brut`,
  run_id: run, collecteur: VERSION, drapeaux: ["plancher_search_console"],
}));
obs.push(observation({
  type: "backlink", sujet: { domaine: notre.domaine }, metrique: "liens_totaux",
  valeur: total, unite: "lien", nature: "plancher", etat: "MESURE",
  valeur_min: total, valeur_max: null,
  source: { nom: "search_console", endpoint: "search-console/links", http: 200, methode: "cdp" },
  preuve: `somme des liens par site referent, rapport echantillonne`,
  run_id: run, collecteur: VERSION, drapeaux: ["plancher_search_console"],
}));

console.log(`${referents.size} site(s) referent(s), ${total} lien(s) au total, vus par Google.`);
[...referents.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([d, n]) => console.log(`  ${String(n).padStart(4)}  ${d}`));
if (!referents.size) {
  console.log("\n⚠ Aucun referent extrait. La mise en page de l ecran a peut-etre change.");
  console.log("  Extrait de ce qui a ete lu :");
  console.log(lignes.slice(0, 25).map((l) => "    " + l.slice(0, 70)).join("\n"));
}

console.log(DRY
  ? `\n--dry : ${obs.length} observations NON ecrites.`
  : `\n${ecrire(obs)} observation(s) ecrite(s) (${obs.length} calculee(s)).`);
