# Suivi du prototype — points reportés

Ce fichier recense ce qui a été volontairement reporté pendant le prototype. Chaque sous-projet y ajoute ses points à sa clôture.

## Exigences avant tout hébergement de données réelles

- Vérifier l'adresse e-mail à l'acceptation d'une invitation, ou imposer une réinitialisation du mot de passe. Aujourd'hui :
  - le détenteur du lien choisit le mot de passe de l'adresse invitée ;
  - l'existence d'un compte est révélée au détenteur du lien.
- Isolation en base par la sécurité au niveau des lignes de PostgreSQL (RLS), en plus de l'isolation applicative testée.
- Limitation du nombre de tentatives de connexion et verrouillage temporaire ; journal des connexions échouées.
- `APP_URL` obligatoire en production : il n'est aujourd'hui que documenté. `trustHost` est toujours actif.
- Choix de l'hébergeur et du pays d'hébergement, au regard de la loi algérienne 18-07, présenté au fondateur.
- Commande de maintenance qui liste les fichiers orphelins du magasin de fichiers (§5).
- Avant tout réentraînement avec les données des laboratoires : clause contractuelle d'utilisation des données, déclaration ANPDP (loi 18-07), consentement opt-in par laboratoire en place (voir la spec, « Cycle de vie des modèles »).

## C2 — points mineurs reportés (clos le 2026-10-27)

- Le client du moteur ne valide pas les réponses 200 à l'exécution (`as T`). Une réponse mal formée est signalée comme « indisponible ».
- Pas de verrou de ligne sur la double vérification « pseudonymisation déjà déclarée » ou « déjà archivée » : deux requêtes simultanées sont un cas improbable.
- Préremplissage Leslie :
  - message trompeur si une limite de l'exemple cite une méthode absente ;
  - pas de correspondance P2002 en cas de création concurrente ;
  - polymère non rogné.
- Le journal d'une étude est limité à 500 événements, sans avertissement à l'écran.
- `requireUser` est appelé plusieurs fois par requête sur les pages de laboratoire (une mise en cache est possible).
- Le commit intermédiaire `19fda05` contient une faille inter-laboratoires corrigée au commit suivant : ne jamais déployer ce commit seul.
- En production, l'écran d'erreur d'un laboratoire suspendu affiche un texte générique (« Recharger ») : Next.js masque le message de l'erreur.
- Prisma est figé en 7.10.1 ; embedded-postgres 17.10 est en version bêta (tests seulement).

## C3 — points reportés (clos le 2026-10-30)

- Aucun verrou entre le contrôle et l'enregistrement : l'enregistrement relance lui-même le contrôle, et le plafond d'étude est vérifié sous verrou de la ligne d'étude, mais un import actif ajouté entre-temps peut faire apparaître de nouveaux doublons au moment d'enregistrer.
- Les fichiers orphelins du magasin `files/` sont tolérés (un fichier est écrit avant la transaction ; un échec ou un doublon le laisse en place). Une commande de maintenance qui les liste puis les supprime reste à écrire.
- Les mesures du moteur transitent deux fois par Node (contrôle puis enregistrement). Un mode du moteur qui ne renvoie que les comptes (« contrôle seul ») allégerait le contrôle.
- Le tableau des problèmes (IssuesTable) n'est pas paginé côté serveur : sous charge, ou avec des dizaines de milliers de problèmes, la réponse du contrôle peut dépasser le délai.
- Le plafond d'étude (50 000 mesures actives) et le plafond par import (50 000) sont des constantes de code, pas des réglages par laboratoire.
- Le dépôt est effacé au clic sur « Changer de fichier » ; fermer l'onglet laisse le dépôt jusqu'à la purge (24 h, déclenchée à chaque dépôt ou lecture).
- Les imports créés avant cette version n'ont pas de nombre de lignes (colonne « Lignes » affichée avec un tiret).

## C4 — points reportés (clos le 2026-10-30)

