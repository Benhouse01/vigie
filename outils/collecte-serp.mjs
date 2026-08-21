// POSITIONS DANS LE SERP, POUR NOUS ET POUR TOUS LES CONCURRENTS D'UN COUP.
//
// C'est la seule brique qui voit les CONCURRENTS classes : Search Console ne montre
// jamais qu'un site, le notre. Une requete relevee ici donne la position de tout le
// monde en meme temps, donc le pool de 40 requetes couvre les 25 domaines en 40 appels
// et pas en 1 000.
//
// ⛔ UN SERP LU DEPUIS L'ETRANGER EST FAUX, ET CA A DEJA COUTE DEUX CONCLUSIONS SUR TROIS.
//    Mesure du 19/08/2026, releve fait hors du pays vise : un domaine lu « en page 6 »
//    etait 12e, un autre lu « introuvable » etait 42e. `gl=fr` ne corrige RIEN : il change
//    le pays de service de Google, pas la localisation deduite de l'adresse IP. Seul le
//    parametre `uule` force la localisation declaree.
//
// ⛔ PIEGE D'EXTRACTION QUI FAIT CROIRE A UN SERP VIDE. Sur les pages 2 et suivantes, le
//    <h3> N'EST PAS a l'interieur du <a>. Un selecteur `a > h3` rend zero et le script
//    conclut « fin du SERP » alors que la page porte bien ses dix resultats. On part donc
//    des <h3> et on REMONTE vers le lien.
//
// ⛔ GOOGLE BLOQUE PAR ADRESSE IP au bout de quelques dizaines de requetes, avec
//    « Nos systemes ont detecte un trafic exceptionnel sur votre reseau ». Ce n'est pas
//    lie au profil Chrome, un profil neuf est bloque pareil, et ca retombe en une
//    vingtaine de minutes. Deux consequences codees ici :
//      - on s'arrete NET au premier blocage et on ecrit un ANGLE_MORT, jamais « absent »
//        (ecrire « absent du top 30 » sur un blocage fabriquerait une chute de position
//        qui n'a jamais eu lieu) ;
//      - la reprise est possible : --depuis=<n> reprend le pool a la n-ieme requete.
//
// ⛔ PLUSIEURS FENETRES CLAUDE QUI INTERROGENT GOOGLE LA MEME NUIT GRILLENT L'IP POUR
//    TOUT LE MONDE. D'ou le port CDP dedie, obligatoire et explicite.
//
// Usage :
//   CDP_URL=http://127.0.0.1:9674 node outils/collecte-serp.mjs
//   ... --langue=fr|en|tout   --pages=3   --depuis=12   --dry   --pause=4000

import { evaluer, assurer, patienter } from "./_cdp.mjs";
import { observation, ecrire, nouveauRun, config } from "./_lib-obs.mjs";

const VERSION = "collecte-serp@1.1.0";
const UA_NAVIGATEUR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

// ⛔ Brave se lit en HTTP simple, SANS navigateur : il n'exige donc pas de port CDP.
//    Google et Bing, eux, servent une page-relais en JavaScript et il faut un vrai Chrome.
//    On ne reclame la variable que dans ce cas, sinon on refuserait de demarrer pour un
//    besoin qui n'existe pas.
const MOTEUR_DEMANDE = ((process.argv.find((a) => a.startsWith("--moteur=")) || "").split("=")[1]) || "google";
const CDP = process.env.CDP_URL;
if (!CDP && MOTEUR_DEMANDE !== "brave") {
  console.error(
    "CDP_URL est obligatoire.\n" +
    "  Prenez un port DEDIE et un profil DEDIE pour ce collecteur : deux outils branches\n" +
    "  sur le meme Chrome se volent leurs onglets, et celui-ci navigue beaucoup.\n" +
    "  CDP_URL=http://127.0.0.1:9674 node outils/collecte-serp.mjs"
  );
  process.exit(1);
}
const PORT = CDP ? new URL(CDP).port : null;

