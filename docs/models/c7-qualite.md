# Fiche des règles : assistant qualité des résultats (C7), version q1

## 1. Objet

L'assistant qualité attire l'attention de la personne qui relit des résultats de laboratoire sur des points à examiner. Ce sont des **signaux expliqués**, jamais des verdicts.

- Un signal est une invitation à regarder une mesure, pas une décision de la rejeter ou de la garder.
- Aucune gravité, aucune imputation d'une valeur censurée, aucune prédiction de santé, aucune modification d'une mesure.
- Les règles sont des statistiques robustes documentées. Il n'y a pas d'apprentissage automatique.
- Les signaux sont recalculés à chaque ouverture. Seules les décisions humaines sont enregistrées (§8).

## 2. Version

- Version des règles : `q1` (constante `QUALITY_RULES_VERSION` du module `microtrace_core.results.quality`), mise en œuvre le 2026-10-30.
- Elle est indépendante de `RULES_VERSION` (`"2"`) de l'import B1, qui fixe la façon de lire et de normaliser les cellules. Une mesure importée sous une autre version de B1 reste lisible, mais voir la condition d'échec « imports de versions B1 différentes » (§6).
- La version entre dans la clé de chaque signal (§5).

## 3. Entrées et données non utilisées

**Utilisées :**

- les mesures d'échantillon (`record_type == sample`) des imports actifs de l'étude ;
- l'identité de chaque mesure : empreinte du fichier (`file_sha256`), feuille, ligne, colonne ;
- les contrôles qualité **résumés** (polymère, type, n, moyenne, écart type, unité, source), pour la règle b seulement ;
- `blank_corrected` de l'étude, pour la phrase de prudence de la règle b.

**Non utilisées en q1 :**

- les blancs mesurés importés (`qc_records`) ;
- les issues d'import ;
- le `QcMeasurement` ;
- les blancs de terrain et les échantillons dopés (type `field_blank`, `spiked`) : seuls les blancs de procédure (`procedural_blank`) sont comparés.

Une mesure est **quantifiée** si son statut est `quantified` et si sa valeur canonique existe (prédicat `is_quantified` de `summary.py`). Seules les mesures quantifiées entrent dans un calcul. Une valeur entre LOD et LOQ porte un `value`, mais elle n'est jamais lue.

**Groupe d'analyse** : `(polymère, méthode, matrice, détail de matrice, grandeur, base, unité canonique)`. Les groupes ne sont jamais fusionnés. Le détail de matrice est rogné pour `other` et vide pour les matrices nommées (`matrix_detail_key` de `summary.py`).

## 4. Les règles

| Constante | Valeur | Comparaison |
|---|---|---|
| `QUALITY_RULES_VERSION` | `"q1"` | — |
| `ALIQUOT_RPD_THRESHOLD` | 0,50 (50 %) | signal si écart relatif **>** seuil |
| `NEAR_BLANK_FACTOR` | 3,0 | signal si valeur **<** 3 × moyenne du blanc |
| `MAD_CONSTANT` | 0,6745 | — |
| `OUTLIER_Z_THRESHOLD` | 3,5 | signal si \|M\| **>** 3,5 |
| `OUTLIER_MIN_SAMPLES` | 5 | règle appliquée si n ≥ 5 et MAD > 0 |
| `LOD_RATE_ALPHA` | 0,01 | signal si p **<** 0,01 |
| `LOD_RATE_MIN_STRATUM` | 5 | lot comparé si n ≥ 5 et s'il reste au moins 5 autres mesures |

Toutes les comparaisons sont strictes : une valeur exactement au seuil ne déclenche pas de signal.

### a) Discordance entre aliquotes (`aliquot_discordance`)

