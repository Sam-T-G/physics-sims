# physics-sims

Interactive 3D simulations for Physics 4B (electricity and magnetism), built as an honors contract at Riverside City College, Fall 2026. One standalone web app per exam section, sharing a common `lib/`, later compiled into a study-tools hub.

Live: https://sam-t-g.github.io/physics-sims/

## Apps

| App | Concept | Status |
|---|---|---|
| `01-electrostatics` | Charge → Coulomb → field → why r² → flux → Gauss → symmetry | complete: eight chapters, every scene live, checkpoints, linked equations, approximation panel |
| `02-circuits` | Charge and current, Ohm's law and power, the real battery, series and parallel, Kirchhoff's rules, RC charging and discharging, all on one 3D board of plug-in resistors, wires and a capacitor | live at `/02-circuits/`: a 29-step guided tour in eight chapters (predict, try it, reveal), drag-to-snap parts, HUD readouts, KaTeX equations checked against a full nodal solve, a capacitor timeline with I(t) and V_C(t) plots, OpenStax Examples 10.1, 10.3, 10.4 as presets |

## Run

```
pnpm install
pnpm test        # physics tests, no DOM
pnpm dev         # 01-electrostatics at http://localhost:5173
pnpm dev:02      # 02-circuits
pnpm build       # dist/<app>/, each with meta.json and THIRD-PARTY-NOTICES.txt
node scripts/write-index.mjs   # dist/index.html, the site index
```

## Layout

```
lib/physics/   pure TypeScript: fields, flux, field lines, integrator, DC circuit solver, RC closed forms. Imports nothing from three, gsap or motion.
lib/render/    Three.js helpers: stage (renderer, camera, lights, orbit), surface mesh, shells, charge markers. Never imports gsap.
lib/chrome/    chapters, tool belt, camera rig, reduced motion; later checkpoints and linked equations. The only place gsap is imported.
lib/tokens.css shared design tokens.
apps/<app>/    one Vite root per sim, exporting mount(el, opts) and unmount(el).
tests/         Vitest against lib/physics, written before the visuals.
```

## Accuracy

Every physical quantity on screen is computed live from the state. Flux is computed exactly per face by solid angle over the live mesh; field lines are integrated, not drawn; nothing physical is pre-baked. In sim 2, a nodal solve (Kirchhoff's junction rule at every node) computes every current and voltage on the board, and the equation rows on screen are filled in from that solve. Tests check the solver against OpenStax Examples 10.1, 10.3 and 10.4, check energy balance and the book's series and parallel rules on 300 random boards, check the capacitor curves against Eq 10.8 to 10.12, and walk the guided tour step by step through the solver. The tests in `tests/` are the accuracy contract and they were written first.

## Sharing it

Everything runs from the link, on a phone, no install, no account. The message that goes out with it:

> Charge, field, flux: a short interactive walk from "what is charge" to Gauss's law, for the Physics 4B exam 1 material. It covers OpenStax Ch 5 and 6 (charge, Coulomb's law, the field, flux, Gauss's law and when it actually gives you E). It does not cover conductors, continuous charge distributions, or Ch 7 (potential), which are also on exam 1. Eight short chapters, each with a "what do you see" question and a prediction you commit to before the reveal. Works on your phone.

For sim 2:

> Plug-and-play circuits: a 3D circuit board for the Physics 4B exam 2 material. Drag resistors, wires and a capacitor onto the board, and every current, voltage and power updates as you go. It covers C = Q/V (8.1), current (9.1), resistance and Ohm's law (9.3 and 9.4), power (9.5), emf and real batteries (10.1), series and parallel (10.2), Kirchhoff's rules on a one-battery board (10.3) and RC circuits (10.5), with a quick recap of charge from Ch 5. It does not cover the rest of Ch 8 (parallel plates and other shapes, capacitors in series and parallel, capacitor energy, dielectrics), current density, drift velocity (9.2), resistivity and temperature, superconductors (9.6), circuits with two batteries, meters (10.4) or household wiring (10.6), which are also on exam 2. Use it to practice how circuits behave; it isn't a full exam review. A 29-step guided tour in eight short chapters, each step with a prediction you commit to before the reveal. Works on your phone.

## Attribution and disclosure

Worked examples, problem values and paraphrased explanations come from University Physics Volume 2 by William Moebs, Samuel J. Ling and Jeff Sanny (OpenStax), licensed CC BY-NC-SA 4.0: https://creativecommons.org/licenses/by-nc-sa/4.0/. Access for free at openstax.org. Book: https://openstax.org/details/books/university-physics-volume-2. Changes: book values rebuilt as interactive presets, text paraphrased. Page numbers are from the PDF edition (©2026 Rice University).

Third-party code and fonts (three.js, KaTeX, Motion, GSAP, Nunito) keep their own licenses; each build ships them in `THIRD-PARTY-NOTICES.txt` next to the app.

This project was built with AI assistance (Claude), under an explicit exception granted by the course instructor for the honors contract. The course otherwise prohibits AI on submitted work.
