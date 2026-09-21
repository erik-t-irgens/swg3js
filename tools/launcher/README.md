# The launcher

`swg3js.exe` is how a player who has never heard of Node gets the game: one Windows program with Node
inside, which keeps the game up to date from `main`, converts their own Star Wars Galaxies (and Jedi
Academy) install, and plays the game in their own browser. This file is for whoever works on it next;
the player's side is in the root `README.md` under **The launcher**.

## The pieces

| File | What it is | Where it runs |
| --- | --- | --- |
| `bootstrap.cjs` | The one script built into the exe. Updates the install, then starts the launcher proper; also runs the release's scripts as children. | Sealed into the exe; changes only when the exe is rebuilt |
| `main.mjs` | The launcher proper: a web server on `127.0.0.1`, the page's API, the conversion drive, serving the game, hosting. | In the release, so it updates with the game |
| `page.html` | The launcher's page, plain HTML, the game's eighteen colours and nothing else. | In the release |
| `checks.mjs` | The folder and disk checks, each answering one sentence. | In the release |
| `plan.mjs` | From `status --json` to the steps that run, and when a step is stuck. | In the release |
| `serve.mjs` | Content types, byte ranges, path checks. | In the release |
| `pack.mjs` | Packs a release: the archive and its record. | CI, and here to try a release |
| `build-exe.mjs` | Builds the exe (`npm run launcher:build`). | Windows |
| `tests/launcher.test.mjs` | Everything above that can be tried with no network (`npm run test:launcher`, part of `test:all`). | Anywhere |

`tools/swg/statusplan.mjs` is the converter's half: `status <out> --json` prints the same to-do the
human report does, as steps in order with their arguments split (the output folder may hold spaces),
`@SWG` and `@JKA` for the two install folders, and whether a step takes or needs Jedi Academy. The
human report is byte for byte what it was.

## How the exe runs the release (and why this way)

The exe is Node's own single-executable application: a copy of `node.exe` with `bootstrap.cjs`
injected (`postject`, a dev dependency). The embedded script's own `require` reaches only Node's
built-ins and its `import()` reaches nothing on disk, so the bootstrap writes a four-line CommonJS file,
`loader.cjs`, into the data folder and loads it with `module.createRequire`; that file's `import()` is
the ordinary one, and it loads the release's ES modules from disk, top-level await (which `cli.mjs`
has) and Node's type stripping (the converter imports `src/swg/terrain/*.ts`) included. This was
measured, not assumed: a test exe built the same way ran an `.mjs` with top-level await that imported a
`.ts`, and the proof run converted with the real converter through it.

Children are the exe again: `swg3js.exe --swg3js-run <file> <args...>`. In that mode the bootstrap sets
`process.argv` to `[exe, file, ...args]` (what `node file args` would give; a single-executable app's
own argv is `[exe, exe, ...args]`) and imports the file. So the converter and the server run on the
very Node inside the exe, and nothing on the player's machine needs Node, npm or git. The other
acceptable way (download a pinned portable Node from nodejs.org) was not needed.

## How it updates

- CI (`.github/workflows/deploy.yml`) packs every push to `main` with `pack.mjs` in the `build` job,
  builds `swg3js.exe` on a Windows runner in the `launcher` job, and the `release` job uploads to the
  one rolling release tagged `latest`: the archive first (`swg3js-<commit>.tar.gz`, named for its
  commit so the new one goes up beside the old), then the exe, then `release.json`
  (`{ format, commit, date, archive: { name, size, sha256 }, files }`); then it deletes the archives of
  earlier commits and moves the tag to the commit. A launcher that reads the record at any moment finds
  the archive it names, and one link hands the whole thing to a friend.
- The bootstrap asks `https://api.github.com/repos/erik-t-irgens/swg3js/releases/tags/latest`, reads
  `release.json`, and does nothing if its commit is the installed one (`app/version.json`). Otherwise
  it downloads the archive, checks the size and the SHA-256 against the record, unpacks into
  `app.new-*`, checks it carries `version.json` of a format it knows, of the record's own commit, and
  `tools/launcher/main.mjs`, and only then moves `app` aside, the new one in, and the old one away. A
  record without a commit, a size or a 64-digit SHA-256 is not downloaded at all, and nothing is ever
  unpacked unchecked but an archive given by hand with no record beside it. Any failure leaves `app`
  as it was, and a start that died between the swap's two renames finds no `app` and puts the
  `app.old-*` it left back before clearing anything. No network: it starts what it has. No release
  yet: it says so.
