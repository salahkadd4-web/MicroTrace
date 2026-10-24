# MicroTrace : rapport de la baseline d'identification des polymères

- Date : 2026-10-24
- Catalogue (git_commit) : `70b18f76e80b9046fb554fc4946731a29c4b19da` (modifications non commitées : non)
- Nature des données (valeur `data_nature` du catalogue) : reference/environmental polymers — not human biological matrices
- Seuil de corrélation testé : 0.7
- Durée du calcul : 46.5 s

Ce rapport mesure dans quelle mesure le polymère d'un échantillon peut être retrouvé à partir de son spectre, avec des séparations par groupe d'échantillons entre apprentissage et test. Trois méthodes sont comparées : `correlation@0` (le spectre de référence le plus proche est toujours retenu), `correlation@0.7` (la réponse est NO_MATCH si la corrélation est inférieure au seuil) et `pca_svm` (réduction PCA puis machine à vecteurs de support).

Aucun groupe d'échantillons connu n'est partagé entre apprentissage et test. Les groupes sont définis par source : MPX = produit (champ Polymer) ; RaSPI = identifiant sans la lettre finale ; FLOPP, FLOPP-e, SLoPP, SLoPP-E et raman_weathered = un groupe par spectre (les spectres répétés d'un même objet, s'il y en a, ne sont pas regroupés).

Lecture des colonnes : `n` = requêtes testées ; `accuracy` = part de bonnes réponses (un NO_MATCH compte comme une erreur) ; `macro-F1` = moyenne du F1 par polymère, qui donne le même poids aux polymères rares ; `taux de réponse` (clé `coverage` dans metrics.json) = part des requêtes pour lesquelles une réponse est donnée ; `out_of_library` = requêtes dont le polymère n'existe pas dans la bibliothèque d'apprentissage (comptées à part, exclues de accuracy et macro-F1).

## Technique : ftir_atr

Spectres évalués après exclusions : 4210. Exclus avant toute séparation : 3 (polymère UNKNOWN : 0, polymère OTHER : 3, couverture diagnostique < 0.8 : 0).

### Spectres exclus par source

| Source | UNKNOWN | OTHER | couverture diagnostique < 0.8 | Total |
|---|---|---|---|---|
| flopp | 0 | 1 | 0 | 1 |
| flopp_e | 0 | 2 | 0 | 2 |
| mpx | 0 | 0 | 0 | 0 |

### Effectifs par source

| Source | Spectres | Groupes d'échantillons |
|---|---|---|
| flopp | 185 | 185 |
| flopp_e | 193 | 193 |
| mpx | 3832 | 17 |

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

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 4210 | 4185 | 0.849 | 0.741 | 1.000 | 25 |
| correlation@0.7 | 4210 | 4185 | 0.792 | 0.805 | 0.857 | 25 |
| pca_svm | 4210 | 4185 | 0.700 | 0.687 | 1.000 | 25 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Source tenue à part : **flopp**

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 185 | 164 | 0.921 | 0.916 | 1.000 | 21 |
| correlation@0.7 | 185 | 164 | 0.921 | 0.916 | 1.000 | 21 |
| pca_svm | 185 | 164 | 0.854 | 0.839 | 1.000 | 21 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Source tenue à part : **flopp_e**

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 193 | 189 | 0.921 | 0.874 | 1.000 | 4 |
| correlation@0.7 | 193 | 189 | 0.921 | 0.874 | 1.000 | 4 |
| pca_svm | 193 | 189 | 0.905 | 0.848 | 1.000 | 4 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Source tenue à part : **mpx**

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 3832 | 3832 | 0.842 | 0.865 | 1.000 | 0 |
| correlation@0.7 | 3832 | 3832 | 0.780 | 0.849 | 0.844 | 0 |
| pca_svm | 3832 | 3832 | 0.683 | 0.794 | 1.000 | 0 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Rappel par polymère (LOSO cumulé) :

