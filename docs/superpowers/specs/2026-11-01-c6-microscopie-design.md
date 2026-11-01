# C6 — Analyse d'images de microscopie — conception détaillée

**Date :** 2026-11-01
**Statut :**
- Le fondateur délègue les choix techniques ; il testera dans le navigateur après C6.
- Ce document précise la spec du prototype (§10 « C6 ») ; il en **ajuste** trois points, chacun à confirmer par le contrôleur (§15) : l'approche de segmentation (§4 : pas de Mask R-CNN servi dans cette version), le jeu Roboflow (§3.3 : non utilisé) et les étiquettes d'instances (§3.2 : les masques de `dataset3` sont binaires).
- Versions : modèle `c6-microscopie` version `i1` (`IMAGE_MODEL_VERSION`), indépendant de `s1` (C5), de `q1` (C7) et des règles B1.

**Sources :**
- `docs/superpowers/specs/2026-10-25-prototype-studio-design.md` : §2, §3, §10 (« Principes communs », « C6 », « Cycle de vie des modèles »), §11 ;
- `docs/superpowers/specs/2026-10-31-c5-spectral-design.md`, son plan, `docs/models/c5-spectral.md` et les sections « C5 » et « C7 » de `docs/superpowers/suivi-prototype.md` : format, poids verrouillés, décisions append-only, consentement et export ;
- `datasets/SOURCES.md` (licences), `datasets/Images/dataset3/` (lu sans modification) ;
- code : `core/src/microtrace_core/spectral/{archive,train}.py`, `engine/src/microtrace_engine/{app,spectral,spectral_text,uploads,numbers}.py`, `web/src/server/{spectral,training-consent,file-store,multipart}.ts`, `web/src/lib/{spectral,training-consent}.ts`, `…/etudes/[studyId]/spectres/*`.

**Mesures.** Les chiffres des §3, §4 et §12 ont été **mesurés** le 2026-11-01 sur ce PC, en lecture seule sur `datasets/`, avec des scripts jetables hors du dépôt. Le `.venv` du dépôt (Python 3.14.3) n'a ni Pillow, ni scikit-image, ni torch : les mesures d'images ont été faites avec l'interpréteur système `C:\Python314\python.exe`, qui contient déjà Pillow 12.1.1, scikit-image 0.26.0, tifffile 2026.3.3, scikit-learn 1.8.0, numpy 2.5.0 et scipy 1.17.1 (rien n'a été installé). La commande d'entraînement (§5) les recalcule dans le `.venv` ; un écart au-delà des tolérances du plan arrête l'implémentation. Les chiffres de Mask R-CNN (§4.4) sont des **estimations** : torch 2.12.1 est présent dans l'interpréteur système mais ne se charge pas (`WinError 1114` sur `c10.dll`), et torchvision est absent.

---

## 0. Décisions à confirmer (résumé)

| # | Décision proposée | § |
|---|---|---|
| D1 | Modèle d'essai `i1` **classique** : forêt aléatoire de pixels sur descripteurs multi-échelles (inférence numpy), post-traitement morphologique, classifieur de forme par régression logistique sur descripteurs géométriques, règles de référence publiées à côté. Mask R-CNN n'est **pas servi** en `i1` : script reproductible pour GPU, adopté plus tard seulement s'il bat `i1` sur le test tenu à part (§4.4). | §4 |
| D2 | Nouvelles dépendances du moteur : **Pillow** (lecture PNG/JPEG/TIFF, réécriture sans métadonnées) et **scikit-image** (contours, Feret, régions). Torch et torchvision : extra `ml[maskrcnn]` seulement, jamais dans le moteur en `i1`. | §6 |
| D3 | `dataset3` (licence « À compléter ») sert au modèle d'essai interne, comme les bibliothèques spectrales en C5 (R-C5-1) ; aucune de ses images n'est affichée aux laboratoires, sauf dans les tests de bout en bout locaux (lue dans `datasets/`, jamais copiée). | §3 |
| D4 | Roboflow **non utilisé** (ni apprentissage, ni évaluation, ni affichage). | §3.3 |
| D5 | Le fichier déposé **n'est pas conservé** : seule l'image d'analyse réécrite par le moteur (pixels seulement, sans aucune métadonnée) et l'image annotée sont stockées ; l'empreinte du fichier d'origine est gardée. | §8.1 |
| D6 | Les comptages validés restent dans l'onglet « Images » (section et CSV « comptage de particules candidates ») ; rien n'entre dans Résultats, le rapport ni la table `Measurement`. | §9.4 |
| D7 | Corrections par particule : exclusion (« Pas une particule ») et changement de forme, plus un nombre de particules manquées ; pas d'édition de contour. | §8.3 |
| D8 | Le consentement passe en version `c2` (texte étendu aux images) ; les laboratoires consentants en `c1` doivent renouveler avant tout export. | §10 |

## 1. Intention

Un chercheur a photographié un filtre ou une lame au microscope (MEB ou optique). Il veut une **proposition** honnête :
- le contour de chaque **particule candidate** ;
- leur nombre ;
- pour chacune : taille (diamètre de Feret maximal et minimal, aire) en µm quand l'échelle est connue, et forme (`fibre | fragment | bille | film`) avec un score ;
- la distribution des tailles ;
- l'image annotée, téléchargeable.

Il accepte, corrige (particule par particule) ou rejette la proposition. Une image validée donne un **comptage de particules candidates**, jamais une mesure chimique : l'image ne dit pas si une particule est un plastique (§10 « Principes communs »).

## 2. Anti-objectifs (un échec même si « ça marche »)

Ceux de la spec §2 et du §10 « Principes communs » s'appliquent. Pour C6 :

