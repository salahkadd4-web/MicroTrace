# MicroTrace : rapport de la baseline d'identification des polymères

- Date : 2026-10-23
- Catalogue (git_commit) : `79032e9cefd8f0a8b94de213a076ccff00aaefbd`
- Nature des données : reference/environmental polymers — not human biological matrices
- Seuil de corrélation testé : 0.7
- Durée du calcul : 42.9 s

Ce rapport mesure dans quelle mesure le polymère d'un échantillon peut être retrouvé à partir de son spectre, avec des séparations qui évitent toute fuite de données entre apprentissage et test. Trois méthodes sont comparées : `correlation@0` (le spectre de référence le plus proche est toujours retenu), `correlation@0.7` (la réponse est NO_MATCH si la corrélation est inférieure au seuil) et `pca_svm` (réduction PCA puis machine à vecteurs de support).

Lecture des colonnes : `n` = requêtes testées ; `accuracy` = part de bonnes réponses (un NO_MATCH compte comme une erreur) ; `macro-F1` = moyenne du F1 par polymère, qui donne le même poids aux polymères rares ; `coverage` = part des requêtes pour lesquelles une réponse est donnée ; `out_of_library` = requêtes dont le polymère n'existe pas dans la bibliothèque d'apprentissage (comptées à part, exclues de accuracy et macro-F1).

## Technique : ftir_atr

Spectres évalués après exclusions : 4210. Exclus avant toute séparation : 3 (polymère UNKNOWN : 0, polymère OTHER : 3, couverture < 0.8 : 0).

### Effectifs par source

| Source | Spectres |
|---|---|
| flopp | 185 |
| flopp_e | 193 |
| mpx | 3832 |

### Effectifs par polymère

| Polymère | Spectres |
|---|---|
| ABS | 15 |
| ACRYLIC | 6 |
| CA | 2 |
| CELLULOSE | 26 |
| EVA | 15 |
| PA | 18 |
| PC | 9 |
| PE | 1039 |
| PET | 1257 |
| PLA | 455 |
| PMMA | 2 |
| PP | 853 |
| PS | 461 |
| PU | 19 |
| PVC | 18 |
| RUBBER | 15 |

### Leave-one-source-out (LOSO)

Résultats cumulés sur toutes les sources tenues à part :

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 4210 | 0.080 | 0.228 | 0.690 | 25 |
| correlation@0.7 | 4210 | 0.067 | 0.429 | 0.085 | 25 |
| pca_svm | 4210 | 0.035 | 0.336 | 1.000 | 25 |

Source tenue à part : **flopp**

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 185 | 0.805 | 0.721 | 1.000 | 21 |
| correlation@0.7 | 185 | 0.805 | 0.721 | 1.000 | 21 |
| pca_svm | 185 | 0.671 | 0.588 | 1.000 | 21 |

Source tenue à part : **flopp_e**

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 193 | 0.783 | 0.731 | 1.000 | 4 |
| correlation@0.7 | 193 | 0.783 | 0.731 | 1.000 | 4 |
| pca_svm | 193 | 0.190 | 0.329 | 1.000 | 4 |

Source tenue à part : **mpx**

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 3832 | 0.015 | 0.018 | 0.661 | 0 |
| correlation@0.7 | 3832 | 0.000 | 0.000 | 0.001 | 0 |
| pca_svm | 3832 | 0.000 | 0.000 | 1.000 | 0 |

Rappel par polymère (LOSO cumulé) :

| Polymère | correlation@0 | correlation@0.7 | pca_svm |
|---|---|---|---|
| ABS | 0.800 | 0.800 | 0.867 |
| CELLULOSE | 0.923 | 0.923 | 0.769 |
| EVA | 0.333 | 0.333 | 0.267 |
| PA | 1.000 | 1.000 | 1.000 |
| PC | 0.222 | 0.222 | 0.222 |
| PE | 0.087 | 0.044 | 0.017 |
| PET | 0.039 | 0.036 | 0.025 |
| PLA | 0.000 | 0.000 | 0.000 |
| PP | 0.095 | 0.090 | 0.020 |
| PS | 0.061 | 0.052 | 0.000 |
| PU | 0.526 | 0.526 | 0.474 |
| PVC | 0.944 | 0.944 | 0.778 |

