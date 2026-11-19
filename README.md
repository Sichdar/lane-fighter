# Lane Fighter

A small medieval browser game in the "squad vs. horde" style: lead your archers up a forest road, pick the gates that grow your squad, shoot down the goblin horde, then slay the troll at the end of each level.

**Play:** https://sichdar.github.io/lane-fighter/ (made for phones in portrait; works with a mouse too)

## How to play

- **Move:** drag with a finger, move the mouse, or use ← → (A / D)
- **Archers aim by themselves** at the nearest goblins. With nothing in range they shoot straight ahead.
- **Gates:** walk through one of each pair. Blue banners (+, ×) grow your squad, red ones (−, ÷) shrink it.
- **Shoot gates:** arrows that hit a + or − gate raise its number, so a bad gate can become a good one.
- **Chests:** shoot them open for better bows.
- **Horde:** every goblin that reaches you takes an archer with it. Orc brutes take five.
- **Troll:** kill it before it crushes your squad. Each level is longer and tougher.

## Status

Early version. The look is drawn in code (no image files yet); no sound. Coming next: a challenge map, an endless mode, a balance pass, then gold and upgrades between runs.

## Run it locally

No build step. Serve the folder with any static web server and open `index.html`.

## Files

- `index.html`: the page
- `game.js`: the whole game (canvas, plain JavaScript; figures are drawn in code and cached as sprites)
