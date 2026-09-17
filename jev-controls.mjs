// Bounded UI input, not a policy: all directions are chosen by the caller.
const directions = {
  stay: [], left: ['arrowleft'], right: ['arrowright'],
  up: ['arrowup'], down: ['arrowdown'],
  up_left: ['arrowup', 'arrowleft'], up_right: ['arrowup', 'arrowright'],
  down_left: ['arrowdown', 'arrowleft'], down_right: ['arrowdown', 'arrowright']
};

export function createTimedInput() {
  let active = null;
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
    cancel() { active = null; },
    has(key, now) {
      if (!active || now - active.started >= active.duration_ms) return false;
      return key === ' ' ? active.fire :
        now - active.started < active.move_ms && directions[active.movement].includes(key);
    },
    snapshot(now) {
      return active ? { ...active, remaining_ms: Math.max(0, Math.round(active.duration_ms - (now - active.started))) } : null;
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
