// VIDER LE JOURNAL WAL DE L INDEX, ET LE RENDRE AU DISQUE.
//
// ⛔ CE SCRIPT NE SERT A RIEN SI LES ROBOTS LISENT ENCORE.
//    « wal_checkpoint(TRUNCATE) » exige qu aucune transaction de lecture ne soit
//    ouverte. Il faut donc poser C:\vigie\PAUSE, laisser les lecteurs se ranger
//    quelques secondes, PUIS appeler ce script. C est ce que fait gardien.ps1.
//    Appele pendant que ca tourne, il rend « database is locked » ou ne tronque rien,
//    et le journal continue de grossir sans que rien ne le dise.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DOSSIER = process.env.VIGIE_DONNEES || "C:/vigie/donnees";
const BD = path.join(DOSSIER, "index.sqlite");
const taille = (f) => { try { return Math.round(fs.statSync(f).size / 1048576); } catch { return 0; } };

const avant = taille(BD + "-wal");
const bd = new DatabaseSync(BD);
bd.exec("PRAGMA busy_timeout = 120000");
bd.exec("PRAGMA journal_size_limit = 536870912");
const r = bd.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
bd.close();
const apres = taille(BD + "-wal");
// La premiere colonne vaut 1 quand le vidage a ete EMPECHE : un lecteur tenait encore
// une transaction. On le dit, plutot que de laisser croire a une reussite.
const bloque = Object.values(r)[0] === 1;
console.log(`journal : ${avant} Mo -> ${apres} Mo${bloque ? "  ⛔ VIDAGE EMPECHE, un lecteur tenait encore" : ""}`);
process.exit(bloque ? 1 : 0);
