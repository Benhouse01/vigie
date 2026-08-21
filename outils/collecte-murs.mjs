// LES PAGES QUI REFUSENT curl, LUES DANS UN VRAI NAVIGATEUR.
//
// ⛔ CE QU'IL REGLE. Une colonne « non qualifie » ne decrit pas un lien, elle decrit
//    NOTRE echec a le lire : un lien porte toujours un attribut rel, ou n'en porte pas,
//    donc il est forcement dofollow, nofollow, sponsored ou ugc.
//    Et la cause de cet echec est presque toujours la meme : un pare-feu applicatif rend
//    403 a curl et 200 a un navigateur. Mesure du 21/08/2026, sur les referents d'un
//    domaine reel : quatre sites (un annuaire de societes, un reseau professionnel, un
//    annuaire de logiciels, une plateforme communautaire) repondaient tous 403 en HTTP
//    direct, et tous se lisaient parfaitement dans un vrai navigateur.
//
// ⛔ CE QUE CE COLLECTEUR NE FAIT PAS : inventer un verdict. Une page derriere un login,
//    un robots.txt qui interdit tout, une page qui n'existe plus : ca reste un angle mort,
//    et ca s'affiche comme tel. On lit mieux, on ne devine pas mieux.
//
// ⛔ ET IL RESPECTE robots.txt AVANT DE LIRE. Un navigateur ne dispense pas de la regle.
//    Certains tres gros sites, dont plusieurs reseaux sociaux, servent un « Disallow: / »
//    integral : on ne les lira pas, et on ecrit pourquoi au lieu d'ecrire un zero.
//
// Usage :
//   CDP_URL=http://127.0.0.1:9674 node outils/collecte-murs.mjs
//   ... --cible=exemple.com   --urls=https://a/b,https://c/d   --dry
//
// Le port ci-dessus n'est qu'un exemple : prenez le votre. Sans --cible, la cible est le
// premier domaine de role « nous » de config/domaines.json.

import { evaluer, assurer, patienter } from "./_cdp.mjs";
import { robots } from "./_lib-liens.mjs";
import { observation, ecrire, nouveauRun, lire, dernier, config } from "./_lib-obs.mjs";

const VERSION = "collecte-murs@1.0.0";

