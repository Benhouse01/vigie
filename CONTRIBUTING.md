# Contribuer a Vigie

Merci d y penser. Le projet est jeune, tout est ouvert.

## La seule regle non negociable

**Jamais un zero la ou la mesure a echoue.**

Une source qui repond 403, un captcha, un delai depasse, une page rendue en JavaScript
qu on ne sait pas lire : ce sont des ANGLES MORTS. Ils s affichent, ils retirent leur
poids du calcul, et ils ne valent jamais zero.

Une contribution qui transforme un blocage en valeur nulle sera refusee, meme si elle
rend les tableaux plus jolis. C est la seule chose qui separe cet outil d un score de
marche, et c est ce qui justifie qu on lui fasse confiance.

Le corollaire vaut aussi : une source qui repond « rien » a bel et bien repondu. Un
domaine absent d un classement de popularite n y est pas parce qu il n a pas assez de
trafic. C est une mesure, et une mesure severe, pas un trou.

## Les trois etats, dans le code

```js
etat: "MESURE"          // la source a repondu, la valeur entre au calcul
etat: "MESURE_ABSENT"   // la source a repondu « rien », elle entre a sa valeur basse
etat: "ANGLE_MORT"      // la source n a pas pu repondre, le poids sort du calcul
```

`observation()` LEVE une exception si vous donnez une valeur a un `ANGLE_MORT`. C est
voulu : le zero silencieux doit etre impossible a ecrire, pas seulement decourage.

## Ce qu on attend d une contribution

- **Des commentaires qui expliquent POURQUOI**, pas ce que fait le code. Les blocs `⛔`
  du projet racontent chacun un piege reellement paye, avec sa mesure et sa date. C est
  la vraie valeur du depot. Si vous corrigez un bogue subtil, laissez la lecon derriere
  vous.
- **Une preuve.** Un collecteur qui affirme quelque chose doit dire d ou il le tient :
  la source, l endpoint, le code HTTP, la date.
- **Le test de la note passe.** `node outils/note.mjs --test`, 32 controles, dont la
  propriete anti-manipulation. Si votre changement la casse, c est que la note devient
  achetable.

## Ce qu on refusera

- Ajouter une source payante ou qui exige une carte bancaire comme dependance obligatoire.
- Retirer la politesse du robot : le `robots.txt` se lit avant de crawler et se respecte,
  une requete a la fois par hote, et les budgets s arretent.
- Presenter une estimation sans le mot « estimation », sa source et sa date.
- Additionner deux sources qui ne mesurent pas la meme chose.

## Avant d ouvrir une pull request

```bash
node --check outils/*.mjs
node outils/note.mjs --test
```

Et relisez votre diff en cherchant une cle d API, un chemin absolu ou un nom de domaine
prive. Une cle poussee sur GitHub est aspiree en quelques minutes, et l historique la
garde meme si vous la retirez au commit suivant.
