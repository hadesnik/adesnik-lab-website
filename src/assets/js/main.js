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