- **Population :** les mesures d'un même échantillon dans un même groupe, avec au moins 2 aliquotes quantifiées.
- **Formule :** écart relatif = (max − min) / moyenne des valeurs quantifiées, en unité canonique. Pour deux aliquotes, c'est le RPD (*relative percent difference*) des doublons : |x₁ − x₂| / ((x₁ + x₂) / 2).
- **Seuil :** > 50 %. Justification :
  1. Les guides de validation de données de l'US EPA (*National Functional Guidelines for Inorganic Superfund Methods Data Review*) fixent pour les doublons de laboratoire un écart relatif de l'ordre de 20 % pour les eaux et 35 % pour les sols, au-dessus de 5 fois la limite de quantification. *L'édition et les valeurs exactes sont à vérifier lors de la relecture de cette fiche.*
  2. Les microplastiques dans le sang sont plus hétérogènes encore : la masse d'une aliquote peut dépendre de quelques particules, d'où un bruit d'échantillonnage de type comptage (Brander et al. 2020, *Appl. Spectrosc.* 74:1099 ; Hermsen et al. 2018, *Environ. Sci. Technol.* 52:10230). Le critère des sols (35 %) signalerait la plupart des paires ordinaires.
  3. Sur les données réelles de Leslie et al. 2022 (Tableau S2), les trois paires de doublons quantifiés ont des écarts de 8,7 %, 112,7 % et 120 %. Le seuil de 50 % ne retient que les deux écarts manifestes. Sur l'exemple fictif, un seuil de 35 % donnerait 3 signaux de plus pour des paires banales (35,3 % à 45,2 %).
  4. 50 % est un point de départ documenté. Des seuils par laboratoire sont hors périmètre.
- **Aliquote censurée :** une paire « 2,2 et < LOD » ne donne pas de signal. L'explication indique le nombre d'aliquotes non quantifiées laissées de côté.
- **Mesures concernées :** les aliquotes quantifiées du groupe.
- **Chiffres exposés :** `n_aliquots`, `n_quantified`, `min`, `max`, `mean`, `rpd_percent`, `threshold_percent`.

### b) Valeur proche des blancs (`near_blank`)

- **Population :** chaque mesure quantifiée, comparée à chaque contrôle qualité résumé de type `procedural_blank`, du même polymère et de moyenne strictement positive. Le polymère du contrôle (texte libre) est normalisé par `normalize_result_polymer(libellé, technique)` : « PS » devient `PS_SUM` pour une technique thermo-analytique.
- **Méthode :** le contrôle résumé n'a pas de champ méthode dans le prototype. Il s'applique donc à toutes les méthodes du polymère dont l'unité est convertible. C'est une limite (§6).
- **Unités :** l'unité du contrôle est lue par `parse_unit`. Elle doit avoir la même (grandeur, base) que le groupe, et la moyenne est convertie dans l'unité canonique du groupe. Sinon, il n'y a pas de signal et une note le dit (`blank_unit_mismatch`, `blank_unit_unknown`).
- **Formule :** rapport = valeur canonique / moyenne canonique du blanc. Il y a signal si rapport < 3.
- **Seuil 3 × :**
  1. Il est fixé par la spec du prototype.
  2. Il correspond au rapport signal/bruit de 3 de la définition classique de la détection (IUPAC : LOD = moyenne du blanc + 3 σ ; Long et Winefordner 1983, *Anal. Chem.* 55:712A ; MacDougall et al. 1980, *Anal. Chem.* 52:2242).
  3. Il est plus permissif que la règle de qualification des guides de l'US EPA pour la chimie organique (résultat < 5 × le blanc, ou < 10 × pour les contaminants courants de laboratoire). q1 produit donc moins de signaux. *Références à vérifier sur l'édition en vigueur.*
- **Étude déclarée corrigée du blanc :** la règle s'applique à l'identique. L'explication précise que la valeur est déjà corrigée et que le rapport compare donc une valeur nette à un blanc brut.
- **Notes :** `no_blank_summary` (aucun blanc de procédure résumé), `polymers_without_blank` (polymères mesurés sans blanc), `blank_unit_mismatch`, `blank_unit_unknown`, `blank_mean_missing` (moyenne vide, nulle ou négative).
- **Mesures concernées :** la mesure.
- **Chiffres exposés :** `value`, `blank_mean` (canonique), `blank_mean_reported` (unité du contrôle), `blank_n`, `ratio`, `factor`.

### c) Valeur atypique (`robust_outlier`)

