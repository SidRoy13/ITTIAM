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

  return { api, getMe, money, fmtRemaining, renderTopbar, statusBadge };
})();
