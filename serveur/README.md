# Le moteur d'index de Vigie

Ce dossier contient la brique qui manquait, et sans laquelle un outil de backlinks ne
peut pas exister : **un index du graphe de liens du web**.

## Pourquoi ce dossier existe

La première version cherchait les backlinks en interrogeant des moteurs de recherche.
Mesure en production, le 21/08/2026, depuis les adresses IP de Cloudflare :

| moteur | réponse |
|---|---|
| Brave | HTTP 429 |
| Mojeek | HTTP 403 |
| SearX | requête ignorée, résultats sans rapport |
| Google News | HTTP 503 |
| DuckDuckGo | contrôle anti-robot |

Vingt-trois pages ouvertes, **zéro lien confirmé**, sur un domaine qui en a des milliers.

Ce n'était pas un réglage à corriger, c'était la mauvaise méthode. Ahrefs, Semrush et
Majestic n'interrogent aucun moteur : ils font tourner **leur propre robot sur le web
entier** et gardent le graphe des liens. Aucun opérateur `link:` ne survit chez les
moteurs grand public, et aucun ne respecte plus les guillemets.

L'équivalent gratuit de ce crawl est public : le **graphe hyperliens de Common Crawl**,
reconstruit chaque trimestre sur des milliards de pages. Même méthode, un trimestre de
retard au lieu du temps réel.

## Ce que ça donne, mesuré

Une passe du 21/08/2026 sur l'édition `cc-main-2026-may-jun-jul`, 2 775 millions
d'arêtes lues en 28 minutes :

| domaine | domaines référents nommés |
|---|---|
| tradingview.com | 36 891 |
| myfxbook.com | 2 164 |
| tradervue.com | 273 |
| tradersync.com | 179 |
| tradezella.com | 167 |
| edgewonk.com | 140 |
| tradesviz.com | 89 |
| kinfo.com | 47 |
| ultratrader.app | 36 |
| chartlog.com | 22 |
| traderwaves.com | 19 |
| journalplus.co | 17 |
| fixytrade.com | 3 |

## Les trois pièces

```
graphe-telecharger.mjs   840 Mo + 9,8 Go, avec reprise sur coupure
graphe-index.mjs         prepare la recherche par dichotomie, et la controle
graphe-referents.mjs     la passe : cibles -> domaines referents nommes
service.mjs              relie le tout a la base D1, sans ouvrir aucun port
```

## Installation

Il faut **Node.js 20 ou plus** et **30 Go de disque libre**.

```bash
node serveur/graphe-telecharger.mjs     # 11 Go, environ 10 min a 20 Mo/s
node serveur/graphe-index.mjs           # decompresse et controle, 2 min
node serveur/graphe-referents.mjs --cibles=exemple.com
```

Puis, pour relier au service en ligne :

```bash
set CLOUDFLARE_ACCOUNT_ID=...
set CLOUDFLARE_API_TOKEN=...      # droit D1 en ecriture
set VIGIE_D1=...                  # identifiant de la base
node serveur/service.mjs
```

## ⛔ Les pièges, tous payés

**Un processus lancé depuis SSH meurt avec la session.** Sur Windows, `Start-Process`
depuis une session SSH crée un enfant du serveur SSH : à la déconnexion, l'arbre entier
est tué. Le téléchargement s'est arrêté à 0,38 Go sur 0,82 **sans aucune erreur dans le
journal**, ce qui ressemble exactement à une coupure réseau. Passer par une tâche
planifiée.

**D1 n'accepte que cent variables liées par requête.** Un lot de cinquante lignes à cinq
colonnes fait deux cent cinquante variables et rend `too many SQL variables at offset
954`. Le message ne nomme ni la limite ni la requête, et il arrive après que la moitié du
travail est faite. Les colonnes constantes se lient une seule fois avec la notation
numérotée `?1 ?2 ?3`.

**Le fichier des arêtes est trié par source, et on cherche par cible.** Il n'y a pas de
raccourci : chaque passe lit les 2,7 milliards d'arêtes, soit 28 minutes. Mais elle coûte
le même prix pour une cible ou pour cinquante mille, parce que le test d'appartenance à
un ensemble est immédiat. **Le traitement par lot n'est pas une optimisation, c'est la
seule façon de ne pas gaspiller un facteur cinquante mille.**

**Un domaine absent du graphe n'est pas un domaine sans backlinks.** Le graphe est refait
chaque trimestre : un domaine créé depuis la dernière édition n'y figure pas encore. C'est
cette source-là qui ne peut pas répondre, pas le site qui n'a pas de liens. Ça s'affiche
`▲`, jamais `0`.

**La recherche par dichotomie se contrôle sur des témoins.** Une dichotomie fausse rend
« absent » pour tout, ce qui ressemble exactement à « ce domaine n'est pas dans le
graphe ». `graphe-index.mjs` vérifie cinq domaines dont on connaît la réponse et refuse de
se déclarer utilisable si un seul échoue.

**Ne jamais lancer le téléchargement sur un partage de connexion mobile.** Onze
gigaoctets partent au premier lancement.
