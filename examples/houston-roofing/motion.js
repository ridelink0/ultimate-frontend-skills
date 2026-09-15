/* ultimate-frontend-skills/motion.js - dependency-free scroll motion. Load with <script defer>.
   Everything here degrades to a fully visible, static page. */
(() => {
  'use strict';

  const doc = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const hasSDT = CSS.supports('animation-timeline', 'view()');
  const hasIO = 'IntersectionObserver' in window;

  if (hasSDT) doc.classList.add('has-sdt');
  doc.dataset.motion = reduced.matches ? 'reduce' : 'full';
  reduced.addEventListener('change', () => {
    doc.dataset.motion = reduced.matches ? 'reduce' : 'full';
  });

  const off = () => reduced.matches;

  /* ---- reveal on enter. Only claim the class when we can actually deliver:
     CSS handles it where scroll timelines exist, and hiding content behind an
     observer that does not exist would leave the page blank. --------------- */
  if (!hasSDT && hasIO && !off()) {
    doc.classList.add('js-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      },
      // fires when the element is ~15% up from the bottom edge, where the eye is
      { rootMargin: '0px 0px -15% 0px', threshold: 0 },
    );
    document.querySelectorAll('.r').forEach((el) => io.observe(el));
  }

  /* ---- publish the header height so anchors clear it ---------------------- */
  const header = document.querySelector('.nav');
  if (header) {
    const setNavH = () =>
      doc.style.setProperty('--nav-h', header.getBoundingClientRect().height + 'px');
    setNavH();
    if ('ResizeObserver' in window) new ResizeObserver(setNavH).observe(header);
    else addEventListener('resize', setNavH, { passive: true });
  }

  /* ------------------------------------------------- scroll-driven engine - */
  // One rAF loop for every scroll-position effect. No per-element listeners.
  const jobs = [];
  let ticking = false;
  const run = () => {
    ticking = false;
    const y = window.scrollY;
    const vh = window.innerHeight;
    for (const job of jobs) job(y, vh);
  };
  const request = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(run);
  };
  const onScroll = () => request();

  /* ---- parallax: [data-px="24"] moves 24px per viewport of scroll --------- */
  // Skipped entirely when CSS handles it, and when motion is reduced.
  const pxEls = [...document.querySelectorAll('[data-px]')];
  if (pxEls.length && !off()) {
    const items = pxEls.map((el) => ({ el, amt: parseFloat(el.dataset.px) || 20, mid: 0, h: 0 }));
    const measure = () => {
      for (const it of items) {
        const r = it.el.getBoundingClientRect();
        it.mid = r.top + window.scrollY + r.height / 2;
        it.el.style.willChange = 'transform';
      }
    };
    measure();
    addEventListener('resize', measure, { passive: true });
    jobs.push((y, vh) => {
      for (const it of items) {
        // -1 .. 1 as the element crosses the viewport
        const p = (y + vh / 2 - it.mid) / (vh || 1);
        it.el.style.transform = `translate3d(0, ${(p * it.amt).toFixed(2)}px, 0)`;
      }
    });
  }

  /* ---- nav: add .is-stuck once past the fold edge ------------------------ */
  const nav = document.querySelector('.nav');
  if (nav) {
    const trigger = () => Math.min(window.innerHeight * 0.7, 560);
    jobs.push((y) => nav.classList.toggle('is-stuck', y > trigger()));
  }

  /* ---- scroll progress fallback ----------------------------------------- */
  const bar = document.querySelector('.progress');
  if (bar && !CSS.supports('animation-timeline', 'scroll()')) {
    jobs.push((y) => {
      const max = doc.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    });
  }

  if (jobs.length) {
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    run();
  }

  /* ---- counters: <span data-count="1566"> ------------------------------- */
  const counters = [...document.querySelectorAll('[data-count]')];
  if (counters.length) {
    const format = (n, dp) => n.toLocaleString(undefined, {
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    });
    const play = (el) => {
      const target = parseFloat(el.dataset.count);
      if (!isFinite(target)) return;
      const dp = (el.dataset.count.split('.')[1] || '').length;
      const suffix = el.dataset.countSuffix || '';
      if (off()) { el.textContent = format(target, dp) + suffix; return; }
      const dur = parseInt(el.dataset.countMs, 10) || 1100;
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        el.textContent = format(target * eased, dp) + suffix;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        for (const e of es) if (e.isIntersecting) { play(e.target); io.unobserve(e.target); }
      }, { threshold: 0.5 });
      counters.forEach((el) => io.observe(el));
    } else counters.forEach(play);
  }

  /* ---- magnetic hover: [data-magnetic] ---------------------------------- */
  if (!off() && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    for (const el of document.querySelectorAll('[data-magnetic]')) {
      const strength = parseFloat(el.dataset.magnetic) || 0.22;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * strength;
        const dy = (e.clientY - (r.top + r.height / 2)) * strength;
        el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    }
  }

  /* ---- pointer parallax: [data-tilt] on a hero layer --------------------- */
  const tilt = [...document.querySelectorAll('[data-tilt]')];
  if (tilt.length && !off() && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', (e) => {
      const nx = e.clientX / innerWidth - 0.5;
      const ny = e.clientY / innerHeight - 0.5;
      for (const el of tilt) {
        const k = parseFloat(el.dataset.tilt) || 12;
        el.style.setProperty('--tx', `${(nx * k).toFixed(2)}px`);
        el.style.setProperty('--ty', `${(ny * k).toFixed(2)}px`);
      }
    }, { passive: true });
  }

  /* ---- split a headline into per-word spans for staggered reveal --------- */
  for (const el of document.querySelectorAll('[data-split]')) {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach((w, i) => {
      const outer = document.createElement('span');
      outer.className = 'w';
      outer.style.cssText = 'display:inline-block;overflow:hidden;vertical-align:top';
      const inner = document.createElement('span');
      inner.textContent = w;
      inner.style.cssText =
        'display:inline-block;will-change:transform' +
        (off() ? '' : `;transform:translateY(105%);transition:transform 900ms cubic-bezier(.22,1,.36,1) ${i * 55}ms`);
      outer.append(inner);
      el.append(outer, document.createTextNode(' '));
    });
    if (!off()) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          el.querySelectorAll('.w > span').forEach((s) => { s.style.transform = 'translateY(0)'; })));
    }
  }
})();

