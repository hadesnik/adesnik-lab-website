# CLAUDE.md — Adesnik Lab Website Rebuild

## Project
Rebuild the Adesnik Lab website, currently at https://adesnik.berkeley.edu, as a
static site built from scratch. We are moving OFF WordPress (the current site was
built and maintained by the agency Pendari) to a hand-coded static site that the
lab will maintain directly through code.

## Goals
- Replace the WordPress site with a fast, secure, low-maintenance static site.
- Clean, modern, professional academic design appropriate for a neuroscience lab.
- Store changeable content (publications, lab members) in simple data files that are
  easy to edit and redeploy.
- Full design control; no plugins, no CMS, no database, no wp-admin to maintain.

## Who maintains it
The site owner is comfortable editing code and using Claude Code. The intended update
loop is: edit files → commit → push → auto-deploy. Optimize for that workflow. There is
NO need for a browser-based CMS editing experience.

## Tech stack (proposed — confirm with owner before scaffolding)
- Static site. Default to plain HTML/CSS/JS for maximum portability and zero build
  friction, OR a lightweight static site generator (Astro or Eleventy) if cross-page
  templating and data-driven publications/members justify a build step.
- No backend, no database.
- Publications and lab members stored as structured data (JSON/YAML or markdown) and
  rendered into their pages, so adding an entry means editing one data file.
- Minimal CSS (vanilla or a light utility setup); avoid heavy frameworks.

## Pages (based on the current site — verify against the live site)
- Home (landing / hero)
- Research
- Lab Members (current members + alumni)
- Publications
- Positions / Join Us
- Funding
- Contact

## Content migration (do this FIRST)
The live WordPress site is still up at https://adesnik.berkeley.edu. Inventory and pull
the real content from it before anything gets shut off:
- Page text for each section.
- Images/photos (member headshots, research figures), e.g. from /wp-content/uploads/.
- The full publications list.
- Lab member names, roles, bios, and links.

Do NOT invent research descriptions, member bios, or publications — extract the actual
content from the live site and flag anything ambiguous for the owner to confirm. Save
migrated assets into the repo (e.g. /assets/images/).

## Hosting & deployment (important constraint)
- The domain adesnik.berkeley.edu is controlled by UC Berkeley campus/department IT,
  not freely by the lab.
- Plan: host the static site on GitHub Pages and have department IT point the subdomain
  at it via DNS/CNAME. Update workflow = git push → GitHub Pages auto-deploys.
- Caveat: Berkeley's default managed hosting is Pantheon (WordPress/Drupal) and does not
  run static sites. Pointing a berkeley.edu subdomain at GitHub Pages IS supported at
  Berkeley (e.g. the Statistics department does this for faculty research groups) but may
  require asking the right department IT — likely Molecular & Cell Biology (MCB) and/or
  the Helen Wills Neuroscience Institute.
- Owner action item: confirm with department IT that they will point
  adesnik.berkeley.edu at a GitHub Pages / owner-managed static host instead of Pantheon.
- This hosting question does NOT block development. Build into a git repo now; the deploy
  target is settled in parallel.

## Suggested repo structure
```
/ (repo root)
  index.html                 # or src/pages/ if using a generator
  /assets/images
  /data/publications.(json|yaml)
  /data/members.(json|yaml)
  /css
  /js
  CNAME                      # add once IT confirms the subdomain
  README.md
  CLAUDE.md
```

## Conventions
- Keep content separate from layout so routine edits stay simple.
- Accessible, semantic HTML: alt text on all images, correct heading order, sufficient
  contrast — campus/university sites carry accessibility expectations.
- Mobile-responsive.
- Keep dependencies minimal.

## First steps for Claude Code
1. Confirm the tech-stack choice with the owner (plain HTML/CSS/JS vs Astro/Eleventy).
2. Scrape and inventory the live site's content and images.
3. Scaffold the repo structure.
4. Build a styled Home page as a design proof, get feedback, then build the rest.
5. Set up the GitHub repo and GitHub Pages config (including the CNAME file for the
   subdomain once IT confirms).

## Open questions for the owner
- Plain HTML/CSS/JS, or a static site generator?
- Keep the current visual design, or redesign?
- Any brand/colors/logo to match (e.g. UC Berkeley palette, a lab logo)?
- Department IT confirmation on pointing the subdomain at GitHub Pages.