const arg = (n, d = null) => {
  const v = (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  return v === undefined ? d : v;
};
const DRY = process.argv.includes("--dry");
const LANGUE = arg("langue", "tout");
const PAGES = Number(arg("pages", 3));
const DEPUIS = Number(arg("depuis", 0));
const PAUSE = Number(arg("pause", 4200));
// ⛔ DEUX MOTEURS, ET ON NE LES MELANGE JAMAIS DANS UNE MEME COURBE. Google bloque
//    l'adresse IP au bout de quelques dizaines de requetes, et il l'a fait des la
//    premiere le 21/08/2026 : l'IP etait deja grillee par d'autres fenetres de la nuit.
//    Bing repond, lui, et ses positions sont une VRAIE mesure, simplement d'un autre
//    moteur. Chaque observation porte donc son moteur dans source.nom.
const MOTEUR = arg("moteur", "google");

const cfg = config();
const SUIVIS = [
  ...cfg.nous.map((d) => d.domaine),
  ...cfg.concurrents.map((d) => d.domaine),
];

// La localisation declaree. Paris pour le francais, New York pour l'anglais : sans
// localisation forcee, le classement anglophone servi depuis la France est deja biaise.
const CLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const uule = (nom) => "w+CAIQICI" + CLE[nom.length % 64] + Buffer.from(nom, "utf8").toString("base64");

const MARCHES = {
  fr: { nom: "Paris,Ile-de-France,France", hote: "www.google.fr", hl: "fr", gl: "fr", pays: "FR" },
  en: { nom: "New York,New York,United States", hote: "www.google.com", hl: "en", gl: "us", pays: "US" },
};

const pool = [];
if (LANGUE === "fr" || LANGUE === "tout") cfg.requetes.fr.forEach((q) => pool.push({ q, langue: "fr" }));
if (LANGUE === "en" || LANGUE === "tout") cfg.requetes.en.forEach((q) => pool.push({ q, langue: "en" }));
const aFaire = pool.slice(DEPUIS);

const EXTRACTION_GOOGLE = `(function(){
  // ⛔ On part des <h3> et on REMONTE : sur les pages 2+, le h3 n'est pas dans le a.
  var out = [], vus = {};
  var h3s = document.querySelectorAll('h3');
  for (var i = 0; i < h3s.length; i++) {
    var n = h3s[i], lien = null;
    for (var k = 0; k < 6 && n; k++, n = n.parentElement) {
      if (n.tagName === 'A' && n.href) { lien = n.href; break; }
      var a = n.querySelector && n.querySelector("a[href^='http']");
      if (a) { lien = a.href; break; }
    }
    if (!lien) continue;
    var u; try { u = new URL(lien); } catch (e) { continue; }
    if (/google\\.|gstatic|googleusercontent/.test(u.hostname)) continue;
    var cle = u.hostname + u.pathname;
    if (vus[cle]) continue;
    vus[cle] = 1;
    out.push({ t: (h3s[i].innerText || '').trim().slice(0, 90),
               d: u.hostname.replace(/^www\\./, ''), p: u.pathname.slice(0, 90) });
  }
  var corps = (document.body.innerText || '');
  var bloque = /trafic exceptionnel|unusual traffic|sorry\\/index/.test(corps) ||
               /\\/sorry\\//.test(location.href);
  return JSON.stringify({ lignes: out, bloque: bloque, url: location.href.slice(0, 120) });
})()`;

// Bing structure ses resultats organiques en `li.b_algo`, avec le lien dans le h2.
// ⛔ Ses encarts publicitaires sont des `li.b_ad` : les inclure ferait passer un
//    concurrent qui ACHETE le mot-cle pour un concurrent qui le CLASSE.
const EXTRACTION_BING = `(function(){
  // ⛔ LE href D'UN RESULTAT BING NE PORTE PAS LE SITE. Bing enveloppe tous ses liens
  //    organiques dans bing.com/ck/a?...&u=<base64>. Un filtre « on ignore bing.com »
  //    jette donc LA TOTALITE des resultats et le collecteur annonce « rien de lisible »
  //    sur une page qui porte ses dix resultats. Mesure du 21/08/2026 : 10 li.b_algo
  //    presents, 0 extrait. On lit l'URL affichee dans la citation, qui est le vrai
  //    domaine, et on ne retombe sur le href que s'il n'est pas une enveloppe.
  //
  // ⛔ PAS UN SEUL ANTISLASH DANS CE BLOC, ET C'EST VOLONTAIRE. Ce code voyage dans un
  //    litteral gabarit puis dans un JSON puis dans le protocole de debogage : a chaque
  //    couche un antislash peut se manger. Une version precedente contenait /\s|›|>/,
  //    arrive dans le navigateur en /s|›|>/, qui coupait « https » sur sa lettre s et
  //    rendait zero resultat sans la moindre erreur. Les regex sont donc remplacees par
  //    des indexOf et des comparaisons de chaines, qui ne s'echappent pas.
  var out = [], vus = {};
  var lis = document.querySelectorAll('#b_results > li.b_algo');
  for (var i = 0; i < lis.length; i++) {
    var brut = null;
    var cite = lis[i].querySelector('.b_attribution cite') || lis[i].querySelector('cite');
    if (cite && cite.textContent) {
      var t = cite.textContent.trim();
      var coupe = t.length;
      [' ', String.fromCharCode(8250), '>'].forEach(function (sep) {
        var k = t.indexOf(sep);
        if (k > 0 && k < coupe) coupe = k;
      });
      brut = t.slice(0, coupe);
    }
    var estUrl = brut && (brut.indexOf('http://') === 0 || brut.indexOf('https://') === 0);
    if (!estUrl) {
      var a = lis[i].querySelector('h2 a[href]');
      if (a && a.href && a.href.indexOf('bing.com/ck/') < 0) brut = a.href;
      else if (brut) brut = 'https://' + brut;
      else brut = null;
    }
    if (!brut) continue;
    var u; try { u = new URL(brut); } catch (e) { continue; }
    var hote = u.hostname.toLowerCase();
    if (hote.indexOf('www.') === 0) hote = hote.slice(4);
    if (hote === 'bing.com' || hote === 'microsoft.com' || hote === 'msn.com') continue;
    var cle = hote + u.pathname;
    if (vus[cle]) continue;
    vus[cle] = 1;
    var h2 = lis[i].querySelector('h2');
    out.push({ t: (h2 ? h2.innerText : '').trim().slice(0, 90), d: hote, p: u.pathname.slice(0, 90) });
  }
  var corps = (document.body.innerText || '').toLowerCase();
  var bloque = corps.indexOf('unusual traffic') >= 0 ||
               corps.indexOf('verify you are a human') >= 0 ||
               corps.indexOf('trafic inhabituel') >= 0;
  return JSON.stringify({ lignes: out, bloque: bloque, url: location.href.slice(0, 120) });
})()`;

const run = nouveauRun("serp");
console.log(`Vigie SEO — positions · ${aFaire.length} requete(s) sur ${pool.length} · ${PAGES} page(s) chacune`);
console.log(`Chrome dedie : ${CDP}${DEPUIS ? ` · reprise a la requete ${DEPUIS + 1}` : ""}${DRY ? " · --dry" : ""}\n`);

const obs = [];
let bloqueA = null;
let relevees = 0;
let illisibles = 0;
let dejaEcrites = 0;

// Chaque moteur : comment on l'appelle, comment on lit sa page, comment on le nomme.
const MOTEURS = {
  google: {
    motif: "google.",
    url: (q, m, p) =>
      `https://${m.hote}/search?q=${encodeURIComponent(q)}&pws=0&gl=${m.gl}&hl=${m.hl}` +
      `&uule=${encodeURIComponent(uule(m.nom))}&num=10&start=${p * 10}`,
    extraction: EXTRACTION_GOOGLE,
    source: (m) => ({ nom: "google_uule", endpoint: `${m.hote}/search?q=…&uule=${m.nom}` }),
    etiquette: (m) => `Google, localisation forcee ${m.nom}`,
  },
  bing: {
    motif: "bing.com/search",
    // ⛔ Bing n'a pas d'equivalent de uule. `cc` et `setlang` declarent le marche, ce qui
    //    n'est PAS la meme chose qu'une localisation forcee : on ne fait donc jamais
    //    passer une position Bing pour une position Google, et l'etiquette le dit.
    url: (q, m, p) =>
      `https://www.bing.com/search?q=${encodeURIComponent(q)}&cc=${m.pays}&setlang=${m.hl}` +
      `&count=20&first=${p * 10 + 1}`,
    extraction: EXTRACTION_BING,
    source: (m) => ({ nom: "bing_serp", endpoint: `bing.com/search?q=…&cc=${m.pays}` }),
    etiquette: (m) => `Bing, marche declare ${m.pays}`,
  },
};
// Brave : troisieme moteur, ajoute le 21/08/2026 parce que Google ET Bing bloquaient
// l'adresse IP espagnole le meme soir. Il a son propre index, ce n'est donc ni un Google
// ni un Bing deguise : chaque ligne porte « brave_serp » dans sa source, et le site ne
// melange jamais deux moteurs dans une meme courbe.
MOTEURS.brave = {
  http: true,
  url: (q, m, p) =>
    `https://search.brave.com/search?q=${encodeURIComponent(q)}&country=${m.pays.toLowerCase()}` +
    (p ? `&offset=${p}` : ""),
  source: (m) => ({ nom: "brave_serp", endpoint: `search.brave.com/search?q=…&country=${m.pays}` }),
  etiquette: (m) => `Brave, pays declare ${m.pays}`,
  // ⛔ On lit les href porteurs de data-type="web" : ce sont les resultats ORGANIQUES.
  //    Les encarts commerciaux et les blocs « discussions » portent d'autres types, les
  //    inclure ferait passer un achat de mot-cle pour un classement.
  extraireHtml: (html) => {
    const out = [];
    const vus = new Set();
    for (const m of html.matchAll(/data-type="web"[\s\S]{0,900}?href="(https?:\/\/[^"]+)"/g)) {
      let u;
      try { u = new URL(m[1]); } catch { continue; }
      const hote = u.hostname.replace(/^www\./, "").toLowerCase();
      if (/brave\.com$/.test(hote)) continue;
      const cle = hote + u.pathname;
      if (vus.has(cle)) continue;
      vus.add(cle);
      out.push({ t: "", d: hote, p: u.pathname.slice(0, 90) });
    }
    return out;
  },
};

