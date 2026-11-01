# Fiche du modèle : analyse d'images de microscopie (C6), version i1

## 1. Objet et statut

**Modèle d'essai** : aide au repérage et au comptage de **particules candidates** sur une image de microscopie électronique à balayage (MEB), avec une taille en µm si l'échelle est connue et une forme proposée (bille, fibre, fragment). Il ne dit **jamais** de quel polymère il s'agit : une particule candidate n'est pas une identification, et un comptage n'est pas une concentration.

- Il formule une **proposition** (contours, comptage, formes, distribution de tailles, statut) ; une personne du laboratoire examine chaque analyse et enregistre sa décision. Rien n'est automatique.
- **Entraîné et évalué sur des images MEB seulement.** Il n'a jamais vu de microscopie optique, de fluorescence, de particules extraites de sang, de matrice organique ni de filtre.
- Modèle classique (forêt de pixels et régression logistique pour la forme), pas un réseau de neurones : un réseau (Mask R-CNN) est un sujet de suivi, non livré.
- **Médiocre hors des fragments isolés sur fond lisse.** Le comptage est peu fiable (chiffres en section 6) et doit être relu à l'écran.

## 2. Version et empreintes

- Modèle : `c6-microscopie`, version `i1`, entraîné le 2026-11-01.
- Empreinte sha256 des poids (`models/c6-microscopie-i1.npz`, 3 311 883 octets, jamais versionnés) : `c902bb7c70aac3ccdbe436b25bd6b4f50eb98f99bf1e8b615ebc7bd095f9d5c7`.
- Manifeste `docs/models/c6-microscopie-manifest.json` : sha256 `4d1a464a14668ddfd614ea46b0ad6c7a2ef0704f2187852279d2421a25feddfd` ; il porte aussi le commit du code (`52e9fa8bb004`, arbre propre au lancement), les versions des bibliothèques logicielles, les paramètres, la graine et l'empreinte de la liste des données.
- Liste des données `docs/models/c6-microscopie-i1-data.sha256` : 666 fichiers, sha256 `153ff0d70cbd2ee2ff6491a18f2715cf49366e43e10da7fd286052812daff4d7`.
- Verrou du moteur `engine/src/microtrace_engine/image_model.lock.json` : même empreinte de poids que le manifeste. Le moteur refuse de servir des poids dont l'empreinte diffère, sans les lire.
- Réentraînement reproductible : `python -m microtrace_core train-image … --check` (graine 0 ; refait l'entraînement et compare l'empreinte, sans rien écrire).

## 3. Données et licences

| Jeu | Contenu | Licence | Utilisation |
|---|---|---|---|
| `dataset3` | 237 images MEB de particules (billes, fibres, fragments), masques binaires, comptages, échelles lues dans les fichiers d'acquisition | à compléter (licence à confirmer) | modèle d'essai interne seulement |
| Roboflow | non utilisé | sans objet | aucune donnée, aucun poids |

- **La licence de `dataset3` est à confirmer avant toute présentation à des laboratoires**, et avant toute diffusion des poids.
- Les dossiers dérivés (`*crop`, `label_index`) sont exclus ; les masques sont des masques binaires (le masque ne distingue pas deux particules qui se touchent).
- Les fichiers d'acquisition contiennent des champs textuels (noms d'opérateurs, d'échantillons). Les fichiers texte annexes (`.txt`) ne sont jamais ouverts ; seule l'échelle est extraite des étiquettes du fichier TIFF, et rien d'autre n'est conservé. Le moteur n'écrit jamais ces champs dans ses réponses.
- Effectifs : 237 images en 218 groupes de photos, séparées par groupe : 147 en apprentissage, 48 en validation, 42 en test. La répartition par sous-jeu est dans le manifeste.

## 4. Pipeline et constantes

