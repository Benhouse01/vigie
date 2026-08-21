# GENERE LA MARQUE DE VIGIE : le pictogramme, le favicon, les icones.
#
# Le pictogramme est un OEIL, parce que c'est deja le nom que le code donne au repere
# (`.oeil` dans la feuille de style depuis le premier jour) et parce que « vigie » veut
# dire celui qui regarde. Il est fait d'une tuile aux couleurs de la marque, d'une lentille
# creusee dedans, et d'une pupille qui laisse revoir la tuile au travers.
#
# ⛔ POURQUOI DU CODE ET PAS UN FICHIER DESSINE A LA MAIN.
#    Un favicon vit en cinq tailles et trois formats. Redessine a la main, il derive :
#    la version 16 pixels finit par ne plus ressembler a la version 512. Ici les cinq
#    sortent de la meme geometrie, et changer une couleur les change toutes.
#
# ⛔ ET LA LENTILLE EST FAITE DE DEUX ARCS DE CERCLE, PAS D'UNE ELLIPSE.
#    Une ellipse donne un oeil rond et mou. Deux arcs qui se rejoignent en pointe donnent
#    la forme que tout le monde lit comme un oeil, y compris a seize pixels ou il ne reste
#    qu'une dizaine de pixels de haut.
#
# Usage : python vitrine/marque/generer.py

import math
import os
from PIL import Image, ImageDraw

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.abspath(os.path.join(ICI, ".."))

# Les couleurs de la marque, celles de la feuille de style.
ORANGE = (235, 104, 52)
BLEU = (42, 120, 214)
CREME = (250, 249, 246)

TAILLE = 1024          # on dessine grand, on reduit ensuite : les bords restent nets
RAYON = 0.22           # rayon des coins de la tuile, en part du cote


def _vers_lineaire(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _vers_srgb(c):
    c = 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
    return max(0, min(255, round(c * 255)))


def degrade(taille, a, b):
    """
    Un degrade en diagonale, du coin haut-gauche au coin bas-droit.

    ⛔ LE MELANGE SE FAIT EN LUMIERE LINEAIRE, PAS DIRECTEMENT SUR LES OCTETS.
       Melanger un orange et un bleu octet par octet fait passer le milieu par un
       brun violace terne : les valeurs sRGB ne sont pas proportionnelles a la
       lumiere. En repassant en lineaire avant de melanger, le milieu reste une
       vraie couleur, et le pictogramme ne devient pas boueux au centre.
    """
    la = [_vers_lineaire(v) for v in a]
    lb = [_vers_lineaire(v) for v in b]
    img = Image.new("RGB", (taille, taille))
    px = img.load()
    for y in range(taille):
        for x in range(taille):
            t = (x + y) / (2 * (taille - 1))
            # Un leger adoucissement aux extremites : les coins gardent leur couleur
            # franche, la bascule se fait au milieu.
            t = t * t * (3 - 2 * t)
            px[x, y] = tuple(_vers_srgb(la[i] + (lb[i] - la[i]) * t) for i in range(3))
    return img


def masque_tuile(taille):
    """Le carre aux coins arrondis qui porte le degrade."""
    m = Image.new("L", (taille, taille), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, taille - 1, taille - 1], radius=int(taille * RAYON), fill=255)
    return m


def arc_lentille(demi_largeur, hauteur, sens, points=160):
    """
    Un arc de cercle qui va de (-demi_largeur, 0) a (+demi_largeur, 0) en bombant de
    `hauteur`. `sens` vaut +1 pour l'arc du haut, -1 pour celui du bas.

    Le rayon se deduit de la corde et de la fleche : R = (a^2 + h^2) / 2h.
    """
    a, h = demi_largeur, hauteur
    r = (a * a + h * h) / (2 * h)
    cy = sens * (h - r)                 # centre du cercle, sur l'axe vertical
    debut = math.atan2(0 - cy, -a)
    fin = math.atan2(0 - cy, a)
    if sens > 0:
        debut, fin = fin, debut
    return [
        (r * math.cos(debut + (fin - debut) * i / points),
         cy + r * math.sin(debut + (fin - debut) * i / points))
        for i in range(points + 1)
    ]


def masque_oeil(taille):
    """La lentille, moins la pupille : ce qui sera peint en creme."""
    m = Image.new("L", (taille, taille), 0)
    d = ImageDraw.Draw(m)
    c = taille / 2

    demi_largeur = taille * 0.335
    hauteur = taille * 0.175

    haut = arc_lentille(demi_largeur, hauteur, +1)
    bas = arc_lentille(demi_largeur, hauteur, -1)
    contour = [(c + x, c - y) for x, y in haut] + [(c + x, c - y) for x, y in reversed(bas)]
    d.polygon(contour, fill=255)

    # La pupille est un TROU : elle laisse revoir le degrade de la tuile, ce qui evite
    # une troisieme couleur et garde le pictogramme lisible en tres petit.
    rp = taille * 0.105
    d.ellipse([c - rp, c - rp, c + rp, c + rp], fill=0)
    return m


def pictogramme(taille=TAILLE):
    fond = degrade(taille, ORANGE, BLEU).convert("RGBA")
    fond.putalpha(masque_tuile(taille))
    fond.paste(CREME, (0, 0), masque_oeil(taille))
    return fond


def ecrire(img, nom, taille):
    p = os.path.join(SORTIE, nom)
    img.resize((taille, taille), Image.LANCZOS).save(p)
    print(f"  {nom:24} {taille}x{taille}  {os.path.getsize(p)} octets")


if __name__ == "__main__":
    print("pictogramme…")
    base = pictogramme()

    ecrire(base, "icone-512.png", 512)
    ecrire(base, "icone-192.png", 192)
    ecrire(base, "apple-touch-icon.png", 180)

    # ⛔ L'ICO PORTE PLUSIEURS TAILLES DANS LE MEME FICHIER, et il en faut une de 16 :
    #    les navigateurs qui ne lisent pas le SVG reduisent sinon une image de 256, et
    #    la pupille se bouche. Les tailles sont donc rendues separement, chacune depuis
    #    le grand format, jamais l'une depuis l'autre.
    ico = os.path.join(SORTIE, "favicon.ico")
    base.resize((256, 256), Image.LANCZOS).save(
        ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    print(f"  {'favicon.ico':24} multi-tailles  {os.path.getsize(ico)} octets")
    print("fait.")
