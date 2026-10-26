// Apply Desk front end. Home (/), apply (/a/slug), admin (/m/slug#key=...), reviewer (/r/slug#key=...).
const $ = (id) => document.getElementById(id);
const path = location.pathname.split("/").filter(Boolean);
const view = { a: "apply", m: "admin", r: "review" }[path[0]] || "home";
const slug = (path[1] || "").toLowerCase();
const key = new URLSearchParams(location.hash.slice(1)).get("key") || "";
let data = null;
let current = null;
const openRows = new Set();

function el(tag, { dataset, ...props } = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...kids.filter((k) => k != null && k !== false));
  return node;
}
function status(message, kind = "") {
  $("status").hidden = !message;
  $("status").textContent = message || "";
  $("status").className = `notice ${kind}`;
}
async function api(url, { method = "GET", body } = {}) {
  const headers = { "content-type": "application/json" };
  if (key && view !== "apply") headers["x-manage-key"] = key;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({ ok: false, message: "The server did not answer properly." }));
  if (!res.ok || out.ok === false) throw new Error(out.message || `Request failed (${res.status})`);
  return out;
}

// Home: create a programme
function initHome() {
  $("home").hidden = false;
  $("create").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const questions = String(f.get("questions")).split("\n").map((l) => l.trim()).filter(Boolean).map((label) => ({ label, long: true }));
    const criteria = String(f.get("criteria")).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?)[,\s]+([1-5])\s*$/);
      return m ? { name: m[1].trim(), weight: Number(m[2]) } : { name: l, weight: 1 };
    });
    try {
      const out = await api("/api/programmes", { method: "POST", body: { name: f.get("name"), about: f.get("about"), perApp: Number(f.get("perApp")), questions, criteria } });
      location.assign(`/m/${out.slug}#key=${out.key}`);
    } catch (err) {
      status(err.message, "notice-alert");
    }
  });
}

// Apply
async function initApply() {
  try {
    const { programme: p } = await api(`/api/programmes?slug=${encodeURIComponent(slug)}`);
    $("title").textContent = p.name;
    document.title = `Apply: ${p.name}`;
    $("lead").textContent = p.demo ? "This is the demo programme. Applications here are deleted when the demo resets each day." : "Applications are read by the programme's reviewers.";
    if (!p.open) { status("Applications are closed.", "notice-alert"); return; }
    $("a-about").textContent = p.about;
    $("a-about").hidden = !p.about;
    $("a-questions").replaceChildren(...p.questions.map((q, i) => el("div", { className: "field" },
      el("label", { htmlFor: `q-${i}`, textContent: q.label }),
      q.long ? el("textarea", { id: `q-${i}`, name: `q${i}`, rows: 4, maxLength: 2000, required: true }) : el("input", { id: `q-${i}`, name: `q${i}`, type: "text", maxLength: 200, required: true }))));
    $("apply").hidden = false;
    $("apply").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = e.target.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        const out = await api("/api/apply", { method: "POST", body: { slug, name: f.get("name"), email: f.get("email"), phone: f.get("phone"), org: f.get("org"), answers: p.questions.map((_, i) => f.get(`q${i}`)) } });
        $("apply").hidden = true;
        $("applied").hidden = false;
        $("applied-text").textContent = `Your application number is ${out.ref}. Keep it for any questions to the programme team.`;
        status("");
      } catch (err) {
        status(err.message, "notice-alert");
        btn.disabled = false;
      }
    });
  } catch (e) {
    status(e.message, "notice-alert");
  }
}

// Admin
async function loadAdmin() {
  try {
    data = await api(`/api/admin?slug=${encodeURIComponent(slug)}`);
    renderAdmin();
  } catch (e) {
    status(e.message, "notice-alert");
  }
}

async function adminAction(body, after) {
  try {
    const out = await api("/api/admin", { method: "POST", body: { slug, ...body } });
    if (after) after(out);
    await loadAdmin();
  } catch (e) {
    status(e.message, "notice-alert");
  }
}

