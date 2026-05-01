# POLYGON RAID 88

Three.js single-file polygon rail shooter inspired by late-1980s low-poly arcade visuals.

## Run

Use a local HTTP server from `C:\Users\user\OneDrive\Desktop\three`.

```powershell
python -m http.server 4177
```

Open:

```text
http://localhost:4177/silpheed-88sr-shooter/
```

If the existing local server is already running on port `4177`, the same URL works.

## Controls

- `Enter`: start / restart
- `1 / 2 / 3`: start from selected stage on the title, game over, or ending screen
- `Arrow` or `WASD`: move
- `Space`: shot

## Stages

1. `SPACE FLEET`: enemy formations, star grid, distant allied fleet destruction with polygon debris.
2. `ASTEROID BELT`: rotating low-poly asteroids, destructible small rocks, large hazards, enemy ships.
3. `BASE TUNNEL`: wireframe tunnel, gates, turrets, final boss.

The game is static GitHub Pages compatible. It uses Three.js from CDN via importmap.
