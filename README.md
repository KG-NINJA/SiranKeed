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

## Stages

1. `SPACE FLEET`: enemy formations, star grid, distant allied fleet destruction with polygon debris.
2. `ASTEROID BELT`: rotating low-poly asteroids, destructible small rocks, large hazards, enemy ships.
3. `BASE TUNNEL`: wireframe tunnel, gates, turrets, final boss.

The game is static GitHub Pages compatible. It uses Three.js from CDN via importmap.
