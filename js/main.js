/* DVMotion
   Minimal CEP bridge, no CSInterface.js dependency. */

var CEP = window.__adobe_cep__;

function extPath() {
  var p = decodeURI(CEP.getSystemPath('extension'));
  return p.replace(/^file:\/{2,3}/, '').replace(/^\/([A-Za-z]:)/, '$1');
}

function evalScript(code, cb) {
  CEP.evalScript(code, cb || function () {});
}

var VERSION = '1.56';
var ROOT = extPath();

/* Disk path -> a file:// URL the browser can load.
   A bare "C:/Users/..." cannot go into src: Chromium reads "C:" as a scheme.
   Spaces have to be percent-encoded too. */
function fileURL(rel) {
  var p = (ROOT + '/' + rel).replace(/\\/g, '/');
  if (p.charAt(0) !== '/') p = '/' + p;
  return encodeURI('file://' + p);
}

function readFile(path) {
  try {
    var r = window.cep.fs.readFile(path);
    if (r.err) return null;
    return r.data;
  } catch (e) { return null; }
}

function writeFile(path, data) {
  try {
    var r = window.cep.fs.writeFile(path, data);
    return !r || !r.err;
  } catch (e) { return false; }
}

/* Last-modified time of a file, or 0 when it cannot be read */
function mtimeOf(rel) {
  try {
    var r = window.cep.fs.stat(ROOT + '/' + rel);
    if (r.err || !r.data) return 0;
    var m = r.data.mtime;
    return m ? (new Date(m)).getTime() || Number(m) || 0 : 0;
  } catch (e) { return 0; }
}

/*  Settings live outside the extension folder.

    They used to sit next to index.html, which meant every update wiped the
    Telegram session and the sign-in had to be done again. This puts them in the
    user data folder, where replacing the extension cannot touch them. */