| Polymère | correlation@0 | correlation@0.7 | pca_svm |
|---|---|---|---|
| ABS | 1.000 | 1.000 | 0.867 |
| CELLULOSE | 0.962 | 0.962 | 0.962 |
| EVA | 0.400 | 0.400 | 0.533 |
| PA | 0.944 | 0.944 | 1.000 |
| PC | 1.000 | 1.000 | 1.000 |
| PE | 0.860 | 0.808 | 0.737 |
| PET | 0.862 | 0.832 | 0.681 |
| PLA | 0.723 | 0.712 | 0.582 |
| PP | 0.944 | 0.816 | 0.768 |
| PS | 0.738 | 0.668 | 0.612 |
| PU | 0.684 | 0.684 | 0.737 |
| PVC | 0.889 | 0.889 | 0.944 |

Principales confusions (LOSO cumulé, correlation@0, polymère réel → prédiction, 10 premières) :

| Polymère réel | Prédiction | Nombre |
|---|---|---|
| PE | PP | 100 |
| PET | CELLULOSE | 77 |
| PLA | CELLULOSE | 76 |
| PET | PP | 59 |
| PS | CELLULOSE | 56 |
| PS | PP | 53 |
| PLA | PP | 25 |
| PE | CELLULOSE | 14 |
| PP | CELLULOSE | 12 |
| PP | PU | 12 |

### Validation croisée par groupes (group_kfold)

Validation croisée en 5 plis, graine 0 : aucun groupe d'échantillons n'est coupé entre apprentissage et test. Seuls les polymères présents dans au moins 5 groupes sont conservés ; 4 spectres retirés (CA : 2, PMMA : 2). Résultats cumulés sur les prédictions hors pli :

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 4206 | 4206 | 0.762 | 0.822 | 1.000 | 0 |
| correlation@0.7 | 4206 | 4206 | 0.759 | 0.828 | 0.994 | 0 |
| pca_svm | 4206 | 4206 | 0.835 | 0.830 | 1.000 | 0 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

### Pristine vers vieilli (pristine_to_aged)

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 4025 | 4021 | 0.800 | 0.552 | 1.000 | 4 |
| correlation@0.7 | 4025 | 4021 | 0.736 | 0.687 | 0.809 | 4 |
| pca_svm | 4025 | 4021 | 0.625 | 0.596 | 1.000 | 4 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Rappel par polymère :

| Polymère | correlation@0 | correlation@0.7 | pca_svm |
|---|---|---|---|
| ABS | 1.000 | 1.000 | 1.000 |
| CELLULOSE | 1.000 | 1.000 | 1.000 |
| EVA | 0.400 | 0.400 | 0.400 |
| PA | 1.000 | 1.000 | 1.000 |
| PC | 1.000 | 1.000 | 1.000 |
| PE | 0.800 | 0.727 | 0.626 |
| PET | 0.836 | 0.797 | 0.656 |
| PLA | 0.727 | 0.714 | 0.579 |
| PP | 0.827 | 0.719 | 0.606 |
| PS | 0.714 | 0.624 | 0.602 |
| PU | 1.000 | 1.000 | 0.833 |
| PVC | 0.889 | 0.889 | 0.889 |

## Technique : raman

Spectres évalués après exclusions : 2792. Exclus avant toute séparation : 21 (polymère UNKNOWN : 14, polymère OTHER : 7, couverture diagnostique < 0.8 : 0).

### Spectres exclus par source

| Source | UNKNOWN | OTHER | couverture diagnostique < 0.8 | Total |
|---|---|---|---|---|
| mpx | 0 | 0 | 0 | 0 |
| raman_weathered | 8 | 0 | 0 | 8 |
| raspi | 6 | 0 | 0 | 6 |
| slopp | 0 | 0 | 0 | 0 |
| slopp_e | 0 | 7 | 0 | 7 |

### Effectifs par source

| Source | Spectres | Groupes d'échantillons |
|---|---|---|
| mpx | 1977 | 19 |
| raman_weathered | 165 | 165 |
| raspi | 396 | 272 |
| slopp | 148 | 148 |
| slopp_e | 106 | 106 |

### Effectifs par polymère

