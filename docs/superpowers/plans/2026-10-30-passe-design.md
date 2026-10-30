# Passe de design (logo et refonte visuelle) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** donner à MicroTrace Studio l'identité du logo A « Goutte tracée » et une interface d'instrument de laboratoire lisible sur tablette, sans changer aucun comportement.

**Architecture :** jetons du thème dans `web/src/app/globals.css`, polices `next/font`, primitives shadcn ajustées, deux composants nouveaux (`Section`, `Logo`), puis application page par page.

**Tech Stack :** celle de `web/` ; aucune nouvelle dépendance (lucide-react, Radix, Recharts, `next/og` sont déjà là).

**Spec :** `docs/superpowers/specs/2026-10-30-passe-design.md` (§3 jetons, §4 composants, §5 logo, §6 tâches et risques de tests, §7 à ne pas changer, §8 décisions).

## Global Constraints

1. Aucun changement de comportement, de route, ni de nom accessible (titres, boutons, alertes, légendes), sauf les trois textes de la décision R-D-1.
2. Couleurs uniquement par jetons (`var(--…)` ou classes Tailwind de jetons) ; aucune couleur codée en dur dans les pages et composants (seule exception : `app/icon.svg` et `app/apple-icon.tsx`).
3. Aucune nouvelle dépendance ; pas de sélecteur de thème sombre.
4. Les risques de tests du §6 de la spec sont des contraintes : un test existant ne se modifie que si le changement de texte vient de R-D-1, et la modification est signalée dans le rapport.
5. Après chaque tâche : tests ciblés des fichiers touchés, `npm run typecheck`, `npm run lint`, `npm run build` dans `web/`. À la fin de la tâche 4 : `npm test` complet et `npm run e2e`.
6. Sécurité et environnement : jamais de `.env` lu ou commité, jamais le service PostgreSQL Windows (5432), jamais Docker, jamais de push.

## Review Focus

1. **Nom accessible changé par le style** (ex. `uppercase`, texte éclaté en plusieurs nœuds, icône sans `aria-hidden`) : les tests et lecteurs d'écran doivent trouver les mêmes noms.
2. **Contraste** : aucun texte sarcelle sur `--muted` ou `--accent`, aucun texte corail (§3).
3. **Tablette (768 et 1024 px)** : rien ne déborde horizontalement hors des tableaux défilants ; cibles ≥ 36 px.
4. **Avertissements scientifiques** visibles comme tels (variante `warning`) et distincts des informations.
5. **Mention SIMULÉ** toujours aussi visible (bandeau `bg-warning`).

---

### Tâche 1 — Fondations : jetons, polices, primitives, logo et icônes

Spec §6 T1, T2, T3, plus §3, §4, §5 et R-D-3. Fichiers : `globals.css`, `app/layout.tsx`, `ui/{button,input,select,table,badge,alert,card,sonner}.tsx`, nouveaux `components/app/{Section,Logo}.tsx`, `PageHeader`, `EmptyState`, `DataNatureBanner`, `ConfirmDialog` (`confirmVariant`), `ActionForm` (`columns`), `FormField`, `IssuesTable` (badges et code `font-mono`), `app/icon.svg`, `app/apple-icon.tsx`, suppression de `app/favicon.ico`. Tests : `Logo` (variantes, `aria-hidden`, aucune couleur codée en dur), `Section` (h2 + description), `confirmVariant`, `columns={2}`. Commit `feat(web): brand tokens, fonts, logo and shared components`.

### Tâche 2 — Coque, connexion, invitation, pages du laboratoire et console

Spec §6 T4 à T9, R-D-1 (a) n'est pas ici. `AppShell` (+ `NavLink` client tolérant `usePathname() === null`), `connexion`, `invitation/[token]`, `projets`, `projets/[projectId]`, `membres`, `admin`. R-D-4. Commit `feat(web): branded shell, sign-in and lab pages`.

### Tâche 3 — En-tête d'étude, Paramètres, Imports, Journal et pages système

Spec §6 T10, T11, T12, T15, R-D-1 (a) et (b). Commit `feat(web): study header, settings, imports and journal redesign`.

### Tâche 4 — Résultats et Rapport

Spec §6 T13, T14, R-D-1 (c), R-D-5. Puis `npm test` complet et `npm run e2e`. Mettre à jour la capture des points reportés dans `docs/superpowers/suivi-prototype.md` (section « Passe de design — points reportés ») si quelque chose est laissé. Commit `feat(web): results and report redesign`.
