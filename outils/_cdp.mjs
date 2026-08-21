// Pilotage CDP resilient : conduire un navigateur deja ouvert, sans deranger qui s'en sert.
//
// Certaines mesures ne s'obtiennent pas en HTTP simple : elles vivent derriere une
// connexion, dans une interface rendue en JavaScript. On les lit dans un vrai navigateur,
// par le protocole de debogage (CDP). Ce navigateur est presque toujours PARTAGE : un
// autre outil, une extension, et la personne devant l'ecran y ouvrent et y ferment des
// onglets pendant que le script tourne. Trois regles en decoulent.
//
// ⛔ ON NE GARDE JAMAIS UN IDENTIFIANT D'ONGLET EN VARIABLE.
//    Mesure du 21/08/2026 : pendant un parcours d'authentification, TROIS onglets ouverts
//    par le script ont ete fermes en cours de route par autre chose que lui. Un id
//    d'onglet garde en variable devient alors invalide, et le script casse au milieu du
//    parcours, sans jamais dire pourquoi.
//    Ici on RETROUVE l'onglet par son URL a chaque appel, et on le rouvre s'il a disparu.
//    Le parcours reprend au lieu de casser.
//
// ⛔ ON NE FERME JAMAIS un onglet qu'on n'a pas ouvert. Les autres onglets ne nous
//    appartiennent pas, et l'un d'eux porte peut-etre une session en cours.
//
// ⛔ ON NE RAMENE JAMAIS la fenetre au premier plan (pas de Page.bringToFront). L'outil
//    tourne pendant que quelqu'un travaille : voler le focus rend le poste inutilisable.
//
// Le navigateur doit ecouter sur un port de debogage, lance avec un profil DEDIE :
//   chrome --remote-debugging-port=<port> --user-data-dir=<dossier de profil>
// Le port n'est jamais ecrit dans le code : il arrive en argument, par CDP_URL
// (adresse complete) ou par VIGIE_PORT.
//
// Utilisable comme module (import) et en ligne de commande :
//   node outils/_cdp.mjs <port> ouvrir  <url>
//   node outils/_cdp.mjs <port> texte   <motif-url>
//   node outils/_cdp.mjs <port> eval    <motif-url> "<js>"
//   node outils/_cdp.mjs <port> aller   <motif-url> <url>
//   node outils/_cdp.mjs <port> onglets

const DELAI_MS = 45000;

/**
 * Adresse du point d'entree CDP, dans l'ordre : l'argument recu, puis CDP_URL, puis
 * VIGIE_PORT.
 *
 * ⛔ AUCUN PORT ECRIT EN DUR, NULLE PART. Un port fige dans le code force tous les outils
 *    a se donner rendez-vous dans le meme navigateur, et deux outils qui se marchent
 *    dessus ne se signalent pas : ils se manifestent par un onglet ferme au milieu d'un
 *    parcours ou une session perdue. Un port par usage, choisi par celui qui lance.
 */
export function base(port) {
  if (port) return `http://127.0.0.1:${port}`;
  if (process.env.CDP_URL) return process.env.CDP_URL.replace(/\/+$/, "");
  if (process.env.VIGIE_PORT) return `http://127.0.0.1:${process.env.VIGIE_PORT}`;
  throw new Error(
    "aucun navigateur indique : passe le port en argument, ou definis " +
    "CDP_URL=http://127.0.0.1:<port>, ou VIGIE_PORT=<port>.\n" +
    "  Le navigateur doit avoir ete lance avec --remote-debugging-port=<port> " +
    "et son propre --user-data-dir."
  );
}

export async function onglets(port) {
  const r = await fetch(`${base(port)}/json/list`);
  const l = await r.json();
  return l.filter((t) => t.type === "page");
}

/** Retrouve un onglet dont l'URL contient `motif`. Rend null si absent. */
export async function retrouver(port, motif) {
  const l = await onglets(port);
  return l.find((t) => (t.url || "").includes(motif)) || null;
}

