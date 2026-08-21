// AUTHENTIFICATION HTTP BASIC SUR TOUT LE SITE.
//
// Ce site expose votre analyse de vos concurrents : leurs backlinks, leur trafic estime,
// leurs positions, et la lecture que vous en faites. Il ne doit etre lisible ni par
// quelqu'un qui tombe dessus, ni par un robot d'indexation. D'ou un mot de passe, et pas
// la solution de repli « noindex tout seul » : un noindex est une demande polie adressee
// a des robots polis, il n'a jamais empeche personne d'ouvrir une page.
//
// ⛔ CE FICHIER NE PROTEGE RIEN TOUT SEUL. Quatre conditions, et chacune a deja fait
//    tomber un site, ici ou ailleurs :
//
//  1. IL DOIT ETRE DEPLOYE PAR WRANGLER, DEPUIS LE DOSSIER DU SITE. Le glisser-deposer du
//     tableau de bord Cloudflare NE COMPILE PAS le dossier functions/ : le site part en
//     clair et rien dans l'interface ne le signale. Wrangler lance depuis un autre
//     repertoire ne le compile pas non plus : il cherche `functions` dans son repertoire
//     COURANT, pas dans le dossier d'assets qu'on lui passe. C'est exactement ce qui est
//     arrive le 21/08/2026 a 04h12, ou le site est parti PUBLIC avec l'analyse des
//     concurrents dessus, sur une sortie wrangler qui disait « Success ».
//
//  2. _routes.json DOIT PORTER "exclude": []. Sinon le CDN sert les fichiers statiques
//     directement, SANS passer par ici : l'accueil serait protege et les tableaux, eux,
//     seraient publics.
//
//  3. LE PROJET DOIT ETRE EN « FAIL CLOSED » (Settings > Runtime). Par defaut Cloudflare
//     est en fail open : quota de Functions epuise = le site est servi SANS ce fichier.
//     Ce reglage n'est pas dans l'API Pages, il se fait a la main, une fois, et aucun
//     controle automatique ne peut le tester.
//
//  4. LES VARIABLES DOIVENT EXISTER EN PRODUCTION *ET* EN PREVIEW. Ce sont deux jeux
//     distincts dans Cloudflare. Une preversion sans mot de passe est un site public, et
//     son URL est aussi previsible que celle de la production.
//
// ⛔ LE MOT DE PASSE N'EST JAMAIS DANS LE DEPOT. Il vit dans les variables du projet
//    Cloudflare, et en local dans un .env exclu par .gitignore. Un secret pousse sur
//    GitHub est aspire par des robots en quelques minutes, et l'historique le garde meme
//    retire au commit suivant.
//
// Variables attendues : VIGIE_UTILISATEUR et VIGIE_MOTDEPASSE.

const ROYAUME = 'Vigie';

