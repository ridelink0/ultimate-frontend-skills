/* ultimate-frontend-skills/depth.js - real three-plane parallax.

   Foreground, middle ground, background, each moving at its own rate against
   both scroll AND the pointer, with depth of field and aerial perspective
   applied from the same depth number. One rAF loop for the whole page.

   Declarative:
     <div class="depth">
       <img class="plane" data-depth="-0.55" src="sky.jpg">      background: lags
       <img class="plane" data-depth="0.15"  src="mid.png">      middle: near page speed
       <img class="plane" data-depth="0.85"  src="near.png">     foreground: leads
     </div>

   data-depth is signed: negative sits BEHIND the page and lags it, positive
   sits in FRONT and leads it. |depth| also drives blur and desaturation, so a
   far plane is automatically hazier and a near one automatically softer -
   which is what makes flat cut-outs read as distance rather than as a collage.

   Optional single-photo 3D: give one image a depth map and the whole scene
   parallaxes from one photograph.
     <div class="depth" data-photo="hero.jpg" data-depthmap="hero-depth.png"></div>
   Generate the map with Depth Anything V2 or MiDaS; near = white, far = black. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');

  /* ─────────────────────────────────────────────── plane parallax ───── */
  const scenes = [...document.querySelectorAll('.depth')].map((root) => {
    const planes = [...root.querySelectorAll('[data-depth]')].map((el) => {
      const d = parseFloat(el.dataset.depth) || 0;
      const a = Math.abs(d);
      // aerial perspective and depth of field, both derived from one number
      if (!el.dataset.noGrade) {
        const far = d < 0;
        const blur = a > 0.55 ? (a - 0.55) * 5.5 : 0;
        const parts = [];
        if (blur > 0.15) parts.push(`blur(${blur.toFixed(2)}px)`);
        if (far) parts.push(`saturate(${(1 - a * 0.35).toFixed(2)})`, `brightness(${(1 - a * 0.18).toFixed(2)})`);
        if (parts.length) el.style.filter = `${el.style.filter || ''} ${parts.join(' ')}`.trim();
      }
      el.style.willChange = 'transform';
      return { el, d, a, x: 0, y: 0, tx: 0, ty: 0 };
    });
    return { root, planes, mid: 0, h: 0 };
  }).filter((s) => s.planes.length);

  const measure = () => {
    for (const s of scenes) {
      const r = s.root.getBoundingClientRect();
      s.mid = r.top + scrollY + r.height / 2;
      s.h = r.height || 1;
    }
  };
  if (scenes.length) {
    measure();
    addEventListener('resize', measure, { passive: true });
    if ('ResizeObserver' in window) scenes.forEach((s) => new ResizeObserver(measure).observe(s.root));
  }

  // pointer, eased, shared by every scene
  let px = 0, py = 0, cx = 0, cy = 0;
  if (fine.matches && !reduced.matches) {
    addEventListener('pointermove', (e) => {
      px = (e.clientX / innerWidth - 0.5) * 2;
      py = (e.clientY / innerHeight - 0.5) * 2;
      kick();
    }, { passive: true });
  }

  let ticking = false, idle = 0;
  function kick() { if (!ticking) { ticking = true; requestAnimationFrame(tick); } }

  function tick() {
    ticking = false;
    if (reduced.matches) return;
    const y = scrollY, vh = innerHeight;
    cx += (px - cx) * 0.075;
    cy += (py - cy) * 0.075;
    let moving = Math.abs(px - cx) + Math.abs(py - cy) > 0.0015;

    for (const s of scenes) {
      // -1 .. 1 as the scene crosses the viewport
      const p = (y + vh / 2 - s.mid) / (vh || 1);
      if (Math.abs(p) > 1.6) continue;                 // offscreen: skip the writes
      for (const pl of s.planes) {
        // scroll travel scales with the scene, not with a fixed pixel count,
        // so the same markup works in a 60vh band and a full-screen hero
        const ty = p * pl.d * s.h * 0.30;
        // the pointer moves the near planes most, and against the far ones
        const mx = cx * pl.d * 26;
        const my = cy * pl.d * 16;
        const nx = mx, ny = ty + my;
        if (Math.abs(nx - pl.x) > 0.05 || Math.abs(ny - pl.y) > 0.05) {
          pl.x = nx; pl.y = ny;
          pl.el.style.transform = `translate3d(${nx.toFixed(2)}px, ${ny.toFixed(2)}px, 0)`;
          moving = true;
        }
      }
    }
    idle = moving ? 0 : idle + 1;
    if (idle < 12) kick();                             // settle, then stop burning frames
  }

  if (scenes.length) {
    addEventListener('scroll', kick, { passive: true });
    addEventListener('resize', kick, { passive: true });
    reduced.addEventListener('change', () => {
      if (reduced.matches) for (const s of scenes) for (const p of s.planes) p.el.style.transform = '';
      else kick();
    });
    kick();
  }

  /* ──────────────────────────── one photograph, real 3D, via depth map ───── */
  /* Displaces the sample point by the depth value, so nearer pixels shift more
     than far ones. From one still you get parallax that survives being looked
     at, which layered cut-outs never quite do. */
  const VS = `attribute vec2 p; varying vec2 uv;
    void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `precision highp float; varying vec2 uv;
    uniform sampler2D uImg, uDep; uniform vec2 uOff; uniform float uAmt;
    void main(){
      vec2 t = uv;
      // three refinement steps: one sample smears at the silhouette edges
      for (int i = 0; i < 3; i++) {
        float d = texture2D(uDep, t).r;
        t = uv + uOff * (d - 0.5) * uAmt;
      }
      gl_FragColor = texture2D(uImg, t);
    }`;

  for (const root of document.querySelectorAll('.depth[data-photo][data-depthmap]')) {
    const cv = document.createElement('canvas');
    cv.className = 'depth__gl';
    root.prepend(cv);
    const gl = cv.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) { root.style.backgroundImage = `url(${root.dataset.photo})`; continue; }

    const mk = (t, src) => {
      const x = gl.createShader(t);
      gl.shaderSource(x, src); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) {
        console.warn('depth.js shader:', gl.getShaderInfoLog(x)); return null;
      }
      return x;
    };
    const vs = mk(gl.VERTEX_SHADER, VS), fs = mk(gl.FRAGMENT_SHADER, FS);
    // a silent link failure draws nothing at all: show the photo instead
    if (!vs || !fs) { cv.remove(); root.style.backgroundImage = `url(${root.dataset.photo})`; continue; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('depth.js link:', gl.getProgramInfoLog(prog));
      cv.remove(); root.style.backgroundImage = `url(${root.dataset.photo})`; continue;
    }
    gl.useProgram(prog);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const al = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
    const uOff = gl.getUniformLocation(prog, 'uOff');
    gl.uniform1f(gl.getUniformLocation(prog, 'uAmt'), parseFloat(root.dataset.amount) || 0.055);

    let ready = 0;
    const tex = (url, unit, name) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        if (++ready === 2) { size(); render(); }
      };
      im.src = url;
    };
    tex(root.dataset.photo, 0, 'uImg');
    tex(root.dataset.depthmap, 1, 'uDep');

    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.max(1, r.width * dpr | 0); cv.height = Math.max(1, r.height * dpr | 0);
      gl.viewport(0, 0, cv.width, cv.height);
    };
    let ox = 0, oy = 0, tox = 0, toy = 0, run = false;
    const render = () => {
      run = false;
      ox += (tox - ox) * 0.09; oy += (toy - oy) * 0.09;
      gl.uniform2f(uOff, ox, oy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (Math.abs(tox - ox) + Math.abs(toy - oy) > 0.0004 && !run) { run = true; requestAnimationFrame(render); }
    };
    const nudge = () => { if (!run) { run = true; requestAnimationFrame(render); } };
    addEventListener('resize', () => { size(); nudge(); }, { passive: true });
    if (!reduced.matches) {
      if (fine.matches) addEventListener('pointermove', (e) => {
        tox = (e.clientX / innerWidth - 0.5) * 2; toy = -(e.clientY / innerHeight - 0.5) * 2; nudge();
      }, { passive: true });
      addEventListener('scroll', () => {
        const r = root.getBoundingClientRect();
        toy = -((r.top + r.height / 2 - innerHeight / 2) / innerHeight) * 1.4; nudge();
      }, { passive: true });
    }
  }
})();