1. Lecture sûre de l'image (taille et poids bornés ; PNG, JPEG, TIFF ; une page ; orientation appliquée une fois ; bandeau d'information Hitachi retiré ; aucune métadonnée conservée ; une image 16 bits ou couleur est réduite à 8 bits niveaux de gris par Pillow, sans contrôle de la perte de dynamique). L'échelle est lue dans le fichier (MEB Hitachi) ou saisie ; si les deux divergent de plus de 2 %, l'analyse est refusée.
2. Réduction à 1 024 pixels sur le grand côté.
3. Forêt de pixels (60 arbres, profondeur 14), descripteurs d'intensité et de texture multi-échelles ; seuil de probabilité 0,7.
4. Ouverture, remplissage, composantes connexes ; taille minimale 1 % de l'image, soit un diamètre équivalent d'environ 100 pixels sur une image de 1 024 × 768. **Les particules plus petites ne sont pas vues.**
5. Géométrie par particule : aire, Feret maximal et minimal, diamètre équivalent, allongement, circularité, solidité.
6. Forme : régression logistique sur la géométrie ; sous le score minimal 0,5, la forme est signalée non confiante. **La classe `film` n'est jamais proposée : elle est non évaluée dans cette version.**
7. Abstention (statut « non fiable ») : aucune particule, plus de 300 composantes, part segmentée supérieure à 25 %, contraste inférieur à 10, ou échelle hors de 0,062 à 19,84 µm par pixel de l'image d'analyse.

Constantes : graine 0 ; 1 024 pixels d'analyse ; 300 particules au plus ; 200 points de contour au plus.

## 5. Protocole d'évaluation

- **Séparation par photo** : les images d'une même photographie (quasi-doublons, champs voisins de `fibre_2`) forment un groupe ; un groupe n'est jamais des deux côtés. Aucune fuite entre apprentissage, validation et test.
- **Choix sur la validation** : seuil de pixel, taille minimale, score de forme et part segmentée maximale sont choisis sur les 48 images de validation par une grille ; la plage d'échelle admise est l'intervalle mesuré sur les images d'apprentissage et de validation, élargi d'un facteur 2 (valeurs dans la lecture de la section 6).
- **Réglages** : ils sont ceux que la règle de validation donne ; ils peuvent différer des valeurs mesurées pendant la conception (décision R-C6-8 : score de forme minimal et taille minimale acceptés tels que choisis sur la validation, jamais sur le test).
- **Modèle final** appris sur l'apprentissage et la validation ; **test lu une seule fois** (42 images) après tous les choix.
- **Référence « seuil d'Otsu »** : un seul traitement fixe (fond retiré par une gaussienne, lissage, polarité automatique, ouverture, remplissage) à résolution et taille minimale égales, sans la grille de 16 réglages du protocole de conception. Elle est donc probablement un peu moins bonne que la meilleure référence possible ; la comparaison doit se lire ainsi.
- Appariement d'objets à IoU de 0,5 ; tailles sur les objets appariés ; la forme est évaluée sur les composantes du masque de référence (pour isoler le classifieur) puis sur les particules proposées.

## 6. Résultats mesurés

Tous les chiffres de cette section sont générés depuis le manifeste par la commande d'entraînement (bloc ci-dessous, lecture comprise).

<!-- BEGIN:metrics -->
**Réglages choisis sur la validation** : seuil de pixel 0,7, taille minimale 1 % de l'image, score de forme minimal 0,5, part segmentée maximale 25 %, échelle admise de 0,062 à 19,84 µm par pixel de l'image d'analyse.

**Test** (42 images, lues une seule fois après tous les choix) : modèle servi et référence « seuil d'Otsu » à résolution et taille minimale égales (la référence est un seul traitement fixe, sans la grille de 16 réglages du protocole de conception).

