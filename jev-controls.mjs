// Bounded UI input. Jev chooses ordinary actions; typed laser telegraphs may
// briefly take a deterministic safety override before those actions are read.
const directions = {
  stay: [], left: ['arrowleft'], right: ['arrowright'],
  up: ['arrowup'], down: ['arrowdown'],
  up_left: ['arrowup', 'arrowleft'], up_right: ['arrowup', 'arrowright'],
  down_left: ['arrowdown', 'arrowleft'], down_right: ['arrowdown', 'arrowright']
};

const safetyDirections = ['left', 'right', 'up', 'down'];
// Make the laser dodge a large, continuous displacement.  The movement and
// lease durations match so the safety layer never releases the movement key
// while the charge/beam window is still active.
const safetyMoveMs = 760;
const safetyDurationMs = 900;

function directionIsSafe(observation, direction) {
  const player = observation?.player;
  const bounds = player?.bounds;
  if (!player?.position || !bounds || !safetyDirections.includes(direction)) return false;
  const radius = Number(player.collision_radius) || 0.72;
  const margin = Math.max(0.9, radius * 1.8);
  const x = Number(player.position.x) || 0;
  const y = Number(player.position.y) || 0;
  if (direction === 'left') return x > Number(bounds.x_min) + margin;
  if (direction === 'right') return x < Number(bounds.x_max) - margin;
  if (direction === 'up') return y < Number(bounds.y_max) - margin;
  return y > Number(bounds.y_min) + margin;
}

function beamClearanceSquared(beam, point) {
  const start = beam?.axis?.start;
  const end = beam?.axis?.end;
  if (!start || !end) return -Infinity;
  const ax = Number(end.x) - Number(start.x);
  const ay = Number(end.y) - Number(start.y);
  const az = Number(end.z) - Number(start.z);
  const lengthSquared = ax * ax + ay * ay + az * az;
  if (!Number.isFinite(lengthSquared) || lengthSquared <= 0) return -Infinity;
  const px = Number(point.x) - Number(start.x);
  const py = Number(point.y) - Number(start.y);
  const pz = Number(point.z) - Number(start.z);
  const t = Math.max(0, Math.min(1, (px * ax + py * ay + pz * az) / lengthSquared));
  const dx = Number(point.x) - (Number(start.x) + ax * t);
  const dy = Number(point.y) - (Number(start.y) + ay * t);
  const dz = Number(point.z) - (Number(start.z) + az * t);
  return dx * dx + dy * dy + dz * dz;
}

export function projectedContact(relativePosition, relativeVelocity, combinedRadius, horizonS = 3) {
  const r = {
    x: Number(relativePosition?.x) || 0,
    y: Number(relativePosition?.y) || 0,
    z: Number(relativePosition?.z) || 0
  };
  const v = {
    x: Number(relativeVelocity?.x) || 0,
    y: Number(relativeVelocity?.y) || 0,
    z: Number(relativeVelocity?.z) || 0
  };
  const radius = Math.max(0, Number(combinedRadius) || 0);
  const horizon = Math.max(0, Number(horizonS) || 0);
  const rv = r.x * v.x + r.y * v.y + r.z * v.z;
  const vv = v.x * v.x + v.y * v.y + v.z * v.z;
  const rr = r.x * r.x + r.y * r.y + r.z * r.z;
  const closestTime = vv > 1e-9 ? Math.max(0, Math.min(horizon, -rv / vv)) : 0;
  const closest = {
    x: r.x + v.x * closestTime,
    y: r.y + v.y * closestTime,
    z: r.z + v.z * closestTime
  };
  const closestDistance = Math.hypot(closest.x, closest.y, closest.z);
  let contactTime = rr <= radius * radius ? 0 : null;
  if (contactTime === null && vv > 1e-9) {
    const b = 2 * rv;
    const c = rr - radius * radius;
    const discriminant = b * b - 4 * vv * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const times = [(-b - root) / (2 * vv), (-b + root) / (2 * vv)]
        .filter(value => value >= 0 && value <= horizon)
        .sort((a, bValue) => a - bValue);
      if (times.length) contactTime = times[0];
    }
  }
  return {
    time_to_contact_s: contactTime,
    closest_approach_s: closestTime,
    closest_clearance: closestDistance - radius,
    closing: rv < 0,
    horizon_s: horizon
  };
}

const movementVectors = {
  stay: [0, 0], left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1],
  up_left: [-0.707, 0.707], up_right: [0.707, 0.707],
  down_left: [-0.707, -0.707], down_right: [0.707, -0.707]
};

