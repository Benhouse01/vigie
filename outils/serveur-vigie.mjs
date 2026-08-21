// LE PETIT SERVEUR LOCAL : ce qui permet au bouton du tableau de bord de lancer un crawl.
//
// ⛔ POURQUOI IL EXISTE. Le tableau de bord de la Vigie est un site STATIQUE : il n'a
//    aucune machine derriere lui, donc il ne peut rien lancer. Le bouton « crawler ce
//    domaine » appelle donc ce serveur-ci, qui tourne sur VOTRE machine, et qui lance le
//    robot dans un processus fils.
//
// ⛔ CE PROGRAMME LANCE DES PROCESSUS SUR ORDRE D'UNE PAGE WEB. Toute la suite decoule
//    de cette phrase. Quatre garde-fous la rendent tenable, ils sont numerotes dans le
//    code, et aucun des quatre n'est decoratif.
//
//    1. IL N'ECOUTE QUE SUR 127.0.0.1, JAMAIS SUR 0.0.0.0.
//       Une seule adresse separe les deux, et elle separe « joignable par moi » de
//       « joignable par tout le reseau » : le wifi partage, la machine invitee, le
//       conteneur voisin, le port redirige par une box. Un serveur qui lance des
//       processus n'a rien a faire sur une interface reseau.
//
//    2. LE DOMAINE DOIT AVOIR LA FORME D'UN DOMAINE, ET RIEN D'AUTRE.
//       La chaine vient du navigateur. Elle est confrontee a une expression reguliere
//       stricte AVANT de servir a quoi que ce soit. Pas d'espace, pas de point-virgule,
//       pas de barre oblique, pas de guillemet. Et elle ne rencontre jamais de shell :
//       spawn() recoit un tableau d'arguments, il n'y a pas de ligne de commande a casser.
//
//    3. LE DOMAINE DOIT DEJA ETRE DANS VOTRE CONFIGURATION.
//       Bien forme ne suffit pas. Un domaine inconnu est REFUSE, meme parfaitement ecrit.
//       Sans ce filtre, n'importe quelle page ouverte dans votre navigateur pourrait faire
//       partir un crawl depuis votre adresse IP vers un site de son choix, et c'est vous
//       qui figureriez dans les journaux de ce site. Pour ajouter un domaine, il passe par
//       config/domaines.json, qui se lit, se relit et se versionne.
//
//    4. UN SEUL CRAWL A LA FOIS.
//       Deux robots en parallele sur la meme connexion, c'est le plus sur moyen de faire
//       bannir votre adresse IP par les sites que vous cherchez justement a convaincre de
//       vous publier. Une demande qui arrive pendant un crawl recoit 409, pas une file.
//
// ⛔ ET LE CORS N'EST PAS UNE PROTECTION, IL NE FAUT SURTOUT PAS LE CROIRE. L'en-tete
//    Access-Control-Allow-Origin vaut « * » ici parce que le tableau de bord est publie
//    sur VOTRE domaine, que ce serveur ne connait pas. Or un en-tete CORS ne s'impose qu'a
//    un navigateur : un client qui n'en est pas un l'ignore purement et simplement. La
//    protection reelle est donc entierement du cote serveur, et c'est exactement le role
//    des garde-fous 1 a 4.
//
// ⛔ POURQUOI UNE PAGE EN HTTPS A LE DROIT D'APPELER http://127.0.0.1. Les navigateurs
//    traitent 127.0.0.1 comme une origine de confiance et ne bloquent pas ces appels comme
//    du contenu mixte. C'est la seule adresse pour laquelle c'est vrai : le meme montage
//    avec l'adresse de la machine sur le reseau local serait bloque, et c'est tant mieux.
//
// Usage :
//   node outils/serveur-vigie.mjs                (port VIGIE_PORT, sinon 9788)
//   node outils/serveur-vigie.mjs --port=9788
//
// Points d'entree :
//   GET  /vigie/etat                     ce que fait le serveur, et le dernier crawl
//   POST /vigie/crawler {domaine}        lance un crawl, rend son identifiant
//   GET  /vigie/journal                  les 60 dernieres lignes du crawl en cours

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config, RACINE } from "./_lib-obs.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => ((process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1]) || d;

// Le port se choisit en trois temps : --port= sur la ligne de commande, puis VIGIE_PORT,
// puis 9788. La ligne de commande gagne, pour qu'un second serveur puisse etre lance sans
// toucher au .env de la machine.
const PORT_DEMANDE = arg("port", process.env.VIGIE_PORT || "9788");
const PORT = Number(PORT_DEMANDE);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  // Un port illisible ne doit pas devenir un 0, que le systeme interpreterait comme
  // « choisis-en un au hasard » : le bouton du tableau de bord appellerait alors dans le
  // vide sans que rien n'ait l'air casse.
  console.error(`port invalide : « ${PORT_DEMANDE} ». Attendu un entier entre 1 et 65535.`);
  process.exit(1);
}
const JOURNAL = path.join(ICI, ".cache", "robot-sortie.log");
fs.mkdirSync(path.dirname(JOURNAL), { recursive: true });

// GARDE-FOU 4 : un seul crawl a la fois. Cette variable EST le verrou.
let enCours = null;   // { domaine, demarre, processus }

