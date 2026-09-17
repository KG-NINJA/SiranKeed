# POLYGON RAID 88

Three.js single-file polygon rail shooter inspired by late-1980s low-poly arcade visuals.

## Play and support

全3ステージを無料で遊べるPC向けのキーボード操作ゲームです。

- [ブラウザーで無料プレイ](https://kg-ninja.github.io/SiranKeed/)
- [CraftNovaのゲームページ](https://craftnovagame.com/game/28)
- [KGの開発を任意で応援する — Ko-fi](https://ko-fi.com/kg_ninja)
- [KGの開発を任意で応援する — Buy Me a Coffee](https://buymeacoffee.com/kgninja)

支援は任意で、ゲームの購入・機能のアンロック・限定特典などの対価はありません。支援しなくても全ステージをプレイできます。支援先の支払方法や受付状態はリンク先で確認してください。

## Run

Clone or download this repository, then run a local HTTP server from the directory containing `index.html`:

```powershell
python -m http.server 4177 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:4177/
```

Keep the terminal open while playing. If port `4177` is in use, choose another port and update the URL. The original browser build downloads Three.js from a CDN, so an internet connection is required for that dependency.

Requires Python 3 for this local launch method and a desktop browser with WebGL, ES modules, and import-map support. Touch controls, gamepad controls, pause, and saved progress are not implemented.

## Regression tests

With Node.js 18 or later, run `npm ci` and `npm test`. These tests use the same
Three.js version as the browser game to check the stage 1 heavy laser's aim,
collision geometry, damage timing and invulnerability. No build step is needed
to play or deploy the game.

## Controls

- `Enter`: start / restart
- `1 / 2 / 3`: start from selected stage on the title, game over, or ending screen
- `Arrow` or `WASD`: move
- `Space`: shot

## Optional Jev input panel

Open `?jev=1` to enable a visible, bounded input panel. Paste a Jev-selected action
and click **Apply Jev action**, for example:

```json
{"movement":"right","fire":true,"duration_ms":1000,"move_ms":200}
```

Directions: `stay`, `left`, `right`, `up`, `down`, `up_left`, `up_right`,
`down_left`, `down_right`. Durations are integer milliseconds: total 50–3000,
movement 0–total. The existing player update handles movement and shooting with
unchanged speed, cooldown, limits, damage, enemy behavior and game clock.
During play, a typed `boss_heavy_laser_charge` telegraph or active
`persistent_damage_beam` can take a deterministic 900 ms safety override with
760 ms of continuous movement, so a slow Jev decision cannot wait through the
0.75 s charge window or stop at laser launch. The guard refreshes the lease at
the end of each large displacement and immediately at a screen edge, keeping
movement continuous while the beam is active. It only uses the current
structured player bounds and beam axis; it does not infer unseen threats or
choose ordinary positioning. Invalid actions, blur, hidden
tabs, restart, stage transitions and terminal states release input. The release
button cancels immediately. Physical keyboard input still works.

Expand **Structured game state JSON** for a timestamped, 10 Hz current-state
observation modeled on the TypeSafe Doom demo. It contains typed game state rather
than screenshot recognition: player and target world positions, current velocity,
collision radius, lives/shield, current physical projectiles and solid bodies,
active heavy-laser geometry, laser-charge telegraphs, stage/HUD state, and the
finite action space. Visual-only effects, future spawns, and historical frames are
not included. Stable object IDs identify objects within a running session. It
contains no API key, network request or TypeSafe client. An external controller
must supply fresh observations to Jev and mechanically apply its returned actions.
Ordinary URLs do not display or calculate structured telemetry.

## Stages

1. `SPACE FLEET`: enemy formations, star grid, distant allied fleet destruction with polygon debris.
2. `ASTEROID BELT`: rotating low-poly asteroids, destructible small rocks, large hazards, enemy ships.
3. `BASE TUNNEL`: wireframe tunnel, gates, turrets, final boss.

The game is static GitHub Pages compatible. It uses Three.js from CDN via importmap.
