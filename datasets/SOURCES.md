# Catalogue des sources de données

Toutes les données de ce dossier sont **des données tierces, publiques, de polymères de référence ou environnementaux**.
Hormis la section « Résultats de laboratoire » (Tableau S2 de Leslie et al. 2022, publié sous CC BY 4.0), aucune n'est une mesure de microplastiques dans une matrice biologique humaine. Elles ne doivent jamais être présentées comme telles.

Règles :
- une ligne par jeu de données ; ne rien ajouter dans `datasets/` sans compléter ce fichier ;
- ne pas modifier les fichiers bruts : toute transformation se fait dans un pipeline versionné ;
- les champs « À compléter » bloquent tout usage commercial ou toute redistribution du jeu concerné.

## Spectres

| Dossier / fichiers | Jeu | Technique | Volume | Auteurs / citation | DOI / URL | Licence | Statut |
|---|---|---|---|---|---|---|---|
| `Spectres/10.22000-1820/` | MicroPlastiX SpecDB — Raman et ATR-FTIR de polymères vieillis et colonisés par biofilm | ATR-FTIR (3 832) + Raman (1 977) | 5 809 spectres, 38 feuilles physiques, 6 polymères | Lenz R., Fischer F., Arnold M., Fernández-González V., Moscoso-Pérez C.M., Andrade-Garda J.M., Muniategui-Lorenzo S., Fischer D. (2023) | https://doi.org/10.22000/1820 — code : https://doi.org/10.5281/zenodo.8314801 | **CC-BY-SA 4.0** (partage à l'identique) | Paquet BagIt complet, sommes MD5 vérifiées le 2026-10-23. `data/dataset/*.csv` = contenu extrait de `spectra.zip`. **1 881 spectres Raman sont en nm (longueur d'onde)**, acquis avec **deux lasers** déduits de l'axe des longueurs d'onde de chaque fichier : **532 nm** pour les fichiers 474–663 nm (1 510 spectres ; pics du PE à 1 302 / 1 445 / 2 854 / 2 888 cm⁻¹ après conversion) et **785 nm** pour les fichiers 783–1 068 nm (371 spectres : (07) PET, (04) PP et une partie des in situ PE/PP ; bandes du PP à ~398 / 808 / 841 cm⁻¹ et du PET à ~1 610 cm⁻¹ après conversion). Un fichier dont l'axe chevauche 700 nm est rejeté. Les 96 spectres Raman déjà en cm⁻¹ gardent laser_nm = 532 (valeur non vérifiée). À confirmer dans https://github.com/robna/MPX_specDB. `Exposure_days` = 999999 (324 enregistrements, échantillons in situ) signifie une durée d'exposition in situ / inconnue, pas une durée réelle. |
| `Spectres/FLOPP *` , `Spectres/FLOPP-e *` , `Spectres/read-me-1.docx` | FLOPP / FLOPP-e — bibliothèques µATR-FTIR de particules plastiques (neuves / vieillies dans l'environnement) | ATR-FTIR | 186 + 195 spectres, mêmes données en 4 formats (`.csv`, `.dx`, `.jdx`, `.spa`) | De Frond H., Rubinovitz R., Rochman C. — Rochman Lab, Université de Toronto | À compléter (article Analytical Chemistry, 2021) | À compléter | Garder `.csv` comme format de travail ; y en % de transmittance (bandes vers le bas, zéros de remplissage aux deux extrémités) : converti en absorbance A = −log10(T/100) au prétraitement |
| `Spectres/SLoPP and SLoPP-E/`, `Spectres/copy-of-slopp-and-slopp-e-spectra-itemized_public.xlsx` | SLoPP / SLoPP-E — bibliothèques Raman de particules plastiques (neuves / vieillies) | Raman | ≈ 148 + 113 spectres (`.txt` + `.l6s`, `.sdbx` KnowItAll) | Munno K., De Frond H., O'Donnell B., Rochman C. — Rochman Lab, Université de Toronto | À compléter (article Analytical Chemistry, 2020) | À compléter | L'xlsx à la racine est une copie de celui du dossier |
| `Spectres/RaSPI_raw.csv`, `RaSPI_processed.csv`, `RaSPI_metadata.csv` | RaSPI — spectres Raman de plastiques | Raman (523 / 633 nm) | 402 spectres, 14 polymères | À compléter | À compléter | À compléter | Métadonnées valides avec un vrai lecteur CSV (champs entre guillemets). `raw` : paires de lignes `wavenumber` / `intensity`. **Anomalies de curation de la source** : `PET5a`/`PET5b` apparaissent deux fois dans `raw` (second bloc PET5a–d, probablement PET6a–d) ; `PET5c`, `PET5d`, `PU15`, `PU16` sont absents des métadonnées ; `PET6a–d`, `PVC17`, `PVC18` sont absents de `raw`. Le catalogue marque ces spectres `UNKNOWN` plutôt que de deviner |
| `Spectres/RaMPI-metadata.csv`, `RaMPI-metadata-1.csv` | RaMPI — cartes Raman de plastiques | Raman (cartographie) | **Métadonnées seules** (34 cartes) | À compléter | À compléter | À compléter | **Spectres non téléchargés.** `-1` = ancienne version sans la dernière colonne |
| `Spectres/A Raman database of microplastics weathered under natural environments/` | Base Raman de microplastiques vieillis en milieu naturel | Raman | 18 standards + ≈ 155 vieillis (`.txt`, `.sdbx`) | À compléter | À compléter | À compléter | `content.xlsx` = mode d'identification de chaque spectre |
| `Spectres/raw.rds`, `nobaseline.rds`, `derivative.rds` | Probablement bibliothèques de référence Open Specy | FTIR + Raman | À compléter | À confirmer (Cowger et al.) | À compléter | À compléter | Format R : lire avec R ou `pyreadr` |

## Images

| Dossier / fichiers | Jeu | Modalité | Volume | Auteurs / citation | DOI / URL | Licence | Statut |
|---|---|---|---|---|---|---|---|
| `Images/*.parquet` | Export Roboflow (format Hugging Face, annotations COCO bbox + segmentation) | Microscopie (type non documenté) | 2 010 images issues de **177 photos originales** ; 1 classe (`category_id = 1`, nom inconnu) | À compléter | À compléter | **À compléter — inutilisable commercialement en l'état** | Augmentations dans tous les splits ; 2 photos présentes dans 2 splits (`Imagen038`, `Imagen051`) |
| `Images/dataset3/` | Images MEB de microplastiques (billes, fibres, fragments) avec masques d'instances et comptages | MEB Hitachi SU5000 (2020-2021) | 237 images originales + TIFF bruts avec métadonnées d'acquisition | À compléter | À compléter | **À compléter** | `dataset1` et `dataset2` supprimés le 2026-10-23 : doublons stricts de `dataset3` (vérifié par MD5) |

## Résultats de laboratoire

| Dossier / fichiers | Jeu | Technique | Volume | Auteurs / citation | DOI / URL | Licence | Statut |
|---|---|---|---|---|---|---|---|
| `resultats/1-s2.0-S0160412022001258-mmc1.docx` (local, non versionné) → `core/src/microtrace_core/results/data/leslie2022_table_s2.csv` (versionné) | Tableau S2 du matériel supplémentaire : polymères dans le sang total de 22 donneurs sains (**mesures réelles**, µg/mL) | Py-GC/MS | 22 donneurs, 40 aliquotes (a/b ; donneurs 6, 9, 15, 18 : une seule) × 5 polymères | Leslie H.A., van Velzen M.J.M., Brandsma S.H., Vethaak A.D., Garcia-Vallejo J.J., Lamoree M.H. (2022). Discovery and quantification of plastic particle pollution in human blood. *Environment International* 163, article 107199 | https://doi.org/10.1016/j.envint.2022.107199 | **CC BY 4.0** (http://creativecommons.org/licenses/by/4.0/) — attribution obligatoire | Valeurs recopiées à l'identique du Tableau S2 du matériel supplémentaire ; aucune modification. CSV généré une fois par `scripts/build_leslie_s2.py`. Anomalies de la source conservées telles quelles : l'étiquette du donneur 9 se lit « 9a 9b » mais ses valeurs b sont vides (traité comme aliquote unique) ; donneur 20a, PET = `<0.61` (limite du PE, pas du PET) |

## Journal

- **2026-10-22** — premiers téléchargements (spectres, parquet).
- **2026-10-23** — ajout des images MEB et du paquet BagIt complet MicroPlastiX ; suppression de `Images/dataset1`, `Images/dataset2` et `Images/__MACOSX` (doublons / résidus macOS).
- **2026-10-27** — ajout du Tableau S2 de Leslie et al. 2022 (CC BY 4.0) comme jeu d'exemple réel.