/** Ouvre un onglet neuf et rend sa cible. */
export async function ouvrir(port, url) {
  const r = await fetch(`${base(port)}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!r.ok) throw new Error(`ouverture refusee (${r.status}) : ${url}`);
  const t = await r.json();
  await patienter(900);
  return t;
}

/**
 * Retrouve l'onglet par `motif`, ou le rouvre sur `urlSecours`.
 * C'est la fonction a utiliser partout : elle absorbe la fermeture par un tiers.
 */
export async function assurer(port, motif, urlSecours) {
  const t = await retrouver(port, motif);
  if (t) return t;
  return ouvrir(port, urlSecours || motif);
}

export function patienter(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parler(ws, methode, params = {}) {
  return new Promise((res, rej) => {
    const id = Math.floor(Math.random() * 1e6);
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onMsg);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method: methode, params }));
    setTimeout(() => rej(new Error(`delai depasse : ${methode}`)), DELAI_MS);
  });
}

async function surCible(cible, fn) {
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = () => j(new Error("websocket refuse"));
  });
  try {
    return await fn(ws);
  } finally {
    ws.close();
  }
}

const JS = (expr) => ({ expression: expr, returnByValue: true, awaitPromise: true });

/**
 * Evalue `expr` dans l'onglet retrouve par `motif`.
 * Si l'onglet a disparu entre deux appels, il est rouvert sur `urlSecours` puis reessaye.
 */
export async function evaluer(port, motif, expr, { urlSecours = null, essais = 2 } = {}) {
  let derniere = null;
  for (let i = 0; i < essais; i++) {
    const t = await assurer(port, motif, urlSecours);
    if (!t) throw new Error(`onglet introuvable et non rouvrable : ${motif}`);
    try {
      return await surCible(t, async (ws) => {
        await parler(ws, "Runtime.enable");
        const r = await parler(ws, "Runtime.evaluate", JS(expr));
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "exception JS");
        return r.result.value;
      });
    } catch (e) {
      derniere = e;
      // Onglet ferme sous nos pieds : on laisse `assurer` le rouvrir au tour suivant.
      await patienter(1200);
    }
  }
  throw derniere;
}

/** Navigue l'onglet et attend que le document soit pret (pas seulement l'ordre envoye). */
export async function aller(port, motif, url, { urlSecours = null, attente = 2500 } = {}) {
  await evaluer(port, motif, `location.assign(${JSON.stringify(url)}); 'ok'`, { urlSecours });
  await patienter(attente);
  // On attend l'URL cible, sans depasser 30 s : une redirection OAuth peut allonger.
  for (let i = 0; i < 15; i++) {
    try {
      const etat = await evaluer(port, url.split("?")[0].slice(8, 40) || motif,
        "JSON.stringify({u:location.href,e:document.readyState})", { urlSecours: url });
      const { e } = JSON.parse(etat);
      if (e === "complete" || e === "interactive") return JSON.parse(etat).u;
    } catch { /* l'onglet peut etre en pleine navigation */ }
    await patienter(1000);
  }
  return null;
}

/**
 * Injecte `script` AVANT le JS de la page, puis recharge.
 *
 * ⛔ POURQUOI C'EST INDISPENSABLE. Mesure du 21/08/2026 : une console webmaster protege
 *    son API interne par un jeton anti-rejeu (X-CSRF-Token) qui n'est NI dans le DOM, NI
 *    dans un cookie, NI dans une variable globale : il vit dans la fermeture du bundle. Le
 *    seul moyen de le lire est d'ecouter l'application pendant qu'elle l'envoie. Poser
 *    l'ecouteur APRES le chargement oblige a provoquer un clic au hasard en esperant qu'il
 *    declenche un appel.
 *    Pose AVANT le premier script, il capture l'appel que l'application fait toute seule.
 */
export async function injecterAuChargement(port, motif, script, {
  urlSecours = null, apres = "1", essais = 25, pas = 1500, estBon = (v) => !!v,
} = {}) {
  const t = await assurer(port, motif, urlSecours);
  // ⛔ TOUT SE PASSE DANS UNE SEULE SESSION, ET C'EST LE POINT DUR.
  //    addScriptToEvaluateOnNewDocument est attache a la SESSION du debogueur : fermer
  //    le websocket juste apres l'avoir pose desinscrit le script, la page se recharge
  //    sans lui, et on cherche ensuite un espion qui n'a jamais existe. Premiere version
  //    de ce fichier : elle rendait « jeton introuvable apres 25 essais » sans rien dire
  //    de la vraie cause.
  return surCible(t, async (ws) => {
    await parler(ws, "Page.enable");
    await parler(ws, "Runtime.enable");
    await parler(ws, "Page.addScriptToEvaluateOnNewDocument", { source: script });
    await parler(ws, "Page.reload", { ignoreCache: false });
    for (let i = 0; i < essais; i++) {
      await patienter(pas);
      try {
        const r = await parler(ws, "Runtime.evaluate", JS(apres));
        if (estBon(r.result?.value)) return r.result.value;
      } catch { /* la page est peut-etre en pleine navigation */ }
    }
    return null;
  });
}

export async function texte(port, motif, { urlSecours = null, taille = 3000 } = {}) {
  return evaluer(
    port,
    motif,
    `JSON.stringify({url:location.href, txt:document.body.innerText.replace(/\\n{2,}/g,'\\n').trim().slice(0,${taille})})`,
    { urlSecours }
  );
}

// ---------------------------------------------------------------- ligne de commande
// ⛔ Sous Windows, comparer import.meta.url a "file://" + argv[1] NE MARCHE PAS des que le
//    chemin contient un espace : pathToFileURL l'encode en %20, et il manque un slash. Le
//    bloc ne s'executait jamais, donc le script rendait zero ligne, sans la moindre erreur.
const { pathToFileURL } = await import("node:url");
// ⛔ argv[1] est INDEFINI quand le module est importe depuis « node -e » : sans la
//    garde, pathToFileURL leve et le module devient inimportable hors ligne de commande.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [port, action, a1, a2] = process.argv.slice(2);
  if (action === "onglets") {
    (await onglets(port)).forEach((t) => console.log(t.id.slice(0, 8), "|", (t.url || "").slice(0, 110)));
  } else if (action === "ouvrir") {
    const t = await ouvrir(port, a1);
    console.log(t.id, "|", t.url);
  } else if (action === "texte") {
    console.log(await texte(port, a1, { urlSecours: a2 }));
  } else if (action === "eval") {
    const v = await evaluer(port, a1, a2);
    console.log(typeof v === "object" ? JSON.stringify(v, null, 1) : String(v));
  } else if (action === "aller") {
    console.log(await aller(port, a1, a2));
  } else {
    console.log("actions : onglets | ouvrir <url> | texte <motif> | eval <motif> <js> | aller <motif> <url>");
  }
}
