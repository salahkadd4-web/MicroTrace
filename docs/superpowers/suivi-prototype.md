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
