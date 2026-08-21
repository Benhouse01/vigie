// NOS VRAIES POSITIONS, PAR SEARCH CONSOLE.
//
// C'est la seule source du projet qui MESURE au lieu d'estimer, et elle ne vaut que pour
// nos propres domaines. Clics, impressions, taux de clic et position moyenne, releves par
// Google lui-meme, geo-neutres et non personnalises. Aucun scraping, aucun blocage
// d'adresse IP, aucune localisation a forcer.
//
// ⛔ POURQUOI ELLE NE REMPLACE PAS LE RELEVE DE SERP. Search Console ne montre QUE notre
//    site. Elle ne dit jamais qui d'autre est classe sur la requete, donc elle ne sert a
//    rien pour comparer des concurrents. Les deux sources se completent : Search Console
//    pour savoir ou NOUS sommes, le releve de SERP pour savoir qui est devant.
//
// ⛔ ELLE ACCUSE TROIS JOURS DE RETARD. Le 19/08/2026, la derniere donnee disponible
//    datait du 16/08. Chaque ligne porte donc sa date_donnee, distincte de la date de
//    lecture : sans ca, le site presenterait une donnee de trois jours comme celle du jour.
//
// ⛔ LA POSITION EST UNE MOYENNE PONDEREE PAR LES IMPRESSIONS, pas un rang observe. Une
//    position 8,4 ne veut pas dire « huitieme » : elle veut dire que sur toutes les fois
//    ou la page a ete servie, sa place moyenne etait 8,4. Le site doit l'ecrire ainsi.
//
// ⛔ ET LE RAPPORT LIENS DE SEARCH CONSOLE EST UN PLANCHER, JAMAIS UN COMPTE. Le 16/08 il
//    annoncait 24 liens et omettait un dofollow pose sur la page partenaires d'un editeur,
//    parfaitement crawlable et verifie dans le HTML brut. Ce collecteur ne lit donc PAS
//    le rapport Liens : Bing en donne davantage et sans faux plafond de ce genre.
//
// ⛔ CE COLLECTEUR DELEGUE LA LECTURE DE L'ECRAN A UN OUTIL EXTERNE, que vous devez
//    fournir : VIGIE_GSC_OUTIL doit pointer sur un script Node qui ouvre l'ecran
//    « Performances » du Chrome pilote et rend le tableau en lignes
//    « requete | clics | impressions | CTR | position ». Ce n'est pas de la paresse :
//    le tableau se charge par paquets et il faut descendre jusqu'a ce qu'il cesse de
//    grandir, ce qui demande un pilote complet. Ecrire une seconde implementation a cote
//    creerait deux verites sur le meme ecran.
//
// Usage :
//   CDP_URL=http://127.0.0.1:9674 VIGIE_GSC_OUTIL=./mon-lecteur-gsc.mjs \
//     node outils/collecte-gsc.mjs [--lignes=200] [--dry]

import path from "node:path";
import { execFileSync } from "node:child_process";
import { observation, ecrire, nouveauRun, config } from "./_lib-obs.mjs";

const VERSION = "collecte-gsc@1.0.0";

const CDP = process.env.CDP_URL;
if (!CDP) {
  console.error(
    "CDP_URL est obligatoire.\n" +
    "  Lancez un Chrome dedie, sur un port dedie et un profil dedie, connectez-vous a\n" +
    "  Search Console, puis :\n" +
    "  CDP_URL=http://127.0.0.1:9674 node outils/collecte-gsc.mjs"
  );
  process.exit(1);
}

