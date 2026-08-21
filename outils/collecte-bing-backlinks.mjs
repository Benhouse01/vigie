// BACKLINKS DES CONCURRENTS, PAR BING WEBMASTER TOOLS.
//
// C'est LA brique qui debloque le chantier, et elle est gratuite.
//
// Bing Webmaster Tools porte un onglet « Backlinks To Any Site » qui accepte des domaines
// qu'on ne possede pas. C'est exactement ce que les outils payants facturent. L'installer
// prend dix minutes et ne demande aucune verification DNS : l'import depuis Search Console
// reprend la liste des sites deja verifies chez Google. Voir docs/bing.md.
//
// ⛔ CONNECTEZ-VOUS AVEC LE COMPTE QUI POSSEDE DEJA LA PROPRIETE SEARCH CONSOLE, ET
//    VERIFIEZ-LE AVANT DE LANCER QUOI QUE CE SOIT. Mesure du 21/08/2026 : l'import a ete
//    tente depuis un compte qui portait bien le nom du projet mais AUCUNE propriete
//    Search Console. Son ecran n'affiche pas d'erreur, il affiche le « welcome » de
//    creation, et on peut passer un moment a chercher une panne qui n'existe pas. Le
//    compte Bing et le compte Search Console peuvent parfaitement etre deux comptes
//    differents : c'est le second qui commande l'import.
//
// CE QUE BING REND, ET CE QU'IL NE REND PAS :
//   ✅ les domaines referents d'un tiers, avec le nombre de liens par domaine
//   ✅ les ancres d'un tiers, avec leur nombre
//   ✅ jusqu'a TROIS sites compares dans le meme appel (SimilarSiteCount1/2/3)
//   ⛔ PAS l'URL de la page source, PAS l'attribut rel, PAS la date de decouverte.
//      Ces trois-la se lisent ailleurs : collecte-rel.mjs va lire le HTML servi,
//      collecte-wayback.mjs va dater. Ne JAMAIS fusionner les deux compteurs dans une
//      seule colonne : « domaines referents (Bing) » et « liens qualifies (lecture HTML) »
//      ne mesurent pas la meme chose.
//
// ⛔ PIEGE MESURE : une route inexistante de l'API rend HTTP 200 avec le HTML de
//    l'application. Un test « status === 200 » conclut donc que n'importe quel endroit
//    existe. On verifie la PRESENCE DE LA CLE ATTENDUE dans le JSON, jamais le code.
//    Quatre noms de routes plausibles ont ete essayes, seuls deux existent.
//
// Usage :
//   CDP_URL=http://127.0.0.1:9674 node outils/collecte-bing-backlinks.mjs
//   CDP_URL=http://127.0.0.1:9674 node outils/collecte-bing-backlinks.mjs --domaines=exemple.com,concurrent-un.com
//   ... --dry  (n'ecrit rien, affiche seulement)

import { evaluer, injecterAuChargement, assurer, patienter } from "./_cdp.mjs";
import { observation, ecrire, nouveauRun, config } from "./_lib-obs.mjs";

const VERSION = "collecte-bing-backlinks@1.0.0";
const MOTIF = "bing.com/webmasters";

// ⛔ Un port CDP en dur est le mecanisme exact par lequel un script vient travailler sur
//    l'onglet d'un autre outil et lui vole sa navigation. On EXIGE la variable, on ne
//    devine pas, et on prend un port DEDIE avec un profil DEDIE.
const CDP = process.env.CDP_URL;
if (!CDP) {
  console.error(
    "CDP_URL est obligatoire.\n" +
    "  Lancez un Chrome dedie sur un port dedie, connectez-vous a bing.com/webmasters,\n" +
    "  puis : CDP_URL=http://127.0.0.1:9674 node outils/collecte-bing-backlinks.mjs\n" +
    "  Voir docs/bing.md pour la ligne de lancement complete."
  );
  process.exit(1);
}
const PORT = new URL(CDP).port;

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || null;
const DRY = process.argv.includes("--dry");

const cfg = config();