// ⛔ Un port CDP ecrit en dur est le mecanisme exact par lequel un script vient travailler
//    sur l'onglet d'un autre outil et lui vole sa navigation. On EXIGE la variable, on ne
//    devine pas, et on prend un port DEDIE avec un profil DEDIE.
const CDP = process.env.CDP_URL;
if (!CDP) {
  console.error(
    "CDP_URL est obligatoire.\n" +
    "  Lancez un Chrome dedie, sur un port dedie et avec son propre profil, puis :\n" +
    "  CDP_URL=http://127.0.0.1:9674 node outils/collecte-murs.mjs\n" +
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

/**
 * ⛔ LA CIBLE PAR DEFAUT VIENT DE LA CONFIGURATION, JAMAIS D'UNE CONSTANTE. Un domaine
 *    ecrit en dur dans un fichier partage y laisse le site de celui qui a ecrit le
 *    fichier, et tout le monde finit par qualifier les liens de quelqu'un d'autre sans
 *    s'en apercevoir : le collecteur tourne, il ecrit des lignes, elles sont juste vides.
 */
function cibleParDefaut() {
  const d = config().nous?.[0]?.domaine;
  if (!d) {
    console.error(
      "aucun domaine en role « nous » dans la configuration.\n" +
      "  Indiquez la cible avec --cible=exemple.com, ou ajoutez votre domaine dans\n" +
      "  config/domaines.json (voir config/domaines.exemple.json)."
    );
    process.exit(1);
  }
  return d;
}
const CIBLE = arg("cible") || cibleParDefaut();

// Les URL a essayer pour un domaine referent : celles qu'on connait deja, puis les
// chemins usuels des annuaires de produits, ou vivent presque toujours les fiches
// qu'on cherche.
const CHEMINS = (d, marque) => [
  `https://${d}/`,
  `https://${d}/${marque}`,
  `https://${d}/software/${marque}`,
  `https://${d}/product/${marque}`,
  `https://${d}/products/${marque}`,
  `https://${d}/startup/${marque}`,
  `https://${d}/startups/${marque}`,
  `https://${d}/organization/${marque}`,
  `https://${d}/apps/${marque}`,
  `https://${d}/tools/${marque}`,
  `https://${d}/@${marque}`,
];

const { obs: toutes } = lire();
const photo = dernier(toutes);
const marque = CIBLE.split(".")[0];

/** Les referents connus de la cible, avec l'etat de leur qualification. */
function aReprendre() {
  const forcees = arg("urls");
  if (forcees) return forcees.split(",").map((u) => ({ url: u.trim(), domaine: new URL(u.trim()).hostname.replace(/^www\./, "") }));

  const qualifies = new Set(
    photo.filter((o) => o.metrique === "lien_qualifie" && o.sujet?.domaine === CIBLE).map((o) => o.objet?.domaine)
  );
  const referents = new Set(
    photo.filter((o) => o.metrique === "liens_depuis_domaine" && o.sujet?.domaine === CIBLE && o.objet?.domaine)
      .map((o) => o.objet.domaine)
  );
  // Les URL exactes qu'on connait deja passent en tete.
  const connues = new Map();
  for (const o of photo) {
    if (o.sujet?.domaine !== CIBLE) continue;
    const u = o.objet?.url;
    if (!u || !/^https?:/i.test(u)) continue;
    if (!connues.has(o.objet.domaine)) connues.set(o.objet.domaine, []);
    connues.get(o.objet.domaine).push(u);
  }
  return [...referents].filter((d) => !qualifies.has(d)).map((d) => ({ domaine: d, urls: connues.get(d) || null }));
}

const EXTRACTION = (cible) => `(function(){
  var out = [];
  var liens = document.querySelectorAll('a[href]');
  for (var i = 0; i < liens.length; i++) {
    var h = liens[i].getAttribute('href') || '';
    if (h.toLowerCase().indexOf(${JSON.stringify(cible)}) < 0) continue;
    // ⛔ On lit l'attribut TEL QU'IL EST DANS LE DOM. getAttribute et pas la propriete :
    //    relList normaliserait, et on veut la chaine servie.
    var rel = liens[i].getAttribute('rel');
    var txt = (liens[i].innerText || liens[i].textContent || '').replace(/\\s+/g, ' ').trim();
    out.push({ url: h, rel: rel, ancre: txt.slice(0, 160) });
  }
  var meta = document.querySelector('meta[name="robots"]');
  return JSON.stringify({
    url: location.href,
    titre: (document.title || '').slice(0, 120),
    metaRobots: meta ? meta.getAttribute('content') : null,
    liens: out.slice(0, 25),
    octets: document.documentElement.outerHTML.length,
  });
})()`;

const run = nouveauRun("murs");
const liste = aReprendre();
console.log(`Vigie SEO — lecture des murs, dans un navigateur · cible ${CIBLE}`);
console.log(`${liste.length} domaine(s) a reprendre${DRY ? " · --dry" : ""}\n`);

const obs = [];
let dejaEcrites = 0;

for (const item of liste) {
  const d = item.domaine;
  process.stdout.write(`  ${d.padEnd(26)}`);

  // ⛔ robots.txt d'abord. Un navigateur ne dispense pas de la regle.
  const rb = await robots(d);
  if (rb.bloqueTout) {
    obs.push(observation({
      type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: d },
      metrique: "page_portante", etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "navigateur", endpoint: `https://${d}/robots.txt`, http: rb.http, methode: "cdp" },
      preuve: `robots.txt interdit tout crawl (Disallow: / sous User-agent: *). On ne lira pas ce domaine, meme au navigateur : ce serait desobeir a une regle qu'on affiche par ailleurs`,
      run_id: run, collecteur: VERSION, drapeaux: ["robots_txt_interdit_tout"],
    }));
    console.log("robots.txt interdit tout crawl");
    continue;
  }

  const candidats = item.urls?.length ? item.urls : CHEMINS(d, marque);
  let trouve = null;
  const essais = [];

  for (const u of candidats.slice(0, 11)) {
    let brut;
    try {
      await evaluer(PORT, "about:blank", "1", { urlSecours: "about:blank" }).catch(() => {});
      await assurer(PORT, u.slice(0, 40), u);
      await evaluer(PORT, u.slice(8, 40), `location.assign(${JSON.stringify(u)});'ok'`, { urlSecours: u });
      await patienter(3800);
      brut = await evaluer(PORT, u.slice(8, 40), EXTRACTION(CIBLE), { urlSecours: u });
    } catch (e) {
      essais.push(`${u.slice(0, 50)} -> ${String(e.message).slice(0, 40)}`);
      continue;
    }
    let r;
    try { r = JSON.parse(brut); } catch { essais.push(`${u.slice(0, 50)} -> reponse illisible`); continue; }
    essais.push(`${u.slice(0, 50)} -> ${r.liens.length} lien(s)`);
    if (r.liens.length) { trouve = { ...r, urlDemandee: u }; break; }
    await patienter(700);
  }

  if (!trouve) {
    obs.push(observation({
      type: "backlink", sujet: { domaine: CIBLE }, objet: { domaine: d },
      metrique: "page_portante", etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { nom: "navigateur", endpoint: `https://${d}/`, http: null, methode: "cdp" },
      preuve: `page portante non localisee au navigateur non plus. ${essais.length} essai(s) : ${essais.slice(0, 4).join(" | ")}`,
      run_id: run, collecteur: VERSION, drapeaux: ["page_portante_non_localisee"],
    }));
    console.log(`▲ non localisee (${essais.length} essais au navigateur)`);
    if (!DRY) { ecrire(obs.slice(dejaEcrites)); dejaEcrites = obs.length; }
    continue;
  }

  const indexable = !/noindex/i.test(trouve.metaRobots || "");
  let df = 0;
  for (const l of trouve.liens) {
    const rel = l.rel;
    const suivi = /\b(nofollow|sponsored|ugc)\b/i.test(rel || "") ? "NOFOLLOW" : "DOFOLLOW";
    if (suivi === "DOFOLLOW") df++;
    obs.push(observation({
      type: "backlink", sujet: { domaine: CIBLE },
      objet: {
        domaine: d, url: trouve.url, ancre: l.ancre || null,
        detail: {
          url_source: trouve.url, url_destination: l.url, ancre: l.ancre || null,
          rel_brut: rel, suivi, suivi_effectif: indexable ? suivi : "NOFOLLOW",
          genre: /\bsponsored\b/i.test(rel || "") ? "sponsored"
               : /\bugc\b/i.test(rel || "") ? "ugc"
               : /\bnofollow\b/i.test(rel || "") ? "nofollow" : "dofollow",
          indexabilite: { meta_robots: trouve.metaRobots, noindex: !indexable },
          lu_par: "navigateur",
        },
      },
      metrique: "lien_qualifie", valeur: 1, unite: "lien",
      nature: "mesure", etat: "MESURE",
      source: { nom: "navigateur", endpoint: trouve.url, http: 200, methode: "cdp" },
      preuve: `rel=${JSON.stringify(rel)} lu dans le DOM servi par un vrai navigateur (curl etait refuse). Page ${indexable ? "indexable" : "en NOINDEX, donc le lien ne transmet rien"}`,
      run_id: run, collecteur: VERSION,
      drapeaux: indexable ? ["lu_au_navigateur"] : ["lu_au_navigateur", "page_en_noindex"],
    }));
  }
  console.log(`${trouve.liens.length} lien(s), ${df} dofollow · ${trouve.url.slice(0, 46)}`);
  if (!DRY) { ecrire(obs.slice(dejaEcrites)); dejaEcrites = obs.length; }
  await patienter(1200);
}

console.log(DRY
  ? `\n--dry : ${obs.length} observations NON ecrites.`
  : `\n${obs.length} observation(s) au total, ${dejaEcrites} posee(s) au fil de l eau.`);
