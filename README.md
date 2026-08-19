# AqOpen Sweden – scoring

Static scorecard for the AqOpen golf competition, with one shared result set
stored in Netlify Blobs. Four phones, one leaderboard.

```
index.html                     the whole front end, no build step
courses.json                   course library: names + 18 pars each
netlify/functions/state.mjs    GET/PUT /api/state, backed by Netlify Blobs
netlify.toml                   publish dir + functions dir
package.json                   one dependency: @netlify/blobs
```

## Publish

1. Create a GitHub repo and push these files to `main`:

   ```bash
   git init
   git add .
   git commit -m "AqOpen scoring"
   git branch -M main
   git remote add origin git@github.com:<you>/aqopen-scoring.git
   git push -u origin main
   ```

2. On netlify.com: **Add new site → Import an existing project → GitHub**,
   pick the repo. Netlify reads `netlify.toml`, so leave the build command
   empty and deploy.
3. **Site configuration → Change site name** to get a readable URL, e.g.
   `aqopen.netlify.app`. HTTPS is automatic.

Blobs needs no setup: the store is created on first write, scoped to the site.

Every push to `main` redeploys. Pull requests get a preview URL — useful for
trying rule changes without touching the live scorecard. Note that a deploy
preview writes to its own blob store, so preview scores stay separate.

## Run it locally

```bash
npm install
npx netlify dev      # serves index.html and /api/state on localhost:8888
```

## How syncing works

The server keeps `{ rev, state }`. Clients `PUT` their state along with the
revision they last read; a stale revision is rejected with `409` plus the
current document. The client then three-way merges — a value it changed
locally wins, anything else takes the server's value — and retries. Different
holes entered on different phones at the same time therefore both survive.

Clients poll every 6 seconds, and immediately when a phone wakes up. If the
API is unreachable the app keeps scoring against `localStorage` and pushes up
when the connection returns; the status bar says which mode it's in.

The app also ships as a lightweight PWA, so after the first visit you can
install it to a phone home screen for quicker access during the event.

## Adding courses

There is no free public source for Swedish course scorecards — SGF's GIT is
the only system with the data and its API is a paid commercial licence — so
the library is a plain file you own:

```json
{ "name": "Bro Hof – Stadium", "pars": [4,4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5] }
```

Add entries to `courses.json`, push, done. Pars for the bundled courses come
from memory and should be checked against the real scorecard.

Faster for a one-off: in **Inställningar**, paste the 18 pars into "Klistra in
par från scorekortet", then "Spara som egen bana". That stores it in the
shared state for everyone, without a deploy.

## Resetting between events

Either use **Nollställ alla resultat** in the app, or wipe the blob entirely:

```bash
curl -X DELETE https://<your-site>.netlify.app/api/state
```

Before the reset is applied, the browser stores one local recovery snapshot.
That snapshot can later be restored from **Inställningar → Backup & import**.

## Edit key / read-only mode

If you want everyone to see the leaderboard but only a few phones to edit,
set a Netlify environment variable named `AQOPEN_KEY`. When present:

- `GET /api/state` still works for everyone
- `PUT` and `DELETE` require the same value in the `x-aqopen-key` header
- the app lets each phone save that key locally under **Inställningar**
- phones without the key automatically become read-only until the key is set

There is also a browser-local **Visningsläge** toggle in **Inställningar**.
Use that on a spectator screen even if the site itself is not key-protected.

## Backup / restore

Under **Inställningar → Backup & import** you can:

- export the full shared state as JSON
- import a previous JSON backup
- restore the latest locally saved pre-reset snapshot

## Player database

Under **Inställningar → Spelare** there is a shared player database:

- **Ladda från databas** replaces the current event players with saved players
- **Spara nuvarande spelare** stores the current list (name + handicap) for reuse

The data is shared through the Netlify function endpoint `GET/PUT /api/players`.

## One caveat

Without `AQOPEN_KEY`, the URL is still public and unauthenticated — anyone
with the link can edit scores. That is usually fine for a four-player company
outing on an unguessable site name. To lock it down cheaply, use the shared
key support above; Netlify's site-wide password protection is still another
option on paid plans.