| Polymère | Spectres |
|---|---|
| ABS | 25 |
| ACRYLIC | 13 |
| CA | 7 |
| CELLULOSE | 21 |
| EVA | 5 |
| NC | 1 |
| PA | 45 |
| PC | 26 |
| PE | 837 |
| PET | 618 |
| PLA | 218 |
| PMMA | 26 |
| POM | 21 |
| PP | 542 |
| PS | 246 |
| PTFE | 41 |
| PU | 31 |
| PVC | 40 |
| RUBBER | 4 |
| SILICONE | 25 |

### Leave-one-source-out (LOSO)

Résultats cumulés sur toutes les sources tenues à part :

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 2792 | 2477 | 0.890 | 0.782 | 1.000 | 315 |
| correlation@0.7 | 2792 | 2477 | 0.840 | 0.821 | 0.888 | 315 |
| pca_svm | 2792 | 2477 | 0.801 | 0.704 | 1.000 | 315 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Source tenue à part : **mpx**

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 1977 | 1759 | 0.893 | 0.929 | 1.000 | 218 |
| correlation@0.7 | 1977 | 1759 | 0.827 | 0.902 | 0.857 | 218 |
| pca_svm | 1977 | 1759 | 0.785 | 0.850 | 1.000 | 218 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Source tenue à part : **raman_weathered**

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 165 | 164 | 0.787 | 0.764 | 1.000 | 1 |
| correlation@0.7 | 165 | 164 | 0.787 | 0.767 | 0.976 | 1 |
| pca_svm | 165 | 164 | 0.780 | 0.647 | 1.000 | 1 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Source tenue à part : **raspi**

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 396 | 309 | 0.945 | 0.928 | 1.000 | 87 |
| correlation@0.7 | 396 | 309 | 0.926 | 0.929 | 0.968 | 87 |
| pca_svm | 396 | 309 | 0.919 | 0.901 | 1.000 | 87 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Source tenue à part : **slopp**

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 148 | 143 | 0.874 | 0.867 | 1.000 | 5 |
| correlation@0.7 | 148 | 143 | 0.853 | 0.863 | 0.951 | 5 |
| pca_svm | 148 | 143 | 0.755 | 0.708 | 1.000 | 5 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Source tenue à part : **slopp_e**

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 106 | 102 | 0.873 | 0.840 | 1.000 | 4 |
| correlation@0.7 | 106 | 102 | 0.863 | 0.835 | 0.951 | 4 |
| pca_svm | 106 | 102 | 0.824 | 0.715 | 1.000 | 4 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Rappel par polymère (LOSO cumulé) :

| Polymère | correlation@0 | correlation@0.7 | pca_svm |
|---|---|---|---|
| ABS | 0.840 | 0.800 | 0.600 |
| ACRYLIC | 0.923 | 0.846 | 0.923 |
| CA | 0.571 | 0.571 | 0.714 |
| CELLULOSE | 0.571 | 0.524 | 0.524 |
| PA | 0.756 | 0.756 | 0.778 |
| PC | 1.000 | 1.000 | 0.962 |
| PE | 0.913 | 0.888 | 0.898 |
| PET | 0.942 | 0.853 | 0.712 |
| PMMA | 0.962 | 0.962 | 0.962 |
| PP | 0.836 | 0.768 | 0.747 |
| PS | 0.898 | 0.866 | 0.866 |
| PU | 0.645 | 0.613 | 0.677 |
| PVC | 0.775 | 0.775 | 0.650 |

Principales confusions (LOSO cumulé, correlation@0, polymère réel → prédiction, 10 premières) :

| Polymère réel | Prédiction | Nombre |
|---|---|---|
| PP | PE | 26 |
| PP | PU | 14 |
| PE | PP | 12 |
| PE | PVC | 12 |
| PP | PTFE | 12 |
| PE | CELLULOSE | 8 |
| PE | PA | 8 |
| PET | PE | 8 |
| PA | PE | 7 |
| PE | PTFE | 7 |

### Validation croisée par groupes (group_kfold)

