# Passe de design — MicroTrace Studio (web/) — spécification

Audit en lecture seule, le 2026-10-30. Toutes les lignes citées sont celles du fichier (chemins relatifs à `web/src/`).
Règle de la passe : **aucun changement de comportement, de route, de sens du texte ni de nom accessible** (titres, libellés de boutons, textes d'alerte, légendes de tableau restent identiques). Les seules modifications de texte visible possibles sont listées au §6 et sont **optionnelles**.

---

## 1. État actuel

**Thème** (`app/globals.css`) : thème shadcn « radix-nova » d'origine, aucune trace de la marque.
- `--primary` bleu indigo `oklch(0.488 0.217 264)` (l.60), fond blanc pur, `--foreground` ardoise, `--radius: 0.625rem` (l.79).
- `--chart-1..5` (l.74-78) = primaire bleu, gris ardoise, ambre (= `--warning`), rouge (= `--destructive`), ardoise foncé : deux gris peu distincts (ΔE 24), le rouge entre en conflit avec le sens « erreur ».
- `.dark` (l.90) est défini mais **jamais activé** (aucun ThemeProvider, aucune classe `.dark`) ; `ui/sonner.tsx:8` lit `useTheme()` sans fournisseur → thème « system » : toasts sombres possibles sur une app claire.
- `--font-heading: var(--font-sans)` (l.12) ; polices Geist + Geist Mono (`app/layout.tsx:2-14`). Favicon = `app/favicon.ico` par défaut de Next.

**Coque** (`components/app/AppShell.tsx`) : en-tête blanc `border-b`, `max-w-6xl` (1152 px), `px-4 py-3` (l.30). Marque = texte « MicroTrace Studio » en `font-semibold` (l.32). Ordre visuel : marque · nom du labo (`span text-sm`, l.37) · Projets/Membres (liens `text-sm text-muted-foreground` sans état actif, l.38-53) · Console (l.56) · sélecteur de labos en ligne de liens soulignés (l.64-77) · utilisateur + « Se déconnecter » (l.80). Contenu `main max-w-6xl space-y-6 px-4 py-6` (l.89).

**Typographie** : h1 `text-2xl font-semibold` (`PageHeader.tsx:15`), h2 `text-lg font-semibold` répété à la main dans chaque page, h3 `text-base font-medium` (résultats). Tout le corps en `text-sm`.

**Densité** : bouton `h-8` (32 px), `sm` `h-7` (28 px) (`ui/button.tsx:24-26`), input `h-8` (`ui/input.tsx:10`), select `h-8` ; en-tête de tableau `h-10 px-2` texte noir `font-medium` (`ui/table.tsx:72`), cellule `p-2` (l.85), aucun cadre ni fond de tableau (l.10).

**Formulaires** : tous en une colonne `max-w-xl`, `space-y-4`, bouton d'envoi à gauche (`ActionForm.tsx:51`). **États vides** : boîte pointillée `p-8` centrée, sans icône (`EmptyState.tsx:13`). **Alertes** : variante `default` = `bg-card` + description `text-muted-foreground` (`ui/alert.tsx:10,57`) → une information, un avertissement scientifique et un rappel « archivée » ont le même aspect gris, sans icône. **Graphiques** (`resultats/ResultCharts.tsx`) : Recharts nu, info-bulle par défaut non thémée (l.42, 89), grille pleine (l.71), barres carrées, `h-64`/`h-72`.

### Problèmes UX classés (impact décroissant)

1. **Aucune identité, couleur générique** — primaire indigo shadcn (`globals.css:60`), marque en texte seul (`AppShell.tsx:32`), favicon Next. Rien ne dit « laboratoire » ni « MicroTrace ».
2. **Paramètres = un mur vertical** — 6 sections empilées, chacune tableau + formulaire 6-7 champs en une colonne (`parametres/page.tsx:62-226`, `parametres/forms.tsx:52,71,103,138`). Sur tablette : > 4 écrans de défilement, LOD/LOQ/Unité éloignés.
3. **Aucun contenant visuel** — sections, tableaux et formulaires flottent sur le même blanc ; on ne voit pas où finit « Limites de détection » et où commence « Contrôles qualité ». Idem imports (`imports/page.tsx:51-143`), résultats.
4. **Avertissements scientifiques invisibles** — « versions de règles différentes » et « paramètres changés depuis l'import » (`resultats/page.tsx:179,187`) s'affichent en gris neutre, comme « Étude archivée : lecture seule. » (`parametres/page.tsx:58`).
5. **Statuts incohérents** — « Actif » en badge `secondary` (`imports/page.tsx:114`, `admin/page.tsx:69`) mais « Active » en texte nu (`projets/[projectId]/page.tsx:56`) ; « Avertissement » en badge bricolé `className="bg-warning…"` (`imports/IssuesTable.tsx:41`) ; « Retiré » `outline`.
6. **En-tête confus** — nav sans état courant ; « Console » coincé entre la nav et le sélecteur ; avec ≥ 2 labos le nom du labo apparaît deux fois ; pas de séparation marque / contexte / utilisateur (`AppShell.tsx:31-85`).
7. **Cibles tactiles petites** — 28-32 px (`button.tsx:24-26`) ; boutons de ligne `sm` 28 px (Retirer, Problèmes, Détails) : limite pour une tablette de paillasse.
8. **Tableaux peu lisibles** — en-têtes du même poids/couleur que les cellules, liens de 1re colonne tous soulignés (`projets/page.tsx:51`, `projets/[projectId]/page.tsx:50`), codes et adresses en police proportionnelle (`IssuesTable.tsx:140`, `admin/page.tsx:53`), dates non tabulaires.
9. **Assistant d'import** — étapes = pastilles bordées, l'étape courante n'a qu'une bordure primaire, aucune marque « faite » (`imports/ImportWizard.tsx:259-273`) ; champ fichier natif brut (l.290).
10. **Graphiques** — info-bulle blanche codée par Recharts, `chart-2`/`chart-5` gris quasi identiques, info-bulle du nuage affiche « polymerIndex: 2 » (l.89-93).
11. **Dialogue de confirmation** — bouton de confirmation toujours `default` même pour Suspendre / Retirer / Archiver (`ConfirmDialog.tsx:89`).
12. **Pages hors coque** — `(app)/error.tsx`, `(app)/not-found.tsx` et `(app)/loading.tsx` (l.3) s'affichent collées au bord, sans marge ni marque ; `global-error.tsx` en style inline.
13. **Connexion / invitation** — formulaire `max-w-sm` en haut de page, sans carte ni logo (`connexion/page.tsx:20`, `invitation/[token]/page.tsx:103`).

---

## 2. Direction

Un instrument de laboratoire, pas une app grand public : fond gris très clair `#F4F6F7` (la couleur du sol de la marque), surfaces blanches pour chaque bloc de données, encre `#0F2A3D` pour le texte, **sarcelle `#0E7C86` comme seule couleur d'action** (boutons, liens, onglet courant, focus), corail `#E4572E` réservé au logo et à une série de graphique — jamais au texte (3,68:1) ni aux erreurs (rouge distinct `#B42318`). Densité « tableur soigné » : lignes de 40 px, cibles de 36 px, chiffres tabulaires alignés à droite, Space Grotesk seulement pour la marque et les titres h1/h2, Geist pour tout le reste. L'ambre ne sert qu'au signal « SIMULÉ » et aux avertissements. Largeur utile 1280 px, marges 24 px : lisible sur tablette paysage (1024) et portrait (768), le téléphone n'est pas visé.

---

## 3. Jetons (`app/globals.css`)

Remplacer les blocs `:root` (l.53-88) et `.dark` (l.90-124). Les valeurs hexadécimales sont acceptées par Tailwind 4 (les modificateurs `/80` passent par `color-mix`). Ajouter dans `@theme inline` : `--color-brand-ink`, `--color-brand-teal`, `--color-brand-coral`, `--color-brand-ground`, `--color-brand-teal-bright`, `--color-brand-coral-bright` (chacun `var(--brand-…)`), `--font-display: var(--font-space-grotesk);`, et remplacer l.12 par `--font-heading: var(--font-space-grotesk);` (même schéma que `--font-sans: var(--font-geist-sans)` ; ne pas nommer la variable next/font `--font-display`, sinon référence circulaire).

```css
:root {
  --radius: 0.5rem;                 /* 8 px : plus « instrument » que 10 px */
  --background: #F4F6F7;  --foreground: #0F2A3D;
  --card: #FFFFFF;        --card-foreground: #0F2A3D;
  --popover: #FFFFFF;     --popover-foreground: #0F2A3D;
  --primary: #0E7C86;     --primary-foreground: #FFFFFF;
  --secondary: #E8EEF0;   --secondary-foreground: #0F2A3D;
  --muted: #E8EEF0;       --muted-foreground: #4F6473;
  --accent: #E2F1F2;      --accent-foreground: #0B5F67;
  --destructive: #B42318;
  --warning: #F5B941;     --warning-foreground: #4A2E00;
  --border: #D3DCE0;      --input: #7D8F9B;   --ring: #0E7C86;
  --chart-1: #0E7C86;  /* sarcelle   L* 47 */
  --chart-2: #E4572E;  /* corail     L* 56 */
  --chart-3: #0F2A3D;  /* encre      L* 16 */
  --chart-4: #E3B23C;  /* or         L* 75 */
  --chart-5: #8FD3DC;  /* sarcelle clair L* 81 */
  --brand-ink: #0F2A3D; --brand-teal: #0E7C86; --brand-coral: #E4572E;
  --brand-ground: #F4F6F7; --brand-teal-bright: #5CC8CF; --brand-coral-bright: #F07A57;
  --sidebar: #FFFFFF; --sidebar-foreground: #0F2A3D; --sidebar-primary: #0E7C86;
  --sidebar-primary-foreground: #FFFFFF; --sidebar-accent: #E2F1F2;
  --sidebar-accent-foreground: #0B5F67; --sidebar-border: #D3DCE0; --sidebar-ring: #0E7C86;
}
.dark {   /* conservé pour cohérence ; aucun sélecteur de thème dans cette passe */
  --background: #0B1D2A;  --foreground: #E6EEF2;
  --card: #11283A;        --card-foreground: #E6EEF2;
  --popover: #11283A;     --popover-foreground: #E6EEF2;
  --primary: #5CC8CF;     --primary-foreground: #0B1D2A;
  --secondary: #1A3347;   --secondary-foreground: #E6EEF2;
  --muted: #1A3347;       --muted-foreground: #9FB3C1;
  --accent: #123F47;      --accent-foreground: #8FE0E6;
  --destructive: #FF8A80;
  --warning: #E9B04A;     --warning-foreground: #2B1A00;
  --border: oklch(1 0 0 / 12%); --input: #5D7A8C; --ring: #5CC8CF;
  --chart-1: #5CC8CF; --chart-2: #F07A57; --chart-3: #E6EEF2; --chart-4: #F2C14E; --chart-5: #1F7F88;
  /* --sidebar-* : mêmes valeurs que card / primary / accent ci-dessus */
}
```

**Contrastes mesurés (WCAG 2.x)** — texte ≥ 4,5:1 partout :

| Paire (clair) | Ratio | Paire (sombre) | Ratio |
|---|---|---|---|
| foreground / background | 13,65 | foreground / background | 14,61 |
| foreground / card | 14,80 | foreground / card | 12,88 |
| primary-foreground / primary | 4,95 | primary-foreground / primary | 8,68 |
| primary (lien) / card · / background | 4,95 · 4,56 | primary / card | 7,65 |
| muted-foreground / background · card · muted | 5,69 · 6,17 · 5,27 | muted-fg / bg · card · muted | 7,92 · 6,98 · 6,03 |
| accent-foreground / accent | 6,36 | accent-fg / accent | 7,64 |
| destructive / card · / teinte `#FDECEA` | 6,57 · 5,75 | destructive / background | 7,52 |
| warning-foreground / warning | 7,07 | warning-fg / warning | 8,62 |
| input (bordure de champ) / card | 3,35 (≥ 3:1 composant) | input / card | 3,33 |

Interdits : texte sarcelle sur `--muted` (4,22) ; texte corail sur clair (3,68) ; texte sarcelle sur `--accent` (4,26) → utiliser `accent-foreground`.

**Graphiques** : ordre choisi pour que les 3 premières séries (les plus fréquentes) aient ≥ 3:1 sur la carte (4,95 / 3,68 / 14,80). Écart de clarté L* 16 → 81. ΔE minimal entre deux séries, simulé : vision normale 34, deutéranopie 19 (corail~or), protanopie 33, tritanopie 32 (l'actuel : 24 / 19 / 24 / 22, avec deux gris). Séries 4-5 (1,96 et 1,68:1) : contour obligatoire `stroke="var(--foreground)" strokeOpacity={0.35}`. Dans le nuage de points, la couleur est **redondante** avec la position en x (un polymère = une colonne) : aucune information portée par la couleur seule.

**Polices** (`app/layout.tsx`) :
```ts
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
const display = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
// <html className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}>
```
Space Grotesk : mot-symbole (500 « Micro », 700 « Trace ») et h1/h2 (600) via `font-heading`. **Jamais pour les nombres** (chiffres non tabulaires, « 1 » ambigu). Corps : Geist Sans (déjà chargé, 400/500/600). Codes moteur, slugs, empreintes : Geist Mono `font-mono text-xs`. Le sous-ensemble `latin` couvre é, è, à, ç, œ, «».

---

## 4. Composants

| Fichier | Changement (classes / valeurs) |
|---|---|
| `ui/button.tsx:24-26` | `default` → `h-9 gap-1.5 px-3` ; `sm` → `h-8 px-2.5 text-[0.8125rem]` ; `lg` → `h-10 px-4` ; `icon` → `size-9`. `destructive` inchangé (texte `#B42318` sur teinte 10 % ≈ 5,8:1). Ajouter `shadow-xs` à `default`. |
| `ui/input.tsx:10`, `ui/select.tsx:46` | `h-8` → `h-9`, `bg-card` (au lieu de `bg-transparent`). Select `data-[size=default]:h-9`, `sm:h-8`. Champ fichier : `file:mr-3 file:h-7 file:rounded-md file:bg-secondary file:px-2.5`. |
| `ui/table.tsx` | Conteneur (l.10) : `relative w-full overflow-x-auto rounded-lg border bg-card`. `<table>` : ajouter `tabular-nums`. `TableHeader` : `bg-muted/60 [&_tr]:border-b`. `TableHead` (l.72) : `h-9 px-3 text-xs font-semibold text-muted-foreground` — **pas de `uppercase`** (Chromium l'applique au nom accessible). `TableCell` (l.85) : `px-3 py-2`. `TableRow` : `hover:bg-accent/40`. |
| `ui/badge.tsx` | Rayon `rounded-md` (au lieu de `rounded-4xl`), `h-5 px-1.5`. Nouvelles variantes : `positive: "bg-accent text-accent-foreground"`, `warning: "bg-warning text-warning-foreground"`, `neutral: "bg-secondary text-muted-foreground"`. Icônes lucide `size-3` `aria-hidden` permises (lucide les masque par défaut). |
| `ui/alert.tsx` | Base : `px-3 py-2.5 gap-x-2.5` ; variantes : `info: "border-primary/25 bg-accent text-accent-foreground *:data-[slot=alert-description]:text-accent-foreground"`, `warning: "border-warning bg-warning/15 text-foreground *:data-[slot=alert-description]:text-foreground"`, `destructive: "border-destructive/30 bg-destructive/5 text-destructive"`. Icône en premier enfant : `Info`, `TriangleAlert`, `OctagonAlert` (lucide, 16 px). `role="alert"` **inchangé**. |
| `ui/card.tsx` | `ring-1 ring-foreground/10` → `border shadow-xs` ; `rounded-xl` conservé. |
| `ui/sonner.tsx:8` | Forcer `theme="light"` tant qu'aucun fournisseur de thème n'existe. |
| **Nouveau** `app/Section.tsx` | `({ title, description?, actions?, children })` → `<section className="space-y-4 rounded-xl border bg-card p-5 shadow-xs">` + en-tête `flex items-start justify-between gap-4` ; `<h2 className="font-heading text-lg font-semibold">` ; description `text-sm text-muted-foreground`. Remplace les `<section className="space-y-3"><h2 className="text-lg font-semibold">` de toutes les pages (mêmes textes, même niveau h2). |
| `app/PageHeader.tsx:15` | Conteneur `flex flex-wrap items-end justify-between gap-4 pb-1` ; h1 `font-heading text-2xl font-semibold tracking-tight text-foreground` (24/32 px) ; sous-titre `mt-1 text-sm text-muted-foreground`. Prop `subtitle` élargie à `ReactNode` (optionnel, voir §6). |
| `app/EmptyState.tsx:13` | `rounded-xl border border-dashed bg-card/60 px-6 py-10` ; prop `icon?: LucideIcon` rendue `size-6 text-muted-foreground` `aria-hidden` ; titre `text-sm font-medium` ; description `max-w-prose`. Le titre reste un `<p>`. |
| `app/DataNatureBanner.tsx:18` | Simulé : **garder** `bg-warning text-warning-foreground` sur la racine (test) → `flex items-center gap-2.5 rounded-lg border border-warning bg-warning px-4 py-2.5 text-sm text-warning-foreground` + icône `FlaskConical` `aria-hidden`. Autres : `border bg-card` (au lieu de `bg-muted`), badge `positive` (publiées) / `neutral` (laboratoire). Pas de `role="alert"`, pas de bouton, pas d'enveloppe autour de la racine. |
| `app/ConfirmDialog.tsx:89` | Prop `confirmVariant?: "default" \| "destructive"` (défaut `default`) ; passée `destructive` par Suspendre, Retirer (membre, import), Révoquer, Archiver, Supprimer la limite. Libellés inchangés. |
| `app/ActionForm.tsx:51` | Prop `columns?: 1 \| 2` : à 2, les champs sont enveloppés dans `<div className="grid gap-4 sm:grid-cols-2">` (les `input hidden` ne prennent pas de case) ; `FormError` et bouton restent dessous. `className` par défaut `max-w-3xl` pour 2 colonnes. |
| `app/FormField.tsx` | `space-y-1.5` ; erreur `text-xs text-destructive`. Prop `className` pour `sm:col-span-2`. |
| `app/StudyTabs.tsx:18,27` | Nav `sticky top-14 z-20 -mx-6 flex gap-0 border-b bg-background/95 px-6 backdrop-blur`. Lien `inline-flex h-10 items-center px-4 -mb-px border-b-2 border-transparent text-sm font-medium text-muted-foreground hover:border-border hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground`. Liens, `aria-current="page"` et libellés inchangés. |
| Étapes de l'assistant (`ImportWizard.tsx:259-273`) | `ol` : `grid grid-cols-4 gap-2`. `li` : `flex h-9 items-center rounded-md border px-3 text-sm` ; courant `border-primary bg-accent font-medium text-accent-foreground` ; fait (`index+1 < step`) `border-transparent bg-secondary text-foreground` + `Check` `aria-hidden` **après** le texte ; à venir `text-muted-foreground`. **Le texte « 1. Dépôt » reste un seul nœud dans le `li`** qui porte `aria-current="step"`. |
| Graphiques (`resultats/ResultCharts.tsx`) | Conteneur `rounded-lg border bg-card p-4 text-xs` (la taille des graduations hérite). `CartesianGrid stroke="var(--border)" strokeDasharray="3 3"`. `Tooltip` : `contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--popover-foreground)" }}`, `cursor={{ fill: "var(--muted)" }}`. Barres : `radius={[4, 4, 0, 0]} maxBarSize={48}`. Points : `fillOpacity={0.75}` + contour (voir §3). Axe x : si > 6 polymères, `interval={0} angle={-30} textAnchor="end" height={56}`. Uniquement des `var(--…)` : le test refuse `#hex`, `rgb()`, `hsl()`, `oklch()` dans ce fichier et `page.tsx`. |

**Statuts → badges** (texte inchangé) : Actif (labo, import) `positive` · Suspendu `destructive` · Retiré `outline` · Archivée `neutral` · Active (étude) `positive` · Erreur `destructive` + `OctagonAlert` · Avertissement `warning` + `TriangleAlert` · Info `neutral`.

**Liens dans les tableaux** : `font-medium text-primary underline-offset-4 hover:underline` (4,95:1, distinct par graisse et couleur). Codes moteur, slugs, empreintes : `font-mono text-xs`.

---

## 5. Logo

**Composant** `components/app/Logo.tsx` (serveur, sans état) :
```ts
type LogoProps = {
  variant?: "mark" | "full";   // full = goutte + « MicroTrace » + « Studio »
  tone?: "light" | "dark";     // light = sur fond clair (défaut)
  size?: number;               // hauteur de la goutte en px (défaut 28)
  className?: string;
};
```
- SVG `viewBox="0 0 120 120"`, `aria-hidden="true"`, `focusable="false"`, couleurs par jetons uniquement : `light` → contour `var(--brand-ink)`, trace `var(--brand-coral)`, éclats `var(--brand-teal)` ; `dark` → contour `var(--brand-ground)`, trace `var(--brand-coral-bright)`, éclats `var(--brand-teal-bright)`.
- En dessous de 24 px : `stroke-width` 6 → 8 (contour) et 5 → 6,5 (trace), et seul le plus grand éclat (`45,50 52,47 54,54 47,57`) est gardé.
- Mot-symbole `full` : `<span className="font-display text-lg leading-none tracking-tight"><span className="font-medium">Micro</span><span className="font-bold text-primary">Trace</span></span><span className="ml-1.5 text-sm font-normal text-muted-foreground">Studio</span>` (ton sombre : `text-brand-teal-bright`, « Micro » `text-brand-ground`). Nom accessible résultant du lien : « MicroTrace Studio » (spans en ligne, sans espace entre Micro et Trace). Si le test le refuse, mettre `aria-label="MicroTrace Studio"` sur le `Link`.

**Emplacements et tailles**
| Lieu | Variante | Taille |
|---|---|---|
| En-tête (`AppShell`) | `full`, `light` | goutte 28 px, mot-symbole 18 px |
| Connexion / invitation | `full`, `light`, centré au-dessus de la carte | goutte 48 px, mot-symbole 24 px (`text-2xl`) |
| `global-error.tsx` | aucun (doit rester sans dépendance) | — |
| `app/icon.svg` (favicon) | goutte seule, version < 24 px, hex en dur autorisé (fichier statique, pas une page) | viewBox 120, rendu 16/32 px |
| `app/apple-icon.png` | goutte sur fond `#F4F6F7`, marge 20 % | 180 × 180 |
| Supprimer `app/favicon.ico` (sinon le navigateur le préfère à `icon.svg`) | | |

---

## 6. Tâches page par page (une tâche = un commit ; `npm test` + `npm run lint` après chacune)

**Ordre** : T1 → T3 sont des prérequis ; T4 → T15 indépendantes.

- **T1 Jetons et polices** — `globals.css`, `layout.tsx`, `ui/sonner.tsx`. Aucun texte modifié.
- **T2 Primitives** — `ui/button|input|select|table|badge|alert|card`, `app/Section` (nouveau), `PageHeader`, `EmptyState`, `DataNatureBanner`, `ConfirmDialog` (`confirmVariant`), `ActionForm` (`columns`), `FormField`, `IssuesTable` (badges `warning`/`destructive`, code `font-mono`).
- **T3 Logo et icônes** — `app/Logo.tsx`, `app/icon.svg`, `app/apple-icon.png`, suppression de `app/favicon.ico`.
- **T4 Coque** — `AppShell.tsx` : `header sticky top-0 z-30 border-b bg-card` ; rangée `mx-auto flex h-14 max-w-7xl items-center gap-4 px-6` : `Link`+`Logo` · séparateur `h-6 w-px bg-border` · nom du labo `text-sm font-semibold` (masqué quand le sélecteur est affiché, pour ne pas le dupliquer) · `nav "Navigation principale"` (Projets, Membres) · `ml-auto` : Console (`ghost sm`), sélecteur `nav "Laboratoires"` en contrôle segmenté (`inline-flex rounded-lg border bg-muted p-0.5` ; lien `h-7 rounded-md px-2.5 text-muted-foreground aria-[current=true]:bg-card aria-[current=true]:text-foreground aria-[current=true]:shadow-xs`), utilisateur `text-muted-foreground`, « Se déconnecter » `outline sm`. `main` : `max-w-7xl space-y-6 px-6 py-8`. État actif de Projets/Membres : petit client `app/NavLink.tsx` (`usePathname`, doit tolérer `null` : les tests de la coque ne simulent pas `next/navigation`).
- **T5 Connexion + invitation** — `main className="grid min-h-screen place-items-center p-6"` > `div w-full max-w-sm space-y-6` > Logo 48 px > carte `rounded-xl border bg-card p-6 shadow-xs space-y-4` contenant `PageHeader` + alertes (`info` pour « Compte créé… », « Un compte existe déjà… », « Vous êtes déjà membre… » ; `destructive` pour les deux refus) + formulaire. Liens « Se connecter » / « Ouvrir le laboratoire » en `Button asChild variant="outline"` (nom inchangé).
- **T6 Projets** — 3 sections en `Section` ; table liens `text-primary` ; « Nouveau projet » et « Études d'exemple » côte à côte `grid gap-6 lg:grid-cols-2` ; boutons d'exemple pleine largeur dans des sous-cartes `rounded-lg border p-4`.
- **T7 Projet** — `Section` ; colonne Statut : badge `positive` « Active » / `neutral` « Archivée » (texte inchangé) ; `CreateStudyForm` `columns={2}`.
- **T8 Membres** — `Section` ×3 ; « Retirer » / « Révoquer » `confirmVariant="destructive"` ; `InviteForm columns={2}` ; `InvitationLink` : `rounded-lg border bg-accent/50 p-4`, champ `font-mono text-xs`.
- **T9 Console** — `Section` ; slug `font-mono text-xs` ; Actif `positive` / Suspendu `destructive` ; compteurs déjà à droite ; formulaires `columns={2}`.
- **T10 En-tête d'étude** — `etudes/[studyId]/layout.tsx` : `PageHeader` + badge `neutral` « Archivée » ; bandeau ; `StudyTabs` collants. Aucun bouton ni champ ajouté ici.
- **T11 Paramètres** — `Section` locale (l.29) remplacée par `app/Section` ; alerte archivée `info` ; dans chaque section : tableau, puis formulaire d'ajout dans `rounded-lg border border-dashed p-4` sous un `h3 text-sm font-semibold` **optionnel** (nouveau texte → à ne pas ajouter si l'on veut zéro texte nouveau) ; `AddLimitForm`, `AddQcForm`, `ReferenceForm`, `AddMethodForm` en `columns={2}` ; `Supprimer`/`Archiver` `confirmVariant="destructive"` ; `dl` lecture seule `grid-cols-[12rem_1fr] gap-y-2` (garder `dt` immédiatement suivi de `dd`).
- **T12 Imports** — `Section` ; alerte moteur `destructive` ; assistant : étapes (§4), aperçu `max-h-96 overflow-auto`, navigation Précédent/Suivant `flex justify-between border-t pt-4` ; tableau : nom de fichier `font-medium`, statut badges, actions `justify-end`. `MappingForm` : chaque champ dans `rounded-lg border p-3` au lieu d'un `fieldset` nu (garder `fieldset`/`legend`).
- **T13 Résultats** — alertes « règles différentes » et « paramètres changés » → `warning` ; « Règle d'agrégation » en `Section` avec texte `text-sm` ; chaque fréquence : graphique + tableau dans la même carte ; « Voir les données » : `summary` `text-sm font-medium text-primary` ; graphiques (§4). Optionnel (contenu d'info-bulle modifié, à valider) : afficher le nom du polymère au lieu de `polymerIndex`.
- **T14 Rapport** — 3 `Section` ; « Rapport HTML » en `variant="default"`, les autres `outline` ; icônes `Download` `aria-hidden` (nom inchangé) ; liste du contenu `marker:text-primary`.
- **T15 Journal + pages système** — Journal en `Section` ; `(app)/error.tsx`, `(app)/not-found.tsx` : envelopper dans `div mx-auto max-w-xl py-16` (pas de `main` : `labo/[labSlug]/not-found.tsx` les rend déjà dans le `main` de la coque) ; `(app)/loading.tsx` : `mx-auto max-w-7xl px-6 py-8` + `Loader2` `animate-spin aria-hidden`, `role="status"` gardé ; `EmptyState` avec icônes (`FolderOpen`, `FileUp`, `SearchX`, `CircleAlert`).

**Texte visible** : aucun changement obligatoire. Optionnels, à faire valider : (a) sous-titre « Projet : X » rendu en lien vers le projet (nouveau lien) ; (b) `h3` « Ajouter… » au-dessus des formulaires de Paramètres ; (c) info-bulle du nuage avec le nom du polymère.

### Risques de tests (aucun test d'instantané ; Playwright sans capture)
- `components/app/__tests__/DataNatureBanner.test.tsx:21,25` — `toHaveClass("bg-warning","text-warning-foreground")` sur `container.firstElementChild` : ne pas envelopper la racine, ne pas retirer ces classes.
- `imports/__tests__/ImportWizard.test.tsx:85,302` — `getByText("1. Dépôt").closest("li")` : libellé d'étape = un seul nœud texte dans le `li` porteur de `aria-current`.
- `parametres/__tests__/page.test.tsx:89,136-139` — `document.querySelectorAll("…button")` sur **toute la page de l'étude** (layout compris) : aucun bouton ni champ ajouté dans l'en-tête, les onglets ou le bandeau ; l.86 `nextElementSibling` du `dt`.
- `resultats/__tests__/page.test.tsx:201` — un seul `role="alert"` ; l.229-233 — regex anti-couleur sur `page.tsx` et `ResultCharts.tsx` ; tables nommées par `TableCaption sr-only` (l.110-143) à garder.
- `journal/__tests__/page.test.tsx:76,82` — pas de `<b>` dans le dialogue ; « Objet » doit rester la 4e cellule.
- `AppShell.test.tsx:37,47` — lien nommé exactement « MicroTrace Studio » ; l.26 `getByText("Labo Alpha")` unique avec un labo ; l.52-58 `aria-current="true"` (pas `"page"`) dans le sélecteur. `labo/[labSlug]/__tests__/layout.test.tsx:38` idem (« Labo alpha »).
- `admin/__tests__/page.test.tsx:57,62`, `imports/__tests__/page.test.tsx:98-102` — « Actif », « Suspendu », « Retiré » uniques ; en-têtes « Lignes », « Mesures ».
- e2e : `import-errors.spec.ts:16,30` — `getByLabel("Fichier à importer")` (garder l'`input type=file` étiqueté, pas de zone de dépôt qui le masque) et `getByRole("cell",{name:"Erreur"})` (badge sans autre texte) ; `examples.spec.ts:56,78,82` — liens « Résultats », « Rapport », « Rapport HTML » : Playwright compare par sous-chaîne, **aucun nouveau lien contenant « Rapport » ou « Résultats »** sur les pages d'étude ; `isolation.spec.ts:18-21`.
- En-têtes de colonnes : pas de `uppercase` (noms accessibles sous Chromium).

---

## 7. À ne pas changer
- La liste de contrôle de C2 : thème dans `globals.css` seulement, aucune couleur ni taille en dur dans les pages ; un seul `h1` (dans `PageHeader`), `h2` pour sections, `h3` pour graphiques ; `FormError` `role="alert"` ; `useActionState` + bouton désactivé pendant l'envoi ; `<Label htmlFor>` ; nombres à droite ; `EmptyState` pour tout état vide ; `loading/error/not-found` en français.
- Les textes : « SIMULÉ — données fictives », « Prototype de recherche, pas un dispositif médical » (partout où il est), messages moteur fixes, libellés de boutons et d'attente (« Création… », « Envoi en cours… »).
- Les onglets d'étude en **liens** `aria-current="page"` ; le sélecteur de labos en **liens** visibles dès 2 labos (pas de menu déroulant : un `DropdownMenu` Radix ne rend pas ses liens fermé → tests cassés).
- Les tableaux de données équivalents sous chaque graphique, `role="img"` + `aria-label` des graphiques, couleurs uniquement `var(--chart-n)`.
- Le format français (`NumberFr`, `DateTimeFr`, fuseau Europe/Paris), l'ordre des colonnes, `fieldset disabled` des études archivées.
- Pas de sélecteur de thème sombre, pas de nouvelle dépendance (lucide, Radix, Recharts suffisent), pas d'animation au-delà de `tw-animate-css` existant.

## 8. Décisions du contrôleur (2026-10-30)

Le fondateur a délégué le jugement UI/UX (« améliorez la visuelle de l'application en tant qu'expert en design UI/UX ») et a choisi le logo A « Goutte tracée ».

- **R-D-1** : les trois changements de texte optionnels du §6 sont acceptés : (a) « Projet : X » devient un lien vers le projet (son nom ne doit contenir ni « Rapport » ni « Résultats ») ; (b) `h3` « Ajouter une méthode », « Ajouter une limite », « Ajouter un contrôle qualité », « Modifier la référence » au-dessus des formulaires de Paramètres (adapter au libellé réel de chaque formulaire) ; (c) l'info-bulle du nuage de points affiche le libellé du polymère (`polymerLabel`) et la valeur avec son unité, jamais `polymerIndex`.
- **R-D-2** : les 15 tâches du §6 sont regroupées en 4 tâches (plan `docs/superpowers/plans/2026-10-30-passe-design.md`).
- **R-D-3** : `app/apple-icon.png` est produit sans nouvelle dépendance, par `app/apple-icon.tsx` (`ImageResponse` de `next/og`, déjà fourni par Next), 180 × 180.
- **R-D-4** : la page de connexion garde le texte « Prototype de recherche, pas un dispositif médical » (les tests de bout en bout l'attendent pour savoir que l'application est prête).
- **R-D-5** : depuis l'audit, la vague de corrections de C4 a ajouté sur la page Rapport une `Alert` pilotée par `?erreur=` et une variante `engine` de `NumberFr` : les garder ; l'alerte d'erreur de téléchargement prend la variante `destructive`.
