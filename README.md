# Vigie

**Un outil d'analyse SEO qui ne coûte rien, et qui dit la vérité sur ce qu'il ne sait pas.**

### 👉 [Le service en ligne : vigie-seo.pages.dev](https://vigie-seo.pages.dev)

Tapez un domaine, lancez le robot, voyez chaque lien avec son `rel` réel. Un compte gratuit
suffit, il ne demande qu'une adresse email. Rien à installer.

Backlinks, positions, trafic estimé, note d'autorité maison, pour votre site **et pour vos
concurrents**. Zéro abonnement, zéro API payante, zéro carte bancaire.

Licence **AGPL-3.0** : vous pouvez tout reprendre, mais quiconque en fait un service en ligne
doit publier ses modifications. Personne ne pourra le refermer pour le revendre 200 € par mois.

Le service est gratuit et le restera. [Un don](https://buy.stripe.com/cNi6oIepEgck8pF7q59R600)
aide à ce qu'il grandisse, et n'ouvre aucune fonctionnalité : ce serait un abonnement déguisé.

---

## Pourquoi

Les outils SEO du marché coûtent entre 100 et 500 € par mois. Pour une entreprise qui
démarre, c'est le budget d'un salarié à temps partiel, dépensé pour lire des chiffres.

Le plus gênant n'est pas le prix, c'est ce qu'on achète : des estimations présentées
comme des mesures. Un chiffre de trafic « organique » qui est un modèle calculé depuis des
mots-clés positionnés, affiché à côté d'un compte de backlinks qui est en réalité le
plafond d'un index. Rien ne distingue, à l'écran, ce qui a été compté de ce qui a été
deviné, ni ce qui a été mesuré de ce qui n'a pas pu l'être.

Vigie part de l'inverse. **Chaque nombre porte sa source, sa date et sa nature.** Une
mesure impossible s'affiche `▲` et jamais `0`. Un plafond s'affiche `≥`. Une estimation
porte le mot « estimation » à l'écran, pas en note de bas de page.

---

## Ce qu'il fait

**Backlinks.** Qui pointe vers vous, avec l'attribut `rel` réel lu dans le HTML servi,
l'ancre, l'URL de destination exacte, et un verdict de spam mesuré sur dix signaux. Le
tout pour vos concurrents aussi.

**Un robot à la demande, qui tourne dans le nuage.** Aucune machine à laisser allumée. Il
part des pages qui citent votre domaine dans plusieurs moteurs, des sites que vous citez
vous-même, de Wikipédia, et de l'index déjà constitué. Il ouvre chaque page et lit le lien
pour de vrai. Il respecte le `robots.txt` de chaque hôte, ne tient qu'une requête à la fois
par hôte, et avance par tours bornés.

**Des opportunités.** Les sites qui citent un concurrent et jamais vous. C'est la seule
page de l'outil qui ne décrit pas l'existant : elle dit où aller.

**Positions.** Sur un pool de requêtes figé et versionné, relevées sur trois moteurs avec
la localisation forcée, parce qu'un SERP lu depuis le mauvais pays est faux.

**Trafic estimé.** En fourchette, avec sa méthode affichée. Jamais un chiffre unique.

**Une note d'autorité maison.** Cinq axes, cinq poids, et le détail du calcul visible.
Ce n'est **pas** un Domain Authority.

---

## La note, et pourquoi elle n'est pas un Domain Authority

Le Domain Authority de Moz se calcule sur le **volume** de backlinks. C'est la métrique la
plus manipulable du référencement, et c'est précisément pour cela que les fermes à liens
la mettent en avant : elle s'achète.

Ici, la doctrine est inverse : **le trafic d'abord, le nombre de liens ensuite.**

```
ND = 0,32·TR + 0,26·AA + 0,17·PO + 0,15·CO + 0,10·ST
```

| Axe | Poids | Ce qu'il mesure |
|---|---|---|
| **TR** trafic | 32 % | Popularité réelle du domaine et visibilité sur les requêtes suivies |
| **AA** autorité acquise | 26 % | Qualité du profil de liens, masse quadratique, malus de spam |
| **PO** positions | 17 % | Part du pool figé dans les trois, dix et vingt premiers |
| **CO** couverture | 15 % | Pages au sitemap, et part réellement indexable |
| **ST** santé technique | 10 % | Réponse, redirections, temps, poids, robots, sitemap, certificat |

Le trafic passe devant parce que la corrélation mesurée avec la performance est de 0,66 à
0,74 pour le trafic, contre 0,27 à 0,33 pour le Domain Rating. Un axe qui corrèle trois
fois moins ne pèse pas plus. Accessoirement, c'est le seul axe qu'on ne peut pas acheter
en gros.

**Conséquence chiffrée, vérifiée par un test qui tourne à chaque calcul :**

| Action sur le profil de liens | Effet sur la note |
|---|---|
| +1 lien de ferme | **0,00** |
| +100 annuaires en nofollow | **0,00** |
| +100 bons liens | **+8,10** |
| +100 liens de fermes, dofollow et indexés | **−11,30** |

L'asymétrie est voulue : acheter du volume doit coûter plus cher que gagner de la qualité.

```
node outils/note.mjs --test
```

---

## Les trois états d'une mesure

C'est ce qui sépare cet outil d'un score de marché, et c'est la règle qu'il faut
comprendre avant tout le reste.

| État | Ce que ça veut dire | Effet sur le calcul |
|---|---|---|
| **Mesure** | La source a répondu | La valeur entre au calcul |
| **Rien** | La source a répondu « rien ». C'est une **vraie mesure**, et une mesure sévère | Entre au calcul à sa valeur basse |
| **▲ Angle mort** | La source n'a pas pu répondre : un 403, un captcha, un délai | Le poids **sort du calcul**, la note s'élargit en fourchette |

Un domaine absent du classement Tranco n'y est pas parce qu'il n'a pas assez de trafic :
c'est une mesure. Un `403` est un mur, pas une absence. Confondre les deux, c'est
transformer ses propres blocages en jugement sur les autres.

**Un domaine pas assez mesuré ne se classe pas.** Sous 60 % de socle de mesure, la note
sort en fourchette et le domaine quitte le classement au lieu d'y descendre.

---

## Les sources, et ce que chacune vaut

Aucune ne voit tout. C'est le fait central du référencement, et l'outil est construit
autour.

| Source | Ce qu'elle donne | Sa limite |
|---|---|---|
| **Bing Webmaster Tools** | Domaines référents et ancres de **n'importe quel** domaine, gratuitement | Plafonne à 500 par site, et l'annonce comme un total |
| **Search Console** | Le seul réel sur vos propres domaines | Rapport Liens échantillonné : un plancher |
| **Vérificateur gratuit d'Ahrefs** | L'ordre de grandeur, et le taux de dofollow | Le compte, pas la liste |
| **Graphe Common Crawl** | La liste **nommée** des référents de n'importe qui | Domaine à domaine, sans URL ni `rel`, un trimestre de retard |
| **Lecture du HTML** | Le `rel` réel, l'ancre, l'indexabilité | Il faut trouver la page |
| **Tranco, OpenPageRank, Majestic** | Popularité et réseau référent | Listes, donc figées |
| **Le robot** | Ce que personne d'autre ne cherche pour vous | Ce que vous lui donnez comme budget |

---

## Installation

Il faut **Node.js 20 ou plus**. Rien d'autre.

```bash
git clone <votre-fork> vigie
cd vigie
cp config/domaines.exemple.json config/domaines.json
cp .env.exemple .env
```

Ouvrez `config/domaines.json` et mettez vos domaines : le vôtre en rôle `nous`, vos
concurrents en `concurrent`, et les sites où vous aimeriez un lien en `spot`.

Puis la première passe, celle qui ne demande aucun compte :

```bash
node outils/collecte-domaine.mjs
node outils/collecte-tranco-liste.mjs
node outils/note.mjs
node outils/site.mjs
```

Ouvrez `site/index.html`. Vous avez déjà la santé technique, la couverture de contenu et
la popularité de tout le monde, entièrement mesurées.

---

## Aller plus loin

**Les backlinks des concurrents**, gratuitement. Créez un compte Bing Webmaster Tools,
importez vos sites depuis Search Console en deux clics, puis lancez un navigateur piloté
et le collecteur. Détails dans [`docs/bing.md`](docs/bing.md).

**Le graphe du web.** Une fois par trimestre, 11 Go téléchargés en flux, vingt minutes,
et vous avez la liste nommée des domaines qui pointent vers n'importe quel site.

```bash
node outils/collecte-commoncrawl.mjs --sommets
node outils/collecte-commoncrawl.mjs --aretes
node outils/collecte-commoncrawl.mjs --resoudre
```

**Le robot, à la demande.**

```bash
node outils/serveur-vigie.mjs        # laissez la fenêtre ouverte
node outils/robot-backlinks.mjs --cible=exemple.com
```

Le serveur local permet au bouton du tableau de bord de lancer un crawl. Il n'écoute que
sur `127.0.0.1`, refuse tout domaine absent de votre configuration, et n'autorise qu'un
crawl à la fois.

---

## La politesse du robot, et pourquoi elle n'est pas négociable

Le robot lit le `robots.txt` de chaque hôte **avant** de le crawler et le respecte. Il ne
tient qu'une requête à la fois par hôte, avec un délai entre deux. Il s'annonce dans son
User-Agent avec un moyen de le joindre. Et il s'arrête : budget de pages, de minutes et
d'hôtes, les trois affichés.

Ce n'est pas de la courtoisie. Un robot impoli fait bannir votre adresse IP, et il vous
grille auprès des sites que vous voulez justement convaincre de vous publier.

---

## Ce que Vigie ne fait pas

Il ne crawle pas le web en permanence. Un index web complet, c'est ce que les outils à 200 €
achètent avec des années de crawl continu, et le prétendre serait mentir. Vigie part des
endroits où une mention a une chance d'exister, puis vérifie chacun.

**Et la limite la plus dure, mesurée le 21/08/2026 :** aucun moteur grand public ne respecte
plus les guillemets, et l'opérateur `link:` est mort partout. Interrogé sur `"exemple.com"`,
Brave rend des résultats pour les homonymes. Vigie filtre donc chaque résultat sur son
voisinage : une URL n'est retenue que si le domaine cible apparaît dans son propre bloc de
résultat. Ça coûte du rappel, et c'est écrit à l'écran plutôt que caché.

Il ne vous donnera pas les backlinks d'un domaine que personne n'a encore cité quelque part
d'atteignable. Quand il ne sait pas, il l'écrit.

Il ne remplace pas un outil payant sur tout. Il fait autrement, gratuitement, et il ne
vous ment jamais sur la solidité de ce qu'il affiche.

---

## Déployer votre propre instance

Tout tient dans le palier **gratuit** de Cloudflare, et il n'y a pas de serveur à louer.

```bash
npm install -g wrangler && wrangler login

# 1. la base partagee
wrangler d1 create vigie
# reportez le database_id rendu dans vitrine/wrangler.toml ET robot/wrangler.toml
wrangler d1 execute vigie --remote --file=vitrine/schema.sql

# 2. la vitrine et son API
cd vitrine && wrangler pages deploy --project-name=<votre-projet>
wrangler pages secret put VIGIE_ADMINS --project-name=<votre-projet>   # vos adresses, separees par des virgules

# 3. le robot, reveille toutes les deux minutes
cd ../robot && wrangler deploy
```

⛔ **Trois pièges déjà payés, tous silencieux.**

1. **Le glisser-déposer dans le tableau de bord ne compile pas `functions/`.** Le site part
   alors sans son API, et rien ne le signale. Déployez par `wrangler`, et vérifiez que la
   sortie contient bien « Uploading Functions bundle ».
2. **Le robot embarque sa propre copie des modules partagés.** Modifier
   `vitrine/functions/api/_decouverte.js` sans redéployer `robot/` laisse le déclencheur
   horaire tourner avec l'ancien code, pendant que le bouton de la vitrine utilise le
   nouveau. Les deux découvertes se contredisent alors dans la même base.
3. **Les variables de PREVIEW sont un jeu distinct de celles de PRODUCTION.** Une
   préversion sans base tombe en 503, et son URL est aussi prévisible que la production.

---

## Contribuer

Les issues et les pull requests sont les bienvenues. Le seul principe non négociable est
celui du dessus : **jamais un zéro là où la mesure a échoué.** Une contribution qui
transforme un blocage en valeur nulle sera refusée, même si elle rend les tableaux plus
jolis.

Voir [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Licence

AGPL-3.0. Voir [`LICENSE`](LICENSE).