Validation croisée en 5 plis, graine 0 : aucun groupe d'échantillons n'est coupé entre apprentissage et test. Seuls les polymères présents dans au moins 5 groupes sont conservés ; 223 spectres retirés (NC : 1, PLA : 218, RUBBER : 4). Résultats cumulés sur les prédictions hors pli :

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 2569 | 2569 | 0.903 | 0.856 | 1.000 | 0 |
| correlation@0.7 | 2569 | 2569 | 0.882 | 0.856 | 0.959 | 0 |
| pca_svm | 2569 | 2569 | 0.838 | 0.782 | 1.000 | 0 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

### Pristine vers vieilli (pristine_to_aged)

| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse | out_of_library |
|---|---|---|---|---|---|---|
| correlation@0 | 2230 | 2008 | 0.884 | 0.603 | 1.000 | 222 |
| correlation@0.7 | 2230 | 2008 | 0.815 | 0.727 | 0.853 | 222 |
| pca_svm | 2230 | 2008 | 0.676 | 0.549 | 1.000 | 222 |

Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes présentes dans la bibliothèque (n_evaluated = n − out_of_library).

Rappel par polymère :

| Polymère | correlation@0 | correlation@0.7 | pca_svm |
|---|---|---|---|
| ABS | 1.000 | 1.000 | 0.000 |
| ACRYLIC | 1.000 | 1.000 | 0.667 |
| CA | 0.667 | 0.667 | 0.667 |
| CELLULOSE | 0.600 | 0.600 | 0.600 |
| PA | 0.727 | 0.727 | 0.818 |
| PC | 1.000 | 1.000 | 1.000 |
| PE | 0.903 | 0.853 | 0.592 |
| PET | 0.941 | 0.831 | 0.758 |
| PMMA | 1.000 | 1.000 | 1.000 |
| PP | 0.807 | 0.732 | 0.627 |
| PS | 0.889 | 0.865 | 0.870 |
| PU | 0.333 | 0.167 | 0.167 |
| PVC | 0.500 | 0.500 | 0.600 |

## Limites

- Les données sont des polymères de référence ou environnementaux, pas des matrices biologiques humaines.
- Il n'existe aucune classe négative (particule non plastique) : le système n'a jamais appris à répondre « ce n'est pas un plastique ».
- Les résultats de chaque protocole ne sont pas comparables à une performance clinique.
- Les protocoles diffèrent par leur difficulté : ne comparer les chiffres qu'à l'intérieur d'un même protocole.
- Provenance des étiquettes : celles de raman_weathered viennent de scores de recherche en bibliothèque KnowItAll (certaines « identifiées subjectivement ») ; celles des échantillons environnementaux de FLOPP-e et SLoPP-E proviennent probablement d'une comparaison spectrale. Sur ces sources, les scores mesurent l'accord avec une identification de référence, pas une vérité terrain.
- Taille effective de l'échantillon : `n` compte des spectres, pas des échantillons indépendants (ftir_atr : mpx = 3832 spectres issus de 17 groupes ; raman : mpx = 1977 spectres issus de 19 groupes). Certains rappels par polymère reflètent essentiellement un seul produit. Aucun intervalle de confiance n'est calculé.
- Le LOSO cumulé est dominé par une source (ftir_atr : mpx = 92 % des requêtes évaluées ; raman : mpx = 71 % des requêtes évaluées) : le chiffre cumulé décrit surtout cette source ; lire aussi les résultats par source tenue à part.
- Le macro-F1 favorise l'abstention : un NO_MATCH n'est jamais un faux positif pour aucune classe. Comparer les seuils sur l'accuracy et le taux de réponse, pas sur le seul macro-F1.
- Règle de couverture : un spectre est évalué si sa couverture est ≥ 0,8 de la fenêtre diagnostique (Raman 400–1 800 cm⁻¹, FTIR 600–1 800 cm⁻¹). Les spectres limités à la région d'empreinte digitale sont donc désormais évalués ; la région C–H (2 800–3 100 cm⁻¹) n'est pas exigée.
