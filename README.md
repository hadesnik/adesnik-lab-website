# Adesnik Lab website

The website for the [Adesnik Lab](https://adesnik.berkeley.edu) at UC Berkeley — a
fast, static site built with [Eleventy](https://www.11ty.dev/). Content lives in plain
JSON data files; pages are rendered from templates at build time. No CMS, no database.

## Editing content (the common case)

Almost all routine updates are edits to one file in [`src/_data/`](src/_data/):

| To change…              | Edit                                        |
| ----------------------- | ------------------------------------------- |
| Lab members             | [`src/_data/members.json`](src/_data/members.json) |
| Alumni                  | [`src/_data/alumni.json`](src/_data/alumni.json)   |
| Publications            | [`src/_data/publications.json`](src/_data/publications.json) |
| Funding sources         | [`src/_data/funding.json`](src/_data/funding.json) |
| Research themes         | [`src/_data/research.json`](src/_data/research.json) |
| Nav, contact info, etc. | [`src/_data/site.json`](src/_data/site.json) |

**Update loop:** edit a data file → commit → push to `main`. GitHub Actions rebuilds and
deploys automatically (see below). You do **not** need to run anything locally to publish.

### Adding a person
Add an object to the relevant group in `members.json`. Drop a square headshot in
`src/assets/images/` and set `"photo": "/assets/images/your-file.jpg"`. If `photo` is
`null`, the site shows a clean initials avatar automatically.

### Adding a publication
Add an entry to `preprints` or `published` in `publications.json` (newest first). Include
a `doi` and/or `pmid` and the site builds the correct links.

## Running it locally (optional — only for previewing before you push)

Requires Node 18+ and npm.

```bash
npm install      # first time only
npm start        # dev server with live reload at http://localhost:8080
npm run build    # production build into _site/
```

> **On Hillel's Mac (macOS 12):** Node is installed in a conda env because Homebrew can't
> build it on this OS. Activate it first: `conda activate web-node`, then run the npm
> commands above. (CI uses its own Node, so this is only for local previews.)

## Deployment

`.github/workflows/deploy.yml` builds the site and deploys it to GitHub Pages on every push
to `main`. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions.**

The site goes live at a `https://<account>.github.io/<repo>/` URL immediately. To serve it at
`adesnik.berkeley.edu`, UC Berkeley (MCB / Helen Wills) IT must point that subdomain at GitHub
Pages; then add a `CNAME` file containing `adesnik.berkeley.edu` and set the custom domain in
Settings → Pages.

## Project structure

```
src/
  _data/            content as JSON (edit these)
  _includes/
    layouts/        base.njk (shell), page.njk (interior hero)
    partials/       header.njk, footer.njk
    components/     cards.njk (member / alumni / publication macros)
  assets/           css/, js/, images/
  *.njk             one file per page
.eleventy.js        Eleventy config
scripts/shot.js     dev-only screenshot/QA helper (Puppeteer)
```

## Notes for maintainers

- **Member photos / bios:** only a few headshots existed on the old site; add more to
  `src/assets/images/` over time. Bios are optional (`"bio"` field).
- **Publication DOIs/PMIDs** were verified against CrossRef and PubMed during migration.
- Keep images reasonably sized (square headshots ~600×600 are plenty).
