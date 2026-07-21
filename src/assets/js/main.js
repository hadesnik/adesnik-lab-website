// Mobile navigation toggle.
(function () {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.getElementById("primary-nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", function () {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  // Close the menu when a link is followed (single-page nav feel on mobile).
  nav.addEventListener("click", function (e) {
    if (e.target.closest("a") && nav.classList.contains("is-open")) {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
})();

// Publications filter (progressive enhancement).
(function () {
  const input = document.querySelector("[data-pub-filter]");
  if (!input) return;
  const items = Array.from(document.querySelectorAll(".pub[data-search]"));
  const sections = Array.from(document.querySelectorAll("[data-pub-section]"));
  const countEl = document.querySelector("[data-pub-count]");
  const emptyEl = document.querySelector("[data-pub-empty]");
  const total = items.length;

  function update() {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    items.forEach(function (li) {
      const match = !q || li.dataset.search.indexOf(q) !== -1;
      li.hidden = !match;
      if (match) shown++;
    });
    // Hide a section whose items are all filtered out.
    sections.forEach(function (sec) {
      const any = sec.querySelector(".pub:not([hidden])");
      sec.hidden = !any;
    });
    if (emptyEl) emptyEl.hidden = shown !== 0;
    if (countEl) {
      countEl.textContent = q
        ? shown + " of " + total + " publications"
        : total + " publications";
    }
  }

  input.addEventListener("input", update);
  update();
})();

// Play looping movies only while they are on screen (saves bandwidth/CPU).
(function () {
  const vids = document.querySelectorAll("video[data-autoplay]");
  if (!vids.length) return;
  if (!("IntersectionObserver" in window)) {
    vids.forEach((v) => v.play && v.play().catch(() => {}));
    return;
  }
  const io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.play().catch(() => {});
        } else {
          e.target.pause();
        }
      });
    },
    { threshold: 0.35 }
  );
  vids.forEach((v) => io.observe(v));
})();

// Parallax hero backgrounds (progressive enhancement). Elements tagged
// [data-parallax] are translated at a fraction of scroll speed so the page
// content scrolls over a slower-moving background. Disabled on small
// screens and under prefers-reduced-motion (JS transforms are not covered
// by the CSS reduced-motion block, so we gate here explicitly).
(function () {
  const els = document.querySelectorAll("[data-parallax]");
  if (!els.length) return;
  const motionOK = window.matchMedia("(prefers-reduced-motion: no-preference)");
  const wide = window.matchMedia("(min-width: 761px)");
  let active = false;
  let ticking = false;

  function update() {
    ticking = false;
    els.forEach(function (el) {
      const rect = el.parentElement.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const speed = parseFloat(el.dataset.parallaxSpeed || "0.25");
      el.style.transform =
        "translate3d(0," + (-rect.top * speed).toFixed(1) + "px,0)";
    });
  }
  function onScroll() {
    if (active && !ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }
  function evaluate() {
    active = motionOK.matches && wide.matches;
    if (!active) {
      els.forEach(function (el) {
        el.style.transform = "";
      });
    } else {
      update();
    }
  }

  motionOK.addEventListener("change", evaluate);
  wide.addEventListener("change", evaluate);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  evaluate();
})();

// Reveal-on-scroll (progressive enhancement). Elements tagged [data-reveal]
// start hidden via CSS (only when html.js + motion allowed) and fade/slide
// in as they enter the viewport, with a small stagger so grids cascade.
(function () {
  const els = document.querySelectorAll("[data-reveal]");
  if (!els.length) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    els.forEach(function (el) {
      el.classList.add("is-visible");
    });
    return;
  }
  const io = new IntersectionObserver(
    function (entries) {
      let i = 0;
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.style.transitionDelay = Math.min(i++ * 70, 420) + "ms";
        e.target.classList.add("is-visible");
        io.unobserve(e.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  els.forEach(function (el) {
    io.observe(el);
  });
})();

// Open external links in a new tab so the lab site stays open. Internal
// navigation keeps the same tab; mailto/tel links are left untouched.
(function () {
  document.querySelectorAll("a[href]").forEach(function (a) {
    const external =
      /^https?:$/.test(a.protocol) && a.origin !== window.location.origin;
    if (external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  });
})();

// Compact the sticky header once the page is scrolled.
(function () {
  const header = document.querySelector("[data-header]");
  if (!header) return;
  let ticking = false;
  function update() {
    ticking = false;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  update();
})();
