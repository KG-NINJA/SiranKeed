import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// Exercise the shipped functions directly, without a renderer or audio device.
function shippedFunction(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1);
  const end = html.indexOf('\n    function ', start + 1);
  return html.slice(start, end);
}

function game(player = { x: 3, y: 0.5, z: 4.2, radius: 0.72 }) {
  const state = { player, mode: 'play', shield: 3, lives: 3, invuln: 0 };
  const effects = [];
  const names = ['fireBossHeavyLaser', 'bossHeavyLaserHitsPlayer', 'updateEffects', 'playerHit'];
  const create = new Function('THREE', 'state', 'effects', 'scene', 'createWireMesh',
    'announce', 'noise', 'tone', 'spawnExplosion', 'sweepList',
    names.map(shippedFunction).join('\n') + `\nreturn { ${names.join(', ')} };`);
  const noop = () => {};
  const api = create(THREE, state, effects, new THREE.Scene(),
    geometry => new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()),
    noop, noop, noop, noop, noop);
  api.fireBossHeavyLaser({ x: 0, y: 0.5, z: -18 });
  return { ...api, state, effect: effects[0] };
}

test('rendered beam points at every reachable corner and the center', () => {
  for (const x of [-5.8, 0, 5.8]) for (const y of [-3.75, 0.5, 3.55]) {
    const g = game({ x, y, z: 4.2, radius: 0.72 });
    const ray = new THREE.Ray(g.effect.mesh.position.clone(),
      new THREE.Vector3(0, 0, 1).applyQuaternion(g.effect.mesh.quaternion));
    assert.ok(ray.distanceToPoint(new THREE.Vector3(x, y, 4.2)) < 1e-10);
    assert.equal(g.bossHeavyLaserHitsPlayer(g.effect, g.state.player), true);
  }
});

test('old backward beam location is safe and moving clear evades the shot', () => {
  const g = game();
  g.state.player.x = -2.1499067204687683;
  assert.equal(g.bossHeavyLaserHitsPlayer(g.effect, g.state.player), false);
  g.state.player.x = 5;
  g.updateEffects(0.19);
  assert.equal(g.state.shield, 3);
});

test('contact follows visible taper and pulse plus player radius', () => {
  const g = game({ x: 0, y: 0.5, z: 4.2, radius: 0.72 });
  for (const pulse of [0.88, 1, 1.12]) {
    g.effect.mesh.scale.set(pulse, pulse, 1);
    // The midpoint of the rendered cylinder has radius (0.42 + 0.9) / 2.
    const z = -16.2 + 20;
    const boundary = 0.66 * pulse + 0.72;
    assert.equal(g.bossHeavyLaserHitsPlayer(g.effect,
      { x: boundary - 0.01, y: 0.5, z, radius: 0.72 }), true);
    assert.equal(g.bossHeavyLaserHitsPlayer(g.effect,
      { x: boundary + 0.01, y: 0.5, z, radius: 0.72 }), false);
  }
});

test('points well beyond either end are safe', () => {
  const g = game();
  for (const z of [-50, 60]) {
    assert.equal(g.bossHeavyLaserHitsPlayer(g.effect,
      { x: 3, y: 0.5, z, radius: 0.72 }), false);
  }
});

test('original damage delay, single hit and visual lifetime are preserved', () => {
  const g = game();
  g.updateEffects(0.18);
  assert.equal(g.state.shield, 3);
  g.updateEffects(0.01);
  assert.equal(g.state.shield, 2);
  g.state.invuln = 0;
  g.updateEffects(0.5);
  assert.equal(g.state.shield, 2);
  assert.notEqual(g.effect.dead, true);
  g.updateEffects(0.5);
  assert.equal(g.effect.dead, true);
});

test('invulnerability and non-playing mode still block damage', () => {
  for (const patch of [{ invuln: 1 }, { mode: 'gameover' }]) {
    const g = game();
    Object.assign(g.state, patch);
    g.updateEffects(0.19);
    assert.equal(g.state.shield, 3);
    assert.equal(g.state.lives, 3);
  }
});
