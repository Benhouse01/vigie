-- SCHEMA DE LA BASE PARTAGEE DE VIGIE (Cloudflare D1).
--
-- Trois choses vivent ici, et une seule est un secret :
--   1. les comptes, pour savoir qui se sert de l'outil ;
--   2. le journal d'usage, pour savoir ce qui est demande ;
--   3. l'index de backlinks, qui est un BIEN COMMUN : ce qu'un utilisateur fait
--      decouvrir profite a tous les suivants. C'est ce qui fait qu'un outil gratuit
--      finit par voir plus de choses qu'un abonnement, a condition qu'il soit utilise.
--
-- ⛔ AUCUN MOT DE PASSE EN CLAIR N'ARRIVE JAMAIS ICI. Le navigateur derive la cle
--    (PBKDF2, 210 000 tours) et n'envoie que la derivee ; le serveur la resale et la
--    hache. Voir functions/api/_commun.js pour le pourquoi.

CREATE TABLE IF NOT EXISTS comptes (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  empreinte     TEXT NOT NULL,          -- SHA-256(derivee_client + sel), en hexa
  sel           TEXT NOT NULL,          -- sel serveur, 16 octets en hexa
  cree_le       TEXT NOT NULL,
  vu_le         TEXT,
  analyses      INTEGER NOT NULL DEFAULT 0,
  crawls        INTEGER NOT NULL DEFAULT 0,
  pays          TEXT,
  provenance    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  jeton     TEXT PRIMARY KEY,
  compte    TEXT NOT NULL,
  cree_le   TEXT NOT NULL,
  expire_le TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_compte ON sessions(compte);

-- Le journal d'usage. Une ligne par action, jamais ecrasee.
CREATE TABLE IF NOT EXISTS usages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  quand   TEXT NOT NULL,
  compte  TEXT,
  email   TEXT,
  action  TEXT NOT NULL,               -- analyse | crawl | inscription | connexion
  cible   TEXT,
  pays    TEXT,
  detail  TEXT
);
CREATE INDEX IF NOT EXISTS idx_usages_quand ON usages(quand);
CREATE INDEX IF NOT EXISTS idx_usages_compte ON usages(compte);

-- L'INDEX PARTAGE DE BACKLINKS.
--
-- ⛔ `etat` porte les trois etats de Vigie et ne doit JAMAIS etre invente :
--      MESURE       la page a ete ouverte et le lien lu dans le HTML servi
--      ANGLE_MORT   la page n'a pas pu etre ouverte (403, captcha, delai)
--    Un candidat non verifie n'entre PAS dans cette table : il attend dans `candidats`.
CREATE TABLE IF NOT EXISTS backlinks (
  cible         TEXT NOT NULL,          -- domaine vise, en minuscules, sans www
  domaine_src   TEXT NOT NULL,          -- domaine emetteur
  url_src       TEXT NOT NULL,          -- page exacte qui porte le lien
  url_dest      TEXT NOT NULL,          -- destination exacte du lien
  ancre         TEXT,
  rel           TEXT,                   -- dofollow | nofollow | ugc | sponsored | nofollow+ugc ...
  rel_brut      TEXT,                   -- l'attribut tel qu'il est ecrit dans le HTML
  etat          TEXT NOT NULL,
  vu_le         TEXT NOT NULL,
  source_donnee TEXT NOT NULL,          -- d'ou vient le CANDIDAT (mojeek, ddg, hn, index...)
  PRIMARY KEY (cible, url_src, url_dest)
);
CREATE INDEX IF NOT EXISTS idx_bl_cible ON backlinks(cible, vu_le);
CREATE INDEX IF NOT EXISTS idx_bl_src ON backlinks(domaine_src);

-- Les pages a ouvrir. Elles ne sont pas des backlinks tant qu'on n'a pas lu le lien.
CREATE TABLE IF NOT EXISTS candidats (
  cible    TEXT NOT NULL,
  url      TEXT NOT NULL,
  origine  TEXT NOT NULL,
  etat     TEXT NOT NULL DEFAULT 'attente',  -- attente | lu | mur | vide
  ajoute_le TEXT NOT NULL,
  PRIMARY KEY (cible, url)
);
CREATE INDEX IF NOT EXISTS idx_cand_travail ON candidats(cible, etat);

-- La file du robot. Une ligne par domaine demande.
CREATE TABLE IF NOT EXISTS file_crawl (
  cible        TEXT PRIMARY KEY,
  etat         TEXT NOT NULL,           -- attente | candidats | verification | fini | mur
  phase_msg    TEXT,
  demande_le   TEXT NOT NULL,
  demandeur    TEXT,
  passe_le     TEXT,
  fini_le      TEXT,
  pages_lues   INTEGER NOT NULL DEFAULT 0,
  candidats_vus INTEGER NOT NULL DEFAULT 0,
  liens_trouves INTEGER NOT NULL DEFAULT 0,
  priorite     INTEGER NOT NULL DEFAULT 5,
  rapport      TEXT
);
CREATE INDEX IF NOT EXISTS idx_file_travail ON file_crawl(etat, priorite, demande_le);

-- Le robots.txt de chaque hote, mis en cache pour ne pas le redemander a chaque page.
CREATE TABLE IF NOT EXISTS robots_cache (
  hote     TEXT PRIMARY KEY,
  interdit TEXT,                        -- chemins Disallow, un par ligne
  delai    REAL NOT NULL DEFAULT 0,
  lu_le    TEXT NOT NULL
);