| Ensemble | Images | Dice | F1 objets | Précision | Rappel | Images comptées | Erreur de comptage | Biais | Comptage exact | À ±20 % |
|---|---|---|---|---|---|---|---|---|---|---|
| modèle, global | 42 | 0,710 | 0,52 | 0,43 | 0,67 | 33 | 1,61 | -0,76 | 30,3 % | 54,5 % |
| référence Otsu, global | 42 | 0,594 | 0,27 | 0,20 | 0,39 | 33 | 1,94 | -0,48 | 12,1 % | 51,5 % |
| modèle, bead | 7 | 0,867 | 0,78 | 0,64 | 1,00 | 7 | 0,71 | 0,43 | 57,1 % | 85,7 % |
| modèle, fibre_1 | 10 | 0,719 | 0,65 | 0,52 | 0,85 | 10 | 2,90 | -2,90 | 0,0 % | 10,0 % |
| modèle, fibre_2 | 9 | 0,546 | 0,12 | 0,09 | 0,18 | 0 | n/d | n/d | n/d | n/d |
| modèle, fragment_1 | 7 | 0,918 | 0,96 | 1,00 | 0,93 | 7 | 1,00 | -1,00 | 57,1 % | 85,7 % |
| modèle, fragment_2 | 9 | 0,582 | 0,29 | 0,23 | 0,42 | 9 | 1,33 | 0,89 | 22,2 % | 55,6 % |
| Otsu, bead | 7 | 0,426 | 0,20 | 0,15 | 0,29 | 7 | 1,00 | 0,71 | 28,6 % | 85,7 % |
| Otsu, fibre_1 | 10 | 0,638 | 0,44 | 0,37 | 0,54 | 10 | 3,10 | -3,10 | 0,0 % | 10,0 % |
| Otsu, fibre_2 | 9 | 0,477 | n/d | 0,00 | 0,00 | 0 | n/d | n/d | n/d | n/d |
| Otsu, fragment_1 | 7 | 0,826 | 0,65 | 0,59 | 0,71 | 7 | 1,29 | -0,43 | 28,6 % | 71,4 % |
| Otsu, fragment_2 | 9 | 0,612 | 0,15 | 0,11 | 0,25 | 9 | 1,89 | 1,44 | 0,0 % | 55,6 % |

**Tailles** (objets appariés, IoU ≥ 0,5) : 38 paires ; Feret maximal, erreur relative médiane 2,0 %, 90e centile 30,9 %, biais 7,7 % ; aire, erreur relative médiane 15,6 %, 90e centile 40,1 %, biais 14,1 %.

**Forme** (composantes du masque de référence du test, pour isoler le classifieur) : classifieur servi, exactitude 91,0 %, exactitude équilibrée 93,2 % (100 composantes) ; règles de référence (allongement ≥ 3), exactitude 76,0 %, exactitude équilibrée 57,8 %.

| Forme | Rappel du classifieur | Rappel des règles |
|---|---|---|
| bille | 100,0 % | 25,0 % |
| fibre | 91,4 % | 98,3 % |
| fragment | 88,2 % | 50,0 % |

Matrice de confusion du classifieur (composantes du masque) :

| Vérité \ Prédit | bille | fibre | fragment |
|---|---|---|---|
| bille | 8 | 0 | 0 |
| fibre | 1 | 53 | 4 |
| fragment | 2 | 2 | 30 |

Matrice de confusion sur les particules proposées et appariées (38 particules ; exactitude 84,2 %, équilibrée 77,2 %) :

| Vérité \ Prédit | bille | fibre | fragment |
|---|---|---|---|
| bille | 3 | 0 | 4 |
| fibre | 0 | 13 | 0 |
| fragment | 2 | 0 | 16 |

**Abstention** : 7 images « non fiable » sur 42 (16,7 %).

| Raison | Images |
|---|---|
| no_particle | 0 |
| too_many_particles | 0 |
| large_foreground | 7 |
| low_contrast | 0 |
| scale_out_of_range | 0 |

Images gardées : 35, F1 objets 0,61, erreur de comptage 1,53 (32 comptées). Images abstenues : 7, F1 objets 0,08, erreur de comptage 4,00 (1 comptées).

**Lecture** (chiffres issus du manifeste).

