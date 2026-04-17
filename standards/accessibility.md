# Accessibility — Usable by Everyone

> 1 in 4 adults has a disability. Accessibility isn't charity — it's basic professionalism. And it's legally required in EU (EAA 2025) and US (ADA).

## Core principles (WCAG 2.2 AA)

1. **Perceivable** — content is presented in ways users can perceive (text alternatives, captions, color contrast)
2. **Operable** — interface is operable (keyboard, mouse, touch, voice)
3. **Understandable** — content and UI are understandable (clear language, predictable behavior)
4. **Robust** — works with assistive tech (screen readers, voice control)

## Non-negotiables

### Semantic HTML

- `<button>` for actions, `<a>` for navigation. Never `<div onClick>`.
- Headings in order: `h1` → `h2` → `h3`. Don't skip levels.
- Landmarks: `<main>`, `<nav>`, `<aside>`, `<header>`, `<footer>`.
- Lists: `<ul>`, `<ol>` for grouped items.
- Forms: `<label>` paired with every input via `htmlFor`.

### Keyboard navigation

- **Every interactive element reachable via Tab.**
- **Focus visible.** Never `outline: none` without replacement.
- **Focus order logical.** Tab order matches visual order.
- **Escape closes modals.** Don't trap users.
- **Enter/Space activates buttons.** Let browser do it — use `<button>`.
- **Arrow keys for lists/grids.** Composite widgets need arrow key support.

### Screen reader support

- **`alt` on every image.** Empty string `alt=""` if decorative. Descriptive alt if meaningful.
- **`aria-label` on icon-only buttons.** "X" button → `aria-label="Zavřít"`.
- **`aria-live` for dynamic content.** Toast notifications, form errors.
- **`aria-expanded` on collapsibles.** State communicated.
- **`aria-current="page"` on active nav link.**

### Color contrast

- **Text: 4.5:1 against background** (normal text, AA)
- **Large text: 3:1** (18pt+ or 14pt+ bold)
- **UI components: 3:1** (buttons, form fields, focus indicators)
- **Don't rely on color alone.** Error states need icon + color + text.

### Touch targets

- **Minimum 44x44px** (WCAG 2.2)
- **48x48px preferred** (Material Design)
- **64x64px for kiosk/touch-first apps**
- **Spacing between targets** to prevent mis-taps

## React / Next.js specifics

- **Use Radix UI or shadcn/ui.** They handle most ARIA plumbing correctly.
- **Never spread props onto native elements without review** — can override required ARIA.
- **Skip links** — "Skip to main content" for keyboard users.
- **Focus management on route change** — move focus to heading after navigation.
- **Forms with react-hook-form + Zod** — announce errors via `aria-live`.

## Testing

### Automated (catches ~30% of issues)

- **axe-core** in E2E tests (Playwright integration)
- **Lighthouse accessibility audit** in CI
- **eslint-plugin-jsx-a11y** in linter
- **Storybook a11y addon** for component-level checks

### Manual (catches the other 70%)

- **Keyboard-only test** — unplug mouse, complete main tasks
- **Screen reader test** — VoiceOver (Mac), NVDA (Windows), TalkBack (Android)
- **200% zoom test** — content reflows, no horizontal scroll
- **High contrast mode** — Windows High Contrast, macOS Increase Contrast
- **Reduced motion test** — respect `prefers-reduced-motion`

## Motion and animation

- **Respect `prefers-reduced-motion`** — disable non-essential animations
- **No flashing > 3 times per second** (seizure risk)
- **Parallax sparingly** — can trigger vestibular issues
- **Auto-play video muted + pausable**

## Language

- **`<html lang="cs">`** on every page (for Czech apps)
- **`<html lang="en">`** for English
- **Clear, simple language** — write for reading level ~8th grade
- **Define jargon** — tooltip or glossary for technical terms
- **Avoid idioms** in UI copy — they don't translate

## Forms

- **Label every input.** Placeholder is NOT a label.
- **Required fields marked** visually + `aria-required`.
- **Error messages near field** with `aria-describedby`.
- **Validate on blur, not on every keystroke.**
- **Don't disable submit** — let user submit, show errors.

## Red flags

- ❌ `<div onClick>` instead of `<button>`
- ❌ `outline: none` with no replacement focus style
- ❌ Placeholder as label
- ❌ Icon buttons with no `aria-label`
- ❌ Color as only indicator (red = error, no icon)
- ❌ Contrast < 4.5:1 on body text
- ❌ Auto-playing sound or video
- ❌ Keyboard trap (Tab can't escape)

## Legal context (2026)

- **EU EAA (European Accessibility Act)** — effective June 2025, requires AA compliance for most digital services
- **Czech Republic Act No. 99/2019** — on accessibility of websites and mobile apps of public bodies (implementing EU Directive 2016/2102)
- **US ADA Title III** — private businesses' digital services
- **Lawsuits increasing** — WCAG AA is the de-facto legal standard

## Verification

```bash
npx lighthouse --only-categories=accessibility https://prod.example.com
npx pa11y-ci
npx playwright test a11y.spec.ts
```

Target: Lighthouse a11y > 95, zero axe-core violations on critical paths.
