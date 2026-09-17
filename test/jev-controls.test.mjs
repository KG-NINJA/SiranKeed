import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createTimedInput, screenObject } from '../jev-controls.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
test('browser module parses', () => {
  const js = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;$/gm, '');
  assert.doesNotThrow(() => new Function(js));
});
test('direction and fire have independent deadlines, no stuck key', () => {
  const input = createTimedInput();
  input.submit({ movement: 'up_left', fire: true, move_ms: 100, duration_ms: 1000 }, 1000);
  assert.equal(input.has('arrowleft', 1050), true);
  assert.equal(input.has('arrowup', 1050), true);
  assert.equal(input.has('arrowright', 1050), false);
  assert.equal(input.has('arrowleft', 1100), false);
  assert.equal(input.has(' ', 1999), true);
  assert.equal(input.has(' ', 2000), false);
  input.cancel();
  assert.equal(input.snapshot(2000), null);
});
test('bad requests fail closed and replacements do not accumulate', () => {
  const input = createTimedInput();
  const valid = { movement: 'left', fire: true, move_ms: 100, duration_ms: 1000 };
  for (const patch of [{ duration_ms: 3001 }, { duration_ms: -1 }, { move_ms: 1001 },
    { fire: 'true' }, { movement: '__proto__' }, { move_ms: NaN }, { duration_ms: Infinity }]) {
    input.submit(valid, 0);
    assert.throws(() => input.submit({ ...valid, ...patch }, 1));
    assert.equal(input.has(' ', 2), false);
  }
  input.submit(valid, 0);
  input.submit({ ...valid, movement: 'right', fire: false }, 10);
  assert.equal(input.has('arrowleft', 20), false);
  assert.equal(input.has('arrowright', 20), true);
  assert.equal(input.has(' ', 20), false);
});
test('telegraph safety overrides a slow Jev action for an immediate lateral dodge', () => {
  const input = createTimedInput();
  input.submit({ movement: 'stay', fire: true, move_ms: 3000, duration_ms: 3000 }, 0);
  input.observe({
    status: 'act',
    hud: { alert: '' },
    player: {
      position: { x: 0, y: 0 },
      collision_radius: 0.72,
      bounds: { x_min: -5.8, x_max: 5.8, y_min: -3.75, y_max: 3.55 }
    },
    telegraphs: [{ kind: 'boss_heavy_laser_charge', phase: 'telegraph', remaining_s: 0.5 }],
    hazards: []
  }, 100);
  assert.equal(input.has(' ', 150), true);
  assert.equal(input.has('arrowleft', 150), true);
  assert.equal(input.has('arrowright', 150), false);
  input.observe({
    status: 'act',
    hud: { alert: '' },
    player: {
      position: { x: 0, y: 0 },
      collision_radius: 0.72,
      bounds: { x_min: -5.8, x_max: 5.8, y_min: -3.75, y_max: 3.55 }
    },
    telegraphs: [{ kind: 'boss_heavy_laser_charge', phase: 'telegraph', remaining_s: 0.4 }],
    hazards: []
  }, 200);
  assert.equal(input.has('arrowleft', 250), true);
  assert.equal(input.has('arrowright', 250), false);
  input.observe({
    status: 'act',
    hud: { alert: '' },
    player: {
      position: { x: 0, y: 0 },
      collision_radius: 0.72,
      bounds: { x_min: -5.8, x_max: 5.8, y_min: -3.75, y_max: 3.55 }
    },
    telegraphs: [{ kind: 'boss_heavy_laser_charge', phase: 'telegraph', remaining_s: 0.1 }],
    hazards: []
  }, 450);
  assert.equal(input.has('arrowleft', 500), true);
  assert.equal(input.has('arrowright', 500), false);
  input.observe({ status: 'act', hud: { alert: '' }, telegraphs: [], hazards: [] }, 850);
  assert.equal(input.has('arrowleft', 850), false);
  assert.equal(input.has(' ', 850), true);
});
test('timed input uses shipped player speed, diagonal normalization and boundaries', () => {
  const start = html.indexOf('    function updatePlayer(');
  const end = html.indexOf('\n    function ', start + 1);
  const input = createTimedInput();
  let now = 0, shots = 0;
  const state = { player: { x: 0, y: 0, z: 4.2, mesh: new THREE.Group() },
    speedMult: 1, stageIndex: 0, shotCooldown: 0, invuln: 0 };
  const update = new Function('THREE', 'state', 'inputHeld', 'shoot',
    html.slice(start, end) + '\nreturn updatePlayer;')(THREE, state,
    key => input.has(key, now), () => { shots++; });
  input.submit({ movement: 'right', fire: true, move_ms: 200, duration_ms: 400 }, now);
  for (; now < 500; now += 20) update(0.02);
  assert.ok(Math.abs(state.player.x - 1.84) < 1e-9);
  assert.equal(shots, 20);
  input.submit({ movement: 'up_right', fire: false, move_ms: 3000, duration_ms: 3000 }, now);
  for (let i = 0; i < 150; i++, now += 20) update(0.02);
  assert.equal(state.player.x, 5.8);
  assert.equal(state.player.y, 3.55);
});
test('screen projection filters hidden/offscreen geometry and exposes pixels only', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld(true);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.z = -5;
  const bounds = screenObject(THREE, mesh, camera, 1000, 1000);
  assert.equal(bounds.x, 500);
  assert.equal(bounds.y, 500);
  assert.deepEqual(Object.keys(bounds), ['x', 'y', 'width', 'height']);
  mesh.visible = false;
  assert.equal(screenObject(THREE, mesh, camera, 1000, 1000), null);
  mesh.visible = true;
  mesh.position.x = 100;
  assert.equal(screenObject(THREE, mesh, camera, 1000, 1000), null);
  mesh.position.set(0, 0, 5);
  assert.equal(screenObject(THREE, mesh, camera, 1000, 1000), null);
});