function renderAdmin() {
  const p = data.programme;
  $("title").textContent = p.name;
  document.title = `Admin: ${p.name}`;
  $("lead").textContent = p.demo ? "The demo's admin page. Anyone can use it here; your own programme's admin link is private. It resets every day." : `Programme team view. Each application gets ${p.perApp} ${p.perApp === 1 ? "reviewer" : "reviewers"}.`;
  const apps = data.ranked;
  const done = data.reviewers.reduce((s, r) => s + r.done, 0);
  const needed = apps.length * p.perApp;
  $("t-apps").textContent = String(apps.length);
  $("t-apps-sub").textContent = p.open ? "form is open" : "form is closed";
  $("t-done").textContent = needed ? `${Math.round((done / needed) * 100)}%` : "0%";
  $("t-done-sub").textContent = `${done} of ${needed}`;
  $("t-open").textContent = String(data.openSlots);
  $("t-open-sub").textContent = data.openSlots ? "press Assign reviewers" : "everyone has reviewers";
  $("t-ready").textContent = String(apps.filter((a) => a.reviews >= p.perApp).length);

  $("revs").replaceChildren(...(data.reviewers.length ? data.reviewers.map((r) => {
    const bar = el("span");
    bar.style.width = `${r.assigned ? Math.round((r.done / r.assigned) * 100) : 0}%`;
    return el("li", {},
      el("span", {}, el("strong", { textContent: r.name }), el("span", { className: "sub", textContent: `${r.done} of ${r.assigned} done${r.conflicts ? `, ${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"} declared` : ""}` })),
      el("button", { className: "btn", type: "button", textContent: "Remove", onclick: () => { if (window.confirm(`Remove ${r.name}? Their ${r.done} finished reviews are deleted too.`)) adminAction({ action: "removeReviewer", id: r.id }); } }),
      el("span", { className: "meter", role: "img", ariaLabel: `${r.done} of ${r.assigned} done` }, bar));
  }) : [el("li", { className: "sub", textContent: "No reviewers yet. Add them below." })]));
  $("assign").disabled = !data.openSlots || !data.reviewers.length;

  $("apply-link").value = `${location.origin}/a/${p.slug}`;
  $("admin-link").value = location.href;
  const pa = $("prog-actions");
  pa.replaceChildren(...[
    el("button", { className: "btn", type: "button", textContent: p.open ? "Close applications" : "Reopen applications", onclick: () => adminAction({ action: p.open ? "close" : "open" }) }),
    p.demo ? null : el("button", { className: "btn", type: "button", textContent: "Delete programme and all data", onclick: () => { if (window.confirm("Delete this programme, every application and every review? This cannot be undone.")) adminAction({ action: "delete" }, () => location.assign("/")); } }),
  ].filter(Boolean));

  const topn = Math.max(1, Number($("topn").value) || 5);
  const rows = [];
  for (const a of apps) {
    const short = a.rank != null && a.rank <= topn;
    const toggle = el("button", { className: "open", type: "button", ariaExpanded: String(openRows.has(a.id)) }, el("strong", { textContent: `${a.ref} ${a.org || a.name}` }), el("span", { className: "sub", textContent: a.org ? a.name : a.email }));
    toggle.addEventListener("click", () => { if (openRows.has(a.id)) openRows.delete(a.id); else openRows.add(a.id); renderAdmin(); });
    rows.push(el("tr", { className: short ? "short" : "" },
      el("td", { className: "num", textContent: a.rank ?? "" }),
      el("td", {}, toggle),
      el("td", { className: "num" }, el("strong", { textContent: a.score ?? "" })),
      el("td", { className: "num raw", textContent: a.raw ?? "" }),
      el("td", { className: "revs-cell", textContent: `${a.reviews} of ${p.perApp}` }),
      el("td", { className: "flags" }, el("span", { className: "badges" }, short ? el("span", { className: "badge badge-accent", textContent: "Shortlist" }) : null, ...a.flags.map((f) => el("span", { className: f === "unadjusted reviewer" ? "badge" : "badge badge-warn", textContent: f }))))));
    if (openRows.has(a.id)) {
      rows.push(el("tr", { className: "detail" }, el("td", { colSpan: 6 },
        el("dl", {}, ...p.questions.flatMap((q, i) => [el("dt", { textContent: q.label }), el("dd", { textContent: a.answers[i] || "" })]),
          el("dt", { textContent: "Contact" }), el("dd", { textContent: [a.email, a.phone].filter(Boolean).join(", ") })),
        a.detail.length ? el("table", {}, el("thead", {}, el("tr", {}, el("th", { textContent: "Reviewer" }), ...p.criteria.map((c) => el("th", { className: "num", textContent: `${c.name} (x${c.weight})` })), el("th", { className: "num", textContent: "Total" }), el("th", { className: "num", textContent: "Evened" }), el("th", { textContent: "Note" }))),
          el("tbody", {}, ...a.detail.map((d) => el("tr", {}, el("td", { textContent: d.reviewer }), ...d.scores.map((s) => el("td", { className: "num", textContent: s })), el("td", { className: "num", textContent: d.total }), el("td", { className: "num", textContent: d.adjusted }), el("td", { textContent: d.note }))))) : el("p", { className: "sub", textContent: "No reviews yet." }))));
    }
  }
  $("rank").replaceChildren(...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: 6, className: "sub", textContent: "No applications yet. Share the form link." }))]));
}

