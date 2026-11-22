// The lore sweep of the space body viewer's places (checked 2026-11-20). Bodies are keyed by the viewer's place id.
// confidence: "named in lore" (a source we opened names it), "inferred" (lore has the body; which SWG disc it is, or its look, is our reading), "ours" (no lore counterpart).
export const LORE = {
  "version": 1,
  "bodies": {
    "corellia:sun": {
      "name": "Corell",
      "kind": "star",
      "orbits": "nothing (the system's single star)",
      "lore": "The star of the Corellian system. Five worlds circle it: Corellia, Drall, Selonia and the paired worlds Talus and Tralus, with Centerpoint Station between those two.",
      "look": "A warm yellow-white disc with a broad glow, 28.1° in SWG.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Fan references name the system's one star Corell; lore gives it no colour, so the colour is ours.",
      "sources": [
        {
          "title": "Mithril Tabby: The Core Worlds",
          "url": "https://www.mithriltabby.com/starwars/galaxy/coreworlds.xhtml"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "corellia:moon": {
      "name": "Gus Talon",
      "kind": "moon",
      "orbits": "Corellia",
      "lore": "A moon of Corellia, first named in a Legends comic about Wedge Antilles's youth and later used again in canon. A Legends geography makes it the base of the Talon shipyards.",
      "look": "Lore does not describe its surface, so the owner's green Takodana picture is ours but conflicts with nothing; SWG draws it 13.3° in a yellow picture.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Named in lore, but no source says which of SWG's moons it is; it goes to the owner's \"Corellia's moon\" as the best-known named moon.",
      "sources": [
        {
          "title": "Numidian Prime: Midnight Horizon continuity breakdown",
          "url": "https://numidianprime.wordpress.com/2022/02/03/midnight-horizon-continuity-breakdown/"
        },
        {
          "title": "Star Wars One Canon wiki: Corellia",
          "url": "https://onecanon.miraheze.org/wiki/Corellia"
        },
        {
          "title": "Mithril Tabby: The Core Worlds",
          "url": "https://www.mithriltabby.com/starwars/galaxy/coreworlds.xhtml"
        }
      ]
    },
    "corellia:moon2": {
      "name": "Gus Treta",
      "kind": "moon",
      "orbits": "Corellia",
      "lore": "A moon of Corellia best known for the fuel depot station in its orbit. Wedge Antilles's parents ran the depot and died when pirates attacked the station, shortly before he came of age.",
      "look": "A dull tan-grey disc, the smallest moon in Corellia's sky at 6.9° (SWG's yellow picture).",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Named in lore. The researchers' \"outermost moon\" is not borne out by any source we could open, so giving it the smallest slot is a choice.",
      "sources": [
        {
          "title": "Star Wars One Canon wiki: Wedge Antilles",
          "url": "https://onecanon.miraheze.org/wiki/Wedge_Antilles"
        },
        {
          "title": "Star Wars One Canon wiki: Corellia",
          "url": "https://onecanon.miraheze.org/wiki/Corellia"
        }
      ]
    },
    "corellia:celestial:cels_moon_earthy01": {
      "name": "Corellia's third moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Corellia",
      "lore": "Corellia is given at least three moons, but only Gus Talon and Gus Treta are named. **Ours:** a brown-grey rocky moon, the nearest of the three.",
      "look": "SWG's largest Corellia body at 22.6°, fixed 20° up, in an earthy picture; as the biggest disc it reads as the nearest moon.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore counts a third moon without naming it; SWG's biggest celestial is the natural nearest moon. The swap with cels_mars1 is just as defensible.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Star Wars One Canon wiki: Corellia",
          "url": "https://onecanon.miraheze.org/wiki/Corellia"
        }
      ]
    },
    "corellia:celestial:cels_mars1": {
      "name": "unnamed in lore",
      "kind": "moon",
      "orbits": "ours",
      "lore": "**Ours.** A fourth body over Corellia, one more than lore's moons. If kept, it reads best as a sister world such as Selonia or Drall, though at true distances they would be bright stars rather than discs; otherwise drop it.",
      "look": "A red, Mars-like disc 11.4° across, fixed low behind (yaw -175, 15° up); smaller and dimmer would read more like a distant world.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "One body more than lore's three moons.",
      "sources": [
        {
          "title": "Mithril Tabby: The Core Worlds",
          "url": "https://www.mithriltabby.com/starwars/galaxy/coreworlds.xhtml"
        }
      ]
    },
    "dantooine:sun": {
      "name": "Dina",
      "kind": "star",
      "orbits": "nothing (the system's single star)",
      "lore": "Dina, the star of the Dantooine system in the Raioballo sector of the Outer Rim. Dantooine is its fourth planet.",
      "look": "One reference calls Dina a yellow star; an ordinary yellow-white sun, 26.3° in SWG, fits.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Lore names Dantooine's star.",
      "sources": [
        {
          "title": "JEDI HoloNet archives: Dantooine",
          "url": "https://www.jediholo.net/archives/galaxy/dantooine/"
        },
        {
          "title": "SWRPGGM: Dantooine",
          "url": "https://swrpggm.com/dantooine/"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "dantooine:moon": {
      "name": "Dantooine's larger moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Dantooine",
      "lore": "One of Dantooine's two moons, neither named in lore. **Ours:** the larger of the pair, a pale moon over the night grasslands.",
      "look": "A pale disc, 11.4° in SWG's grey picture. Wookieepedia is said to give the larger moon a light purple glow and the smaller a greenish one; we could not open it, so a lavender tint is ours to choose.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "Lore gives two moons; the larger goes to SWG's larger moon slot.",
      "sources": [
        {
          "title": "JEDI HoloNet archives: Dantooine",
          "url": "https://www.jediholo.net/archives/galaxy/dantooine/"
        },
        {
          "title": "Wookieepedia: Dantooine (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Dantooine/Legends"
        }
      ]
    },
    "dantooine:moon2": {
      "name": "Dantooine's lesser moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Dantooine",
      "lore": "The smaller of Dantooine's two moons, unnamed in lore. **Ours:** a small moon with a greenish cast.",
      "look": "A small disc, 6.9° in SWG's teal picture, which already suits the greenish moon of the unchecked account.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "Lore gives two moons; the smaller goes to SWG's smaller slot.",
      "sources": [
        {
          "title": "JEDI HoloNet archives: Dantooine",
          "url": "https://www.jediholo.net/archives/galaxy/dantooine/"
        },
        {
          "title": "Wookieepedia: Dantooine (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Dantooine/Legends"
        }
      ]
    },
    "dathomir:sun": {
      "name": "Domir",
      "kind": "star",
      "orbits": "nothing (the Dathomir system's star)",
      "lore": "The star of the Dathomir system, whose light washes the planet in a blood-red glow. Dathomir and its four moons circle it.",
      "look": "A deep orange-red sun with a broad, dusky glow that reddens the sky. SWG's file gives this slot no picture (36.9°), so nothing is drawn today and one must be chosen.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "A fan reference names the star Domir, and the official databank describes its red light.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "StarWars.com Databank: Dathomir",
          "url": "https://www.starwars.com/databank/dathomir"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        }
      ]
    },
    "dathomir:moon": {
      "name": "unnamed in lore (one of Dathomir's four moons)",
      "kind": "moon",
      "orbits": "Dathomir",
      "lore": "One of Dathomir's four moons, none named in lore. **Ours:** the nearest and greatest of them, a cratered moon that rises huge over the witches' forests.",
      "look": "Pale cratered stone tinted rose and amber by the red sun suits the world better than SWG's cold blue picture, which it draws very large (29.9°).",
      "continuity": "both",
      "confidence": "inferred",
      "why": "A fan reference gives Dathomir four moons and names none.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "dathomir:moon2": {
      "name": "unnamed in lore (one of Dathomir's four moons)",
      "kind": "moon",
      "orbits": "Dathomir",
      "lore": "Another of Dathomir's four unnamed moons. **Ours:** a small dusty moon that follows the great moon across the night.",
      "look": "A small yellow-tan moon (9.5° in SWG, 60° off the night light), warmed toward orange by the red sun.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "A fan reference gives Dathomir four moons and names none.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "endor:sun": {
      "name": "Endor's sun (unnamed in the sources we could open)",
      "kind": "star",
      "orbits": "nothing (the Endor system's star)",
      "lore": "Most stories show a single sun over the forest moon, while the Ewok films show two and some references give the system a named pair of suns. Fan sites call the single star Ibleam, a name we could not trace to a lore book.",
      "look": "One ordinary warm yellow-white sun of normal size, 22.6° in SWG. A second, smaller sun would follow the Ewok films instead.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "The star is lore; its name is not settled in the sources we could open, so none is given.",
      "sources": [
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wookieepedia: Endor I (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Endor_I"
        }
      ]
    },
    "endor:moon": {
      "name": "Kef Bir (canon); unnamed in Legends",
      "kind": "moon",
      "orbits": "the gas giant Endor",
      "lore": "One of the nine moons of the gas giant Endor, an ocean world of rough seas and grassy cliffs lying in the giant's shadow. Decades after this game's time the wreck of the second Death Star comes to rest in its ocean; Legends counts Endor's moons but does not name this one.",
      "look": "A pale blue-grey ocean moon with thin white cloud and little land; SWG makes it the big moon of Endor's night (22.6°), so it should read as the largest moon in the sky.",
      "continuity": "canon",
      "confidence": "inferred",
      "why": "Lore names only one moon besides the forest moon, the ocean world Kef Bir, and this slot's picture is a pale moon that suits an ocean world.",
      "sources": [
        {
          "title": "StarWars.com Databank: Endor",
          "url": "https://www.starwars.com/databank/endor"
        },
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        }
      ]
    },
    "endor:moon2": {
      "name": "unnamed in lore (one of the gas giant Endor's nine moons)",
      "kind": "moon",
      "orbits": "the gas giant Endor",
      "lore": "Another of the gas giant's nine moons, unnamed in lore. **Ours:** a small, airless moon of grey rock that trails the bigger moon across the night.",
      "look": "A small grey cratered disc with no air or cloud, dimmer than the big moon (6.9° in SWG, 50° off the night light).",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore counts nine moons of the gas giant and names only the forest moon and Kef Bir.",
      "sources": [
        {
          "title": "StarWars.com Databank: Endor",
          "url": "https://www.starwars.com/databank/endor"
        },
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        }
      ]
    },
    "endor:celestial:cels_endor": {
      "name": "Endor, the gas giant",
      "kind": "gas giant",
      "orbits": "the Endor system's star",
      "lore": "The forest moon circles a gas giant that shares the name Endor, with nine moons of its own. The Ewok films and some novels show it in the moon's sky, though the Return of the Jedi novelization claimed it had been lost in some ancient catastrophe.",
      "look": "A huge, softly banded globe, pale silver-blue (canon calls it blue, a technical study pale and silvery), no rings, 36.9° in SWG and fixed behind, 30° up. SWG's own ground picture is warm brown.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Both continuities name the gas giant Endor and put it in the forest moon's sky.",
      "sources": [
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        },
        {
          "title": "Star Wars Technical Commentaries: Planets (TheForce.Net)",
          "url": "https://www.theforce.net/swtc/orbs.html"
        }
      ]
    },
    "kashyyyk_main:sun": {
      "name": "Kashyyyk (the star)",
      "kind": "star",
      "orbits": "nothing (the Kashyyyk system's single star)",
      "lore": "The single star of the Kashyyyk system in the Mid Rim, which the Wookiee homeworld shares with Trandosha, the Trandoshans' world. Fan references give the star the planet's own name.",
      "look": "An ordinary yellow-white sun of normal size, as SWG draws it (28.1°).",
      "continuity": "both",
      "confidence": "inferred",
      "why": "One star is lore; its name comes only from fan references.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "The Last of the Droids wiki: Kashyyyk",
          "url": "https://thelastofthedroids.miraheze.org/wiki/Kashyyyk"
        },
        {
          "title": "Mandalorian Mercs: Planet analysis, Kashyyyk",
          "url": "https://mandalorianmercs.org/planet-analysis-kashyyyk/"
        }
      ]
    },
    "kashyyyk_main:moon": {
      "name": "one of Kashyyyk's three moons (unnamed in lore)",
      "kind": "moon",
      "orbits": "Kashyyyk",
      "lore": "Kashyyyk has three moons, none named in lore. **Ours:** a pale moon, the one that rides the night light.",
      "look": "A pale yellow-tan disc (13.3° in SWG); if the two-moon night sheet is shown, it already holds two of the moons, so this slot would double one of them.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives three moons but no names. SWG's Kashyyyk sky is its generic default sky (the same as its test skies), not a Kashyyyk design. Wookieepedia is said to have the Wookiees settle two of the moons; it refused us, so that is not used.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Mandalorian Mercs: Planet analysis, Kashyyyk",
          "url": "https://mandalorianmercs.org/planet-analysis-kashyyyk/"
        },
        {
          "title": "Wookieepedia: Kashyyyk (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Kashyyyk/Legends"
        }
      ]
    },
    "kashyyyk_main:moon2": {
      "name": "Trandosha (the owner's choice of 20 November)",
      "kind": "planet",
      "orbits": "Kashyyyk's star, beside Kashyyyk",
      "lore": "The Trandoshans' homeworld, Kashyyyk's neighbour in the same system and the source of its hunters and slavers. **Ours:** lore has no fourth body in Kashyyyk's sky, so the owner let Trandosha take this slot, seen as a small disc when the two worlds swing close.",
      "look": "A small green world marbled with white cloud. The viewer's Trandosha look is Felucia's menu circle.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Trandosha shares Kashyyyk's system in Legends; showing it in this slot, at this size, is the owner's choice.",
      "sources": [
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        },
        {
          "title": "Mandalorian Mercs: Planet analysis, Kashyyyk",
          "url": "https://mandalorianmercs.org/planet-analysis-kashyyyk/"
        }
      ]
    },
    "kashyyyk_main:celestial:cels_moon_earthy01": {
      "name": "one of Kashyyyk's three moons (unnamed in lore)",
      "kind": "moon",
      "orbits": "Kashyyyk",
      "lore": "Another of Kashyyyk's three unnamed moons. **Ours:** a mottled brown-and-grey world, the nearest of the three.",
      "look": "A large mauve-brown mottled moon, the biggest disc in Kashyyyk's sky (22.6°, fixed ahead, 20° up); drop it if the two-moon night sheet is shown.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives three moons but no names.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Mandalorian Mercs: Planet analysis, Kashyyyk",
          "url": "https://mandalorianmercs.org/planet-analysis-kashyyyk/"
        }
      ]
    },
    "kashyyyk_main:celestial:cels_mars1": {
      "name": "Kashyyyk's orange moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Kashyyyk",
      "lore": "Of Kashyyyk's three moons, one is said to be orange; it has no name. **Ours:** a dry, dusty moon nobody settled.",
      "look": "A smallish orange-red moon (SWG's Mars-like picture, 11.4°, fixed behind, 15° up), warm against the green-blue sky.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "SWG's reddish picture matches the one moon a fan reference calls orange.",
      "sources": [
        {
          "title": "The Last of the Droids wiki: Kashyyyk",
          "url": "https://thelastofthedroids.miraheze.org/wiki/Kashyyyk"
        }
      ]
    },
    "lok:sun": {
      "name": "Lok's sun (unnamed in the sources we could open)",
      "kind": "star",
      "orbits": "nothing (the Karthakk system's single star)",
      "lore": "The one star of the Karthakk system, home of the pirate world Lok. The sources we could open do not name it.",
      "look": "Lore gives no colour; a harsh white-gold sun seen through dusty, sulphurous haze suits Lok (ours). SWG draws it very large, 36.9°.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "Lore gives Lok one sun but no name we could check; the researchers' name for it rests on Wookieepedia, which refused us.",
      "sources": [
        {
          "title": "Star Wars D6 wiki: Lok",
          "url": "https://starwarsd6.miraheze.org/wiki/Lok"
        },
        {
          "title": "SWG Legends wiki: Karthakk system",
          "url": "https://swglegends.com/wiki/index.php?title=Karthakk_system"
        }
      ]
    },
    "lok:moon": {
      "name": "Lok's larger moon (unnamed in the sources we could open)",
      "kind": "moon",
      "orbits": "Lok",
      "lore": "One of the two moons of Lok, the barren pirate world of the Karthakk system. Neither moon is named in the sources we could open. **Ours:** the larger and nearer of the pair, grey and airless.",
      "look": "A grey, rocky, airless disc, the largest moon in Lok's sky at 18.9° in SWG.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "A reference wiki gives Lok two moons. The researchers' name Khons, and the cannon battle fought on it, rest on Wookieepedia and game guides that all refused us, so the name is held back until it can be checked.",
      "sources": [
        {
          "title": "Star Wars Saga Edition wiki: Lok",
          "url": "https://swse.miraheze.org/wiki/Lok"
        },
        {
          "title": "Wookieepedia: Khons (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Khons"
        }
      ]
    },
    "lok:moon2": {
      "name": "unnamed in lore",
      "kind": "moon",
      "orbits": "ours: Lok, as a third moon",
      "lore": "**Ours.** SWG shows three moons over Lok, one more than lore's count of two, so this one has no lore of its own. A small, rust-red captured rock would fit Lok's harsh system.",
      "look": "A small red, Mars-like disc, 7.6° in SWG, 50° aside and 23° below the main moon.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "One body more than lore's two moons.",
      "sources": [
        {
          "title": "Star Wars Saga Edition wiki: Lok",
          "url": "https://swse.miraheze.org/wiki/Lok"
        }
      ]
    },
    "lok:celestial:cels_moon_mercury": {
      "name": "Lok's second moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Lok",
      "lore": "The other of Lok's two moons, unnamed in lore. **Ours:** a small cratered rock.",
      "look": "A grey, cratered, Mercury-like disc 13.3° across, fixed low ahead (5° up); it suits an airless moon.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "Lore counts two moons; this is the second largest of SWG's three.",
      "sources": [
        {
          "title": "Star Wars Saga Edition wiki: Lok",
          "url": "https://swse.miraheze.org/wiki/Lok"
        }
      ]
    },
    "mustafar:sun": {
      "name": "Priate",
      "kind": "star",
      "orbits": "nothing (the Mustafar system's star)",
      "lore": "The star of the Mustafar system in canon, circled by Mustafar and the gas giants Jestefad and Lefrani. No Legends name was found; Mustafar's ash-choked sky seldom shows it clearly.",
      "look": "A sun seen through ash: a dimmed, orange-red disc with a muddy glow, smaller and weaker than SWG's default bright sun (28.1°).",
      "continuity": "canon",
      "confidence": "named in lore",
      "why": "Fan references name the star Priate from canon works.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "May 4 Be With You: what are the two large planets behind Mustafar?",
          "url": "https://may4bewithyou.com/what-are-these-two-large-planets-behind-mustafar-is-mustafar-a-moon-pda01/"
        }
      ]
    },
    "mustafar:moon": {
      "name": "Nur (the owner's choice of 20 November)",
      "kind": "moon",
      "orbits": "Mustafar, in this sky (sources disagree: Mustafar or the gas giant Jestefad)",
      "lore": "Canon's ocean moon of the Mustafar system: a world of rough open sea with no land, where the Inquisitors' fortress stood with nearly all of its bulk under the water. **Ours:** SWG puts its sun picture in this moon slot; the owner chose to let Nur take it, since lore gives Mustafar no other moon.",
      "look": "A small blue-grey ocean world with no land, cooler than anything else in Mustafar's red and ash sky. The viewer's Nur look is Kamino's ocean made colder and darker.",
      "continuity": "canon",
      "confidence": "inferred",
      "why": "Nur is canon's moon of the Mustafar system; which body it circles is disputed, and putting it in this slot is the owner's choice.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        },
        {
          "title": "May 4 Be With You: what are the two large planets behind Mustafar?",
          "url": "https://may4bewithyou.com/what-are-these-two-large-planets-behind-mustafar-is-mustafar-a-moon-pda01/"
        }
      ]
    },
    "naboo:sun": {
      "name": "Naboo (the star)",
      "kind": "star",
      "orbits": "nothing (the system's single star)",
      "lore": "The single star of the Naboo system, which shares its name with the system's best-known world. Naboo, its three moons and the rest of the system circle it.",
      "look": "A warm yellow-white disc with a gentle glow, 22.6° in SWG.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "A fan reference names the system's one star Naboo; lore gives it no colour, so the colour is ours.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "naboo:moon": {
      "name": "Rori",
      "kind": "moon",
      "orbits": "Naboo",
      "lore": "One of Naboo's three moons, wetter and swampier than Naboo itself, with denser forest where forest grows and rain more often. King Narmle sent colonists to settle it; the city named for him is its one working town, and Restuss has a starport.",
      "look": "Dull green and brown with dark swamp under frequent rain cloud; the largest disc in Naboo's sky at 15.2°. The owner's \"Rori from the ground\" look suits it.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "The owner's choice, and lore makes Rori a moon of Naboo (SWG's own addition to its moons). Lore gives no sizes, so drawing it the largest is free.",
      "sources": [
        {
          "title": "SWG Restoration wiki: Rori",
          "url": "https://swgr.org/wiki/rori/"
        },
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        }
      ]
    },
    "naboo:moon2": {
      "name": "Ohma-D'un",
      "kind": "moon",
      "orbits": "Naboo",
      "lore": "A moon of Naboo where Gungans built domed colonies after the Battle of Naboo. Early in the Clone Wars a Separatist gas wiped out the colony, and Jedi sent to learn why fought Asajj Ventress and Durge across its murky plains.",
      "look": "Legends pictures it two ways, as a grey dead moon in one encyclopedia and as swampy land fit for a colony in a game; a murky green-brown disc suits the colony story better than SWG's yellow picture at 8.4°.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Named in lore; lore gives no sizes in the sources we could open, so which disc is Ohma-D'un is a choice. The researchers' \"largest moon\" and \"Water Moon\" rest only on Wookieepedia (refused) and a role-play site, and are dropped.",
      "sources": [
        {
          "title": "Rebelscum Jedi Journals: Star Wars: Republic, the Ohma-D'un issue",
          "url": "http://www.rebelscum.com/jedijournals/issue.asp?id=ISU1433"
        },
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        },
        {
          "title": "CBR: how The Gungan Frontier explored Naboo's ecosystem",
          "url": "https://www.cbr.com/star-wars-gungan-frontier-naboo-biodiversity/"
        }
      ]
    },
    "naboo:celestial:cels_moon_mercury": {
      "name": "Third moon of Naboo (unnamed in Legends; canon calls it Veruna)",
      "kind": "moon",
      "orbits": "Naboo",
      "lore": "The last of Naboo's three moons, which Legends never names. Canon reference books call it little more than an asteroid, and the 2017 Visual Encyclopedia names it Veruna, after a former king; a canon novel also names a Naboo moon Onoam.",
      "look": "A small, airless, lumpy grey rock covered in craters; SWG's grey picture at 5.7° already suits it.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Canon calls the third moon little more than an asteroid, which matches SWG's smallest Naboo body and its grey, cratered picture.",
      "sources": [
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        }
      ]
    },
    "rori:sun": {
      "name": "Naboo (the star)",
      "kind": "star",
      "orbits": "nothing (the system's single star)",
      "lore": "The single star of the Naboo system, which shares its name with the system's best-known world. Naboo, its three moons and the rest of the system circle it.",
      "look": "Warm yellow-white, 26.3° in SWG with a modest glow, often softened by Rori's rainy sky.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "A fan reference names the system's one star Naboo; lore gives it no colour, so the colour is ours.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "rori:moon": {
      "name": "Ohma-D'un",
      "kind": "moon",
      "orbits": "Naboo",
      "lore": "A moon of Naboo where Gungans built domed colonies after the Battle of Naboo. Early in the Clone Wars a Separatist gas wiped out the colony, and Jedi sent to learn why fought Asajj Ventress and Durge across its murky plains.",
      "look": "Seen from Rori, a large murky green-brown disc; SWG draws it 18.9° in a yellow picture, which suits neither of lore's pictures of it.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "The largest of Rori's moon pictures is given to Ohma-D'un by choice; lore gives no sizes in the sources we could open.",
      "sources": [
        {
          "title": "Rebelscum Jedi Journals: Star Wars: Republic, the Ohma-D'un issue",
          "url": "http://www.rebelscum.com/jedijournals/issue.asp?id=ISU1433"
        },
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        },
        {
          "title": "CBR: how The Gungan Frontier explored Naboo's ecosystem",
          "url": "https://www.cbr.com/star-wars-gungan-frontier-naboo-biodiversity/"
        }
      ]
    },
    "rori:moon2": {
      "name": "unnamed in lore",
      "kind": "moon",
      "orbits": "ours: Naboo, as a fourth moon",
      "lore": "**Ours.** Lore gives Naboo three moons and Rori none of its own, so this fourth body in Rori's sky has no counterpart. Keep it as a small, far body of our own, or drop it.",
      "look": "A small teal disc, 7.6° in SWG; if kept, keep it small and pale so it does not compete with Naboo and Ohma-D'un.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "One body more than lore's three moons of Naboo.",
      "sources": [
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        }
      ]
    },
    "rori:celestial:cels_naboo": {
      "name": "Naboo (the planet)",
      "kind": "planet",
      "orbits": "the star Naboo",
      "lore": "A mild, green world of plains, swamps, forests and lakes, home to the human Naboo of Theed and to the Gungans in their cities beneath the water. Its three moons are Rori, Ohma-D'un and a third that Legends leaves unnamed.",
      "look": "A large green-and-blue world banded with white cloud and glinting lakes, the biggest thing in Rori's sky at 36.9°, high overhead (SWG sets it at pitch 140). The owner's Naboo look suits it.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "SWG's picture is Naboo, and lore makes Rori its moon.",
      "sources": [
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        },
        {
          "title": "SWG Restoration wiki: Rori",
          "url": "https://swgr.org/wiki/rori/"
        }
      ]
    },
    "rori:celestial:moon_single": {
      "name": "Third moon of Naboo (unnamed in Legends; canon calls it Veruna)",
      "kind": "moon",
      "orbits": "Naboo",
      "lore": "The last of Naboo's three moons, which Legends never names. Canon reference books call it little more than an asteroid, and the 2017 Visual Encyclopedia names it Veruna, after a former king; a canon novel also names a Naboo moon Onoam.",
      "look": "A small grey, cratered, irregular rock; SWG's grey picture at 9.5° suits it, though a smaller disc reads truer to an asteroid-sized moon.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "The grey moon picture best fits the asteroid-like third moon.",
      "sources": [
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        }
      ]
    },
    "space_corellia:planet_corellia": {
      "name": "Corellia",
      "kind": "planet",
      "orbits": "Corell",
      "lore": "An old, industrial Core world, the namesake of its system, famed for its pilots and starships. Its capital, Coronet City, stands on the coast beside its shipyards, and at least three moons circle it.",
      "look": "Blue seas, green and gold land and white cloud, with city lights on the night side; 54.6° across in the zone.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "The zone's own planet.",
      "sources": [
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        },
        {
          "title": "Star Wars One Canon wiki: Corellia",
          "url": "https://onecanon.miraheze.org/wiki/Corellia"
        }
      ]
    },
    "space_corellia:planet_corl_moon_01#1": {
      "name": "Gus Talon",
      "kind": "moon",
      "orbits": "Corellia",
      "lore": "A moon of Corellia, first named in a Legends comic about Wedge Antilles's youth and later used again in canon. A Legends geography makes it the base of the Talon shipyards.",
      "look": "3.4° across here; the owner's Takodana look stands for it, which lore neither supports nor rules out.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Matched to the owner's \"Corellia's moon\". SWG's Talus station lies toward this body (31° off), which hints SWG may have meant it for Talus, but the zone's three bodies are read as Corellia's moons.",
      "sources": [
        {
          "title": "Numidian Prime: Midnight Horizon continuity breakdown",
          "url": "https://numidianprime.wordpress.com/2022/02/03/midnight-horizon-continuity-breakdown/"
        },
        {
          "title": "Star Wars One Canon wiki: Corellia",
          "url": "https://onecanon.miraheze.org/wiki/Corellia"
        },
        {
          "title": "Mithril Tabby: The Core Worlds",
          "url": "https://www.mithriltabby.com/starwars/galaxy/coreworlds.xhtml"
        }
      ]
    },
    "space_corellia:planet_corl_moon_01#2": {
      "name": "Gus Treta",
      "kind": "moon",
      "orbits": "Corellia",
      "lore": "A moon of Corellia best known for the fuel depot station in its orbit. Wedge Antilles's parents ran the depot and died when pirates attacked the station, shortly before he came of age.",
      "look": "The smallest and farthest of the zone's three at 2.5°; a dull tan-grey rock.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "The farthest of the three (681 against 510); lore does not say which moon is outermost, so this is a choice.",
      "sources": [
        {
          "title": "Star Wars One Canon wiki: Wedge Antilles",
          "url": "https://onecanon.miraheze.org/wiki/Wedge_Antilles"
        },
        {
          "title": "Star Wars One Canon wiki: Corellia",
          "url": "https://onecanon.miraheze.org/wiki/Corellia"
        }
      ]
    },
    "space_corellia:planet_corl_moon_01#3": {
      "name": "Corellia's third moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Corellia",
      "lore": "Corellia is given at least three moons, but only Gus Talon and Gus Treta are named. **Ours:** a brown-grey rocky moon, the nearest of the three.",
      "look": "3.4° across, 8° from Gus Treta in the sky; a brown-grey rocky moon, matching the earthy one of Corellia's ground sky.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "The remaining moon of the three.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Star Wars One Canon wiki: Corellia",
          "url": "https://onecanon.miraheze.org/wiki/Corellia"
        }
      ]
    },
    "space_dantooine:planet_dantooine": {
      "name": "Dantooine",
      "kind": "planet",
      "orbits": "Dina",
      "lore": "A remote, thinly settled Outer Rim world of rolling grassland and plains, with savannas, steppes, rivers, mountains and ocean. The Rebel Alliance was formally founded there, and by this game's time its base on Dantooine stands abandoned.",
      "look": "Soft greens and golds with lavender-tinged grassland, blue lakes and sea, and light cloud; 36.3° here. The owner's darker, more purple Ryloth agrees on the purple, but lore's world is lighter and shows water.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "The zone's own planet.",
      "sources": [
        {
          "title": "JEDI HoloNet archives: Dantooine",
          "url": "https://www.jediholo.net/archives/galaxy/dantooine/"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        }
      ]
    },
    "space_dantooine:planet_corl_moon_01": {
      "name": "unnamed in lore",
      "kind": "moon",
      "orbits": "ours: Dantooine",
      "lore": "**Ours.** Lore gives Dantooine two moons and the zone shows three, so this one has no counterpart. Keep it as a small, far body of our own, or drop it.",
      "look": "A small grey disc, 2.7° here; keep it plain and dim.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "One body more than lore's two moons.",
      "sources": [
        {
          "title": "JEDI HoloNet archives: Dantooine",
          "url": "https://www.jediholo.net/archives/galaxy/dantooine/"
        }
      ]
    },
    "space_dantooine:planet_naboo_moon#1": {
      "name": "Dantooine's lesser moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Dantooine",
      "lore": "The smaller of Dantooine's two moons, unnamed in lore. **Ours:** a small moon with a greenish cast.",
      "look": "A small green-tinged disc, 2.6° here.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "It shares its picture with the larger moon; the zone's third body (planet_corl_moon_01, 2.7°) could stand for it equally well.",
      "sources": [
        {
          "title": "JEDI HoloNet archives: Dantooine",
          "url": "https://www.jediholo.net/archives/galaxy/dantooine/"
        }
      ]
    },
    "space_dantooine:planet_naboo_moon#2": {
      "name": "Dantooine's larger moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Dantooine",
      "lore": "The larger of Dantooine's two moons, unnamed in lore. **Ours:** pale, with a faint lavender cast.",
      "look": "The zone's nearest and largest moon at 16.4°; pale with a lavender cast.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "The zone's biggest moon matched to lore's larger moon.",
      "sources": [
        {
          "title": "JEDI HoloNet archives: Dantooine",
          "url": "https://www.jediholo.net/archives/galaxy/dantooine/"
        }
      ]
    },
    "space_dathomir:planet_dathomir": {
      "name": "Dathomir",
      "kind": "planet",
      "orbits": "Domir",
      "lore": "A remote world of twisted forest, swamp and mountain, home to the Force-wielding witch clans, among them the Nightsisters. Its sun stains everything red.",
      "look": "Rust-red and dusky crimson with black-green forest and swamp showing through, a thin reddish haze at the rim; 51.9° here. The owner's dead-world stand-in agrees on darkness and red, but lore's world is alive, so some dark green brings it closer.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "SWG's zone draws Dathomir's own planet picture here.",
      "sources": [
        {
          "title": "StarWars.com Databank: Dathomir",
          "url": "https://www.starwars.com/databank/dathomir"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        }
      ]
    },
    "space_dathomir:planet_tatooine_moon_02#1": {
      "name": "unnamed in lore (one of Dathomir's four moons)",
      "kind": "moon",
      "orbits": "Dathomir",
      "lore": "One of Dathomir's four moons. **Ours:** the nearest to this zone's station, cratered and airless.",
      "look": "A tan-grey cratered moon, 8.1° across, behind and to the right, lit warm by the red sun.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "A fan reference gives Dathomir four moons and names none.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_dathomir:planet_tatooine_moon_02#2": {
      "name": "unnamed in lore (one of Dathomir's four moons)",
      "kind": "moon",
      "orbits": "Dathomir",
      "lore": "Another of Dathomir's four moons. **Ours:** a dusty rock moon.",
      "look": "A tan-grey moon, 6.1° across, ahead and to the left, a little up.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "A fan reference gives Dathomir four moons and names none.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_dathomir:planet_tatooine_moon_02#3": {
      "name": "unnamed in lore (one of Dathomir's four moons)",
      "kind": "moon",
      "orbits": "Dathomir",
      "lore": "A third of Dathomir's four moons; the zone shows three of the four. **Ours:** a small, distant outer moon.",
      "look": "A small tan-grey disc, 2.5° across, to the left and a little down.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "A fan reference gives Dathomir four moons and names none.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_endor:planet_gas_endor": {
      "name": "Endor, the gas giant",
      "kind": "gas giant",
      "orbits": "the Endor system's star",
      "lore": "The gas giant at the heart of the Endor system, mother world to nine moons, the forest moon the largest of them. The system's remoteness is why the Empire hid the second Death Star there.",
      "look": "Pale blue-silver with soft, broad bands and faint storms, no rings; enormous from this zone (85.6°), dominating the view behind the forest moon.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "The same body as Endor's sky celestial.",
      "sources": [
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        },
        {
          "title": "Star Wars Technical Commentaries: Planets (TheForce.Net)",
          "url": "https://www.theforce.net/swtc/orbs.html"
        }
      ]
    },
    "space_endor:planet_endor": {
      "name": "the Forest Moon of Endor",
      "kind": "moon",
      "orbits": "the gas giant Endor",
      "lore": "A remote moon of towering forest, savanna, grassland and mountains with a few seas, home to the Ewoks and other forest peoples. The Empire chose it for the shield generator that guards the second Death Star; at this game's time it is still a quiet backwater.",
      "look": "Deep green forest broken by darker mountain ranges, pale grassland and a few lakes and seas, with scattered cloud; 50.2° here, second only to the gas giant.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "SWG's zone draws Endor's own planet picture here.",
      "sources": [
        {
          "title": "StarWars.com Databank: Endor",
          "url": "https://www.starwars.com/databank/endor"
        },
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        }
      ]
    },
    "space_endor:planet_naboo_moon#1": {
      "name": "unnamed in lore (one of the gas giant Endor's nine moons)",
      "kind": "moon",
      "orbits": "the gas giant Endor",
      "lore": "One of the gas giant's lesser moons. **Ours:** a small cold moon, far below the zone's plane.",
      "look": "A small dim moon, 4.0° and 56° below; SWG gives it the teal picture, but greyer, icier tones keep Kef Bir the only blue moon.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore counts nine moons of the gas giant and names only the forest moon and Kef Bir.",
      "sources": [
        {
          "title": "StarWars.com Databank: Endor",
          "url": "https://www.starwars.com/databank/endor"
        },
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        }
      ]
    },
    "space_endor:planet_tatooine_moon": {
      "name": "unnamed in lore (one of the gas giant Endor's nine moons)",
      "kind": "moon",
      "orbits": "the gas giant Endor",
      "lore": "Another of the gas giant's nine moons, unnamed in either continuity. **Ours:** a dusty tan rock moon with no air.",
      "look": "A tan cratered moon, 7.4° across, ahead and a little left of the view; matte and airless.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore counts nine moons of the gas giant and names only the forest moon and Kef Bir.",
      "sources": [
        {
          "title": "StarWars.com Databank: Endor",
          "url": "https://www.starwars.com/databank/endor"
        },
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        }
      ]
    },
    "space_endor:planet_naboo_moon#2": {
      "name": "Kef Bir (canon); unnamed in Legends",
      "kind": "moon",
      "orbits": "the gas giant Endor",
      "lore": "The ocean moon of the Endor system, one of the gas giant's nine: stormy seas, cliffs and grass, in the giant's shadow. Decades after this game's time it is where the second Death Star's wreck ends up.",
      "look": "A blue-teal ocean moon with white cloud, 5.3° ahead and right of the view; SWG's teal picture already fits.",
      "continuity": "canon",
      "confidence": "inferred",
      "why": "The largest of the zone's three teal moons, the picture that suits an ocean moon; it pairs with endor:moon so both places show the same body.",
      "sources": [
        {
          "title": "StarWars.com Databank: Endor",
          "url": "https://www.starwars.com/databank/endor"
        },
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        }
      ]
    },
    "space_endor:planet_naboo_moon#3": {
      "name": "unnamed in lore (one of the gas giant Endor's nine moons)",
      "kind": "moon",
      "orbits": "the gas giant Endor",
      "lore": "A far, small moon of the gas giant. **Ours:** an icy outer moon.",
      "look": "A small pale moon, 3.0°, far to the right; greyer or icier than SWG's teal so it is not taken for Kef Bir.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore counts nine moons of the gas giant and names only the forest moon and Kef Bir.",
      "sources": [
        {
          "title": "StarWars.com Databank: Endor",
          "url": "https://www.starwars.com/databank/endor"
        },
        {
          "title": "Wikipedia: Endor (Star Wars)",
          "url": "https://en.wikipedia.org/wiki/Endor_(Star_Wars)"
        }
      ]
    },
    "space_heavy1:planet_tatooine_moon_02": {
      "name": "unnamed (a lone rock in deep space)",
      "kind": "other",
      "orbits": "nothing named: SWG titles the zone \"Deep Space\"",
      "lore": "**Ours.** The zone stands for empty space between systems and has no setting in lore. A rogue planetoid drifting far below is the only landmark.",
      "look": "A small (2.0°) tan-grey disc almost straight below the view, dimly lit.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "The zone has no lore setting.",
      "sources": []
    },
    "space_kashyyyk:planet_tatooine_moon_02": {
      "name": "Kashyyyk's orange moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Kashyyyk",
      "lore": "One of Kashyyyk's three moons; SWG puts a small tan moon straight below the zone. **Ours:** give it the orange moon's look, so ground and orbit agree.",
      "look": "A small (2.0°) tan-orange moon almost directly beneath the view.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives three moons; which one this is is our choice, made to pair with the orange moon of Kashyyyk's sky.",
      "sources": [
        {
          "title": "The Last of the Droids wiki: Kashyyyk",
          "url": "https://thelastofthedroids.miraheze.org/wiki/Kashyyyk"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_kashyyyk:planet_kashyyyk": {
      "name": "Kashyyyk",
      "kind": "planet",
      "orbits": "Kashyyyk's star",
      "lore": "The Wookiee homeworld, a planet of immense forest, ocean and swamp, where Wookiees build their homes in the trees. At this game's time the Empire holds it and works Wookiees as forced labour, many of them on Kessel.",
      "look": "Rich deep green forest with blue seas and lakes, dense white cloud and a soft blue-green rim; 53.0° here.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "SWG's zone draws Kashyyyk's own planet picture here.",
      "sources": [
        {
          "title": "StarWars.com Databank: Kashyyyk",
          "url": "https://www.starwars.com/databank/kashyyyk"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        }
      ]
    },
    "space_light1:planet_kessel": {
      "name": "Kessel",
      "kind": "planet",
      "orbits": "the Kessel system's star",
      "lore": "A grim spice-mining world whose thin, poisonous air is largely made by atmosphere factories; under the Empire it is a prison colony where convicts dig spice. In canon the Pyke Syndicate runs its mines, and ships reach it through a storm-racked route past a red gravity well, the Maw.",
      "look": "A dusty tan-brown world with a thin hazy rim and little cloud, 47.5° here; following canon instead, wrap it in dark storm cloud lit by lightning.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "SWG titles this zone the Kessel System and draws Kessel's planet picture here.",
      "sources": [
        {
          "title": "TheForce.Net, Completely Unofficial Star Wars Encyclopedia: Kessel",
          "url": "https://www.theforce.net/swenc/newdescr.asp?search=13648&tab=d"
        },
        {
          "title": "Star Wars Saga Edition wiki: Kessel",
          "url": "https://swse.miraheze.org/wiki/Kessel"
        },
        {
          "title": "StarWars.com Databank: Kessel",
          "url": "https://www.starwars.com/databank/kessel"
        },
        {
          "title": "StarWars.com: Designing Solo, part 2: the Kessel Run",
          "url": "https://www.starwars.com/news/designing-solo-a-star-wars-story-part-2-the-kessel-run"
        }
      ]
    },
    "space_light1:planet_tatooine_moon_03#1": {
      "name": "Kessel's garrison moon",
      "kind": "moon",
      "orbits": "Kessel",
      "lore": "Kessel's single moon in Legends, where the Empire keeps the garrison that runs the spice mines and the prison; guards and officials go down to the surface in shifts. Years after this game's time a test shot from a prototype Death Star, aimed at Kessel, destroys the moon instead.",
      "look": "A dull grey-tan cratered moon, 10.8°, the nearest and largest moon in the zone; a few lights or docking structures on its face would mark the garrison.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "Legends gives Kessel exactly one moon; the zone's largest and nearest moon goes to it.",
      "sources": [
        {
          "title": "TheForce.Net, Completely Unofficial Star Wars Encyclopedia: Kessel",
          "url": "https://www.theforce.net/swenc/newdescr.asp?search=13648&tab=d"
        },
        {
          "title": "Star Wars Saga Edition wiki: Kessel",
          "url": "https://swse.miraheze.org/wiki/Kessel"
        }
      ]
    },
    "space_light1:planet_tatooine_moon_03#2": {
      "name": "unnamed in lore",
      "kind": "other",
      "orbits": "ours: the Kessel system's star",
      "lore": "**Ours.** Legends gives Kessel one moon, so this second body has no counterpart. One of the system's other worlds, seen far off as a small tan disc.",
      "look": "A small (2.1°) tan-grey disc far behind and to the left.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "SWG shows three moons where Legends has one.",
      "sources": [
        {
          "title": "TheForce.Net, Completely Unofficial Star Wars Encyclopedia: Kessel",
          "url": "https://www.theforce.net/swenc/newdescr.asp?search=13648&tab=d"
        }
      ]
    },
    "space_light1:planet_tatooine_moon_03#3": {
      "name": "unnamed in lore",
      "kind": "other",
      "orbits": "ours: Kessel",
      "lore": "**Ours.** No lore counterpart: Kessel has one moon in Legends. A captured chunk of rock dragged toward the Maw, tumbling high above the zone.",
      "look": "A small (6.1°) tan-grey rocky body high overhead, lumpy rather than round.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "SWG shows three moons where Legends has one.",
      "sources": [
        {
          "title": "TheForce.Net, Completely Unofficial Star Wars Encyclopedia: Kessel",
          "url": "https://www.theforce.net/swenc/newdescr.asp?search=13648&tab=d"
        }
      ]
    },
    "space_lok:planet_lok": {
      "name": "Lok",
      "kind": "planet",
      "orbits": "the Karthakk system's star",
      "lore": "A barren, dusty world of the Outer Rim: hardened desert, high plateaus, volcanoes and lakes and rivers fouled with sulphur. Pirates hold it, and the pirate king Nym keeps his fortress there beside its one starport.",
      "look": "Ochre-brown and grey with dark mountain ridges, yellow sulphur patches and a few faint red volcanic glints, little cloud; 30.1° in the zone.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "The zone's own planet.",
      "sources": [
        {
          "title": "SWG Restoration wiki: Lok",
          "url": "https://swgr.org/wiki/lok/"
        },
        {
          "title": "Star Wars D6 wiki: Lok",
          "url": "https://starwarsd6.miraheze.org/wiki/Lok"
        },
        {
          "title": "Star Wars Saga Edition wiki: Lok",
          "url": "https://swse.miraheze.org/wiki/Lok"
        }
      ]
    },
    "space_lok:planet_tatooine_moon_02#1": {
      "name": "Lok's second moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Lok",
      "lore": "The other of Lok's two moons, unnamed in lore. **Ours:** a small grey rock.",
      "look": "A small grey rock, 3.0° here.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "The larger of the zone's two small moons.",
      "sources": [
        {
          "title": "Star Wars Saga Edition wiki: Lok",
          "url": "https://swse.miraheze.org/wiki/Lok"
        }
      ]
    },
    "space_lok:planet_tatooine_moon": {
      "name": "Lok's larger moon (unnamed in the sources we could open)",
      "kind": "moon",
      "orbits": "Lok",
      "lore": "One of Lok's two moons, the larger here. **Ours:** grey and airless.",
      "look": "A grey rocky moon, the zone's largest at 10.7°.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "The zone's biggest moon (radius 45 against 16); SWG's Lok station also lies toward it (20° off). The name Khons is held back, as on the ground.",
      "sources": [
        {
          "title": "Star Wars Saga Edition wiki: Lok",
          "url": "https://swse.miraheze.org/wiki/Lok"
        },
        {
          "title": "Wookieepedia: Khons (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Khons"
        }
      ]
    },
    "space_lok:planet_tatooine_moon_02#2": {
      "name": "unnamed in lore",
      "kind": "moon",
      "orbits": "ours: Lok",
      "lore": "**Ours.** SWG's third moon of Lok, one more than lore's count of two. It matches the red third moon of Lok's ground sky, a small captured rock.",
      "look": "The smallest, 1.6° here; a small rust-red rock, to match the ground sky.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "One body more than lore's two moons.",
      "sources": [
        {
          "title": "Star Wars Saga Edition wiki: Lok",
          "url": "https://swse.miraheze.org/wiki/Lok"
        }
      ]
    },
    "space_naboo:planet_naboo": {
      "name": "Naboo",
      "kind": "planet",
      "orbits": "the star Naboo",
      "lore": "A mild, green world of plains, swamps, forests and lakes, home to the human Naboo of Theed and to the Gungans in their cities beneath the water. Its three moons are Rori, Ohma-D'un and a third that Legends leaves unnamed.",
      "look": "Green and blue with swirling white cloud and many glinting lakes and swamps; 34.0° across in the zone.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "The zone's own planet.",
      "sources": [
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        },
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        }
      ]
    },
    "space_naboo:planet_naboo_moon#1": {
      "name": "Ohma-D'un",
      "kind": "moon",
      "orbits": "Naboo",
      "lore": "A moon of Naboo where Gungans built domed colonies after the Battle of Naboo. Early in the Clone Wars a Separatist gas wiped out the colony, and Jedi sent to learn why fought Asajj Ventress and Durge across its murky plains.",
      "look": "Murky green-brown with swampy plains, 4.5° here; not the Rori look the defaults give it.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Of the two far moons, this one is given to Ohma-D'un by choice; nothing in SWG or lore tells the two apart.",
      "sources": [
        {
          "title": "Rebelscum Jedi Journals: Star Wars: Republic, the Ohma-D'un issue",
          "url": "http://www.rebelscum.com/jedijournals/issue.asp?id=ISU1433"
        },
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        },
        {
          "title": "CBR: how The Gungan Frontier explored Naboo's ecosystem",
          "url": "https://www.cbr.com/star-wars-gungan-frontier-naboo-biodiversity/"
        }
      ]
    },
    "space_naboo:planet_naboo_moon#2": {
      "name": "Rori",
      "kind": "moon",
      "orbits": "Naboo",
      "lore": "One of Naboo's three moons, wetter and swampier than Naboo itself, with denser forest where forest grows and rain more often. King Narmle sent colonists to settle it; the city named for him is its one working town, and Restuss has a starport.",
      "look": "Murky green and brown with dark swamp and grey cloud; the nearest and largest moon here at 11.3°. The Rori look the owner gave all three suits this one.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "The zone lands on Rori and the owner has Rori as the prominent moon from Naboo, so the nearest moon is read as Rori. SWG's Rori station lines up with none of the three (59° to 72° off), so it does not decide.",
      "sources": [
        {
          "title": "SWG Restoration wiki: Rori",
          "url": "https://swgr.org/wiki/rori/"
        },
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        }
      ]
    },
    "space_naboo:planet_naboo_moon#3": {
      "name": "Third moon of Naboo (unnamed in Legends; canon calls it Veruna)",
      "kind": "moon",
      "orbits": "Naboo",
      "lore": "The last of Naboo's three moons, which Legends never names. Canon reference books call it little more than an asteroid, and the 2017 Visual Encyclopedia names it Veruna, after a former king; a canon novel also names a Naboo moon Onoam.",
      "look": "A small lumpy grey rock; SWG draws it 4.5°, the same as Ohma-D'un, so a smaller, irregular disc would match lore. Not the Rori look.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "The remaining moon; canon makes it the asteroid-like one.",
      "sources": [
        {
          "title": "Numidian Prime: The Moons of Naboo",
          "url": "https://numidianprime.wordpress.com/2020/02/02/the-moons-of-naboo/"
        }
      ]
    },
    "space_npe_falcon:planet_tatooine_moon_02": {
      "name": "unnamed (a lone rock in deep space)",
      "kind": "other",
      "orbits": "nothing named: SWG titles the zone \"Somewhere out in Space\"",
      "lore": "**Ours.** The zone stands for empty space between systems and has no setting in lore. A rogue planetoid drifting far below is the only landmark.",
      "look": "A small (2.0°) tan-grey disc almost straight below the view, dimly lit.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "The zone has no lore setting.",
      "sources": []
    },
    "space_npe_falcon_2:planet_tatooine_moon_02": {
      "name": "unnamed (a lone rock in deep space)",
      "kind": "other",
      "orbits": "nothing named: SWG titles the zone \"Somewhere out in Space\"",
      "lore": "**Ours.** The zone stands for empty space between systems and has no setting in lore. A rogue planetoid drifting far below is the only landmark.",
      "look": "A small (2.0°) tan-grey disc almost straight below the view, dimly lit.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "The zone has no lore setting.",
      "sources": []
    },
    "space_npe_falcon_3:planet_tatooine_moon_02": {
      "name": "unnamed (a lone rock in deep space)",
      "kind": "other",
      "orbits": "nothing named: SWG titles the zone \"Somewhere out in Space\"",
      "lore": "**Ours.** The zone stands for empty space between systems and has no setting in lore. A rogue planetoid drifting far below is the only landmark.",
      "look": "A small (2.0°) tan-grey disc almost straight below the view, dimly lit.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "The zone has no lore setting.",
      "sources": []
    },
    "space_ord_mantell:planet_ord_mantell": {
      "name": "Ord Mantell",
      "kind": "planet",
      "orbits": "Bright Jewel",
      "lore": "A rough Mid Rim world of mountainous plains and volcanic islands, long a haunt of smugglers and bounty hunters and scarred by old wars. It circles the star Bright Jewel and keeps at least fifteen moons; near this game's time Han Solo has his run-in with a bounty hunter there.",
      "look": "Mountain-brown and green land broken into volcanic islands by blue sea, with white cloud; 46.4° here. The owner's island-world stand-in agrees with lore's volcanic islands.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "SWG's zone draws Ord Mantell's own planet picture here.",
      "sources": [
        {
          "title": "Star Wars: The Old Republic Holonet: Ord Mantell",
          "url": "https://www.swtor.com/holonet/planets/ord-mantell"
        },
        {
          "title": "StarWars.com Databank: Ord Mantell",
          "url": "https://www.starwars.com/databank/ord-mantell"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_02#1": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "One of the smallest of Ord Mantell's fifteen or more moons. **Ours:** a grey-olive moonlet, little more than a captured asteroid.",
      "look": "A tiny dull grey-olive disc, 1.0° across.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_02#2": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "One of the smallest of Ord Mantell's fifteen or more moons. **Ours:** a grey-olive moonlet, little more than a captured asteroid.",
      "look": "A tiny dull grey-olive disc, 1.4° across.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_02#3": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "One of the smallest of Ord Mantell's fifteen or more moons. **Ours:** a grey-olive moonlet, little more than a captured asteroid.",
      "look": "A tiny dull grey-olive disc, 1.2° across.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_02#4": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "One of the smallest of Ord Mantell's fifteen or more moons. **Ours:** a grey-olive moonlet, little more than a captured asteroid.",
      "look": "A tiny dull grey-olive disc, 0.9° across.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_02#5": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "One of the smallest of Ord Mantell's fifteen or more moons. **Ours:** a grey-olive moonlet, little more than a captured asteroid.",
      "look": "A tiny dull grey-olive disc, 1.5° across, up and ahead; the nearest of its kind.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_02#6": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "One of the smallest of Ord Mantell's fifteen or more moons. **Ours:** a grey-olive moonlet, little more than a captured asteroid.",
      "look": "A tiny dull grey-olive disc, 0.7° across; the farthest of its kind.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon#1": {
      "name": "one of Ord Mantell's larger moons (unnamed in lore)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "One of Ord Mantell's fifteen or more moons; canon names one moon Quantxi, and the sources we could open name no other. **Ours:** a rusty red-orange moon, one of a matched pair.",
      "look": "SWG gives this and #2 the same size, larger than the rest, and a bright rust-orange picture; this one is the nearer (6.0°).",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Fan references speak of two large twin moons that raise strong tides, which we could not check in a source we opened; SWG's matched pair fits that account.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wookieepedia: Ord Mantell (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Ord_Mantell"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon#2": {
      "name": "one of Ord Mantell's larger moons (unnamed in lore)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "The other of SWG's matched pair among Ord Mantell's many moons. **Ours:** rust-orange like its partner.",
      "look": "The same size and rust-orange look as #1, here farther off (3.3°, ahead and a little up).",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Equal in SWG's size to #1; the twin-moon account is unchecked, as for #1.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_03#1": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "Ord Mantell keeps at least fifteen moons, and the sources we could open name only one of them. **Ours:** a small, dark, rusty rock.",
      "look": "A small dark reddish-brown moon, 2.8° across, up to the right.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_03#2": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "Ord Mantell keeps at least fifteen moons, and the sources we could open name only one of them. **Ours:** a small, dark, rusty rock.",
      "look": "A small dark reddish-brown moon, 2.5° across.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_03#3": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "Ord Mantell keeps at least fifteen moons, and the sources we could open name only one of them. **Ours:** a small, dark, rusty rock.",
      "look": "A small dark reddish-brown moon, 2.7° across, a little below the view.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_ord_mantell:planet_ord_mantell_moon_03#4": {
      "name": "unnamed in lore (one of Ord Mantell's many moons)",
      "kind": "moon",
      "orbits": "Ord Mantell",
      "lore": "Ord Mantell keeps at least fifteen moons, and the sources we could open name only one of them. **Ours:** a small, dark, rusty rock.",
      "look": "A small dark reddish-brown moon, 1.6° across, the farthest of its kind.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore gives the count, not this moon.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "space_sandbox:planet_tatooine#1": {
      "name": "unnamed (our invented sandbox system)",
      "kind": "planet",
      "orbits": "the sandbox system's star (ours)",
      "lore": "**Ours.** A far desert world of the made-up sandbox system, dressed in Tatooine's planet picture. It is not Tatooine.",
      "look": "A small (2.2°) desert-tan planet; a look other than Tatooine's would stop it reading as a second Tatooine.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "Our converter invents the sandbox system from a seed; nothing in it is in the game or in lore.",
      "sources": []
    },
    "space_sandbox:planet_tatooine_moon#1": {
      "name": "unnamed (our invented sandbox system)",
      "kind": "moon",
      "orbits": "a sandbox planet (ours)",
      "lore": "**Ours.** An invented moon of the sandbox system. Nothing in lore stands behind it.",
      "look": "A small (2.3°) tan cratered moon.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "Our converter invents the sandbox system from a seed; nothing in it is in the game or in lore.",
      "sources": []
    },
    "space_sandbox:planet_tatooine_moon_02#1": {
      "name": "unnamed (our invented sandbox system)",
      "kind": "moon",
      "orbits": "a sandbox planet (ours)",
      "lore": "**Ours.** An invented moon of the sandbox system. Nothing in lore stands behind it.",
      "look": "A tan-grey moon, 6.3° across.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "Our converter invents the sandbox system from a seed; nothing in it is in the game or in lore.",
      "sources": []
    },
    "space_sandbox:planet_tatooine_moon_02#2": {
      "name": "unnamed (our invented sandbox system)",
      "kind": "moon",
      "orbits": "a sandbox planet (ours)",
      "lore": "**Ours.** An invented moon of the sandbox system. Nothing in lore stands behind it.",
      "look": "A tan-grey moon, 4.7° across, high in the view.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "Our converter invents the sandbox system from a seed; nothing in it is in the game or in lore.",
      "sources": []
    },
    "space_sandbox:planet_tatooine#2": {
      "name": "unnamed (our invented sandbox system)",
      "kind": "planet",
      "orbits": "the sandbox system's star (ours)",
      "lore": "**Ours.** A second invented desert world of the sandbox system. It is not Tatooine either.",
      "look": "A desert-tan planet, 5.2° across; a different tint from #1 tells them apart.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "Our converter invents the sandbox system from a seed; nothing in it is in the game or in lore.",
      "sources": []
    },
    "space_sandbox:planet_tatooine_moon#2": {
      "name": "unnamed (our invented sandbox system)",
      "kind": "moon",
      "orbits": "a sandbox planet (ours)",
      "lore": "**Ours.** An invented moon of the sandbox system. Nothing in lore stands behind it.",
      "look": "A tan cratered moon, 8.5° across.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "Our converter invents the sandbox system from a seed; nothing in it is in the game or in lore.",
      "sources": []
    },
    "space_tatooine:planet_tatooine": {
      "name": "Tatooine",
      "kind": "planet",
      "orbits": "Tatoo I and Tatoo II",
      "lore": "A desert world of the Outer Rim circling the twin suns Tatoo I and II, with three moons and two gas giants, Ohann and Adriana, farther out. Dune seas and rocky badlands cover it, and its farmers draw water out of the dry air.",
      "look": "Sandy ochre and tan with paler flats and darker rocky ridges, almost cloudless; it fills 96.6° of the zone's view below.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "The zone's own planet.",
      "sources": [
        {
          "title": "Wikipedia: Tatooine",
          "url": "https://en.wikipedia.org/wiki/Tatooine"
        },
        {
          "title": "SYFY Bad Astronomy: Kepler-16b orbits two stars and is a gas giant",
          "url": "https://www.syfy.com/syfy-wire/bad-astronomy-exoplanet-kepler-16b-orbits-two-stars-and-is-a-gas-giant"
        }
      ]
    },
    "space_tatooine:planet_tatooine_moon": {
      "name": "Ghomrassen",
      "kind": "moon",
      "orbits": "Tatooine",
      "lore": "One of Tatooine's three moons, and here the largest and palest of them. Like its sisters it is named for a Berber village in southern Tunisia near where the films were shot; lore records little else about it.",
      "look": "A pale grey-white cratered moon, the largest of the zone's three at 11.2°.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore names three moons but, in the sources we could open, does not tell them apart by size or orbit, so which disc carries which name is our choice, made by size. Wookieepedia ranks them and gives one a long, stretched orbit, but it refused us, so none of that is used.",
      "sources": [
        {
          "title": "Carthage Magazine: Star Wars in Tunisia, a field guide to the real Tatooine",
          "url": "https://carthagemagazine.com/star-wars-sets-in-tunisia/"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wikipedia: Tatooine",
          "url": "https://en.wikipedia.org/wiki/Tatooine"
        },
        {
          "title": "Wookieepedia: Ghomrassen (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Ghomrassen/Legends"
        }
      ]
    },
    "space_tatooine:planet_tatooine_moon_02#1": {
      "name": "Guermessa",
      "kind": "moon",
      "orbits": "Tatooine",
      "lore": "Another of Tatooine's three moons, smaller than Ghomrassen in this sky. Its name, too, comes from a Tunisian village of the filming country.",
      "look": "A smaller grey or tan moon, 5.0° here.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore names three moons but, in the sources we could open, does not tell them apart by size or orbit, so which disc carries which name is our choice, made by size. Wookieepedia ranks them and gives one a long, stretched orbit, but it refused us, so none of that is used.",
      "sources": [
        {
          "title": "Carthage Magazine: Star Wars in Tunisia, a field guide to the real Tatooine",
          "url": "https://carthagemagazine.com/star-wars-sets-in-tunisia/"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wookieepedia: Guermessa (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Guermessa/Legends"
        }
      ]
    },
    "space_tatooine:planet_tatooine_moon_02#2": {
      "name": "Chenini",
      "kind": "moon",
      "orbits": "Tatooine",
      "lore": "The third of Tatooine's moons and the smallest in this sky. Chenini is a hilltop Berber village in southern Tunisia, and the moon carries its name.",
      "look": "The smallest and farthest of the three, 3.4° here; a dim, plain rocky disc.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore names three moons but, in the sources we could open, does not tell them apart by size or orbit, so which disc carries which name is our choice, made by size. Wookieepedia ranks them and gives one a long, stretched orbit, but it refused us, so none of that is used.",
      "sources": [
        {
          "title": "Carthage Magazine: Star Wars in Tunisia, a field guide to the real Tatooine",
          "url": "https://carthagemagazine.com/star-wars-sets-in-tunisia/"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wookieepedia: Chenini (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Chenini/Legends"
        }
      ]
    },
    "space_yavin4:planet_yavin": {
      "name": "Yavin Prime",
      "kind": "gas giant",
      "orbits": "Yavin, the system's star",
      "lore": "The orange gas giant of the Yavin system, about a third wider than Jupiter and storm-swept, orbited by some twenty-six moons. The Battle of Yavin was fought in its shadow as the Death Star rounded it toward Yavin 4.",
      "look": "Huge (67.6° from this zone), orange with streaky bands and storms, no rings; the brightest, warmest body in the zone. SWG's own orange picture suits it.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "The same body as yavin4:celestial:yavin_prime.",
      "sources": [
        {
          "title": "Wikipedia: Yavin",
          "url": "https://en.wikipedia.org/wiki/Yavin"
        },
        {
          "title": "Star Wars Technical Commentaries: Planets (TheForce.Net)",
          "url": "https://www.theforce.net/swtc/orbs.html"
        }
      ]
    },
    "space_yavin4:planet_naboo_moon#1": {
      "name": "Yavin 8",
      "kind": "moon",
      "orbits": "Yavin Prime",
      "lore": "One of the three moons of Yavin able to support life: cold tundra plains between polar ice caps, split by a purple equatorial mountain range. The amphibious Melodies live in its rivers and lakes.",
      "look": "About 11.3° across; SWG's picture is teal, but lore wants brown-green tundra with white poles and violet mountains, the same look as yavin4:celestial:cels_ice_moon.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "A New Hope's targeting display shows Yavin 4 and three other moons, as this zone does; the larger of the two remaining moons goes to the second named living moon.",
      "sources": [
        {
          "title": "Imperial Order: The Planetary Tour of Star Wars, \"Y\" (after Galaxy Guide 2: Yavin and Bespin)",
          "url": "http://www.imperialorder.org/galaxy/database/yfrm.html"
        },
        {
          "title": "Star Wars Technical Commentaries: Planets (TheForce.Net)",
          "url": "https://www.theforce.net/swtc/orbs.html"
        }
      ]
    },
    "space_yavin4:planet_tatooine_moon_03": {
      "name": "Yavin 13",
      "kind": "moon",
      "orbits": "Yavin Prime",
      "lore": "The desert moon of the Yavin system: rocky mesas, cactus forests and sand, with a great ocean in the south. The Gerbs keep burrow-villages under it and the Slith wander it by night.",
      "look": "Sandy tan and ochre with a southern sea and very little cloud, 9.1° across; SWG's tan picture fits the land.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "The tan picture fits the one desert moon lore names; it pairs with yavin4:moon.",
      "sources": [
        {
          "title": "Imperial Order: The Planetary Tour of Star Wars, \"Y\" (after Galaxy Guide 2: Yavin and Bespin)",
          "url": "http://www.imperialorder.org/galaxy/database/yfrm.html"
        }
      ]
    },
    "space_yavin4:planet_yavin4": {
      "name": "Yavin 4",
      "kind": "moon",
      "orbits": "Yavin Prime",
      "lore": "A hot moon of jungle, marsh and fast rivers, with oceans over about a third of its face and the ancient Massassi temples rising from the canopy. The Rebel Alliance hid its base in the Great Temple until the Battle of Yavin; in this game's time the rebels have just left it.",
      "look": "Deep green jungle with blue-green seas and plenty of white cloud, a gentle hazy rim; 24.1° here, set against the gas giant.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "SWG's zone draws Yavin 4's own planet picture here.",
      "sources": [
        {
          "title": "Wikipedia: Yavin",
          "url": "https://en.wikipedia.org/wiki/Yavin"
        },
        {
          "title": "Imperial Order: The Planetary Tour of Star Wars, \"Y\" (after Galaxy Guide 2: Yavin and Bespin)",
          "url": "http://www.imperialorder.org/galaxy/database/yfrm.html"
        }
      ]
    },
    "space_yavin4:planet_naboo_moon#2": {
      "name": "unnamed in lore (one of Yavin Prime's lesser moons)",
      "kind": "moon",
      "orbits": "Yavin Prime",
      "lore": "One of the twenty-odd moons of Yavin that lore leaves unnamed. **Ours:** a lifeless blue-grey rock in a wide orbit.",
      "look": "A small, dull blue-grey moon, 5.3° across, to the right of the view. It pairs with yavin4:moon2.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore counts about twenty-six moons and names only three (4, 8 and 13); this is one of the rest.",
      "sources": [
        {
          "title": "Wikipedia: Yavin",
          "url": "https://en.wikipedia.org/wiki/Yavin"
        },
        {
          "title": "Imperial Order: The Planetary Tour of Star Wars, \"Y\" (after Galaxy Guide 2: Yavin and Bespin)",
          "url": "http://www.imperialorder.org/galaxy/database/yfrm.html"
        }
      ]
    },
    "taanab:sun": {
      "name": "Taanab's sun (unnamed in lore)",
      "kind": "star",
      "orbits": "nothing (the Taanab system's single star)",
      "lore": "Taanab, a farming world of reddish-brown meadows and fields that ships grain across the galaxy, circles a single sun. Lore does not name or describe it.",
      "look": "A mild, gentle yellow-white sun, as SWG draws it (36.9°); ours.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "Lore gives Taanab one sun but no name.",
      "sources": [
        {
          "title": "SWGANH wiki: Taanab",
          "url": "http://wiki.swganh.org/index.php/Taanab_(Planet)"
        }
      ]
    },
    "taanab:moon": {
      "name": "Taanab's moon (unnamed in lore)",
      "kind": "moon",
      "orbits": "Taanab",
      "lore": "Taanab's one moon, girdled by a ring of ice. When Norulac pirates raided the planet, Lando Calrissian hid in that ring, tangled the raiders in nets and battered them with ice blocks from it, the victory behind his later rank as a general.",
      "look": "A pale grey-white ice moon with a thin, bright ring of ice around it; SWG's ice-moon picture (18.9°, the moon of the night) suits it, and the ring would mark it as Lando's hiding place.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "Lore gives Taanab exactly one moon, ringed with ice, and this slot's SWG picture is the ice moon. The researchers had Taanab moonless in lore; that is corrected.",
      "sources": [
        {
          "title": "SWGANH wiki: Taanab",
          "url": "http://wiki.swganh.org/index.php/Taanab_(Planet)"
        }
      ]
    },
    "taanab:moon2": {
      "name": "unnamed in lore",
      "kind": "moon",
      "orbits": "ours: Taanab",
      "lore": "**Ours.** Lore gives Taanab one moon, so this second one has no counterpart. A small second moon trailing the ice moon, or drop it.",
      "look": "A small pale blue-grey moon (9.5° in SWG, 20° off the night light).",
      "continuity": "ours",
      "confidence": "ours",
      "why": "One body more than lore's one moon.",
      "sources": [
        {
          "title": "SWGANH wiki: Taanab",
          "url": "http://wiki.swganh.org/index.php/Taanab_(Planet)"
        }
      ]
    },
    "taanab:celestial:cels_moon_earthy01": {
      "name": "unnamed in lore",
      "kind": "moon",
      "orbits": "ours: Taanab",
      "lore": "**Ours.** Lore gives Taanab one moon, the ringed ice moon, so this one has no counterpart. A big, near moon of mottled brown and grey if kept.",
      "look": "A very large mottled mauve-brown moon (36.9°, fixed ahead, 20° up) that dwarfs everything else; smaller, or gone, suits a quiet farming world and keeps the ice moon the moon of Taanab.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "One body more than lore's one moon.",
      "sources": [
        {
          "title": "SWGANH wiki: Taanab",
          "url": "http://wiki.swganh.org/index.php/Taanab_(Planet)"
        }
      ]
    },
    "talus:sun": {
      "name": "Corell",
      "kind": "star",
      "orbits": "nothing (the system's single star)",
      "lore": "The star of the Corellian system. Five worlds circle it: Corellia, Drall, Selonia and the paired worlds Talus and Tralus, with Centerpoint Station between those two.",
      "look": "Warm yellow-white; SWG draws it large on Talus, 36.9° across. SWG gives Talus a purple sky, which would tint the light around it.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Fan references name the system's one star Corell; lore gives it no colour, so the colour is ours.",
      "sources": [
        {
          "title": "Mithril Tabby: The Core Worlds",
          "url": "https://www.mithriltabby.com/starwars/galaxy/coreworlds.xhtml"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        }
      ]
    },
    "talus:moon": {
      "name": "unnamed in lore",
      "kind": "moon",
      "orbits": "ours: Talus",
      "lore": "**Ours.** The sources we could open give Talus no moons of its own; its only close companion is its twin, Tralus. A small airless moon of our own fits here.",
      "look": "A grey, cratered, Mercury-like disc 13.3° in SWG; plausible as a small airless moon.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "The researchers' \"several moons\" rests on Wookieepedia, which refused us; no source we opened gives Talus a moon.",
      "sources": [
        {
          "title": "SWG Legends wiki: Talus",
          "url": "https://swglegends.com/wiki/index.php?title=Talus"
        },
        {
          "title": "Mithril Tabby: The Core Worlds",
          "url": "https://www.mithriltabby.com/starwars/galaxy/coreworlds.xhtml"
        },
        {
          "title": "Wookieepedia: Talus (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Talus/Legends"
        }
      ]
    },
    "talus:moon2": {
      "name": "unnamed in lore",
      "kind": "moon",
      "orbits": "ours: Talus",
      "lore": "**Ours.** A second small moon over Talus, with no counterpart in the sources we could open. Keep it small, or drop it.",
      "look": "A small yellow disc, 5.7° in SWG, set 33° aside and 20° below the first.",
      "continuity": "ours",
      "confidence": "ours",
      "why": "No source we opened gives Talus a moon.",
      "sources": [
        {
          "title": "SWG Legends wiki: Talus",
          "url": "https://swglegends.com/wiki/index.php?title=Talus"
        }
      ]
    },
    "talus:celestial:cels_corellia": {
      "name": "Corellia",
      "kind": "planet",
      "orbits": "Corell",
      "lore": "The system's namesake world, seen from Talus: an old, industrial Core world of seas, fields and cities. Both worlds circle the same star.",
      "look": "Blue seas, green land and white cloud, 18.9° across, high overhead and behind (pitch 150). At true distances it would be only a bright star, so the large disc is SWG's choice.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "SWG's picture is Corellia, and both worlds orbit Corell.",
      "sources": [
        {
          "title": "Mithril Tabby: The Core Worlds",
          "url": "https://www.mithriltabby.com/starwars/galaxy/coreworlds.xhtml"
        },
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        }
      ]
    },
    "talus:celestial:cels_cpoint_tralus": {
      "name": "Tralus, with Centerpoint Station",
      "kind": "planet",
      "orbits": "the shared centre of Talus and Tralus, where Centerpoint Station sits; the pair orbits Corell",
      "lore": "Talus's twin, much the same in size, circling a common centre with it while the pair goes round Corell. At that balance point hangs Centerpoint Station, a vast station about 100 km across.",
      "look": "A large temperate disc, 31.6° in SWG: seas, green and brown land and cloud, close to Talus's own look. Centerpoint lies on the line between the worlds, so from Talus it shows as a small bright speck against Tralus's face.",
      "continuity": "Legends",
      "confidence": "named in lore",
      "why": "SWG's picture name pairs Centerpoint with Tralus, and lore puts the station between the twins.",
      "sources": [
        {
          "title": "SWG Legends wiki: Talus",
          "url": "https://swglegends.com/wiki/index.php?title=Talus"
        },
        {
          "title": "Mithril Tabby: The Core Worlds",
          "url": "https://www.mithriltabby.com/starwars/galaxy/coreworlds.xhtml"
        }
      ]
    },
    "tatooine:sun": {
      "name": "Tatoo I",
      "kind": "star",
      "orbits": "the shared centre of the Tatoo binary, with Tatoo II",
      "lore": "One of the two G-type stars that Tatooine circles, the first of the twin suns of every Tatooine sunset. Between them the pair keep the planet a desert of dune seas and rocky badlands.",
      "look": "A white-gold disc with a strong glare, the larger glow of the pair; SWG draws it 20.8° across. Keep the two suns near the same size so a double sunset reads.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Lore names the two suns Tatoo I and Tatoo II but does not say which is which in the sky; the slot with the larger glow takes the first name.",
      "sources": [
        {
          "title": "Wikipedia: Tatooine",
          "url": "https://en.wikipedia.org/wiki/Tatooine"
        },
        {
          "title": "Star Wars Technical Commentaries: Planets (TheForce.Net)",
          "url": "https://www.theforce.net/swtc/orbs.html"
        }
      ]
    },
    "tatooine:sun2": {
      "name": "Tatoo II",
      "kind": "star",
      "orbits": "the shared centre of the Tatoo binary, with Tatoo I",
      "lore": "The second of Tatooine's twin suns, also a G-type star and close to its partner in size and brightness. A study of the films notes that one of the pair looks a little bluer than the other.",
      "look": "A slightly warmer gold disc with a smaller glow, 18° to the side of Tatoo I and 10° up as SWG sets it, so the two can be told apart.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Lore names the second sun; SWG's second sun slot is it. Which sun is bluer is not fixed, so the warmer reading here is ours.",
      "sources": [
        {
          "title": "Wikipedia: Tatooine",
          "url": "https://en.wikipedia.org/wiki/Tatooine"
        },
        {
          "title": "Star Wars Technical Commentaries: Planets (TheForce.Net)",
          "url": "https://www.theforce.net/swtc/orbs.html"
        }
      ]
    },
    "tatooine:moon": {
      "name": "Ghomrassen",
      "kind": "moon",
      "orbits": "Tatooine",
      "lore": "One of Tatooine's three moons, and here the largest and palest of them. Like its sisters it is named for a Berber village in southern Tunisia near where the films were shot; lore records little else about it.",
      "look": "A pale grey-white disc with dark smooth plains and lighter cratered highlands, as film studies describe one Tatooine moon; the largest of the three, 11.4° in SWG.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore names three moons but, in the sources we could open, does not tell them apart by size or orbit, so which disc carries which name is our choice, made by size. Wookieepedia ranks them and gives one a long, stretched orbit, but it refused us, so none of that is used.",
      "sources": [
        {
          "title": "Carthage Magazine: Star Wars in Tunisia, a field guide to the real Tatooine",
          "url": "https://carthagemagazine.com/star-wars-sets-in-tunisia/"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wikipedia: Tatooine",
          "url": "https://en.wikipedia.org/wiki/Tatooine"
        },
        {
          "title": "Wookieepedia: Ghomrassen (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Ghomrassen/Legends"
        }
      ]
    },
    "tatooine:moon2": {
      "name": "Guermessa",
      "kind": "moon",
      "orbits": "Tatooine",
      "lore": "Another of Tatooine's three moons, smaller than Ghomrassen in this sky. Its name, too, comes from a Tunisian village of the filming country.",
      "look": "A smaller disc, 5.7° in SWG's teal picture; a muted grey or tan would sit better beside the pale first moon (ours).",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore names three moons but, in the sources we could open, does not tell them apart by size or orbit, so which disc carries which name is our choice, made by size. Wookieepedia ranks them and gives one a long, stretched orbit, but it refused us, so none of that is used.",
      "sources": [
        {
          "title": "Carthage Magazine: Star Wars in Tunisia, a field guide to the real Tatooine",
          "url": "https://carthagemagazine.com/star-wars-sets-in-tunisia/"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wookieepedia: Guermessa (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Guermessa/Legends"
        }
      ]
    },
    "tatooine:celestial:cels_moon_earthy01": {
      "name": "Chenini",
      "kind": "moon",
      "orbits": "Tatooine",
      "lore": "The third of Tatooine's moons and the smallest in this sky. Chenini is a hilltop Berber village in southern Tunisia, and the moon carries its name.",
      "look": "The smallest and faintest of the three, fixed 15° up at 3.8° in SWG; a plain rocky speck.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore names three moons but, in the sources we could open, does not tell them apart by size or orbit, so which disc carries which name is our choice, made by size. Wookieepedia ranks them and gives one a long, stretched orbit, but it refused us, so none of that is used.",
      "sources": [
        {
          "title": "Carthage Magazine: Star Wars in Tunisia, a field guide to the real Tatooine",
          "url": "https://carthagemagazine.com/star-wars-sets-in-tunisia/"
        },
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "Wookieepedia: Chenini (Legends) (not opened: the site refused)",
          "url": "https://starwars.fandom.com/wiki/Chenini/Legends"
        }
      ]
    },
    "yavin4:sun": {
      "name": "Yavin (the star)",
      "kind": "star",
      "orbits": "nothing (the Yavin system's star)",
      "lore": "The medium orange star the Yavin system is named for. Three worlds circle it: the hot, lifeless Fiddanl, Stroiketcy, thought to be a captured comet, and the gas giant Yavin, outermost.",
      "look": "SWG draws the orange gas giant picture in this slot at 59.1°; now that Yavin Prime has its own place, an ordinary-sized, orange-tinted sun with a soft glow reads better here.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "The star is named Yavin; that this slot should become the star follows from the owner moving Yavin Prime to its own place.",
      "sources": [
        {
          "title": "Wikipedia: Yavin",
          "url": "https://en.wikipedia.org/wiki/Yavin"
        },
        {
          "title": "Imperial Order: The Planetary Tour of Star Wars, \"Y\" (after Galaxy Guide 2: Yavin and Bespin)",
          "url": "http://www.imperialorder.org/galaxy/database/yfrm.html"
        }
      ]
    },
    "yavin4:moon": {
      "name": "Yavin 13",
      "kind": "moon",
      "orbits": "Yavin Prime",
      "lore": "One of the three moons of Yavin able to support life: a hot desert of rocky mesas, tall cactus forests and shifting sand, with a vast ocean across its southern half. The rabbit-like Gerbs farm from underground warrens and the serpentine Slith roam at night.",
      "look": "Sandy tan and ochre with a broad sea across the south and little cloud; SWG's yellow picture (15.2°) fits the land but lacks the southern ocean.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "Lore names three living moons; this slot's yellow-tan picture suits the desert one. It pairs with space_yavin4:planet_tatooine_moon_03.",
      "sources": [
        {
          "title": "Imperial Order: The Planetary Tour of Star Wars, \"Y\" (after Galaxy Guide 2: Yavin and Bespin)",
          "url": "http://www.imperialorder.org/galaxy/database/yfrm.html"
        },
        {
          "title": "Wikipedia: Yavin",
          "url": "https://en.wikipedia.org/wiki/Yavin"
        }
      ]
    },
    "yavin4:moon2": {
      "name": "unnamed in lore (one of Yavin Prime's lesser moons)",
      "kind": "moon",
      "orbits": "Yavin Prime",
      "lore": "One of the twenty-odd moons of Yavin that lore leaves unnamed. **Ours:** a small airless moon of blue-grey rock that keeps company with Yavin 13 in the night sky.",
      "look": "A small, dim blue-grey disc (SWG's teal moon, 7.6°, 40° off the night light). It pairs with space_yavin4:planet_naboo_moon#2.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore counts about twenty-six moons and names only three (4, 8 and 13); this is one of the rest.",
      "sources": [
        {
          "title": "Wikipedia: Yavin",
          "url": "https://en.wikipedia.org/wiki/Yavin"
        },
        {
          "title": "Imperial Order: The Planetary Tour of Star Wars, \"Y\" (after Galaxy Guide 2: Yavin and Bespin)",
          "url": "http://www.imperialorder.org/galaxy/database/yfrm.html"
        }
      ]
    },
    "yavin4:celestial:cels_ice_moon": {
      "name": "Yavin 8",
      "kind": "moon",
      "orbits": "Yavin Prime",
      "lore": "A cold living moon of Yavin: brown and green tundra between two polar ice caps, split by an equatorial range of purple mountains. The amphibious Melodies live in its rivers and lakes.",
      "look": "Brown-green tundra, white poles and a violet band of mountains at the equator, with thin cloud; SWG's ice-moon picture (15.2°, fixed low ahead) suits it with violet added.",
      "continuity": "Legends",
      "confidence": "inferred",
      "why": "Lore names Yavin 8 as the tundra moon, and this is the only icy picture in Yavin 4's sky. It pairs with space_yavin4:planet_naboo_moon#1.",
      "sources": [
        {
          "title": "Imperial Order: The Planetary Tour of Star Wars, \"Y\" (after Galaxy Guide 2: Yavin and Bespin)",
          "url": "http://www.imperialorder.org/galaxy/database/yfrm.html"
        }
      ]
    },
    "tatooine:nightsky": {
      "name": "Tatooine's three moons (the night-sky sheet)",
      "kind": "other",
      "orbits": "Tatooine",
      "lore": "All three of Tatooine's moons, Ghomrassen, Guermessa and Chenini, together on one painted night as a farmer would see them over the dunes. The count of three is lore; which painted moon is which is not.",
      "look": "The sheet's one large pale moon and two small ones match lore's three. If the sheet and SWG's moon slots show at once the moons appear twice, so show one or the other.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Lore names three moons and the sheet shows three.",
      "sources": [
        {
          "title": "Wikipedia: Tatooine",
          "url": "https://en.wikipedia.org/wiki/Tatooine"
        },
        {
          "title": "Carthage Magazine: Star Wars in Tunisia, a field guide to the real Tatooine",
          "url": "https://carthagemagazine.com/star-wars-sets-in-tunisia/"
        }
      ]
    },
    "kashyyyk_main:nightsky": {
      "name": "two of Kashyyyk's three moons (the night-sky sheet)",
      "kind": "other",
      "orbits": "Kashyyyk",
      "lore": "The owner's painted night shows two of Kashyyyk's three moons over the canopy. The third, the orange one, is not on the sheet.",
      "look": "Two large moons painted in; keep the orange third (kashyyyk_main:celestial:cels_mars1) as its own small body, and hide the moon slot and the earthy celestial when the sheet is on so no moon is drawn twice.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore's three moons leave room for the sheet's two plus the orange one; none is named.",
      "sources": [
        {
          "title": "What's Where of Star Wars Planets and Moons (fan reference)",
          "url": "https://sites.google.com/site/starwarswhoswho/home/spinoff-pages/whats-where-of-star-wars-planets"
        },
        {
          "title": "The Last of the Droids wiki: Kashyyyk",
          "url": "https://thelastofthedroids.miraheze.org/wiki/Kashyyyk"
        }
      ]
    },
    "hoth:nightsky": {
      "name": "Hoth's three moons (unnamed in lore)",
      "kind": "other",
      "orbits": "Hoth",
      "lore": "Hoth, the sixth planet of a remote system, has three moons that lore never names. Their tidal pull cracks the planet's ice, forcing sea water up through the fissures, where it freezes into spires.",
      "look": "Studies of the film describe a large grey moon, a red and patchy one and a small red one. The sheet's blue crescent, grey moon and small moon match the count; greys and dull reds would match the film, cool and pale under Hoth's blue-white sun.",
      "continuity": "both",
      "confidence": "inferred",
      "why": "Lore counts three nameless moons, the same as the owner's sheet.",
      "sources": [
        {
          "title": "Wikipedia: Hoth",
          "url": "https://en.wikipedia.org/wiki/Hoth"
        },
        {
          "title": "SWTOR Strategies: Planets of Star Wars: Hoth",
          "url": "https://swtorstrategies.com/2010/05/planets-of-star-wars-hoth.html"
        },
        {
          "title": "Star Wars Technical Commentaries: Planets (TheForce.Net)",
          "url": "https://www.theforce.net/swtc/orbs.html"
        }
      ]
    },
    "yavin4:celestial:yavin_prime": {
      "name": "Yavin Prime",
      "kind": "gas giant",
      "orbits": "Yavin, the system's star",
      "lore": "The great gas giant at the edge of the Yavin system, larger than Jupiter, its upper winds racing past 600 km an hour. About twenty-six moons circle it, three of them alive: Yavin 4, Yavin 8 and Yavin 13.",
      "look": "A vast orange globe with lighter cloud streaks that roughly line up but do not form neat bands, no rings, filling much of the sky; lit by the sun with a soft dark-red glow on its night side, as the owner chose.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Named in both continuities and shown from Yavin 4 in A New Hope.",
      "sources": [
        {
          "title": "Wikipedia: Yavin",
          "url": "https://en.wikipedia.org/wiki/Yavin"
        },
        {
          "title": "Star Wars Technical Commentaries: Planets (TheForce.Net)",
          "url": "https://www.theforce.net/swtc/orbs.html"
        },
        {
          "title": "Imperial Order: The Planetary Tour of Star Wars, \"Y\" (after Galaxy Guide 2: Yavin and Bespin)",
          "url": "http://www.imperialorder.org/galaxy/database/yfrm.html"
        }
      ]
    },
    "space_endor:death_star_2": {
      "name": "the second Death Star",
      "kind": "station",
      "orbits": "the Forest Moon of Endor (held above it, under a shield projected from the moon)",
      "lore": "The Empire's second battle station, built over the forest moon and guarded by a shield generated on the surface. A sourcebook dates the start of work to within a year of the Battle of Yavin; at the Battle of Endor its superlaser works while the hull is still unfinished, and its destruction there ends the Emperor's rule.",
      "look": "A grey sphere (recent figures give about 200 km radius) with the superlaser dish in its upper half and much of the rest an open lattice; small beside the moon. At this game's date (about 1 ABY) only an early frame would exist, so the near-complete station is the owner's chosen liberty.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "The owner's own place for the station; only its stage of building against SWG's date is a stretch.",
      "sources": [
        {
          "title": "Wikipedia: Death Star",
          "url": "https://en.wikipedia.org/wiki/Death_Star"
        },
        {
          "title": "May 4 Be With You: when construction on the Death Star II started (citing the sourcebook Starships and Speeders)",
          "url": "https://may4bewithyou.com/when-exactly-was-construction-on-the-death-star-ii-started-pda01"
        },
        {
          "title": "StarWars.com Databank: Endor",
          "url": "https://www.starwars.com/databank/endor"
        }
      ]
    },
    "mustafar:celestial:jestefad": {
      "name": "Jestefad",
      "kind": "gas giant",
      "orbits": "Priate",
      "lore": "One of the two gas giants between which Mustafar keeps its erratic orbit. Its pull, fighting Lefrani's, kneads Mustafar's crust and keeps its volcanoes and lava rivers alive; in canon the ocean moon Nur is said to circle it.",
      "look": "A large banded gas giant hanging through the ash haze, its colours muted and reddened by smoke and lava-light; lore fixes no colour or size, so the owner's 24° against Lefrani's 14° is ours.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Named in reference works and shown behind Mustafar in Revenge of the Sith.",
      "sources": [
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        },
        {
          "title": "StarWars.com Databank: Mustafar",
          "url": "https://www.starwars.com/databank/mustafar"
        },
        {
          "title": "May 4 Be With You: what are the two large planets behind Mustafar?",
          "url": "https://may4bewithyou.com/what-are-these-two-large-planets-behind-mustafar-is-mustafar-a-moon-pda01/"
        }
      ]
    },
    "mustafar:celestial:lefrani": {
      "name": "Lefrani",
      "kind": "gas giant",
      "orbits": "Priate",
      "lore": "The second gas giant of the Mustafar system, whose gravity pulls against Jestefad's. Between the two, Mustafar keeps an erratic orbit and a molten surface.",
      "look": "A smaller, fainter banded globe than Jestefad, also seen through ash; lore gives no colour, so a different tint from Jestefad helps tell them apart.",
      "continuity": "both",
      "confidence": "named in lore",
      "why": "Named in reference works.",
      "sources": [
        {
          "title": "Wikipedia: List of Star Wars planets and moons",
          "url": "https://en.wikipedia.org/wiki/List_of_Star_Wars_planets_and_moons"
        },
        {
          "title": "StarWars.com Databank: Mustafar",
          "url": "https://www.starwars.com/databank/mustafar"
        },
        {
          "title": "May 4 Be With You: what are the two large planets behind Mustafar?",
          "url": "https://may4bewithyou.com/what-are-these-two-large-planets-behind-mustafar-is-mustafar-a-moon-pda01/"
        }
      ]
    }
  },
  "systems": {
    "Tatoo system (tatooine, space_tatooine)": "Twin G-type suns, Tatoo I and Tatoo II. Tatooine has three moons, Ghomrassen, Guermessa and Chenini (named for Tunisian villages); the gas giants Ohann and Adriana lie farther out. SWG's zone draws the twin suns as two star pictures close together and adds its own asteroid fields and mists.",
    "Naboo system (naboo, rori, space_naboo)": "One star, Naboo. The planet Naboo has three moons: Rori (SWG's own addition), Ohma-D'un (the Gungan colony moon) and a third, asteroid-like moon that Legends leaves unnamed and canon calls Veruna; a canon novel also names a moon Onoam. Rori has no moons of its own, so its sky holds the star, Naboo and Naboo's other two moons.",
    "Corellian system (corellia, talus, space_corellia)": "One star, Corell, with five inhabited worlds: Corellia, Drall, Selonia and the twins Talus and Tralus, with Centerpoint Station (about 100 km across) at the balance point between the twins. Corellia has at least three moons, two of them named, Gus Talon and Gus Treta; the sources we could open give Talus none. SWG gives Talus a purple sky. SWG's zone draws Corellia and three moons; Talus, Tralus and Centerpoint are not drawn there, although the zone lands on Talus.",
    "Dantooine system (dantooine, space_dantooine)": "One star, Dina, in the Raioballo sector of the Outer Rim; Dantooine is its fourth planet, with two unnamed moons. SWG's zone adds nebulae and asteroid fields of its own.",
    "Karthakk system (lok, space_lok)": "One star, unnamed in the sources we could open, lighting the pirate world Lok. Lore gives Lok two moons, neither named in the sources we could open, while SWG shows three. SWG places an obsidian asteroid formation, the Spine of Lok, and a stormy nebula, the Censorious Tempest, in the system.",
    "Hoth system (hoth)": "One blue-white star, also named Hoth; Hoth is its sixth planet, with three unnamed moons whose tides crack its ice, and a large asteroid field lies beyond it. SWG's files have no Hoth sky, so the only Hoth place is the owner's night-sky sheet.",
    "Endor system (endor, space_endor)": "One sun in most stories (two in the Ewok films and some references); its name is not settled in the sources we could open. The gas giant Endor has nine moons: the forest moon, the largest, and canon's ocean moon Kef Bir are the only ones named. The second Death Star is built over the forest moon from about 1 ABY until the Battle of Endor.",
    "Yavin system (yavin4, space_yavin4)": "A medium orange star, Yavin, with three worlds: Fiddanl (hot and lifeless), Stroiketcy (a captured comet) and the orange gas giant Yavin Prime, outermost. Yavin Prime has about twenty-six moons, three of them alive: Yavin 4 (jungle), Yavin 8 (tundra) and Yavin 13 (desert). A New Hope's targeting display shows Yavin 4 and three other moons, as SWG's zone does.",
    "Dathomir system (dathomir, space_dathomir)": "The star Domir, whose light is blood-red; Dathomir has four unnamed moons. A warm red light suits both the ground and the zone.",
    "Kashyyyk system (kashyyyk_main, space_kashyyyk)": "A single star in the Mid Rim, given the planet's own name in fan references. Kashyyyk has three unnamed moons, one of them orange; the Trandoshans' homeworld Trandosha shares the system. SWG's Kashyyyk ground sky is its generic default sky.",
    "Mustafar system (mustafar)": "One star, Priate in canon. Mustafar has no moon of its own and keeps an erratic orbit between the gas giants Jestefad and Lefrani; canon's ocean moon Nur is placed around Jestefad by one source and around Mustafar by another. There is no Mustafar space zone.",
    "Taanab (taanab)": "A farming world with a single, unnamed sun and one moon ringed with ice, where Lando Calrissian hid to beat the Norulac pirates. There is no Taanab space zone.",
    "Bright Jewel system (space_ord_mantell)": "The star Bright Jewel; Ord Mantell keeps at least fifteen moons, of which canon names only Quantxi. Fan references describe two large twin moons among them, which we could not check.",
    "Kessel system (space_light1)": "SWG's \"Kessel System\". In Legends Kessel has one moon, the Imperial garrison moon, intact at this game's time; in canon the route to Kessel runs past the Maw, a red gravity well, through storm cloud.",
    "Deep space (space_heavy1)": "\"Deep Space\": no lore system. Its stars are generic background stars and its one body is ours.",
    "Tutorial space (space_npe_falcon, space_npe_falcon_2, space_npe_falcon_3)": "\"Somewhere out in Space\": the game's tutorial zones, with no lore system. The single body in each is ours.",
    "Sandbox (space_sandbox)": "Ours entirely: the converter invents this system from a seed and dresses it in Tatooine's pictures. Nothing in it is lore and none of it is Tatooine."
  }
};