function observationSample(observation, now) {
  const position = observation?.player?.position;
  if (!position) return null;
  return {
    now,
    status: observation.status,
    position: { x: Number(position.x) || 0, y: Number(position.y) || 0, z: Number(position.z) || 0 },
    bounds: observation.player.bounds || null,
    speedMultiplier: Number(observation.player.speed_multiplier) || 1,
    lives: Number(observation.hud?.lives) || 0,
    shield: Number(observation.hud?.shield) || 0,
    bossHp: Number.isFinite(observation.hud?.boss_hp) ? Number(observation.hud.boss_hp) : null
  };
}

function atMovementBoundary(sample, movement) {
  const bounds = sample?.bounds;
  if (!bounds) return false;
  const epsilon = 0.04;
  return (movement.includes('left') && sample.position.x <= Number(bounds.x_min) + epsilon) ||
    (movement.includes('right') && sample.position.x >= Number(bounds.x_max) - epsilon) ||
    (movement.includes('up') && sample.position.y >= Number(bounds.y_max) - epsilon) ||
    (movement.includes('down') && sample.position.y <= Number(bounds.y_min) + epsilon);
}

function controlResult(trace, sample, completed) {
  if (!trace || !sample) return null;
  const elapsedMs = Math.max(0, sample.now - trace.started);
  const delta = {
    x: sample.position.x - trace.start.position.x,
    y: sample.position.y - trace.start.position.y,
    z: sample.position.z - trace.start.position.z
  };
  const [mx, my] = movementVectors[trace.action.movement] || [0, 0];
  const commandedProgress = delta.x * mx + delta.y * my;
  const movementElapsedBeforeTrace = Math.max(0, trace.started - trace.action.started);
  const trackedMoveMs = Math.max(0, trace.action.move_ms - movementElapsedBeforeTrace);
  const expectedDisplacement = (mx || my) ? 9.2 * trace.start.speedMultiplier *
    Math.min(elapsedMs, trackedMoveMs) / 1000 : 0;
  const boundary = atMovementBoundary(sample, trace.action.movement);
  return {
    movement: trace.action.movement,
    fire: trace.action.fire,
    source: trace.action.source || 'jev',
    observation_seq: Number.isInteger(trace.action.observation_seq) ? trace.action.observation_seq : null,
    elapsed_ms: Math.round(elapsedMs),
    completed,
    actual_displacement: {
      x: Math.round(delta.x * 1000) / 1000,
      y: Math.round(delta.y * 1000) / 1000,
      z: Math.round(delta.z * 1000) / 1000,
      distance: Math.round(Math.hypot(delta.x, delta.y, delta.z) * 1000) / 1000
    },
    commanded_progress: Math.round(commandedProgress * 1000) / 1000,
    expected_displacement: Math.round(expectedDisplacement * 1000) / 1000,
    progress_ratio: expectedDisplacement > 0 ?
      Math.round((commandedProgress / expectedDisplacement) * 1000) / 1000 : null,
    movement_effective: trace.action.movement === 'stay' ? null : commandedProgress > 0.05 || boundary,
    blocked_by_boundary: boundary,
    lives_lost: Math.max(0, trace.start.lives - sample.lives),
    shield_lost: Math.max(0, trace.start.shield - sample.shield),
    boss_damage: trace.start.bossHp === null || sample.bossHp === null ? null :
      Math.max(0, Math.round((trace.start.bossHp - sample.bossHp) * 1000) / 1000),
    terminal_status: sample.status === 'act' ? null : sample.status
  };
}

function safetyDirection(observation, previousDirection) {
  if (!observation || observation.status !== 'act') return null;
  const player = observation.player;
  const bounds = player?.bounds;
  if (!player?.position || !bounds) return null;

  const telegraph = (observation.telegraphs || []).some(item =>
    item?.kind === 'boss_heavy_laser_charge' && item.phase === 'telegraph' &&
    Number(item.remaining_s) <= 0.75);
  const beam = (observation.hazards || []).find(item =>
    item?.kind === 'persistent_damage_beam' && item.collision === true);
  const urgent = telegraph || beam;
  if (!urgent) return null;

  const radius = Number(player.collision_radius) || 0.72;
  const margin = Math.max(0.9, radius * 1.8);
  const x = Number(player.position.x) || 0;
  const y = Number(player.position.y) || 0;
  const safe = {
    left: x > Number(bounds.x_min) + margin,
    right: x < Number(bounds.x_max) - margin,
    up: y < Number(bounds.y_max) - margin,
    down: y > Number(bounds.y_min) + margin
  };
  const available = safetyDirections.filter(direction => safe[direction]);
  if (!available.length) return null;

  // Keep the same escape direction throughout one charge window. Reversing
  // every 100 ms would cancel displacement just when the beam is about to fire.
  if (telegraph && previousDirection && safe[previousDirection]) return previousDirection;

  // For an active beam, score the actual typed line after a short movement
  // rather than guessing from the largest axis component. This remains safe
  // when the player is already close to a screen edge or the beam is diagonal.
  if (beam?.axis?.start && beam.axis.end) {
    const step = 9.2 * (safetyMoveMs / 1000);
    const point = { x, y, z: Number(player.position.z) || 0 };
    const edgePreference = y <= Number(bounds.y_min) + margin ? ['up'] :
      (y >= Number(bounds.y_max) - margin ? ['down'] : []);
    const candidates = available.map(direction => {
      const next = { ...point };
      if (direction === 'left') next.x -= step;
      if (direction === 'right') next.x += step;
      if (direction === 'up') next.y += step;
      if (direction === 'down') next.y -= step;
      return {
        direction,
        clearance: beamClearanceSquared(beam, next),
        edgeRank: edgePreference.includes(direction) ? 0 : 1
      };
    }).sort((a, b) => b.clearance - a.clearance || a.edgeRank - b.edgeRank);
    if (candidates[0] && Number.isFinite(candidates[0].clearance)) return candidates[0].direction;
  }

  // During the charge, choose a lateral escape when possible so the input
  // layer reacts within the telegraph window instead of waiting for Jev.
  const lateral = previousDirection === 'left' ? 'right' : 'left';
  if (safe[lateral]) return lateral;
  if (safe.up && (!previousDirection || previousDirection === 'down')) return 'up';
  if (safe.down) return 'down';
  return available[0];
}

