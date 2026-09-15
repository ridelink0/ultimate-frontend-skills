/* ultimate-frontend-skills/sky.js - the launch-page hero, as a WebGL scene.

   The Fable 5.1 hero is not a photograph. It is a three.js scene whose three
   palette dots do not crossfade images: they set a weight vector that the
   render loop eases every frame, and a barycentric blend rewrites every sky
   colour, cloud colour, light colour and the sun direction from it. The whole
   world re-lights, physically, from one vector. That is what this reproduces.

     <div class="sky" data-sky
          data-moods="Noon:#7ea9de|Night:#1a2237|Morning:#dcc4b3"></div>

   What is in the frame, measured off a 1440px capture of the reference: a
   saturated cornflower sky that is almost flat top to bottom (#7299d0 at the
   top, the middle and the bottom alike - no haze band at the horizon), big
   soft cumulus masses tinted peach-cream stacked up the left edge and in the
   two right corners with the centre column clear for the type, a large
   half-lit moon top-right (about 165px across at 1440, soft-edged, its dark
   side barely lifting off the sky), stars only at night, and ONE branch in
   the lower-right corner, heavily out of focus and low in contrast, most of
   it below the first viewport. Depth of field is what makes a scene read as
   a camera and not a drawing, so the branch is blurred hard and drawn faint.

   Tuning, without editing the engine - every default is the reference value:

     data-branches="1"   0, 1 or 2 near branches. 1 = one in the lower-right
                         corner. 2 adds a lower-left one. Neither ever crosses
                         the centre column or climbs out of the frame's lower
                         third and a bit.
     data-moon="170"     moon diameter in CSS px at a 1440px-wide stage; it
                         scales with the stage width. 0 removes the moon.
     data-cloud="1"      cloud cover, 0..1. 1 is the reference amount; 0 is a
                         clear sky. It scales where cloud may form, not its
                         colour, so the masses keep their relief as they thin.
     data-mood="Night"   start in that mood. data-moods renames the dots.

   Colour: every hex in the rig is the value that lands on screen. There is no
   tone curve between the shader and the canvas - renderer.toneMapping is off
   and the shader writes display values - because the day numbers were read
   off the reference's finished pixels, after its own ACES pass, and a second
   curve on top would move them off target.

   Adds its own palette buttons, keyboard-operable, labelled. Falls back to a
   CSS gradient with no WebGL, renders one still frame under reduced motion,
   and stops when it scrolls off screen. No photograph, no asset, no request. */
import * as THREE from 'three';

