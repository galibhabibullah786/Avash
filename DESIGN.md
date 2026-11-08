---
name: Avash (আভাস)
description: The Civic Sentinel — Dengue outbreak prediction, citizen reporting, and emergency resources for Bangladesh.
colors:
  primary: "#0f766e"
  primary-hover: "#0d655e"
  primary-light: "#d8f7ec"
  primary-dark: "#14b8a6"
  warning: "#f59e0b"
  warning-light: "#fef3c7"
  danger: "#ef4444"
  danger-light: "#fee2e2"
  safe: "#10b981"
  safe-light: "#d1fae5"
  neutral-bg: "#f8fafc"
  neutral-surface: "#ffffff"
  neutral-surface-subtle: "#f1f5f9"
  neutral-text: "#0f172a"
  neutral-muted: "#64748b"
  neutral-border: "#e2e8f0"
  risk-low: "#2e7d5b"
  risk-moderate: "#d9a441"
  risk-high: "#c9702e"
  risk-severe: "#c94a4a"
typography:
  display:
    fontFamily: "Nirmala UI, Noto Sans Bengali, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 5.5vw, 4.2rem)"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "normal"
  headline:
    fontFamily: "Nirmala UI, Noto Sans Bengali, Segoe UI, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Nirmala UI, Noto Sans Bengali, Segoe UI, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Nirmala UI, Noto Sans Bengali, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Nirmala UI, Noto Sans Bengali, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  card: "13px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  badge-safe:
    backgroundColor: "{colors.risk-low}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
  badge-warning:
    backgroundColor: "{colors.risk-moderate}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
  badge-danger:
    backgroundColor: "{colors.risk-severe}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
  card-base:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.card}"
    padding: "20px 24px"
---

# Design System: Avash (আভাস)

## Overview

**Creative North Star: "The Civic Sentinel" (বাতিঘর ও পূর্বাভাস)**

Avash balances authoritative public health clarity with compassionate civic vigilance. Designed for the high-stakes reality of seasonal dengue outbreaks in Bangladesh, the interface acts as a calm, trustworthy beacon in times of community vulnerability. It rejects both panic-inducing alarms and emotionless, sterile clinical grids. The visual world blends biological vitality with modern civic technology: deep botanical teals, living leaf emeralds, and translucent surfaces that feel organic, protective, and human.

The system communicates respect for the user's situation through visual restraint and tactile immediacy. Rather than burying essential facts in dense hospital EMR spreadsheets or flashy consumer graphics, Avash brings actionable truths forward: predictive outbreak horizons, live hospital bed tallies, and community breeding site reports. Translucency and ambient light create a breathable atmosphere, keeping distressed citizens calm and focused when minutes matter.

**Key Characteristics:**
- **Organic Civic Translucency:** Frosted glass panels (`backdrop-filter: blur(8px)`) with hairline borders elevate content gently over the ambient canvas.
- **Biophilic Public Health Palette:** Deep medicinal teals and restorative emeralds anchor interface authority and emotional calm.
- **Tactile Responsiveness:** Active press states (`transform: scale(0.98)`) and high-contrast focus rings ensure certainty under emergency mobile conditions.
- **Dual-Layer Information Architecture:** Large, friendly touch surfaces for citizens on mobile devices; dense, modular telemetry grids for hospital and municipal operators.
- **Anti-Reference Rejection:** No sterile EMR spreadsheets, no screaming alarmist sirens, and no corporate SaaS card fatigue.

## Colors

The palette is rooted in Bangladesh's natural landscape and rigorous public health heraldry, pairing deep aquatic teals with high-visibility epidemiological indicators.

### Primary
- **Clinical Sentinel Teal** (`#0f766e` / Dark: `#14b8a6`): The primary voice of authority, interactive guidance, and civic trust. Used for primary CTA buttons, active navigation states, brand accents, and prominent map glyphs.
- **Teal Hover / Press** (`#0d655e` / Dark: `#2dd4bf`): State feedback for interactive elements.
- **Mint Aura** (`#d8f7ec` / Dark: `rgba(20, 184, 166, 0.15)`): Gentle ambient glow, selection highlights, and active telemetry indicators.

### Secondary
- **Clear Emerald** (`#10b981` / Dark: `#34d399`): Indicates safe epidemiological zones (Low Risk `< 0.25`), operational hospitals, successful report submissions, and online connectivity.
- **Outbreak Warning Amber** (`#f59e0b` / Dark: `#fbbf24`): Moderate outbreak risk (`0.25 - 0.50`), caution advisories, and pending verification queues.
- **Surge Crimson** (`#ef4444` / Dark: `#f87171`): High/Severe outbreak thresholds (`> 0.50`), critical emergency triage warnings, and depleted blood bank stocks.

