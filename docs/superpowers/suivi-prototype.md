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
- Les DOI, licence et nature affichés dans le rapport sont ceux du contexte figé de l'import le plus récent : une modification faite après l'import n'apparaît qu'au prochain import.
- Le CSV des mesures exporte les mesures seulement, pas les contrôles qualité.
- Les libellés « PS (somme) » et « Au moins un polymère » existent en deux endroits (interface `web/src/lib` et rapport du moteur) : à garder identiques.
- Les tests de bout en bout recompilent l'application à chaque exécution (environ trois minutes) ; un arrêt brutal pendant la compilation peut laisser des processus orphelins.
