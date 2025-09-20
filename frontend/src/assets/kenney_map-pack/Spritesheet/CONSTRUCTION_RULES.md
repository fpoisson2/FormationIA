# Règles de construction du tileset enrichi

Ce document décrit comment interpréter les métadonnées fournies dans `mapPack_enriched.xml` pour générer des cartes cohérentes. Chaque `SubTexture` représente une tuile de 64×64 px enrichie avec des attributs normalisés (`type`, `subtype`, `category`, `connections`, `walkable`, etc.).

## 1. Gestion des catégories
- **terrain** : tuiles de sol ou de falaise. Elles combinent `type` (`bordure`, `coin_interieur`, `falaise`, `material`…) et `subtype` (sable, gazon, glace, etc.). Les variantes `material` représentent les dalles pleines et couvrent toute la case (`transparent="false"`) tandis que les bordures, coins intérieurs et falaises restent translucides (`transparent="true"`). Toutes les tuiles de cette catégorie sont non franchissables (`walkable="false"`).
- **path** : chemins praticables classiques. Les `connections` exposent toutes les directions ouvertes (`north`, `south`, `east`, `west`). Conserver la cohérence de graphe (ex. une tuile T doit relier les trois directions annoncées).
- **bulle_verte** : variantes de chemins translucides. Elles suivent les mêmes règles que `path`, y compris `walkable="true"`, mais portent `type="bulle_verte"` pour pouvoir appliquer un style spécifique.
- **object**, **character**, **ui** : éléments décoratifs ou interactifs posés en surcouche (`overlay="true"`). Par défaut ils sont non franchissables, sauf les tuiles numérotées (`subtype="number"`) utilisées comme balises de parcours, qui doivent être traitées comme des chemins.

## 2. Attributs directionnels
- `connections` est obligatoire pour toute tuile `walkable="true"` (chemins, bulles vertes, chiffres). Le set de directions indique les sorties disponibles depuis la tuile.
- Les falaises et bords peuvent également exposer `connections` pour préciser leur orientation visuelle, mais celles-ci n’impliquent pas de traversabilité.
- Les `coin_interieur` — seuls ou combinés à `falaise` — utilisent des directions diagonales (`northwest`, `northeast`, `southeast`, `southwest`). Ces valeurs décrivent l’orientation du renfoncement :

  | `connections` | Orientation visuelle | Utilisation typique |
  | --- | --- | --- |
  | `northwest` | angle creusé vers le nord et l’ouest | placer l’intérieur d’un virage en haut à gauche d’une falaise ou d’un plateau |
  | `northeast` | angle creusé vers le nord et l’est | compléter un virage en haut à droite |
  | `southeast` | angle creusé vers le sud et l’est | refermer un relief en bas à droite |
  | `southwest` | angle creusé vers le sud et l’ouest | dessiner un retour de falaise en bas à gauche |

  Lors de l’assemblage, associer chaque coin intérieur avec ses bordures adjacentes (ex. une falaise au nord nécessite une tuile `connections="north"`) pour garantir que les textures se rejoignent sans cassure.

## 3. Gestion de la traversabilité
- Seules les tuiles des catégories `path`, `bulle_verte` et les chiffres (`subtype="number"`) sont `walkable="true"`.
- Toute autre tuile doit rester `walkable="false"` pour éviter des collisions fantômes.
- Lors du placement d’une entité, vérifier que toutes les cases cibles sont `walkable="true"` avant d’autoriser un déplacement.

## 4. Superposition et rendu
- Les tuiles avec `overlay="true"` (arbres, personnages, objets, chiffres, marqueurs) doivent être dessinées dans une couche supérieure afin de ne pas masquer les chemins sous-jacents.
- Toutes les sous-textures exposent désormais un indicateur `transparent`. Sa valeur est `false` uniquement pour les dalles de matériau pleines (`type` contenant `material` mais pas `coin_interieur`), ce qui signale qu’elles remplacent complètement la case. Toutes les autres tuiles (bordures, coins, falaises, chemins, objets…) restent translucides (`transparent="true"`) et laissent apparaître les couches inférieures.

## 5. Extensions
- Tout ajout de tuile doit renseigner au minimum `category`, `type`, `walkable` et, si applicable, `subtype`, `connections`, `overlay`, `transparent`.
- Pour rester compatible avec le script `scripts/add_png_metadata.py`, conserver les noms de fichiers et les dimensions d’origine.

## 6. Construire une carte procédurale
Le script `scripts/build_map_png.py` automatise la construction d’une île en respectant les règles ci-dessus. La séquence recommandée est la suivante :

1. **Fond aquatique** : remplir toute la carte avec une tuile d’eau (`subtype="water"`, `water_shallow` ou `water_deep`).
2. **Sélection d’un matériau d’île** : choisir un unique matériau plein (`type` contenant `material`) – aléatoirement ou via `--material` – et générer une masse terrestre connectée d’une forme organique (croissance radiale aléatoire plutôt qu’un simple carré).
3. **Contour** : appliquer des bordures (`type` contenant `bordure`/`coin_interieur`) ou des falaises (`type` contenant `falaise`) **sur les cases d’eau adjacentes** au matériau. Chaque case aquatique qui touche l’île sur un côté cardinal reçoit la variante opposée (`north`, `east`, `south`, `west`). Les coins sortants se complètent avec les diagonales correspondantes (`northeast`, `northwest`, `southeast`, `southwest`), tandis que les coins intérieurs emploient les variantes `coin_interieur` qui réunissent deux directions (ex. `southwest` lorsque la case d’eau est en contact avec l’île au nord et à l’est). Veillez à conserver la continuité visuelle : un bloc `north-east` doit avoir un bloc `north` à gauche et un bloc `east` en dessous, un coin intérieur `south-west` est bordé par un bloc `south` à sa gauche et un bloc `west` en dessous, un bloc `south` est encadré par deux autres blocs portant aussi `south`, etc. Le paramètre `--edge-style` permet de forcer l’un ou l’autre, la valeur `auto` privilégiant les falaises et repliant sur les bordures si nécessaire.
4. **Trajet numéroté** : creuser un chemin continu à l’intérieur de l’île avec les tuiles `category="path"` (ou `type="bulle_verte"` pour la variante). Placer ensuite une séquence de chiffres `subtype="number"` – marchables et transparents – le long de ce trajet pour servir de jalons. Le nombre de chiffres peut être imposé avec `--numbers`, sinon il est déduit de la taille de la carte.
5. **Décorations** : disposer aléatoirement des arbres ou objets (`category="object"`, `overlay="true"`, `walkable="false"`) sur les cases de l’île qui ne sont pas occupées par le trajet. Le paramètre `--objects` fixe leur quantité et `--seed` permet de reproduire exactement un rendu.

Les paramètres facultatifs du script permettent d’adapter chaque étape à une consigne spécifique sans déroger aux métadonnées du spritesheet.
