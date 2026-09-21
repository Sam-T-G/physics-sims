# physics-sims

Interactive 3D simulations for Physics 4B (electricity and magnetism), built as an honors contract at Riverside City College, Fall 2026. One standalone web app per exam section, sharing a common `lib/`, later compiled into a study-tools hub.

Live: https://sam-t-g.github.io/physics-sims/

## Apps

| App | Concept | Status |
|---|---|---|
| `01-electrostatics` | Charge → Coulomb → field → why r² → flux → Gauss → symmetry | complete: eight chapters, every scene live, checkpoints, linked equations, approximation panel |

## Run

```
pnpm install
pnpm test        # physics tests, no DOM
pnpm dev         # 01-electrostatics at http://localhost:5173
pnpm build       # dist/<app>/
```

## Layout

```
lib/physics/   pure TypeScript: fields, flux, field lines, integrator. Imports nothing from three or gsap.
lib/render/    Three.js helpers: stage (renderer, camera, lights, orbit), surface mesh, shells, charge markers. Never imports gsap.
lib/chrome/    chapters, tool belt, camera rig, reduced motion; later checkpoints and linked equations. The only place gsap is imported.
lib/tokens.css shared design tokens.
apps/<app>/    one Vite root per sim, exporting mount(el, opts) and unmount(el).
tests/         Vitest against lib/physics, written before the visuals.
```

## Accuracy

Every physical quantity on screen is computed live from the state. Flux is computed exactly per face by solid angle over the live mesh; field lines are integrated, not drawn; nothing physical is pre-baked. The tests in `tests/` are the accuracy contract and they were written first.

## Sharing it

Everything runs from the link, on a phone, no install, no account. The message that goes out with it:

> Charge, field, flux: a short interactive walk from "what is charge" to Gauss's law, for the Physics 4B exam 1 material. It covers OpenStax Ch 5 and 6 (charge, Coulomb's law, the field, flux, Gauss's law and when it actually gives you E). It does not cover conductors, continuous charge distributions, or Ch 7 (potential), which are also on exam 1. Eight short chapters, each with a "what do you see" question and a prediction you commit to before the reveal. Works on your phone.

## Attribution and disclosure

Figures, worked examples, and problem values referenced from OpenStax University Physics Volume 2 are used under CC BY 4.0: https://openstax.org/books/university-physics-volume-2

This project was built with AI assistance (Claude), under an explicit exception granted by the course instructor for the honors contract. The course otherwise prohibits AI on submitted work.
