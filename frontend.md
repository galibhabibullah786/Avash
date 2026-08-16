# Frontend Coding Standards

## Scope
This document defines the frontend standards for the React + Vite SPA in this project. All frontend work should follow these rules unless a documented exception is approved.

## Core Stack
- **Framework:** React 18 + Vite
- **Routing:** React Router
- **Styling:** Tailwind 
- **State:** React Query for server state, local component state for UI-only state
- **Data access:** Use the shared API client and typed DTOs from the monorepo packages

## Architecture Rules
- Keep the app as a client-rendered SPA with no server-side rendering
- Put feature-specific UI in feature folders under the web app
- Keep presentational components small and reusable
- Prefer composition over large monolithic components
- Reuse shared UI patterns instead of duplicating layout code

## Code Quality Rules
- Use TypeScript for all new frontend code
- Prefer explicit props and clear component names
- Keep components focused on one responsibility
- Avoid inline business logic inside JSX where it becomes hard to read
- Use optional chaining for all external or untrusted data access

## Styling Rules
- Use consistent spacing, typography, and color tokens across the app
- Favor readable, accessible contrast ratios
- Keep layouts responsive for mobile and desktop
- Avoid ad-hoc styling that makes future changes difficult
- Use a calm medical-alert visual language: clean white cards, soft borders, and restrained gradients

## Visual Design System
- **Foreground / text:** `#0F172A`
- **Muted text:** `#475569`
- **Primary background:** `#F8FAFC`
- **Card background:** `#FFFFFF`
- **Primary accent:** `#0F766E`
- **Secondary accent:** `#2563EB`
- **Success:** `#16A34A`
- **Warning:** `#EAB308`
- **Danger / high risk:** `#DC2626`
- **Border / dividers:** `#E2E8F0`
- **Font family:** `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **Heading scale:** `2rem` to `2.4rem` for main page titles, `1.4rem` to `1.8rem` for section headings
- **Body text:** `1rem`
- **Helper / metadata text:** `0.875rem`
- **Label / microcopy:** `0.75rem`
- **Radius:** `0.75rem` to `1rem`
- **Shadow:** soft elevation with `0 10px 30px rgba(15, 23, 42, 0.06)`



## Interaction and Motion Rules
- Use subtle motion only: fade-in, hover lift, and smooth transitions
- Prefer lightweight transitions like `transition: all 0.2s ease`
- Avoid flashy, distracting, or overly animated interfaces
- Keep interactive feedback clear and accessible

## Data Handling Rules
- Never expose secrets in the frontend bundle
- Only use public environment variables prefixed with VITE_
- Handle API loading, error, and empty states explicitly
- Treat all fetch and JSON parsing results as potentially undefined or malformed

## Accessibility Rules
- Use semantic HTML where possible
- Provide labels for form fields and interactive controls
- Ensure keyboard navigation works for links, buttons, and menus
- Avoid relying on color alone to communicate meaning

## Performance Rules
- Keep bundle size in mind for every new dependency
- Lazy-load routes or heavy feature modules when practical
- Avoid unnecessary re-renders and repeated requests

## Documentation Rule
- Any frontend change that affects behavior must be documented in the project docs and manually tested before completion


## FrontendPageGuidance

# Frontend Page Build Guidance

## Purpose
This document is a documentation-only guide for how the frontend pages should be structured and what each page must communicate to users. It is intentionally isolated from runtime implementation so product and UX requirements remain explicit.

This page should be read alongside the frontend standards in [docs/standards/frontend.md](docs/standards/frontend.md) so implementation choices, page-level UX requirements, and repository-wide design expectations stay aligned.

## Core Product Pages

### 1. Risk Map Page
**Goal:** Show regional dengue outbreak risk for the next 2–4 weeks.

**Required UI behavior**
- Display an interactive map with geospatial region overlays.
- Show risk intensity using a clear legend (low, moderate, high, severe).
- Provide a quick explanation for the score, such as weather and historical patterns.
- Keep map tiles and markers lightweight and mobile-friendly.
- Use accessible labels for all map controls and legend items.

**Required supporting elements**
- A top summary card showing region name, current risk band, and confidence/updated timestamp.
- A secondary panel explaining which factors contributed to the score.

### 2. Public Reporting Portal
**Goal:** Allow citizens to report mosquito breeding sites.

**Required UI behavior**
- Provide a simple form for location, description, and photo evidence if available.
- Guide the user through a short, clear reporting flow.
- Show validation messages for incomplete or invalid submissions.
- Indicate the report was submitted successfully and what happens next.

**Required supporting elements**
- Map pin or location picker flow.
- Clear privacy-safe wording for citizen submissions.
- A status banner showing whether the report is pending, accepted, or routed onward.



### 3. Symptom Checker Page
**Goal:** Offer a guided symptom triage flow.

**Required UI behavior**
- Present a deterministic decision flow with clear yes/no or multiple-choice inputs.
- Avoid ambiguous medical language.
- Show a concise educational message after the result.
- Keep the interaction short and easy to complete on mobile.

**Required supporting elements**
- A clear “safe next step” message if symptoms are mild.
- A strong recommendation to seek urgent care for severe symptoms.

### 4. Weather Insights Page
**Goal:** Show meteorological context related to outbreak risk.

**Required UI behavior**
- Surface temperature, humidity, and rainfall information in a readable format.
- Tie weather values back to outbreak-risk interpretation.
- Show recent changes or current state clearly.

**Required supporting elements**
- Trend-style cards or compact indicators.
- Explanatory text for why weather matters to dengue risk.

## PWA and Offline Expectations

### Progressive Web App requirements
- The frontend should feel installable and mobile-friendly.
- The app should cache the critical experience for returning users.
- Offline support should preserve the last known useful state, especially for risk information and model assets where practical.

### UX expectation
- Users should be able to reopen the app quickly and access cached content without a fresh network request.
- UI states should clearly show whether content is live, cached, or stale.

## Frontend UX Rules for the Product Objective

### Explainable AI support
- The UI should be able to show a human-readable explanation for risk predictions.
- Risk logic should be shown as “why this score is higher/lower,” rather than as a single opaque number.

### Geospatial intelligence support
- Map interactions should prioritize clarity and discoverability.
- Users should be able to understand their current region, nearby hotspots, and the risk level without reading dense technical text.

### Public-sector utility
- The reporting flow must be simple enough for a general citizen to complete quickly.
- The interface should reduce friction for submitting a report to municipal stakeholders.

## Page Build Checklist

Before marking a page complete, confirm that it satisfies the following:
- The page communicates its purpose in one glance.
- The primary action is obvious.
- The page is readable on mobile and desktop.
- The page uses accessible labels, contrast, and keyboard-friendly interaction.
- The page clearly shows loading, error, and empty states.
- The page respects the visual design system in this repository.