// ⛔ LE SITE DE REFERENCE VIENT DE LA CONFIGURATION, JAMAIS D'UNE CONSTANTE. L'API de Bing
//    veut un `siteUrl` qui vous appartient, les concurrents venant a cote dans
//    CompetitorSiteUrls. Ecrire ce domaine en dur dans un fichier partage y laisserait le
//    site de celui qui a ecrit le fichier, et tout le monde interrogerait le sien.
const NOTRE = cfg.nous?.[0];
if (!NOTRE) {
  console.error(
    "aucun domaine en role « nous » dans la configuration.\n" +
    "  Bing veut un site qui vous appartient comme point de reference, meme quand vous\n" +
    "  n'interrogez que des concurrents. Ajoutez le votre dans config/domaines.json."
  );
  process.exit(1);
}
const NOTRE_SITE = `https://${NOTRE.domaine}/`;
const PAGE = `https://www.bing.com/webmasters/backlinks?siteUrl=${encodeURIComponent(NOTRE_SITE)}`;
const demandes = arg("domaines");
const cibles = demandes
  ? demandes.split(",").map((d) => ({ domaine: d.trim(), libelle: d.trim(), role: "demande" }))
  : [
      ...cfg.nous.filter((d) => d.gsc).map((d) => ({ ...d, role: "nous" })),
      ...cfg.concurrents.map((d) => ({ ...d, role: "concurrent" })),
    ];

// -------------------------------------------------------------- le jeton anti-rejeu

const ESPION = `
(function(){
  window.__vigie = { jeton: null, appels: [] };
  var of = window.fetch;
  window.fetch = function(a, b){
    try {
      var u = String((a && a.url) || a);
      if (u.indexOf('/webmasters/api/') >= 0 && b && b.headers) {
        var h = {};
        if (b.headers.forEach) b.headers.forEach(function(v,k){ h[k.toLowerCase()] = v; });
        else Object.keys(b.headers).forEach(function(k){ h[k.toLowerCase()] = b.headers[k]; });
        if (h['x-csrf-token']) window.__vigie.jeton = h['x-csrf-token'];
        window.__vigie.appels.push(u);
      }
    } catch(e) {}
    return of.apply(this, arguments);
  };
})();
`;

async function jeton() {
  // 1er essai : l'espion est peut-etre deja pose par une passe precedente.
  let j = await evaluer(PORT, MOTIF, "(window.__vigie && window.__vigie.jeton) || ''", { urlSecours: PAGE });
  if (j) return j;

  // Sinon on pose l'espion AVANT le JS de la page, puis on recharge : l'application
  // fait son premier appel toute seule, on n'a pas a deviner quel clic le declenche.
  await assurer(PORT, MOTIF, PAGE);
  j = await injecterAuChargement(PORT, MOTIF, ESPION, {
    urlSecours: PAGE,
    apres: "(window.__vigie && window.__vigie.jeton) || ''",
    essais: 25,
  });
  if (j) return j;

  // ⛔ DERNIER RECOURS. Sur l'onglet « Backlinks For Your Site » quand notre site n'a
  //    encore aucune donnee (Bing annonce jusqu'a 48 h de traitement), l'application ne
  //    lance AUCUN appel au chargement : il n'y a alors rien a ecouter. On bascule donc
  //    nous-memes sur l'onglet des sites tiers, qui, lui, appelle toujours.
  await evaluer(PORT, MOTIF, `(function(){var t=[].slice.call(document.querySelectorAll('button,div,span,a')).filter(function(e){return (e.innerText||'').trim()==='Backlinks To Any Site'})[0];if(t)t.click();return !!t})()`, { urlSecours: PAGE });
  for (let i = 0; i < 15; i++) {
    await patienter(1500);
    j = await evaluer(PORT, MOTIF, "(window.__vigie && window.__vigie.jeton) || ''", { urlSecours: PAGE });
    if (j) return j;
  }

  throw new Error(
    "jeton X-CSRF-Token introuvable apres 25 essais.\n" +
    "  Verifier que le Chrome du port " + PORT + " est bien CONNECTE a bing.com/webmasters\n" +
    "  et que la page n'affiche pas un ecran de connexion : deconnecte, l'application ne\n" +
    "  lance aucun appel a son API, et il n'y a donc aucun jeton a ecouter."
  );
}

// -------------------------------------------------------------- appels API

async function api(route, corps, cleAttendue, T) {
  const expr = `fetch(${JSON.stringify("/webmasters/api/backlinks/" + route)},{method:'POST',headers:{'content-type':'application/json;charset=UTF-8','X-CSRF-Token':${JSON.stringify(T)}},body:${JSON.stringify(JSON.stringify(corps))}}).then(function(x){return x.text()}).then(function(t){return JSON.stringify({http:200,t:t})}).catch(function(e){return JSON.stringify({http:null,t:String(e)})})`;
  const brut = await evaluer(PORT, MOTIF, expr, { urlSecours: PAGE });
  let enveloppe;
  try { enveloppe = JSON.parse(brut); } catch { return { ok: false, raison: "reponse illisible", brut: String(brut).slice(0, 200) }; }
  let json;
  try { json = JSON.parse(enveloppe.t); } catch {
    // ⛔ C'est ici que se voit le piege : une route inconnue rend le HTML de l'appli.
    return { ok: false, raison: "la route a rendu du HTML, pas du JSON (route probablement inexistante)", brut: enveloppe.t.slice(0, 120) };
  }
  if (!(cleAttendue in json)) {
    return { ok: false, raison: `cle ${cleAttendue} absente de la reponse`, brut: JSON.stringify(json).slice(0, 200) };
  }
  return { ok: true, json };
}