function csv() {
  const p = data.programme;
  const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const head = ["rank", "ref", "name", "email", "phone", "organisation", "score", "raw", "reviews", "flags", ...p.questions.map((q) => q.label)];
  const rows = data.ranked.map((a) => [a.rank, a.ref, a.name, a.email, a.phone, a.org, a.score, a.raw, a.reviews, a.flags.join("; "), ...a.answers]);
  const blob = new Blob(["﻿", [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
  el("a", { href: URL.createObjectURL(blob), download: `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-ranking.csv` }).click();
}

function initAdmin() {
  $("admin").hidden = false;
  $("assign").addEventListener("click", () => adminAction({ action: "assign" }, (out) => status(out.added ? `${out.added} reviewing slots assigned.` : "Nothing to assign. Add reviewers or wait for applications.")));
  $("add-rev").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("rev-name").value.trim();
    adminAction({ action: "addReviewer", name }, (out) => {
      $("rev-name").value = "";
      $("new-link").hidden = false;
      $("new-link-name").textContent = name;
      $("new-link-url").value = `${location.origin}/r/${slug}#key=${out.key}`;
    });
  });
  $("topn").addEventListener("input", renderAdmin);
  $("csv").addEventListener("click", () => data && csv());
  loadAdmin();
}

// Reviewer
async function loadReview(keepId) {
  try {
    data = await api(`/api/review?slug=${encodeURIComponent(slug)}`);
    renderReview(keepId);
  } catch (e) {
    status(e.message, "notice-alert");
  }
}

function renderReview(keepId) {
  const p = data.programme;
  $("title").textContent = p.name;
  document.title = `Review: ${p.name}`;
  $("lead").textContent = `Reviewing as ${data.reviewer.name}. You see answers only: names, emails and organisations are hidden so every application gets the same read.${p.demo ? " Demo: it resets every day." : ""}`;
  const done = data.queue.filter((q) => q.scores).length;
  $("r-progress").textContent = data.queue.length ? `${done} of ${data.queue.length} reviewed` : "Nothing in your queue yet. The programme team assigns applications to you.";
  if ($("r-show").value === "todo" && data.queue.length && data.queue.every((q) => q.scores) && keepId === undefined) $("r-show").value = "all";
  const list = $("r-show").value === "all" ? data.queue : data.queue.filter((q) => !q.scores);
  current = data.queue.find((q) => q.id === keepId) || list[0] || null;
  $("queue").replaceChildren(...list.map((q) => el("li", {}, el("button", { type: "button", ariaCurrent: String(current?.id === q.id), onclick: () => { current = q; renderReview(q.id); } }, el("span", { textContent: q.ref }), el("span", { className: "sub", textContent: q.scores ? "done" : "to review" })))));
  $("score").hidden = !current;
  if (!current) {
    if (data.queue.length && !list.length) $("r-progress").textContent = `All ${data.queue.length} reviewed. Thank you. Switch to "all" to change a score.`;
    return;
  }
  $("s-ref").textContent = `Application ${current.ref}`;
  $("s-answers").replaceChildren(...p.questions.map((label, i) => el("div", {}, el("h3", { textContent: label }), el("p", { textContent: current.answers[i] || "" }))));
  $("s-criteria").replaceChildren(...p.criteria.map((c, i) => el("fieldset", { className: "crit" },
    el("legend", { textContent: `${c.name}${c.weight > 1 ? ` (counts x${c.weight})` : ""}` }),
    el("div", { className: "scale" }, ...[1, 2, 3, 4, 5].map((n) => el("label", {}, el("input", { type: "radio", name: `c${i}`, value: String(n), required: true, checked: current.scores?.[i] === n }), String(n)))),
    el("div", { className: "scale-ends", ariaHidden: "true" }, el("span", { textContent: "Weak" }), el("span", { textContent: "Strong" })))));
  $("s-note").value = current.note || "";
}

function initReview() {
  $("review").hidden = false;
  $("r-show").addEventListener("change", () => renderReview());
  $("score").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const scores = data.programme.criteria.map((_, i) => Number(f.get(`c${i}`)));
    try {
      await api("/api/review", { method: "POST", body: { slug, applicationId: current.id, scores, note: $("s-note").value } });
      status(`Saved ${current.ref}.`);
      await loadReview();
      $("score").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } catch (err) {
      status(err.message, "notice-alert");
    }
  });
  $("conflict").addEventListener("click", async () => {
    if (!window.confirm(`Hand ${current.ref} to another reviewer? Use this if you know the applicant or have a stake in them.`)) return;
    try {
      const out = await api("/api/review", { method: "POST", body: { slug, applicationId: current.id, conflict: true } });
      status(out.reassigned ? "Done. It went to another reviewer." : "Done. The programme team will find another reviewer.");
      await loadReview();
    } catch (err) {
      status(err.message, "notice-alert");
    }
  });
  loadReview();
}

document.addEventListener("click", async (e) => {
  const id = e.target.dataset?.copy;
  if (!id) return;
  $(id).select();
  try { await navigator.clipboard.writeText($(id).value); e.target.textContent = "Copied"; } catch { document.execCommand("copy"); }
  setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
});

({ home: initHome, apply: initApply, admin: initAdmin, review: initReview })[view]();
