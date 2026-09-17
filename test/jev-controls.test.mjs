import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createTimedInput, projectedContact, screenObject } from '../jev-controls.mjs';

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
    { fire: 'true' }, { movement: '__proto__' }, { move_ms: NaN }, { duration_ms: Infinity },
    { observation_seq: -1 }, { observation_seq: 1.5 }]) {
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

test('projected contact reports collision deadlines and safe misses', () => {
  const hit = projectedContact({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 5 }, 1, 3);
  assert.ok(Math.abs(hit.time_to_contact_s - 1.8) < 1e-9);
  assert.equal(hit.closest_approach_s, 2);
  assert.equal(hit.closest_clearance, -1);
  assert.equal(hit.closing, true);
  const miss = projectedContact({ x: 3, y: 0, z: -10 }, { x: 0, y: 0, z: 5 }, 1, 3);
  assert.equal(miss.time_to_contact_s, null);
  assert.equal(miss.closest_approach_s, 2);
  assert.equal(miss.closest_clearance, 2);
});

test('reaction timing and recent control report measured action outcomes', () => {
  const input = createTimedInput();
  const observation = (x, bossHp, lives, shield) => ({
    status: 'act', seq: 20,
    hud: { boss_hp: bossHp, lives, shield },
    player: {
      position: { x, y: 0, z: 4.2 }, speed_multiplier: 1,
      bounds: { x_min: -5.8, x_max: 5.8, y_min: -3.75, y_max: 3.55 }
    },
    telegraphs: [], hazards: []
  });
  input.submit({ movement: 'right', fire: true, move_ms: 1000, duration_ms: 1000,
    observation_seq: 7 }, 100, { observation_to_action_ms: 240 });
  input.observe(observation(0, 140, 3, 1), 100);
  input.observe(observation(1.84, 138, 2, 0), 300);
  assert.deepEqual(input.timing(300), {
    decision_observation_seq: 7,
    observation_to_action_ms: 240,
    action_age_ms: 200,
    action_remaining_ms: 800
  });
  const current = input.feedback(300).current;
  assert.equal(current.actual_displacement.x, 1.84);
  assert.equal(current.commanded_progress, 1.84);
  assert.equal(current.expected_displacement, 1.84);
  assert.equal(current.progress_ratio, 1);
  assert.equal(current.movement_effective, true);
  assert.equal(current.lives_lost, 1);
  assert.equal(current.shield_lost, 1);
  assert.equal(current.boss_damage, 2);
  input.submit({ movement: 'stay', fire: true, move_ms: 0, duration_ms: 500,
    observation_seq: 20 }, 350, { observation_to_action_ms: 80 });
  input.observe(observation(1.84, 138, 2, 0), 350);
  assert.equal(input.feedback(350).previous.completed, true);
  assert.equal(input.feedback(350).previous.movement, 'right');
});

test('recent control does not attribute a safety override interval to resumed movement', () => {
  const input = createTimedInput();
  const player = { position: { x: 0, y: 0, z: 4.2 }, speed_multiplier: 1,
    collision_radius: 0.72, bounds: { x_min: -5.8, x_max: 5.8, y_min: -3.75, y_max: 3.55 } };
  input.submit({ movement: 'right', fire: true, move_ms: 1000, duration_ms: 3000 }, 0);
  input.observe({ status: 'act', seq: 1, hud: { lives: 3, shield: 1, boss_hp: 140 },
    player, telegraphs: [], hazards: [] }, 0);
  input.observe({ status: 'act', seq: 2, hud: { lives: 3, shield: 1, boss_hp: 140 },
    player, telegraphs: [{ kind: 'boss_heavy_laser_charge', phase: 'telegraph', remaining_s: 0.5 }],
    hazards: [] }, 100);
  input.observe({ status: 'act', seq: 3, hud: { lives: 3, shield: 1, boss_hp: 140 },
    player, telegraphs: [], hazards: [] }, 1100);
  assert.equal(input.feedback(1100).current.source, 'jev');
  assert.equal(input.feedback(1100).current.expected_displacement, 0);
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
  assert.equal(input.has('arrowleft', 500), true);
  assert.equal(input.has(' ', 500), true);
  input.observe({ status: 'act', hud: { alert: '' }, telegraphs: [], hazards: [] }, 800);
  assert.equal(input.has('arrowleft', 850), true);
  assert.equal(input.has(' ', 850), true);
  input.observe({ status: 'act', hud: { alert: '' }, telegraphs: [], hazards: [] }, 1000);
  assert.equal(input.has('arrowleft', 1000), false);
  assert.equal(input.has(' ', 1000), true);
});

test('active laser refreshes at an edge without releasing movement', () => {
  const input = createTimedInput();
  input.submit({ movement: 'stay', fire: true, move_ms: 3000, duration_ms: 3000 }, 0);
  const bounds = { x_min: -5.8, x_max: 5.8, y_min: -3.75, y_max: 3.55 };
  input.observe({
    status: 'act',
    player: { position: { x: 0, y: 0, z: 4.2 }, collision_radius: 0.72, bounds },
    telegraphs: [{ kind: 'boss_heavy_laser_charge', phase: 'telegraph', remaining_s: 0.5 }],
    hazards: []
  }, 100);
  assert.equal(input.has('arrowleft', 150), true);
  input.observe({
    status: 'act',
    player: { position: { x: -5.1, y: 0, z: 4.2 }, collision_radius: 0.72, bounds },
    telegraphs: [],
    hazards: [{ kind: 'persistent_damage_beam', collision: true,
      axis: { start: { x: -5.1, y: -3, z: -17 }, end: { x: -5.1, y: 3, z: 23 } } }]
  }, 900);
  assert.equal(input.has('arrowleft', 900), false);
  assert.equal(input.has('arrowdown', 900), true);
  assert.equal(input.has(' ', 900), true);
});
test('active beam safety chooses the candidate farthest from its typed line', () => {
  const input = createTimedInput();
  input.submit({ movement: 'stay', fire: true, move_ms: 3000, duration_ms: 3000 }, 0);
  input.observe({
    status: 'act',
    player: {
      position: { x: 0, y: -3.4, z: 4.2 },
      collision_radius: 0.72,
      bounds: { x_min: -5.8, x_max: 5.8, y_min: -3.75, y_max: 3.55 }
    },
    telegraphs: [],
    hazards: [{
      kind: 'persistent_damage_beam',
      collision: true,
      axis: { start: { x: 0, y: -3.4, z: -17 }, end: { x: 0, y: -3.4, z: 23 } }
    }]
  }, 100);
  assert.equal(input.has('arrowup', 150), true);
  assert.equal(input.has('arrowdown', 150), false);
  assert.equal(input.snapshot(150).source, 'telegraph-safety');
});
test('ordinary projectiles do not activate the laser-only safety override', () => {
  const input = createTimedInput();
  input.submit({ movement: 'stay', fire: true, move_ms: 3000, duration_ms: 3000 }, 0);
  input.observe({
    status: 'act',
    player: {
      position: { x: 0, y: 0, z: 4.2 },
      collision_radius: 0.72,
      bounds: { x_min: -5.8, x_max: 5.8, y_min: -3.75, y_max: 3.55 }
    },
    telegraphs: [],
    hazards: [{ kind: 'enemy_projectile', collision: true }]
  }, 100);
  assert.equal(input.has('arrowleft', 150), false);
  assert.equal(input.has('arrowright', 150), false);
  assert.equal(input.has(' ', 150), true);
  assert.equal(input.snapshot(150).source, undefined);
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