- Plafond abaissé à 50 000 mesures actives par étude et par import pour rester sous la limite de 75 Mo du moteur ; pistes pour le relever : compression gzip des requêtes, issues agrégées par code dans /report.
- Un GET de premier niveau venu d'un autre site peut déclencher un téléchargement audité (pas de fuite de données, car la réponse n'est pas lisible par l'autre origine ; seulement du bruit dans le journal). Piste : vérifier `Sec-Fetch-Site` (`same-origin` ou `none`) avant d'auditer.
- Le CSV des mesures utilise le point comme séparateur décimal (valeurs telles qu'enregistrées). Dans Excel en français : importer comme données (Données > À partir d'un fichier texte/CSV) avec le séparateur « ; » et la décimale « . ».
- La page « introuvable » d'une étude d'un autre laboratoire répond avec le statut HTTP 200 (la mise en page de l'étude est déjà envoyée quand `notFound()` est levé). Aucune donnée n'est divulguée ; les routes de téléchargement renvoient bien 404. Piste : vérifier l'étude avant tout rendu en flux.
- Le rapport montre les méthodes et limites figées lors des imports (seules elles servent au calcul des statuts), mais la nature, le DOI, la licence et la correction du blanc actuels de l'étude ; l'avertissement « paramètres modifiés » ne porte que sur les méthodes et limites.
- Le CSV des mesures exporte les mesures seulement, pas les contrôles qualité.
- Les libellés (polymères « PS (somme) » et « Au moins un polymère », matrices, grandeurs, statuts, techniques, types de blanc) existent en deux endroits (interface `web/src/lib/labels.ts` et `polymer-labels.ts`, rapport du moteur `core/.../vocab.py`) : à garder avec les mêmes mots (seule la casse change selon la place dans la phrase). Écarts connus restants : « Échantillon dopé » (interface) / « dopé » (rapport).
- Les nombres de l'écran Résultats suivent la règle du rapport du moteur (`fmt_fr` : 6 chiffres significatifs, arrondi à la paire, pourcentage à une décimale, sans séparateur de milliers) ; les tests de `NumberFr` et de `test_summary_report.py` portent les mêmes cas à garder en miroir.
- Page Résultats : le tableau « Voir les données » est limité à 500 lignes par groupe ; le nuage de points trace tous les échantillons quantifiés sans seuil (à plafonner si une étude approche 50 000 points). Le budget de 75 Mo suppose des textes libres courts (commentaire, lot, laboratoire) : au-delà, le moteur répond 413 et l'écran propose de retirer un import ou de scinder l'étude.
- Les tests de bout en bout recompilent l'application à chaque exécution (environ trois minutes) ; un arrêt brutal pendant la compilation peut laisser des processus orphelins.

## Passe de design — points reportés (2026-10-30)

- Le code brut `PS_SUM` apparaît dans le tableau des limites de Paramètres et dans la colonne « Objet » du Journal (« PS_SUM (Py-GC/MS) »), alors que Résultats affiche « PS (somme) ». Piste : afficher `polymerLabel(code)` avec le code en repère secondaire (`font-mono text-xs text-muted-foreground`), et remplacer le champ libre « Polymère » de « Ajouter une limite » par une liste (libellé affiché, code envoyé) ; vérifier les tests qui lisent les codes bruts.
- Le sélecteur de laboratoires n'est pas capturé dans les images de revue : les données du test de bout en bout n'ont qu'un laboratoire par utilisateur.
- Le thème sombre est défini dans `globals.css` (jetons) mais n'est pas activé.
- Bouton « Supprimer » d'une limite (Paramètres) en `destructive` plein, alors que les autres déclencheurs de ligne (Retirer, Révoquer, Suspendre) sont en `outline sm` : harmoniser (`ConfirmActionButton` avec une propriété `size`).
- Paramètres : l'état vide et le panneau « Ajouter un contrôle qualité » sont tous deux en pointillés ; les formulaires à 2 colonnes (`max-w-3xl`) s'arrêtent avant le bord de leur panneau à 1024 px.
- Pages hors périmètre restées à l'ancien style : `aucun-laboratoire`, avis de laboratoire suspendu, `app/not-found.tsx` (état vide sans icône, liens simplement soulignés).
- Images de revue : attente fixe de 500 ms au lieu de `document.fonts.ready` ; le champ fichier natif s'affiche en anglais selon la langue de Chromium.
- Imports : la colonne d'actions est collée à droite (`sticky`) pour rester visible sur tablette ; le tableau des statistiques de Résultats défile dans son cadre (exception acceptée).

## C7 — points reportés (clos le 2026-10-31)

- Les signaux de qualité n'apparaissent pas dans le rapport téléchargeable.
- Seuils fixes (version q1) : pas de réglage par laboratoire ; pas de notification.
- Les résumés de contrôle qualité n'ont pas de méthode : un blanc s'applique à toutes les méthodes du même polymère. Les blancs de terrain et les blancs mesurés importés (`qc_records`) ne sont pas encore utilisés.
- Pas de pagination des signaux : au-delà de 200 signaux par règle, les suivants ne sont pas affichés, et la réponse du moteur n'est pas plafonnée.
- Au plus 5 000 décisions lues par étude.
- Règle d (taux de < LOD par lot ou par date) : pas de correction pour comparaisons multiples (seuil strict p < 0,01 à la place).
- Pas de règle pour une paire « une aliquote quantifiée, l'autre < LOD ».
- Valeur atypique : quand les valeurs d'un groupe sont très resserrées (MAD faible), un échantillon modérément écarté peut être signalé (cas de l'échantillon 4 PE de l'exemple fictif) ; c'est documenté dans la fiche des règles.
- L'avertissement de versions de règles différentes sur l'onglet Qualité ne liste pas les versions (le service ne les expose pas).
- L'onglet cite la fiche des règles par son chemin dans le dépôt (`docs/models/c7-qualite.md`) : à remplacer par une page de documentation accessible aux laboratoires.
- Une note de décision qui n'est pas une chaîne est traitée comme absente.
- Les signaux sans décision ne sont pas enregistrés : l'exporteur d'entraînement futur doit recalculer les signaux courants (même version) et traiter « Non examiné » comme exclu (spec §10). Le contrôle « résultats validés » devra refuser la validation tant que des signaux sont « Non examiné » ou « À vérifier », et traiter les décisions sur des signaux disparus comme sans effet.
- Le parcours e2e ne couvre pas le retour d'une décision après retrait puis réimport du même fichier (couvert par les tests de la clé et du service), ni une ligne censurée dans un signal (« — » couvert par les tests de page et du moteur) : à ajouter quand un exemple fictif portera des lots.
- Le tableau des chiffres d'un signal affiche 6 chiffres significatifs : dans une bande relative de 1e-6 autour d'un seuil, un chiffre peut s'afficher égal au seuil alors que le texte explicatif, lui, ne se contredit jamais.
- Un contrôle qualité résumé ne se modifie pas : pour corriger une saisie, le supprimer (Paramètres) puis le ressaisir.