### Validation croisée par groupes (group_kfold)

Validation croisée en 5 plis, graine 0 : aucun groupe d'échantillons n'est coupé entre apprentissage et test. Seuls les polymères présents dans au moins 5 groupes sont conservés ; 4 spectres retirés ({'CA': 2, 'PMMA': 2}). Résultats cumulés sur les prédictions hors pli :

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 4206 | 0.680 | 0.732 | 1.000 | 0 |
| correlation@0.7 | 4206 | 0.678 | 0.735 | 0.994 | 0 |
| pca_svm | 4206 | 0.673 | 0.563 | 1.000 | 0 |

### Pristine vers vieilli (pristine_to_aged)

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 4025 | 0.048 | 0.105 | 0.672 | 4 |
| correlation@0.7 | 4025 | 0.037 | 0.392 | 0.048 | 4 |
| pca_svm | 4025 | 0.030 | 0.261 | 1.000 | 4 |

Rappel par polymère :

| Polymère | correlation@0 | correlation@0.7 | pca_svm |
|---|---|---|---|
| ABS | 1.000 | 1.000 | 1.000 |
| CELLULOSE | 1.000 | 1.000 | 0.917 |
| EVA | 0.200 | 0.200 | 0.200 |
| PA | 1.000 | 1.000 | 0.833 |
| PC | 1.000 | 1.000 | 0.000 |
| PE | 0.061 | 0.027 | 0.024 |
| PET | 0.020 | 0.017 | 0.014 |
| PLA | 0.000 | 0.000 | 0.000 |
| PP | 0.074 | 0.070 | 0.056 |
| PS | 0.031 | 0.022 | 0.016 |
| PU | 0.333 | 0.333 | 0.333 |
| PVC | 0.889 | 0.889 | 0.444 |

## Technique : raman

Spectres évalués après exclusions : 2312. Exclus avant toute séparation : 501 (polymère UNKNOWN : 14, polymère OTHER : 7, couverture < 0.8 : 480).

### Effectifs par source

| Source | Spectres |
|---|---|
| mpx | 1604 |
| raman_weathered | 165 |
| raspi | 396 |
| slopp | 71 |
| slopp_e | 76 |

### Effectifs par polymère

| Polymère | Spectres |
|---|---|
| ABS | 17 |
| ACRYLIC | 1 |
| CA | 1 |
| CELLULOSE | 7 |
| EVA | 5 |
| NC | 1 |
| PA | 37 |
| PC | 25 |
| PE | 803 |
| PET | 410 |
| PLA | 218 |
| PMMA | 24 |
| POM | 21 |
| PP | 369 |
| PS | 242 |
| PTFE | 41 |
| PU | 29 |
| PVC | 34 |
| RUBBER | 2 |
| SILICONE | 25 |

### Leave-one-source-out (LOSO)

Résultats cumulés sur toutes les sources tenues à part :

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 2312 | 0.898 | 0.759 | 1.000 | 315 |
| correlation@0.7 | 2312 | 0.857 | 0.798 | 0.912 | 315 |
| pca_svm | 2312 | 0.871 | 0.753 | 1.000 | 315 |

Source tenue à part : **mpx**

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 1604 | 0.908 | 0.933 | 1.000 | 218 |
| correlation@0.7 | 1604 | 0.853 | 0.910 | 0.887 | 218 |
| pca_svm | 1604 | 0.867 | 0.900 | 1.000 | 218 |

Source tenue à part : **raman_weathered**

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 165 | 0.756 | 0.586 | 1.000 | 1 |
| correlation@0.7 | 165 | 0.756 | 0.591 | 0.970 | 1 |
| pca_svm | 165 | 0.780 | 0.648 | 1.000 | 1 |

