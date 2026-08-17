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

## One caveat

The URL is public and unauthenticated — anyone with the link can edit scores.
That is usually fine for a four-player company outing on an unguessable site
name. To lock it down, Netlify's password protection (site-wide, paid plans)
is the least intrusive option; otherwise put a shared secret in an
`x-aqopen-key` header and check it against a Netlify environment variable in
`state.mjs`.