/* The phone navigation, enhanced.
   The markup is a <details>, so it already opens, closes, takes keyboard focus
   and announces its state with no JavaScript at all. Everything here is the
   part a disclosure does not get for free and a visitor still expects:
   Escape closes it, tapping a link closes it, tapping outside closes it, and
   the page behind it does not scroll while it is open. If this file never
   loads, the menu still works - which is the whole reason it is a <details>
   and not a hand-built dialog. */
(() => {
  const menu = document.querySelector('.nav__menu');
  if (!menu) return;
  const summary = menu.querySelector('summary');
  let scrollY = 0;

  const close = ({ refocus = false } = {}) => {
    if (!menu.open) return;
    menu.open = false;
    if (refocus && summary) summary.focus();
  };

  // Locking the body is the part everyone gets wrong. Fixing the body at a
  // negative offset keeps the scroll position instead of jumping to the top,
  // which is what `overflow:hidden` alone does on iOS.
  const lock = () => {
    scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
  };
  const unlock = () => {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, scrollY);
  };

  menu.addEventListener('toggle', () => (menu.open ? lock() : unlock()));

  // Escape, from anywhere - including from inside the panel.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) { e.preventDefault(); close({ refocus: true }); }
  });

  // A link inside the panel is a same-page anchor: the panel has to get out of
  // the way or the visitor lands behind it.
  menu.addEventListener('click', (e) => {
    if (e.target.closest('.nav__panel a')) close();
  });

  // Anywhere outside it. Pointerdown rather than click, so the menu is gone
  // before the tap lands on whatever is underneath.
  document.addEventListener('pointerdown', (e) => {
    if (menu.open && !menu.contains(e.target)) close();
  });

  // Rotating to landscape, or resizing past the breakpoint, leaves an open
  // panel over a nav that is no longer hiding its links.
  matchMedia('(min-width: 46.0625rem)').addEventListener('change', (e) => {
    if (e.matches) close();
  });
})();
