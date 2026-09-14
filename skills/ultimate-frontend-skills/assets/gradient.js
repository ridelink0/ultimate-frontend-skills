/* ultimate-frontend-skills/gradient.js - animated WebGL mesh gradient.

   The expensive-looking gradient is not a CSS radial stack. It is a surface
   whose colour field is driven by layered simplex noise, moving slowly enough
   that you notice it only if you stare. This is the Stripe-hero technique,
   written against raw WebGL2 so it costs nothing to load.

   Usage:
     <canvas class="gradient" data-gradient="#0b1226,#2c3a56,#a5735a,#e8ac66"
             data-speed="0.10" data-scale="1.5" data-grain="0.06"></canvas>

   Degrades, in order: WebGL2 -> WebGL1 -> a CSS mesh painted onto the canvas
   background. Under prefers-reduced-motion it renders exactly one frame, so
   you get the picture without the movement. */
(() => {
  'use strict';

  const SRC_V = `#version 300 es
  in vec2 p; out vec2 uv;
  void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

  // Ashima simplex noise, the standard implementation, plus a 4-colour field.
  const SRC_F = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 outColor;
  uniform float uT, uSpeed, uScale, uGrain, uAspect;
  uniform vec3 uC[5];
  uniform int uN;

  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  // three octaves: the large shape, the fold, the fine break-up
  float fbm(vec2 p){
    return 0.60 * snoise(p)
         + 0.28 * snoise(p * 2.13 + 17.0)
         + 0.12 * snoise(p * 4.41 + 43.0);
  }
  // sRGB-space mixing goes muddy through the middle; work in linear.
  vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
  vec3 toSrgb(vec3 c){ return pow(c, vec3(1.0/2.2)); }

  void main(){
    vec2 q = vec2(uv.x * uAspect, uv.y) * uScale;
    float t = uT * uSpeed;

    // domain warp: noise sampling noise. This is what stops it reading as a
    // blurred blob and makes it read as a fluid.
    vec2 w = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, -t * 0.8)));
    float n = fbm(q + w * 0.85 + vec2(t * 0.35, 0.0));
    n = n * 0.5 + 0.5;                       // -> 0..1
    n = clamp(n, 0.0, 1.0);

    // walk the ramp: n picks a segment, smoothstep crossfades within it
    float seg = float(uN - 1);
    float f = n * seg;
    int i = int(floor(f));
    float k = smoothstep(0.0, 1.0, fract(f));
    vec3 a = toLin(uC[min(i, uN - 1)]);
    vec3 b = toLin(uC[min(i + 1, uN - 1)]);
    vec3 col = toSrgb(mix(a, b, k));

    // a second, slower field lifts one corner, so it is never symmetric
    float lift = fbm(q * 0.5 - vec2(t * 0.2, t * 0.12)) * 0.5 + 0.5;
    col *= 0.88 + 0.24 * lift;

    // dither: an 8-bit ramp this wide WILL band without it
    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * uGrain;

    outColor = vec4(col, 1.0);
  }`;

  const hex = (h) => {
    h = h.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  };

  function cssFallback(cv, cols) {
    // Not a failure state - a deliberate static mesh in the same palette.
    const [a, b, c, d] = [cols[0], cols[1] || cols[0], cols[2] || cols[1] || cols[0], cols[3] || cols[0]];
    cv.style.background =
      `radial-gradient(120% 60% at 18% 12% in oklab, ${b}, transparent 62%),` +
      `radial-gradient(100% 55% at 86% 22% in oklab, ${c}, transparent 60%),` +
      `radial-gradient(130% 70% at 50% 108% in oklab, ${d}, transparent 66%),` +
      `linear-gradient(168deg in oklab, ${a}, ${c})`;
  }

  function start(cv) {
    const cols = (cv.dataset.gradient || '#0b1226,#2c3a56,#a5735a,#e8ac66')
      .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
    const speed = parseFloat(cv.dataset.speed) || 0.10;
    const scale = parseFloat(cv.dataset.scale) || 1.5;
    const grain = parseFloat(cv.dataset.grain);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    let two = true;
    if (!gl) { gl = cv.getContext('webgl', { antialias: false, alpha: false }); two = false; }
    if (!gl) { cssFallback(cv, cols); return; }

    const v = two ? SRC_V : SRC_V.replace('#version 300 es', '').replace(/\bin\b/, 'attribute').replace(/\bout\b/, 'varying');
    const f = two ? SRC_F : SRC_F.replace('#version 300 es', '')
      .replace('in vec2 uv; out vec4 outColor;', 'varying vec2 uv;')
      .replace('outColor =', 'gl_FragColor =');

    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src.trim()); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, v), fs = sh(gl.FRAGMENT_SHADER, f);
    if (!vs || !fs) { cssFallback(cv, cols); return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cssFallback(cv, cols); return; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = (n) => gl.getUniformLocation(prog, n);
    const uT = U('uT'), uAspect = U('uAspect');
    gl.uniform1f(U('uSpeed'), speed);
    gl.uniform1f(U('uScale'), scale);
    gl.uniform1f(U('uGrain'), isNaN(grain) ? 0.055 : grain);
    gl.uniform1i(U('uN'), cols.length);
    cols.forEach((c, i) => gl.uniform3fv(U(`uC[${i}]`), hex(c)));

    const draw = (t) => { gl.uniform1f(uT, t); gl.drawArrays(gl.TRIANGLES, 0, 3); };

    const resize = () => {
      const r = cv.getBoundingClientRect();
      // a gradient has no detail to lose: half-res on HiDPI is free performance
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
      gl.uniform1f(uAspect, r.height ? r.width / r.height : 1);
      // Setting the canvas size clears it. With no loop running under reduced
      // motion, nothing painted it again: the still frame went blank on the
      // first resize, rotation or DevTools toggle after load.
      if (reduced) draw(12.0);
    };
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(cv);
    else addEventListener('resize', resize, { passive: true });

    if (reduced) return;                           // one frame: the picture, not the motion

    let raf = 0, t0 = 0, running = false, visible = false;
    const loop = (ts) => {
      if (!t0) t0 = ts;
      draw((ts - t0) / 1000);
      if (running) raf = requestAnimationFrame(loop);
    };
    // only run while it is on screen - an offscreen shader is pure waste
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !running) { running = true; raf = requestAnimationFrame(loop); }
      else if (!visible && running) { running = false; cancelAnimationFrame(raf); }
    }, { threshold: 0 });
    io.observe(cv);
    // Coming back to the tab restarts the loop only if the canvas is on
    // screen; otherwise a tab switch quietly undid the off-screen pause.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && running) { running = false; cancelAnimationFrame(raf); }
      else if (!document.hidden && !running && visible) { running = true; raf = requestAnimationFrame(loop); }
    });
  }

  const boot = () => document.querySelectorAll('canvas[data-gradient]').forEach(start);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
