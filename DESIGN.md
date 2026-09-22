# Zebao Client design language

This document is the Client's local design contract. It follows the structure
recommended by [awesome-design-md](https://github.com/VoltAgent/awesome-design-md):
visual atmosphere, semantic tokens, typography, components, layout, responsive
rules, and guardrails. It is intentionally product-specific rather than a copy
of another brand.

## Product intent

The Client is an operator workspace for a scene-based robot. It should feel
calm, precise, and trustworthy: the current scene and real execution state
come first; engineering details are available without overwhelming ordinary
operators. Missing data is visible as missing data, never replaced with a
default scene or a green success state.

## Visual tokens

- Canvas: `#11100e`; primary surface: `#161512`; raised surface: `#191815`.
- Text: `#fbf7ef` primary, `#b9b1a6` secondary, `#827a70` tertiary.
- Accent: `#e7a34b`; success: `#9add9f`; warning: `#efb760`; error: `#f0c2ba`.
- Borders use `#39342d` by default and stronger semantic colors only for a
  real status. Avoid gradients that reduce text contrast.
- Use 8/12/16/24/32px spacing and 10–16px corner radii. Keep cards quiet;
  reserve the amber accent for actions and active states.

## Information hierarchy

1. Identify the active scene and its generation.
2. Show whether the value is live, stale, unavailable, or awaiting a human.
3. Present the next safe action (read again, open the relevant foundation page,
   or complete a field step).
4. Put commit IDs, providers, and diagnostic details below the operator task.

Every page needs a useful loading, empty, partial-error, and retry state. Error
copy must name the data source and explain what the page refuses to infer.

## Components

- Use one primary action per surface. Secondary actions are quiet outlined
  buttons; destructive actions are never styled as primary.
- Statuses are semantic chips or bordered rows, not color alone: include text
  such as “自动门禁通过”, “待真人”, or “暂不可读”.
- Keep runtime facts in compact metric rows and long identifiers wrapped or
  truncated with a clear label; never allow an unbroken technical string to
  control the layout.
- Use `aria-live` only for changing status messages and preserve keyboard focus
  rings on every interactive element.

## Responsive rules

- Desktop uses a fixed navigation rail and a centered content column capped at
  about 1180px.
- At 820px the rail becomes bottom navigation; at 600px cards become one
  column and actions become full width.
- Touch targets are at least 44px high. Do not hide the active scene, current
  status, or retry action on mobile.

## Guardrails

- The Client reads the App's `SceneRuntimeSnapshot`; it does not hard-code
  scene names, capability lists, provider URLs, or success results.
- Browser reads use the same-origin `/operator-api` proxy so CORS policy cannot
  make a healthy App appear offline.
- Never display credentials, original audio, images, faces, or model transcripts
  in operator cards.
