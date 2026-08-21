// DEPLOIEMENT DU TABLEAU DE BORD SUR CLOUDFLARE PAGES.
//
// Cloudflare Pages est gratuit et sans plafond de deploiements, la ou d'autres
// hebergeurs comptent des credits par mise en production (15 credits sur 300 par mois
// chez l'un d'eux, soit 20 deploiements maximum). C'est la seule raison du choix.
//
// ⛔ LE SITE EXPOSE VOTRE ANALYSE DES CONCURRENTS. Il est protege par une
//    authentification HTTP Basic posee par functions/_middleware.js, avec l'identifiant
//    et le mot de passe dans les variables d'environnement du projet Cloudflare, jamais
//    dans le depot.
//
// ⛔ QUATRE PIEGES DE CLOUDFLARE PAGES, tous silencieux, tous deja payes :
//    1. Le GLISSER-DEPOSER dans le tableau de bord NE COMPILE PAS le dossier `functions`.
//       Le site part alors EN CLAIR, sans authentification, et rien ne le signale.
//       On deploie donc par wrangler, jamais a la main.
//    2. Les variables d'environnement de PREVIEW sont un jeu DISTINCT de celles de
//       PRODUCTION. Une preversion sans mot de passe est un site public, et son URL est
//       aussi previsible que celle de la production.
//    3. « Fail open » est le comportement par defaut des Functions : quota epuise = le
//       site est servi SANS le middleware, donc en clair. Il faut basculer
//       Settings > Runtime sur « Fail closed ». Ce reglage n'est pas dans l'API Pages,
//       il se fait a la main une fois, et --verifier ne peut pas le tester.
//    4. Le NOM DU PROJET DEVIENT PUBLIC par les journaux de Transparence des Certificats.
//       Personne n'a besoin de deviner l'URL : elle est publiee automatiquement des le
//       premier certificat, et ces journaux sont interrogeables par n'importe qui.
//       Prenez donc un nom qui ne raconte rien, du genre « <mot neutre>-<suite au hasard> »,
//       plutot que « <votre-marque>-concurrents », qui se lirait tout seul. Le mot de passe
//       reste la seule protection ; un nom obscur ne fait que ne pas attirer l'oeil.
//
// ⛔ AUCUN SECRET DANS CE FICHIER NI DANS LE DEPOT. Tout vient de l'environnement, et
//    une variable manquante ARRETE le programme au lieu de deployer a moitie :
//      CLOUDFLARE_API_TOKEN    jeton d'API portant le droit Pages
//      CLOUDFLARE_ACCOUNT_ID   identifiant de votre compte Cloudflare
//      CLOUDFLARE_PROJET       nom du projet Pages
//      VIGIE_UTILISATEUR       identifiant du site, pour le controle d'apres coup
//      VIGIE_MOTDEPASSE        mot de passe du site, idem
//    Une cle poussee sur GitHub est aspiree par des robots en quelques minutes, et
//    l'historique la garde meme retiree au commit suivant.
//
// Usage (Node 20.6+ sait lire un .env tout seul) :
//   node --env-file=.env outils/deployer.mjs               construit puis deploie
//   node --env-file=.env outils/deployer.mjs --verifier    controle seulement, apres coup
//   node --env-file=.env outils/deployer.mjs --sans-build  deploie ce qui est deja dans site/

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { RACINE } from "./_lib-obs.mjs";

/** Une variable d'environnement obligatoire, ou un arret qui dit laquelle manque. */
function requis(nom, aQuoiCaSert) {
  const v = process.env[nom];
  if (!v) {
    console.error(
      `${nom} n'est pas defini. C'est ${aQuoiCaSert}.\n` +
      `  Copiez .env.exemple en .env, remplissez-le, puis lancez :\n` +
      `    node --env-file=.env outils/deployer.mjs`
    );
    process.exit(1);
  }
  return v;
}

const PROJET = requis("CLOUDFLARE_PROJET", "le nom de votre projet Cloudflare Pages");
const URL_SITE = (process.env.VIGIE_URL || `https://${PROJET}.pages.dev`).replace(/\/+$/, "");
const DOSSIER_SITE = process.env.VIGIE_SORTIE
  ? path.resolve(process.env.VIGIE_SORTIE)
  : path.join(RACINE, "site");

const VERIFIER_SEUL = process.argv.includes("--verifier");
const SANS_BUILD = process.argv.includes("--sans-build");

function identifiants() {
  return {
    utilisateur: requis("VIGIE_UTILISATEUR", "l'identifiant qui ouvre le site"),
    motDePasse: requis("VIGIE_MOTDEPASSE", "le mot de passe qui ouvre le site"),
  };
}

