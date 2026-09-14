/* ultimate-frontend-skills/sky.js - the launch-page hero, as a WebGL scene.

   The Fable 5.1 hero is not a photograph. It is a three.js scene whose three
   palette dots do not crossfade images: they set a weight vector that the
   render loop eases every frame, and a barycentric blend rewrites every sky
   colour, cloud colour, light colour and the sun direction from it. The whole
   world re-lights, physically, from one vector. That is what this reproduces.

     <div class="sky" data-sky
          data-moods="Noon:#7ea9de|Night:#1a2237|Morning:#dcc4b3"></div>

   What is in the frame, measured off the reference: a luminous sky with the
   cloud pushed to the edges so the centre stays clear for the type, warm
   light on the cloud edges that face the sun, a moon top-right that is faint
   by day and the light source by night, stars that only come out at night,
   and a near branch in each lower corner that is out of focus - depth of
   field is what makes a scene read as a camera and not a drawing.

   Adds its own palette buttons, keyboard-operable, labelled. Falls back to a
   CSS gradient with no WebGL, renders one still frame under reduced motion,
   and stops when it scrolls off screen. No photograph, no asset, no request. */
import * as THREE from 'three';

for (const root of document.querySelectorAll('[data-sky]')) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Noon / Night / Morning, verified off the reference page
  const MOODS = (root.dataset.moods || 'Noon:#7ea9de|Night:#1a2237|Morning:#dcc4b3')
    .split('|').map((s) => {
      const [label, hex] = s.split(':');
      return { label: label.trim(), hex: hex.trim() };
    });

  // Each mood is a full lighting rig, not just a sky colour. Every field is
  // blended by the same weights, so a half-way state is a real dusk and not a
  // crossfade of two pictures.
  const RIG = [
    { top: 0x4f86cf, hor: 0xdfe6ee, lit: 0xfff3e0, shade: 0xaebfd6, glow: 0xffe4bf,
      sun: [0.35, 0.8, 0.55], disc: 0.0, stars: 0.0, moon: 0.35, key: 0xffefd6, amb: 0xa8c2e6, power: 2.3 },
    { top: 0x070b18, hor: 0x1a2440, lit: 0x5a6a8e, shade: 0x0f1526, glow: 0x7f8fb8,
      sun: [0.55, 0.62, -0.55], disc: 0.0, stars: 1.0, moon: 1.0, key: 0xa8bcd8, amb: 0x2f3950, power: 0.85 },
    { top: 0x3f5f97, hor: 0xeccbaa, lit: 0xffd9b3, shade: 0x8d7b8c, glow: 0xffb072,
      sun: [-0.72, 0.16, -0.62], disc: 1.0, stars: 0.08, moon: 0.15, key: 0xffc490, amb: 0x6a6480, power: 1.7 },
  ];
  const n = Math.min(MOODS.length, RIG.length);
  // data-mood="Night" starts the page in that mood; the first one otherwise
  const want = String(root.dataset.mood || '').trim().toLowerCase();
  const first = Math.max(0, MOODS.slice(0, n).findIndex((m) => m.label.toLowerCase() === want));
  const W = RIG.map((_, i) => (i === first ? 1 : 0));
  const T = W.slice();
  root.dataset.mood = MOODS[first].label.toLowerCase();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch { renderer = null; }

  /* ── the dots. They exist either way: with no WebGL they still swap the
        CSS fallback, so the control is never a dead button. ────────────── */
  const bar = document.createElement('div');
  bar.className = 'sky__dots';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Time of day');
  const dots = MOODS.slice(0, n).map((m, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sky__dot';
    b.style.setProperty('--dot', m.hex);
    b.setAttribute('aria-label', m.label);
    b.setAttribute('aria-pressed', String(i === first));
    b.addEventListener('click', () => {
      for (let k = 0; k < n; k++) T[k] = k === i ? 1 : 0;
      dots.forEach((d, k) => d.setAttribute('aria-pressed', String(k === i)));
      root.style.setProperty('--sky-fallback', MOODS[i].hex);
      root.dataset.mood = MOODS[i].label.toLowerCase();
      // Three cases, not two. With no WebGL the CSS fallback is the sky. With
      // WebGL under reduced motion the canvas is the sky and a CSS gradient
      // painted behind it changes nothing visible - the dot looked dead. Snap
      // the weights and render the one still frame the calm path uses.
      if (!renderer) { for (let k = 0; k < n; k++) W[k] = T[k]; paintFallback(); }
      else if (calm) { for (let k = 0; k < n; k++) W[k] = T[k]; frame(0); }
      else kick();
    });
    bar.appendChild(b);
    return b;
  });
  root.appendChild(bar);

  const _c = new THREE.Color();
  const mix = (field) => {
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < n; i++) { _c.setHex(RIG[i][field]); r += _c.r * W[i]; g += _c.g * W[i]; b += _c.b * W[i]; }
    return [r, g, b];
  };
  const scalar = (field) => RIG.reduce((a, r, i) => a + r[field] * W[i], 0);
  const paintFallback = () => {
    const [tr, tg, tb] = mix('top'), [hr, hg, hb] = mix('hor');
    const css = (a) => `rgb(${a.map((x) => Math.round(x * 255)).join(' ')})`;
    root.style.background = `linear-gradient(178deg in oklab, ${css([tr, tg, tb])}, ${css([hr, hg, hb])})`;
  };

  if (!renderer) { paintFallback(); continue; }

  const stage = document.createElement('div');
  stage.className = 'sky__gl';
  root.prepend(stage);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // the reference post chain starts here
  renderer.toneMappingExposure = 1.0;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Looking slightly up, so the horizon sits in the lower fifth of the frame
  // and the sky fills it, the way the reference is framed.
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(0, 1.2, 0.001);
  camera.lookAt(0, 1.55, -3);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
        uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) },
        uDisc: { value: 0 }, uStars: { value: 0 }, uMoon: { value: 0 }, uT: { value: 0 },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        precision highp float;
        varying vec3 vP;
        uniform vec3 uTop, uHor, uLit, uShade, uGlow, uSun;
        uniform float uDisc, uStars, uMoon, uT;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){
          float a = 0.5, s = 0.0;
          for (int k = 0; k < 5; k++) { s += nz(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
          return s;
        }
        void main(){
          vec3 d = normalize(vP);
          float y = d.y;
          vec3 sun = normalize(uSun);
          float sd = max(dot(d, sun), 0.0);

          /* the sky itself: horizon to zenith, warmed toward the sun */
          vec3 c = mix(uHor, uTop, smoothstep(-0.04, 0.62, y));
          c += uGlow * pow(sd, 6.0) * 0.28;
          c += uGlow * pow(sd, 140.0) * 1.6 * uDisc;          /* a low sun, when a mood has one */

          /* stars: fixed on the dome, only above the horizon, only at night */
          if (uStars > 0.001) {
            vec2 sp = vec2(atan(d.x, -d.z), asin(clamp(y, -1.0, 1.0))) * 70.0;
            vec2 cell = floor(sp);
            vec2 off = vec2(h(cell + 1.3), h(cell + 7.7)) - 0.5;
            float pt = smoothstep(0.09, 0.0, length(fract(sp) - 0.5 - off * 0.6));
            float st = step(0.9955, h(cell)) * pt * smoothstep(0.02, 0.3, y);
            float tw = 0.7 + 0.3 * sin(uT * 2.0 + h(cell + 3.1) * 40.0);
            c += vec3(0.9, 0.93, 1.0) * st * tw * uStars;
          }

          /* cloud: a plane of noise at height, kept away from the centre so
             the type has clear sky behind it, thicker toward the horizon and
             the corners, lit on the side that faces the sun */
          vec2 q = d.xz / max(0.10, y + 0.24) * 0.85 + vec2(uT * 0.0045, uT * 0.0016);
          float f = fbm(q);
          float f2 = fbm(q + sun.xz * 0.11);
          float band = smoothstep(0.62, 0.02, y);                       /* low sky */
          float sides = smoothstep(0.18, 0.75, abs(d.x) / max(0.001, length(d.xz)));
          float where = clamp(band * 0.6 + sides * 0.85, 0.0, 1.0) * smoothstep(-0.03, 0.10, y);
          float dens = smoothstep(0.38, 0.68, f) * where;
          float lit = clamp((f - f2) * 5.0 + 0.55, 0.0, 1.0);
          vec3 cloud = mix(uShade, uLit, lit);
          cloud += uGlow * pow(sd, 3.0) * 0.18 * lit;
          c = mix(c, cloud, dens * 0.95);

          /* the moon, top-right, a crescent: one disc minus another */
          vec3 m = normalize(vec3(0.386, 0.407, -0.828));
          float md = dot(d, m);
          float disc = smoothstep(0.99895, 0.99915, md);
          float bite = smoothstep(0.99860, 0.99905, dot(d, normalize(m + vec3(0.017, 0.008, 0.0))));
          float crescent = clamp(disc - bite * 0.92, 0.0, 1.0);
          c = mix(c, vec3(0.97, 0.96, 0.92), crescent * (0.35 + 0.65 * uMoon));
          c += vec3(0.85, 0.88, 1.0) * pow(max(md, 0.0), 900.0) * 0.35 * uMoon;

          /* grain, which also dithers the ramp */
          c += (h(gl_FragCoord.xy + fract(uT)) - 0.5) * 0.012;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  /* ── the near plane: branches in the lower corners, out of focus. Drawn in
        2D on a canvas over the sky, blurred by CSS, because a blur that costs
        nothing beats a depth-of-field pass that costs everything. ────────── */
  const near = document.createElement('canvas');
  near.className = 'sky__near';
  near.setAttribute('aria-hidden', 'true');
  stage.appendChild(near);
  let sd = 11;
  const rr = () => ((sd = (sd * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const drawBranch = (g, x, y, ang, len, w, depth) => {
    if (depth <= 0 || len < 6) return;
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    const cx = x + Math.cos(ang + 0.35) * len * 0.5, cy = y + Math.sin(ang + 0.35) * len * 0.5;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
    if (depth <= 2 && rr() < 0.75) {
      // a few leaves near the tips
      for (let k = 0; k < 3; k++) {
        const t = 0.4 + k * 0.25, lx = x + (ex - x) * t, ly = y + (ey - y) * t;
        const la = ang + (rr() - 0.5) * 2.2, ll = 7 + rr() * 9;
        g.beginPath();
        g.ellipse(lx + Math.cos(la) * ll * 0.5, ly + Math.sin(la) * ll * 0.5, ll * 0.5, ll * 0.22, la, 0, Math.PI * 2);
        g.fill();
      }
    }
    const forks = depth > 3 ? 2 : 2 + Math.round(rr());
    for (let k = 0; k < forks; k++) {
      const t = 0.45 + rr() * 0.5;
      drawBranch(g, x + (ex - x) * t, y + (ey - y) * t, ang + (rr() - 0.5) * 1.3, len * (0.55 + rr() * 0.25), w * 0.62, depth - 1);
    }
  };
  const paintNear = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    near.width = Math.round(r.width * dpr); near.height = Math.round(r.height * dpr);
    const g = near.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    g.strokeStyle = '#17120e'; g.fillStyle = '#17120e'; g.lineCap = 'round';
    sd = 11;
    const s = Math.max(0.7, Math.min(1.4, r.width / 1440));
    // left: from below the edge, reaching up and in
    drawBranch(g, -20 * s, r.height * 0.86, -0.55, 300 * s, 9 * s, 5);
    // right: lower and shallower, so the two corners do not mirror
    drawBranch(g, r.width + 30 * s, r.height * 0.96, Math.PI + 0.42, 260 * s, 8 * s, 5);
  };

  /* pointer parallax on the near plane only: the sky is at infinity */
  let px = 0, py = 0, tx = 0, ty = 0;
  if (!calm && matchMedia('(pointer: fine)').matches) {
    addEventListener('pointermove', (e) => {
      tx = (e.clientX / innerWidth - 0.5) * -14;
      ty = (e.clientY / innerHeight - 0.5) * -8;
      kick();
    }, { passive: true });
  }

  const key = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.6));

  const resize = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    paintNear();
  };
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(() => { resize(); kick(); }).observe(stage);
  else addEventListener('resize', () => { resize(); kick(); }, { passive: true });

  let running = false, last = 0;
  function kick() { if (!running) { running = true; last = 0; requestAnimationFrame(frame); } }

  function frame(ts) {
    running = false;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
    // the reference constant: frame-rate independent, no tween library
    const k = 1 - Math.exp(-dt * 2.2);
    let settling = false;
    for (let i = 0; i < n; i++) {
      W[i] += (T[i] - W[i]) * k;
      if (Math.abs(T[i] - W[i]) > 0.002) settling = true;
    }
    const u = sky.material.uniforms;
    u.uTop.value.setRGB(...mix('top'));
    u.uHor.value.setRGB(...mix('hor'));
    u.uLit.value.setRGB(...mix('lit'));
    u.uShade.value.setRGB(...mix('shade'));
    u.uGlow.value.setRGB(...mix('glow'));
    u.uSun.value.set(
      RIG.reduce((a, r, i) => a + r.sun[0] * W[i], 0),
      RIG.reduce((a, r, i) => a + r.sun[1] * W[i], 0),
      RIG.reduce((a, r, i) => a + r.sun[2] * W[i], 0),
    );
    u.uDisc.value = scalar('disc');
    u.uStars.value = scalar('stars');
    u.uMoon.value = scalar('moon');
    u.uT.value = ts / 1000;
    key.color.setRGB(...mix('key'));
    key.intensity = scalar('power');
    key.position.copy(u.uSun.value).multiplyScalar(50);
    renderer.render(scene, camera);

    px += (tx - px) * k; py += (ty - py) * k;
    near.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0)`;
    if (Math.abs(tx - px) > 0.05 || Math.abs(ty - py) > 0.05) settling = true;

    if (!calm) settling = true;     // the cloud drifts, so the loop stays alive on screen
    if (settling) kick();
  }

  if (calm) { for (let i = 0; i < n; i++) W[i] = T[i]; frame(0); running = false; }
  else new IntersectionObserver(([e]) => { if (e.isIntersecting) kick(); else running = true; })
    .observe(stage);
}