const MOT = MOTEURS[MOTEUR];
if (!MOT) { console.error(`moteur inconnu : ${MOTEUR} (google ou bing)`); process.exit(1); }

for (let i = 0; i < aFaire.length && !bloqueA; i++) {
  const { q, langue } = aFaire[i];
  const m = MARCHES[langue];
  const tout = [];
  let rang = 0;
  let derniereRaison = null;

  for (let p = 0; p < PAGES; p++) {
    const url = MOT.url(q, m, p);

    if (MOT.http) {
      // Chemin sans navigateur.
      let r;
      try {
        r = await fetch(url, { headers: { "user-agent": UA_NAVIGATEUR, "accept-language": m.hl === "fr" ? "fr-FR,fr;q=0.9" : "en-US,en;q=0.9" } });
      } catch (e) {
        derniereRaison = `reseau : ${String(e.message || e).slice(0, 60)}`;
        break;
      }
      const html = await r.text();
      // ⛔ 202 ET 429 NE SONT PAS « ZERO RESULTAT », ce sont des refus. DuckDuckGo rend
      //    exactement ca a partir de la deuxieme requete, avec une page de captcha.
      if (r.status === 202 || r.status === 429 || r.status === 403) {
        derniereRaison = `le moteur a refuse (HTTP ${r.status}), ce n est pas une absence de resultat`;
        if (r.status === 429) bloqueA = { requete: q, page: p + 1 };
        break;
      }
      if (r.status !== 200) { derniereRaison = `HTTP ${r.status}`; break; }
      const lignes = MOT.extraireHtml(html);
      if (!lignes.length) { derniereRaison = `HTTP 200 mais aucun resultat extrait (${html.length} octets) : la structure de la page a peut-etre change`; break; }
      lignes.forEach((l) => tout.push({ rang: ++rang, page: p + 1, ...l }));
      await patienter(PAUSE);
      continue;
    }

    await evaluer(PORT, MOT.motif, `location.assign(${JSON.stringify(url)});'ok'`, { urlSecours: url });
    await patienter(2800);
    let brut;
    try {
      brut = await evaluer(PORT, MOT.motif, MOT.extraction, { urlSecours: url });
    } catch (e) {
      derniereRaison = `page illisible : ${String(e.message || e).slice(0, 70)}`;
      break;                       // on garde ce qu'on a deja
    }
    const { lignes, bloque, url: servie } = JSON.parse(brut);
    // Une page d'erreur de Chrome n'est pas une page de resultats vide : c'est le reseau
    // ou le moteur qui a refuse. On le nomme, au lieu de conclure « zero resultat ».
    if (String(servie || "").startsWith("chrome-error")) {
      derniereRaison = "le moteur a coupe la connexion (ERR_CONNECTION_CLOSED)";
      break;
    }
    // ⛔ ON GARDE CE QUI EST DEJA RELEVE. Premiere version : le blocage arrivait en page 2
    //    et le `break` jetait AUSSI la page 1, pourtant complete. On perdait le top 10
    //    d'une requete pour un incident survenu apres lui.
    if (bloque) { bloqueA = { requete: q, page: p + 1 }; break; }
    if (!lignes.length) break;
    lignes.forEach((l) => tout.push({ rang: ++rang, page: p + 1, ...l }));
    await patienter(PAUSE);
  }

  if (!tout.length) {
    // ⛔ NE JAMAIS PASSER SON CHEMIN EN SILENCE. Premiere version : une requete illisible
    //    faisait `continue`, donc AUCUNE observation, donc un trou invisible dans le
    //    journal. Le 21/08/2026 les 40 requetes sont passees ainsi et le collecteur a
    //    ecrit « 0 observations » en sortant avec le code 0, comme un succes. La cause
    //    etait ERR_CONNECTION_CLOSED : Bing avait coupe la connexion apres la rafale.
    //    Un trou qui ne se voit pas est pire qu'une erreur : la passe suivante croit que
    //    la requete n'a jamais ete tentee.
    const raison = derniereRaison || "aucun resultat lisible sur la page servie";
    obs.push(observation({
      type: "position", sujet: { requete: q, pays: m.pays, device: "desktop" },
      metrique: "resultats_releves", etat: "ANGLE_MORT", nature: "mesure_absente",
      source: { ...MOT.source(m), http: null, methode: "cdp" },
      preuve: `${raison} — ${MOT.etiquette(m)}`,
      run_id: run, collecteur: VERSION, drapeaux: ["serp_illisible"],
    }));
    console.log(`  ${String(DEPUIS + i + 1).padStart(2)}. ${q.padEnd(42)} ▲ ${raison.slice(0, 46)}`);
    illisibles++;
    // ⛔ Recul progressif. Insister au meme rythme sur un moteur qui vient de couper la
    //    connexion ne fait que prolonger le blocage et brule les 39 requetes suivantes.
    if (illisibles >= 3) {
      console.log(`     recul : ${illisibles} requetes illisibles d affilee, pause de ${Math.min(60, illisibles * 10)} s`);
      await patienter(Math.min(60000, illisibles * 10000));
    }
    continue;
  }
  illisibles = 0;
  relevees++;

  const src = { ...MOT.source(m), http: 200, methode: "cdp" };
  const profondeur = `${tout.length} resultats releves`;

  // Une position par domaine suivi. Un domaine absent du releve est une VRAIE mesure
  // (il n'y est pas), un blocage est un angle mort : les deux ne se confondent pas.
  for (const d of SUIVIS) {
    const trouve = tout.find((r) => r.d === d || r.d.endsWith(`.${d}`));
    obs.push(observation({
      type: "position",
      sujet: { domaine: d, requete: q, pays: m.pays, device: "desktop", url: trouve ? `https://${trouve.d}${trouve.p}` : null },
      metrique: "position",
      valeur: trouve ? trouve.rang : null,
      unite: "rang",
      nature: trouve ? "mesure" : "mesure_absente",
      etat: trouve ? "MESURE" : "MESURE_ABSENT",
      source: src,
      preuve: trouve
        ? `${trouve.d}${trouve.p} en position ${trouve.rang} (page ${trouve.page}) — ${MOT.etiquette(m)}`
        : `absent des ${profondeur} — ${MOT.etiquette(m)}`,
      run_id: run, collecteur: VERSION,
      // ⛔ Le releve s'arrete a la profondeur atteinte : « absent » veut dire « absent des
      //    N premiers », jamais « absent du web ». Le drapeau porte cette limite.
      drapeaux: trouve ? [] : [`absent_du_top_${tout.length}`],
    }));
  }
  // Le SERP lui-meme est une donnee : savoir QUI occupe le top 10 vaut le releve.
  obs.push(observation({
    type: "position", sujet: { requete: q, pays: m.pays, device: "desktop" },
    metrique: "resultats_releves", valeur: tout.length, unite: "resultat",
    nature: "mesure", etat: "MESURE", source: src,
    preuve: tout.slice(0, 10).map((r) => `${r.rang}.${r.d}`).join(" "),
    run_id: run, collecteur: VERSION,
  }));

  // ⛔ ON ECRIT APRES CHAQUE REQUETE, PAS A LA FIN. Premiere version : tout etait garde
  //    en memoire jusqu'au dernier appel. Le 21/08/2026, un releve arrete au bout de 21
  //    requetes sur 40 a perdu les 21, qui avaient pourtant abouti. Un collecteur qui
  //    tourne un quart d'heure contre un moteur pouvant couper a tout moment doit poser
  //    ce qu'il a des qu'il l'a.
  if (!DRY) {
    ecrire(obs.slice(dejaEcrites));
    dejaEcrites = obs.length;
  }

  const nos = SUIVIS.map((d) => {
    const t = tout.find((r) => r.d === d || r.d.endsWith(`.${d}`));
    return t ? `${d}#${t.rang}` : null;
  }).filter(Boolean);
  console.log(`  ${String(DEPUIS + i + 1).padStart(2)}. ${q.padEnd(42)} ${String(tout.length).padStart(3)} res. · ${nos.slice(0, 5).join(" ") || "aucun domaine suivi"}`);
}

