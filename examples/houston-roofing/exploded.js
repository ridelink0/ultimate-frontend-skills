/* ultimate-frontend-skills/exploded.js - any made thing, taken apart, in real 3D.

   Reads its parts from the markup, so the semantic list IS the no-JS
   fallback and nothing is duplicated. Each <li> is one part: a shape, a
   size, a material, and where it sits on the axis the object comes apart
   along. Bottom of the list = bottom of the stack.

     <div class="exploded" data-spread="0.55" data-turn="1.1" data-axis="x">
       <ol class="exploded__list">
         <li data-shape="ring" data-r="1.06" data-r2=".84" data-h=".16" data-material="ceramic" data-y=".34">Bezel</li>
         <li data-shape="dome" data-r=".82" data-h=".10" data-material="glass" data-y=".30">Crystal</li>
         <li data-shape="disc" data-r=".78" data-h=".02" data-material="lacquer" data-y=".18">Dial</li>
         <li data-shape="ring" data-r="1" data-r2=".8" data-h=".36" data-material="steel">Case</li>
       </ol>
     </div>

   Shapes: slab (the default: a flat board, for layered things like a roof
   or a circuit board), box, disc, cylinder, ring, dome, torus, sphere, cone,
   hands (a dial's hands), chain (repeated links along the part, a bracelet
   or a track). data-repeat="12" data-ring=".66" places copies of a part
   around a circle - hour markers, screws, bolts. data-y sets a part's place
   on the axis; without it parts stack on each other in list order.
   Materials: steel, brushed, gold, titanium, lacquer, ceramic, glass, matte,
   rubber, lume, wood, paper - or data-color / data-rough / data-metal.

   A real model beats primitives when one exists: data-model="watch.glb" on
   the root loads it, and each <li data-part="Bezel"> names a mesh in it.
   Parts are pulled apart along the axis from where the model put them.

   Callouts are projected onto each part's real world position, so they track
   it through the turn. With no WebGL, reduced motion, or no three.js, the
   list stays and reads fine. */
/* three.js is ~160 KB. A static import would download it on every page that
   loads this file, including every page with no exploded view on it. Check the
   DOM first, then fetch. */