for (const root of document.querySelectorAll('[data-sky]')) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const num = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  const BRANCHES = Math.max(0, Math.min(2, Math.round(num(root.dataset.branches, 1))));
  const MOON_PX = Math.max(0, num(root.dataset.moon, 170));
  const CLOUD = Math.max(0, Math.min(1, num(root.dataset.cloud, 1)));

  // Noon / Night / Morning, verified off the reference page
  const MOODS = (root.dataset.moods || 'Noon:#7ea9de|Night:#1a2237|Morning:#dcc4b3')
    .split('|').map((s) => {
      const [label, hex] = s.split(':');
      return { label: label.trim(), hex: hex.trim() };
    });

  // Each mood is a full lighting rig, not just a sky colour. Every field is
  // blended by the same weights, so a half-way state is a real dusk and not a
  // crossfade of two pictures. top/mid/hor are the sky's three stops; lit,
  // shade and glow are the cloud's sunlit body, its shadow and the peach that
  // the sun puts on its crowns; moon is the disc's opacity, halo how far its
  // light bleeds into the sky, mcol the colour of its face.
  const RIG = [
    { top: 0x6d95cc, mid: 0x789fd4, hor: 0x84aee2, lit: 0xeed8bb, shade: 0xbfadbe, glow: 0xf4d6a2,
      sun: [0.35, 0.8, 0.55], disc: 0.0, stars: 0.0, moon: 0.95, halo: 0.05, mcol: 0xe2e6f4 },
    { top: 0x0a0f1d, mid: 0x1a2237, hor: 0x2a3552, lit: 0x6e7c9e, shade: 0x141b2d, glow: 0x8a9cc6,
      sun: [0.55, 0.62, -0.55], disc: 0.0, stars: 1.0, moon: 1.0, halo: 0.34, mcol: 0xf4f2ea },
    { top: 0x4e6fa8, mid: 0xa9a6bb, hor: 0xecc9aa, lit: 0xffd9b6, shade: 0x8f7d8f, glow: 0xffa66a,
      sun: [-0.72, 0.16, -0.62], disc: 1.0, stars: 0.08, moon: 0.4, halo: 0.05, mcol: 0xe6d9d2 },
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

  // hex -> the three channels as written, 0..1. Not THREE.Color: with colour
  // management on, Color.setHex would linearise the value and the shader,
  // which writes straight to the canvas, would then paint it a gamma darker.
  const chan = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const mix = (field) => {
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < n; i++) { const [x, y, z] = chan(RIG[i][field]); r += x * W[i]; g += y * W[i]; b += z * W[i]; }
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
  // The rig holds finished on-screen values (see the header), so nothing is
  // allowed to re-map them on the way out.
  renderer.toneMapping = THREE.NoToneMapping;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Looking slightly up, so the horizon sits in the lower fifth of the frame
  // and the sky fills it, the way the reference is framed.
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(0, 1.2, 0.001);
  camera.lookAt(0, 1.55, -3);

  // The moon's lit side faces down-left in the reference (a waxing gibbous
  // seen top-right), and the terminator is soft. Screen-space direction.
  const MOON_LIT = new THREE.Vector2(-0.64, -0.46);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Vector3() }, uMid: { value: new THREE.Vector3() }, uHor: { value: new THREE.Vector3() },
        uLit: { value: new THREE.Vector3() }, uShade: { value: new THREE.Vector3() }, uGlow: { value: new THREE.Vector3() },
        uMoonCol: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(0, 1, 0) },
        uRes: { value: new THREE.Vector2(1, 1) }, uMoonC: { value: new THREE.Vector2(0, 0) }, uMoonLit: { value: MOON_LIT },
        uMoonR: { value: 0 }, uDisc: { value: 0 }, uStars: { value: 0 }, uMoon: { value: 0 }, uHalo: { value: 0 },
        uCloud: { value: CLOUD }, uT: { value: 0 },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        precision highp float;
        varying vec3 vP;
        uniform vec3 uTop, uMid, uHor, uLit, uShade, uGlow, uMoonCol, uSun;
        uniform vec2 uRes, uMoonC, uMoonLit;
        uniform float uMoonR, uDisc, uStars, uMoon, uHalo, uCloud, uT;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){
          float a = 0.5, s = 0.0;
          for (int k = 0; k < 5; k++) { s += nz(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
          return s;
        }
        /* a soft round mass in screen space, aspect-corrected: 1 at its centre, 0 at r */
        float mass(vec2 s, vec2 c, float r, float asp){ return 1.0 - smoothstep(r * 0.3, r, length((s - c) * vec2(asp, 1.0))); }
        void main(){
          vec3 d = normalize(vP);
          float y = d.y;
          vec3 sun = normalize(uSun);
          float sd = max(dot(d, sun), 0.0);
          vec2 s = gl_FragCoord.xy / uRes;          /* 0..1 across the stage, y up */
          float asp = uRes.x / uRes.y;

          /* the sky: three stops, deepest at the zenith, no haze at the horizon */
          vec3 c = mix(uHor, uMid, smoothstep(-0.32, 0.11, y));
          c = mix(c, uTop, smoothstep(0.11, 0.55, y));
          c += uGlow * pow(sd, 6.0) * 0.14;
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

          /* cloud: cumulus masses, not a layer. A domain-warped noise field
             is thresholded, and the threshold is RAISED wherever cloud is not
             wanted - up the centre column, where the type is - rather than the
             colour faded, so whatever survives keeps its full body. The masses
             sit where the reference stacks them: up the left edge, the top-left,
             the bottom-left, and the two right corners. */
          vec2 p = (s - 0.5) * vec2(asp, 1.0);
          vec2 drift = vec2(uT * 0.005, uT * 0.0012);
          vec2 wv = vec2(fbm(p * 1.3 + 3.1 + drift * 0.5), fbm(p * 1.3 + 9.7 + drift * 0.5)) - 0.5;
          vec2 q = p * 2.2 + wv * 0.6 + drift;
          float f = fbm(q) + (nz(q * 6.5 + 2.2) - 0.5) * 0.10;                  /* the fine relief on the crowns */
          float place = smoothstep(0.30, 0.0, s.x);                        /* a column up the left edge */
          place = max(place, mass(s, vec2(0.20, 0.96), 0.36, asp));        /* top-left */
          place = max(place, mass(s, vec2(0.08, 0.10), 0.42, asp));        /* bottom-left */
          place = max(place, mass(s, vec2(0.98, 0.84), 0.30, asp));        /* top-right, behind the moon */
          place = max(place, mass(s, vec2(0.84, -0.02), 0.40, asp));       /* bottom-right */
          place = max(place, smoothstep(0.16, 0.0, s.y) * 0.9);            /* the low band along the bottom */
          /* the type's column stays clear - but only above the low band, which
             the reference runs right across the foot of the frame */
          place *= mix(1.0, smoothstep(0.08, 0.30, abs(s.x - 0.5)), smoothstep(0.05, 0.22, s.y)) * uCloud;
          float th = mix(0.95, 0.40, place);
          float dens = smoothstep(th, th + 0.22, f);
          vec2 toSun = normalize(sun.xy + vec2(0.0001, 0.0));
          float f2 = fbm(q + toSun * 0.10);
          float lit = clamp((f - f2) * 6.5 + 0.55, 0.0, 1.0);             /* the side that faces the sun */
          vec3 cloud = mix(uShade, uLit, lit);
          float crown = dens * (1.0 - dens) * 4.0;                          /* the edge, where the sun gets through */
          cloud = mix(cloud, uGlow, crown * lit * 0.6);
          c = mix(c, cloud, dens * 0.96);

          /* the moon, top-right, in screen space so data-moon is a real pixel
             size: a sphere lit from uMoonLit with a wide terminator, faint
             maria, a soft rim, and its light bleeding into the sky */
          if (uMoonR > 0.5) {
            vec2 mp = (gl_FragCoord.xy - uMoonC) / uMoonR;
            float mr = length(mp);
            float disc = 1.0 - smoothstep(0.90, 1.05, mr);
            vec3 nrm = vec3(mp, sqrt(max(0.0, 1.0 - min(mr * mr, 1.0))));
            float ph = smoothstep(-0.5, 0.2, dot(nrm, normalize(vec3(uMoonLit, 0.55))));
            float mare = fbm(mp * 2.4 + 4.2);
            vec3 bright = uMoonCol * (0.95 + 0.14 * (mare - 0.5));
            vec3 dark = mix(c, uMoonCol, 0.36);                              /* the unlit side barely lifts off the sky */
            vec3 moon = mix(dark, bright, ph);
            c = mix(c, moon, disc * uMoon);
            float halo = exp(-max(mr - 0.95, 0.0) * 3.0) * (1.0 - disc);
            c += uMoonCol * halo * uHalo;
          }

          /* grain, which also dithers the ramp */
          c += (h(gl_FragCoord.xy + fract(uT)) - 0.5) * 0.012;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  /* ── the near plane: a branch in the lower-right corner, out of focus.
        Drawn in 2D on a canvas over the sky and blurred once, at paint time,
        because a blur that costs nothing beats a depth-of-field pass that
        costs everything. Faint on purpose: in the reference the stems are
        only about fifteen percent darker than the sky behind them. ──────── */
  const near = BRANCHES ? document.createElement('canvas') : null;
  if (near) {
    near.className = 'sky__near';
    near.setAttribute('aria-hidden', 'true');
    stage.appendChild(near);
  }
  let sd = 11;
  const rr = () => ((sd = (sd * 1664525 + 1013904223) % 4294967296) / 4294967296);
  // A stem: nearly straight with a slight bend, thinning toward the tip,
  // forking once or twice, with a few leaf blobs near the ends. `keep` is the
  // region a segment may end in; anything that would leave it is pruned, so
  // no stem ever reaches the centre column or climbs onto the type.
  const drawBranch = (g, x, y, ang, len, w, depth, keep) => {
    if (depth <= 0 || len < 8) return;
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    if (!keep(ex, ey)) return;
    const bend = ang + (rr() - 0.5) * 0.5;
    const cx = x + Math.cos(bend) * len * 0.5, cy = y + Math.sin(bend) * len * 0.5;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
    if (depth <= 2) {
      const leaves = 2 + Math.round(rr() * 2);
      for (let k = 0; k < leaves; k++) {
        const t = 0.55 + rr() * 0.45, la = ang + (rr() - 0.5) * 2.4, ll = w * 1.2 + rr() * w;
        const lx = x + (ex - x) * t + Math.cos(la) * ll, ly = y + (ey - y) * t + Math.sin(la) * ll;
        g.beginPath(); g.ellipse(lx, ly, ll * 0.9, ll * 0.5, la, 0, Math.PI * 2); g.fill();
      }
    }
    const forks = 1 + Math.round(rr());
    for (let k = 0; k < forks; k++) {
      const t = 0.5 + rr() * 0.45;
      drawBranch(g, x + (ex - x) * t, y + (ey - y) * t, ang + (rr() - 0.5) * 0.9, len * (0.5 + rr() * 0.3), w * 0.66, depth - 1, keep);
    }
  };
  const paintNear = () => {
    if (!near) return;
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const Wd = r.width, H = r.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    near.width = Math.round(Wd * dpr); near.height = Math.round(H * dpr);
    const g = near.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, Wd, H);
    // The blur is a fraction of the frame height so the look holds at any
    // size. It is baked into the bitmap here, once, where the context supports
    // a filter; otherwise the element's CSS blur carries it.
    const blur = H * 0.018;
    const baked = 'filter' in g;
    if (baked) g.filter = `blur(${blur.toFixed(1)}px)`;
    near.style.filter = `blur(${(baked ? H * 0.003 : blur).toFixed(1)}px)`;
    g.strokeStyle = g.fillStyle = '#1b1d28'; g.lineCap = 'round'; g.globalAlpha = 0.55;
    sd = 11;
    const s = Math.max(0.7, Math.min(1.4, Wd / 1440));
    // right: a fan of stems from below the corner, rising up and in. Segments
    // may end only right of the centre column and in the frame's lower 38%.
    const right = (x, y) => x > Wd * 0.56 && y > H * 0.62;
    const fan = [[0.50, 0.62], [0.72, 0.52], [0.98, 0.44], [1.26, 0.36]];      /* [angle past left, length as a share of height] */
    for (const [a, l] of fan) {
      drawBranch(g, Wd + (40 + rr() * 60) * s, H + (30 + rr() * 50) * s, Math.PI + a + (rr() - 0.5) * 0.15, H * l, 13 * s, 4, right);
    }
    if (BRANCHES > 1) {
      // left: the mirror, lower and shallower so the two corners do not rhyme
      const left = (x, y) => x < Wd * 0.44 && y > H * 0.62;
      for (const [a, l] of fan) {
        drawBranch(g, -(40 + rr() * 60) * s, H + (60 + rr() * 50) * s, -a - (rr() - 0.5) * 0.15, H * l * 0.85, 12 * s, 4, left);
      }
    }
  };

  /* pointer parallax on the near plane only: the sky is at infinity */
  let px = 0, py = 0, tx = 0, ty = 0;
  if (near && !calm && matchMedia('(pointer: fine)').matches) {
    addEventListener('pointermove', (e) => {
      tx = (e.clientX / innerWidth - 0.5) * -14;
      ty = (e.clientY / innerHeight - 0.5) * -8;
      kick();
    }, { passive: true });
  }

  const resize = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    // screen-space uniforms are in drawing-buffer pixels, which is what
    // gl_FragCoord measures in
    const pr = renderer.getPixelRatio();
    const u = sky.material.uniforms;
    u.uRes.value.set(r.width * pr, r.height * pr);
    // the moon sits at 0.81 of the width and 0.22 of the height from the top
    // in the reference; data-moon is its diameter at 1440 and scales with width
    u.uMoonC.value.set(0.814 * r.width * pr, (1 - 0.215) * r.height * pr);
    u.uMoonR.value = (MOON_PX / 2) * (r.width / 1440) * pr;
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
    u.uTop.value.set(...mix('top'));
    u.uMid.value.set(...mix('mid'));
    u.uHor.value.set(...mix('hor'));
    u.uLit.value.set(...mix('lit'));
    u.uShade.value.set(...mix('shade'));
    u.uGlow.value.set(...mix('glow'));
    u.uMoonCol.value.set(...mix('mcol'));
    u.uSun.value.set(
      RIG.reduce((a, r, i) => a + r.sun[0] * W[i], 0),
      RIG.reduce((a, r, i) => a + r.sun[1] * W[i], 0),
      RIG.reduce((a, r, i) => a + r.sun[2] * W[i], 0),
    );
    u.uDisc.value = scalar('disc');
    u.uStars.value = scalar('stars');
    u.uMoon.value = scalar('moon');
    u.uHalo.value = scalar('halo');
    u.uT.value = ts / 1000;
    renderer.render(scene, camera);

    if (near) {
      px += (tx - px) * k; py += (ty - py) * k;
      near.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0)`;
      if (Math.abs(tx - px) > 0.05 || Math.abs(ty - py) > 0.05) settling = true;
    }

    if (!calm) settling = true;     // the cloud drifts, so the loop stays alive on screen
    if (settling) kick();
  }

  if (calm) { for (let i = 0; i < n; i++) W[i] = T[i]; frame(0); running = false; }
  else new IntersectionObserver(([e]) => { if (e.isIntersecting) kick(); else running = true; })
    .observe(stage);
}