if (bloqueA) {
  // ⛔ On ecrit le blocage COMME UNE OBSERVATION. Sans cette ligne, la passe suivante ne
  //    saurait pas que le trou du jour vient de Google et pas d'une chute de classement.
  obs.push(observation({
    type: "position", sujet: { requete: bloqueA.requete },
    metrique: "serp_bloque", etat: "ANGLE_MORT", nature: "mesure_absente",
    source: { nom: MOTEUR === "bing" ? "bing_serp" : "google_uule", endpoint: `${MOTEUR}/search`, http: 429, methode: "cdp" },
    preuve: `${MOTEUR} a refuse l adresse IP a la requete « ${bloqueA.requete} », page ${bloqueA.page}. ` +
            `Ca retombe en une vingtaine de minutes. Reprendre avec --depuis=${DEPUIS + obs.filter((o) => o.metrique === "resultats_releves").length}`,
    run_id: run, collecteur: VERSION, drapeaux: ["serp_bloque"],
  }));
  // ⛔ Le message nommait Google quel que soit le moteur : un refus de Brave s'affichait
  //    « Google a bloque », ce qui envoie chercher la panne au mauvais endroit.
  console.log(`\n🚫 ${MOTEUR} a refuse l adresse IP. ${relevees} requete(s) relevee(s) et CONSERVEE(S) avant l arret.`);
  console.log(`   Ca retombe en une vingtaine de minutes. Reprendre par :`);
  console.log(`   ${CDP ? `CDP_URL=${CDP} ` : ""}node outils/collecte-serp.mjs --moteur=${MOTEUR} --depuis=${DEPUIS + relevees}`);
}

if (DRY) {
  console.log(`\n--dry : ${obs.length} observations NON ecrites.`);
} else {
  console.log(`\n${ecrire(obs)} observations ecrites (${obs.length} calculees).`);
}