function dataDir() {
  try {
    var os = require('os');
    var fsn = require('fs');

    var base = process.env.APPDATA;
    if (!base) {
      base = (process.platform === 'darwin')
        ? os.homedir() + '/Library/Application Support'
        : os.homedir() + '/.config';
    }

    var dir = (base + '/DVMotion').replace(/\\/g, '/');
    if (!fsn.existsSync(dir)) fsn.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (e) {
    return ROOT;             // no Node: fall back to the old location
  }
}

var DATA_DIR = dataDir();
var SETTINGS_PATH = DATA_DIR + '/settings.json';

function listDir(rel) {
  try {
    var r = window.cep.fs.readdir(ROOT + '/' + rel);
    return (r.err || !r.data) ? [] : r.data;
  } catch (e) { return []; }
}

/* Project folder names, editable in the settings panel and saved to
   settings.json. Passed to ExtendScript as "root|titles|emoji|cta|precomps". */
/*  Folder names are fixed. They were editable for a while, but the only thing
    that ever changed was the chance of two projects disagreeing about where
    things live. */
var CFG = {
  root:'DVMotion', titles:'Titles', emoji:'Emoji', cta:'CTA', precomps:'Precomps',
  tgToken:'', tgChat:'', omTpl:'', rsTpl:'', outDir:'',
  apiBase:'', apiId:'', apiHash:'',
  mtPhone:'', mtTarget:'', mtSession:''
};

function folderSpec() {
  return [CFG.root, CFG.titles, CFG.emoji, CFG.cta, CFG.precomps].join('|');
}

function loadCfg() {
  var raw = readFile(SETTINGS_PATH);

  // One-time move from the old spot inside the extension folder
  if (!raw) {
    var old = readFile(ROOT + '/settings.json');
    if (old) {
      writeFile(SETTINGS_PATH, old);
      raw = old;
    }
  }
  if (!raw) return;
  try {
    var o = JSON.parse(raw);
    for (var k in CFG_FIELDS) { if (o[k]) CFG[k] = String(o[k]); }
    if (o.mtSession) CFG.mtSession = String(o.mtSession);
  } catch (e) {}
}

function saveCfg() {
  return writeFile(SETTINGS_PATH, JSON.stringify(CFG, null, 2));
}

var MODE = 'both';
var LIB = [];
var PREVIEWS = [];
var SHARED_CTL = null;
var selected = null;
var selectedKind = 'preset';

var $grid = document.getElementById('grid');
var $search = document.getElementById('search');
var $ver = document.getElementById('ver');
var $size = document.getElementById('size');
var $toasts = document.getElementById('toasts');
var $dur = document.getElementById('dur');
var $ctaY = document.getElementById('ctaY');
var $useLayerDur = document.getElementById('useLayerDur');
var $markers = document.getElementById('markers');
var $unpack = document.getElementById('unpack');

/* ---------- toast ---------- */

var ICONS = {
  ok:  'M8 15A7 7 0 108 1a7 7 0 000 14zm-.9-3.6L3.6 7.9l1.3-1.3 2.2 2.2 4.1-4.1 1.3 1.3-5.4 5.4z',
  err: 'M15.6 13.1L8.9 1.4a1 1 0 00-1.8 0L.4 13.1A1 1 0 001.3 15h13.4a1 1 0 00.9-1.9zM8.9 13H7.1v-1.8h1.8V13zm0-3H7.1V5.2h1.8V10z',
  info:'M8 1a7 7 0 100 14A7 7 0 008 1zm.9 11H7.1V7h1.8v5zm0-6.2H7.1V4h1.8v1.8z'
};

function toast(msg, kind) {
  var k = (kind === 'ok' || kind === 'err') ? kind : 'info';

  // Spectrum: only one toast on screen at a time
  while ($toasts.firstChild) $toasts.removeChild($toasts.firstChild);

  var el = document.createElement('div');
  el.className = 'toast toast--' + k;

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'toast-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[k]);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);

  var txt = document.createElement('div');
  txt.className = 'toast-text';
  txt.textContent = msg;
  txt.title = msg;

  var sep = document.createElement('span');
  sep.className = 'toast-sep';

  var close = document.createElement('button');
  close.className = 'toast-close';
  close.innerHTML = '&#10005;';
  close.title = 'Dismiss';

  el.appendChild(svg);
  el.appendChild(txt);
  el.appendChild(sep);
  el.appendChild(close);
  $toasts.appendChild(el);

  var timer = null;
  function dismiss() {
    if (timer) clearTimeout(timer);
    el.classList.add('is-out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 160);
  }
  close.addEventListener('click', dismiss);

  // Errors stay until dismissed. One that vanishes after four seconds is one
  // you end up debugging blind.
  if (k !== 'err') timer = setTimeout(dismiss, 3000);
}

var LOG_PATH = DATA_DIR + '/render.log';

/* The panel writes to the same file render.js uses, so a failure and whatever
   led up to it end up in one place. */
function logLine(line) {
  try {
    var stamp = new Date().toTimeString().slice(0, 8);
    var old = readFile(LOG_PATH) || '';
    writeFile(LOG_PATH, old + stamp + '  ' + line + '\n');
  } catch (e) {}
}

/* Results and errors are reported through the toast only */
function say(msg, kind) {
  if (kind === 'ok' || kind === 'err') toast(msg, kind);
  if (kind === 'err') logLine('ERROR  ' + msg);
}

/* ---------- library ---------- */

var VID_RE = /\.(mp4|webm|mov|m4v)$/i;

/* Finds the still and the clip matching this base name in previews/ */
function findPreviewSet(base) {
  var b = base.toLowerCase();
  var set = { img: null, vid: null };
  for (var i = 0; i < PREVIEWS.length; i++) {
    var f = PREVIEWS[i];
    if (f.replace(/\.[^.]+$/, '').toLowerCase() !== b) continue;
    if (VID_RE.test(f)) { if (!set.vid) set.vid = 'previews/' + f; }
    else { if (!set.img) set.img = 'previews/' + f; }
  }
  return set;
}

/* Anything set by hand wins */
function attachPreview(it, base) {
  var set = findPreviewSet(base);
  if (!it.preview && set.img) it.preview = set.img;
  if (!it.previewVideo && set.vid) it.previewVideo = set.vid;
}

function pretty(s) { return s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function byLabel(a, b) { return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1; }

/* One .aep can hold a single composition, or many.
   A sidecar "<name>.json" with a "comps" array turns it into one card per
   composition - the Scan bundles button writes that file for you. */
function scanAeps(dir, title, used) {
  var items = [];

  listDir(dir).forEach(function (f) {
    if (!/\.aepx?$/i.test(f)) return;
    var path = dir + '/' + f;
    if (used[path.toLowerCase()]) return;
    var base = f.replace(/\.aepx?$/i, '');

    var comps = null;
    var side = readFile(ROOT + '/' + dir + '/' + base + '.json');
    if (side) {
      try {
        var o = JSON.parse(side);
        if (o.comps && o.comps.length) comps = o.comps;
      } catch (e) {
        say(dir + '/' + base + '.json error: ' + e.message, 'err');
      }
    }

    if (comps) {
      comps.forEach(function (name) {
        var it = { label: pretty(name), file: path, comp: name, bundle: base };
        attachPreview(it, name);
        items.push(it);
      });
    } else {
      var one = { label: pretty(base), file: path, comp: base };
      attachPreview(one, base);
      items.push(one);
    }
  });

  if (!items.length) return [];
  var type = (dir === 'emoji') ? 'emoji' : (dir === 'texts') ? 'texts' : 'titles';
  return [{ name: title, type: type, items: items.sort(byLabel) }];
}

/* Picks up any file the library.json does not already list */
function autoScan(used) {
  var cats = [], k;

  // --- presets/*.ffx  ("Name_IN.ffx" / "Name_OUT.ffx") ---
  var groups = {};
  listDir('presets').forEach(function (f) {
    if (!/\.ffx$/i.test(f)) return;
    var path = 'presets/' + f;
    if (used[path.toLowerCase()]) return;
    var m = /^(.*)_(IN|OUT)\.ffx$/i.exec(f);
    var base = m ? m[1] : f.replace(/\.ffx$/i, '');
    var kind = m ? m[2].toLowerCase() : 'in';
    if (!groups[base]) groups[base] = { label: pretty(base), duration: 1 };
    if (!m) groups[base].single = true;   // no _IN / _OUT suffix -> marker-driven preset
    groups[base][kind] = path;
  });

  var items = [];
  for (k in groups) {
    if (!groups.hasOwnProperty(k)) continue;
    attachPreview(groups[k], k);

    // Sidecar: presets/<name>.json or presets/<name>.ffx.json
    var side = readFile(ROOT + '/presets/' + k + '.json') ||
               readFile(ROOT + '/presets/' + k + '.ffx.json');
    if (side) {
      try {
        var extra = JSON.parse(side);
        for (var key in extra) {
          if (extra.hasOwnProperty(key)) groups[k][key] = extra[key];
        }
      } catch (e) {
        say('presets/' + k + '.json error: ' + e.message, 'err');
      }
    }

    // Shared presets/controls.json - "*" applies to every preset without its own
    if (!groups[k].controls && SHARED_CTL) {
      groups[k].controls = SHARED_CTL[k] || SHARED_CTL['*'] || null;
    }
    items.push(groups[k]);
  }
  if (items.length) cats.push({ name: 'My Presets', items: items.sort(byLabel) });

  // --- titles/*.aep and emoji/*.aep ---
  cats = cats.concat(scanAeps('titles', 'My Titles', used));
  cats = cats.concat(scanAeps('texts', 'Text Anims', used));
  cats = cats.concat(scanAeps('emoji', 'Emoji', used));

  // --- cta/*.mov ---
  var citems = [];
  listDir('cta').forEach(function (f) {
    if (!/\.(mov|mp4|m4v|avi|mkv|webm)$/i.test(f)) return;
    var path = 'cta/' + f;
    if (used[path.toLowerCase()]) return;
    var base = f.replace(/\.[^.]+$/, '');
    var it = { label: pretty(base), file: path };
    attachPreview(it, base);
    citems.push(it);
  });
  if (citems.length) cats.push({ name: 'CTA', type: 'cta', items: citems.sort(byLabel) });

  return cats;
}

/* Bundles are read automatically. A .aep with no sidecar list is opened once,
   its composition names are written next to it, and the panel reloads. Files
   that fail are not retried in this session. */
var SCAN_TRIED = {};

function bundleJobs() {
  var jobs = [];
  ['titles', 'texts', 'emoji'].forEach(function (dir) {
    listDir(dir).forEach(function (f) {
      if (!/\.aepx?$/i.test(f)) return;
      var base = f.replace(/\.[^.]+$/, '');
      var key = dir + '/' + base;
      if (SCAN_TRIED[key]) return;

      // A stored mtime lets an edited bundle re-read itself, so adding a
      // composition to an .aep does not mean remembering to press Rescan.
      var raw = readFile(ROOT + '/' + dir + '/' + base + '.json');
      if (raw) {
        var now = mtimeOf(dir + '/' + f);
        try {
          var o = JSON.parse(raw);
          var unchanged = (!now || (o.mtime && Math.abs(o.mtime - now) < 1000));

          // Emoji are rendered from their own comps, so a listed emoji with no
          // thumbnail is a reason to open the file again even if it has not
          // changed.
          var needPreview = false;
          if ((dir === 'emoji' || dir === 'texts') && o.comps) {
            for (var i = 0; i < o.comps.length; i++) {
              if (!findPreviewSet(o.comps[i]).img) { needPreview = true; break; }
            }
          }
          if (unchanged && !needPreview) return;
        } catch (e) { /* unreadable list - read the file again */ }
      }
      jobs.push({ dir: dir, file: f, base: base, key: key });
    });
  });
  return jobs;
}

function scanBundles(jobs, done) {
  var ok = 0, bad = 0;

  function next(i) {
    if (i >= jobs.length) return done(ok, bad);
    var j = jobs[i];
    SCAN_TRIED[j.key] = true;
    var kind = (j.dir === 'emoji') ? 'emoji' : 'titles';

    // Only emoji get generated thumbnails; a title is a wide layout that reads
    // fine as a name, and rendering every one of them would be slow.
    var pv = (kind === 'emoji' || kind === 'texts') ? q(ROOT + '/previews') : '';

    evalScript('bd_scanBundle("' + q(ROOT + '/' + j.dir + '/' + j.file) + '","' + kind +
               '","' + esc(folderSpec()) + '","' + pv + '")', function (res) {
      if (res && res.indexOf('OK:') === 0) {
        var names = res.slice(3).split('|');
        var rec = { comps: names, mtime: mtimeOf(j.dir + '/' + j.file) };
        if (writeFile(ROOT + '/' + j.dir + '/' + j.base + '.json',
                      JSON.stringify(rec, null, 2))) ok++;
        else bad++;
      } else {
        bad++;
      }
      next(i + 1);
    });
  }
  next(0);
}

function loadShared() {
  SHARED_CTL = null;
  var raw = readFile(ROOT + '/presets/controls.json');
  if (!raw) return;
  try { SHARED_CTL = JSON.parse(raw); }
  catch (e) { say('presets/controls.json error: ' + e.message, 'err'); }
}

function loadLibrary() {
  PREVIEWS = listDir('previews');
  loadCfg();
  loadShared();

  var json = [];
  var raw = readFile(ROOT + '/presets/library.json');
  if (raw) {
    try {
      json = JSON.parse(raw).categories || [];
    } catch (e) {
      say('library.json error: ' + e.message, 'err');
    }
  }

  // remember hand-written entries so the auto scan does not duplicate them
  var used = {};
  json.forEach(function (c) {
    (c.items || []).forEach(function (it) {
      ['in', 'out', 'file'].forEach(function (key) {
        if (it[key]) used[String(it[key]).toLowerCase()] = true;
      });
    });
  });

  LIB = json.concat(autoScan(used));

  if (LIB.length) {
    render($search ? $search.value : '');
  } else {
    $grid.innerHTML =
      '<div class="empty">Nothing here yet.<br>' +
      'Drop .ffx into <b>presets/</b>, .aep into <b>titles/</b>' +
      ' or <b>emoji/</b>,<br>.mov into <b>cta/</b>, then hit \u21bb.</div>';
  }

  // Any .aep still without a list gets read in the background, then we redraw
  var jobs = bundleJobs();
  if (jobs.length) {
    scanBundles(jobs, function (ok, bad) {
      if (ok) loadLibrary();
      if (bad) say(bad + ' .aep file(s) could not be read.', 'err');
    });
  }
}

/* ---------- rendering ---------- */

/* Section order is the user's, saved between sessions. Unknown sections keep
   their natural position at the end. */
function orderedLib() {
  var order = [];
  try { order = JSON.parse(localStorage.getItem('bd_catOrder') || '[]'); } catch (e) {}

  var idx = {};
  order.forEach(function (n, i) { idx[n] = i; });

  var out = LIB.slice();
  out.sort(function (a, b) {
    var ia = (idx[a.name] === undefined) ? 1000 + LIB.indexOf(a) : idx[a.name];
    var ib = (idx[b.name] === undefined) ? 1000 + LIB.indexOf(b) : idx[b.name];
    return ia - ib;
  });
  return out;
}

function saveOrder() {
  var names = [];
  var secs = $grid.querySelectorAll('.sect');
  for (var i = 0; i < secs.length; i++) names.push(secs[i].getAttribute('data-cat'));
  try { localStorage.setItem('bd_catOrder', JSON.stringify(names)); } catch (e) {}
}

var DRAG = null;

function render(filter) {
  filter = (filter || '').toLowerCase();
  $grid.innerHTML = '';
  var shown = 0;

  orderedLib().forEach(function (cat) {
    var items = (cat.items || []).filter(function (it) {
      return !filter || it.label.toLowerCase().indexOf(filter) !== -1;
    });
    if (!items.length) return;

    var sec = document.createElement('section');
    sec.className = 'sect';
    sec.setAttribute('data-cat', cat.name);

    var head = document.createElement('div');
    head.className = 'cat';
    head.draggable = true;
    head.title = 'Drag to reorder';

    var grip = document.createElement('span');
    grip.className = 'grip';
    grip.textContent = '\u22ee\u22ee';

    var label = document.createElement('span');
    label.textContent = cat.name;

    head.appendChild(grip);
    head.appendChild(label);

    var cards = document.createElement('div');
    cards.className = 'cards';
    items.forEach(function (it) {
      cards.appendChild(card(it, cat));
      shown++;
    });

    head.addEventListener('dragstart', function (e) {
      DRAG = sec;
      sec.classList.add('is-dragging');
      try { e.dataTransfer.setData('text/plain', cat.name); } catch (e2) {}
      e.dataTransfer.effectAllowed = 'move';
    });
    head.addEventListener('dragend', function () {
      sec.classList.remove('is-dragging');
      clearDropMarks();
      DRAG = null;
    });

    sec.addEventListener('dragover', function (e) {
      if (!DRAG || DRAG === sec) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var box = sec.getBoundingClientRect();
      var after = (e.clientY - box.top) > box.height / 2;
      clearDropMarks();
      sec.classList.add(after ? 'drop-after' : 'drop-before');
    });
    sec.addEventListener('drop', function (e) {
      if (!DRAG || DRAG === sec) return;
      e.preventDefault();
      var box = sec.getBoundingClientRect();
      var after = (e.clientY - box.top) > box.height / 2;
      $grid.insertBefore(DRAG, after ? sec.nextSibling : sec);
      clearDropMarks();
      saveOrder();
    });

    sec.appendChild(head);
    sec.appendChild(cards);
    $grid.appendChild(sec);
  });

  if (!shown) $grid.innerHTML = '<div class="empty">No match.</div>';
}

function clearDropMarks() {
  var secs = $grid.querySelectorAll('.sect');
  for (var i = 0; i < secs.length; i++) {
    secs[i].classList.remove('drop-before', 'drop-after');
  }
}

/* Neither crop nor shrink: the card takes the preview's own aspect ratio,
   clamped so extreme shapes stay reasonable. */
function fitAspect(node, w, h) {
  if (!w || !h) return;
  var r = w / h;
  if (r < 0.55) r = 0.55;
  if (r > 2.4) r = 2.4;
  node.style.aspectRatio = r.toFixed(4) + ' / 1';
}

function card(it, cat) {
  var kind = (cat && cat.type) || 'preset';
  var isTitle = kind === 'titles';

  var el = document.createElement('div');
  el.className = 'card' +
                 (isTitle ? ' card--title' : '') +
                 (kind === 'cta' ? ' card--cta' : '') +
                 (kind === 'emoji' ? ' card--emoji' : '');

  // preview: the clip plays on hover, the still sits on top of it
  var vidSrc = it.previewVideo || (VID_RE.test(it.preview || '') ? it.preview : null);
  var imgSrc = (it.preview && !VID_RE.test(it.preview)) ? it.preview : null;

  function letterTile() {
    var d = document.createElement('div');
    d.className = 'thumb thumb--empty';
    d.textContent = it.label.charAt(0).toUpperCase();
    return d;
  }
  function swapToLetter(node) {
    if (node && node.parentNode) node.parentNode.replaceChild(letterTile(), node);
  }

  var thumb;

  if (vidSrc) {
    thumb = document.createElement('div');
    thumb.className = 'thumb thumbwrap';

    var vid = document.createElement('video');
    vid.className = 'media';
    vid.src = fileURL(vidSrc);
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    vid.addEventListener('loadedmetadata', function () {
      fitAspect(thumb, vid.videoWidth, vid.videoHeight);
    });
    vid.addEventListener('error', function () { swapToLetter(thumb); });
    thumb.appendChild(vid);

    // Layering the still means it returns the instant the pointer leaves
    var cover = null;
    if (imgSrc) {
      cover = document.createElement('img');
      cover.className = 'media cover';
      cover.src = fileURL(imgSrc);
      cover.addEventListener('load', function () {
        if (kind !== 'emoji') fitAspect(thumb, cover.naturalWidth, cover.naturalHeight);
      });
      cover.addEventListener('error', function () {
        if (cover.parentNode) cover.parentNode.removeChild(cover);
        cover = null;
      });
      thumb.appendChild(cover);
    }

    el.addEventListener('mouseenter', function () {
      if (cover) cover.style.opacity = '0';
      var pr = vid.play();
      if (pr && pr['catch']) pr['catch'](function () {});
    });
    el.addEventListener('mouseleave', function () {
      vid.pause();
      if (cover) {
        cover.style.opacity = '1';
        try { vid.currentTime = 0; } catch (e) {}
      } else {
        try { vid.load(); } catch (e) {}   // no still - rewind to the first frame
      }
    });

  } else if (imgSrc) {
    thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = fileURL(imgSrc);
    thumb.addEventListener('load', function () {
      if (kind !== 'emoji') fitAspect(thumb, thumb.naturalWidth, thumb.naturalHeight);
    });
    thumb.addEventListener('error', function () { swapToLetter(thumb); });

  } else {
    thumb = letterTile();
  }

  var name = document.createElement('b');
  name.textContent = it.label;

  el.appendChild(thumb);
  el.appendChild(name);

  el.addEventListener('click', function () {
    var prev = $grid.querySelector('.card.is-sel');
    if (prev) prev.classList.remove('is-sel');
    el.classList.add('is-sel');
    selected = it;
    selectedKind = kind;
    if (kind === 'preset' && it.duration) $dur.value = it.duration;
  });

  el.addEventListener('dblclick', function () { run(it, kind); });
  el.title = (kind === 'preset') ? 'Double-click to apply' : 'Double-click to insert';

  return el;
}

/* ---------- actions ---------- */

/* Path -> forward slashes, quotes escaped */
function q(s) { return String(s).replace(/\\/g, '/').replace(/"/g, '\\"'); }

/* Plain string for an ExtendScript literal - backslashes must survive */
function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

/* {"Bounce Freq": 2, ...}  ->  "Bounce Freq=2|..."  */
function ctlSpec(c) {
  if (!c) return '';
  var out = [];
  if (c instanceof Array) {
    c.forEach(function (o) {
      if (o && o.name) out.push(o.name + '=' + (o.value !== undefined ? o.value : 0));
    });
  } else {
    for (var k in c) { if (c.hasOwnProperty(k)) out.push(k + '=' + c[k]); }
  }
  return out.join('|');
}

function reply(res) {
  if (res && res.indexOf('OK:') === 0) say(res.slice(3), 'ok');
  else say(res || 'No reply - host.jsx did not load.', 'err');
}

function run(it, kind) {
  if (kind === 'titles' || kind === 'emoji' || kind === 'texts') {
    return insertTitle(it, kind);
  }
  if (kind === 'cta') return insertCTA(it);
  return apply(it);
}

/* Two calls on purpose: After Effects will not copy a parented layer while the
   import's undo group from the same evaluation is still on the stack. */
function insertTitle(it, kind) {
  if (!it.file) return say(it.label + ': no "file" given.', 'err');

  var unpack = ($unpack.checked && it.unpack !== false) ? 'true' : 'false';
  var base = it.file.replace(/^.*[\/]/, '').replace(/\.[^.]+$/, '');
  var wanted = it.comp || base;
  var spec = esc(folderSpec());

  evalScript('bd_prepareTitle("' + q(ROOT + '/' + it.file) + '","' + esc(wanted) + '","' +
             (kind || 'titles') + '","' + spec + '")',
    function (res) {
      if (!res || res.indexOf('OK:') !== 0) {
        return say(res || 'No reply - host.jsx did not load.', 'err');
      }
      // "<target comp id>|<resolved comp name>"
      var payload = res.slice(3);
      var cut = payload.indexOf('|');
      var targetId = (cut < 0) ? '' : payload.slice(0, cut);
      var name = (cut < 0) ? payload : payload.slice(cut + 1);

      /*  Only text anims are copied. They carry their own words, so two on the
          timeline have to be able to say different things. An emoji has no
          text to diverge - copying it just leaves "money fly 2" in the
          project for no reason. */
      var dupe = $dupe.checked && (kind === 'texts');

      evalScript('bd_placeTitle("' + esc(targetId) + '","' + esc(name) + '",' +
                 unpack + ',"' + spec + '",' +
                 ($mFps.checked ? 'true' : 'false') + ',' +
                 ($mSize.checked ? 'true' : 'false') + ',' +
                 ($mCollapse.checked ? 'true' : 'false') + ',' +
                 (dupe ? 'true' : 'false') + ')', reply);
    });
}

function insertCTA(it) {
  if (!it.file) return say(it.label + ': no "file" given.', 'err');
  var y = (it.offsetY !== undefined) ? it.offsetY : (parseFloat($ctaY.value) || 0);
  var sc = it.scale || 0;
  evalScript('bd_insertCTA("' + q(ROOT + '/' + it.file) + '",' + y + ',' + sc +
             ',"' + esc(folderSpec()) + '")', reply);
}

function apply(it) {
  var dur = ($useLayerDur.checked && it.duration)
    ? it.duration
    : (parseFloat($dur.value) || 1);

  var pIn = it['in'] ? ROOT + '/' + it['in'] : '';
  var pOut = it.out ? ROOT + '/' + it.out : '';

  // A single .ffx with no _IN / _OUT suffix holds both directions and is driven
  // by markers, so it goes down once at the layer start and gets both markers.
  var mode = MODE, mkMode = MODE;
  if (it.single) { mode = 'in'; mkMode = 'both'; }

  if (mode === 'in' && !pIn) return say(it.label + ': no IN preset.', 'err');
  if (mode === 'out' && !pOut) return say(it.label + ': no OUT preset.', 'err');

  var mk = $markers.checked ? 'true' : 'false';
  evalScript('bd_apply("' + q(pIn) + '","' + q(pOut) + '","' + mode + '",' +
             dur + ',' + mk + ',"' + mkMode + '","' + esc(ctlSpec(it.controls)) + '")', reply);
}

/* ---------- controls ---------- */

$search.addEventListener('input', function () { render(this.value); });

document.getElementById('markBtn').addEventListener('click', function () {
  var dur = parseFloat($dur.value) || 1;
  evalScript('bd_markSelected(' + dur + ',"' + MODE + '")', reply);
});

document.getElementById('refresh').addEventListener('click', function () {
  selected = null;
  loadLibrary();
  say('Library reloaded.', 'ok');
});

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || !selected) return;
  var t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;  // not while typing
  run(selected, selectedKind);
});

/* The browser's own context menu (Back / Print / View source) is noise here */
document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

/* ---------- settings ---------- */

var $settings = document.getElementById('settings');
var $mFps = document.getElementById('mFps');
var $mSize = document.getElementById('mSize');
var $mCollapse = document.getElementById('mCollapse');
var $fitSize = document.getElementById('fitSize');
var $dupe = document.getElementById('dupe');
var $useAccount = document.getElementById('useAccount');
var $mtState = document.getElementById('mtState');
var CFG_FIELDS = {
  tgToken:'tgToken', tgChat:'tgChat', omTpl:'omTpl', rsTpl:'rsTpl', outDir:'outDir',
  apiBase:'apiBase', apiId:'apiId', apiHash:'apiHash',
  mtPhone:'mtPhone', mtTarget:'mtTarget'
};

function cfgToForm() {
  for (var k in CFG_FIELDS) {
    if (CFG_FIELDS.hasOwnProperty(k)) document.getElementById(CFG_FIELDS[k]).value = CFG[k];
  }
}
function formToCfg() {
  for (var k in CFG_FIELDS) {
    if (CFG_FIELDS.hasOwnProperty(k)) {
      CFG[k] = document.getElementById(CFG_FIELDS[k]).value.trim();
    }
  }
}

document.getElementById('gear').addEventListener('click', function () {
  openPanel($settings.hidden ? 'settings' : null);
});
document.getElementById('closeCfg').addEventListener('click', function () {
  openPanel(null);
});
document.getElementById('saveCfg').addEventListener('click', function () {
  formToCfg();
  var okSave = saveCfg();
  say(okSave ? 'Folder names saved.' : 'Could not write settings.json.', okSave ? 'ok' : 'err');
});
document.getElementById('testTg').addEventListener('click', function () {
  formToCfg();
  if (typeof BDRender === 'undefined' || !BDRender.hasNode) {
    return say('Node is off - add --enable-nodejs to the manifest.', 'err');
  }
  BDRender.test(CFG.tgToken, CFG.tgChat, function (err) {
    say(err ? ('Telegram: ' + err) : 'Telegram reached - check your chat.',
        err ? 'err' : 'ok');
  }, CFG.apiBase);
});

document.getElementById('tidyBtn').addEventListener('click', function () {
  formToCfg();
  evalScript('bd_tidy("' + esc(folderSpec()) + '")', reply);
});

/* Imports every .aep once, files it away, and writes the sidecar list so a
   bundle shows up as one card per composition. */
/* Forces a re-read, e.g. after adding a composition to an existing bundle */
document.getElementById('scanBtn').addEventListener('click', function () {
  formToCfg();
  SCAN_TRIED = {};

  var jobs = [];
  ['titles', 'texts', 'emoji'].forEach(function (dir) {
    listDir(dir).forEach(function (f) {
      if (!/\.aepx?$/i.test(f)) return;
      var base = f.replace(/\.[^.]+$/, '');
      jobs.push({ dir: dir, file: f, base: base, key: dir + '/' + base });
    });
  });
  if (!jobs.length) return say('No .aep files in titles/ or emoji/.', 'err');

  scanBundles(jobs, function (ok, bad) {
    loadLibrary();
    say('Read ' + ok + ' file(s)' + (bad ? ', ' + bad + ' failed' : '') + '.', bad ? 'err' : 'ok');
  });
});

/* Checkbox states persist - precomp mode in particular is a workflow choice,
   not something to re-pick every session. */
var TOGGLES = {
  bd_markers: $markers,
  bd_unpack2: $unpack,
  bd_presetDur: $useLayerDur,
  bd_mFps: $mFps,
  bd_mSize: $mSize,
  bd_mCollapse: $mCollapse,
  bd_fitSize: $fitSize,
  bd_useAccount: $useAccount,
  bd_dupe: $dupe
};

(function () {
  for (var key in TOGGLES) {
    if (!TOGGLES.hasOwnProperty(key)) continue;
    var box = TOGGLES[key];
    try {
      var v = localStorage.getItem(key);
      if (v !== null) box.checked = (v === '1');
    } catch (e) {}
    box.addEventListener('change', (function (k, b) {
      return function () { try { localStorage.setItem(k, b.checked ? '1' : '0'); } catch (e) {} };
    })(key, box));
  }
})();

/* ---------- log ---------- */

var $logView = document.getElementById('logView');
var $logPanel = document.getElementById('logPanel');
var $prog = document.getElementById('prog');
var $progLabel = document.getElementById('progLabel');
var $progFill = document.getElementById('progFill');

/* pct < 0 hides the bar */
function progress(label, pct) {
  if (pct < 0) { $prog.hidden = true; return; }
  $prog.hidden = false;
  $progLabel.textContent = label;
  $progFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

/* Colour by what the line says, so a failure is visible without reading. */
function logClass(text) {
  if (/^---/.test(text))                                  return 'l-head';
  if (/ERROR|FAILED|failed|not found|stalled|mismatch/i.test(text)) return 'l-err';
  if (/\bok\b|uploaded|signed in|done|finished|sent/i.test(text)) return 'l-ok';
  if (/too large|not on PATH|no error|warning/i.test(text)) return 'l-warn';
  if (/^(aerender|args|compressing|output file):/i.test(text)) return 'l-cmd';
  return '';
}

function showLog() {
  var raw = readFile(LOG_PATH) || '';

  // Only the tail is useful, and a few thousand lines would make the panel crawl
  var lines = raw.replace(/\s+$/, '').split('\n');
  if (lines.length > 300) lines = lines.slice(lines.length - 300);

  $logView.innerHTML = '';

  lines.forEach(function (line) {
    if (!line) return;

    var row = document.createElement('span');
    row.className = 'log-line';

    // "12:04:31  message"
    var m = /^(\d\d:\d\d:\d\d)\s\s?(.*)$/.exec(line);
    var body = line;

    if (m) {
      var t = document.createElement('span');
      t.className = 't';
      t.textContent = m[1] + '  ';
      row.appendChild(t);
      body = m[2];
    }

    var rest = document.createElement('span');
    rest.className = logClass(body);
    rest.textContent = body;
    row.appendChild(rest);

    $logView.appendChild(row);
  });

  $logView.scrollTop = $logView.scrollHeight;
}

/* One overlay at a time: opening either closes the other. */
function openPanel(which) {
  $settings.hidden = (which !== 'settings');
  $logPanel.hidden = (which !== 'log');
  if (which === 'settings') cfgToForm();
  if (which === 'log') showLog();
}

document.getElementById('logBtn').addEventListener('click', function () {
  openPanel($logPanel.hidden ? 'log' : null);
});

document.getElementById('closeLog').addEventListener('click', function () {
  openPanel(null);
});

/* ---------- signing in as yourself ---------- */

function mtSay(msg, kind) {
  $mtState.textContent = msg;
  $mtState.className = 'mt-state' + (kind ? ' ' + kind : '');
}

document.getElementById('mtSendCode').addEventListener('click', function () {
  formToCfg();
  if (typeof BDMT === 'undefined' || !BDMT.available()) {
    return say('teleproto is missing from node_modules.', 'err');
  }
  mtSay('Requesting a code...');
  BDMT.sendCode(CFG.apiId, CFG.apiHash, CFG.mtPhone, function (err) {
    if (err) { mtSay(err, 'err'); say('Telegram: ' + err, 'err'); return; }
    mtSay('Code sent - check Telegram.', 'ok');
  });
});

document.getElementById('mtSignIn').addEventListener('click', function () {
  formToCfg();
  var code = document.getElementById('mtCode').value.trim();
  var pass = document.getElementById('mtPass').value;

  if (!code) return mtSay('Enter the code first.', 'err');

  mtSay('Signing in...');
  BDMT.signIn(code, pass, function (err, session) {
    if (err) { mtSay(err, 'err'); say('Telegram: ' + err, 'err'); return; }

    CFG.mtSession = session;
    saveCfg();
    document.getElementById('mtCode').value = '';
    document.getElementById('mtPass').value = '';
    mtSay('Signed in.', 'ok');
    say('Signed in. Uploads can now use your account.', 'ok');
  });
});

document.getElementById('sendLog').addEventListener('click', function () {
  formToCfg();
  if (typeof BDRender === 'undefined' || !BDRender.hasNode) {
    return say('Node is off - add --enable-nodejs to the manifest.', 'err');
  }
  BDRender.sendLog(CFG.tgToken, CFG.tgChat, LOG_PATH, function (err) {
    say(err ? ('Could not send the log: ' + err) : 'render.log sent.',
        err ? 'err' : 'ok');
  }, CFG.apiBase);
});

document.getElementById('logRefresh').addEventListener('click', function () {
  showLog();
  $logView.scrollTop = $logView.scrollHeight;
});

document.getElementById('logClear').addEventListener('click', function () {
  writeFile(LOG_PATH, '');
  showLog();
});

/* ---------- render & Telegram ---------- */

document.getElementById('renderBtn').addEventListener('click', function () {
  if (typeof BDRender === 'undefined' || !BDRender.hasNode) {
    return say('Node is off - add --enable-nodejs to the manifest.', 'err');
  }
  if (BDRender.busy()) {
    return say(BDRender.cancel() ? 'Render cancelled.' : 'Nothing to cancel.', 'err');
  }
  var useAcc = $useAccount.checked;
  if (useAcc && !CFG.mtSession) {
    return say('Sign in with your account first, in Settings.', 'err');
  }
  if (!useAcc && (!CFG.tgToken || !CFG.tgChat)) {
    return say('Set the bot token and chat ID in Settings first.', 'err');
  }

  function go() {
  evalScript('bd_renderInfo("' + esc(CFG.outDir) + '")', function (res) {
    if (!res || res.indexOf('OK:') !== 0) {
      return say(res || 'No reply - host.jsx did not load.', 'err');
    }

    // "aerender | project | comp | frames | outDir | fps"
    var f = res.slice(3).split('|');
    if (f.length < 5) return say('Unexpected reply from host.jsx.', 'err');

    BDRender.start({
      aerender:   f[0],
      project:    f[1],
      comp:       f[2],
      frames:     parseInt(f[3], 10) || 1,
      outDir:     f[4],
      fps:        parseFloat(f[5]) || 25,
      fit:        $fitSize.checked,
      logPath:    LOG_PATH,
      apiBase:    CFG.apiBase,
      useAccount: useAcc,
      omTemplate: CFG.omTpl,
      rsTemplate: CFG.rsTpl,
      token:      CFG.tgToken,
      chatId:     useAcc ? (CFG.mtTarget || 'me') : CFG.tgChat
    }, {
      status: function (t) {
        // "Rendering name  58%  (174/300)" -> label plus a number for the bar
        var m = /(\d+)%/.exec(t);
        progress(t.replace(/\s*\d+%.*$/, ''), m ? parseInt(m[1], 10) : 0);
      },
      done:   function (t) {
        progress('', -1);
        say(t, 'ok');
        if (!$logPanel.hidden) showLog();
      },
      fail:   function (t) {
        progress('', -1);
        say(t, 'err');
        if (!$logPanel.hidden) showLog();
      }
    });

    say('Render started. Click again to cancel.', 'ok');
  });
  }

  if (!useAcc) return go();

  // The stored session avoids signing in again; it still has to reconnect
  BDMT.resume(CFG.apiId, CFG.apiHash, CFG.mtSession, function (err) {
    if (err) return say('Account: ' + err, 'err');
    go();
  });
});

/* Thumbnail size */
function setCardSize(px) {
  document.documentElement.style.setProperty('--card', px + 'px');
  try { localStorage.setItem('bd_cardSize', px); } catch (e) {}
}

$size.addEventListener('input', function () { setCardSize(this.value); });

(function () {
  var saved = null;
  try { saved = localStorage.getItem('bd_cardSize'); } catch (e) {}
  if (saved) $size.value = saved;
  setCardSize($size.value);
})();

if (typeof BDMT !== 'undefined' && BDMT.available()) {
  BDMT.describe('DVMotion', VERSION);
}

$ver.textContent = 'v' + VERSION;
loadLibrary();
