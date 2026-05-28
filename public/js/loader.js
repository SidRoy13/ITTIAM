// Matrix-style digital-rain loader overlay shown on every page during load.
// Auto-hides on window.load (with a small minimum-display delay) or on click.
// Exposes window.AHLoader.hide() so pages can dismiss it explicitly when their data is ready.
(function () {
  if (window.AHLoader) return;

  const overlay = document.createElement("div");
  overlay.id = "ah-loader";
  overlay.innerHTML =
    '<canvas id="ah-loader-canvas"></canvas>' +
    '<div class="ah-loader-content">' +
      '<div class="ah-loader-brand">BEARDO MEGA AUCTION</div>' +
      '<div class="ah-loader-spinner" aria-hidden="true"></div>' +
      '<div class="ah-loader-msg" id="ah-loader-msg">Initialising&hellip;</div>' +
      '<div class="ah-loader-hint">click anywhere to skip</div>' +
    '</div>';
  // append as soon as body exists
  if (document.body) document.body.appendChild(overlay);
  else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(overlay));

  // ---- canvas / matrix rain ----
  const canvas = overlay.querySelector("#ah-loader-canvas");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function sizeCanvas() {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  sizeCanvas();

  const GLYPHS =
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲ" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=<>{}[]/\\|".split("").join("");
  const charset = GLYPHS.split("");
  const FONT_SIZE = 16;

  let cols = Math.ceil(window.innerWidth / FONT_SIZE);
  let drops = new Array(cols).fill(0).map(() => Math.random() * -50);

  window.addEventListener("resize", () => {
    sizeCanvas();
    cols = Math.ceil(window.innerWidth / FONT_SIZE);
    drops = new Array(cols).fill(0).map(() => Math.random() * -50);
  });

  let rafId;
  function draw() {
    // dim the previous frame for the trailing effect
    ctx.fillStyle = "rgba(0, 0, 0, 0.085)";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.font = "bold " + FONT_SIZE + "px Consolas, ui-monospace, monospace";

    for (let i = 0; i < drops.length; i++) {
      const ch = charset[(Math.random() * charset.length) | 0];
      const x = i * FONT_SIZE;
      const y = drops[i] * FONT_SIZE;
      // trail in Beardo red, head in white
      ctx.fillStyle = "rgba(230, 0, 35, 0.85)";
      ctx.fillText(ch, x, y);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(ch, x, y - FONT_SIZE);

      if (y > window.innerHeight && Math.random() > 0.975) drops[i] = 0;
      drops[i] += 1;
    }
    rafId = requestAnimationFrame(draw);
  }
  draw();

  // ---- rotating subtitle ----
  const messages = [
    "Booting auction floor…",
    "Syncing live bid feed…",
    "Calibrating timers…",
    "Loading product catalog…",
    "Securing your session…",
    "Ready when you are.",
  ];
  const msgEl = overlay.querySelector("#ah-loader-msg");
  let mi = 0;
  msgEl.textContent = messages[0];
  const msgInterval = setInterval(() => {
    mi = (mi + 1) % messages.length;
    msgEl.textContent = messages[mi];
  }, 850);

  // ---- hide logic ----
  const t0 = Date.now();
  let hidden = false;
  function hide() {
    if (hidden) return;
    hidden = true;
    const minMs = 1300;
    const wait = Math.max(0, minMs - (Date.now() - t0));
    setTimeout(() => {
      overlay.classList.add("ah-loader-hide");
      setTimeout(() => {
        try { cancelAnimationFrame(rafId); } catch (_) {}
        clearInterval(msgInterval);
        overlay.remove();
      }, 550);
    }, wait);
  }

  overlay.addEventListener("click", hide);
  if (document.readyState === "complete") setTimeout(hide, 1100);
  else window.addEventListener("load", hide);
  // safety: never linger more than 6s
  setTimeout(hide, 6000);

  window.AHLoader = { hide };
})();
