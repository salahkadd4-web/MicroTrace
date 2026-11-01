# Guide de test du prototype MicroTrace Studio

Ce guide fait le tour complet du prototype dans votre navigateur, dans l'ordre : démarrage, compte, laboratoire, études d'exemple, résultats, rapport, qualité, spectres, images, consentement. Comptez environ une heure.

Notez au fur et à mesure ce qui vous surprend, ce qui manque ou ce qui n'est pas clair (avec le numéro de l'étape) : c'est ce retour qui sert.

---

## 0. Avant de commencer

- **Docker Desktop** est ouvert et indique « Running ».
- Le dossier `models/` du projet contient les deux fichiers de modèles : `c5-spectral-s1.npz` et `c6-microscopie-i1.npz`.
- Le fichier `.env` à la racine du projet existe (secrets Docker). S'il manque : `node scripts/generate-secrets.mjs`.
- Le mode développement (`npm run dev`) est **arrêté** : il utilise lui aussi le port 3000.

## 1. Démarrer tout le prototype

Dans PowerShell, depuis le dossier du projet :

```powershell
docker compose up -d --build
docker compose ps
```

**Attendu :** `db`, `engine` et `web` sont « running (healthy) » ; `migrate` s'est arrêté normalement.

## 2. Créer votre compte d'administrateur (une seule fois)

```powershell
docker compose run --rm tools npm run user:create -- --email votre@email --name "Votre Nom" --platform-admin
```

Le mot de passe est demandé deux fois et ne s'affiche pas. Ne le communiquez à personne.

## 3. Se connecter

Ouvrez <http://localhost:3000>.

**Attendu :**
- la page de connexion avec le logo MicroTrace et, dans l'onglet du navigateur, l'icône du logo (si vous voyez encore une ancienne icône, fermez l'onglet et rouvrez-le, ou videz le cache avec Ctrl+F5) ;
- la mention « Prototype de recherche, pas un dispositif médical ».

## 4. Créer un laboratoire et y entrer

1. Après connexion, vous êtes dans la **Console de la plateforme**. Créez un laboratoire (par exemple « Labo Test »), avec **votre propre e-mail** comme responsable.
2. L'application affiche un **lien d'invitation**. Ouvrez-le dans le même navigateur : comme votre compte existe déjà, vous rejoignez le laboratoire comme responsable.
3. Ouvrez le laboratoire depuis l'en-tête.

**Attendu :** l'en-tête montre le nom du laboratoire, « Projets » et « Membres ».

## 5. Études d'exemple, Résultats et Rapport

1. Page **Projets** : cliquez « Créer l'étude d'exemple (fictive) », puis « Créer l'étude d'exemple réelle (Leslie et al. 2022) ».
2. Ouvrez l'étude fictive, onglet **Résultats**.

**Attendu (les deux études) :** PET **11/22**, PS (somme) **8/22**, PE **5/22**, PMMA **1/22**, PP **0/22**, Au moins un polymère **17/22**, avec graphiques et tableaux. L'étude fictive porte le bandeau jaune « SIMULÉ ».

3. Onglet **Rapport** : téléchargez le rapport HTML, le CSV des mesures et le dictionnaire.

**Attendu :** le rapport contient les mêmes chiffres, la mention « SIMULÉ » pour l'étude fictive, le DOI et la licence pour Leslie ; le CSV de l'étude fictive s'appelle `SIMULE-…`.

4. Onglets **Paramètres**, **Imports** et **Journal** : parcourez-les (méthodes, limites de détection, import enregistré, historique des actions).

## 6. Assistant qualité (onglet Qualité)

Sur l'étude fictive, onglet **Qualité**.

**Attendu :** le badge « Règles d'essai » et **4 signaux** : deux aliquotes discordantes (échantillon 16 PE ≈ 55,9 %, échantillon 12 PS ≈ 59,5 %) et deux valeurs atypiques en PE ; plus des notes (pas de blanc, PMMA et PP trop peu nombreux, pas de lot ni de date).

À essayer : enregistrez une décision sur un signal (« Examiné — justifié » avec une note), puis vérifiez qu'elle s'affiche et qu'elle apparaît dans le Journal.

## 7. Identification spectrale (onglet Spectres)

Sur une étude, onglet **Spectres**. Déposez ce fichier :

`datasets\Spectres\10.22000-1820\data\dataset\VLFR_02-HDPE_nobio_Raman_dc1c0b0b.csv`

avec **Technique : Raman**, **Unité de l'axe : longueur d'onde (nm)** et **Laser : 532**.

**Attendu :** « Polyéthylène (PE) — Identifié (proposition) », les 3 polymères proposés, le graphique du spectre superposé aux références, la fiche du modèle avec le badge « Modèle d'essai ».

À essayer : enregistrez une décision (« Acceptée », ou « Corrigée » vers un autre polymère).

## 8. Analyse d'images (onglet Images)

Sur une étude, onglet **Images**. Déposez cette image en laissant l'échelle **vide** :

`datasets\Images\dataset3\bead\original_image_bead\Dove_men_acrylates_copolymer_microbeads_new_No0045.tif`

**Attendu :** échelle « 0,763 µm/px (lue dans l'image) », bande du bas retirée, **1 particule candidate** de forme « bille » (diamètre équivalent ≈ 290 µm), son contour dessiné sur l'image, la distribution des tailles, et la phrase rappelant que la nature (plastique ou non) n'est pas déterminée par l'image.

À essayer : décision « Corrigée » (par exemple ajouter 1 particule manquée) ; rouvrez le formulaire : il reprend la correction précédente. Téléchargez l'image annotée et le CSV des comptages.

## 9. Consentement et export (page Membres)

Page **Membres**, section « Données et amélioration des modèles ».

**Attendu :** le consentement est **désactivé** par défaut ; aucun export n'est possible. Accordez-le (en tant que responsable), regardez les liens d'export, puis retirez-le. Chaque action apparaît dans l'historique.

L'export ne contient que des analyses validées par une personne, dans des études **non simulées et déclarées pseudonymisées** : avec les études d'exemple (simulées), il est donc vide, c'est normal.

## 10. Isolation entre laboratoires (facultatif)

Créez un deuxième laboratoire dans la Console, avec un autre e-mail dont vous avez l'accès, et connectez-vous avec ce compte : il ne voit **aucune** étude du premier laboratoire ; une adresse copiée d'une étude du premier affiche « Page introuvable ».

## 11. Arrêter

```powershell
docker compose stop      # arrêter
docker compose start     # relancer plus tard
```

Les données (base et fichiers) sont conservées entre les arrêts.

---

## Ce qu'il est utile de me renvoyer

- les étapes qui ne donnent pas le résultat « Attendu » (numéro d'étape + ce que vous voyez, une capture si possible) ;
- ce qui n'est pas clair pour un chercheur de laboratoire (mots, ordre des écrans, explications) ;
- ce qui manque pour présenter le prototype à un premier laboratoire.

**Rappels avant toute présentation à un laboratoire :** confirmer les licences des bibliothèques spectrales « à compléter » et du jeu d'images `dataset3` ; faire valider le volet juridique (loi 18-07, ANPDP, clause des contrats) avant tout réentraînement avec des données de laboratoires.
