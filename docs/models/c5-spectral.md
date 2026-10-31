# Fiche du modèle : identification spectrale (C5), version s1

## 1. Objet et statut

**Modèle d'essai** : aide à l'identification d'un polymère à partir d'un spectre Raman ou FTIR (ATR). Il a été entraîné sur des données publiques, pas encore sur les vôtres.

- Il formule une **proposition** (trois polymères, cinq références proches, un statut) ; il ne mesure rien et ne pose aucun diagnostic.
- Une personne du laboratoire examine chaque proposition et enregistre sa décision. Rien n'est automatique.
- **Pas de classe non plastique dans cette version.** Un matériau non plastique n'a donc aucune classe à laquelle être rattaché : il doit aboutir à une abstention ou à une proposition « incertaine ». Seule la cellulose (fibre naturelle) existe comme classe nommée.
- Ce modèle **n'a pas vu de particules extraites de sang** : aucune des bibliothèques d'entraînement ne contient de matrice biologique.

## 2. Version et empreintes

- Modèle : `c5-spectral`, version `s1`, entraîné le {{DATE}}.
- Empreinte sha256 des poids (`models/c5-spectral-s1.npz`, jamais versionnés) : `{{MODEL_SHA}}`.
- Manifeste `docs/models/c5-spectral-manifest.json` : sha256 `{{MANIFEST_SHA}}` ; il porte aussi le commit du code, les versions des bibliothèques logicielles et l'empreinte de la liste des données.
- Verrou du moteur `engine/src/microtrace_engine/spectral_model.lock.json` : même empreinte que le manifeste. Le moteur refuse de servir des poids dont l'empreinte diffère, sans les lire.
- Réentraînement reproductible : `python -m microtrace_core train-spectral … --check` (graine 0, deux entraînements donnent les mêmes octets sur la même machine).

## 3. Données et licences

Le catalogue (chantier A) regroupe des spectres de polymères de référence et environnementaux. Ne sont retenus que les spectres de polymère connu dont la couverture de la fenêtre diagnostique atteint 0,8.

| Code | Bibliothèque | Licence | Courbe affichable |
|---|---|---|---|
| `mpx` | MicroPlastiX SpecDB, Lenz R. et al. (2023), doi:10.22000/1820 | CC BY-SA 4.0 | oui, avec l'attribution |
| `flopp`, `flopp_e` | FLOPP / FLOPP-e, De Frond, Rubinovitz et Rochman (2021) | à compléter | non |
| `slopp`, `slopp_e` | SLoPP / SLoPP-E, Munno et al. (2020) | à compléter | non |
| `raspi` | RaSPI | à compléter | non |
| `raman_weathered` | Base Raman de microplastiques vieillis en milieu naturel | à compléter | non |

- Décision R-C5-1 : les six bibliothèques dont la licence est « à compléter » (FLOPP, FLOPP-e, SLoPP, SLoPP-E, RaSPI, raman_weathered) servent à ce **modèle d'essai interne** et sont citées par leur identifiant ; seules les courbes de MicroPlastiX sont affichées.
- **Les licences doivent être confirmées avant toute présentation à des laboratoires.**
- Les effectifs par technique, bibliothèque et polymère, et les exclusions, sont dans le manifeste.
- Les étiquettes de plusieurs bibliothèques de référence (`raman_weathered`, `flopp_e`, `slopp_e`) proviennent de recherches en bibliothèque, non d'une analyse indépendante.

## 4. Pipeline et constantes

1. Lecture d'un fichier texte à deux colonnes, puis `Spectrum` (technique, unités, laser).
2. Prétraitement du chantier A, inchangé (version `2`) : conversion nm vers cm⁻¹ par le laser, transmittance vers absorbance, rééchantillonnage sur la grille de la technique, ligne de base, min-max.
3. Couverture de la fenêtre diagnostique inférieure à 0,8 : abstention `low_coverage`.
4. Corrélation de Pearson sur la fenêtre diagnostique (Raman 400 à 1 800 cm⁻¹ ; FTIR 600 à 1 800 cm⁻¹) avec chaque référence ; score d'un polymère = meilleure corrélation de ses références ; marge = score n° 1 moins score n° 2.
5. Second avis : PCA (30 composantes) puis SVM RBF équilibré. Il ne décide pas seul : son accord avec la corrélation est une condition de « identifié ».
6. Garde de technique : le spectre est aussi comparé à l'autre technique ; si elle lui ressemble davantage (marge d'au moins 0,10), abstention `technique_mismatch`.
7. Statut : `non identifié` si le score est sous le seuil d'incertitude (ou couverture, recouvrement ou garde en défaut) ; `identifié` si le score et la marge atteignent leurs seuils et que le SVM est d'accord ; `incertain` sinon.