- Test global : Dice 0,71, F1 objets 0,52 (Otsu : 0,59 et 0,27) ; erreur de comptage 1,61 (Otsu : 1,94), à rapporter à un comptage de quelques particules par image : le modèle localise mieux que la référence, compte un peu mieux, mais l'erreur de comptage reste grande.
- Tailles : Feret maximal, erreur relative médiane 2,0 % (90e centile 30,9 %) ; aire, erreur relative médiane 15,6 %.
- Bien évalué : `fragment_1`, F1 objets 0,96.
- Faibles : `fibre_2` (tapis de fibres), F1 objets 0,12, aucun comptage de référence ; `fragment_2`, F1 objets 0,29 ; `fibre_1`, F1 objets 0,65, erreur de comptage 2,90 (biais -2,90 : fibres qui se croisent comptées comme une seule).
- **Billes (`bead`), peu et mal évaluées** : 7 images de test d'un seul échantillon (microbilles cosmétiques). Les tailles sont mauvaises : Feret maximal, erreur relative médiane 40,3 %, biais 42,0 % (7 paires). Sur les particules proposées, 3 billes sur 7 sont reconnues comme billes et 4 sont proposées « fragment » ; le rappel de 100 % des composantes de référence ne s'y retrouve pas.
- Abstention : 7 images « non fiable » sur 42 au test (16,7 %), dont 6 sur 9 images `fibre_2` ; erreur de comptage des images gardées 1,53 contre 1,61 pour l'ensemble : l'abstention la réduit peu.
- Forme : exactitude 91,0 % sur les composantes du masque de référence, 84,2 % sur les particules proposées.
- Échelle admise : 0,062 à 19,84 µm par pixel, soit l'intervalle mesuré sur les images d'apprentissage et de validation (0,124 à 9,92) élargi d'un facteur 2 de chaque côté.
<!-- END:metrics -->

## 7. Conditions d'échec connues

- Particules extraites de sang, matrice organique, filtre (pores, fibres de filtre) : jamais vus.
- Microscopie optique, fluorescence (rouge de Nil) : jamais vues.
- Particules qui se touchent ou fibres qui se croisent : comptées comme une seule.
- Substrat texturé (adhésif carbone, film) : faux objets.
- Particules plus petites que la taille minimale (1 % de l'image) : non détectées ; particules tronquées par le bord : forme et taille peu fiables.
- Tapis de fibres (`fibre_2`) : l'image est le plus souvent refusée (« non fiable »).
- Billes : un seul échantillon de microbilles cosmétiques irrégulières ; les tailles et les formes des billes proposées sont mal évaluées et mauvaises (Feret très surestimé, billes souvent proposées « fragment » : chiffres dans la lecture de la section 6). Film : **non évaluée**, jamais proposée.
- Échelle fausse : toutes les tailles sont fausses dans la même proportion, sans détection possible sans métadonnée.
- Bandeau d'information d'un autre fabricant non retiré : faux objets.
- Aucune identification de polymère ; un comptage de particules n'est pas une concentration.

## 8. Décisions humaines, traçabilité, consentement

- Chaque analyse et chaque décision (acceptée, corrigée, rejetée) sont de nouvelles lignes enregistrées, jamais modifiées ni supprimées.
- Le fichier déposé n'est pas conservé : seules l'image réécrite sans métadonnées, l'image annotée et l'empreinte de l'original le sont.
- Le consentement à l'export des décisions validées pour l'amélioration future des modèles (version `c2`, étendu aux images) est désactivé par défaut et géré par l'administrateur du laboratoire.

## 9. Ce qui change la version

Un changement des seuils, des données, du prétraitement, des descripteurs ou du modèle donne une nouvelle version (`i2`), un nouveau manifeste et un nouveau verrou.

## 10. Relecture avant présentation aux chercheurs

- Confirmer la licence de `dataset3` (section 3).
- Relire les conditions d'échec (section 7) et la phrase « modèle d'essai » affichée à l'écran.
- Vérifier que le bloc de métriques correspond au manifeste (test `test_card_metrics_block_is_current`).
