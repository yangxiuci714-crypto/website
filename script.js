/* ===== Apple-style scroll-driven animations ===== */

// Easing: smooth deceleration like Apple uses
function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}

// Skip animations for returning visitors within the same session
const returningVisitor = sessionStorage.getItem('xy-visited') === '1';
sessionStorage.setItem('xy-visited', '1');

// All elements to animate — sections and their children
const animEls = [];

function registerElements() {
  // Sections animate as a whole
  document.querySelectorAll('.section-header, .about-text, .school-block').forEach((el, i) => {
    animEls.push({ el, delay: i * 0.04, type: 'rise' });
  });

  // CV rows stagger within their section
  document.querySelectorAll('.cv-row').forEach((el, i) => {
    animEls.push({ el, delay: i * 0.05, type: 'rise' });
  });

  // Highlight boxes
  document.querySelectorAll('.highlight-box').forEach((el, i) => {
    animEls.push({ el, delay: i * 0.06, type: 'rise-small' });
  });

  // Cards pop with scale
  document.querySelectorAll('.card').forEach((el, i) => {
    animEls.push({ el, delay: i * 0.07, type: 'pop' });
  });

  // Blog cards
  document.querySelectorAll('.blog-card').forEach((el, i) => {
    animEls.push({ el, delay: i * 0.06, type: 'pop' });
  });

  // Social cards slide in
  document.querySelectorAll('.social-card').forEach((el, i) => {
    animEls.push({ el, delay: i * 0.08, type: 'slide' });
  });

  // Set initial hidden state
  animEls.forEach(({ el }) => {
    el.style.willChange = 'opacity, transform';
  });
}

function tick() {
  const vh = window.innerHeight;

  animEls.forEach(({ el, delay, type }) => {
    const rect = el.getBoundingClientRect();

    // Progress: 0 = element just entering from bottom, 1 = element fully in view
    const triggerStart = vh * 0.96;
    const triggerEnd   = vh * 0.15;
    const rawProgress  = (triggerStart - rect.top) / (triggerStart - triggerEnd);
    const progress     = Math.min(1, Math.max(0, rawProgress - delay));
    const p            = easeOutQuart(progress);

    if (type === 'rise') {
      el.style.opacity   = p;
      el.style.transform = `translateY(${(1 - p) * 52}px) scale(${0.95 + 0.05 * p})`;
    } else if (type === 'rise-small') {
      el.style.opacity   = p;
      el.style.transform = `translateY(${(1 - p) * 24}px)`;
    } else if (type === 'pop') {
      el.style.opacity   = p;
      el.style.transform = `translateY(${(1 - p) * 60}px) scale(${0.92 + 0.08 * p})`;
    } else if (type === 'slide') {
      el.style.opacity   = p;
      el.style.transform = `translateX(${(1 - p) * -32}px)`;
    }
  });

  requestAnimationFrame(tick);
}

// Honor reduced-motion preference and skip animations for returning visitors
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

registerElements();

if (returningVisitor || prefersReducedMotion) {
  // Instantly reveal all elements — no scroll-driven animation
  animEls.forEach(({ el }) => {
    el.style.opacity = '1';
    el.style.transform = 'none';
    el.style.willChange = 'auto';
  });
} else {
  requestAnimationFrame(tick);
}

/* ===== Floating navbar active state ===== */
const sections  = document.querySelectorAll('section[id]');
const navLinks  = document.querySelectorAll('.navbar a');

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinks.forEach(l => {
        l.classList.toggle('active', l.getAttribute('href') === `#${entry.target.id}`);
      });
    }
  });
}, { threshold: 0.3 });

sections.forEach(s => sectionObserver.observe(s));

/* ===== Back to top button ===== */
const backToTop = document.querySelector('.back-to-top');
if (backToTop) {
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
}

/* ===== Show more / collapse toggle ===== */
document.querySelectorAll('.show-more-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target);
    const isExpanded = target.classList.contains('expanded');
    const preview = target.previousElementSibling;
    const hasPreview = preview && preview.classList.contains('collapse-preview');

    if (isExpanded) {
      target.style.maxHeight = target.scrollHeight + 'px';
      requestAnimationFrame(() => {
        target.style.maxHeight = '0';
      });
      target.classList.remove('expanded');
      if (hasPreview) preview.style.display = '';
      btn.textContent = btn.textContent.includes('Read') ? 'Read more ↓' : 'Show more ↓';
    } else {
      target.classList.add('expanded');
      target.style.maxHeight = target.scrollHeight + 'px';
      if (hasPreview) preview.style.display = 'none';
      target.addEventListener('transitionend', function handler() {
        if (target.classList.contains('expanded')) {
          target.style.maxHeight = 'none';
        }
        target.removeEventListener('transitionend', handler);
      });
      btn.textContent = btn.textContent.includes('Read') ? 'Show less ↑' : 'Show less ↑';
    }
  });
});

/* ===== Mobile hamburger menu ===== */
const hamburger = document.querySelector('.nav-hamburger');
const navLinksWrap = document.querySelector('.nav-links');
if (hamburger && navLinksWrap) {
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    navLinksWrap.classList.toggle('open');
  });
  navLinksWrap.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      navLinksWrap.classList.remove('open');
    });
  });
}

/* ===== Theme toggle ===== */
const toggle = document.querySelector('.theme-toggle');
const root   = document.documentElement;

// Load saved preference or default to dark
const saved = localStorage.getItem('theme') || 'dark';
root.setAttribute('data-theme', saved);

toggle.addEventListener('click', () => {
  const current = root.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
});

/* ===== Auto-updating status badge ===== */
const statusText = document.getElementById('status-text');
if (statusText) {
  const now = new Date();
  // A Level exams typically finish by late June in UK system
  const aLevelsEndDate = new Date('2026-07-01');
  // A Level results released mid-August
  const resultsDate    = new Date('2026-08-15');
  // University starts late September / early October
  const universityDate = new Date('2026-09-20');

  if (now >= universityDate) {
    statusText.textContent = 'Starting university';
  } else if (now >= resultsDate) {
    statusText.textContent = 'A Levels completed';
  } else if (now >= aLevelsEndDate) {
    statusText.textContent = 'Awaiting A Level results';
  } else {
    statusText.textContent = 'Currently studying A Levels';
  }
}