Constantes : graine 0 ; recouvrement minimal 0,5 ; 3 candidats ; 5 références ; une courbe tracée sur deux points ; laser entre 200 et 1 100 nm.

## 5. Protocole d'évaluation

- **Porte de reproduction** : la corrélation sur la grille entière, en validation « une bibliothèque tenue à part » (LOLO), doit retrouver la baseline du chantier A à 0,005 près, sinon rien n'est écrit.
- **LOLO sans fuite** : pour chaque bibliothèque tenue à part, références, PCA, SVM et seuils d'estimation sont appris sans elle. Une requête dont le polymère n'existe pas hors de sa bibliothèque est comptée « hors bibliothèque ».
- **Choix des seuils** : sur les prédictions LOLO dans la bibliothèque, le couple (seuil d'identification, marge) qui maximise la part de « identifié » sous trois contraintes : précision globale d'au moins 0,95, précision d'au moins 0,90 par bibliothèque, « identifié » hors bibliothèque d'au plus 0,10. Le seuil d'incertitude est le plus bas qui garde le bon polymère dans les trois propositions dans 95 % des cas.
- **Estimation imbriquée** : pour chaque bibliothèque, les seuils sont rechoisis sur les autres bibliothèques seulement, puis appliqués à elle ; c'est la **précision estimée** à retenir, plus honnête que la précision sur les mêmes données.

## 6. Résultats mesurés

<!-- BEGIN:metrics -->
<!-- END:metrics -->

Lecture. En FTIR l'abstention est nettement plus fréquente qu'en Raman : les polymères absents de l'apprentissage (caoutchouc, acrylique) ressemblent fortement au PE, et seul un seuil haut les écarte. Un spectre de la bibliothèque déposé tel quel se retrouve lui-même (corrélation 1).

## 7. Conditions d'échec connues

- Particules extraites de sang : jamais vues à l'entraînement.
- Matériaux non plastiques (protéines, minéraux, fond) : pas de classe dédiée.
- Polymère absent de l'apprentissage : en FTIR, le caoutchouc et l'acrylique ressemblent au PE.
- Mélange de polymères ou particule pigmentée.
- Vieillissement et biofilm au-delà de ceux des bibliothèques.
- Mauvaise technique déclarée : la garde signale la plupart des cas, mais produit des faux signalements (de l'ordre de 2,5 % en Raman), qui donnent une abstention prudente.
- Erreur de laser : un axe en nm avec un laser faux donne une couverture insuffisante et une abstention.
- Transmittance déclarée absorbance : bandes inversées, abstention attendue.
- Spectre tronqué hors de la fenêtre diagnostique.
- Domination de MicroPlastiX (92 % des requêtes FTIR, 71 % des requêtes Raman) : les performances reflètent surtout des polymères de référence propres.

## 8. Décisions humaines, traçabilité, consentement

- Chaque analyse et chaque décision (acceptée, corrigée, rejetée) sont de nouvelles lignes enregistrées, jamais modifiées ni supprimées.
- Le fichier est conservé dans le magasin adressé par contenu ; l'audit ne contient ni nom de fichier ni note.
- Le consentement à l'export des décisions validées pour l'amélioration future des modèles est désactivé par défaut et géré par l'administrateur du laboratoire.

## 9. Ce qui change la version

Un changement des seuils, des données, du prétraitement, de la fenêtre diagnostique ou du modèle donne une nouvelle version (`s2`), un nouveau manifeste et un nouveau verrou.

## 10. Relecture avant présentation aux chercheurs

- Confirmer les licences « à compléter » (section 3).
- Relire les conditions d'échec (section 7) et la phrase « modèle d'essai » affichée à l'écran.
- Vérifier que le bloc de métriques correspond au manifeste (test `test_card_metrics_block_is_current`).
