# The Core3 reference

What the converter reads from the [SWGEmu Core3](https://github.com/swgemu/Core3) server scripts
(`MMOCoreORB/bin/scripts`, AGPL-3.0), kept here so that nobody converting their own Star Wars Galaxies
install needs the emulator: where the travel terminals, ticket collectors and shuttles stood, the other
things the server stood on its buildings and the props its screenplays placed, what each deed makes and
what it cost to keep, where the creatures and people stood, and each mobile's level, health and damage.

These files hold only what the converter's own readers take out -- names, places, turns, counts and
stats -- and never the scripts. They are written by `npm run swg -- core3-reference @CORE3`, which
reads every answer back and compares it with a fresh read of the scripts folder before it keeps
anything. `index.json` lists the files, the zones and how much each holds. `tools/swg/core3ref.mjs`
reads and writes them; see `tools/swg/README.md`.
