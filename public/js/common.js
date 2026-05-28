// Shared helpers used by every page.
window.AH = (function () {
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  async function getMe() {
    try { return (await api("/api/me")).user; } catch { return null; }
  }

  function money(n) {
    if (n == null) return "—";
    return "₹" + Number(n).toLocaleString("en-IN");
  }

  function fmtRemaining(ms) {
    if (ms == null || ms <= 0) return "00:00";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (x) => String(x).padStart(2, "0");
    return (h > 0 ? pad(h) + ":" : "") + pad(m) + ":" + pad(sec);
  }

  async function renderTopbar(active) {
    const user = await getMe();
    const links = [
      ["/", "Catalog"],
      ["/clauses.html", "Terms & Conditions"],
      ["/faq.html", "FAQ"],
    ];
    if (user && user.role === "admin") links.push(["/admin.html", "Admin"]);

    const nav = links
      .map(([href, label]) => `<a href="${href}" class="${active === href ? "active" : ""}">${label}</a>`)
      .join("");

    let session;
    if (user) {
      session = `<span>${user.name} <span class="small">(${user.role})</span></span>
        <button id="logoutBtn">Log out</button>`;
    } else {
      session = `<a href="/login.html"><button class="primary">Log in</button></a>`;
    }

    const header = document.createElement("header");
    header.className = "topbar";
    header.innerHTML = `
      <a class="brand" href="/">
        <img src="/img/beardo-logo.jpg" alt="Beardo" class="brand-logo" />
        <span class="brand-title">Beardo Mega Auction</span>
      </a>
      <nav class="links">${nav}</nav>
      <div class="session">${session}</div>`;
    document.body.prepend(header);

    const lo = document.getElementById("logoutBtn");
    if (lo) lo.addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      location.href = "/login.html";
    });
    return user;
  }

  function statusBadge(status) {
    return `<span class="badge ${status}">${status}</span>`;
  }

  // ---------- Winner announcement: full-screen flash + bang ----------

  function htmlEscape(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // Most browsers block AudioContext until a user gesture. Prime on first interaction.
  let _audioCtx = null;
  function primeAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!_audioCtx) _audioCtx = new AC();
      if (_audioCtx.state === "suspended") _audioCtx.resume().catch(() => {});
    } catch (_) {}
  }
  window.addEventListener("pointerdown", primeAudio, { passive: true });
  window.addEventListener("keydown", primeAudio, { passive: true });

  function playBang() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!_audioCtx) _audioCtx = new AC();
      const ctx = _audioCtx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const now = ctx.currentTime;

      // BOOM: low-frequency sine swept down
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.7);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, now);
      og.gain.exponentialRampToValueAtTime(0.7, now + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
      osc.connect(og).connect(ctx.destination);
      osc.start(now); osc.stop(now + 1.0);

      // SNAP: short filtered noise burst
      const dur = 0.3;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const arr = buf.getChannelData(0);
      for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 2 - 1) * (1 - i / arr.length);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = "bandpass"; filt.frequency.value = 220; filt.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.55, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + dur);
      src.connect(filt).connect(ng).connect(ctx.destination);
      src.start(now);
    } catch (_) {}
  }

  function announceWinner(item) {
    if (!item || !item.currentBidder || !item.bidCount) return;
    const overlay = document.createElement("div");
    overlay.className = "ah-winner-overlay";
    overlay.innerHTML =
      '<div class="ah-flash"></div>' +
      '<div class="ah-winner-content">' +
        '<div class="ah-trophy">🏆</div>' +
        '<div class="ah-winner-title">WINNER!</div>' +
        '<div class="ah-winner-name">' + htmlEscape(item.currentBidder) + '</div>' +
        '<div class="ah-winner-lot">won &mdash; ' + htmlEscape(item.title) + '</div>' +
        '<div class="ah-winner-amount">' + money(item.currentBid) + '</div>' +
        '<div class="ah-winner-hint">click anywhere to dismiss</div>' +
      '</div>';
    document.body.appendChild(overlay);
    playBang();

    let removed = false;
    function dismiss() {
      if (removed) return; removed = true;
      overlay.classList.add("ah-fade");
      setTimeout(() => overlay.remove(), 500);
    }
    overlay.addEventListener("click", dismiss);
    setTimeout(dismiss, 6500);
  }

  return { api, getMe, money, fmtRemaining, renderTopbar, statusBadge, announceWinner };
})();