async function verifier() {
  const { utilisateur, motDePasse } = identifiants();
  const auth = "Basic " + Buffer.from(`${utilisateur}:${motDePasse}`).toString("base64");
  // ⛔ Quatre epreuves, et la troisieme est la plus importante : un middleware mal
  //    configure protege l'accueil et laisse passer les fichiers statiques.
  const epreuves = [
    { nom: "accueil sans identifiants", url: `${URL_SITE}/`, entetes: {}, attendu: 401 },
    { nom: "robots.txt sans identifiants", url: `${URL_SITE}/robots.txt`, entetes: {}, attendu: 401 },
    { nom: "fichier statique sans identifiants", url: `${URL_SITE}/donnees.json`, entetes: {}, attendu: 401 },
    { nom: "accueil AVEC identifiants", url: `${URL_SITE}/`, entetes: { authorization: auth }, attendu: 200 },
  ];
  let tout = true;
  console.log(`\nControle de ${URL_SITE}`);
  for (const e of epreuves) {
    let code = null, entetes = {};
    try {
      const r = await fetch(e.url, { headers: e.entetes, redirect: "manual" });
      code = r.status;
      entetes = { "x-robots-tag": r.headers.get("x-robots-tag"), "www-authenticate": r.headers.get("www-authenticate") };
    } catch (err) { code = `ERREUR ${String(err.message).slice(0, 40)}`; }
    const ok = code === e.attendu;
    tout = tout && ok;
    console.log(`  ${ok ? "OK  " : "ECHEC"} ${String(code).padEnd(6)} (attendu ${e.attendu})  ${e.nom}` +
      (entetes["x-robots-tag"] ? `   x-robots-tag: ${entetes["x-robots-tag"]}` : ""));
  }
  console.log(tout
    ? "\nLe site est en ligne et ferme a qui n'a pas le mot de passe."
    : "\n⛔ UN CONTROLE A ECHOUE. Un 200 sans identifiants veut dire que le site est PUBLIC : " +
      "verifier que le dossier functions/ est bien parti (jamais de glisser-deposer) et que " +
      "les variables existent en production ET en preview.");
  return tout;
}

if (VERIFIER_SEUL) {
  process.exit((await verifier()) ? 0 : 1);
}

if (!SANS_BUILD) {
  console.log("Construction du site depuis le journal d'observations…");
  execFileSync(process.execPath, [path.join(RACINE, "outils", "site.mjs")], { stdio: "inherit" });
}

if (!fs.existsSync(path.join(DOSSIER_SITE, "index.html"))) {
  console.error(`Rien a deployer : ${path.join(DOSSIER_SITE, "index.html")} n'existe pas.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(DOSSIER_SITE, "functions", "_middleware.js"))) {
  // ⛔ Deployer sans le middleware publierait l'analyse des concurrents EN CLAIR.
  //    On refuse, plutot que de laisser la verification d'apres coup le decouvrir.
  console.error("REFUS DE DEPLOYER : functions/_middleware.js est absent, le site partirait sans mot de passe.");
  process.exit(1);
}

// On exige les identifiants AVANT de deployer : decouvrir qu'ils manquent apres coup
// laisserait en ligne un site qu'on ne saurait pas controler.
identifiants();
const JETON = requis("CLOUDFLARE_API_TOKEN", "le jeton d'API Cloudflare portant le droit Pages");
const COMPTE = requis("CLOUDFLARE_ACCOUNT_ID", "l'identifiant de votre compte Cloudflare");

console.log(`\nDeploiement sur ${PROJET}…`);
// ⛔ Sous Windows, execFileSync sur un .cmd leve EINVAL depuis Node 20 : les fichiers de
//    commandes ne sont plus lancables sans interprete. Il faut passer par le shell, et
//    donc guillemeter tout chemin qui contient un espace.
// ⛔ ON LANCE WRANGLER DEPUIS LE DOSSIER DU SITE, ET C'EST LE PIEGE LE PLUS GRAVE DE
//    CE FICHIER. Wrangler cherche le dossier `functions` dans son REPERTOIRE COURANT,
//    pas dans le dossier d'assets qu'on lui passe. Mesure du 21/08/2026 a 04h12 : lance
//    depuis la racine du depot, il a televerse les 29 pages, ecrit « Success », et n'a
//    JAMAIS compile le middleware. Le site est parti EN CLAIR, avec l'analyse des
//    concurrents dessus, et rien dans sa sortie ne le disait. La seule alerte est venue
//    du controle d'apres coup, qui a lu 200 la ou il attendait 401.
//    Le signe qu'il a bien compile : la ligne « ✨ Compiled Worker successfully » puis
//    « ✨ Uploading Functions bundle ». Si elles manquent, le site est public.
const sortie = execSync(
  `npx --yes wrangler@latest pages deploy . ` +
  `--project-name=${PROJET} --branch=main --commit-dirty=true`,
  {
    cwd: DOSSIER_SITE,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, CLOUDFLARE_API_TOKEN: JETON, CLOUDFLARE_ACCOUNT_ID: COMPTE },
  }
);
console.log(sortie);
if (!/Functions bundle/.test(sortie)) {
  console.error(
    "\n⛔ WRANGLER N'A PAS COMPILE LE DOSSIER functions. Le deploiement qui vient de partir\n" +
    "   est PUBLIC. Supprimez-le immediatement dans le tableau de bord Cloudflare, ou par\n" +
    "   l'API DELETE .../pages/projects/" + PROJET + "/deployments/<id>?force=true"
  );
}

// Le CDN peut servir un edge en cache pendant une minute ou deux.
await new Promise((r) => setTimeout(r, 8000));
const ok = await verifier();
process.exit(ok ? 0 : 1);