/** Un groupe = jusqu'a 3 sites compares dans le meme appel. */
async function groupe(sites, T, run) {
  const urls = sites.map((s) => `https://${s.domaine}/`);
  const obs = [];
  const corps = (taille, page) => ({
    siteUrl: NOTRE_SITE,
    CompetitorSiteUrls: urls,
    Pagination: { PageSize: taille, PageNum: page },
  });

  // --- domaines referents
  //
  // ⛔ PLAFOND MESURE LE 21/08/2026, ET C'EST LE PIEGE LE PLUS DANGEREUX DE CETTE SOURCE.
  //    Bing rend AU PLUS 500 domaines referents PAR SITE, et il annonce
  //    TotalNumOfRecords = 500 comme si c'etait le total reel. La page 2 rend zero ligne :
  //    il n'y a pas de pagination, la troncature est DEFINITIVE et SILENCIEUSE.
  //    Preuve mesuree sur trois sites reels d'un meme secteur, anonymises ici. Le premier
  //    interroge SEUL rend 500 lignes, annonce un total de 500, et sa page 2 est vide.
  //    Les trois interroges ENSEMBLE rendent 651 lignes distinctes, reparties en
  //    500 / 15 / 196 non nuls : le plafond est donc PAR SITE et pas par appel.
  //    Un site a exactement 500 n'a donc PAS 500 domaines referents : il en a AU MOINS 500.
  //    On l'ecrit en nature "plancher" avec un drapeau, et le site doit afficher
  //    « au moins 500 ». Ecrire 500 en clair serait exactement le zero silencieux qu'on
  //    s'interdit, dans l'autre sens.
  const PLAFOND_BING = 500;
  let totalLignes = 0;
  const compteParSite = sites.map(() => 0);
  const liensParSite = sites.map(() => 0);
  {
    const r = await api("domainssimilarsite", corps(PLAFOND_BING, 1), "ReferringDomainDetails", T);
    if (!r.ok) {
      for (const s of sites) {
        obs.push(observation({
          type: "backlink", sujet: { domaine: s.domaine }, metrique: "domaines_referents",
          etat: "ANGLE_MORT", nature: "mesure_absente",
          source: { nom: "bing_webmaster", endpoint: "/webmasters/api/backlinks/domainssimilarsite", http: null, methode: "cdp" },
          preuve: r.raison + " | " + (r.brut || ""), run_id: run, collecteur: VERSION,
          drapeaux: ["appel_api_echoue"],
        }));
      }
      return obs;
    }
    const lignes = r.json.ReferringDomainDetails || [];
    for (const l of lignes) {
      const dom = String(l.DomainName || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
      sites.forEach((s, i) => {
        const n = Number(l[`SimilarSiteCount${i + 1}`] || 0);
        if (!n) return;
        compteParSite[i]++;
        liensParSite[i] += n;
        obs.push(observation({
          type: "backlink",
          sujet: { domaine: s.domaine },
          objet: { domaine: dom },
          metrique: "liens_depuis_domaine",
          valeur: n, unite: "lien",
          nature: "mesure", etat: "MESURE",
          source: { nom: "bing_webmaster", endpoint: "/webmasters/api/backlinks/domainssimilarsite", http: 200, methode: "cdp" },
          preuve: `${l.DomainName} -> ${s.domaine} : ${n}`,
          run_id: run, collecteur: VERSION,
          // ⛔ Le drapeau part avec la ligne pour que le site ne puisse PAS afficher ce
          //    compte a cote d'un compte de liens qualifies comme si c'etait la meme chose.
          drapeaux: ["granularite_domaine_sans_url_ni_rel"],
        }));
      });
    }
    totalLignes = lignes.length;
  }

  sites.forEach((s, i) => {
    const tronque = compteParSite[i] >= PLAFOND_BING;
    obs.push(observation({
      type: "backlink", sujet: { domaine: s.domaine }, metrique: "domaines_referents",
      valeur: compteParSite[i], unite: "domaine",
      // ⛔ « plancher » et non « mesure » des qu'on touche le plafond : le chiffre est un
      //    minimum, exactement comme le rapport Liens de Search Console.
      nature: tronque ? "plancher" : "mesure", etat: "MESURE",
      valeur_min: tronque ? PLAFOND_BING : null,
      valeur_max: tronque ? null : compteParSite[i],
      source: { nom: "bing_webmaster", endpoint: "/webmasters/api/backlinks/domainssimilarsite", http: 200, methode: "cdp" },
      preuve: tronque
        ? `${compteParSite[i]} domaines lus, PLAFOND de l API atteint : le vrai nombre est superieur, la page 2 rend zero ligne`
        : `${totalLignes} lignes lues, ${compteParSite[i]} portent un compte non nul`,
      run_id: run, collecteur: VERSION,
      drapeaux: tronque ? ["plafond_bing_500"] : [],
    }));
    obs.push(observation({
      type: "backlink", sujet: { domaine: s.domaine }, metrique: "liens_totaux",
      valeur: liensParSite[i], unite: "lien",
      nature: tronque ? "plancher" : "mesure", etat: "MESURE",
      source: { nom: "bing_webmaster", endpoint: "/webmasters/api/backlinks/domainssimilarsite", http: 200, methode: "cdp" },
      preuve: tronque
        ? `somme sur les ${PLAFOND_BING} premiers domaines seulement, plafond atteint`
        : `somme des comptes par domaine referent`,
      run_id: run, collecteur: VERSION,
      drapeaux: tronque ? ["plafond_bing_500"] : [],
    }));
  });

  // --- ancres
  const ra = await api("anchorssimilarsite", corps(500, 1), "AnchorTextDetails", T);
  if (ra.ok) {
    for (const l of ra.json.AnchorTextDetails || []) {
      sites.forEach((s, i) => {
        const n = Number(l[`SimilarSiteCount${i + 1}`] || 0);
        if (!n) return;
        obs.push(observation({
          type: "backlink",
          sujet: { domaine: s.domaine },
          objet: { ancre: String(l.Anchor || "").slice(0, 200) },
          metrique: "ancre",
          valeur: n, unite: "lien", nature: "mesure", etat: "MESURE",
          source: { nom: "bing_webmaster", endpoint: "/webmasters/api/backlinks/anchorssimilarsite", http: 200, methode: "cdp" },
          preuve: `ancre « ${String(l.Anchor || "").slice(0, 80)} » : ${n}`,
          run_id: run, collecteur: VERSION,
        }));
      });
    }
  } else {
    for (const s of sites) {
      obs.push(observation({
        type: "backlink", sujet: { domaine: s.domaine }, metrique: "ancres_distinctes",
        etat: "ANGLE_MORT", nature: "mesure_absente",
        source: { nom: "bing_webmaster", endpoint: "/webmasters/api/backlinks/anchorssimilarsite", http: null, methode: "cdp" },
        preuve: ra.raison, run_id: run, collecteur: VERSION, drapeaux: ["appel_api_echoue"],
      }));
    }
  }
  return obs;
}

// -------------------------------------------------------------- execution

const run = nouveauRun("bing");
console.log(`Vigie SEO — backlinks Bing · ${cibles.length} domaine(s) · run ${run}`);
console.log(`Chrome pilote : ${CDP}\n`);

const T = await jeton();
console.log(`jeton anti-rejeu obtenu (${T.slice(0, 6)}…)\n`);

const toutes = [];
// ⛔ TROIS par appel, pas quatre : mesure du 21/08, la reponse ne porte que
//    SimilarSiteCount1, 2 et 3. Un quatrieme domaine est avale en silence.
for (let i = 0; i < cibles.length; i += 3) {
  const lot = cibles.slice(i, i + 3);
  process.stdout.write(`  ${lot.map((s) => s.domaine).join(", ")} … `);
  try {
    const obs = await groupe(lot, T, run);
    toutes.push(...obs);
    const resume = lot.map((s) => {
      const d = obs.find((o) => o.sujet.domaine === s.domaine && o.metrique === "domaines_referents");
      if (d?.etat !== "MESURE") return `${s.domaine} ▲`;
      // Le « >= » n'est pas cosmetique : il empeche de lire un plafond comme un total.
      return `${s.domaine} ${d.nature === "plancher" ? ">=" : ""}${d.valeur} dom.`;
    }).join(" · ");
    console.log(resume);
  } catch (e) {
    console.log(`ECHEC : ${String(e.message).slice(0, 120)}`);
  }
  await patienter(1200);
}

if (DRY) {
  console.log(`\n--dry : ${toutes.length} observations NON ecrites.`);
  console.log(JSON.stringify(toutes.slice(0, 3), null, 1));
} else {
  const n = ecrire(toutes);
  console.log(`\n${n} observations ecrites.`);
}
