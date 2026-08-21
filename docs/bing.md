# Brancher Bing Webmaster Tools

C'est la brique qui débloque le plus, et elle est gratuite. Compter dix minutes.

## Pourquoi elle vaut le détour

L'onglet **« Backlinks To Any Site »** accepte des domaines **que vous ne possédez pas**.
C'est exactement ce que les outils payants facturent : voir le profil de liens d'un
concurrent. Bing en donne les domaines référents et les ancres, gratuitement, et jusqu'à
trois sites comparés dans le même écran.

## L'installer

1. Allez sur [bing.com/webmasters](https://www.bing.com/webmasters).
2. Connectez-vous. Vous pouvez utiliser un compte Microsoft, Google ou Facebook.
   **Prenez le compte qui possède déjà votre Search Console**, ou au moins un compte
   dédié à votre site plutôt que votre compte personnel.
3. Choisissez **« Import your sites from GSC »**. Aucune vérification DNS n'est
   nécessaire : Bing reprend la liste des propriétés déjà vérifiées chez Google.
4. Autorisez l'accès en lecture seule quand Google le demande.

C'est tout. Vos sites apparaissent, et l'onglet « Backlinks » fonctionne immédiatement
pour n'importe quel domaine, y compris avant que Bing ait fini de traiter le vôtre.

## Le lancer

Le collecteur pilote un vrai navigateur, parce que l'API interne de Bing est protégée par
un jeton anti-rejeu qu'aucun appel direct ne peut deviner.

Lancez un Chrome dédié, sur un port dédié, avec un profil dédié :

```bash
# Windows
start chrome --remote-debugging-port=9674 --user-data-dir=%LOCALAPPDATA%\VigieChrome ^
  --no-first-run --no-default-browser-check "https://www.bing.com/webmasters/home"

# macOS / Linux
google-chrome --remote-debugging-port=9674 --user-data-dir=/tmp/vigie-chrome \
  --no-first-run --no-default-browser-check "https://www.bing.com/webmasters/home"
```

Connectez-vous dans cette fenêtre, puis :

```bash
CDP_URL=http://127.0.0.1:9674 node outils/collecte-bing-backlinks.mjs
```

## ⛔ Le piège à connaître avant de lire le résultat

**Bing plafonne à 500 domaines référents par site, et il annonce 500 comme si c'était le
total.** La page 2 rend zéro ligne : il n'y a pas de pagination, la troncature est
définitive et muette.

Un site à exactement 500 n'a donc pas 500 domaines référents, il en a **au moins** 500.
Vigie l'écrit en `nature: "plancher"` et l'affiche `≥ 500`. Ne lisez jamais ce nombre
comme un compte.

Deux autres choses valent d'être sues :

**Une route inconnue de leur API rend HTTP 200 avec le HTML de l'application.** Tester le
code de retour conclut donc que n'importe quelle route existe. Le collecteur vérifie la
présence de la clé attendue dans le JSON, jamais le code.

**Le jeton anti-rejeu n'est ni dans le DOM, ni dans un cookie, ni dans une variable
globale** : il vit dans la fermeture du bundle JavaScript. Le collecteur l'obtient en
écoutant l'application pendant qu'elle l'envoie, et l'écouteur doit être posé **avant**
son JavaScript, dans la **même** session de débogage. Le poser puis fermer la connexion
le désinscrit en silence.

## Et pour votre propre site

L'onglet **« Backlinks For Your Site »** liste les **pages** référentes, pas seulement les
domaines. Il est vide au début : Bing annonce jusqu'à 48 heures de traitement après
l'ajout d'un site. Ce n'est pas une panne, c'est une file d'attente.