const ENTETES_SECURITE = {
  // Ceinture et bretelles : meme derriere le mot de passe, on interdit l'indexation.
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Comparaison a temps constant.
 *
 * ⛔ UNE COMPARAISON NAIVE (a === b) FUIT LE MOT DE PASSE CARACTERE PAR CARACTERE : elle
 *    s'arrete au premier caractere different, donc elle repond d'autant plus vite que la
 *    proposition est fausse tot. Sur un site public, c'est une porte.
 *
 * ⛔ ON COMPARE DES OCTETS, PAS DES CHAINES. atob() rend une chaine ou chaque caractere
 *    porte UN OCTET du flux base64 : reencoder cette chaine en UTF-8 doublerait les
 *    octets de tout caractere accentue et ferait echouer un mot de passe pourtant juste.
 *    L'en-tete WWW-Authenticate annonce charset="UTF-8", donc le navigateur envoie de
 *    l'UTF-8 : on compare ces octets-la a ceux du mot de passe attendu, tels quels.
 */
function memesOctets(a, b) {
  // timingSafeEqual exige deux tampons de MEME longueur, sinon il leve. On compare donc
  // d'abord les longueurs, ce qui ne fuit que la longueur, jamais le contenu.
  if (a.byteLength !== b.byteLength) return false;
  try {
    return crypto.subtle.timingSafeEqual(a, b);
  } catch {
    // Repli si le runtime ne porte pas l'extension Cloudflare : boucle sans court-circuit.
    // Une exception non rattrapee ici ferait rendre un 500 par la plateforme, ce qui
    // fermerait le site mais le rendrait inutilisable sans qu'on comprenne pourquoi.
    let diff = 0;
    for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }
}

const octetsDe = (chaine) => new TextEncoder().encode(chaine);

/** Les octets bruts d'une chaine rendue par atob(), un caractere = un octet. */
function octetsBruts(chaineBinaire) {
  const out = new Uint8Array(chaineBinaire.length);
  for (let i = 0; i < chaineBinaire.length; i++) out[i] = chaineBinaire.charCodeAt(i) & 0xff;
  return out;
}

function demander() {
  return new Response('Acces restreint.\n', {
    status: 401,
    headers: {
      // ⛔ Sans cet en-tete, le navigateur n'affiche AUCUNE invite : l'utilisateur voit
      //    une page blanche et croit le site casse. Le charset evite qu'un mot de passe
      //    accentue parte dans le mauvais encodage.
      'WWW-Authenticate': `Basic realm="${ROYAUME}", charset="UTF-8"`,
      'Content-Type': 'text/plain; charset=utf-8',
      ...ENTETES_SECURITE,
    },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;

  // Une requete OPTIONS ne porte jamais d'identifiants : la refuser casserait des clients
  // sans rien proteger de plus, puisque aucun corps n'est servi.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { Allow: 'GET, HEAD, OPTIONS', ...ENTETES_SECURITE } });
  }

  const attenduUtilisateur = env.VIGIE_UTILISATEUR;
  const attenduMotDePasse = env.VIGIE_MOTDEPASSE;

  // ⛔ VARIABLE ABSENTE = ON FERME. Le reflexe inverse, laisser passer quand la
  //    configuration manque, transforme une erreur de reglage en publication. Le message
  //    dit quoi corriger : c'est un ecran que seul l'exploitant peut atteindre, puisque
  //    le site n'a alors aucun contenu a fuiter.
  if (!attenduUtilisateur || !attenduMotDePasse) {
    return new Response(
      "Configuration incomplete : VIGIE_UTILISATEUR ou VIGIE_MOTDEPASSE n'est pas defini sur cet\n" +
      "environnement. Verifier PRODUCTION *et* PREVIEW, ce sont deux jeux de variables distincts.\n",
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...ENTETES_SECURITE } }
    );
  }

  const entete = request.headers.get('Authorization') || '';
  if (!entete.startsWith('Basic ')) return demander();

  let decode;
  try {
    decode = atob(entete.slice(6).trim());
  } catch {
    return demander();
  }

  // Le SEPARATEUR EST LE PREMIER DEUX-POINTS : la norme autorise un mot de passe qui en
  // contient, jamais un identifiant. Couper au dernier casserait un mot de passe legitime.
  const separateur = decode.indexOf(':');
  if (separateur < 0) return demander();

  const octets = octetsBruts(decode);
  const okU = memesOctets(octets.slice(0, separateur), octetsDe(attenduUtilisateur));
  const okP = memesOctets(octets.slice(separateur + 1), octetsDe(attenduMotDePasse));

  // ⛔ LES DEUX COMPARAISONS SONT EVALUEES, SANS COURT-CIRCUIT. Un `&&` aurait rendu la
  //    reponse plus rapide quand l'identifiant est faux : c'est la meme fuite de temps
  //    que la comparaison naive, un etage plus haut.
  if (!(okU & okP)) return demander();

  const reponse = await next();
  const sortie = new Response(reponse.body, reponse);
  for (const [cle, valeur] of Object.entries(ENTETES_SECURITE)) sortie.headers.set(cle, valeur);
  // ⛔ Les regles de _headers ne s'appliquent PAS a une reponse fabriquee par une Function.
  //    Les en-tetes sont donc reposes ici, sinon le site protege sortirait sans son
  //    noindex, ce qui n'a de consequence que le jour ou le mot de passe saute.
  return sortie;
}