### Neutral
- **Slate Canvas** (`#f8fafc` / Dark: `#0b1220`): High-comfort background paper that prevents eye strain during extended reading.
- **Living Surface** (`#ffffff` / Dark: `#131c2e`): Elevated cards, modals, and input containers.
- **Subtle Surface** (`#f1f5f9` / Dark: `#1a253c`): Inset areas, table headers, and secondary panels.
- **Deep Slate Ink** (`#0f172a` / Dark: `#f8fafc`): Primary typographic ink with maximum contrast ratio (>= 12:1 against surface).
- **Muted Slate** (`#64748b` / Dark: `#94a3b8`): Secondary metadata, captions, and helper notes.
- **Hairline Border** (`#e2e8f0` / Dark: `#263048`): Crisp structural division that maintains form boundaries without visual weight.

### PostGIS Risk Presentation Scale
- **Low Risk** (`#2e7d5b`): Range `0.00 – 0.25`, border weight 1px solid.
- **Moderate Risk** (`#d9a441`): Range `0.25 – 0.50`, border weight 2px with dash pattern `6 3`.
- **High Risk** (`#c9702e`): Range `0.50 – 0.75`, border weight 3px with dash pattern `3 2`.
- **Severe Risk** (`#c94a4a`): Range `0.75 – 1.00`, border weight 4px with dash pattern `2 2`.

### Named Rules
**The Signal-to-Noise Rule.** Severity colors (Surge Crimson, Outbreak Amber) are strictly reserved for genuine epidemiological risk, critical health triage, or active errors. Never use red or amber as generic decorative accents.

**The Living Foliage Rule.** Restorative greens and deep medicinal teals anchor the baseline visual world, keeping the app emotionally grounding rather than intimidating.

## Typography

**Display Font:** `Nirmala UI`, `Noto Sans Bengali`, `Segoe UI`, system-ui, sans-serif  
**Body Font:** `Nirmala UI`, `Noto Sans Bengali`, `Segoe UI`, system-ui, sans-serif  
**Tabular/Telemetry Font:** Inherited with `font-variant-numeric: tabular-nums`

**Character:** Humanist, open, and legibly weighted across both Bengali script conjuncts and Latin technical notation. It emphasizes warmth without sacrificing institutional authority.

### Hierarchy
- **Display** (800, `clamp(2.2rem, 5.5vw, 4.2rem)`, 1.25): Hero headers, landing announcements, and primary banner titles.
- **Headline** (700, `2rem` (32px), 1.3, letter-spacing `-0.045em`): Section headings and top-level view landmarks.
- **Title** (700, `1.25rem`–`1.5rem` (20–24px), 1.4): Card headings, modal dialog titles, and feature group dividers.
- **Body** (400, `1rem` (16px), 1.6, max line length `65–75ch`): Primary instructional prose, symptom checker questions, and prevention tips.
- **Label / Eyebrow** (700–800, `0.75rem` (12px), letter-spacing `0.05em`, uppercase): Category headers, timestamp chips, and live status labels.

### Named Rules
**The Tabular Integrity Rule.** All numerical readouts — bed counts, blood units, temperatures, coordinates, case counts, and dates — must use `font-variant-numeric: tabular-nums` to eliminate layout jitter during live updates.

**The Bilingual Parity Rule.** English numerals and Bengali text inside the same container must match baseline alignment and optical weight. Never render oversized Latin numbers next to condensed Bengali script.

## Layout

Avash utilizes a mobile-first, adaptive spatial model designed to function flawlessly in bright sunlight or rain on outdoor handheld devices, while scaling gracefully to multi-panel hospital operations dashboards.

- **Mobile (Tier 1, Width <= 480px):** Single-column stacked flow, sticky bottom-safe touch regions, minimum touch target size of 48px, full-width emergency banners.
- **Tablet (Tier 2, Width 481px–1024px):** Split-view balancing the interactive PostGIS Leaflet map with a collapsible resource drawer.
- **Desktop (Tier 3, Width >= 1025px):** Asymmetric operational grid (`1.65fr 0.75fr`) with pinned map telemetry, side-by-side symptom triage, and modular data tables.
- **Container Max-Width:** `1280px` centered with fluid gutter padding (`clamp(16px, 4vw, 32px)`).
- **Spatial Rhythm:** Fixed 4px grid steps (`4px`, `8px`, `16px`, `24px`, `40px`).

### Named Rules
**The Zero Horizontal Overflow Rule.** The application shell enforces `overflow-x: hidden` globally. Canvases, maps, and tables must reflow, wrap, or horizontally scroll within dedicated child containers; the main window never scrolls horizontally.

**The 48-Pixel Thumb Rule.** Any interactive element on mobile touch screens must provide at least a 48px by 48px effective touch target box, including padding.

## Elevation & Depth

Avash avoids heavy drop shadows, relying instead on tonal layering, gentle glassmorphism, and soft biophilic ambient light.

- **Resting Depth:** Surfaces sit flat or near-flat with crisp hairline borders (`1px solid var(--color-border)`).
- **Translucent Layering:** Floating panels, navigation headers, and drawers utilize frosted acrylic styling (`background: rgba(255, 255, 255, 0.85)` / Dark: `rgba(19, 28, 46, 0.85)` with `backdrop-filter: blur(8px)`).
- **Ambient Accent Glow:** Primary buttons and active warning cards emit a subtle tinted glow rather than harsh black shadows (`box-shadow: 0 8px 20px #0f766e2b`).
- **Focus & State Elevation:** Focused elements render an explicit 2px outline offset by 2px (`outline: 2px solid var(--color-primary); outline-offset: 2px`).