export function createTimedInput() {
  let active = null;
  let safetyOverride = null;
  let previousSafetyDirection = null;
  let controlTrace = null;
  let previousControl = null;

  function current(now) {
    if (safetyOverride && now - safetyOverride.started < safetyOverride.duration_ms) return safetyOverride;
    if (active && now - active.started < active.duration_ms) return active;
    return null;
  }

  function updateControlTrace(observation, now) {
    const action = current(now);
    const sample = observationSample(observation, now);
    if (!sample) return;
    const key = action ? `${action.source || 'jev'}:${action.started}` : null;
    if (!action) {
      if (controlTrace) previousControl = controlResult(controlTrace, controlTrace.last, true);
      controlTrace = null;
      return;
    }
    if (!controlTrace || controlTrace.key !== key) {
      if (controlTrace) previousControl = controlResult(controlTrace, controlTrace.last, true);
      controlTrace = { key, action: { ...action }, started: now, start: sample, last: sample };
    } else {
      controlTrace.last = sample;
    }
  }

  return {
    submit(value, now, metadata = {}) {
      active = null; // A malformed replacement must also release old input.
      if (!value || !Object.hasOwn(directions, value.movement) ||
          typeof value.fire !== 'boolean' ||
          !Number.isInteger(value.duration_ms) || value.duration_ms < 50 || value.duration_ms > 3000 ||
          !Number.isInteger(value.move_ms) || value.move_ms < 0 || value.move_ms > value.duration_ms ||
          (value.observation_seq !== undefined && (!Number.isInteger(value.observation_seq) || value.observation_seq < 0))) {
        throw new Error('movement: stay/left/right/up/down/diagonals; fire: boolean; duration_ms: 50..3000; move_ms: 0..duration_ms; optional observation_seq: non-negative integer');
      }
      active = {
        movement: value.movement,
        fire: value.fire,
        move_ms: value.move_ms,
        duration_ms: value.duration_ms,
        started: now,
        observation_seq: Number.isInteger(value.observation_seq) ? value.observation_seq :
          (Number.isInteger(metadata.observation_seq) ? metadata.observation_seq : null),
        observation_to_action_ms: Number.isFinite(metadata.observation_to_action_ms) ?
          Math.max(0, Math.round(metadata.observation_to_action_ms)) : null
      };
    },
    observe(observation, now) {
      const direction = safetyDirection(observation, previousSafetyDirection);
      const safetyActive = safetyOverride && now - safetyOverride.started < safetyOverride.duration_ms;
      const activeBeam = (observation.hazards || []).some(item =>
        item?.kind === 'persistent_damage_beam' && item.collision === true);
      const movementComplete = safetyOverride &&
        now - safetyOverride.started >= safetyMoveMs;
      const currentDirectionUnsafe = safetyOverride && direction &&
        !directionIsSafe(observation, safetyOverride.movement);
      // Refresh at the end of each large movement, or immediately when the
      // current direction reaches a screen edge.  Replacing the lease at the
      // same timestamp keeps the movement key held with no inter-frame stop.
      const needsContinuousRefresh = activeBeam && (movementComplete || currentDirectionUnsafe);
      if (direction && (!safetyActive || needsContinuousRefresh)) {
        previousSafetyDirection = direction;
        safetyOverride = {
          movement: direction,
          fire: true,
          move_ms: safetyMoveMs,
          duration_ms: safetyDurationMs,
          started: now,
          source: 'telegraph-safety',
          observation_seq: Number.isInteger(observation.seq) ? observation.seq : null,
          observation_to_action_ms: 0
        };
      } else if (safetyOverride && now - safetyOverride.started >= safetyOverride.duration_ms) {
        safetyOverride = null;
      }
      updateControlTrace(observation, now);
    },
    cancel() {
      active = null;
      safetyOverride = null;
      previousSafetyDirection = null;
      controlTrace = null;
      previousControl = null;
    },
    has(key, now) {
      const action = current(now);
      if (!action) return false;
      return key === ' ' ? action.fire :
        now - action.started < action.move_ms && directions[action.movement].includes(key);
    },
    snapshot(now) {
      const action = current(now);
      return action ? { ...action, remaining_ms: Math.max(0, Math.round(action.duration_ms - (now - action.started))) } : null;
    },
    timing(now) {
      const action = current(now);
      return action ? {
        decision_observation_seq: Number.isInteger(action.observation_seq) ? action.observation_seq : null,
        observation_to_action_ms: Number.isFinite(action.observation_to_action_ms) ? action.observation_to_action_ms : null,
        action_age_ms: Math.max(0, Math.round(now - action.started)),
        action_remaining_ms: Math.max(0, Math.round(action.duration_ms - (now - action.started)))
      } : {
        decision_observation_seq: null,
        observation_to_action_ms: null,
        action_age_ms: null,
        action_remaining_ms: null
      };
    },
    feedback(now) {
      return {
        current: controlTrace ? controlResult(controlTrace, controlTrace.last, false) : null,
        previous: previousControl
      };
    }
  };
}