const roots = [...document.querySelectorAll('.exploded')].filter(
  (r) => r.dataset.model || r.querySelectorAll('li').length >= 2,
);
if (roots.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
const THREE = await import('three');
const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
const GLTFLoader = roots.some((r) => r.dataset.model)
  ? (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader
  : null;

/* Material presets. Physical, so a lacquer has a clearcoat and a crystal
   refracts, and every one of them is lit by the room environment below,
   which is what makes metal read as metal. */
const MATERIALS = {
  steel:    { color: 0xd9dce1, metalness: 1, roughness: 0.26 },
  brushed:  { color: 0xb8bcc3, metalness: 1, roughness: 0.5 },
  gold:     { color: 0xe3b96a, metalness: 1, roughness: 0.3 },
  titanium: { color: 0x8d9198, metalness: 1, roughness: 0.44 },
  lacquer:  { color: 0x0b0c0e, metalness: 0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 },
  ceramic:  { color: 0x14161a, metalness: 0, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15 },
  glass:    { color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 0.55, thickness: 0.3, ior: 1.5, transparent: true, opacity: 0.6, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 },
  matte:    { color: 0x2b2a2e, metalness: 0, roughness: 0.92 },
  rubber:   { color: 0x141416, metalness: 0, roughness: 0.96 },
  lume:     { color: 0xe8f0d8, metalness: 0, roughness: 0.6, emissive: 0xa8f59a, emissiveIntensity: 0.6 },
  wood:     { color: 0x8a6a42, metalness: 0, roughness: 0.85 },
  paper:    { color: 0xe9e4d8, metalness: 0, roughness: 0.95 },
};
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

function material(li) {
  const base = MATERIALS[String(li.dataset.material || '').toLowerCase()] || { color: 0x6b6156, metalness: 0, roughness: 0.8 };
  const m = new THREE.MeshPhysicalMaterial(Object.assign({}, base));
  if (li.dataset.color) m.color.set(li.dataset.color);
  if (li.dataset.rough !== undefined) m.roughness = num(li.dataset.rough, m.roughness);
  if (li.dataset.metal !== undefined) m.metalness = num(li.dataset.metal, m.metalness);
  if (m.transmission) m.side = THREE.DoubleSide;
  if (m.transparent) m.depthWrite = false;
  return m;
}

/* A ring or a dome is a profile turned on a lathe. The profile runs
   outside-bottom, outside-top, inside-top, inside-bottom. */
function ring(r, r2, h, bevel) {
  const b = Math.min(bevel, h / 2, (r - r2) / 2);
  const pts = [new THREE.Vector2(r2, -h / 2), new THREE.Vector2(r, -h / 2)];
  if (b > 0) { pts.push(new THREE.Vector2(r, h / 2 - b), new THREE.Vector2(r - b, h / 2)); }
  else pts.push(new THREE.Vector2(r, h / 2));
  pts.push(new THREE.Vector2(r2, h / 2), new THREE.Vector2(r2, -h / 2));
  return new THREE.LatheGeometry(pts, 128);
}
function dome(r, h) {
  const R = (r * r + h * h) / (2 * h);           // sphere the cap is cut from
  const a = Math.asin(Math.min(1, r / R));
  const pts = [];
  for (let k = 0; k <= 28; k++) {
    const t = a * (1 - k / 28);
    pts.push(new THREE.Vector2(R * Math.sin(t), R * Math.cos(t) - (R - h)));
  }
  pts.push(new THREE.Vector2(0, h)); // close at the apex
  return new THREE.LatheGeometry(pts.reverse(), 96);
}

/* Builds one part into a Group centred on the axis; returns { group, h }
   where h is the part's extent along the axis, used for stacking. */
function build(li) {
  const shape = String(li.dataset.shape || 'slab').toLowerCase();
  const m = material(li);
  const g = new THREE.Group();
  const r = num(li.dataset.r, 0.8), r2 = num(li.dataset.r2, r * 0.8);
  const w = num(li.dataset.w, 2.5), d = num(li.dataset.d, 1.7);
  let h = num(li.dataset.h, shape === 'slab' ? num(li.dataset.t, 0.04) : 0.1);
  const add = (geo) => { const mesh = new THREE.Mesh(geo, m); g.add(mesh); return mesh; };
  let radial = r;   // how far the part reaches across the axis, for framing
  switch (shape) {
    case 'box': add(new THREE.BoxGeometry(w, h, d)); radial = Math.max(w, d) / 2; break;
    case 'disc': case 'cylinder': add(new THREE.CylinderGeometry(r, r, h, 96)); break;
    case 'ring': add(ring(r, r2, h, num(li.dataset.bevel, 0))); break;
    case 'dome': add(dome(r, h)); break;
    case 'torus': add(new THREE.TorusGeometry(r, num(li.dataset.tube, 0.08), 24, 128, num(li.dataset.arc, 1) * Math.PI * 2)).rotation.x = Math.PI / 2; h = num(li.dataset.tube, 0.08) * 2; radial = r + num(li.dataset.tube, 0.08); break;
    case 'sphere': add(new THREE.SphereGeometry(r, 48, 32)); h = r * 2; break;
    case 'cone': add(new THREE.ConeGeometry(r, h, 64)); break;
    case 'hands': {
      // hour, minute, second at ten past ten: the position every dial is
      // photographed at, because it frames the maker's name
      const hand = (len, wid, ang, mat) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(wid, 0.014, len), mat);
        mesh.position.set(Math.sin(ang) * len / 2, 0, -Math.cos(ang) * len / 2);
        mesh.rotation.y = -ang;
        g.add(mesh);
      };
      const L = num(li.dataset.r, 0.62);
      hand(L * 0.62, 0.05, -Math.PI * 2 * (10 / 12), m);
      hand(L * 0.95, 0.036, Math.PI * 2 * (2 / 60), m);
      const sec = new THREE.MeshPhysicalMaterial({ color: 0xc9422f, metalness: 0.4, roughness: 0.4 });
      hand(L * 1.0, 0.012, Math.PI * 2 * (38 / 60), sec);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 24), m));
      h = 0.05; radial = L;
      break;
    }
    case 'chain': {
      // links along the part's depth axis, both directions, tapering away
      const count = Math.max(1, parseInt(li.dataset.count, 10) || 5);
      const gap = num(li.dataset.gap, 0.05);
      const start = num(li.dataset.start, 0.95);
      for (const dir of [1, -1]) {
        for (let k = 0; k < count; k++) {
          const s = 1 - k * 0.04;
          const link = new THREE.Mesh(new THREE.BoxGeometry(w * s, h, d), m);
          link.position.z = dir * (start + d / 2 + k * (d + gap));
          link.position.y = -k * 0.012;
          g.add(link);
          // a hairline between links, so they read as links and not a bar
          const groove = new THREE.Mesh(new THREE.BoxGeometry(w * s * 0.98, h * 0.4, gap * 0.8),
            new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 }));
          groove.position.z = link.position.z + dir * (d / 2 + gap / 2);
          groove.position.y = link.position.y;
          g.add(groove);
        }
      }
      radial = w / 2;   // the links run off the frame on purpose
      break;
    }
    default: { // slab
      add(new THREE.BoxGeometry(w, h, d));
      radial = Math.max(w, d) / 2;
      const n = parseInt(li.dataset.lines, 10) || 0;
      if (n > 1) {
        const lm = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, transparent: true, opacity: 0.45 });
        for (let k = 1; k < n; k++) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(w * 0.995, h * 0.34, 0.012), lm);
          s.position.set(0, h * 0.36, -d / 2 + (d * k) / n);
          g.add(s);
        }
      }
    }
  }
  // copies around a circle: markers, screws, bolts
  const repeat = parseInt(li.dataset.repeat, 10) || 0;
  if (repeat > 1) {
    const R = num(li.dataset.ring, r);
    const proto = g.children.slice();
    g.clear();
    for (let i = 0; i < repeat; i++) {
      const a = (i / repeat) * Math.PI * 2;
      const c = new THREE.Group();
      for (const p of proto) c.add(p.clone());
      // the four cardinal marks are longer, the way a dial is drawn
      const s = i % (repeat / 4) === 0 && repeat % 4 === 0 ? 1.6 : 1;
      c.scale.set(1, 1, s);
      c.position.set(Math.sin(a) * R, 0, -Math.cos(a) * R);
      c.rotation.y = -a;
      g.add(c);
    }
    radial = R + Math.max(w, d) / 2;
  }
  if (li.dataset.rot) g.rotation.y = (num(li.dataset.rot, 0) * Math.PI) / 180;
  if (li.dataset.tilt) g.rotation.x = (num(li.dataset.tilt, 0) * Math.PI) / 180;
  if (li.dataset.off) {
    const [x, y, z] = String(li.dataset.off).split(',').map((v) => num(v, 0));
    g.position.set(x || 0, y || 0, z || 0);
  }
  return { group: g, h, radial };
}

