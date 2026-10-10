/* OncoGenik UI. Vanilla JS, hash routing, no framework.
 * Every action here is a POST that becomes one git commit on the server. */
(function () {
  "use strict";
  // Served at markburbridge.com/oncogenik. Every URL the app builds starts here.
  var BASE = "/oncogenik";

  var PHASES = ["research", "draft", "script_review", "outline_images", "review", "slides", "package", "done"];
  var PHASE_LABELS = {
    research: "Research", draft: "Draft", script_review: "Script review", outline_images: "Outline and images",
    review: "Review", slides: "Slides", package: "Package", done: "Done"
  };
  var OWNER_LABELS = { human: "you", claude: "Claude", hermes: "Hermes", agents: "Claude and Hermes", none: "nobody" };
  var PACKAGE_FILES = ["script.md", "outline.md", "deck.html", "sources.md"];

  var app = document.getElementById("app");

  /* ---------- helpers ---------- */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    if (child instanceof Node) { el.appendChild(child); return; }
    el.appendChild(document.createTextNode(String(child)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function fmtDate(s) {
    if (!s) return "";
    var d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function ago(s) {
    if (!s) return "";
    var ms = Date.now() - new Date(s).getTime();
    if (isNaN(ms)) return s;
    var m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var hrs = Math.round(m / 60);
    if (hrs < 48) return hrs + " h ago";
    return Math.round(hrs / 24) + " d ago";
  }
  function fileUrl(path, raw) { return BASE + "/api/file?path=" + encodeURIComponent(path) + (raw ? "&raw=1" : ""); }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast" + (kind ? " " + kind : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, kind === "bad" ? 8000 : 3500);
  }

  // Render markdown through marked, then strip anything that could run.
  function md(text) {
    var box = h("div", { class: "md" });
    if (!window.marked || typeof window.marked.parse !== "function") { box.appendChild(h("pre", {}, text)); return box; }
    var tpl = document.createElement("template");
    tpl.innerHTML = window.marked.parse(String(text || ""));
    tpl.content.querySelectorAll("script,iframe,object,embed,style,link,form").forEach(function (n) { n.remove(); });
    tpl.content.querySelectorAll("*").forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        else if (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*(javascript|data|vbscript):/i.test(a.value)) n.removeAttribute(a.name);
      });
      if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener"); }
    });
    box.appendChild(tpl.content);
    return box;
  }

  /* ---------- API ---------- */

  function api(method, path, body) {
    var init = { method: method, headers: { "Accept": "application/json" }, credentials: "same-origin" };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (r) {
      if (r.status === 401) { location.href = BASE + "/login"; return new Promise(function () {}); }
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = { error: text }; }
        if (!r.ok) {
          var err = new Error((data && data.error) || (r.status + " " + r.statusText));
          err.status = r.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }
  var GET = function (p) { return api("GET", p); };
  var POST = function (p, b) { return api("POST", p, b || {}); };
  var PUT = function (p, b) { return api("PUT", p, b || {}); };

  function busy(btn, fn) {
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = "Working…";
    return Promise.resolve().then(fn).catch(function (e) { toast(e.message || String(e), "bad"); })
      .then(function () { btn.disabled = false; btn.textContent = old; });
  }

  /* ---------- routing ---------- */

  function route() {
    var hash = location.hash || "#/";
    var q = {};
    var qi = hash.indexOf("?");
    var path = hash;
    if (qi >= 0) {
      path = hash.slice(0, qi);
      hash.slice(qi + 1).split("&").forEach(function (kv) {
        if (!kv) return;
        var p = kv.split("=");
        q[decodeURIComponent(p[0])] = decodeURIComponent(p.slice(1).join("=") || "");
      });
    }
    var parts = path.replace(/^#\/?/, "").split("/").filter(Boolean);
    return { parts: parts, q: q };
  }

  function setNav(name) {
    document.querySelectorAll(".nav a").forEach(function (a) { a.classList.toggle("active", a.dataset.nav === name); });
  }

  function render() {
    var r = route();
    clear(app);
    app.appendChild(h("p", { class: "muted" }, "Loading…"));
    var p;
    if (!r.parts.length) { setNav("dashboard"); p = viewDashboard(r.q); }
    else if (r.parts[0] === "ideas") { setNav("ideas"); p = viewIdeas(); }
    else if (r.parts[0] === "guidelines") { setNav("guidelines"); p = viewGuidelines(r.parts[1]); }
    else if (r.parts[0] === "projects" && r.parts[1]) { setNav(""); p = viewProject(r.parts[1]); }
    else { setNav(""); p = Promise.resolve(h("div", { class: "panel" }, h("h2", {}, "Not found"), h("a", { href: "#/" }, "Back to the dashboard"))); }
    Promise.resolve(p).then(function (el) { clear(app); append(app, el); }).catch(function (e) {
      clear(app);
      app.appendChild(h("div", { class: "panel" }, h("h2", {}, "Something went wrong"), h("p", { class: "muted" }, e.message || String(e)),
        h("button", { class: "btn", onclick: render }, "Try again")));
    });
  }

  /* ---------- dashboard ---------- */

  function badge(text, kind) { return h("span", { class: "badge " + (kind || "") }, text); }

  function taskList(tasks) {
    if (!tasks.length) return h("p", { class: "muted small" }, "No open tasks");
    return h("ul", { class: "tasks" }, tasks.map(function (t) {
      return h("li", {}, h("code", {}, t.name), badge(t.owner, t.owner), badge(t.status, t.status === "running" ? "good" : ""));
    }));
  }

  function failureList(slug, failed, onDone) {
    return failed.map(function (t) {
      var btn = h("button", { class: "btn sm warn" }, "Retry");
      btn.addEventListener("click", function () {
        busy(btn, function () {
          return POST(BASE + "/api/projects/" + slug + "/task", { task: t.name, status: "todo" }).then(function () {
            toast("Queued " + t.name + " again", "good"); onDone();
          });
        });
      });
      return h("div", { class: "failure" },
        h("div", { class: "row between" }, h("span", {}, h("code", {}, t.name), " ", badge(t.owner, t.owner), " ", badge("failed", "failed")), btn),
        t.error ? h("div", { class: "err" }, t.error) : null);
    });
  }

  function projectCard(p, reload) {
    return h("div", { class: "card" },
      h("div", { class: "title" }, h("a", { href: "#/projects/" + p.slug }, p.title)),
      h("div", { class: "row small muted" },
        badge(PHASE_LABELS[p.phase] || p.phase),
        h("span", {}, p.target_minutes + " min"),
        h("span", { title: fmtDate(p.updated) }, "updated " + ago(p.updated))),
      taskList(p.open),
      failureList(p.slug, p.failed, reload));
  }

  function groupProjects(list) {
    var g = { human: [], claude: [], hermes: [], done: [] };
    list.forEach(function (p) {
      var w = p.waiting || {};
      if (p.phase === "done" || w.on === "none") { g.done.push(p); return; }
      // A failed task needs a person to retry it, even while other tasks run.
      if (w.on === "human" || (p.failed && p.failed.length)) { g.human.push(p); return; }
      var owners = w.owners || [];
      if (owners.indexOf("claude") >= 0) g.claude.push(p);
      if (owners.indexOf("hermes") >= 0) g.hermes.push(p);
      if (!owners.length) g.human.push(p);
    });
    return g;
  }

  function viewDashboard(q) {
    return Promise.all([GET(BASE + "/api/projects"), GET(BASE + "/api/ideas").catch(function () { return { ideas: [] }; })]).then(function (res) {
      var projects = res[0].projects || [];
      var ideas = (res[1].ideas || []).filter(function (i) { return i.status !== "started" && i.status !== "done"; });
      var groups = groupProjects(projects);
      var root = h("div");

      root.appendChild(startForm(ideas, q));

      var sections = [
        ["Waiting on you", groups.human, "Nothing waits on you."],
        ["Claude is working", groups.claude, "Claude has nothing queued."],
        ["Hermes is working", groups.hermes, "Hermes has nothing queued."],
        ["Done", groups.done, "No finished projects yet."]
      ];
      sections.forEach(function (s) {
        root.appendChild(h("section", { class: "group" },
          h("h2", {}, s[0], h("span", { class: "count" }, String(s[1].length))),
          s[1].length ? h("div", { class: "cards" }, s[1].map(function (p) { return projectCard(p, render); })) : h("p", { class: "empty" }, s[2])));
      });
      if (res[0].errors && res[0].errors.length) {
        root.appendChild(h("p", { class: "muted small" }, "Skipped " + res[0].errors.length + " unreadable project file(s): " +
          res[0].errors.map(function (e) { return e.path; }).join(", ")));
      }
      return root;
    });
  }

  function startForm(ideas, q) {
    q = q || {};
    var title = h("input", { type: "text", placeholder: "What to expect from immunotherapy side effects", required: true, value: q.title || "" });
    var minutes = h("input", { type: "number", min: 8, max: 15, value: 10 });
    var select = h("select", {}, h("option", { value: "" }, "No idea file, start from the title"));
    ideas.forEach(function (i) {
      var opt = h("option", { value: i.path }, i.title + " (" + (i.source || "?") + ", " + (i.status || "new") + ")");
      if (q.idea && q.idea === i.path) { opt.selected = true; if (!title.value) title.value = i.title; }
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      var i = ideas.filter(function (x) { return x.path === select.value; })[0];
      if (i && !title.value) title.value = i.title;
    });
    var submit = h("button", { class: "btn primary", type: "submit" }, "Start project");
    var form = h("form", { class: "panel" },
      h("h2", {}, "Start a project"),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", {}, "Title"), title),
        h("div", { class: "field" }, h("label", {}, "Minutes (8 to 15)"), minutes),
        h("div", { class: "field" }, h("label", {}, "From an idea"), select),
        submit));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var body = { title: title.value.trim(), minutes: Number(minutes.value), idea: select.value || undefined };
      if (!body.title) { toast("Give the project a title", "bad"); return; }
      busy(submit, function () {
        return POST(BASE + "/api/projects", body).then(function (r) {
          toast("Started " + r.project.slug, "good");
          location.hash = "#/projects/" + r.project.slug;
        });
      });
    });
    if (q.idea && select.value) setTimeout(function () { form.scrollIntoView({ block: "start" }); }, 0);
    return form;
  }

  /* ---------- ideas ---------- */

  function viewIdeas() {
    return GET(BASE + "/api/ideas").then(function (r) {
      var ideas = r.ideas || [];
      var root = h("div");

      var title = h("input", { type: "text", placeholder: "Idea title", required: true });
      var text = h("textarea", { placeholder: "Why this topic now, and what patients seem to be asking." });
      var submit = h("button", { class: "btn primary", type: "submit" }, "Add idea");
      var form = h("form", { class: "panel" }, h("h2", {}, "Add an idea"),
        h("div", { class: "field" }, h("label", {}, "Title"), title),
        h("div", { class: "field" }, h("label", {}, "Notes"), text),
        submit);
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        busy(submit, function () {
          return POST(BASE + "/api/ideas", { title: title.value.trim(), text: text.value }).then(function () {
            toast("Idea saved", "good"); render();
          });
        });
      });
      root.appendChild(form);

      root.appendChild(h("section", { class: "group" }, h("h2", {}, "Ideas", h("span", { class: "count" }, String(ideas.length))),
        ideas.length ? h("div", { class: "cards" }, ideas.map(ideaCard)) : h("p", { class: "empty" }, "No ideas yet. Hermes writes them to ideas/, or add one above.")));
      return root;
    });
  }

  function ideaCard(i) {
    var start = i.status === "started" ? null
      : h("a", { class: "btn sm primary", href: "#/?idea=" + encodeURIComponent(i.path) + "&title=" + encodeURIComponent(i.title) }, "Start project");
    return h("div", { class: "card" },
      h("div", { class: "row between" }, h("div", { class: "title" }, i.title || i.slug), badge(i.status || "new", i.status || "new")),
      h("div", { class: "row small muted" }, h("span", {}, "source: " + (i.source || "?")), h("span", {}, i.found ? "found " + i.found : ""), h("code", {}, i.path)),
      i.body ? h("p", { class: "small" }, i.body.length > 400 ? i.body.slice(0, 400) + "…" : i.body) : null,
      h("div", { class: "row" }, start, h("a", { class: "btn sm ghost", href: fileUrl(i.path, true) }, "Download")));
  }

  /* ---------- project ---------- */

  function viewProject(slug) {
    return GET(BASE + "/api/projects/" + encodeURIComponent(slug)).then(function (r) {
      var p = r.project, files = r.files || [], w = r.waiting || {};
      var has = function (path) { return files.some(function (f) { return f.path === path; }); };
      var listUnder = function (prefix) { return files.filter(function (f) { return f.path.indexOf(prefix) === 0; }).map(function (f) { return f.path; }); };
      var fpath = function (rel) { return "projects/" + slug + "/" + rel; };
      var reload = function () { render(); };
      var act = function (btn, action, payload, okMsg) {
        return busy(btn, function () {
          return POST(BASE + "/api/projects/" + slug + "/action", { action: action, payload: payload || {} }).then(function () {
            toast(okMsg || (action + " done"), "good"); reload();
          });
        });
      };
      var openTask = function (name) { var t = p.tasks[name]; return !!t && t.status !== "done" && t.status !== "failed"; };

      var root = h("div");
      root.appendChild(h("div", { class: "row between" },
        h("h1", {}, p.title),
        h("span", { class: "muted small" }, p.target_minutes + " min · created " + p.created + " · ", h("code", {}, slug))));

      // Phase strip
      var idx = PHASES.indexOf(p.phase);
      root.appendChild(h("div", { class: "phases" }, PHASES.map(function (ph, i) {
        return h("div", { class: "phase" + (i < idx ? " done" : i === idx ? " current" : "") }, PHASE_LABELS[ph]);
      })));

      // Waiting banner
      var who = OWNER_LABELS[w.on] || w.on;
      var bannerText = w.on === "human" ? (w.reason === "failed tasks" ? "A task failed. Retry it below or fix it by hand." : "Waiting on you.")
        : w.on === "none" ? "Done." : "Waiting on " + who + (w.tasks && w.tasks.length ? ": " + w.tasks.join(", ") : "") + ".";
      root.appendChild(h("div", { class: "banner " + w.on }, bannerText, w.reason === "stalled" ? " Stalled: a blocked task has no running dependency." : ""));

      var failed = Object.keys(p.tasks).filter(function (n) { return p.tasks[n].status === "failed"; })
        .map(function (n) { return { name: n, owner: p.tasks[n].owner, error: p.tasks[n].error }; });
      if (failed.length) root.appendChild(h("div", { class: "panel" }, h("h3", {}, "Failed tasks"), h("div", { class: "stack" }, failureList(slug, failed, reload))));

      // Idea
      if (has("idea.md")) root.appendChild(h("details", { class: "panel" }, h("summary", {}, "Idea"), lazyFile(fpath("idea.md"))));

      // Research
      var research = listUnder("research/");
      root.appendChild(filesPanel("Research", research, fpath, research.length ? null : "No research files yet."));

      // Script
      root.appendChild(versionPanel({
        title: "Script", version: p.script_version, dir: "script", fpath: fpath, files: listUnder("script/"), has: has,
        canAct: p.phase === "script_review" && !openTask("script.revise"),
        approved: p.approved.script,
        why: p.phase === "script_review" ? "A revision is in progress." : p.approved.script ? "Approved at v" + p.script_version + "." : "Actions open in the script review phase.",
        approve: function (btn) { return act(btn, "script.approve", {}, "Script approved"); },
        feedback: function (btn, text) { return act(btn, "script.feedback", { text: text }, "Feedback sent to Claude"); }
      }));

      // Outline
      root.appendChild(versionPanel({
        title: "Outline", version: p.outline_version, dir: "outline", fpath: fpath, files: listUnder("outline/"), has: has,
        canAct: p.phase === "review" && !openTask("outline.revise"),
        why: p.phase === "review" ? "An outline revision is in progress." : p.approved.outline ? "Approved at v" + p.outline_version + "." : "Actions open in the review phase.",
        approved: p.approved.outline,
        approve: function (btn) { return act(btn, "outline.approve", {}, "Outline approved"); },
        feedback: function (btn, text) { return act(btn, "outline.feedback", { text: text }, "Feedback sent to Claude"); }
      }));

      // Images and slide order need prompts and decisions.
      var imagesPanel = h("div", { class: "panel" }, h("h2", {}, "Images"), h("p", { class: "muted" }, has("images/prompts.json") ? "Loading…" : "No prompts yet."));
      var orderPanel = h("div", { class: "panel" }, h("h2", {}, "Slide order"), h("p", { class: "muted" }, "Loading…"));
      root.appendChild(imagesPanel);
      root.appendChild(orderPanel);
      if (has("images/prompts.json")) {
        Promise.all([
          GET(fileUrl(fpath("images/prompts.json"))),
          has("images/decisions.json") ? GET(fileUrl(fpath("images/decisions.json"))) : Promise.resolve(null),
          has("slides/order.json") ? GET(fileUrl(fpath("slides/order.json"))) : Promise.resolve(null)
        ]).then(function (res) {
          var prompts = safeJSON(res[0].content, { prompts: [] }).prompts || [];
          var decisions = (safeJSON(res[1] && res[1].content, { decisions: {} }).decisions) || {};
          var order = (safeJSON(res[2] && res[2].content, {}).order) || p.slides_order || null;
          clear(imagesPanel);
          append(imagesPanel, imagesSection(p, prompts, decisions, fpath, has, act, openTask));
          clear(orderPanel);
          append(orderPanel, orderSection(p, prompts, decisions, order, fpath, has, act));
        }).catch(function (e) {
          clear(imagesPanel); append(imagesPanel, [h("h2", {}, "Images"), h("p", { class: "muted" }, "Could not load prompts: " + e.message)]);
        });
      } else {
        clear(orderPanel); append(orderPanel, [h("h2", {}, "Slide order"), h("p", { class: "muted" }, "Approve some images first.")]);
      }

      // Package
      var pkgFiles = PACKAGE_FILES.filter(function (f) { return has("package/" + f); });
      root.appendChild(h("div", { class: "panel" }, h("h2", {}, "Package"),
        p.phase === "done" || pkgFiles.length
          ? h("div", { class: "row" }, pkgFiles.map(function (f) { return h("a", { class: "btn", href: fileUrl(fpath("package/" + f), true) }, "Download " + f); }),
            pkgFiles.length ? null : h("span", { class: "muted" }, "Package files have not landed yet."))
          : h("p", { class: "muted" }, "Available once the project is done." + (has("slides/deck.html") ? "" : ""))));
      if (has("slides/deck.html")) root.appendChild(h("div", { class: "panel" }, h("h3", {}, "Deck"), h("a", { class: "btn", href: fileUrl(fpath("slides/deck.html"), true) }, "Download slides/deck.html")));

      // Tasks and history
      var allTasks = Object.keys(p.tasks).map(function (n) { var t = p.tasks[n]; return { name: n, owner: t.owner, status: t.status, round: t.round }; });
      root.appendChild(h("details", { class: "panel" }, h("summary", {}, "Tasks (" + allTasks.length + ")"),
        h("ul", { class: "tasks" }, allTasks.map(function (t) {
          return h("li", {}, h("code", {}, t.name), badge(t.owner, t.owner), badge(t.status, t.status === "done" ? "done" : t.status === "failed" ? "failed" : ""), t.round > 1 ? h("span", { class: "muted small" }, "round " + t.round) : null);
        }))));
      var hist = (p.history || []).slice().reverse();
      root.appendChild(h("div", { class: "panel" }, h("h2", {}, "History"),
        hist.length ? h("ul", { class: "history" }, hist.map(function (e) { return h("li", {}, h("time", { datetime: e.at }, fmtDate(e.at)), h("span", {}, e.msg)); })) : h("p", { class: "muted" }, "Nothing yet.")));
      return root;
    });
  }

  function safeJSON(s, fallback) { if (!s) return fallback; try { return JSON.parse(s); } catch (e) { return fallback; } }

  // A placeholder that loads and renders a file when it becomes visible (details opened) or immediately.
  function lazyFile(path, immediate) {
    var box = h("div", {}, h("p", { class: "muted small" }, "Loading " + path.split("/").pop() + "…"));
    var loaded = false;
    var load = function () {
      if (loaded) return; loaded = true;
      GET(fileUrl(path)).then(function (r) { clear(box); box.appendChild(renderFile(path, r.content)); })
        .catch(function (e) { clear(box); box.appendChild(h("p", { class: "muted" }, "Could not load: " + e.message)); });
    };
    if (immediate) load();
    else {
      var parent = null;
      setTimeout(function () {
        parent = box.closest("details");
        if (parent) parent.addEventListener("toggle", function () { if (parent.open) load(); });
        else load();
      }, 0);
    }
    return box;
  }

  function renderFile(path, content) {
    if (/\.json$/.test(path)) { var j = safeJSON(content, null); return h("pre", {}, j ? JSON.stringify(j, null, 2) : content); }
    if (/\.md$/.test(path)) return md(content);
    return h("pre", {}, content);
  }

  // Panel listing files; clicking a file renders it below.
  function filesPanel(title, paths, fpath, emptyText) {
    var view = h("div");
    var list = h("ul", { class: "filelist" }, paths.map(function (rel) {
      var b = h("button", { class: "btn sm" }, rel.replace(/^[^/]+\//, ""));
      b.addEventListener("click", function () {
        list.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        clear(view);
        view.appendChild(h("div", { class: "row between" }, h("span", { class: "muted small" }, fpath(rel)), h("a", { class: "btn sm ghost", href: fileUrl(fpath(rel), true) }, "Download")));
        view.appendChild(lazyFile(fpath(rel), true));
      });
      return h("li", {}, b);
    }));
    return h("div", { class: "panel" }, h("h2", {}, title), paths.length ? list : h("p", { class: "muted" }, emptyText || "Nothing yet."), view);
  }

  // Script and outline share this: current version rendered, feedback and approve, older files collapsed.
  function versionPanel(o) {
    var panel = h("div", { class: "panel" }, h("h2", {}, o.title));
    if (!o.version) { panel.appendChild(h("p", { class: "muted" }, "No " + o.title.toLowerCase() + " yet.")); return panel; }
    var current = o.dir + "/v" + o.version + ".md";
    panel.appendChild(h("div", { class: "row between" },
      h("span", {}, badge("v" + o.version, o.approved ? "good" : ""), " ", o.approved ? badge("approved", "good") : null, " ", h("span", { class: "muted small" }, o.fpath(current))),
      h("a", { class: "btn sm ghost", href: fileUrl(o.fpath(current), true) }, "Download")));
    panel.appendChild(o.has(current) ? lazyFile(o.fpath(current), true) : h("p", { class: "muted" }, current + " has not landed yet."));

    if (o.canAct) {
      var ta = h("textarea", { placeholder: "What should change in this version? Claude reads this and writes v" + (o.version + 1) + "." });
      var fb = h("button", { class: "btn warn" }, "Request changes");
      var ap = h("button", { class: "btn primary" }, o.approved ? "Approve again" : "Approve " + o.title.toLowerCase());
      fb.addEventListener("click", function () {
        if (!ta.value.trim()) { toast("Write some feedback first", "bad"); return; }
        o.feedback(fb, ta.value.trim());
      });
      ap.addEventListener("click", function () {
        if (!confirm("Approve " + o.title.toLowerCase() + " v" + o.version + "? This copies it to " + o.dir + "/final.md.")) return;
        o.approve(ap);
      });
      panel.appendChild(h("div", { class: "field" }, h("label", {}, "Feedback"), ta));
      panel.appendChild(h("div", { class: "row" }, fb, ap));
    } else {
      panel.appendChild(h("p", { class: "muted small" }, o.why));
    }

    var others = o.files.filter(function (f) { return f !== current && f !== o.dir + "/final.md"; });
    if (o.has(o.dir + "/final.md")) others.unshift(o.dir + "/final.md");
    if (others.length) {
      var view = h("div");
      panel.appendChild(h("details", {}, h("summary", {}, "Previous versions and feedback (" + others.length + ")"),
        h("ul", { class: "filelist" }, others.map(function (rel) {
          var b = h("button", { class: "btn sm" }, rel.replace(/^[^/]+\//, ""));
          b.addEventListener("click", function () { clear(view); view.appendChild(lazyFile(o.fpath(rel), true)); });
          return h("li", {}, b);
        })), view));
    }
    return panel;
  }

  function imagesSection(p, prompts, decisions, fpath, has, act, openTask) {
    var canDecide = p.phase === "review" && !openTask("images.reprompt") && !openTask("images.generate");
    var pending = {}; // id -> {decision, note}
    var out = [h("h2", {}, "Images")];
    if (!prompts.length) { out.push(h("p", { class: "muted" }, "prompts.json has no entries.")); return out; }
    out.push(h("p", { class: "muted small" }, prompts.length + " prompts. " + (canDecide ? "Approve, reject, or iterate with a note, then save." :
      p.phase === "review" ? "Images are being regenerated; decisions reopen when Hermes finishes." : "Decisions open in the review phase.")));

    var saveBtn = h("button", { class: "btn primary", disabled: true }, "Save decisions");
    var counter = h("span", { class: "muted small" }, "");
    var refresh = function () {
      var n = Object.keys(pending).length;
      saveBtn.disabled = !canDecide || !n;
      counter.textContent = n ? n + " change" + (n > 1 ? "s" : "") + " to save" : "";
    };

    var grid = h("div", { class: "grid" }, prompts.map(function (pr) {
      var id = String(pr.id);
      var existing = decisions[id] || null;
      var imgPath = "images/generated/" + id + ".png";
      var card = h("div", { class: "img-card" + (existing ? " decided-" + existing.decision : "") });
      var thumb = h("div", { class: "thumb" });
      if (has(imgPath)) {
        var img = h("img", { src: fileUrl(fpath(imgPath)), alt: pr.purpose || ("image " + id), loading: "lazy" });
        img.addEventListener("click", function () { lightbox(img.src); });
        thumb.appendChild(img);
      } else thumb.appendChild(h("span", {}, pr.status === "todo" ? "Not generated yet" : "No image"));
      card.appendChild(thumb);

      var note = h("textarea", { placeholder: "What should change in this image?", rows: 2, style: "min-height:3.5rem" });
      note.value = existing && existing.decision === "iterate" ? existing.note || "" : "";
      var noteWrap = h("div", { class: existing && existing.decision === "iterate" ? "" : "hidden" }, note);
      var changed = h("div", { class: "changed" }, "");
      var btns = {};
      var set = function (d) {
        Object.keys(btns).forEach(function (k) { btns[k].classList.toggle("on", k === d); });
        noteWrap.classList.toggle("hidden", d !== "iterate");
        var same = existing && existing.decision === d && (d !== "iterate" || (existing.note || "") === note.value.trim());
        if (same) { delete pending[id]; changed.textContent = ""; }
        else { pending[id] = { decision: d, note: d === "iterate" ? note.value.trim() : "" }; changed.textContent = "unsaved"; }
        card.className = "img-card decided-" + d;
        refresh();
      };
      ["approve", "reject", "iterate"].forEach(function (d) {
        var cls = d === "approve" ? "good" : d === "reject" ? "danger" : "warn";
        btns[d] = h("button", { class: "btn sm " + cls + (existing && existing.decision === d ? " on" : ""), disabled: !canDecide }, d);
        btns[d].addEventListener("click", function () { set(d); });
      });
      note.addEventListener("input", function () { if (pending[id] || (existing && existing.decision === "iterate")) set("iterate"); });
      card.appendChild(h("div", { class: "body" },
        h("div", { class: "row between" }, h("strong", {}, "#" + id), h("span", { class: "muted" }, pr.section || "")),
        h("div", {}, pr.purpose || ""),
        h("div", { class: "prompt" }, pr.prompt || ""),
        existing ? h("div", { class: "small muted" }, "Current: " + existing.decision + (existing.note ? " — " + existing.note : "") + (existing.at ? " (" + ago(existing.at) + ")" : "")) : null,
        h("div", { class: "row" }, btns.approve, btns.reject, btns.iterate),
        noteWrap, changed));
      return card;
    }));
    out.push(grid);

    saveBtn.addEventListener("click", function () {
      var ids = Object.keys(pending);
      var missing = ids.filter(function (id) { return pending[id].decision === "iterate" && !pending[id].note; });
      if (missing.length) { toast("Add a note for iterate on #" + missing.join(", #"), "bad"); return; }
      act(saveBtn, "images.decide", { decisions: pending }, "Saved " + ids.length + " decision" + (ids.length > 1 ? "s" : ""));
    });
    out.push(h("div", { class: "row", style: "margin-top:0.75rem" }, saveBtn, counter));
    refresh();
    return out;
  }

  function lightbox(src) {
    var box = h("div", { class: "lightbox" }, h("img", { src: src, alt: "" }));
    box.addEventListener("click", function () { box.remove(); });
    document.body.appendChild(box);
  }

  function orderSection(p, prompts, decisions, savedOrder, fpath, has, act) {
    var out = [h("h2", {}, "Slide order")];
    var approved = prompts.map(function (pr) { return String(pr.id); }).filter(function (id) { return decisions[id] && decisions[id].decision === "approve"; });
    if (!approved.length) { out.push(h("p", { class: "muted" }, "No approved images yet.")); return out; }
    var order = (savedOrder || []).map(String).filter(function (id) { return approved.indexOf(id) >= 0; });
    approved.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    var canOrder = p.phase === "review";
    out.push(h("p", { class: "muted small" }, approved.length + " approved image" + (approved.length > 1 ? "s" : "") + ". Drag to reorder, or use the arrows." +
      (savedOrder ? " Saved order shown." : " Not saved yet.")));

    var list = h("ul", { class: "order" });
    var dragging = null;
    var draw = function () {
      clear(list);
      order.forEach(function (id, i) {
        var pr = prompts.filter(function (x) { return String(x.id) === id; })[0] || {};
        var li = h("li", { draggable: canOrder ? "true" : null, dataset: { id: id } },
          has("images/generated/" + id + ".png") ? h("img", { src: fileUrl(fpath("images/generated/" + id + ".png")), alt: pr.purpose || id, loading: "lazy" }) : h("div", { class: "thumb" }, "#" + id),
          h("div", { class: "n" }, (i + 1) + ". #" + id + " " + (pr.section || "")),
          h("div", { class: "row" },
            h("button", { class: "btn sm", disabled: !canOrder || i === 0, onclick: function () { move(i, i - 1); } }, "↑"),
            h("button", { class: "btn sm", disabled: !canOrder || i === order.length - 1, onclick: function () { move(i, i + 1); } }, "↓")));
        if (canOrder) {
          li.addEventListener("dragstart", function (ev) { dragging = id; li.classList.add("dragging"); ev.dataTransfer.effectAllowed = "move"; try { ev.dataTransfer.setData("text/plain", id); } catch (e) { /* ignore */ } });
          li.addEventListener("dragend", function () { dragging = null; draw(); });
          li.addEventListener("dragover", function (ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; li.classList.add("over"); });
          li.addEventListener("dragleave", function () { li.classList.remove("over"); });
          li.addEventListener("drop", function (ev) {
            ev.preventDefault();
            var from = order.indexOf(dragging), to = order.indexOf(id);
            if (from < 0 || to < 0 || from === to) return;
            order.splice(to, 0, order.splice(from, 1)[0]);
            draw();
          });
        }
        list.appendChild(li);
      });
    };
    var move = function (from, to) { if (to < 0 || to >= order.length) return; order.splice(to, 0, order.splice(from, 1)[0]); draw(); };
    draw();
    out.push(list);

    var save = h("button", { class: "btn primary", disabled: !canOrder }, "Save order");
    save.addEventListener("click", function () { act(save, "slides.order", { order: order.slice() }, "Slide order saved"); });
    var finish = h("button", { class: "btn good", disabled: !canOrder }, "Finish review");
    var err = h("div", { class: "failure hidden" });
    finish.addEventListener("click", function () {
      if (!confirm("Finish the review? Claude builds the deck from the saved order.")) return;
      err.classList.add("hidden");
      busy(finish, function () {
        return POST(BASE + "/api/projects/" + p.slug + "/action", { action: "review.finish", payload: {} })
          .then(function () { toast("Review finished, Claude is building the deck", "good"); render(); })
          .catch(function (e) { err.textContent = e.message; err.classList.remove("hidden"); });
      });
    });
    out.push(h("div", { class: "row", style: "margin-top:0.75rem" }, save, finish));
    out.push(err);
    if (!canOrder) out.push(h("p", { class: "muted small" }, "Order and finish are available in the review phase."));
    return out;
  }

  /* ---------- guidelines ---------- */

  function viewGuidelines(tab) {
    return GET(BASE + "/api/guidelines").then(function (r) {
      var files = r.files || {}, names = Object.keys(files);
      var current = names.indexOf(tab) >= 0 ? tab : names[0];
      var root = h("div");

      var editor = h("textarea", { class: "editor", spellcheck: "false" });
      editor.value = files[current] || "";
      var save = h("button", { class: "btn primary" }, "Save " + current);
      var tabs = h("div", { class: "tabs" }, names.map(function (n) {
        return h("button", { class: n === current ? "active" : "", onclick: function () {
          if (editor.value !== (files[current] || "") && !confirm("Discard unsaved changes to " + current + "?")) return;
          location.hash = "#/guidelines/" + n;
        } }, n);
      }));
      save.addEventListener("click", function () {
        busy(save, function () {
          return PUT(BASE + "/api/guidelines", { file: current, content: editor.value }).then(function () {
            files[current] = editor.value; toast("Saved guidelines/" + current, "good");
          });
        });
      });
      root.appendChild(h("div", { class: "panel" }, h("h2", {}, "Guidelines"), tabs, editor,
        h("div", { class: "row between", style: "margin-top:0.5rem" }, h("span", { class: "muted small" }, "guidelines/" + current), save)));

      var groups = r.proposals || [];
      var open = 0;
      groups.forEach(function (g) { (g.proposals || []).forEach(function (pr) { if (!pr.decided) open++; }); });
      var section = h("section", { class: "group" }, h("h2", {}, "Proposals", h("span", { class: "count" }, open + " open")));
      if (!groups.length) section.appendChild(h("p", { class: "empty" }, "No proposals. Claude writes them to guidelines/proposals/ when a project finishes."));
      groups.forEach(function (g) {
        section.appendChild(h("h3", {}, "From ", h("a", { href: "#/projects/" + g.slug }, g.slug), " ", h("span", { class: "muted small" }, g.created || "")));
        if (g.error) section.appendChild(h("p", { class: "muted" }, g.path + ": " + g.error));
        (g.proposals || []).forEach(function (pr) { section.appendChild(proposalCard(g.slug, pr)); });
      });
      root.appendChild(section);
      return root;
    });
  }

  function proposalCard(slug, pr) {
    var decide = function (btn, decision) {
      return busy(btn, function () {
        return POST(BASE + "/api/guidelines/proposal", { slug: slug, id: pr.id, decision: decision }).then(function () {
          toast((decision === "accept" ? "Accepted" : "Rejected") + " proposal " + pr.id, "good"); render();
        });
      });
    };
    var accept = h("button", { class: "btn good" }, "Accept");
    var reject = h("button", { class: "btn danger" }, "Reject");
    accept.addEventListener("click", function () { decide(accept, "accept"); });
    reject.addEventListener("click", function () { decide(reject, "reject"); });
    return h("div", { class: "proposal" + (pr.decided ? " decided" : "") },
      h("div", { class: "row between" },
        h("span", {}, h("strong", {}, "#" + pr.id), " ", h("code", {}, pr.file || "?")),
        pr.decided ? badge(pr.decided + (pr.decided_at ? " " + ago(pr.decided_at) : ""), pr.decided === "accept" ? "good" : "bad") : badge("open", "new")),
      pr.rationale ? h("p", { style: "margin-top:0.5rem" }, pr.rationale) : null,
      h("div", { class: "diff" },
        h("div", { class: "cur" }, h("h4", {}, "Current"), h("pre", {}, pr.current_excerpt || "(none; the text will be appended)")),
        h("div", { class: "new" }, h("h4", {}, "Proposed"), h("pre", {}, pr.proposed_text || ""))),
      pr.decided ? null : h("div", { class: "row" }, accept, reject));
  }

  /* ---------- boot ---------- */

  document.getElementById("signout").addEventListener("click", function () {
    fetch(BASE + "/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(function () {}).then(function () { location.href = BASE + "/login"; });
  });
  window.addEventListener("hashchange", render);
  render();
})();
