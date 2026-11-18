# Lane Fighter

A small browser game in the "squad vs. horde" style: steer your squad down the road, pick the gates that grow it, shoot down the horde, then beat the boss at the end of each level.

**Play:** https://sichdar.github.io/lane-fighter/

## How to play

- **Move:** mouse, drag with a finger, or ← → (A / D)
- **Gates:** drive through one of each pair. Blue gates (+, ×) grow your squad, red gates (−, ÷) shrink it.
- **Shoot gates:** shooting a + or − gate raises its number, so a bad gate can become a good one.
- **Crates (⚡):** shoot them open for more fire power.
- **Horde:** every enemy that reaches you takes soldiers with it. Big purple ones take five.
- **Boss:** kill it before it crushes your squad. Each level is longer and tougher.

## Status

Basic first version: shapes only, no sound, no art yet. Direction, art style and the game loop are still to be decided.

## Run it locally

No build step. Open `index.html` in a browser, or serve the folder with any static web server.

## Files

- `index.html`: the page
- `game.js`: the whole game (canvas, plain JavaScript)