- A release whose `format` is higher than the bootstrap's `PACK_FORMAT` is not installed and the page
  says to download the exe again. That is the one escape hatch for a change the bootstrap cannot take;
  bump `PACK_FORMAT` in `pack.mjs` and `bootstrap.cjs` together only for such a change.
- "Check for updates" on the page does the same while running; when it installs something the
  launcher closes its port and starts the exe again on the same port with `--offline` and the news in
  `SWG3JS_UPDATED`, and the page reloads itself when the new one answers.

## The data folder

`%LOCALAPPDATA%\swg3js\` (or `--data=<folder>`, or `SWG3JS_DATA`):

- `app\` the installed release; `download\` a download in progress;
- `settings.json` the three folders, the port, the host and join settings;
- `launcher.json` the running launcher's port and pid (a second start opens that one's page);
- `loader.cjs` the four-line loader above;
- `logs\launcher.log` the bootstrap's and the launcher's lines, `logs\convert-<time>.log` one per
  Convert, `logs\relay.log` the server's;
- `server\` the hosted server's world (its `--data=`).

The converted content is wherever the player chose, never in here.

## The conversion drive

Convert checks the folders and the free space (16 GB for a first conversion, 3 GB to top up; ours),
then loops: run `status <out> --json`, take the first step it can run, run it, ask again. A step that
needs Jedi Academy with none chosen is shown and skipped; a step with `jka: 'takes'` gets `--jka=` when
there is a folder (the README says the player command always wants it). A step that failed is not run
again in the same drive, and one that `status` asks for again for exactly the reasons it gave before
it ran is called stuck and passed over, so the drive always ends and says what is left. Stop kills
the running converter; Convert again resumes, since `status` says what is left. Most of the
converter's JSON is written in one plain write, so a Stop (or a crash, or a power cut) in the middle
of one can leave it cut short: `status` takes a file it cannot parse as missing, names it on a line
of its own and lists it in `--json`'s `unreadable`, and the drive renames each such file beside
itself to `<name>.cut-<time>` (never deleting it) before asking again, since the step that writes it
may read the old one first. The three folders are kept absolute, resolved when they are set, because
the converter runs with the data folder as its working folder.

## Trying a release before it is published

```
npm run launcher:pack
npm run launcher:build
launcher-build\swg3js.exe --data=%TEMP%\swg3js-try --from-archive=launcher-build\release
```

`launcher:pack` builds the game into `launcher-build\dist` with the private content's copy switched off
(`SWG3JS_NO_PRIVATE=1`, honoured by `vite.config.ts`) and Vite's manifest on, then packs into
`launcher-build\release`. It takes only files git knows; to try work not yet committed, run
`node tools/launcher/pack.mjs --with-untracked`, which also takes the untracked files git does not
ignore (CI refuses the option). `--from-archive` installs that instead of asking GitHub (a folder: the
archive its `release.json` names; a file: that archive), checked against the `release.json` beside it
exactly as a download is (size, SHA-256 and commit); an archive with no record beside it is installed
unchecked and the console says so. Other options: `--offline`
(do not ask GitHub), `--no-open` (do not open the browser), `--port=<n>`. From a checkout,
`npm run launcher -- --data=<folder>` runs the launcher proper on your own Node, serving your `dist\`.

## What the release may carry

`pack.mjs` names every path and reads no folder wholesale. The built game is always its own build,
into `launcher-build\dist` emptied first (a `--dist` is refused), and of that folder it takes only
what Vite says it made: `index.html`, everything `.vite/manifest.json` names, the hashed files in
`assets/` those name in their own text (the workers, which the manifest leaves out), and the files of
`public/` git tracks, each byte for byte the blob git holds. Anything else in the folder fails the
pack. The rest comes from `git ls-files`: the converter's modules and data (not its tests), the six
`src/swg/terrain/*.ts` files the converter imports, the server's modules, the launcher proper,
`package.json`, `README.md`; then a `version.json`. It follows every relative file name written in
those modules and fails if the checkout has one the list left out. It fails on any `assets-private`
path, on a build folder that holds one, on game archives and game file formats anywhere, and with
`--ci` on a checkout that has `assets-private` at all. `files.txt` beside the archive lists what went
in.
