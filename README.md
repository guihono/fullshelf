# The Full Shelf

A personal tracker for anime, manga, comics, TV shows, video games, and
movies — status, ratings, per-episode/chapter/session logging, a timeline,
and stats, with a search step that looks up covers, synopses, and genres
for you where possible.

This was built as a Claude.ai artifact first. This folder is a standalone
version of the same app you can run on your own machine.

## Requirements

- [Node.js](https://nodejs.org) 18 or later (includes npm)

## 1. Install dependencies

This project has two parts: the app itself (root folder) and a small local
proxy server (`server/`) that a few search sources need. Install both:

```
npm install
cd server && npm install && cd ..
```

## 2. Run it

```
npm run dev:all
```

This starts the app and the proxy server together. Open the URL Vite
prints (usually `http://localhost:5173`).

Anime, Manga, and TV search work immediately with no further setup —
they're called directly from the app itself.

Prefer two separate terminals instead? `npm run dev` and `npm run server`
do the same two things individually.

## 3. (Optional) Enable search for Movies, Video Games, and Comics

These three go through the proxy server because their APIs (TMDB, RAWG,
Comic Vine) don't allow being called directly from a browser — see "Why
the proxy server exists" below. Each needs its own free key:

```
cd server
cp .env.example .env
```

Open `server/.env` and paste in whichever keys you want:

- **Movies** — [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) → `TMDB_API_KEY`
- **Video Games** — [rawg.io/apidocs](https://rawg.io/apidocs) → `RAWG_API_KEY`
- **Comics** — [comicvine.gamespot.com/api](https://comicvine.gamespot.com/api/) → `COMICVINE_API_KEY`

All three are free, no payment required, just a quick signup. Add as many
or as few as you want — anything left blank just falls back to manual
entry for that category, same as before. Restart the proxy server
(`npm run server`, or restart `npm run dev:all`) after editing `.env` so
it picks up the new keys.

## Why the proxy server exists

Browsers enforce a rule called CORS that blocks a webpage from calling
certain APIs directly — TMDB, RAWG, and Comic Vine all fall into this
category. The rule only applies to browser requests, though, not
server-to-server ones. So the proxy server (`server/index.js`) sits in
between: your browser asks *it* for search results, and it's the one that
actually calls TMDB/RAWG/Comic Vine, since a small Node server isn't
subject to that browser restriction. As a bonus, this also keeps your API
keys server-side instead of visible in the browser's network tab.

AniList and TVmaze (used for Anime, Manga, and TV) don't have this
problem — they're built to allow direct browser use — so those go
straight from the app to the API with no proxy involved.

## Your data

Entries are saved to your browser's local storage on the device/browser
you're using — there's no server-side database or account. The proxy
server only relays search requests; it doesn't store anything. Switching
browsers, using a different device, or clearing site data starts you over
with an empty shelf. If you want a backup or a way to move data between
devices, ask Claude to add an export/import feature.

## Building a static version

```
npm run build
npm run preview
```

`npm run build` outputs a `dist/` folder for the frontend. The proxy
server (`server/`) is a separate Node process — if you deploy the built
frontend somewhere, you'll need to run `server/index.js` somewhere
reachable too (a small always-on host, not just your own machine) for
Movies/Games/Comics search to keep working there.
