// LES DOMAINES QUI POINTENT VERS UNE CIBLE, LUS DANS LE GRAPHE DU WEB.
//
// C'est la vue « domaines referents » des outils payants, obtenue par la meme methode
// qu'eux : un crawl a l'echelle du web. La difference est qu'on n'a pas paye le crawl,
// on lit celui de Common Crawl, refait chaque trimestre.
//
// ⛔ LE FICHIER DES ARETES EST TRIE PAR SOURCE, ET ON CHERCHE PAR CIBLE.
//    Il n'y a donc PAS de raccourci : chaque passe lit les 2,7 milliards d'aretes en
//    entier, soit environ vingt minutes. C'est le fait central qui dicte toute
//    l'organisation du service.
//
// ⛔ ET C'EST AUSSI CE QUI REND LE TRAITEMENT PAR LOT OBLIGATOIRE, PAS OPTIONNEL.
//    Chercher une cible coute vingt minutes. En chercher CINQUANTE MILLE coute les
//    memes vingt minutes, parce que le test d'appartenance a un ensemble est immediat.
//    Une passe par demande serait un gaspillage d'un facteur cinquante mille.
//
// ⛔ ET LA RESOLUTION DES NOMS NE SE FAIT PAS PAR DICHOTOMIE.
//    Une passe rend souvent des centaines de milliers d'identifiants sources distincts.
//    Quinze lectures de disque chacun, ce sont des millions d'acces au hasard. Comme le
//    fichier des sommets est trie par identifiant, on trie les identifiants une fois et
//    on balaie le fichier UNE SEULE FOIS en sequentiel. Trente secondes au lieu d'une
//    heure.
//
// Usage :
//   node serveur/graphe-referents.mjs --cibles=exemple.com,autre.com
//   node serveur/graphe-referents.mjs --fichier=cibles.txt --sortie=referents.json
//   node serveur/graphe-referents.mjs --cibles=exemple.com --plafond=2000

import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import { FICHIERS } from "./graphe-telecharger.mjs";
import { SOMMETS_TXT, ouvrirSommets, idDeDomaine, remettre } from "./graphe-index.mjs";

const arg = (nom, defaut = null) => {
  const t = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return t ? t.slice(nom.length + 3) : defaut;
};

/*
  ⛔ DEUX PLAFONDS EN SERIE, ET C'EST LE PLUS BAS QUI DECIDE.
     Le 22/08/2026, j'ai porte le plafond de la poussee vers D1 de 500 a 3 000 et j'ai cru
     le probleme regle. La passe suivante a sorti myfxbook et tradingview a EXACTEMENT
     2 000 : 500 de l'ancienne passe plus 1 500 de la nouvelle. Le meme chiffre rond
     qu'avant, pour une autre cause.

     La lecture du graphe coupait ICI, a 1 500, avant que le plafond de D1 ne s'applique.
     Relever un plafond en aval sans regarder l'amont ne change rien, et la rondeur de la
     valeur est le seul indice qu'il reste un couperet plus haut dans la chaine.

     Les deux valent desormais 3 000, pour qu'il n'y en ait qu'un. tradingview restera
     marque « plancher » — le graphe lui connait 36 891 referents — et l'ecran l'affiche
     avec un « ≥ ». Un plancher assume vaut mieux qu'un total invente.
*/
export const PLAFOND_DEFAUT = 3000;

/**
 * Pour chaque cible, la liste des domaines qui pointent vers elle.
 * `journal` recoit les messages d'avancement (console.log par defaut).
 */
