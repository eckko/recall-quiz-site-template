# Optional sign-in sync

Saves the reader's progress (never the questions) to an account so it
follows them across devices. Off by default.

## Turn it on

1. Edit `js/sync/sync-config.js`: set `provider: "firebase"` and check
   the Firebase config block.
2. In Firebase, enable Google sign-in, add your site's domain under
   authorised domains, and publish `providers/firebase-firestore.rules`.
3. Firebase web config values are public by design; the rules decide who
   can read or write. GitHub may flag the API key as a secret: it is not.

## How it works

- `progress-merge.js`: merges two progress records question by question
  (newer answer wins, counts never go down).
- `cloud-sync.js`: sign-in bar, load/merge on sign-in, debounced save
  after answers, at the end of a session and when the page is hidden.
  Listens to `recallquiz:progress-saved`, `recallquiz:book-opened`,
  `recallquiz:session-finished`.
- `providers/<name>.js`: one adapter per database (`firebase`,
  `example-in-browser` for testing). To use another database, add an
  adapter and set `provider` to its name.

- The theme choice follows the reader too: cloud-sync.js listens to
  `recallquiz:theme-changed` and keeps the newest choice in a `_settings`
  document of the account (see `ai-context/data-formats.md`).

Sync never changes how the quiz works when it is off or the reader is
signed out.
