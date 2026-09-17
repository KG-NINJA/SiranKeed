// Bounded UI input. Jev chooses ordinary actions; typed laser telegraphs may
// briefly take a deterministic safety override before those actions are read.
const directions = {
  stay: [], left: ['arrowleft'], right: ['arrowright'],
  up: ['arrowup'], down: ['arrowdown'],
  up_left: ['arrowup', 'arrowleft'], up_right: ['arrowup', 'arrowright'],
  down_left: ['arrowdown', 'arrowleft'], down_right: ['arrowdown', 'arrowright']
};

const safetyDirections = ['left', 'right', 'up', 'down'];

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
    const step = 9.2 * 0.28;
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
  return {
    submit(value, now) {
      active = null; // A malformed replacement must also release old input.
      if (!value || !Object.hasOwn(directions, value.movement) ||
          typeof value.fire !== 'boolean' ||
          !Number.isInteger(value.duration_ms) || value.duration_ms < 50 || value.duration_ms > 3000 ||
          !Number.isInteger(value.move_ms) || value.move_ms < 0 || value.move_ms > value.duration_ms) {
        throw new Error('movement: stay/left/right/up/down/diagonals; fire: boolean; duration_ms: 50..3000; move_ms: 0..duration_ms');
      }
      active = { ...value, started: now };
    },
    observe(observation, now) {
      const direction = safetyDirection(observation, previousSafetyDirection);
      const safetyActive = safetyOverride && now - safetyOverride.started < safetyOverride.duration_ms;
      if (direction && !safetyActive) {
        previousSafetyDirection = direction;
        safetyOverride = {
          movement: direction,
          fire: true,
          move_ms: 280,
          duration_ms: 320,
          started: now,
          source: 'telegraph-safety'
        };
      } else if (safetyOverride && now - safetyOverride.started >= safetyOverride.duration_ms) {
        safetyOverride = null;
      }
    },
    cancel() {
      active = null;
      safetyOverride = null;
      previousSafetyDirection = null;
    },
    has(key, now) {
      const current = safetyOverride && now - safetyOverride.started < safetyOverride.duration_ms ?
        safetyOverride : active;
      if (!current || now - current.started >= current.duration_ms) return false;
      return key === ' ' ? current.fire :
        now - current.started < current.move_ms && directions[current.movement].includes(key);
    },
    snapshot(now) {
      const current = safetyOverride && now - safetyOverride.started < safetyOverride.duration_ms ?
        safetyOverride : active;
      return current ? { ...current, remaining_ms: Math.max(0, Math.round(current.duration_ms - (now - current.started))) } : null;
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
  const panel = document.createElement('section');
  panel.id = 'jev-panel';
  panel.setAttribute('aria-label', 'Jev controls');
  panel.innerHTML = `<strong>Jev input / structured game state v2</strong>
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
      input.submit(action, performance.now());
      result.textContent = `Applied ${JSON.stringify(action)}`;
    } catch (error) {
      input.cancel();
      result.textContent = `Rejected: ${error.message}`;
    }
  };
  panel.querySelector('#jev-stop').onclick = () => { input.cancel(); result.textContent = 'Released'; };
  window.addEventListener('blur', () => input.cancel());
  document.addEventListener('visibilitychange', () => { if (document.hidden) input.cancel(); });
  return observation => { panel.querySelector('pre').textContent = JSON.stringify(observation); };
}