// Legacy screen projection helper. The Jev path now uses structured game state;
// this stays exported for regression tests and for consumers that need a visual
// projection outside the Jev adapter.
export function screenObject(THREE, mesh, camera, width, height) {
  if (!mesh) return null;
  for (let p = mesh; p; p = p.parent) if (!p.visible) return null;
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return null;
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  if (!frustum.intersectsBox(box)) return null;
  const points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    if (v.z >= -1 && v.z <= 1) points.push([(v.x + 1) * width / 2, (1 - v.y) * height / 2]);
  }
  if (!points.length) return null;
  const x1 = Math.max(0, Math.min(width, Math.min(...points.map(p => p[0]))));
  const x2 = Math.max(0, Math.min(width, Math.max(...points.map(p => p[0]))));
  const y1 = Math.max(0, Math.min(height, Math.min(...points.map(p => p[1]))));
  const y2 = Math.max(0, Math.min(height, Math.max(...points.map(p => p[1]))));
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2),
    width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
}

export function mountJevPanel(input, isPlaying) {
  let latestObservation = null;
  const observationTimes = new Map();
  const panel = document.createElement('section');
  panel.id = 'jev-panel';
  panel.setAttribute('aria-label', 'Jev controls');
  panel.innerHTML = `<strong>Jev input / structured game state v3</strong>
    <p>DOOMデモ型: 現在フレームの構造化状態を渡し、Jevの有限操作を最大3秒だけ実行。</p>
    <label>Jev action JSON<textarea aria-label="Jev action JSON" rows="3">{"movement":"stay","fire":false,"duration_ms":1000,"move_ms":0}</textarea></label>
    <button type="button" id="jev-apply">Apply Jev action</button>
    <button type="button" id="jev-stop">Release Jev input</button>
    <output id="jev-result" aria-live="polite">Ready</output>
    <details><summary>Structured game state JSON</summary><pre id="jev-observation"></pre></details>`;
  document.body.appendChild(panel);
  const result = panel.querySelector('output');
  panel.querySelector('#jev-apply').onclick = () => {
    try {
      if (!isPlaying()) throw new Error('Start the game first');
      const action = JSON.parse(panel.querySelector('textarea').value);
      const now = performance.now();
      const observationSeq = Number.isInteger(action.observation_seq) ? action.observation_seq : latestObservation?.seq;
      const observedAt = observationTimes.get(observationSeq);
      input.submit(action, now, {
        observation_seq: observationSeq,
        observation_to_action_ms: Number.isFinite(observedAt) ? now - observedAt : null
      });
      result.textContent = `Applied ${JSON.stringify(action)}`;
    } catch (error) {
      input.cancel();
      result.textContent = `Rejected: ${error.message}`;
    }
  };
  panel.querySelector('#jev-stop').onclick = () => { input.cancel(); result.textContent = 'Released'; };
  window.addEventListener('blur', () => input.cancel());
  document.addEventListener('visibilitychange', () => { if (document.hidden) input.cancel(); });
  return observation => {
    latestObservation = observation;
    observationTimes.set(observation.seq, performance.now());
    while (observationTimes.size > 64) observationTimes.delete(observationTimes.keys().next().value);
    panel.querySelector('pre').textContent = JSON.stringify(observation);
  };
}