for (const root of roots) {
  const items = [...root.querySelectorAll('li')];

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch { renderer = null; }
  if (!renderer) continue;

  const stage = document.createElement('div');
  stage.className = 'exploded__gl';
  root.prepend(stage);
  // is-live hides the fallback list. Only claim it once something has actually
  // rendered, or a shader failure leaves an empty box where the content was.
  let live = false;

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(-3, 4, 2.5);
  const rim = new THREE.DirectionalLight(0xbfd0ff, 1.1);
  rim.position.set(3, 2, -3);
  scene.add(key, rim, new THREE.AmbientLight(0x5b6a86, 0.35));

  const orbit = new THREE.Group();      // the slow turn
  const root3 = new THREE.Group();      // the object, axis along local Y
  orbit.add(root3);
  scene.add(orbit);
  const SPREAD = num(root.dataset.spread, 0.62);
  const TURN = num(root.dataset.turn, 0.9);
  const AXIS_X = String(root.dataset.axis || 'y').toLowerCase() === 'x';
  if (AXIS_X) root3.rotation.z = -Math.PI / 2;   // local Y becomes world X

  /* parts: { group, home, apart, li } in stack order, bottom first */
  let layers = [];
  const bottomUp = items.slice().reverse();

  const layout = (parts) => {
    // explicit data-y wins; otherwise stack on the part below
    let y = 0;
    for (const p of parts) {
      if (p.li && p.li.dataset.y !== undefined) p.home = num(p.li.dataset.y, 0);
      else { p.home = y + p.h / 2; y += p.h + 0.02; }
    }
    const order = parts.slice().sort((a, b) => a.home - b.home);
    const mid = (order.length - 1) / 2;
    order.forEach((p, i) => { p.apart = p.home + (i - mid) * SPREAD; });
    for (const p of parts) { p.group.position.y = p.home; root3.add(p.group); }
  };

  if (root.dataset.model && GLTFLoader) {
    // a real model: name each part, or take the top-level children in order
    try {
      const gltf = await new GLTFLoader().loadAsync(root.dataset.model);
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3(); box.getSize(size);
      const s = 2.5 / Math.max(size.x, size.y, size.z, 0.001);
      model.scale.setScalar(s);
      model.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(s));
      const named = items.map((li) => {
        const want = String(li.dataset.part || li.textContent).trim().toLowerCase();
        let found = null;
        model.traverse((o) => { if (!found && o.isMesh && o.name.toLowerCase().includes(want)) found = o; });
        return found;
      });
      const meshes = named.every(Boolean) ? named : model.children.slice(0, items.length);
      root3.add(model);
      layers = meshes.map((mesh, i) => {
        const b = new THREE.Box3().setFromObject(mesh);
        const c = b.getCenter(new THREE.Vector3());
        return { group: mesh, li: items[i], h: b.max.y - b.min.y, home: c.y, base: mesh.position.y, radial: (Math.max(size.x, size.z) * s) / 2 };
      }).filter((p) => p.group);
      const order = layers.slice().sort((a, b) => a.home - b.home);
      const mid = (order.length - 1) / 2;
      order.forEach((p, i) => { p.apart = p.base + (i - mid) * SPREAD; p.home = p.base; });
    } catch (err) {
      console.warn('exploded.js: model failed, using the list', err);
    }
  }
  if (!layers.length) {
    layers = bottomUp.map((li) => Object.assign(build(li), { li }));
    layout(layers);
  }

  // a contact shadow under the whole thing, so it sits in space
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,.62)'); grd.addColorStop(0.55, 'rgba(0,0,0,.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const bounds = new THREE.Box3().setFromObject(root3);
  const extent = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(extent.x, extent.y, extent.z) / 2;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 4.2, radius * 4.2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = bounds.min.y - 0.03;
  orbit.add(shadow);

  // callouts, one per part, projected onto the real world point
  const tagLayer = document.createElement('div');
  tagLayer.className = 'exploded__tags';
  tagLayer.setAttribute('aria-hidden', 'true');
  stage.appendChild(tagLayer);
  const tags = layers.map((p) => {
    const el = document.createElement('p');
    el.className = 'exploded__tag';
    // textContent in, textContent out. Read as text and written as HTML, a
    // list item that came from a CMS could carry markup back into the page.
    const span = document.createElement('span');
    span.textContent = (p.li ? p.li.textContent : '').trim();
    el.appendChild(span);
    tagLayer.appendChild(el);
    return el;
  });

  const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3(), _b = new THREE.Box3();
  const toScreen = (world, rect) => {
    _c.copy(world).applyMatrix4(camera.matrixWorldInverse);
    if (_c.z > -camera.near) return null;   // behind the camera: project() lies
    _v.copy(world).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * rect.width, y: (-_v.y * 0.5 + 0.5) * rect.height };
  };

  // frame the exploded state, whatever its size: the widest part across the
  // axis or half the pulled-apart length, whichever is larger. A chain runs
  // off the frame on purpose, the way a bracelet leaves a product shot.
  // data-fit="1.3" on the root gives more air.
  const radial = Math.max(0.5, ...layers.map((p) => p.radial || 0));
  const lo = Math.min(...layers.map((p) => p.apart - p.h / 2));
  const hi = Math.max(...layers.map((p) => p.apart + p.h / 2));
  const FIT = num(root.dataset.fit, 1.05);
  const spreadExtent = Math.max(radial * 1.1, (hi - lo) / 2) * FIT;
  const dist = spreadExtent / Math.tan((camera.fov * Math.PI) / 360);
  const mid = (lo + hi) / 2;
  const centre = AXIS_X ? new THREE.Vector3(mid, 0, 0) : new THREE.Vector3(0, mid, 0);

  const resize = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  };
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  else addEventListener('resize', resize, { passive: true });

  const track = root.closest('[data-explode-track]') || root.parentElement;
  let target = 0, eased = 0, running = false, last = 0;
  // Per second, not per frame. See the note in frame().
  const EASE_K = num(root.dataset.ease, 7);
  const read = () => {
    const r = track.getBoundingClientRect();
    const total = r.height - innerHeight;
    target = total <= 0
      ? Math.min(1, Math.max(0, 1 - (r.top + r.height) / (innerHeight + r.height)))
      : Math.min(1, Math.max(0, -r.top / total));
    if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
  };
  addEventListener('scroll', read, { passive: true });
  addEventListener('resize', read, { passive: true });

  function frame(now) {
    // Frame-rate independent easing. `eased += (target - eased) * 0.11` is the
    // shape everybody writes, and it is wrong: 0.11 PER FRAME means the object
    // arrives nearly three times faster on a 144 Hz laptop than on a 50 Hz
    // external display, so the choreography is a different piece of work
    // depending on the monitor. `1 - exp(-dt * k)` is the same curve expressed
    // per SECOND, which is the unit the timing was authored in.
    //
    // k = 7 reproduces the old feel at 60 Hz exactly: 1 - exp(-7/60) = 0.1109.
    const t = typeof now === 'number' ? now : (last || 0);
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
    last = t;
    eased += (target - eased) * (1 - Math.exp(-dt * EASE_K));
    const spread = Math.min(1, eased / 0.55);          // pull apart first
    const turn = Math.max(0, (eased - 0.4) / 0.6);     // then show the edges
    for (const p of layers) p.group.position.y = p.home + (p.apart - p.home) * spread;
    orbit.rotation.y = -0.32 + turn * TURN;
    shadow.material.opacity = 1 - spread * 0.45;
    const dir = AXIS_X ? _v.set(0.55, 0.42, 1.0) : _v.set(0.72, 0.5 + turn * 0.15, 0.95);
    camera.position.copy(dir.normalize().multiplyScalar(dist - turn * dist * 0.08)).add(centre);
    camera.lookAt(centre);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    if (!live) { live = true; root.classList.add('is-live'); }

    const rect = stage.getBoundingClientRect();
    const placed = [];
    layers.forEach((p, i) => {
      _b.setFromObject(p.group);
      _w.set(_b.max.x + 0.12, (_b.min.y + _b.max.y) / 2, (_b.min.z + _b.max.z) / 2);
      const s = toScreen(_w, rect);
      const t = tags[i];
      if (!s || spread < 0.25) { t.style.opacity = '0'; return; }
      // A projected point can land past the stage, and a label hanging off the
      // right edge gives the whole document a horizontal scrollbar.
      const x = Math.max(0, Math.min(s.x, rect.width - t.offsetWidth));
      const y = Math.max(0, Math.min(s.y, rect.height - t.offsetHeight));
      // Two parts can project to the same point mid-turn. Two labels on top of
      // each other are unreadable, so the later one steps aside.
      const hh = t.offsetHeight || 16;
      if (placed.some((q) => Math.abs(q - y) < hh + 2)) { t.style.opacity = '0'; return; }
      placed.push(y);
      t.style.opacity = String(Math.min(1, (spread - 0.25) / 0.3));
      t.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    });

    if (Math.abs(target - eased) > 0.0004) requestAnimationFrame(frame);
    else running = false;
  }
  renderer.compileAsync(scene, camera).then(read).catch(read);
}
}