// GARDE-FOU 2 : la forme. Le domaine vient du navigateur, donc il ne sert a rien tant
// qu'il n'a pas la forme d'un domaine. Pas d'espace, pas de point-virgule, pas de barre
// oblique, pas de guillemet.
const FORME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// GARDE-FOU 3 : la liste blanche. On relit la configuration a CHAQUE demande, et non une
// fois au demarrage : ajouter un domaine ne doit pas obliger a redemarrer le serveur, et
// en retirer un doit prendre effet immediatement.
function connus() {
  const c = config();
  return new Set([...c.nous, ...c.concurrents, ...c.spots].map((d) => d.domaine));
}

const entetes = {
  // ⛔ CE N'EST PAS UNE PROTECTION. Le tableau de bord est publie sur votre domaine, que
  //    ce serveur ne connait pas, d'ou l'etoile. Un en-tete CORS ne contraint qu'un
  //    navigateur ; ce qui protege vraiment, ce sont les garde-fous 1 a 4.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const repondre = (res, code, corps) => {
  res.writeHead(code, entetes);
  res.end(JSON.stringify(corps));
};

function etat() {
  let dernier = null;
  const f = path.join(ICI, ".cache", "robot-etat.json");
  if (fs.existsSync(f)) { try { dernier = JSON.parse(fs.readFileSync(f, "utf8")); } catch {} }
  return {
    serveur: `vigie ${PORT}`,
    occupe: !!enCours,
    enCours: enCours ? { domaine: enCours.domaine, demarre: enCours.demarre } : null,
    dernierCrawl: dernier,
  };
}

const serveur = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "OPTIONS") { res.writeHead(204, entetes); return res.end(); }

  if (u.pathname === "/vigie/etat") return repondre(res, 200, etat());

  if (u.pathname === "/vigie/journal") {
    const l = fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, "utf8").split("\n").slice(-60) : [];
    return repondre(res, 200, { lignes: l });
  }

  if (u.pathname === "/vigie/crawler" && req.method === "POST") {
    let corps = "";
    req.on("data", (c) => { corps += c; if (corps.length > 4000) req.destroy(); });
    req.on("end", () => {
      let d;
      try { d = String(JSON.parse(corps || "{}").domaine || "").trim().toLowerCase().replace(/^www\./, ""); }
      catch { return repondre(res, 400, { erreur: "corps illisible" }); }

      // GARDE-FOU 2 : la forme, avant tout le reste.
      if (!FORME.test(d)) {
        return repondre(res, 400, { erreur: `« ${d.slice(0, 60)} » n'a pas la forme d'un domaine. Rien n'a ete lance.` });
      }
      // GARDE-FOU 3 : bien forme ne suffit pas. Un domaine inconnu est refuse meme
      //    parfaitement ecrit, sinon n'importe quelle page ouverte dans le navigateur
      //    ferait partir un crawl depuis cette adresse IP vers le site de son choix.
      if (!connus().has(d)) {
        return repondre(res, 403, { erreur: `${d} n'est pas dans votre configuration. Ajoutez-le a config/domaines.json d'abord : on ne crawle pas un domaine sur simple demande d'une page web.` });
      }
      // GARDE-FOU 4 : on refuse, on ne met pas en file d'attente. Une file finirait par
      //    lancer le crawl bien plus tard, sans personne devant l'ecran pour l'arreter.
      if (enCours) {
        return repondre(res, 409, { erreur: `un crawl tourne deja sur ${enCours.domaine}. Un seul a la fois : deux robots sur la meme connexion font bannir l'adresse IP.` });
      }

      fs.writeFileSync(JOURNAL, "", "utf8");
      const flux = fs.createWriteStream(JOURNAL, { flags: "a" });
      const p = spawn(process.execPath, [
        path.join(ICI, "robot-backlinks.mjs"),
        `--cible=${d}`, "--pages=700", "--minutes=25", "--hotes=500", "--delai=1400",
      ], { cwd: RACINE, stdio: ["ignore", "pipe", "pipe"] });
      p.stdout.pipe(flux);
      p.stderr.pipe(flux);
      enCours = { domaine: d, demarre: new Date().toISOString(), processus: p };
      p.on("exit", (code) => {
        flux.end(`\n[serveur] robot termine, code ${code}\n`);
        enCours = null;
      });
      repondre(res, 202, { lance: true, domaine: d, message: `crawl lance sur ${d}. Suis l'avance avec /vigie/journal.` });
    });
    return;
  }

  repondre(res, 404, { erreur: "chemin inconnu" });
});

// GARDE-FOU 1 : 127.0.0.1, et surtout pas 0.0.0.0. Le second argument de listen() est ce
//    qui separe « joignable par moi » de « joignable par tout le reseau ». Ce serveur
//    lance des processus : il ne doit etre joignable ni depuis le reseau local, ni depuis
//    l'exterieur, jamais, pas meme « juste pour essayer depuis le telephone ».
serveur.listen(PORT, "127.0.0.1", () => {
  console.log(`Vigie — serveur local sur http://127.0.0.1:${PORT}`);
  console.log(`  GET  /vigie/etat`);
  console.log(`  GET  /vigie/journal`);
  console.log(`  POST /vigie/crawler  {"domaine":"exemple.com"}   (un domaine deja present dans votre configuration)`);
  console.log(`\nLaisse cette fenetre ouverte : le bouton du site appelle ce serveur.`);
});