### Shadow Vocabulary
- **Ambient Low** (`box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04)`): Subtle separation for resting cards on white surfaces.
- **Primary Glow** (`box-shadow: 0 8px 20px rgba(15, 118, 110, 0.17)`): Soft colored elevation under primary call-to-action buttons.
- **Floating Overlay** (`box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08)`): Modals, mobile drawer overlays, and hovering map tooltips.

### Named Rules
**The Ambient Living Canvas Rule.** Surfaces use soft organic translucency with subtle natural tints rather than heavy black cast shadows or harsh opaque card barriers.

**The Tactile Confirmation Rule.** All buttons and pressable cards compress on active tap (`transform: scale(0.98)`), providing immediate confirmation before async requests fire.

## Shapes

- **Corner Language:** Organic and gently curved.
  - Controls & Inputs: `8px` (`--radius`)
  - Cards & Containers: `12px`–`13px` (`--radius-lg`)
  - Hero Elements: `24px`
  - Badges & Pills: `999px` (full circular pill)
- **Border Treatment:** Consistent `1px solid var(--color-border)`. Under dark theme, borders remain subtle to prevent wireframe clutter.

### Named Rules
**The Organic Corner Rule.** Reject brutalist 0px sharp corners. Every card, button, and input carries curved radii reflecting natural, biophilic forms.

## Components

### Buttons
- **Primary:** Filled Clinical Sentinel Teal (`#0f766e`), white text, 8px radius, `12px 20px` padding, 600 weight. Emits subtle teal glow (`0 8px 20px #0f766e2b`). Active press scales to `0.98`.
- **Secondary / Quiet:** Transparent background, `1px solid var(--color-border)` or `#b4dcd5`, Clinical Sentinel Teal text. Hover introduces soft tint.
- **Danger:** Filled Surge Crimson (`#ef4444`), white text, 8px radius. Reserved for severe triage acknowledgments or destructive moderation actions.
- **Disabled State:** Opacity `0.6` with `cursor: not-allowed` and no scale transformation.

### Badges & Status Chips
- **Geometry:** Full capsule radius (`999px`), padding `4px 8px`, typography `0.75rem`–`0.85rem` weight 700.
- **Variants:** Mapped to risk bands (`badge--low`, `badge--moderate`, `badge--high`, `badge--severe`) with matching border weights and dash patterns.

### Cards & Panels
- **Container:** Frosted white or deep navy background, `1px solid var(--color-border)`, `13px` radius, padding `20px`–`24px`.
- **Prevention Card:** Features a large stylized index number, biophilic icon, bold title, descriptive copy, and a directional arrow link (`↗`).

### Form Inputs & Fields
- **Geometry:** `1px solid var(--color-border)`, `8px` radius, `8px 12px` padding, font-size `1rem` (to prevent iOS auto-zoom).
- **Focus State:** 2px outline in Clinical Sentinel Teal with 2px offset.
- **Error State:** Border shifts to Surge Crimson (`#ef4444`) accompanied by red helper text below the field.

### Navigation Header
- **Desktop:** Sticky navbar with frosted background (`backdrop-filter: blur(8px)`), brand logo with 27px icon, inline links, theme toggle, and auth button.
- **Mobile:** Sticky compact bar with hamburger button opening a left drawer (`288px` wide, max `85vw`) with backdrop scrim.

### Signature Component: The Risk Map Viewport & Legend
- **Container:** Full-bleed or bordered Leaflet frame over OpenStreetMap raster tiles, featuring PostGIS polygon overlays.
- **Legend:** Floating glass card displaying four risk levels with both color swatches and distinctive border-dash patterns for universal accessibility.

## Do's and Don'ts

### Do:
- **Do** preserve the canonical biophilic public health palette (Teal `#0f766e`, Emerald `#10b981`, Amber `#f59e0b`, Crimson `#ef4444`).
- **Do** ensure all text maintains at least a 4.5:1 contrast ratio against its background (and 3:1 for large display headers).
- **Do** apply `font-variant-numeric: tabular-nums` to every dynamic number, counter, timestamp, and metric.
- **Do** provide non-color indicators (border thickness, dash patterns, text labels) alongside color ramps on risk maps and charts.
- **Do** maintain minimum 48px touch targets on all interactive mobile buttons and links.
- **Do** support light and dark modes through CSS custom properties with smooth 0.2s color transitions.

### Don't:
- **Don't** use Surge Crimson (`#ef4444`) or Outbreak Amber (`#f59e0b`) for decorative flourishes or branding elements.
- **Don't** construct cold, unpadded EMR spreadsheet tables devoid of human warmth or breathing room.
- **Don't** use sharp 0px corners or harsh black drop shadows.
- **Don't** trigger horizontal scrolling (`overflow-x: auto` is only permitted inside localized scroll containers).
- **Don't** render un-memoized map polygon layers or heavy animations that stutter on low-end Android mobile devices.
- **Don't** display raw English error codes to citizens in distress; translate all public notifications and alerts into empathetic Bengali.