const arg = (n, d = null) => {
  const v = (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  return v === undefined ? d : v;
};
const DRY = process.argv.includes("--dry");
const LIGNES = Number(arg("lignes", 200));

const cfg = config();
const notre = cfg.nous.find((d) => d.gsc);
if (!notre) {
  console.error("aucun domaine de la configuration ne porte de propriete Search Console (champ gsc).");
  process.exit(1);
}

// ⛔ LE CHEMIN DU LECTEUR VIENT DE L'ENVIRONNEMENT, JAMAIS D'UNE CONSTANTE. Ecrit en dur,
//    il pointerait sur l'arborescence de celui qui a ecrit le fichier, et le collecteur
//    echouerait chez tout le monde en accusant Search Console.
const OUTIL = process.env.VIGIE_GSC_OUTIL
  ? path.resolve(process.env.VIGIE_GSC_OUTIL)
  : null;
if (!OUTIL) {
  console.error(
    "VIGIE_GSC_OUTIL n'est pas defini.\n" +
    "  Ce collecteur delegue la lecture de l'ecran a un script de pilotage que vous\n" +
    "  fournissez. Il doit accepter un nombre de lignes en argument, lire CDP_URL dans\n" +
    "  son environnement, et ecrire sur sa sortie standard des lignes de la forme :\n" +
    "    requete | clics | impressions | CTR | position"
  );
  process.exit(1);
}

console.log(`Vigie SEO — Search Console · ${notre.domaine} · ${LIGNES} lignes max${DRY ? " · --dry" : ""}`);
console.log(`Chrome pilote : ${CDP}\n`);

let brut;
try {
  brut = execFileSync(process.execPath, [OUTIL, String(LIGNES)], {
    cwd: path.dirname(OUTIL),
    encoding: "utf8",
    timeout: 240000,
    env: { ...process.env, CDP_URL: CDP },
  });
} catch (e) {
  const raison = String(e.stderr || e.message || e).replace(/\s+/g, " ").slice(0, 200);
  // ⛔ Un echec de lecture s'ECRIT. Sans cette ligne, le site afficherait « aucune
  //    position » et on chercherait une chute de classement la ou il n'y a qu'un ecran
  //    qui n'a pas repondu.
  const o = observation({
    type: "position", sujet: { domaine: notre.domaine, pays: "toutes" },
    metrique: "requetes_search_console", etat: "ANGLE_MORT", nature: "mesure_absente",
    source: { nom: "search_console", endpoint: "performance/search-analytics?breakdown=query", http: null, methode: "cdp" },
    preuve: `lecture impossible : ${raison}`,
    run_id: nouveauRun("gsc"), collecteur: VERSION, drapeaux: ["gsc_illisible"],
  });
  console.error(`ECHEC : ${raison}`);
  if (!DRY) ecrire(o);
  process.exit(1);
}

// Format rendu par l'outil : « requete | clics | impressions | CTR | position »
const lignes = brut.split("\n")
  .map((l) => l.trim())
  .filter((l) => l.includes("|") && !/^requ.te \| clics/i.test(l) && !/^-+$/.test(l));

const nombre = (s) => {
  if (s == null) return null;
  const n = Number(String(s).replace(/\s| /g, "").replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const run = nouveauRun("gsc");
const obs = [];
let avecPosition = 0;

for (const l of lignes) {
  const c = l.split("|").map((x) => x.trim());
  if (c.length < 5) continue;
  const [requete, clics, impressions, ctr, position] = c;
  if (!requete) continue;
  const pos = nombre(position);
  const base = { domaine: notre.domaine, requete, pays: "toutes", device: "tous" };
  const src = { nom: "search_console", endpoint: "performance/search-analytics?breakdown=query", http: 200, methode: "cdp" };

  if (pos != null) {
    avecPosition++;
    obs.push(observation({
      type: "position", sujet: base, metrique: "position",
      valeur: pos, unite: "rang", nature: "mesure", etat: "MESURE",
      source: src,
      preuve: `position MOYENNE ponderee par les impressions, pas un rang observe : ${position} sur ${impressions} impression(s)`,
      run_id: run, collecteur: VERSION,
      drapeaux: ["position_moyenne_pas_un_rang", "donnee_differee_3_jours"],
    }));
  }
  for (const [metrique, valeur, unite] of [
    ["clics", nombre(clics), "clic"],
    ["impressions", nombre(impressions), "impression"],
    ["taux_de_clic", nombre(ctr), "%"],
  ]) {
    if (valeur == null) continue;
    obs.push(observation({
      type: "position", sujet: base, metrique, valeur, unite,
      nature: "mesure", etat: "MESURE", source: src,
      preuve: `${valeur} ${unite} sur la periode par defaut de Search Console (3 derniers mois)`,
      run_id: run, collecteur: VERSION, drapeaux: ["donnee_differee_3_jours"],
    }));
  }
}

console.log(`${lignes.length} ligne(s) lue(s), ${avecPosition} avec une position.`);
if (avecPosition) {
  const top = obs.filter((o) => o.metrique === "position").sort((a, b) => a.valeur - b.valeur).slice(0, 10);
  console.log("\nnos dix meilleures positions REELLES :");
  for (const o of top) console.log(`  ${String(o.valeur).padStart(6)}  ${o.sujet.requete}`);
}
console.log(DRY
  ? `\n--dry : ${obs.length} observations NON ecrites.`
  : `\n${ecrire(obs)} observation(s) ecrite(s) (${obs.length} calculee(s)).`);