export async function referentsDe(domaines, options = {}) {
  const plafond = options.plafond || PLAFOND_DEFAUT;
  const journal = options.journal || ((m) => console.log(m));

  const { fd, taille } = ouvrirSommets();

  // 1. Les cibles, converties en identifiants.
  const idParCible = new Map();
  const cibleParId = new Map();
  const absentes = [];
  for (const d of domaines) {
    const id = idDeDomaine(fd, taille, d);
    if (id === null) { absentes.push(d); continue; }
    idParCible.set(d, id);
    cibleParId.set(id, d);
  }
  journal(`${idParCible.size} cible(s) presente(s) dans le graphe, ${absentes.length} absente(s)`);

  if (!idParCible.size) {
    fs.closeSync(fd);
    // ⛔ « ABSENT DU GRAPHE » EST UNE MESURE, PAS UN ZERO. Un domaine cree apres la
    //    derniere edition trimestrielle n'y est pas encore : ca ne dit rien de ses
    //    backlinks, ca dit que cette source-la ne peut pas repondre.
    return { referents: new Map(), absentes, aretes_lues: 0, etat: "ANGLE_MORT" };
  }

  // 2. La passe sur les aretes. Une seule, quelle que soit la taille du lot.
  const cibles = new Set(cibleParId.keys());
  const parCible = new Map([...cibles].map((id) => [id, []]));
  const debordement = new Map();
  let lues = 0;
  const debut = Date.now();

  const flux = readline.createInterface({
    input: fs.createReadStream(FICHIERS.aretes.local, { highWaterMark: 1 << 22 }).pipe(
      zlib.createGunzip({ chunkSize: 1 << 22 })
    ),
    crlfDelay: Infinity,
  });

  for await (const ligne of flux) {
    lues++;
    if ((lues & 0x3ffffff) === 0) {
      const min = (Date.now() - debut) / 60000;
      journal(`  ${(lues / 1e6).toFixed(0)} M aretes lues en ${min.toFixed(1)} min`);
    }
    // « source <TAB> cible ». On coupe a la main : split() sur 2,7 milliards de lignes
    // alloue 2,7 milliards de tableaux.
    const t = ligne.indexOf("\t");
    if (t < 0) continue;
    const dst = +ligne.slice(t + 1);
    if (!cibles.has(dst)) continue;
    const liste = parCible.get(dst);
    if (liste.length >= plafond) {
      debordement.set(dst, (debordement.get(dst) || 0) + 1);
      continue;
    }
    liste.push(+ligne.slice(0, t));
  }
  journal(`${(lues / 1e6).toFixed(0)} M aretes lues en ${((Date.now() - debut) / 60000).toFixed(1)} min`);

  // 3. Resolution des identifiants sources en noms, en UN balayage sequentiel.
  const aResoudre = new Set();
  for (const liste of parCible.values()) for (const id of liste) aResoudre.add(id);
  journal(`${aResoudre.size} domaine(s) source distinct(s) a nommer`);

  const noms = new Map();
  if (aResoudre.size) {
    const tries = [...aResoudre].sort((a, b) => a - b);
    let i = 0;
    const lecture = readline.createInterface({
      input: fs.createReadStream(SOMMETS_TXT, { highWaterMark: 1 << 22 }),
      crlfDelay: Infinity,
    });
    for await (const ligne of lecture) {
      if (i >= tries.length) break;
      const t1 = ligne.indexOf("\t");
      if (t1 < 0) continue;
      const id = +ligne.slice(0, t1);
      if (id < tries[i]) continue;
      while (i < tries.length && tries[i] < id) i++;      // identifiant absent du fichier
      if (i < tries.length && tries[i] === id) {
        const t2 = ligne.indexOf("\t", t1 + 1);
        noms.set(id, remettre(ligne.slice(t1 + 1, t2 < 0 ? undefined : t2)));
        i++;
      }
    }
    lecture.close();
  }
  fs.closeSync(fd);

  // 4. Mise en forme.
  const referents = new Map();
  for (const [idCible, liste] of parCible) {
    const cible = cibleParId.get(idCible);
    referents.set(cible, {
      domaines: liste.map((id) => noms.get(id)).filter(Boolean),
      tronque: debordement.get(idCible) || 0,
      plafond,
    });
  }

  return { referents, absentes, aretes_lues: lues, etat: "MESURE" };
}

/* --------------------------------------------------------------------- main */

if (process.argv[1] && process.argv[1].endsWith("graphe-referents.mjs")) {
  const fichier = arg("fichier");
  const brut = fichier
    ? fs.readFileSync(fichier, "utf8").split(/\r?\n/)
    : String(arg("cibles", "")).split(",");
  const cibles = [...new Set(brut.map((d) => d.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean))];

  if (!cibles.length) {
    console.error("usage : node serveur/graphe-referents.mjs --cibles=exemple.com[,autre.com]");
    console.error("        node serveur/graphe-referents.mjs --fichier=cibles.txt");
    process.exit(2);
  }

  console.log(`${cibles.length} cible(s) demandee(s)`);
  const r = await referentsDe(cibles, { plafond: Number(arg("plafond", PLAFOND_DEFAUT)) });

  const sortie = arg("sortie");
  const objet = {
    edition: process.env.VIGIE_CRAWL || "cc-main-2026-may-jun-jul",
    mesure_le: new Date().toISOString(),
    etat: r.etat,
    aretes_lues: r.aretes_lues,
    absentes_du_graphe: r.absentes,
    cibles: Object.fromEntries([...r.referents].map(([c, v]) => [c, v])),
  };

  if (sortie) {
    fs.writeFileSync(sortie, JSON.stringify(objet, null, 1));
    console.log(`\necrit dans ${sortie}`);
  }

  console.log("\n=== bilan ===");
  for (const [cible, v] of r.referents) {
    console.log(
      `${cible.padEnd(28)} ${String(v.domaines.length).padStart(6)} domaine(s) referent(s)` +
        (v.tronque ? `  (+${v.tronque} au-dela du plafond de ${v.plafond})` : "")
    );
    for (const d of v.domaines.slice(0, 8)) console.log(`    - ${d}`);
    if (v.domaines.length > 8) console.log(`    … et ${v.domaines.length - 8} autres`);
  }
  for (const d of r.absentes) console.log(`${d.padEnd(28)} ▲ absent de cette edition du graphe`);
}
