# Lane Fighter

A small medieval browser game in the "squad vs. horde" style: lead your archers up a forest road, pick the gates that grow your squad, shoot down the goblin horde, then slay the troll at the end of each level.

**Play:** https://sichdar.github.io/lane-fighter/ (made for phones in portrait; works with a mouse too)

## Modes

- **Campaign:** 10 hand-made challenge levels on a map. Slay the troll for 1 star; each level has two extra goals for the 2nd and 3rd star (for example "never walk through a red gate" or "finish with 300+ archers"). Winning a level opens the next.
- **Endless:** wave after wave, each a little harder. Your squad carries over; how far can you march?
- **The Camp:** every run earns gold (slain foes, chests, cleared waves, wins and new stars). Spend it on upgrades that last: Recruits (more archers at the start), Sharp Arrows (more damage), Quick Draw (faster shooting) and Gate Craft (shot gates improve faster). Progress is saved on your device.

## How to play

- **Move:** drag left or right with a finger or the mouse (a tap alone doesn't move), or use ← → (A / D)
- **Pause:** the ❚❚ button top left, or Esc / P
- **Archers aim by themselves** at the nearest goblins. With nothing in range they shoot straight ahead.
- **Gates:** walk through one of each pair. Blue banners (+, ×) grow your squad, red ones (−, ÷) shrink it.
- **Shoot gates:** arrows that hit a + or − gate raise its number (up to a limit), so a bad gate can become a good one.
- **Chests:** shoot them open for better bows and 5 gold.
- **Horde:** every goblin that reaches you takes an archer with it. Orc brutes take five.
- **Troll:** kill it before it crushes your squad.

## Status

Early version. The look is drawn in code (no image files yet); no sound. Coming later: real art and sound.

## Run it locally

No build step. Serve the folder with any static web server and open `index.html`.

## Files

- `index.html`: the page
- `game.js`: the whole game (canvas, plain JavaScript; figures are drawn in code and cached as sprites)
