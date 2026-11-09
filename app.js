(function () {
  'use strict';

  // Public viewer for data/town.json. The data is untrusted (TikTok comments):
  // only textContent, createElement and setAttribute are used. No innerHTML anywhere.

  var NS = 'http://www.w3.org/2000/svg';
  var TYPES = ['IDEA', 'LAW', 'DESTROY', 'NAME', 'JAIL'];
  var FROM_EP = { NAME: 3, JAIL: 3 };   // types that only exist from this episode: no heading before it
  var STATES = { basic: 'basic', custom: 'custom', destroyed_basic: 'destroyed → back to basic' };
  var EVENTS = {
    joined: 'Joined',
    house_custom: 'House request',
    house_destroyed: 'House destroyed',
    house_saved: 'House saved',
    candidate: 'Ran for deputy mayor (I RUN)',
    deputy: 'Deputy mayor',
    custom_avatar: 'Custom avatar',
    job: 'Job'
  };
  var AVATAR_IMG = /^img\/avatars\/[A-Za-z0-9_.-]+\.(png|jpg|webp)$/;
  var HOUSE_IMG = /^img\/houses\/[A-Za-z0-9_.-]+\.(jpg|png|webp)$/;
  var LAW_LABEL = { in_force: 'In force', vote_pending: 'Vote pending', kept: 'Kept', repealed: 'Repealed' };
  var PAGE = 60;
  var TIKTOK = 'https://www.tiktok.com/';
  var DEFAULT_HOUSE_NOTE = 'Search your @handle above, or tap a house below, to see its history.';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var model = null;
  var selected = null;   // handle of the open house
  var houseNote = null;  // message shown in place of the default hint
  var propEp = null;     // episode shown in the proposals block
  var houseLimit = PAGE;

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function own(map, key) { return Object.prototype.hasOwnProperty.call(map, key); }
  function text(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return '';
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function list(v) {
    return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : [];
  }
  function norm(s) { return text(s).trim().toLowerCase().replace(/^@+/, ''); }
  function fmt(n) { return typeof n === 'number' && isFinite(n) ? n.toLocaleString('en') : '—'; }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function byHandle(a, b) {
    var x = a.handle.toLowerCase(), y = b.handle.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function fmtDate(iso) {
    var s = text(iso);
    if (!s) return '—';
    var d = new Date(s);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function relTime(iso) {
    var d = new Date(text(iso));
    if (isNaN(d.getTime())) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 0) return fmtDate(iso); // a date in the future: show it as a date
    var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;
    var units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (var i = 0; i < units.length; i++) {
      if (diff >= units[i][1]) {
        var v = Math.floor(diff / units[i][1]);
        return rtf ? rtf.format(-v, units[i][0]) : v + ' ' + units[i][0] + (v === 1 ? '' : 's') + ' ago';
      }
    }
    return rtf ? rtf.format(0, 'second') : 'just now';
  }
  function tiktokUrl(s) {
    var u = text(s);
    return u.indexOf(TIKTOK) === 0 ? u : null;
  }
  function epKey(p) { return typeof p.ep === 'number' && isFinite(p.ep) ? String(p.ep) : null; }
  function typeOf(p) { return text(p.type).toUpperCase(); }
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function empty(msg) { return h('p', { class: 'empty' }, [msg]); }

  // Element builder: attrs go through setAttribute / addEventListener, children are text or nodes.
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    [].concat(kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
    return n;
  }

  // ---------- normalise (tolerates missing / null fields) ----------
  function photoOf(v) {   // house photo as seen in an episode, or null
    var o = obj(v), src = text(o.src);
    return HOUSE_IMG.test(src) && typeof o.ep === 'number' && isFinite(o.ep) ? { src: src, ep: o.ep } : null;
  }

  function jobOf(v) {   // job hired in an episode, or null
    var o = obj(v), title = text(o.title).trim();
    return title && title.length <= 40 && typeof o.ep === 'number' && isFinite(o.ep) ? { title: title, ep: o.ep } : null;
  }

  function normalize(raw) {
    var d = obj(raw);
    var pObj = obj(d.players);
    var players = Object.keys(pObj).map(function (key) {
      var p = obj(pObj[key]);
      var house = obj(p.house);
      var state = text(house.state);
      return {
        handle: text(p.handle) || key,
        nickname: text(p.nickname),
        joined: typeof p.joined_ep === 'number' ? p.joined_ep : null,
        lot: typeof p.lot === 'number' || (typeof p.lot === 'string' && p.lot !== '') ? p.lot : null,
        state: own(STATES, state) ? state : 'basic',
        custom: text(house.custom),
        photo: photoOf(p.house_photo),
        job: jobOf(p.job),
        candidate: p.candidate === true,
        comments: num(p.comments),
        likes: num(p.likes),
        history: list(p.history)
      };
    });
    var hist = list(d.followers_history).filter(function (x) { return typeof x.count === 'number'; });
    var followers = typeof d.followers === 'number'
      ? d.followers
      : (hist.length ? hist[hist.length - 1].count : null);
    var episodes = list(d.episodes);
    var deputies = list(d.deputies).map(function (x) {
      var start = typeof x.ep_start === 'number' && isFinite(x.ep_start) ? x.ep_start : null;
      var end = typeof x.ep_end === 'number' && isFinite(x.ep_end) ? x.ep_end : (start === null ? null : start + 1);
      var status = text(x.law_status);
      return { handle: text(x.handle), start: start, end: end, law: text(x.law), status: own(LAW_LABEL, status) ? status : null };
    }).filter(function (x) { return x.handle && x.start !== null; });
    var avatars = list(d.avatars).map(function (a) {
      var img = text(a.image);
      return {
        handle: text(a.handle),
        ep: typeof a.ep === 'number' && isFinite(a.ep) ? a.ep : null,
        request: text(a.request).trim(),
        likes: num(a.likes),
        image: AVATAR_IMG.test(img) ? img : null
      };
    }).filter(function (a) { return a.handle && a.ep !== null; });
    var avatarBy = Object.create(null);   // latest avatar per handle
    avatars.slice().sort(function (a, b) { return a.ep - b.ep; }).forEach(function (a) { avatarBy[norm(a.handle)] = a; });
    return {
      updated: text(d.updated),
      followers: followers,
      hist: hist,
      players: players,
      episodes: episodes,
      deputies: deputies,
      avatars: avatars,
      avatarBy: avatarBy,
      proposals: list(d.proposals),
      results: obj(d.results)
    };
  }

  function findPlayer(handle) {
    var want = norm(handle);
    if (!model || !want) return null;
    for (var i = 0; i < model.players.length; i++) {
      if (model.players[i].handle.toLowerCase() === want) return model.players[i];
    }
    return null;
  }

  function currentEp() {
    var nums = model.episodes.map(function (e) { return e.ep; })
      .concat(model.proposals.map(function (p) { return p.ep; }))
      .filter(function (v) { return typeof v === 'number' && isFinite(v); });
    return nums.length ? Math.max.apply(null, nums) : null;
  }

  // ---------- deputy mayor, custom avatars, hall of fame ----------
  function avatarFor(handle) {
    if (!model) return null;
    var key = norm(handle);
    return own(model.avatarBy, key) ? model.avatarBy[key] : null;
  }

  function portrait(p, big) {
    var a = avatarFor(p.handle);
    if (!a || !a.image) return initial(p);
    return h('img', {
      class: 'avatar-img' + (big ? ' is-big' : ''),
      src: a.image,
      width: big ? 72 : 44,
      height: big ? 72 : 44,
      loading: 'lazy',
      alt: p.handle + "'s custom avatar"
    });
  }

  function avatarTag(p) {
    var a = avatarFor(p.handle);
    return a ? h('span', { class: 'tag' }, ['Custom avatar, ep ' + a.ep]) : null;
  }

  function jobTag(p) {
    return p.job ? h('span', { class: 'tag' }, ['Job: ' + p.job.title]) : null;
  }

  function cmpText(a, b) {
    var x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }

  function hallRows() {
    var rows = model.deputies.map(function (x) {
      return { deputy: x, avatar: null, ep: x.start, order: 0, handle: x.handle };
    }).concat(model.avatars.map(function (a) {
      return { deputy: null, avatar: a, ep: a.ep, order: 1, handle: a.handle };
    }));
    rows.sort(function (a, b) { return (a.ep - b.ep) || (a.order - b.order) || cmpText(a.handle, b.handle); });
    return rows;
  }

  function deputyMeta(x) {
    var out = [h('p', { class: 'hall-meta' }, ['Deputy mayor, episodes ' + x.start + '–' + x.end])];
    out.push(x.law
      ? h('p', { class: 'hall-law' }, ['Law: “' + x.law + '”'])
      : h('p', { class: 'hall-meta' }, ['No law yet']));
    if (x.status) out.push(h('p', { class: 'hall-meta' }, ['Law status: ' + LAW_LABEL[x.status]]));
    return out;
  }

  function avatarMeta(a) {
    return [
      h('p', { class: 'hall-meta' }, ['Most-liked comment, episode ' + a.ep]),
      h('p', { class: 'hall-meta' }, [fmt(a.likes) + ' likes'])
    ];
  }

  function hallItem(r, rank) {
    var isDep = r.deputy !== null;
    var p = findPlayer(r.handle);
    var who = p
      ? h('button', { type: 'button', class: 'hall-btn', onclick: function () { openHouse(p.handle, { scroll: true }); } }, ['@' + p.handle])
      : h('span', { class: 'handle' }, ['@' + r.handle]);
    var picture = !isDep && r.avatar.image
      ? h('img', { class: 'avatar-img is-big', src: r.avatar.image, width: 72, height: 72, loading: 'lazy', alt: r.handle + "'s custom avatar" })
      : h('span', { class: 'initial avatar-ph', 'aria-hidden': 'true' }, [r.handle.charAt(0).toUpperCase()]);
    return h('li', { class: 'hall-item' }, [
      h('span', { class: 'hall-rank' }, [String(rank)]),
      picture,
      h('div', { class: 'hall-body' }, [
        h('span', { class: 'type ' + (isDep ? 't-RUN' : 't-HOUSE') }, [isDep ? 'Deputy' : 'Custom avatar']),
        who
      ].concat(isDep ? deputyMeta(r.deputy) : avatarMeta(r.avatar)))
    ]);
  }

  function renderHall() {
    var root = clear($('hall-list'));
    var any = model.deputies.length > 0 || model.avatars.length > 0;
    $('hall').hidden = !any;
    $('nav-hall').hidden = !any;
    hallRows().forEach(function (r, i) { root.appendChild(hallItem(r, i + 1)); });
  }

  // ---------- deputy and custom avatar lists ----------
  function personLink(handle) {
    var p = findPlayer(handle);
    return p
      ? h('a', { class: 'roster-link', href: '#u-' + encodeURIComponent(p.handle) }, ['@' + p.handle])
      : h('span', { class: 'handle' }, ['@' + handle]);
  }

  function rosterPicture(handle, image) {
    if (image) return h('img', { class: 'avatar-img is-big', src: image, width: 72, height: 72, loading: 'lazy', alt: handle + "'s custom avatar" });
    var p = findPlayer(handle);
    return p ? portrait(p, true) : h('span', { class: 'initial avatar-ph', 'aria-hidden': 'true' }, [handle.charAt(0).toUpperCase()]);
  }

  function deputyItem(x) {
    return h('li', { class: 'roster-item' }, [
      rosterPicture(x.handle, null),
      h('div', { class: 'roster-body' }, [
        h('span', { class: 'type t-RUN' }, ['Deputy mayor']),
        personLink(x.handle),
        h('p', { class: 'hall-meta' }, ['Episodes ' + x.start + '–' + x.end]),
        h('p', { class: 'hall-law' }, [x.law ? 'Law: “' + x.law + '”' : 'No law yet']),
        x.status ? h('span', { class: 'badge l-' + x.status }, [LAW_LABEL[x.status]]) : null
      ])
    ]);
  }

  function avatarItem(a) {
    return h('li', { class: 'roster-item' }, [
      rosterPicture(a.handle, a.image),
      h('div', { class: 'roster-body' }, [
        h('span', { class: 'type t-HOUSE' }, ['Custom avatar']),
        personLink(a.handle),
        h('p', { class: 'hall-meta' }, ['Most-liked comment, episode ' + a.ep + ' · ' + fmt(a.likes) + ' likes']),
        a.request ? h('p', { class: 'hall-law' }, ['Request: “' + a.request + '”']) : null
      ])
    ]);
  }

  function renderDeputies() {
    var root = clear($('deputy-root'));
    if (!model.deputies.length) {
      root.appendChild(empty('No deputy yet. Comment I RUN under episode 2 — the most-liked candidacy wins in episode 3.'));
      return;
    }
    var list = h('ul', { class: 'roster' });
    model.deputies.slice().sort(function (a, b) { return b.start - a.start; })
      .forEach(function (x) { list.appendChild(deputyItem(x)); });
    root.appendChild(list);
  }

  function renderAvatars() {
    var root = clear($('avatar-root'));
    if (!model.avatars.length) {
      root.appendChild(empty('First winner: the most-liked comment under episode 2 that is not an I RUN, revealed in episode 3.'));
      return;
    }
    var list = h('ul', { class: 'roster' });
    model.avatars.slice().sort(function (a, b) { return b.ep - a.ep; })
      .forEach(function (a) { list.appendChild(avatarItem(a)); });
    root.appendChild(list);
  }

  function jobItem(p) {
    return h('li', { class: 'roster-item' }, [
      rosterPicture(p.handle, null),
      h('div', { class: 'roster-body' }, [
        h('span', { class: 'tag' }, [p.job.title]),
        personLink(p.handle),
        h('p', { class: 'hall-meta' }, ['Since episode ' + p.job.ep])
      ])
    ]);
  }

  function renderJobs() {   // whole section hidden when nobody has a job yet
    var rows = model.players.filter(function (p) { return p.job; })
      .sort(function (a, b) { return (b.job.ep - a.job.ep) || byHandle(a, b); });
    var section = $('jobs');
    section.hidden = !rows.length;
    var root = clear($('jobs-root'));
    if (!rows.length) return;
    var list = h('ul', { class: 'roster' });
    rows.forEach(function (p) { list.appendChild(jobItem(p)); });
    root.appendChild(list);
  }

  // ---------- shared renderers ----------
  function badge(state) {
    var known = own(STATES, state);
    return h('span', { class: 'badge b-' + (known ? state : 'unknown') }, [known ? STATES[state] : 'unknown']);
  }

  function initial(p) {
    var letter = (p.nickname || p.handle || '?').charAt(0) || '?';
    return h('span', { class: 'initial', 'aria-hidden': 'true' }, [letter.toUpperCase()]);
  }

  function fact(label, value) {
    return h('span', { class: 'fact' }, [
      h('span', { class: 'fact-label' }, [label]),
      h('span', { class: 'fact-val' }, [value])
    ]);
  }

  function requestInfo(p) {
    if (!p.custom) return { cls: 'request is-none', text: 'No HOUSE request yet' };
    if (p.state === 'destroyed_basic') return { cls: 'request is-gone', text: 'Old request: ' + p.custom };
    return { cls: 'request', text: '“' + p.custom + '”' };
  }

  function playerCard(p) {
    var rq = requestInfo(p);
    return h('button', {
      type: 'button',
      class: 'card-btn' + (selected === p.handle ? ' is-selected' : ''),
      'data-h': p.handle,
      onclick: function () { openHouse(p.handle, { scroll: true }); }
    }, [
      h('span', { class: 'card-top' }, [
        portrait(p),
        h('span', { class: 'who' }, [
          h('span', { class: 'nick' }, [p.nickname || p.handle]),
          h('span', { class: 'handle' }, ['@' + p.handle])
        ]),
        badge(p.state)
      ]),
      h('span', { class: 'facts' }, [
        fact('Joined', p.joined === null ? '—' : 'EP ' + p.joined),
        fact('Lot', p.lot === null ? 'none' : '#' + p.lot),
        fact('Comments', fmt(p.comments)),
        fact('Likes', fmt(p.likes))
      ]),
      h('span', { class: rq.cls }, [rq.text]),
      p.candidate ? h('span', { class: 'tag' }, ['Candidate']) : null,
      avatarTag(p),
      jobTag(p),
      p.photo ? h('span', { class: 'tag' }, ['In episode ' + p.photo.ep]) : null
    ]);
  }

  function selectNode(el) {
    var r = document.createRange();
    r.selectNodeContents(el);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  // ---------- header ----------
  function sparkline(points) {
    if (!points.length) return null;
    var W = 160, H = 48, P = 5;
    var vals = points.map(function (p) { return p.count; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max === min) max = min + 1;
    var xy = points.map(function (p, i) {
      var x = points.length === 1 ? W / 2 : P + i * (W - 2 * P) / (points.length - 1);
      var y = H - P - (p.count - min) / (max - min) * (H - 2 * P);
      return [x, y];
    });
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'spark-svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Follower history: ' + vals.join(', '));
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', xy.map(function (c, i) {
      return (i ? 'L' : 'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1);
    }).join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    var last = xy[xy.length - 1];
    var dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', last[0].toFixed(1));
    dot.setAttribute('cy', last[1].toFixed(1));
    dot.setAttribute('r', '3.5');
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);
    return svg;
  }

  function renderHero() {
    $('population').textContent = fmt(model.followers);
    var ep = currentEp();
    $('current-ep').textContent = ep === null ? '—' : String(ep);
    var spark = clear($('spark'));
    var s = sparkline(model.hist);
    if (s) spark.appendChild(s);
    var rel = relTime(model.updated);
    $('updated').textContent = rel ? 'Last updated ' + rel : 'Last update time unknown';
  }

  // ---------- search ----------
  function matches(q) {
    var out = [];
    model.players.forEach(function (p) {
      var hd = p.handle.toLowerCase();
      var nk = p.nickname.toLowerCase();
      var rank = hd === q ? 0 : hd.indexOf(q) === 0 ? 1 : hd.indexOf(q) !== -1 ? 2 : nk.indexOf(q) !== -1 ? 3 : -1;
      if (rank !== -1) out.push({ p: p, rank: rank });
    });
    out.sort(function (a, b) {
      return (a.rank - b.rank) || (b.p.likes - a.p.likes) || (a.p.handle < b.p.handle ? -1 : 1);
    });
    return out.slice(0, 8).map(function (x) { return x.p; });
  }

  function renderResults() {
    var q = norm($('find').value);
    var box = clear($('results'));
    if (!q || !model) { box.hidden = true; return; }
    box.hidden = false;
    var found = matches(q);
    if (!found.length) {
      box.appendChild(h('li', { class: 'result-none' }, ['No house with that name yet.']));
      return;
    }
    found.forEach(function (p) {
      box.appendChild(h('li', null, [
        h('button', {
          type: 'button',
          class: 'result-btn',
          onclick: function () { box.hidden = true; openHouse(p.handle, { scroll: true }); }
        }, [
          initial(p),
          h('span', { class: 'who' }, [
            h('span', { class: 'nick' }, [p.nickname || p.handle]),
            h('span', { class: 'handle' }, ['@' + p.handle])
          ]),
          badge(p.state)
        ])
      ]));
    });
  }

  // ---------- house card and deep link (#u-<handle>) ----------
  function setHash(handle) {
    var base = location.pathname + location.search;
    try {
      history.replaceState(null, '', handle ? base + '#u-' + encodeURIComponent(handle) : base);
    } catch (e) { /* sandboxed or file:// contexts: the card still works without the hash */ }
  }

  function openHouse(handle, opts) {
    var p = findPlayer(handle);
    if (!p) return false;
    selected = p.handle;
    houseNote = null;
    renderHouse();
    markSelected();
    if (opts.url !== false) setHash(p.handle);
    if (opts.scroll) $('house').scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    return true;
  }

  function closeHouse() {
    selected = null;
    houseNote = null;
    setHash(null);
    renderHouse();
    markSelected();
  }

  function fromHash(scroll) {
    var m = /^#u-(.+)$/.exec(location.hash || '');
    if (!m || !model) return;
    if (!openHouse(safeDecode(m[1]), { scroll: scroll, url: false })) {
      selected = null; // otherwise the previously open house would stay on screen
      houseNote = 'No house found for that link yet.';
      renderHouse();
      markSelected();
    }
  }

  function markSelected() {
    document.querySelectorAll('.card-btn').forEach(function (b) {
      b.classList.toggle('is-selected', b.getAttribute('data-h') === selected);
    });
  }

  function historyItem(ev) {
    var name = text(ev.event);
    var label = own(EVENTS, name) ? EVENTS[name] : (name.replace(/_/g, ' ') || 'Event');
    var detail = text(ev.detail);
    return h('li', { class: 'tl-item' }, [
      h('span', { class: 'tl-ep' }, ['EP ' + (typeof ev.ep === 'number' ? ev.ep : '?')]),
      h('span', { class: 'tl-body' }, [
        h('strong', null, [label]),
        detail ? h('span', { class: 'tl-detail' }, [detail]) : null,
        h('time', null, [fmtDate(ev.at)])
      ])
    ]);
  }

  function renderHouse() {
    var card = clear($('house-card'));
    var p = selected ? findPlayer(selected) : null;
    $('house-empty').hidden = !!p;
    $('house-empty').textContent = houseNote || DEFAULT_HOUSE_NOTE;
    card.hidden = !p;
    if (!p) return;

    var link = location.href.split('#')[0] + '#u-' + encodeURIComponent(p.handle);
    var linkEl = h('p', { class: 'share-link' }, [link]);
    var status = h('span', { class: 'share-status', role: 'status', 'aria-live': 'polite' });
    var copyBtn = h('button', {
      type: 'button',
      class: 'btn small',
      onclick: function () {
        var done = function () { status.textContent = 'Link copied.'; };
        var fallback = function () { selectNode(linkEl); status.textContent = 'Link selected. Press Ctrl+C (or Cmd+C) to copy.'; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(done, fallback);
        } else {
          fallback();
        }
      }
    }, ['Copy link to this house']);

    if (p.photo) {
      card.appendChild(h('figure', { class: 'house-photo' }, [
        h('img', {
          src: p.photo.src,
          width: 720,
          height: 900,
          loading: 'lazy',
          alt: '@' + p.handle + "'s house in episode " + p.photo.ep
        }),
        h('figcaption', null, ['Seen in episode ' + p.photo.ep])
      ]));
    }

    card.appendChild(h('div', { class: 'house-head' }, [
      portrait(p, true),
      h('div', { class: 'who' }, [
        h('h3', { class: 'house-title' }, [p.nickname || p.handle]),
        h('span', { class: 'handle' }, ['@' + p.handle])
      ]),
      badge(p.state),
      h('button', { type: 'button', class: 'ghost', onclick: closeHouse }, ['Close'])
    ]));

    card.appendChild(h('div', { class: 'facts' }, [
      fact('Joined', p.joined === null ? '—' : 'EP ' + p.joined),
      fact('Lot', p.lot === null ? 'none' : '#' + p.lot),
      fact('Comments', fmt(p.comments)),
      fact('Likes', fmt(p.likes)),
      p.job ? fact('Job', p.job.title + ' · since EP ' + p.job.ep) : null
    ]));

    if (p.candidate) {
      card.appendChild(h('p', { class: 'house-note' }, [
        h('span', { class: 'tag' }, ['Candidate']),
        ' Running for deputy mayor with I RUN.'
      ]));
    }

    var customTag = avatarTag(p);
    if (customTag) card.appendChild(h('p', { class: 'avatar-line' }, [customTag]));
    card.appendChild(h('h4', null, ['Their HOUSE request']));
    if (p.state === 'destroyed_basic') {
      card.appendChild(h('p', { class: 'house-note is-bad' }, [
        'Destroyed. Back to a basic house, still theirs.',
        p.custom ? ' Old request: “' + p.custom + '”' : ''
      ]));
    } else if (p.custom) {
      card.appendChild(h('p', { class: 'house-note' }, ['“' + p.custom + '”']));
    } else {
      card.appendChild(h('p', { class: 'house-note is-muted' }, ['Basic house. Comment HOUSE: and your idea to customise it.']));
    }

    card.appendChild(h('h4', null, ['History']));
    var items = p.history.map(historyItem);
    card.appendChild(items.length
      ? h('ol', { class: 'timeline' }, items)
      : h('p', { class: 'muted' }, ['No history recorded yet.']));

    card.appendChild(h('h4', null, ['Share this house']));
    card.appendChild(linkEl);
    card.appendChild(h('div', { class: 'house-actions' }, [copyBtn, status]));
  }

  // ---------- proposals ----------
  function renderEpSwitch() {
    var sel = clear($('ep-select'));
    var eps = uniq(model.proposals.map(epKey).filter(function (v) { return v !== null; }))
      .sort(function (a, b) { return Number(b) - Number(a); });
    if (eps.indexOf(propEp) === -1) propEp = eps.length ? eps[0] : null;
    eps.forEach(function (ep) {
      sel.appendChild(h('option', { value: ep, selected: ep === propEp }, ['Episode ' + ep]));
    });
    sel.disabled = !eps.length;
  }

  function proposalCard(p, t, winId, leadId) {
    var pid = String(p.id);
    var ratioed = p.ratioed === true;
    var isWin = winId === pid && !ratioed;
    var reply = p.top_reply && typeof p.top_reply === 'object' ? p.top_reply : null;
    var head = [h('span', { class: 'type t-' + t }, [t])];
    if (isWin) head.push(h('span', { class: 'win' }, ['Winner']));
    else if (leadId === pid && !ratioed) head.push(h('span', { class: 'lead' }, ['Leading']));
    head.push(h('span', { class: 'likes' }, [fmt(num(p.likes)) + ' likes']));
    return h('article', {
      class: 'prop' + (ratioed ? ' is-ratioed' : '') + (isWin ? ' is-winner' : '')
    }, [
      h('div', { class: 'prop-head' }, head),
      h('p', { class: 'prop-text' }, [text(p.text) || text(p.body) || '(empty)']),
      h('p', { class: 'by' }, ['by @' + (text(p.author) || 'unknown')]),
      t === 'DESTROY' && text(p.target) ? h('p', { class: 'by' }, ['Target: @' + text(p.target)]) : null,
      reply ? h('blockquote', { class: 'reply' }, [
        h('span', { class: 'reply-by' }, ['Top reply · @' + (text(reply.author) || 'unknown') + ' · ' + fmt(num(reply.likes)) + ' likes']),
        text(reply.text)
      ]) : null,
      ratioed ? h('div', { class: 'stamp', role: 'note' }, ["RATIO'D — CANCELLED"]) : null
    ]);
  }

  function renderProposals() {
    var root = clear($('proposals-root'));
    if (!propEp) {
      root.appendChild(empty('No proposals yet. Comment IDEA:, LAW: or DESTROY: under the episode video.'));
      return;
    }
    var rows = model.proposals.filter(function (p) { return epKey(p) === propEp; });
    var winners = obj(obj(model.results[propEp]).winners);
    var winnerOf = {};
    TYPES.forEach(function (t) {
      if (own(winners, t) && winners[t] !== null && winners[t] !== undefined) winnerOf[t] = String(winners[t]);
    });

    var wbox = h('div', { class: 'winners' }, [h('h3', null, ['Winners · Episode ' + propEp])]);
    var anyWinner = false;
    TYPES.forEach(function (t) {
      if (!own(winnerOf, t)) return;
      anyWinner = true;
      var wid = winnerOf[t];
      var w = model.proposals.filter(function (p) { return String(p.id) === wid; })[0];
      wbox.appendChild(h('p', { class: 'winner-line' }, [
        h('span', { class: 'type t-' + t }, [t]),
        h('span', null, [w ? (text(w.text) || text(w.body) || '(empty)') : 'Proposal #' + wid + ' (not in the data)']),
        w ? h('span', { class: 'muted' }, [fmt(num(w.likes)) + ' likes']) : null
      ]));
    });
    if (anyWinner) root.appendChild(wbox);

    var leadOf = {};
    TYPES.forEach(function (t) {
      var best = null;
      rows.forEach(function (p) {
        if (typeOf(p) !== t || p.ratioed === true) return;
        if (!best || num(p.likes) > num(best.likes)) best = p;
      });
      if (best && !own(winnerOf, t)) leadOf[t] = String(best.id);
    });

    TYPES.forEach(function (t) {
      if (own(FROM_EP, t) && Number(propEp) < FROM_EP[t]) return;   // no empty NAME/JAIL headings on ep 1-2
      var items = rows.filter(function (p) { return typeOf(p) === t; })
        .sort(function (a, b) { return num(b.likes) - num(a.likes); });
      root.appendChild(h('h3', { class: 'type-head' }, [t + ' · ' + items.length + (items.length === 1 ? ' proposal' : ' proposals')]));
      if (!items.length) {
        root.appendChild(h('p', { class: 'muted' }, ['No ' + t + ' this episode.']));
        return;
      }
      var row = h('div', { class: 'props' });
      items.forEach(function (p) {
        row.appendChild(proposalCard(p, t, winnerOf[t] || null, leadOf[t] || null));
      });
      root.appendChild(row);
    });
  }

  // ---------- houses grid ----------
  function renderHouses() {
    var f = $('house-filter').value;
    var s = $('house-sort').value;
    var rows = model.players.filter(function (p) { return f === 'all' || p.state === f; });
    rows.sort(function (a, b) {
      if (s === 'newest') {
        var ja = a.joined === null ? -1 : a.joined, jb = b.joined === null ? -1 : b.joined;
        return (jb - ja) || byHandle(a, b);
      }
      if (s === 'az') return byHandle(a, b);
      return (b.likes - a.likes) || byHandle(a, b);
    });
    var shown = rows.slice(0, houseLimit);
    $('house-count').textContent = 'Showing ' + shown.length + ' of ' + rows.length + ' houses';
    var grid = clear($('house-grid'));
    if (!rows.length) grid.appendChild(empty('No house matches this filter.'));
    shown.forEach(function (p) { grid.appendChild(playerCard(p)); });
    $('house-more').hidden = rows.length <= houseLimit;
  }

  // ---------- election ----------
  function renderElection() {
    var rows = model.players.filter(function (p) { return p.candidate; })
      .sort(function (a, b) { return (b.likes - a.likes) || byHandle(a, b); });
    $('candidates').hidden = !rows.length;
    $('candidate-count').textContent = rows.length + (rows.length === 1 ? ' candidate' : ' candidates') + ' · sorted by likes';
    var grid = clear($('candidate-grid'));
    rows.forEach(function (p) { grid.appendChild(playerCard(p)); });
  }

  // ---------- episodes and vote ----------
  // Embed only well-formed ids. The URL pattern mirrors tracker.py; it has no end anchor because urls carry query strings.
  var VIDEO_ID = /^\d{15,25}$/;
  var VIDEO_URL = /^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9_.]+\/video\/(\d{15,25})/;

  function videoId(e) {
    var raw = e.video_id;
    if (raw !== undefined && raw !== null && raw !== '') {
      return typeof raw === 'string' && VIDEO_ID.test(raw) ? raw : null;
    }
    var m = VIDEO_URL.exec(text(e.url));
    return m ? m[1] : null;
  }

  // Click-to-load (CNIL): no iframe, and no TikTok cookies, until the viewer clicks.
  function embed(id, label) {
    var frame = h('div', { class: 'ep-frame', role: 'group', 'aria-label': label + ' on TikTok' });
    var facade = h('div', { class: 'ep-facade' }, [
      h('button', { type: 'button', class: 'btn primary ep-load', onclick: loadVideo }, ['Load the TikTok video']),
      h('p', { class: 'ep-facade-note' }, [
        'Loading it lets TikTok set cookies. See ',
        h('a', { href: 'privacy.html' }, ['Privacy']),
        '.'
      ])
    ]);
    function loadVideo() {
      if (!VIDEO_ID.test(id)) return;
      if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'tiktok-load', title: 'Load TikTok video', event: true });
      var iframe = h('iframe', {
        src: 'https://www.tiktok.com/player/v1/' + id + '?music_info=1&description=1',
        title: label + ' on TikTok',
        allow: 'fullscreen',
        loading: 'lazy',
        referrerpolicy: 'strict-origin-when-cross-origin'
      });
      frame.replaceChild(iframe, facade);
      iframe.focus();
    }
    frame.appendChild(facade);
    return frame;
  }

  function voteChart(ep) {
    var r = obj(model.results[String(ep)]);
    var vote = r.vote && typeof r.vote === 'object' && !Array.isArray(r.vote) ? r.vote : null;
    var keys = vote ? Object.keys(vote).sort() : [];
    if (!keys.length) return null;
    var total = keys.reduce(function (s, k) { return s + num(vote[k]); }, 0);
    var top = keys.reduce(function (best, k) {
      return best === null || num(vote[k]) > num(vote[best]) ? k : best;
    }, null);
    var bars = keys.map(function (k) {
      var n = num(vote[k]);
      var share = total ? n / total : 0;
      var fill = h('span', { class: 'bar-fill' + (k === top && n > 0 ? ' is-top' : '') });
      fill.style.width = (share * 100).toFixed(1) + '%';
      return h('div', { class: 'bar-row' }, [
        h('span', { class: 'bar-label' }, [k]),
        h('span', { class: 'bar-track' }, [fill]),
        h('span', { class: 'bar-val' }, [fmt(n) + ' · ' + Math.round(share * 100) + '%'])
      ]);
    });
    return h('article', { class: 'vote-card' }, [
      h('h3', null, ['Episode ' + ep + ' vote']),
      h('p', { class: 'muted' }, [fmt(total) + ' votes counted: comments that name one option, one vote per player.'])
    ].concat(bars));
  }

  function renderEpisodes() {
    var root = clear($('episode-list'));
    var eps = model.episodes.slice().sort(function (a, b) { return num(b.ep) - num(a.ep); });
    if (!eps.length) root.appendChild(h('li', { class: 'empty' }, ['No episodes yet.']));
    eps.forEach(function (e) {
      var url = tiktokUrl(e.url);
      var id = videoId(e);
      var label = typeof e.ep === 'number' ? 'Episode ' + e.ep : 'Episode';
      var vote = typeof e.ep === 'number' ? voteChart(e.ep) : null;
      root.appendChild(h('li', { class: 'ep-item' }, [
        h('h3', { class: 'ep-title' }, [label]),
        id ? embed(id, label) : null,
        url
          ? h('a', { class: 'ep-link', href: url, target: '_blank', rel: 'noopener' }, ['Watch on TikTok ↗'])
          : h('span', { class: 'muted' }, ['Link not available']),
        vote
      ]));
    });
  }

  // ---------- render all ----------
  function render() {
    renderHero();
    renderEpSwitch();
    renderProposals();
    renderHouses();
    renderElection();
    renderDeputies();
    renderAvatars();
    renderJobs();
    renderHall();
    renderEpisodes();
    renderHouse();
    markSelected();
  }

  // ---------- copy buttons (How to play) ----------
  function setupCopy() {
    document.querySelectorAll('[data-copy-target]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var el = $(btn.getAttribute('data-copy-target'));
        if (!el) return;
        var value = el.textContent;
        var status = $('copy-status');
        var fallback = function () {
          selectNode(el);
          status.textContent = 'Selected. Press Ctrl+C (or Cmd+C) to copy.';
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(function () {
            status.textContent = 'Copied: ' + value;
          }, fallback);
        } else {
          fallback();
        }
      });
    });
  }

  // ---------- loading ----------
  function getJson(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function () { return null; });
  }

  function load() {
    var updated = $('updated');
    var error = $('load-error');
    var retry = $('load-retry');
    error.hidden = true;
    retry.disabled = true;
    updated.setAttribute('aria-busy', 'true');
    updated.textContent = 'Loading the town…';
    getJson('data/town.json')
      .then(function (raw) {
        if (raw) return { raw: raw, sample: false };
        return getJson('data/sample-town.json').then(function (s) { return s ? { raw: s, sample: true } : null; });
      })
      .then(function (src) {
        updated.setAttribute('aria-busy', 'false');
        retry.disabled = false;
        if (!src) { error.hidden = false; updated.textContent = 'The town data is unavailable.'; return; }
        try {
          model = normalize(src.raw);
          $('banner').hidden = !src.sample;
          render();
          fromHash(true);
        } catch (e) {
          error.hidden = false;
          updated.textContent = 'The town data could not be read.';
        }
      });
  }

  function init() {
    setupTheme();
    // privacy.html and legal.html load this script too: they only need the theme toggle.
    if (!$('find-form')) return;
    // Reduced motion never fades in the second hero photo, so drop it instead of leaving a hidden image in the page.
    var alt = document.querySelector('.room-photo-alt');
    if (alt && reduced) alt.parentNode.removeChild(alt);
    $('find-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var first = $('results').querySelector('.result-btn');
      if (first) first.click();
    });
    $('find').addEventListener('input', renderResults);
    $('find').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { $('results').hidden = true; }
    });
    $('ep-select').addEventListener('change', function () {
      propEp = this.value;
      renderProposals();
    });
    $('house-filter').addEventListener('change', function () { houseLimit = PAGE; renderHouses(); });
    $('house-sort').addEventListener('change', function () { houseLimit = PAGE; renderHouses(); });
    $('house-more').addEventListener('click', function () { houseLimit += PAGE; renderHouses(); });
    $('load-retry').addEventListener('click', load);
    window.addEventListener('hashchange', function () { fromHash(true); });
    setupCopy();
    load();
  }

  // ---------- theme toggle ----------
  // The stored choice lives in localStorage ('theme'); with none, the OS setting applies.
  function setupTheme() {
    var btn = $('theme-toggle');
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function isDark() {
      var t = document.documentElement.getAttribute('data-theme');
      return t ? t === 'dark' : !!(mq && mq.matches);
    }
    function paint() {
      var dark = isDark();
      btn.classList.toggle('is-dark', dark);
      btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    }
    btn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* storage blocked: the choice lasts for this page only */ }
      paint();
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', paint);
    btn.hidden = false;
    paint();
  }

  init();
})();