1. **Aucune identification de polymère à partir d'une image**, aucune mention « plastique » sur une particule : le mot est « particule candidate ».
2. **Aucune fuite entre photos à l'évaluation** : une photo, ses recadrages, ses quasi-doublons et ses prises du même champ sont du même côté de la séparation (§5.1).
3. **L'abstention est réelle** : des conditions « non fiable » mesurées sur la validation, publiées avec leur fréquence sur le test (§4.5).
4. **Aucune taille en µm sans échelle déclarée ou lue** ; une échelle saisie qui contredit celle de l'image est refusée (§7.3).
5. **Aucune image stockée, affichée ou exportée avec des métadonnées** : le moteur décode les pixels et réécrit un PNG neuf ; l'original n'est pas conservé ; aucun champ de métadonnée (nom d'opérateur, chemin, commentaire, EXIF, XMP) n'est renvoyé, journalisé ni stocké (§7.2).
6. **Aucun comptage mêlé aux mesures** : ni dans `Measurement`, ni dans Résultats, ni dans le rapport (§9.4).
7. **Aucune règle ni aucun calcul d'image en TypeScript** : segmentation, tailles, formes, histogrammes, application des corrections, statut : tout est dans `core` ou le moteur.
8. **Le moteur ne sert jamais des poids dont l'empreinte diffère** de celle du verrou versionné (§6.3).
9. **Aucune donnée d'un laboratoire chez un autre** ; aucun export sans consentement actif en version courante.
10. **Rien n'est modifié ni supprimé** : chaque analyse et chaque décision est une nouvelle ligne `ModelPrediction` ; le journal est en ajout seul.
11. **Aucun contenu d'image, nom de fichier, métadonnée ni note** dans les journaux du moteur ou dans `console.*`.
12. **Une forme non évaluée n'est jamais proposée** : `film` n'existe pas dans les données ; le modèle ne le propose pas ; une personne peut le choisir en correction (§4.3).

## 3. Données

### 3.1 `dataset3` : ce qui est utilisable (mesuré)

Images MEB (Hitachi SU5000), 237 images d'origine en 5 sous-jeux, chacune avec un masque :

| Sous-jeu | Dossier | Forme (dossier) | Images | Taille (px) | Masque | Comptage `counts_*.txt` | Échelle connue |
|---|---|---|---|---|---|---|---|
| `bead` | `bead/bead` | bille | 51 | 1 280 × 900 | gris 8 bits (anticrénelé) | 51 images, 69 particules | 51 |
| `fibre_1` | `fibre/fibre_1` | fibre | 41 | 1 280 × 900 (38), 2 560 × 1 800 (3) | binaire 1 bit | 41 images, 248 | 41 |
| `fibre_2` | `fibre/fibre_2` | fibre | 49 | 1 279 × 899 à 1 536 × 1 080 | binaire (1 bit ou RGBA) | aucun | 0 |
| `fragment_1` | `fragment/fragment_1` | fragment | 55 | 2 560 × 1 800 | gris 8 bits | 55 images, 97 | 55 |
| `fragment_2` | `fragment/fragment_2` | fragment | 41 | 1 280 × 898, 800 × 561 | gris 8 bits | 40 images, 61 | 41 |

Constats :
- **Les masques sont sémantiques (binaires), pas d'instances** : seuillés à 128, leurs composantes connexes égalent le comptage du fichier `counts` pour 38/51 images de billes (49/51 à ±1), 8/41 de `fibre_1` (les fibres se croisent : 165 composantes pour 248 fibres), 51/55 de `fragment_1`, 35/41 de `fragment_2`. Les instances d'évaluation sont donc les **composantes connexes** du masque (§5.3), et le **comptage** de référence est celui des fichiers `counts` (188 images).
- Les PNG sont des recadrages des TIFF d'origine sans le bandeau d'information du bas (960 → 900, 1 920 → 1 800, 600 → 561 lignes, soit 1/16 de la hauteur environ), et `fibre_1` est réduit de moitié (2 560 → 1 280). L'appariement PNG ↔ TIFF par nom réussit pour 188 images ; `fibre_2` porte d'autres noms et n'a pas d'échelle.
- **Échelle** : le TIFF Hitachi porte `PixelSize` (nm par pixel) dans l'étiquette 40092 (`XPComment`, UTF-16). Ramenée aux PNG : 0,099 à 4,96 µm par pixel (facteur 50).
- **Métadonnées personnelles** : les fichiers `.txt` à côté des TIFF contiennent `Directory=C:\Users\PC-SEM\Desktop\All Users\<prénom nom>\…` (deux noms d'opérateurs, 243 fichiers). Le TIFF lui-même porte `XPComment` (avec des champs libres `SampleName`, `Comment`, `KeyWord1/2`, vides ici) et `XPAuthor` (« SU5000 ») ; 47 TIFF de `fibre_1` portent en plus XMP, EXIF et ressources Photoshop. Ces fichiers sont exactement le cas de l'anti-objectif 5.
- **Dérivés exclus** : `fibre_1crop` (101 recadrages 512 × 512 de `fibre_1`, annotations VIA par polygones), `fibre_1crop/label_index` (800 images augmentées) et `fibre_2crop` (100 recadrages) ne servent pas en `i1` : ils dérivent des photos d'origine et feraient fuir l'évaluation s'ils n'étaient pas rattachés à leur photo (la correspondance de `fibre_2crop` est inconnue). Les polygones VIA de `fibre_1crop` sont les seules vraies instances de fibres : réservés à Mask R-CNN (§4.4), rattachés au groupe de leur photo source.
- **Classe par particule** : la forme est celle du dossier ; aucune forme n'est annotée par particule. **Aucune image de film.**

### 3.2 Licence

`SOURCES.md` : auteurs, DOI et licence de `dataset3` « À compléter ». Règle proposée (D3), alignée sur R-C5-1 :
- `dataset3` sert au modèle d'essai interne et à son évaluation ;
- aucune image de `dataset3` n'est montrée aux laboratoires ni versionnée ; les tests de bout en bout la lisent dans `datasets/` au moment du test, comme le spectre MicroPlastiX de C5 ;
- **avant toute présentation aux laboratoires**, retrouver la source (article, auteurs, licence) ; d'ici là, la fiche dit « licence à confirmer » et l'écran « entraîné sur un jeu public d'images MEB dont la licence est en cours de vérification ».

### 3.3 Roboflow : non utilisé

Export Roboflow (`datasets/Images/*.parquet`) : licence inconnue, classe sans nom, microscopie non documentée, images augmentées dans tous les sous-ensembles, deux photos dans deux sous-ensembles. Proposition D4 : **ni apprentissage, ni évaluation, ni affichage** en `i1`. Conséquence sur les limites affichées : la spec prévoyait « entraîné sur des images MEB et d'un seul type de microscopie optique » ; la phrase devient « entraîné et évalué sur des images MEB seulement : sur une image de microscopie optique, ses performances sont inconnues » (§7.5). Le suivi reçoit : « Roboflow : retrouver la licence ; s'il est utilisable, regrouper les augmentations par photo d'origine et mesurer `i1` hors domaine ».

## 4. Le modèle `i1`

### 4.1 Pourquoi pas Mask R-CNN maintenant

- **Matériel** : ce PC a un Intel Core i7-7500U (2 cœurs, 4 fils), 7,9 Go de RAM (1,7 Go libres au moment de la mesure), une carte Intel HD 620 et **aucun GPU NVIDIA** (`nvidia-smi` absent ; torch ne se charge pas).
- **Coût estimé** (non mesuré, torch inutilisable) : Mask R-CNN ResNet-50 FPN de torchvision, images de 1 024 px, 147 images d'apprentissage × 30 époques ≈ 4 400 itérations à 15–25 s chacune sur ce processeur, soit **18 à 30 heures**, avec 5 à 7 Go de mémoire au pic : impraticable. Sur un GPU T4 (Colab) : 0,25–0,4 s par itération, **20 à 30 minutes**. Inférence CPU estimée ici : 4 à 8 s par image.
- **Données** : sans instances (§3.1), Mask R-CNN apprendrait des blocs fusionnés (billes collées, fibres croisées) ; il faudrait des poids pré-entraînés COCO, dont l'usage commercial (images Flickr de COCO) est une question de licence à poser ; torch + torchvision ajouteraient environ 250 Mo au moteur.

D'où l'approche par étapes (D1) : **(a)** un modèle classique, évaluable maintenant sur ce PC, entraîné en quelques minutes, servi en numpy ; **(b)** un script Mask R-CNN reproductible pour GPU, avec le même découpage et le même évaluateur, adopté comme `i2` seulement s'il fait mieux sur le test tenu à part (§4.4).

### 4.2 Pipeline d'une requête

1. **Lecture** (§7.2) : décodage par Pillow, orientation EXIF appliquée, image ramenée en niveaux de gris 8 bits (16 bits : étirement entre les centiles 0,5 et 99,5 ; RGB/CMYK : luminance ; alpha ignoré), bandeau Hitachi retiré, échelle lue ou saisie.
2. **Réduction** à `ANALYSIS_MAX_SIDE = 1 024` px de grand côté (bilinéaire) ; l'échelle de travail est multipliée par le facteur de réduction. L'image réduite est l'**image d'analyse** : contours, tailles en pixels et image affichée sont dans son repère.
3. **Normalisation** : étirement entre les centiles 1 et 99 de l'image.
4. **Descripteurs de pixels** (23) : intensité ; pour σ ∈ {1, 2, 4, 8, 16} : lissage gaussien, gradient, laplacien, écart-type local ; intensité moins fond (gaussienne σ = 64), et sa valeur absolue lissée (σ = 4). scipy seulement.
5. **Forêt aléatoire** (60 arbres, profondeur ≤ 14, feuilles ≥ 20 pixels, équilibrée) : probabilité « particule » par pixel. Inférence numpy sur les tableaux de l'archive (§6.1), testée égale à `predict_proba` de scikit-learn.
6. **Post-traitement** : seuil `PIXEL_THRESHOLD`, ouverture (disque de rayon 2), remplissage des trous, composantes connexes (connexité 8), suppression des composantes de moins de `MIN_AREA_FRAC` de l'image (taille minimale comptée, convertie en µm et affichée). Avec la valeur attendue (0,5 %), une image d'analyse de 1 024 × 720 px ne compte pas les particules de moins de 3 686 px, soit un diamètre équivalent de 68 px (6,7 % de la largeur) : c'est la contrepartie des faux objets du fond, et la limite la plus visible du modèle.
7. **Particules** (§4.3) : contour (`find_contours` puis simplification à 1 px, au plus 200 sommets), aire, Feret maximal et minimal (calibres tournants sur l'enveloppe convexe), diamètre équivalent, circularité, solidité, allongement, contact avec le bord.
8. **Forme** (§4.3) et **statut de l'image** (§4.5).

### 4.3 Forme

Descripteurs (sans taille absolue, qui dépend du grossissement et trahirait le sous-jeu) : circularité `4πA/P²`, solidité, log du rapport des axes, log de l'allongement (`max(Feret max, A / largeur) / largeur`, largeur = 2 × maximum de la transformée de distance), étendue, excentricité.

- **Règles de référence** (publiées, non servies) : fibre si allongement ≥ 3 ; bille si circularité ≥ 0,8, solidité ≥ 0,95 et rapport des axes ≤ 1,3 ; fragment sinon.
- **Classifieur servi** : régression logistique multinomiale (`C = 1`, classes équilibrées, descripteurs centrés-réduits), apprise sur les composantes du masque de référence des images d'apprentissage ; inférence numpy (`softmax(Wx + b)`).
- **Score** = probabilité de la forme proposée. Sous `SHAPE_MIN_SCORE`, la forme est « incertaine » (proposée à titre indicatif).
- **`film` non évalué** : absent des données, jamais proposé ; présent dans le vocabulaire de correction ; la fiche et l'écran le disent (« forme non évaluée dans cette version »).

Mesures sur les composantes du masque de référence (taille ≥ 0,05 % de l'image), modèle appris sur apprentissage + validation, test tenu à part (100 composantes, 42 images) :

| Méthode | Exactitude | Exactitude équilibrée | Rappel bille / fibre / fragment |
|---|---|---|---|
| Règles (allongement ≥ 3) | 0,76 | 0,58 | 0,25 / 0,98 / 0,50 |
| Règles (allongement ≥ 5) | 0,85 | 0,68 | 0,25 / 0,91 / 0,88 |
| Régression logistique (`C = 1`) | **0,91** | **0,93** | 1,00 / 0,91 / 0,88 |

Les « billes » de `dataset3` (microbilles d'acrylates d'un produit cosmétique) sont irrégulières : les règles les appellent « fragment ». La régression logistique les reconnaît, mais elles viennent toutes d'un seul échantillon (8 composantes au test) : la fiche le dit. Sur la validation (appris sur l'apprentissage seul), garder les formes de score ≥ 0,7 donne 94 % d'exactitude sur 88 % des particules ; `SHAPE_MIN_SCORE` est choisi par la commande sur la validation (§5.4).

### 4.4 Mask R-CNN (étape b, optionnelle)

- Script `ml/src/microtrace_ml/maskrcnn.py`, extra `ml[maskrcnn]` (torch, torchvision), exécutable sur GPU (Colab) : mêmes groupes et même séparation (exportés par `microtrace_core` en COCO), instances = composantes du masque, plus les polygones VIA de `fibre_1crop` rattachés à leur photo ; prédictions du test écrites en JSON (polygones) puis évaluées par `python -m microtrace_core image-eval`, le même évaluateur que `i1`.
- **Règle d'adoption** (version `i2`, nouvelle conception courte) : F1 objets au test ≥ F1 de `i1` + 0,10, erreur absolue de comptage pas plus grande, inférence CPU ≤ 30 s sur ce PC, licence des poids pré-entraînés confirmée, et accord du contrôleur sur l'ajout de torch au moteur.
- Rien de cette étape ne bloque la clôture de C6.

### 4.5 Statut de l'image et abstention

| Statut | Libellé | Conditions |
|---|---|---|
| `proposal` | « Proposition » | aucune raison ci-dessous |
| `unreliable` | « Non fiable (abstention) » | au moins une raison |

Raisons (`reasons`, plusieurs possibles), seuils fixés sur la validation par la commande (§5.4) :
- `no_particle` : aucune particule candidate ;
- `too_many_particles` : plus de `MAX_PARTICLES = 300` (les 300 plus grandes restent visibles à titre indicatif) ;
- `large_foreground` : plus de `MAX_FOREGROUND` de l'image segmentée (tapis de fibres, agrégat, fond texturé) ;
- `low_contrast` : écart entre les centiles 1 et 99 de l'image (après passage en 8 bits) inférieur à `MIN_CONTRAST = 10` sur 255 (garde fixe pour une image vide ou plate ; le minimum mesuré dans `dataset3` est 17) ;
- `scale_out_of_range` : échelle connue hors de [`SCALE_MIN`, `SCALE_MAX`] µm par pixel **de l'image d'analyse** ; la commande les calcule comme la plage d'apprentissage + validation divisée et multipliée par 2. Mesuré : plage 0,124 à 12,4 µm/px (facteur 100), d'où **[0,06 ; 25]**.

Sans échelle, l'analyse n'est **pas** abstenue (le comptage et les formes ne dépendent pas de l'échelle) mais **aucune taille en µm** n'est donnée : tailles en pixels de l'image d'analyse, histogramme absent, et la phrase « Échelle inconnue : tailles en pixels, non comparables entre images. ».

Par particule : `touches_border` (taille sous-estimée : « tronquée par le bord ») ; forme « incertaine » sous `SHAPE_MIN_SCORE`.

### 4.6 Constantes

Dans `microtrace_core.imaging` (la fiche les reprend) :

| Constante | Valeur |
|---|---|
| `IMAGE_MODEL_NAME`, `IMAGE_MODEL_VERSION` | `"c6-microscopie"`, `"i1"` |
| `SEED` | 0 |
| `ANALYSIS_MAX_SIDE`, `MIN_SIDE` | 1 024, 128 px |
| `SIGMAS`, `BACKGROUND_SIGMA` | (1, 2, 4, 8, 16), 64 |
| Forêt | 60 arbres, `max_depth = 14`, `min_samples_leaf = 20`, `class_weight="balanced"`, 1 500 pixels de chaque classe par image d'apprentissage |
| `PIXEL_THRESHOLD`, `MIN_AREA_FRAC` | choisis sur la validation dans {0,5 ; 0,6 ; 0,7 ; 0,8} × {0,0005 ; 0,001 ; 0,002 ; 0,005 ; 0,01} (§5.4) ; attendu 0,7 et 0,005 |
| `SHAPE_MIN_SCORE` | choisi sur la validation dans {0,5 ; 0,6 ; 0,7 ; 0,8} |
| `MAX_PARTICLES`, `MAX_CONTOUR_POINTS` | 300, 200 |
| `MAX_FOREGROUND`, `MIN_CONTRAST` | choisi sur la validation dans {0,2 ; 0,25 ; 0,3 ; 0,4} (§5.4, attendu 0,25) ; 10 (fixe) |
| `SCALE_MIN`, `SCALE_MAX` | plage d'apprentissage + validation ÷ 2 et × 2, en µm/px de l'image d'analyse (attendu 0,06 et 25) |
| `SIZE_BINS_UM` | 0, 10, 20, 50, 100, 200, 500, 1 000, 5 000, +∞ (Feret maximal) |
| `MAX_IMAGE_BYTES`, `MAX_PIXELS` | 25 Mio, 40 000 000 pixels |
| `HITACHI_BAR_FRACTION` | 1/16 de la hauteur (arrondi au supérieur) |
| `SCALE_MISMATCH_TOLERANCE` | 0,02 (2 %) |

## 5. Entraînement et évaluation

### 5.1 Index, groupes et séparation sans fuite

`microtrace_core.imaging.dataset.build_index(root)` :
- les 237 images d'origine des 5 sous-jeux (dérivés exclus, §3.1), leur masque, leur comptage, leur échelle (TIFF apparié par nom, `PixelSize` × largeur du TIFF / largeur du PNG) ;
- **groupes** : (1) `fibre_2` : préfixe d'échantillon (`PAN_01`, `PE_03`…), car `PAN_01_2kV`, `PAN_01_2.5kV` et `PAN_01_3kV` sont le même champ à trois tensions ; (2) quasi-doublons : vignettes 64 × 48 centrées-réduites, corrélation > 0,9 dans tout le jeu → même groupe. Mesuré : **218 groupes** (13 de plusieurs images ; 3 paires de quasi-doublons, corrélation 0,986 à 0,998 : `Particle_2_No0014/15`, `Particle_No0003/0011`, `PS_…_0081/0082`) ;
- **séparation** : `sha256(clé du groupe) mod 100` < 20 → test, < 40 → validation, sinon apprentissage. Mesuré : **147 / 48 / 42 images** (apprentissage / validation / test) ; au test : 7 billes, 10 `fibre_1`, 9 `fibre_2`, 7 `fragment_1`, 9 `fragment_2`.
- La séparation est **fixe** (pas de graine) et la liste est dans le manifeste ; un test vérifie qu'aucun groupe n'est de deux côtés.

### 5.2 Commande

```
python -m microtrace_core train-image --dataset datasets/Images/dataset3 --models models \
  --manifest docs/models/c6-microscopie-manifest.json --data-list docs/models/c6-microscopie-i1-data.sha256 \
  --lock engine/src/microtrace_engine/image_model.lock.json --card docs/models/c6-microscopie.md [--check]
```
- CPU, graine 0 ; deux exécutions donnent des poids identiques à l'octet (archive déterministe de C5).
- scikit-learn, Pillow et scikit-image ne sont importés que par `microtrace_core.imaging.train` et `…dataset` (extra `core[train,imaging]`) ; l'inférence n'importe que numpy, scipy, Pillow et scikit-image.
- Codes de sortie : 0 ; 3 index incohérent (nombre d'images ≠ 237 ou groupe des deux côtés) ; 4 empreinte différente (`--check`) ; 5 aucun réglage ne satisfait les critères ; 6 contrôle numpy ≠ scikit-learn.
- Durée mesurée de l'extraction des descripteurs : 404 s pour les 147 images d'apprentissage (2,7 s par image) ; durée totale attendue : 15 à 25 minutes sur ce PC.

### 5.3 Métriques (évaluateur commun `microtrace_core.imaging.evaluate`)

- **Pixels** : Dice moyen par image entre la segmentation et le masque.
- **Objets** : appariement glouton par IoU décroissante, seuil 0,5, entre les particules proposées et les **composantes du masque** de même taille minimale ; précision, rappel, F1 globaux et par sous-jeu.
- **Comptage** : nombre proposé contre le fichier `counts` (188 images) : erreur absolue moyenne, biais, part exacte, part à ±20 % (au moins ±1).
- **Tailles** : sur les paires appariées, erreur relative du Feret maximal et de l'aire (médiane, 90e centile, biais) ; en µm, l'erreur est la même proportion de la taille vraie quand l'échelle est juste.
- **Forme** : matrice de confusion sur les particules appariées (vérité = forme du dossier), exactitude équilibrée ; et sur les composantes du masque (§4.3) pour isoler le classifieur.
- **Abstention** : part de `unreliable` par raison, et métriques des images gardées contre celles abstenues.
- Limite écrite dans la fiche : les composantes du masque fusionnent les fibres croisées et les billes collées ; le F1 objets sous-estime donc le modèle sur `fibre_1` et le comptage `counts` est la référence la plus juste.

### 5.4 Choix des réglages (sur la validation seulement)

1. Forêt apprise sur l'**apprentissage**.
2. `PIXEL_THRESHOLD` et `MIN_AREA_FRAC` : le couple qui maximise le F1 objets de la validation ; égalité → l'erreur de comptage la plus faible, puis le seuil le plus haut.
3. `SHAPE_MIN_SCORE` : le plus petit seuil de la grille qui donne ≥ 0,90 d'exactitude sur les composantes de validation gardées (classifieur appris sur l'apprentissage).
4. `MAX_FOREGROUND` : le plus petit seuil de {0,2 ; 0,25 ; 0,3 ; 0,4} qui n'abstient pas plus de 10 % des images de validation. Mesuré : 0,2 abstient 9/48 (19 %), **0,25 abstient 3/48** (6 %). `MIN_CONTRAST` est fixe (10).
5. **Modèle final** : forêt et classifieur réappris sur apprentissage + validation avec ces réglages ; **le test n'est lu qu'une fois**, à la fin, pour les métriques publiées. Il n'entre jamais dans l'apprentissage du modèle servi.
6. Contrôle : sur 5 images de validation, la probabilité numpy égale `predict_proba` de scikit-learn à 1e-6 près, sinon code 6.

### 5.5 Manifeste et données

`docs/models/c6-microscopie-manifest.json` : `model` (`name`, `version`, `file` = `c6-microscopie-i1.npz`, `sha256`, `size_bytes`), `trained_at`, `code` (commit, état de l'arbre, versions numpy, scipy, scikit-learn, scikit-image, Pillow, Python), `data` (racine, nombre d'images par sous-jeu et par côté, liste des groupes et des côtés, sha256 de la liste des empreintes), `params` (§4.6), `selection` (grilles, valeurs retenues, métriques de validation), `metrics` (test : §5.3 global et par sous-jeu ; référence « seuil d'Otsu » ; règles de forme), `baseline_otsu`.

`docs/models/c6-microscopie-i1-data.sha256` (format `sha256sum`) : une ligne par image, masque, fichier `counts` et TIFF apparié (environ 670 lignes). Un test marqué `data` relit les fichiers.

## 6. Dépendances, poids et chargement

### 6.1 Archive `models/c6-microscopie-i1.npz`

Écrite par `write_archive` de C5 (déplacé dans `microtrace_core/archive.py`, réexporté par `spectral/archive.py`, sans changement de comportement), lue par `np.load(..., allow_pickle=False)` après vérification du sha256 :
- forêt : `forest/feature` (int16), `forest/threshold` (float32), `forest/left`, `forest/right` (int32), `forest/value` (float32, probabilité « particule » des feuilles), `forest/roots` (int32, premier nœud de chaque arbre) — tous les arbres concaténés ;
- forme : `shape/mean`, `shape/scale`, `shape/coef`, `shape/intercept` (float64), `shape/classes` (unicode) ;
- `meta` : JSON (nom, version, constantes, réglages, résumé des métriques, sans date ni commit).
Taille attendue : 3 à 8 Mo (environ 200 000 nœuds). Au-delà de 50 Mo, arrêt.

Inférence de la forêt : parcours vectorisé par profondeur (`node = where(feature[node] < 0, node, where(X[:, feature[node]] <= threshold[node], left[node], right[node]))`, 14 tours), moyenne des feuilles.

### 6.2 Dépendances proposées (D2)

| Paquet | Version (épinglée) | Licence | Où | Pourquoi |
|---|---|---|---|---|
| Pillow | 12.1.1 | MIT-CMU (HPND) | `core[imaging]`, moteur | décoder PNG/JPEG/TIFF (16 bits, CMYK, palette, EXIF), lire `XPComment`, réécrire un PNG sans métadonnées, dessiner l'image annotée |
| scikit-image | 0.26.0 | BSD-3-Clause | `core[imaging]`, moteur | `find_contours`, `approximate_polygon`, `regionprops` (Feret, solidité, axes), `label` |
| ↳ networkx, imageio, tifffile, lazy-loader | versions résolues par pip, ajoutées à `engine/constraints.txt` | BSD-3, BSD-2, BSD-3, BSD-3 | dépendances de scikit-image | — |
| scikit-learn | ≥ 1.5 (1.9.1 déjà dans le `.venv`) | BSD-3 | `core[train]` (déjà là) | forêt et régression logistique, à l'entraînement seulement |
| torch, torchvision | à épingler au moment de l'étape b | BSD-3 (code) ; poids COCO : à vérifier | `ml[maskrcnn]` seulement | Mask R-CNN sur GPU, jamais dans le moteur en `i1` |

Les versions de Pillow et scikit-image sont celles déjà présentes dans l'interpréteur système Python 3.14 (roues `cp314` disponibles). Leur installation dans le `.venv` et l'image Docker du moteur est **la seule action de téléchargement du plan** ; elle attend l'accord du contrôleur. `engine/constraints.txt` est régénéré et le test d'hygiène qui le compare au `.venv` reste vert.

### 6.3 Verrou et chargement

Identiques à C5 : `engine/src/microtrace_engine/image_model.lock.json` (`{name, version, file, sha256}`, écrit par la commande, égal au manifeste), `ImageModelStore` dans `ENGINE_MODELS_DIR` (états `ok`, `missing`, `sha_mismatch`, `invalid`, mis en cache, sha256 vérifié **avant** `np.load`). Le moteur démarre toujours.

## 7. Contrat du moteur

Points communs : `X-Engine-Secret`, `SecretAndSizeGate` (75 Mo), `ErrorModel` en français, aucun contenu ni nom de fichier ni métadonnée dans les journaux, OpenAPI régénéré, `npm run gen:engine`.

### 7.1 `POST /ai/image/analyze`

Corps multipart :

| Partie | Valeurs |
|---|---|
| `file` | PNG, JPEG ou TIFF, 25 Mio au plus |
| `scale_um_per_px` | facultatif : nombre décimal (point ou virgule) entre 0,001 et 1 000, µm par pixel **de l'image déposée** |

Réponse `ImageAnalyzeResponse` :

| Champ | Contenu |
|---|---|
| `model` | `{name, version, sha256}` |
| `trial_label`, `trial_sentence` | « Modèle d'essai » ; « Modèle d'essai : entraîné sur des images publiques de microscopie électronique, pas encore sur les vôtres. » |
| `input` | `sha256`, `size`, `format` (`PNG`/`JPEG`/`TIFF`), `width`, `height` (après orientation), `bit_depth`, `color` (`gray`/`rgb`/`cmyk`/`palette`), `orientation_applied`, `alpha_ignored`, `cropped_bottom_px`, `analysis_width`, `analysis_height`, `downscale` |
| `scale` | `{um_per_px_input, um_per_px_analysis, source: "metadata" \| "entered" \| "none", source_label, min_detectable_um}` (`null` sans échelle) |
| `status`, `status_label` | `proposal` « Proposition » \| `unreliable` « Non fiable (abstention) » |
| `reasons` | `[{code, label}]` (§4.5) |
| `explanation` | phrase française (§7.4) |
| `count`, `count_by_shape` | entier ; `[{shape, label, count}]` (fibre, fragment, bille, film = 0, incertaine) |
| `particles` | ≤ 300 × `{id, contour: [[x, y]…], bbox, area_px, feret_max_px, feret_min_px, area_um2, feret_max_um, feret_min_um, eq_diameter_um, circularity, solidity, elongation, touches_border, shape, shape_label, shape_score, shape_score_text, shape_status}` (µm : `null` sans échelle) |
| `size_distribution` | `null` sans échelle ; sinon `{basis: "feret_max_um", bins: [{lower, upper, label, count}], median_um, p10_um, p90_um}` |
| `images` | `{display_png_base64, annotated_png_base64}` : image d'analyse (8 bits, sans métadonnée) et image annotée ; **retiré par le web avant d'enregistrer la réponse** |
| `thresholds` | `{pixel, min_area_frac, shape_min_score, max_foreground, min_contrast}` |
| `limits` | phrases (§7.5) |
| `shape_vocabulary` | `[{code, label, evaluated}]` : fibre, fragment, bille (évaluées), film (non évaluée) |

Taille : 300 particules × 200 points au pire ≈ 1,5 Mo de JSON ; images ≈ 0,3 à 1,5 Mo en base64.

Erreurs (422, messages fixes) : « Format d'image non pris en charge : déposez un PNG, un JPEG ou un TIFF. » ; « Image illisible ou tronquée. » ; « TIFF à plusieurs pages non pris en charge : exportez une seule image. » ; « Image trop petite ({w} × {h} px) : il faut au moins 128 px de côté. » ; « Image trop grande ({n} millions de pixels) : 40 millions au plus. » ; « Échelle invalide : un nombre de micromètres par pixel entre 0,001 et 1 000. » ; « L'échelle saisie ({a} µm/px) diffère de celle lue dans l'image ({b} µm/px) : corrigez-la ou laissez le champ vide. ». 413 : « Fichier trop volumineux (limite : 25 Mo). ». 503 : modèle indisponible (§7.6).

### 7.2 Lecture d'image et métadonnées (`microtrace_core.imaging.reading.decode_image`)

- `Image.open(BytesIO(data), formats=["PNG", "JPEG", "TIFF"])` ; `Image.MAX_IMAGE_PIXELS = MAX_PIXELS` et refus si `w × h > MAX_PIXELS` **avant** `load()` (bombe de décompression) ; `n_frames > 1` → `multipage` ;
- `ImageOps.exif_transpose` ; modes : `1`, `L`, `P` (palette → `L`), `LA`/`RGBA`/`PA` (alpha retiré, `alpha_ignored = true`), `RGB`, `CMYK` (→ `RGB` → luminance), `I;16*`/`I`/`F` (étirement 0,5–99,5 vers 8 bits) ; autres → `unsupported_mode` ;
- **échelle Hitachi** : étiquette 40092 décodée en UTF-16, recherche du seul motif `^PixelSize=([0-9.]+)$` (nm) ; si présent avec `SerialNumber=` et `DataNumber=`, le bandeau du bas est retiré (`ceil(h / 16)` lignes) ; aucune autre valeur de l'étiquette n'est lue ni conservée ; `XResolution` / `ResolutionUnit` ne sont **jamais** utilisés (72 ou 96 ppp sans rapport avec l'échantillon) ;
- `core` renvoie un tableau `uint8` et des nombres : **jamais** une chaîne venue du fichier ; `ImageReadError(issue, width, height, pixels)` ne contient aucun contenu ;
- les PNG renvoyés sont créés par `Image.fromarray(array).save(buf, "PNG", optimize=False)` sans `pnginfo` ni `exif` : un test cherche dans leurs octets les chaînes d'un TIFF piégé (§13).

### 7.3 Échelle

- Saisie : µm par pixel **de l'image déposée** ; l'échelle d'analyse = saisie × (largeur déposée après recadrage / largeur d'analyse).
- Lue (Hitachi) et saisie différentes de plus de 2 % → 422 (anti-objectif 4). Égales → `source: "metadata"`.
- Aucune → `source: "none"`, tailles en pixels.
- Formats de métadonnées d'autres fabricants (Zeiss, FEI/Thermo, JEOL, Olympus, OME-TIFF) : non lus en `i1` (suivi) ; la page invite à saisir l'échelle.

### 7.4 Les mots à un seul endroit : `microtrace_engine/image_text.py`

Libellés des formes (« Fibre », « Fragment », « Bille », « Film », « Forme incertaine »), des statuts, des raisons, des sources d'échelle (« lue dans l'image (MEB Hitachi) », « saisie », « inconnue »), messages d'erreur, explications, limites, libellés des classes de taille (« moins de 10 µm », « 10 à 20 µm »…, « 5 000 µm et plus »).

Explications :
- proposition : « 12 particules candidates (5 fibres, 6 fragments, 1 bille) d'au moins 14 µm de diamètre équivalent. Leur nature (plastique ou non) n'est pas déterminée par l'image. Proposition à valider par une personne compétente. » ;
- sans échelle : « … Échelle inconnue : tailles en pixels, non comparables entre images. » ajouté ;
- non fiable : « Aucune proposition fiable : {raisons}. Les contours restent visibles à titre indicatif. » avec, par raison : « aucune particule candidate détectée » ; « plus de 300 particules candidates (seules les 300 plus grandes sont tracées) » ; « 47 % de l'image est segmentée (tapis de fibres, agrégat ou fond texturé) » ; « contraste trop faible » ; « échelle de 40 µm/px hors de la plage d'entraînement (0,06 à 25) ».

### 7.5 Limites (`limits`, dans cet ordre)

1. « Modèle d'essai : entraîné sur des images publiques de microscopie électronique, pas encore sur les vôtres. »
2. « Entraîné et évalué sur des images MEB seulement : sur une image de microscopie optique ou d'un autre microscope, ses performances sont inconnues ; il faudra une recalibration avec quelques images annotées par le laboratoire. »
3. « Le modèle n'a pas vu de particules extraites de sang. »
4. « L'image ne dit pas si une particule est un plastique : seule une méthode chimique (spectre, Py-GC/MS) le peut. »
5. « Une particule plus petite que la taille minimale indiquée n'est pas comptée. Des particules qui se touchent ou se croisent peuvent être comptées comme une seule. »
6. « La forme « film » n'est pas évaluée dans cette version : elle n'est jamais proposée. »
7. « Une proposition n'est jamais enregistrée comme mesure : elle est à valider par une personne compétente. »

### 7.6 `GET /ai/image/model`

`ImageModelInfo` (toujours 200) : `available`, `reason`, `message` (« Modèle d'images absent : lancez l'entraînement (python -m microtrace_core train-image). » ; « Le fichier du modèle d'images ne correspond pas à l'empreinte attendue : il n'est pas utilisé. » ; « Le fichier du modèle d'images est illisible : il n'est pas utilisé. »), `name`, `version`, `expected_sha256`, `sha256`, `trial_label`, `trial_sentence`, `limits`, `card_path` (`docs/models/c6-microscopie.md`), `max_bytes`, `max_pixels`, `analysis_max_side`, `shape_vocabulary`, `thresholds`, `metrics` (F1 objets, erreur de comptage, erreur de taille, exactitude des formes, parts d'abstention : du manifeste), `training_data` (« dataset3 : 237 images MEB, licence à confirmer »).

### 7.7 `POST /ai/image/validate`

Applique une décision humaine à une analyse enregistrée ; aucun accès au modèle (disponible même si les poids manquent).

Corps JSON `ImageValidateRequest` : `analysis` (`particles`, `scale`, `count`, tels qu'enregistrés par le serveur web), `excluded` (identifiants), `reshaped` (`[{id, shape}]`), `missed_count` (0 à 10 000).

Règles (422, messages fixes) : identifiant inconnu (« Particule {id} inconnue. ») ; identifiant à la fois exclu et reformé (« Particule {id} : exclue ou reformée, pas les deux. ») ; forme hors vocabulaire (« Forme inconnue. ») ; forme identique à la proposée (ignorée, pas une erreur).

Réponse `ImageValidatedSummary` : `count` (gardées + manquées), `kept`, `excluded`, `missed`, `count_by_shape` (formes retenues ; les manquées sont « forme non renseignée »), `size_distribution` des particules gardées (même règle que §7.1 ; les manquées n'ont pas de taille), `changes` (nombre de formes changées), `sentence` (« 11 particules candidates validées : 10 proposées gardées, 2 exclues, 1 ajoutée sans contour. »).

## 8. Application web : service

### 8.1 `web/src/server/images.ts` (`server-only`)

```ts
getImageModel(ctx): Promise<ImageModelState>                                         // viewer
listImageAnalyses(ctx, studyId): Promise<{ rows: ImageAnalysisRow[]; hidden: number }> // viewer
getImageAnalysis(ctx, studyId, analysisId): Promise<ImageAnalysisView | null>        // viewer
readAnalysisImage(ctx, studyId, analysisId, which: "display" | "annotated"): Promise<Buffer | null> // viewer
analyzeImage(ctx, studyId, input): Promise<{ id: string; existing: boolean }>       // researcher
recordImageDecision(ctx, studyId, analysisId, input): Promise<{ id: string }>       // researcher
buildCountsCsv(ctx, studyId): Promise<DownloadFile>                                 // viewer
buildParticlesCsv(ctx, studyId, analysisId): Promise<DownloadFile>                  // viewer
```

**`analyzeImage`** (comme `analyzeSpectrum`, conception C5 §8.1) :
1. rôle `researcher` ; fichier non vide, ≤ 25 Mio (« Fichier trop volumineux (25 Mo maximum). ») ; échelle vide ou de la forme `^\d{1,4}([.,]\d{1,6})?$` (« Échelle invalide. ») ;
2. étude du laboratoire et non archivée, avant le moteur ;
3. `engineClient.analyzeImage` : 422/413 → message du moteur ; 503 → `IMAGE_MODEL_UNAVAILABLE` ; autre → `IMAGE_REFUSED` ; injoignable → `EngineUnavailableError` ;
4. `response.input.sha256` = sha256 local, sinon « Le moteur n'a pas analysé le fichier déposé : recommencez. » ;
5. idempotence : même étude, même sha256 d'origine, même échelle saisie, même `modelSha256` → `{ id, existing: true }` ;
6. décodage de `images.display_png_base64` et `images.annotated_png_base64`, `storeFile` de chacun (magasin adressé par contenu) ; **le fichier déposé n'est pas stocké** (D5) ;
7. transaction : `loadWritable`, ligne d'analyse (`output` = réponse **sans** `images`), audit.

### 8.2 Correspondance avec `ModelPrediction`

| Colonne | Analyse | Décision |
|---|---|---|
| `kind` | `image` | `image` |
| `status` | `proposed` | `accepted` \| `corrected` \| `rejected` |
| `inputFileSha256` | sha256 du fichier déposé (jamais stocké) | celui de l'analyse |
| `input` | `{ role: "analysis", fileName, sizeBytes, mimeType, scaleEntered, displaySha256, annotatedSha256 }` | `{ role: "decision", analysisId, decision, excluded, reshaped, missedCount }` |
| `output` | réponse du moteur sans `images` | `{ analysisId, proposedStatus, proposedCount, validated }` (`validated` = `ImageValidatedSummary`, `null` si rejetée) |
| `score` | moyenne des `shape_score`, ou `null` sans particule | celui de l'analyse |
| `modelName`, `modelVersion`, `modelSha256` | de la réponse | ceux de l'analyse |
| `decidedById`, `decidedAt`, `decisionNote` | `null` | utilisateur, maintenant, note |
| `createdById` | l'auteur | `null` |

Le nom de fichier reste en `input.fileName` de l'analyse (affiché dans le tableau, comme C5) : il n'entre jamais dans l'audit, l'export, un nom de lien, ni le nom d'un fichier téléchargé.

### 8.3 `recordImageDecision` (D7)

1. rôle ; `decision ∈ {accepted, corrected, rejected}` ; note ≤ 1 000 caractères ;
2. étude du laboratoire, non archivée ; analyse `kind: image`, `status: proposed` de cette étude, sinon « Analyse introuvable. » ;
3. règles lues dans l'`output` **enregistré** :
   - `accepted` sur `unreliable` → « Aucune proposition à accepter : corrigez ou rejetez. » ; `accepted` avec des corrections → « Une acceptation ne porte pas de correction : choisissez « Corrigée ». » ;
   - `corrected` sans aucune correction (aucune exclusion, aucun changement de forme effectif, 0 manquée) → « Aucune correction saisie : choisissez « Acceptée » ou modifiez au moins une particule. » ;
   - `rejected` : note obligatoire ; corrections ignorées refusées (« Une proposition rejetée ne porte pas de correction. ») ;
   - au plus 300 identifiants, entiers, présents dans l'analyse (contrôle de forme seulement ; le moteur revérifie) ;
4. `accepted` et `corrected` : `engineClient.validateImage` (§7.7) avec les particules **enregistrées** ; 422 → message du moteur ; moteur injoignable → `EngineUnavailableError` (rien n'est écrit) ;
5. transaction : verrou de l'étude, `createdAt` monotone (C7), création, audit.

Libellés dans `web/src/lib/images.ts` : décisions (« Acceptée » `positive`, « Corrigée » `warning`, « Rejetée » `neutral`, « Non examinée » `outline`), statuts (`proposal` → `positive`, `unreliable` → `neutral`), options de correction (« Proposée », « Fibre », « Fragment », « Bille », « Film », « Pas une particule »), `IMAGE_MAX_BYTES`, formats acceptés.

### 8.4 Audit

| Action | `after` |
|---|---|
| `image.analysis` « Analyse d'image enregistrée » | `{ kind: "image", studyId, status, count, scaleSource, modelVersion, inputSha256 }` |
| `image.decision` « Décision sur une image enregistrée » | `{ kind: "image", studyId, analysisId, decision, proposedCount, validatedCount, excluded, reshaped, missed, modelVersion, hasNote }` |
| `image.counts_export` « Export des comptages de particules candidates » | `{ studyId, rows }` |

Ni nom de fichier ni note. `audit-labels.ts` : entité « Analyse d'image » quand `after.kind === "image"` ; objet « {count} particules candidates » ou « image non fiable ».

### 8.5 Isolation

Comme C5 §8.5 : chaque lecture filtre `study: { laboratoryId }` ; les routes d'image et de CSV répondent 404 hors laboratoire ; le module `images` entre dans `tenant-isolation.test.ts` (`MODULES`, `CASES`, `WRITES`, lecteurs) ; le simulacre `engineClient` reçoit `imageModel`, `analyzeImage`, `validateImage`. Tests ajoutés : une image d'analyse de B demandée sous une étude de A → 404 ; une décision de B sur une analyse de A est impossible ; l'export de A ne contient jamais une ligne de B.

## 9. Écran « Images »

**Onglet :** `{ segment: "images", label: "Images" }` entre « Spectres » et « Rapport ». Adresses :
- `/labo/[labSlug]/etudes/[studyId]/images` (liste, dépôt, comptages validés) ;
- `/labo/[labSlug]/etudes/[studyId]/images/[analysisId]` (une analyse) ;
- route `POST …/images/analyser` (multipart borné, `web/src/server/multipart.ts`, 25 Mio + 1 Mio) ;
- routes `GET …/images/[analysisId]/image` (image d'analyse, `inline`), `…/annotee` (PNG en pièce jointe, `microtrace-image-annotee-{AAAA-MM-JJ}.png`), `…/particules` (CSV), `GET …/images/comptages` (CSV) ; en-têtes `Content-Type` exact, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Disposition` de `download-response.ts` ; HEAD → 405.

Conventions : celles de Spectres (C5 §9) : `Section`, `Alert`, `Badge`, `EmptyState`, `Table` avec `TableCaption sr-only`, jetons de couleur seulement, un seul `h1`, tablette 768 et 1024, **aucun lien dont le nom contient « Rapport » ou « Résultats »** (lien « Voir », `aria-label` « Ouvrir l'analyse du {date} »).

### 9.1 Page liste

1. `Alert info` avec le badge « Modèle d'essai » : `trial_sentence`, « Chaque proposition est à valider par une personne compétente ; elle n'est jamais enregistrée comme mesure. », limites 2, 3 et 4, la phrase de la phase d'essai et l'état du consentement (comme Spectres).
2. Modèle indisponible : `Alert destructive` ; étude archivée : `Alert info`.
3. `Section` « Analyser une image » (`researcher`+, non archivée, modèle disponible) : `AnalyzeImageForm` (client) : `input type="file"` « Image de microscopie » (`.png,.jpg,.jpeg,.tif,.tiff`), champ « Échelle (µm par pixel) » facultatif avec l'aide « Laissez vide pour un TIFF de MEB Hitachi (échelle lue dans l'image) ; sinon, sans échelle, les tailles restent en pixels. », bouton « Analyser l'image » (« Analyse en cours… »), `FormError`.
4. `Section` « Analyses de l'étude » : Date, Fichier, Statut (badge), Particules (proposées), Échelle (source), Décision, « Voir ». 500 lignes au plus. Vide : `EmptyState` (`ImageIcon`) « Aucune image analysée dans cette étude. ».
5. `Section` « Comptage de particules candidates (images validées) » : texte « Comptages issus d'images, validés par une personne. Ce ne sont pas des mesures : la nature des particules n'est pas déterminée. Ils ne figurent ni dans Résultats ni dans le rapport. » ; table par image validée (dernière décision acceptée ou corrigée) : Date de la décision, Décision, Particules validées, Fibres, Fragments, Billes, Films, Forme non renseignée, Feret médian (µm ou « échelle inconnue »), lien « Voir » ; lien « Télécharger les comptages (CSV) ». Aucun total entre images (des images de grossissements et de surfaces différents ne s'additionnent pas ; suivi : concentration par surface de filtre).
6. `Section` « Fiche du modèle (version i1) » : métriques du test, seuils, formes évaluées et non évaluées, données (« dataset3, licence à confirmer »), « Fiche complète : docs/models/c6-microscopie.md (documentation du projet). ».

### 9.2 Page d'une analyse

1. `h2` « Analyse du {DateTimeFr} » ; `dl` : fichier, taille, sha256 abrégé, format et dimensions, profondeur, orientation appliquée, alpha ignoré, bandeau retiré, image d'analyse (dimensions), échelle (valeur et source, ou « inconnue »), taille minimale comptée, modèle et badge « Modèle d'essai » ; alerte de version différente.
2. `Section` « Proposition » : badge de statut, `explanation` mot pour mot, raisons d'abstention en liste, `count_by_shape` en tableau.
3. `Section` « Image et contours » : `ParticleOverlay` (composant serveur) : `<figure>` contenant `<img src=".../image" alt="">` en `w-full h-auto` et un `<svg viewBox="0 0 W H" preserveAspectRatio="none" class="absolute inset-0 h-full w-full">` ; un `<polygon>` par particule, `fill="none"`, `stroke` par forme (`var(--chart-1)` fibre, `var(--chart-2)` fragment, `var(--chart-3)` bille, `var(--chart-4)` film, `var(--muted-foreground)` en pointillés pour une forme incertaine), `vector-effect="non-scaling-stroke"`, numéro en `<text>` (au plus 300) ; `role="img"` et `aria-label` « Image analysée : {n} particules candidates délimitées » ; légende en liste HTML ; liens « Télécharger l'image annotée (PNG) » et « Télécharger les particules (CSV) ».
4. `Section` « Particules candidates » : table N°, Forme (badge + score à 2 décimales ; « incertaine » si sous le seuil), Feret max, Feret min, Aire (µm ou px selon l'échelle), Diamètre équivalent, Bord (« tronquée »). 300 lignes au plus.
5. `Section` « Distribution des tailles » : histogramme Recharts (`BarChart`, `var(--chart-1)`), axe « Diamètre de Feret maximal (µm) », conteneur `role="img"` ; `details` « Voir les données » (classe, nombre). Sans échelle : `Alert info` « Échelle inconnue : pas de distribution en µm. ».
6. `Section` « Décision » : dernière décision (badge, comptage validé, `sentence`, note, auteur, date, « ({k} décisions, voir le Journal) ») ; `ImageDecisionForm` (client, `ActionForm`) pour `researcher`+ : `fieldset` « Décision » (« Acceptée » absent si `unreliable`) ; pour « Corrigée » : table des particules avec un `select` « Forme retenue pour la particule {id} » par ligne (« Proposée : {forme} », Fibre, Fragment, Bille, Film, « Pas une particule ») et un champ « Particules manquées (sans contour) » (entier, 0 par défaut) ; « Note » (obligatoire pour « Rejetée ») ; « Enregistrer la décision ».
7. Lien « Toutes les analyses ».

Tablette : l'image et son calque se redimensionnent ensemble ; les tableaux défilent dans leur cadre (`overflow-x-auto`), comme Spectres.

### 9.3 CSV

- `…/particules` : `particle_id, shape, shape_label, shape_score, shape_status, feret_max_um, feret_min_um, area_um2, eq_diameter_um, feret_max_px, feret_min_px, area_px, touches_border, validated_shape, excluded` (les deux dernières selon la dernière décision ; vides sans décision). Nom : `microtrace-particules-{AAAA-MM-JJ}.csv` (jamais le nom du fichier déposé).
- `…/comptages` : `analysis_id, decision_id, decided_at, decision, study_nature, image_sha256, scale_um_per_px, scale_source, count_validated, count_fibre, count_fragment, count_bille, count_film, count_unspecified, missed, feret_median_um, model_name, model_version, model_sha256`. Nom : `microtrace-comptages-particules-{AAAA-MM-JJ}.csv`. Audit `image.counts_export`.

### 9.4 Place dans l'étude (D6)

- **Jamais** de ligne `Measurement`, d'entrée dans `/summary`, d'onglet Résultats ou de rapport : les comptages ne sont pas des concentrations de polymère.
- La section « Comptage de particules candidates » de l'onglet Images et son CSV sont l'« export vers l'étude » de la spec : ils appartiennent à l'étude, portent sa nature (bandeau SIMULÉ pour une étude simulée) et sont téléchargeables, distincts des mesures confirmées.
- Report d'un comptage validé dans le rapport (section séparée, avec surface de filtre et fraction observée) : suivi.

## 10. Consentement et export d'entraînement (D8)

- `TRAINING_CONSENT_VERSION` passe à `"c2"` ; `TRAINING_CONSENT_DETAILS` ajoute : « Seraient aussi utilisées : les images analysées telles que réécrites par MicroTrace (pixels seulement, sans aucune métadonnée), les contours proposés et les corrections des analyses d'images acceptées ou corrigées. Jamais le fichier d'image déposé ni son nom. ». Le mécanisme existant `CONSENT_RENEW` impose aux laboratoires consentants en `c1` de retirer puis redonner leur consentement avant tout export (texte changé). Pas de migration.
- `buildTrainingExport(ctx, format, kind: "spectral" | "image" = "spectral")` ; route `…/membres/export-entrainement?format=json|csv&type=spectres|images` (défaut `spectres`, inconnu → 400 « Type d'export inconnu. »).
- Lignes `image` : dernière décision `accepted` ou `corrected` de chaque analyse d'image des études du laboratoire **ni simulées ni sans pseudonymisation déclarée** ; au plus 1 000 ; colonnes `IMAGE_EXPORT_COLUMNS` = `analysis_id, decision_id, study_id, study_nature, decided_at, decision, image_sha256, analysis_width, analysis_height, scale_um_per_px, scale_source, proposed_count, validated_count, missed_count, model_name, model_version, model_sha256` ; JSON : en plus `display_png_base64` (l'image d'analyse du magasin, sha256 revérifié ; absente → `file_missing`) et `particles` (`id`, `contour`, forme proposée, forme validée, exclue) ; 50 Mo au plus ; format `microtrace.image-training-export` ; nom `microtrace-{labSlug}-entrainement-images-{AAAA-MM-JJ}.{json|csv}` ; audit `lab.training_export` avec `kind: "image"`.
- La page Membres ajoute les liens « Exporter les images consenties (JSON) » et « (CSV) ».

## 11. Fiche du modèle `docs/models/c6-microscopie.md`

Plan de C5 : 1. objet et statut (modèle d'essai ; particules candidates, jamais une identification de polymère) ; 2. version et empreintes ; 3. données et licences (`dataset3` « à confirmer », Roboflow non utilisé, dérivés exclus, masques binaires, échelles, données personnelles des fichiers d'acquisition) ; 4. pipeline et constantes ; 5. protocole (groupes, séparation, choix sur la validation, test lu une fois) ; 6. **bloc de métriques généré** (`<!-- BEGIN:metrics -->`…`<!-- END:metrics -->`) : test global et par sous-jeu, référence Otsu, règles de forme, confusion des formes, tailles, comptage, abstention ; 7. conditions d'échec connues (§12.3) ; 8. décisions humaines, consentement `c2` ; 9. ce qui change la version (`i2`) ; 10. relecture avant présentation.

## 12. Résultats attendus (mesures du 2026-11-01)

### 12.1 Segmentation

**Référence « seuil d'Otsu »** (un seul traitement fixe : fond retiré par une gaussienne de 1/8 de l'image, lissage σ = 4, polarité choisie automatiquement, ouverture, remplissage). Sur le **test** (42 images), aux mêmes résolution (1 024) et taille minimale que la forêt : Dice 0,594, **F1 objets 0,265** (précision 0,20, rappel 0,39), erreur absolue de comptage **1,94** (33 images), comptage exact 12 %, à ±20 % 52 %.

**Forêt de pixels** (60 arbres, profondeur 14, 1 500 pixels par classe, poids équilibrés ; modèle final appris sur apprentissage + validation, graine 0). Réglages choisis sur la validation (48 images) par la règle documentée : seuil de pixel **0,7**, taille minimale **1 %** de l'image, seuil de forme **0,5**, abstention au-delà de **25 %** de surface segmentée (F1 objets de validation 0,667, erreur de comptage 1,69). Plage d'échelle d'apprentissage : 0,124 à 9,92 µm/px, élargie d'un facteur 2 de chaque côté (0,062 à 19,8 µm/px).

| Test (42 images) | Dice | F1 objets | Précision | Rappel | Erreur de comptage (33 images) | Exact | ±20 % |
|---|---|---|---|---|---|---|---|
| **global** | **0,710** | **0,52** | 0,43 | 0,67 | **1,61** (biais −0,8) | 30 % | 55 % |
| `bead` (7) | 0,867 | 0,78 | 0,64 | 1,00 | 0,71 (biais +0,4) | | |
| `fibre_1` (10) | 0,719 | 0,65 | 0,52 | 0,85 | 2,90 (biais −2,9) | | |
| `fibre_2` (9) | 0,546 | 0,12 | 0,09 | 0,18 | — (pas de comptage) | | |
| `fragment_1` (7) | 0,918 | **0,96** | 1,00 | 0,93 | 1,00 (biais −1,0) | | |
| `fragment_2` (9) | 0,582 | 0,29 | 0,23 | 0,42 | 1,33 (biais +0,9) | | |

Le comptage moyen vrai des 33 images de test est de 2,8 particules : une erreur de 1,6 particule par image est **grande**. La forêt localise mieux qu'Otsu (F1 0,52 contre 0,27 ; Dice 0,71 contre 0,59) et compte un peu mieux (1,61 contre 1,94). C'est un modèle d'essai médiocre hors des fragments isolés sur fond lisse (`fragment_1`) ; la fiche, l'écran et l'abstention (§4.5) le disent. Le comptage des deux méthodes est publié.

**Abstention mesurée** (forêt, surface maximale 0,25) : validation 3/48 images « non fiable » ; **test 7/42** (6 `fibre_2` — tapis de fibres — et 1 `fibre_1`, toutes pour `large_foreground`) ; erreur de comptage des images gardées 1,53 (32 images comptées ; une seule image abstenue a un comptage de référence : erreur 4). Aucune image de `dataset3` n'est abstenue pour `low_contrast` ou `no_particle` : ces raisons ne sont atteintes que par les tests synthétiques et l'e2e. Le seuil de surface retire surtout les tapis de fibres, où un comptage n'a pas de sens. La fiche le dit.

**Durée** : 4,9 s par image en moyenne (descripteurs + forêt scikit-learn à 2 fils, 1 024 px, 90 images) ; l'inférence numpy de la forêt est à mesurer à la tâche 3 (plafond du plan : 30 s pour une image de 2 560 × 1 800).

**Tailles** (38 paires appariées du test) : Feret maximal, erreur relative médiane **2,0 %**, 90e centile 30,9 %, biais moyen +7,7 % (mais **40,3 %** d'erreur médiane sur les billes : à ne pas utiliser pour elles) ; aire, erreur relative médiane 15,6 % (contours plus larges ou plus étroits que l'annotation).

### 12.2 Forme

§4.3 : régression logistique 0,91 d'exactitude (0,93 équilibrée) sur 100 composantes du test, contre 0,76 (0,58 équilibrée) pour les règles. Sur les 38 particules proposées de bout en bout (forêt puis forme) : exactitude 0,84 (0,77 équilibrée) ; fibres 13/13, fragments 16/18, **billes 3/7** (forme confondue avec « fragment » dans 4 cas).

### 12.3 Conditions d'échec connues (pour la fiche)

- particules extraites de sang, matrice organique, filtre (pores, fibres de filtre) : jamais vus ;
- microscopie optique, fluorescence (rouge de Nil) : jamais vues ;
- particules qui se touchent ou fibres qui se croisent : comptées comme une seule (biais négatif mesuré sur `fibre_1`) ;
- substrat texturé (adhésif carbone, film) : faux objets (biais positif mesuré sur les billes) ;
- particules sous la taille minimale ; particules tronquées par le bord (55 % des composantes de référence touchent le bord) ;
- billes : un seul échantillon (microbilles cosmétiques irrégulières) ; film : non évalué ;
- échelle fausse : toutes les tailles fausses dans la même proportion (aucune détection possible sans métadonnée) ;
- bandeau d'information d'un autre fabricant non retiré : faux objets.

### 12.4 Image de bout en bout

Fichier `datasets/Images/dataset3/bead/original_image_bead/Dove_men_acrylates_copolymer_microbeads_new_No0045.tif` (TIFF Hitachi 1 280 × 960, 8 bits, 1 230 494 octets, sha256 `0fba33621fb3d236cff17f993776ffa4b16ce5955aa2d83c52be8af80ac85180`), du **côté test** (jamais appris) :
- `PixelSize=763.2211` → échelle lue **0,763 µm/px** (« lue dans l'image (MEB Hitachi) »), bandeau de 60 lignes retiré (le reste est identique à l'octet au PNG de référence), image d'analyse 1 024 × 720 à 0,954 µm/px ;
- mesuré avec la forêt apprise sur l'apprentissage seul : **1 particule** (vérité : 1), 72 014 px, soit un diamètre équivalent d'environ 289 µm ;
- attendu en e2e (modèle final, appris sur apprentissage + validation) : statut « Proposition », **1 ou 2** particules candidates, diamètre équivalent de la plus grande entre 240 et 340 µm ; la forme n'est pas vérifiée (une bille irrégulière peut être proposée « fragment »).

Seconde image e2e : PNG uniforme 512 × 384 de valeur 128 (générée par le test) → « Non fiable (abstention) », « aucune particule candidate détectée ».

Images de secours du test comptées exactement par la forêt : `fragment_1` `Particle_No0016` (2), `Particle_No0024`, `Particle_No0007`, `Foam_No0001` (1) ; `fragment_2` `PS_Isopropyl_Alcohol_Suspension_0067` (2, dont une particule proche de la taille minimale).

## 13. Points de relecture et preuves

| Point | Preuve |
|---|---|
| Fuite entre photos | pytest : aucun groupe des deux côtés ; les quasi-doublons mesurés (3 paires) et les champs `fibre_2` sont regroupés ; un espion vérifie que la forêt et le classifieur du test ne voient aucun pixel ni composante d'une image de test ; les dérivés (`*crop`, `label_index`) sont absents de l'index |
| Échelle fausse ou absente | pytest : sans échelle → tailles `null` en µm et pas d'histogramme ; échelle saisie contraire aux métadonnées → 422 ; échelle hors plage → `unreliable` ; recadrage et réduction pris en compte (un carré de 100 × 100 px à 0,5 µm/px donne Feret min 50 µm, après réduction de moitié aussi) ; `XResolution` ignoré |
| Images énormes ou étranges | pytest : TIFF 16 bits, CMYK JPEG, PNG RGBA, palette, EXIF orientation 6 (largeur et hauteur inversées, contours dans le repère orienté), TIFF multipage, en-tête PNG de 50 000 × 50 000 (refus avant décodage), fichier tronqué, GIF → 422 ; 25 Mio + 1 → 413 moteur et web sans appel au moteur |
| Aucune image avec métadonnées personnelles | pytest : TIFF piégé (`XPComment` avec `SampleName=Jean Dupont`, EXIF `Artist`, XMP `dc:creator`) → ni « Dupont » dans la réponse JSON, ni dans les PNG renvoyés, ni dans les journaux ; web : le fichier déposé n'est jamais écrit dans le magasin (compte des fichiers) ; export : seule l'image réécrite |
| Isolation entre laboratoires | `tenant-isolation.test.ts`, routes d'image et de CSV 404, e2e « Page introuvable » |
| Formes non évaluées | moteur : `film` jamais proposé (y compris sur une image synthétique de rectangle mince), `evaluated: false` ; écran : « non évaluée dans cette version » |
| Abstention atteinte | manifeste : part de `unreliable` par raison au test (> 0) ; pytest : image uniforme → `no_particle` ; damier → `large_foreground` ; 400 disques → `too_many_particles` ; e2e : image uniforme → « Non fiable (abstention) » sans « Acceptée » |
| Poids d'empreinte différente | moteur : octet modifié → `sha_mismatch`, 503, `np.load` jamais appelé |
| Rien en TypeScript | grep de `Math.`, `reduce(`, `toFixed` dans `images.ts`, `lib/images.ts`, `images/` |

## 14. Hors périmètre (suivi)

- Mask R-CNN (étape b) ; Roboflow (licence, regroupement, mesure hors domaine) ; licence de `dataset3`.
- Métadonnées d'échelle d'autres fabricants ; barre d'échelle lue sur l'image ; retrait du bandeau d'autres fabricants.
- Édition des contours, ajout d'une particule avec contour, scission ou fusion.
- Concentration par surface de filtre (surface du filtre, fraction observée), agrégation entre images, report dans le rapport.
- Image annotée de l'état validé (aujourd'hui : celle de la proposition ; l'état validé est à l'écran et dans le CSV).
- Plusieurs images par dépôt, mosaïques, piles de mise au point.
- Plafond d'analyses par étude, pagination au-delà de 500.

## 15. Questions pour le contrôleur et le fondateur

1. **Contrôleur** : D1 (modèle classique servi, Mask R-CNN différé) et D2 (Pillow 12.1.1 et scikit-image 0.26.0 dans le moteur ; installation dans le `.venv` et l'image Docker).
2. **Contrôleur** : D5 (le fichier déposé n'est pas conservé ; seul le PNG réécrit l'est), contraire à la règle des imports « fichier original conservé à l'identique », justifiée par les métadonnées personnelles.
3. **Contrôleur** : D8 (consentement `c2`, renouvellement imposé aux laboratoires consentants).
4. **Fondateur** : retrouver la source et la licence de `dataset3` (et de Roboflow) avant toute présentation aux laboratoires.
5. **Fondateur** : un GPU (Colab ou autre) pour l'étape b, et l'usage commercial des poids pré-entraînés COCO.