- **Population :** les résultats par échantillon de `aggregate_aliquots` (B1), c'est-à-dire la moyenne des aliquotes quantifiées. Seuls les échantillons au statut `quantified` comptent. Aucune seconde règle d'agrégation n'est écrite.
- **Formule :** score z modifié Mᵢ = 0,6745 · (xᵢ − médiane) / MAD, avec MAD = médiane(|xᵢ − médiane|) (Iglewicz et Hoaglin 1993, *How to Detect and Handle Outliers*, ASQC). 0,6745 est le quantile 0,75 de la loi normale centrée réduite.
- **Seuil :** |Mᵢ| > 3,5, valeur recommandée par Iglewicz et Hoaglin. Le test est bilatéral.
- **Conditions :** n ≥ 5 échantillons quantifiés dans le groupe et MAD > 0.
- **Notes :** `too_few_samples` (un groupe ayant des mesures d'échantillon et moins de 5 échantillons quantifiés, y compris 0), `zero_mad` (au moins la moitié des valeurs sont identiques).
- **Mesures concernées :** les aliquotes quantifiées de l'échantillon.
- **Chiffres exposés :** `value`, `median`, `mad`, `z`, `n`, `threshold`.

### d) Taux de < LOD inhabituel (`unusual_lod_rate`)

- **Dimensions :** `batch`, puis `analysis_date` (date ISO normalisée par B1, au jour près), évaluées séparément. La valeur est rognée.
- **Population :** dans un groupe, les mesures analysées (statut ≠ `not_analysed`). « < LOD » veut dire statut `below_lod`. Les statuts `not_quantified` et `between_lod_loq` comptent comme « non < LOD ».
- **Valeur vide :** une mesure sans lot (ou sans date) n'entre dans aucune des deux parties de la comparaison. Si aucune mesure n'a de lot, la note `dimension_empty` est produite. Si un groupe a des lots mais aucun éligible, la note `too_few_in_strata` est produite.
- **Formule :** pour chaque strate d'au moins 5 mesures analysées, quand il reste au moins 5 mesures dans les autres strates renseignées du groupe, la table 2 × 2 est [[k_s, n_s − k_s], [k_r, n_r − k_r]], évaluée par le test exact de Fisher bilatéral (`scipy.stats.fisher_exact`). Signal si p < 0,01.
- **Deux strates seulement :** la comparaison est symétrique, une seule est faite, et le signal porte sur la strate au taux le plus élevé (ordre alphabétique en cas d'égalité ; à taux égaux, p = 1 et il n'y a pas de signal).
- **Seuils :** α = 0,01 plutôt que 0,05, parce que le nombre de comparaisons (groupes × lots × 2 dimensions) multiplie les faux signaux. Il n'y a pas de correction de Bonferroni : un signal est une invitation à regarder, pas une inférence. La note `tests_performed` donne le nombre de comparaisons faites (environ 1 faux signal attendu pour 100 comparaisons). Minimum 5 : à 5 contre 5, seule la répartition extrême (5/5 contre 0/5, p = 0,0079) atteint le seuil, et 4/5 contre 0/5 donne p = 0,048.
- **Mesures concernées :** toutes les mesures analysées de la strate, censurées comprises (leur valeur canonique n'est pas exposée).
- **Chiffres exposés :** `k_stratum`, `n_stratum`, `k_rest`, `n_rest`, `rate_stratum_percent`, `rate_rest_percent`, `p_value`, `alpha`.

## 5. Clé de signal

```
key = sha256_hex( json canonique {
  "v": "q1", "rule": "<règle>",
  "group": [polymère, méthode, matrice, détail, grandeur, base, unité canonique],
  "subject": { selon la règle },
  "records": trié([[file_sha256, feuille, ligne, colonne], …])
} )
```

JSON canonique : `sort_keys=True`, `ensure_ascii=False`, `separators=(",", ":")`. La clé fait 64 caractères hexadécimaux.

| Règle | `subject` | `records` |
|---|---|---|
| a | `{"sample": id}` | aliquotes quantifiées |
| b | `{"sample": id, "aliquot": a, "blank": id du contrôle}` | la mesure |
| c | `{"sample": id}` | aliquotes quantifiées de l'échantillon |
| d | `{"dimension": …, "stratum": valeur}` | mesures analysées de la strate |

- Stable au rechargement et à l'ordre des mesures : la clé ne dépend que du contenu.
- Stable face à un import sans rapport : seules les mesures qui contribuent au signal y entrent.
- L'empreinte du fichier, pas l'identifiant d'import : réimporter le même fichier redonne les mêmes clés. Un fichier corrigé a d'autres clés.
- La version entre dans la clé : q2 changera toutes les clés, et les décisions prises en q1 seront listées comme disparues.
- Les chiffres n'entrent pas dans la clé.

## 6. Conditions d'échec connues

- **Petit n et MAD minuscule :** avec des valeurs groupées, le MAD est minuscule et l'on sur-signale (exemple fictif, PE : MAD 0,1, l'échantillon 4 à 3,6 µg/mL a z = 7,42).
- **Forte censure à gauche :** seules les valeurs quantifiées forment la distribution. Elle est tronquée, la médiane est tirée vers le haut et une valeur basse anormale est presque indétectable.
- **Aliquote censurée qui masque une discordance :** une paire « 2,2 et < LOD » ne donne aucun signal.
- **Blanc sans méthode :** le contrôle résumé s'applique à toutes les méthodes du polymère.
- **Données corrigées du blanc :** le rapport compare une valeur nette à un blanc brut.
- **Unités non convertibles :** un blanc d'une autre grandeur ou base, ou d'une unité inconnue, ne produit aucun signal.
- **Comparaisons multiples :** α = 0,01 sans correction ; environ 1 faux signal attendu pour 100 comparaisons.
- **Lot confondu avec une série de prélèvement :** un écart de taux entre lots peut venir de l'échantillonnage, pas de l'analyse.
- **Date au jour près :** deux séries le même jour sont confondues.
- **Champs vides :** sans lot ni date, la règle d n'est pas appliquée (note `dimension_empty`).
- **Imports de versions B1 différentes :** les mesures sont comparées telles quelles, sans réconciliation des règles de lecture.

## 7. Résultats de référence

**Exemple fictif** (`leslie_like`, 200 mesures, une méthode, sang total, µg/mL, lot et date vides).

Sans contrôle qualité, 4 signaux :

| Règle | Objet | Chiffres |
|---|---|---|
| Discordance | Échantillon 16, PE | écart 55,9 % (7,1 et 4,0) |
| Discordance | Échantillon 12, PS (somme) | écart 59,5 % (4,8 et 2,6) |
| Atypique | Échantillon 16, PE | z = 20,57 (médiane 2,5 ; MAD 0,1 ; n = 5) |
| Atypique | Échantillon 4, PE | z = 7,42 |

Notes : `no_blank_summary` ; `too_few_samples` pour PMMA (1) et PP (0) ; `dimension_empty` pour le lot et la date.

Avec un blanc PET de procédure de 250 ng/mL (seuil 0,75 µg/mL), 6 signaux de plus (échantillon, aliquote, rapport) : 10 a 1,8 ; 11 b 2,8 ; 4 a 2,4 ; 4 b 2,0 ; 6 a 2,8 ; 7 a 2,0. Les 4 clés précédentes sont inchangées.

**Données réelles** (Leslie et al. 2022, Tableau S2), 3 signaux :

| Règle | Objet | Chiffres |
|---|---|---|
| Discordance | Échantillon 12, PS (somme) | 4,8 et 1,2 ; écart 120 % |
| Discordance | Échantillon 13, PS (somme) | 4,3 et 1,2 ; écart 112,7 % |
| Atypique | Échantillon 7, PET | z = 3,51 (médiane 1,1 ; MAD 0,25 ; n = 11) |

Le signal de l'échantillon 7 est à la limite (3,507 pour un seuil de 3,5). Aucun signal de taux de < LOD. Ces chiffres sont des tests de non-régression (`core/tests/results/test_quality.py`).

## 8. Décisions humaines et traçabilité

- Une personne enregistre une décision sur un signal. Chaque décision est une nouvelle ligne tracée (auteur, date, version des règles, chiffres du moment) et rien n'est modifié ni supprimé.
- Le serveur recalcule le signal avant d'écrire et ne fait jamais confiance au signal envoyé par le navigateur.
- Une décision se rattache à un signal par l'égalité de la clé.

## 9. Ce qui change la version

Tout changement de seuil, de population, de formule ou de clé donne `q2`. Les décisions prises en q1 restent lisibles, avec leur version.