Source tenue à part : **raspi**

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 396 | 0.939 | 0.918 | 1.000 | 87 |
| correlation@0.7 | 396 | 0.926 | 0.930 | 0.968 | 87 |
| pca_svm | 396 | 0.939 | 0.931 | 1.000 | 87 |

Source tenue à part : **slopp**

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 71 | 0.908 | 0.870 | 1.000 | 6 |
| correlation@0.7 | 71 | 0.892 | 0.837 | 0.985 | 6 |
| pca_svm | 71 | 0.892 | 0.851 | 1.000 | 6 |

Source tenue à part : **slopp_e**

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 76 | 0.849 | 0.731 | 1.000 | 3 |
| correlation@0.7 | 76 | 0.849 | 0.742 | 0.959 | 3 |
| pca_svm | 76 | 0.863 | 0.735 | 1.000 | 3 |

Rappel par polymère (LOSO cumulé) :

| Polymère | correlation@0 | correlation@0.7 | pca_svm |
|---|---|---|---|
| ABS | 0.824 | 0.765 | 0.882 |
| CELLULOSE | 0.286 | 0.286 | 0.286 |
| PA | 0.730 | 0.730 | 0.838 |
| PC | 1.000 | 1.000 | 1.000 |
| PE | 0.934 | 0.912 | 0.915 |
| PET | 0.924 | 0.837 | 0.876 |
| PMMA | 0.958 | 0.958 | 0.958 |
| PP | 0.840 | 0.791 | 0.794 |
| PS | 0.905 | 0.868 | 0.872 |
| PU | 0.655 | 0.655 | 0.724 |
| PVC | 0.765 | 0.765 | 0.735 |

### Validation croisée par groupes (group_kfold)

Validation croisée en 5 plis, graine 0 : aucun groupe d'échantillons n'est coupé entre apprentissage et test. Seuls les polymères présents dans au moins 5 groupes sont conservés ; 223 spectres retirés ({'ACRYLIC': 1, 'CA': 1, 'NC': 1, 'PLA': 218, 'RUBBER': 2}). Résultats cumulés sur les prédictions hors pli :

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 2089 | 0.912 | 0.866 | 1.000 | 0 |
| correlation@0.7 | 2089 | 0.892 | 0.870 | 0.962 | 0 |
| pca_svm | 2089 | 0.900 | 0.814 | 1.000 | 0 |

### Pristine vers vieilli (pristine_to_aged)

| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |
|---|---|---|---|---|---|
| correlation@0 | 1827 | 0.893 | 0.583 | 1.000 | 221 |
| correlation@0.7 | 1827 | 0.834 | 0.659 | 0.877 | 221 |
| pca_svm | 1827 | 0.745 | 0.556 | 1.000 | 221 |

Rappel par polymère :

| Polymère | correlation@0 | correlation@0.7 | pca_svm |
|---|---|---|---|
| ABS | 0.500 | 0.500 | 0.000 |
| CELLULOSE | 0.500 | 0.500 | 0.000 |
| PA | 0.625 | 0.625 | 0.625 |
| PC | 1.000 | 1.000 | 1.000 |
| PE | 0.929 | 0.880 | 0.672 |
| PET | 0.937 | 0.821 | 0.854 |
| PMMA | 1.000 | 1.000 | 1.000 |
| PP | 0.792 | 0.751 | 0.722 |
| PS | 0.894 | 0.865 | 0.865 |
| PU | 0.250 | 0.250 | 0.500 |
| PVC | 0.500 | 0.500 | 0.500 |

## Limites

- Les données sont des polymères de référence ou environnementaux, pas des matrices biologiques humaines.
- Il n'existe aucune classe négative (particule non plastique) : le système n'a jamais appris à répondre « ce n'est pas un plastique ».
- Les résultats de chaque protocole ne sont pas comparables à une performance clinique.
- Les protocoles diffèrent par leur difficulté : ne comparer les chiffres qu'à l'intérieur d'un même protocole.
