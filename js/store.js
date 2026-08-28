/* Room Planner — application state.

   One plan object is the single source of truth. The UI renders it, WebMCP
   tools mutate it, and every change flows back through the same subscribers,
   so an agent edit is visually identical to a human edit. */
(function (global) {
  'use strict';

  var RP = global.RP || (global.RP = {});
  var G = RP.geometry;

  var STORAGE_KEY = 'room-planner:v1';
  var HISTORY_LIMIT = 80;

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function planFromTemplate(tpl) {
    return {
      id: 'plan-' + Date.now().toString(36),
      name: tpl.name || (tpl.label + ' layout'),
      template: tpl.key || null,
      room: clone(tpl.room),
      openings: clone(tpl.openings),
      objects: clone(tpl.objects),
      constraints: clone(tpl.constraints),
      seq: 100
    };
  }

  function emptyPlan(widthCm, heightCm) {
    var w = Math.round(G.clamp(Number(widthCm) || 420, 60, 2000));
    var h = Math.round(G.clamp(Number(heightCm) || 360, 60, 2000));
    return {
      id: 'plan-' + Date.now().toString(36),
      name: 'My room',
      template: null,
      room: { widthCm: w, heightCm: h },
      openings: [
        { id: 'door-1', type: 'door', wall: 'bottom', offsetCm: Math.max(0, Math.round(w / 2 - 45)), widthCm: 90 },
        { id: 'window-1', type: 'window', wall: 'top', offsetCm: Math.max(0, Math.round(w / 2 - 60)), widthCm: 120 }
      ],
      objects: [],
      constraints: [
        { id: 'c1', type: 'keep_clear', openingId: 'door-1', clearanceCm: 80 }
      ],
      seq: 100
    };
  }

  var state = {
    view: 'start',              // 'start' | 'app'
    plan: planFromTemplate(RP.DEMO_ROOM),
    baseline: null,             // snapshot used by Reset
    selectedId: null,
    tab: 'inspector',
    lightEnabled: true,
    highlight: { ids: [], message: '' },
    ui: { customForm: false, constraintForm: false, cfType: 'min_distance' }
  };
  state.baseline = clone(state.plan);

  var past = [];
  var future = [];
  var listeners = [];
  var txSnapshot = null;

  /* ------------------------------------------------------------ plumbing */

  function subscribe(fn) { listeners.push(fn); return function () {
    listeners = listeners.filter(function (l) { return l !== fn; });
  }; }

  function emit(detail) {
    listeners.forEach(function (fn) { try { fn(state, detail || {}); } catch (e) { console.error(e); } });
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        plan: state.plan,
        baseline: state.baseline,
        selectedId: state.selectedId,
        lightEnabled: state.lightEnabled,
        tab: state.tab
      }));
    } catch (e) { /* private mode, quota — the app still works in memory */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.plan || !data.plan.room) return null;
      return data;
    } catch (e) { return null; }
  }

  function restore() {
    var data = load();
    if (!data) return false;
    state.plan = normalizePlan(data.plan);
    state.baseline = data.baseline ? normalizePlan(data.baseline) : clone(state.plan);
    state.selectedId = data.selectedId || null;
    state.lightEnabled = data.lightEnabled !== false;
    state.tab = data.tab || 'inspector';
    if (!getObject(state.selectedId)) state.selectedId = null;
    past = []; future = [];
    return true;
  }

  /** Accept partial / imported plans without letting bad data reach the UI. */
  function normalizePlan(input) {
    var p = input || {};
    var room = p.room || {};
    var plan = {
      id: p.id || ('plan-' + Date.now().toString(36)),
      name: typeof p.name === 'string' && p.name ? p.name : 'My room',
      template: p.template || null,
      room: {
        widthCm: Math.round(G.clamp(Number(room.widthCm) || 420, 30, 5000)),
        heightCm: Math.round(G.clamp(Number(room.heightCm) || 360, 30, 5000))
      },
      openings: [],
      objects: [],
      constraints: [],
      seq: Number(p.seq) || 100
    };
    (Array.isArray(p.openings) ? p.openings : []).forEach(function (o, i) {
      if (!o) return;
      plan.openings.push({
        id: String(o.id || ('opening-' + (i + 1))),
        type: o.type === 'window' ? 'window' : 'door',
        wall: ['top', 'right', 'bottom', 'left'].indexOf(o.wall) !== -1 ? o.wall : 'top',
        offsetCm: Math.max(0, Math.round(Number(o.offsetCm) || 0)),
        widthCm: Math.max(5, Math.round(Number(o.widthCm) || 90))
      });
    });
    (Array.isArray(p.objects) ? p.objects : []).forEach(function (o, i) {
      if (!o) return;
      plan.objects.push({
        id: String(o.id || ('object-' + (i + 1))),
        type: String(o.type || 'custom'),
        label: String(o.label || 'Object'),
        xCm: Math.round(Number(o.xCm) || 0),
        yCm: Math.round(Number(o.yCm) || 0),
        widthCm: Math.max(5, Math.round(Number(o.widthCm) || 60)),
        heightCm: Math.max(5, Math.round(Number(o.heightCm) || 60)),
        rotation: [0, 90, 180, 270].indexOf(Number(o.rotation)) !== -1 ? Number(o.rotation) : 0,
        locked: !!o.locked
      });
    });
    (Array.isArray(p.constraints) ? p.constraints : []).forEach(function (c, i) {
      if (!c || !c.type) return;
      var out = { id: String(c.id || ('c' + (i + 1))), type: c.type };
      if (c.type === 'min_distance') {
        out.objectAId = String(c.objectAId || '');
        out.objectBId = String(c.objectBId || '');
        out.distanceCm = Math.max(0, Number(c.distanceCm) || 0);
      } else if (c.type === 'near_window') {
        out.objectId = String(c.objectId || '');
        out.maxDistanceCm = Math.max(0, Number(c.maxDistanceCm) || 0);
      } else if (c.type === 'against_wall') {
        out.objectId = String(c.objectId || '');
      } else if (c.type === 'keep_clear') {
        out.openingId = String(c.openingId || '');
        out.clearanceCm = Math.max(0, Number(c.clearanceCm) || 0);
      } else if (c.type === 'clearance_zone') {
        out.objectId = String(c.objectId || '');
        out.side = ['top', 'right', 'bottom', 'left'].indexOf(c.side) !== -1 ? c.side : 'bottom';
        out.clearanceCm = Math.max(0, Number(c.clearanceCm) || 0);
      } else if (c.type === 'max_distance') {
        out.objectAId = String(c.objectAId || '');
        out.objectBId = String(c.objectBId || '');
        out.maxDistanceCm = Math.max(0, Number(c.maxDistanceCm) || 0);
      } else if (c.type === 'facing') {
        out.objectAId = String(c.objectAId || '');
        out.objectBId = String(c.objectBId || '');
      } else if (c.type === 'centered_on_wall') {
        out.objectId = String(c.objectId || '');
        out.wall = ['top', 'right', 'bottom', 'left'].indexOf(c.wall) !== -1 ? c.wall : 'bottom';
        out.toleranceCm = Math.max(0, Number(c.toleranceCm) || 0);
      } else {
        return;
      }
      plan.constraints.push(out);
    });
    return plan;
  }

  /* ------------------------------------------------------------- history */

  function pushHistory(snap) {
    past.push(snap);
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
  }

  /** Run a mutation, record it for undo, persist and re-render. */
  function change(fn, opts) {
    var options = opts || {};
    var before = clone(state.plan);
    var result = fn();
    if (options.history !== false && txSnapshot === null) pushHistory(before);
    save();
    emit(options.detail);
    return result;
  }

  /** Group a burst of mutations (a drag) into one undo step. */
  function beginTransaction() { if (txSnapshot === null) txSnapshot = clone(state.plan); }
  function endTransaction() {
    if (txSnapshot === null) return;
    var before = txSnapshot;
    txSnapshot = null;
    if (JSON.stringify(before) !== JSON.stringify(state.plan)) {
      pushHistory(before);
      save();
      emit();
    }
  }

  function undo() {
    if (!past.length) return false;
    future.push(clone(state.plan));
    state.plan = past.pop();
    if (!getObject(state.selectedId)) state.selectedId = null;
    save(); emit(); return true;
  }

  function redo() {
    if (!future.length) return false;
    past.push(clone(state.plan));
    state.plan = future.pop();
    if (!getObject(state.selectedId)) state.selectedId = null;
    save(); emit(); return true;
  }

  function canUndo() { return past.length > 0; }
  function canRedo() { return future.length > 0; }

  /* --------------------------------------------------------- plan access */

  function getObject(id) {
    if (!id) return null;
    var objs = state.plan.objects;
    for (var i = 0; i < objs.length; i++) if (objs[i].id === id) return objs[i];
    return null;
  }

  function getOpening(id) {
    if (!id) return null;
    var ops = state.plan.openings;
    for (var i = 0; i < ops.length; i++) if (ops[i].id === id) return ops[i];
    return null;
  }

  function getConstraint(id) {
    if (!id) return null;
    var cs = state.plan.constraints;
    for (var i = 0; i < cs.length; i++) if (cs[i].id === id) return cs[i];
    return null;
  }

  function nextId(prefix) {
    var id;
    do { id = prefix + '-' + (state.plan.seq++); } while (getObject(id) || getOpening(id) || getConstraint(id));
    return id;
  }

  /* ------------------------------------------------------------ analysis */

  function doorClearanceFor(op) {
    var c = state.plan.constraints.filter(function (x) {
      return x.type === 'keep_clear' && x.openingId === op.id;
    })[0];
    return c ? c.clearanceCm : RP.DEFAULT_DOOR_CLEARANCE_CM;
  }

  function analyzeCollisions() {
    var plan = state.plan;
    var room = plan.room;
    var ids = {};
    var messages = [];
    var doorZones = plan.openings.filter(function (o) { return o.type === 'door'; }).map(function (op) {
      return { op: op, rect: G.keepClearRect(op, room, doorClearanceFor(op)) };
    });

    plan.objects.forEach(function (a, i) {
      var ra = G.rectOf(a);
      if (G.isOutOfBounds(a, room)) {
        ids[a.id] = true;
        messages.push(a.label + ' is outside the room bounds');
      }
      for (var j = i + 1; j < plan.objects.length; j++) {
        var b = plan.objects[j];
        if (G.rectsOverlap(ra, G.rectOf(b))) {
          ids[a.id] = true; ids[b.id] = true;
          messages.push(a.label + ' overlaps ' + b.label);
        }
      }
      doorZones.forEach(function (z) {
        if (G.rectsOverlap(ra, z.rect)) {
          ids[a.id] = true;
          messages.push(a.label + ' blocks the door clearance zone');
        }
      });
    });
    return { ids: ids, messages: messages };
  }

  function nearestObjectInfo(id) {
    var obj = getObject(id);
    if (!obj) return null;
    var r = G.rectOf(obj);
    var best = null;
    state.plan.objects.forEach(function (o) {
      if (o.id === id) return;
      var d = Math.round(G.rectDistance(r, G.rectOf(o)));
      if (!best || d < best.distanceCm) best = { objectId: o.id, label: o.label, distanceCm: d };
    });
    return best;
  }

  function nearestWindowCm(id) {
    var obj = getObject(id);
    if (!obj) return null;
    var best = null;
    state.plan.openings.forEach(function (op) {
      if (op.type !== 'window') return;
      var d = G.distanceToOpening(obj, op, state.plan.room);
      if (best === null || d < best) best = d;
    });
    return best === null ? null : Math.round(best);
  }

  function constraintStatus(c) {
    var room = state.plan.room;
    if (c.type === 'min_distance') {
      var a = getObject(c.objectAId), b = getObject(c.objectBId);
      if (!a || !b) return { satisfied: true, detail: 'object missing' };
      var d = Math.round(G.rectDistance(G.rectOf(a), G.rectOf(b)));
      return { satisfied: d >= c.distanceCm, detail: d + ' cm apart · minimum ' + c.distanceCm + ' cm' };
    }
    if (c.type === 'near_window') {
      if (!getObject(c.objectId)) return { satisfied: true, detail: 'object missing' };
      var dw = nearestWindowCm(c.objectId);
      if (dw === null) return { satisfied: false, detail: 'no window in the room' };
      return { satisfied: dw <= c.maxDistanceCm, detail: dw + ' cm from nearest window · maximum ' + c.maxDistanceCm + ' cm' };
    }
    if (c.type === 'against_wall') {
      var o = getObject(c.objectId);
      if (!o) return { satisfied: true, detail: 'object missing' };
      var ok = G.isAgainstWall(o, room, 3);
      return { satisfied: ok, detail: ok ? 'touching a wall' : 'not touching any wall' };
    }
    if (c.type === 'keep_clear') {
      var op = getOpening(c.openingId);
      if (!op) return { satisfied: true, detail: 'opening missing' };
      var zone = G.keepClearRect(op, room, c.clearanceCm);
      var blocking = null;
      state.plan.objects.forEach(function (obj) {
        if (!blocking && G.rectsOverlap(G.rectOf(obj), zone)) blocking = obj;
      });
      return { satisfied: !blocking, detail: blocking ? blocking.label + ' blocks the clearance zone' : 'zone is clear' };
    }
    if (c.type === 'clearance_zone') {
      var co = getObject(c.objectId);
      if (!co) return { satisfied: true, detail: 'object missing' };
      var czone = G.sideRect(G.rectOf(co), c.side, c.clearanceCm);
      var cblocking = null;
      state.plan.objects.forEach(function (obj) {
        if (cblocking || obj.id === c.objectId) return;
        if (G.rectsOverlap(G.rectOf(obj), czone)) cblocking = obj;
      });
      return { satisfied: !cblocking, detail: cblocking ? cblocking.label + ' blocks the clearance zone' : 'zone is clear' };
    }
    if (c.type === 'max_distance') {
      var ma = getObject(c.objectAId), mb = getObject(c.objectBId);
      if (!ma || !mb) return { satisfied: true, detail: 'object missing' };
      var md = Math.round(G.rectDistance(G.rectOf(ma), G.rectOf(mb)));
      return { satisfied: md <= c.maxDistanceCm, detail: md + ' cm apart · maximum ' + c.maxDistanceCm + ' cm' };
    }
    if (c.type === 'facing') {
      var fa = getObject(c.objectAId), fb = getObject(c.objectBId);
      if (!fa || !fb) return { satisfied: true, detail: 'object missing' };
      var faces = G.isFacing(G.rectOf(fa), G.frontSide(fa), G.rectOf(fb));
      return { satisfied: faces, detail: faces ? fa.label + ' faces ' + fb.label : fa.label + ' does not face ' + fb.label };
    }
    if (c.type === 'centered_on_wall') {
      var wo = getObject(c.objectId);
      if (!wo) return { satisfied: true, detail: 'object missing' };
      var touching = G.touchesWall(wo, room, c.wall, 3);
      var offset = Math.round(G.centerOffsetOnWall(wo, c.wall, room));
      if (!touching) return { satisfied: false, detail: 'not touching the ' + c.wall + ' wall' };
      return { satisfied: Math.abs(offset) <= c.toleranceCm, detail: Math.abs(offset) + ' cm off-centre · tolerance ' + c.toleranceCm + ' cm' };
    }
    return { satisfied: true, detail: '' };
  }

  function constraintText(c) {
    if (c.type === 'min_distance') {
      var a = getObject(c.objectAId), b = getObject(c.objectBId);
      return 'Keep at least ' + c.distanceCm + ' cm between ' + (a ? a.label : 'an object') + ' and ' + (b ? b.label : 'an object');
    }
    if (c.type === 'near_window') {
      var o = getObject(c.objectId);
      return (o ? o.label : 'An object') + ' must be within ' + c.maxDistanceCm + ' cm of a window';
    }
    if (c.type === 'against_wall') {
      var o2 = getObject(c.objectId);
      return (o2 ? o2.label : 'An object') + ' should be against a wall';
    }
    if (c.type === 'keep_clear') {
      var op = getOpening(c.openingId);
      return 'Keep ' + c.clearanceCm + ' cm clear in front of the ' + (op ? op.type : 'opening');
    }
    if (c.type === 'clearance_zone') {
      var co = getObject(c.objectId);
      return 'Keep ' + c.clearanceCm + ' cm clear on the ' + c.side + ' side of ' + (co ? co.label : 'an object');
    }
    if (c.type === 'max_distance') {
      var ma = getObject(c.objectAId), mb = getObject(c.objectBId);
      return 'Keep ' + (ma ? ma.label : 'an object') + ' within ' + c.maxDistanceCm + ' cm of ' + (mb ? mb.label : 'an object');
    }
    if (c.type === 'facing') {
      var fa = getObject(c.objectAId), fb = getObject(c.objectBId);
      return (fa ? fa.label : 'An object') + ' should face ' + (fb ? fb.label : 'an object');
    }
    if (c.type === 'centered_on_wall') {
      var wo = getObject(c.objectId);
      return (wo ? wo.label : 'An object') + ' should be centred on the ' + c.wall + ' wall';
    }
    return '';
  }

  function constraintsWithStatus() {
    return state.plan.constraints.map(function (c) {
      var s = constraintStatus(c);
      return Object.assign({}, c, { text: constraintText(c), satisfied: s.satisfied, detail: s.detail });
    });
  }

  function validateLayout() {
    var info = analyzeCollisions();
    var violations = [];
    state.plan.constraints.forEach(function (c) {
      var s = constraintStatus(c);
      if (!s.satisfied) {
        violations.push({ constraintId: c.id, type: c.type, message: constraintText(c) + ' — ' + s.detail });
      }
    });
    return {
      valid: info.messages.length === 0 && violations.length === 0,
      collisions: info.messages,
      violations: violations
    };
  }

  function distancesFor(id) {
    var obj = getObject(id);
    if (!obj) return null;
    var r = G.rectOf(obj);
    var room = state.plan.room;
    var nearestObjects = state.plan.objects
      .filter(function (o) { return o.id !== id; })
      .map(function (o) {
        return { objectId: o.id, label: o.label, distanceCm: Math.round(G.rectDistance(r, G.rectOf(o))) };
      })
      .sort(function (a, b) { return a.distanceCm - b.distanceCm; });
    var openings = state.plan.openings.map(function (op) {
      return { openingId: op.id, type: op.type, wall: op.wall, distanceCm: Math.round(G.distanceToOpening(obj, op, room)) };
    }).sort(function (a, b) { return a.distanceCm - b.distanceCm; });
    return {
      objectId: id,
      walls: G.wallDistances(obj, room),
      nearestObjects: nearestObjects,
      openings: openings,
      nearestWindowCm: nearestWindowCm(id)
    };
  }

  /* ----------------------------------------------------------- mutations */

  function setView(view) { state.view = view; emit(); }

  function setSelected(id) {
    if (state.selectedId === id) return;
    state.selectedId = getObject(id) ? id : null;
    save(); emit();
  }

  function setTab(tab) { state.tab = tab; save(); emit(); }

  function setUi(patch) { Object.assign(state.ui, patch); emit(); }

  function toggleLight() { state.lightEnabled = !state.lightEnabled; save(); emit(); }

  function setRoomName(name) {
    return change(function () { state.plan.name = String(name || 'My room'); });
  }

  function setRoomDimensions(widthCm, heightCm) {
    return change(function () {
      var w = Number(widthCm), h = Number(heightCm);
      if (!isNaN(w) && w > 0) state.plan.room.widthCm = Math.round(G.clamp(w, 30, 5000));
      if (!isNaN(h) && h > 0) state.plan.room.heightCm = Math.round(G.clamp(h, 30, 5000));
      return clone(state.plan.room);
    });
  }

  function addObject(params) {
    return change(function () {
      var p = params || {};
      var room = state.plan.room;
      var preset = (!p.widthCm || !p.heightCm) ? RP.findPreset(p.type) : null;
      var w = Math.max(5, Math.round(Number(p.widthCm) || (preset ? preset.w : 60)));
      var h = Math.max(5, Math.round(Number(p.heightCm) || (preset ? preset.h : 60)));
      var type = String(p.type || (preset ? preset.type : 'custom'));
      var id = p.id && !getObject(p.id) ? String(p.id) : nextId(type);
      var rotation = [0, 90, 180, 270].indexOf(Number(p.rotation)) !== -1 ? Number(p.rotation) : 0;
      var fw = (rotation === 90 || rotation === 270) ? h : w;
      var fh = (rotation === 90 || rotation === 270) ? w : h;
      var stagger = (state.plan.objects.length % 6) * 14;
      var x = (p.xCm !== undefined && p.xCm !== null && p.xCm !== '')
        ? Math.round(Number(p.xCm))
        : Math.round(G.clamp(20 + stagger, 0, Math.max(0, room.widthCm - fw)));
      var y = (p.yCm !== undefined && p.yCm !== null && p.yCm !== '')
        ? Math.round(Number(p.yCm))
        : Math.round(G.clamp(20 + stagger, 0, Math.max(0, room.heightCm - fh)));
      var obj = {
        id: id, type: type,
        label: String(p.label || (preset ? preset.label : 'Object')),
        xCm: x, yCm: y, widthCm: w, heightCm: h,
        rotation: rotation, locked: !!p.locked
      };
      state.plan.objects.push(obj);
      state.selectedId = id;
      return clone(obj);
    });
  }

  function updateObject(id, patch, opts) {
    var obj = getObject(id);
    if (!obj) return null;
    return change(function () {
      Object.assign(obj, patch);
      return clone(obj);
    }, opts);
  }

  function moveObject(id, xCm, yCm, opts) {
    var obj = getObject(id);
    if (!obj) return { ok: false, reason: 'No object with id "' + id + '".' };
    if (obj.locked) return { ok: false, reason: obj.label + ' is locked.' };
    var patch = {};
    if (xCm !== undefined && xCm !== null && !isNaN(Number(xCm))) patch.xCm = Math.round(Number(xCm));
    if (yCm !== undefined && yCm !== null && !isNaN(Number(yCm))) patch.yCm = Math.round(Number(yCm));
    updateObject(id, patch, opts);
    return { ok: true };
  }

  /** Drag/nudge helper: keeps the object inside the room. */
  function moveObjectClamped(id, xCm, yCm, opts) {
    var obj = getObject(id);
    if (!obj || obj.locked) return false;
    var fp = G.footprint(obj);
    var room = state.plan.room;
    updateObject(id, {
      xCm: Math.round(G.clamp(xCm, 0, Math.max(0, room.widthCm - fp.w))),
      yCm: Math.round(G.clamp(yCm, 0, Math.max(0, room.heightCm - fp.h)))
    }, opts);
    return true;
  }

  function rotateObject(id, rotation) {
    var obj = getObject(id);
    if (!obj) return { ok: false, reason: 'No object with id "' + id + '".' };
    if (obj.locked) return { ok: false, reason: obj.label + ' is locked.' };
    if ([0, 90, 180, 270].indexOf(Number(rotation)) === -1) return { ok: false, reason: 'Rotation must be 0, 90, 180 or 270.' };
    updateObject(id, { rotation: Number(rotation) });
    return { ok: true };
  }

  function rotateStep(id) {
    var obj = getObject(id);
    if (!obj) return false;
    var seq = [0, 90, 180, 270];
    return rotateObject(id, seq[(seq.indexOf(obj.rotation) + 1) % 4]).ok;
  }

  function resizeObject(id, widthCm, heightCm) {
    var obj = getObject(id);
    if (!obj) return { ok: false, reason: 'No object with id "' + id + '".' };
    if (obj.locked) return { ok: false, reason: obj.label + ' is locked.' };
    var patch = {};
    if (widthCm !== undefined && widthCm !== null && !isNaN(Number(widthCm))) patch.widthCm = Math.max(5, Math.round(Number(widthCm)));
    if (heightCm !== undefined && heightCm !== null && !isNaN(Number(heightCm))) patch.heightCm = Math.max(5, Math.round(Number(heightCm)));
    updateObject(id, patch);
    return { ok: true };
  }

  function renameObject(id, label) {
    if (!getObject(id)) return false;
    updateObject(id, { label: String(label) });
    return true;
  }

  function lockObject(id, locked) {
    if (!getObject(id)) return false;
    updateObject(id, { locked: !!locked });
    return true;
  }

  function duplicateObject(id) {
    var obj = getObject(id);
    if (!obj) return null;
    return change(function () {
      var fp = G.footprint(obj);
      var room = state.plan.room;
      var copy = Object.assign({}, obj, {
        id: nextId(obj.type || 'object'),
        xCm: Math.round(G.clamp(obj.xCm + 20, 0, Math.max(0, room.widthCm - fp.w))),
        yCm: Math.round(G.clamp(obj.yCm + 20, 0, Math.max(0, room.heightCm - fp.h))),
        locked: false
      });
      state.plan.objects.push(copy);
      state.selectedId = copy.id;
      return clone(copy);
    });
  }

  function removeObject(id) {
    if (!getObject(id)) return false;
    return change(function () {
      state.plan.objects = state.plan.objects.filter(function (o) { return o.id !== id; });
      state.plan.constraints = state.plan.constraints.filter(function (c) {
        return c.objectId !== id && c.objectAId !== id && c.objectBId !== id;
      });
      if (state.selectedId === id) state.selectedId = null;
      state.highlight.ids = state.highlight.ids.filter(function (h) { return h !== id; });
      return true;
    });
  }

  function addOpening(params) {
    return change(function () {
      var p = params || {};
      var type = p.type === 'window' ? 'window' : 'door';
      var wall = ['top', 'right', 'bottom', 'left'].indexOf(p.wall) !== -1 ? p.wall : (type === 'door' ? 'bottom' : 'top');
      var width = Math.max(5, Math.round(Number(p.widthCm) || (type === 'door' ? 90 : 120)));
      var maxOffset = Math.max(0, G.wallLength(wall, state.plan.room) - width);
      var offset = Math.round(G.clamp(Number(p.offsetCm) || 20, 0, maxOffset));
      var op = {
        id: p.id && !getOpening(p.id) ? String(p.id) : nextId(type),
        type: type, wall: wall, offsetCm: offset, widthCm: width
      };
      state.plan.openings.push(op);
      return clone(op);
    });
  }

  function updateOpening(id, patch, opts) {
    var op = getOpening(id);
    if (!op) return null;
    return change(function () {
      if (patch.wall && ['top', 'right', 'bottom', 'left'].indexOf(patch.wall) !== -1) op.wall = patch.wall;
      if (patch.widthCm !== undefined && !isNaN(Number(patch.widthCm))) op.widthCm = Math.max(5, Math.round(Number(patch.widthCm)));
      if (patch.offsetCm !== undefined && !isNaN(Number(patch.offsetCm))) op.offsetCm = Math.max(0, Math.round(Number(patch.offsetCm)));
      var maxOffset = Math.max(0, G.wallLength(op.wall, state.plan.room) - op.widthCm);
      op.offsetCm = Math.round(G.clamp(op.offsetCm, 0, maxOffset));
      return clone(op);
    }, opts);
  }

  function removeOpening(id) {
    if (!getOpening(id)) return false;
    return change(function () {
      state.plan.openings = state.plan.openings.filter(function (o) { return o.id !== id; });
      state.plan.constraints = state.plan.constraints.filter(function (c) { return c.openingId !== id; });
      state.highlight.ids = state.highlight.ids.filter(function (h) { return h !== id; });
      return true;
    });
  }

  function addConstraint(params) {
    var p = params || {};
    var c = { id: p.id && !getConstraint(p.id) ? String(p.id) : nextId('c'), type: p.type };
    if (p.type === 'min_distance') {
      if (!getObject(p.objectAId) || !getObject(p.objectBId) || p.objectAId === p.objectBId) return null;
      c.objectAId = p.objectAId; c.objectBId = p.objectBId;
      c.distanceCm = Math.max(0, Number(p.distanceCm) || 0);
    } else if (p.type === 'near_window') {
      if (!getObject(p.objectId)) return null;
      c.objectId = p.objectId;
      c.maxDistanceCm = Math.max(0, Number(p.maxDistanceCm) || 0);
    } else if (p.type === 'against_wall') {
      if (!getObject(p.objectId)) return null;
      c.objectId = p.objectId;
    } else if (p.type === 'keep_clear') {
      if (!getOpening(p.openingId)) return null;
      c.openingId = p.openingId;
      c.clearanceCm = Math.max(0, Number(p.clearanceCm) || 0);
    } else if (p.type === 'clearance_zone') {
      if (!getObject(p.objectId)) return null;
      c.objectId = p.objectId;
      c.side = ['top', 'right', 'bottom', 'left'].indexOf(p.side) !== -1 ? p.side : 'bottom';
      c.clearanceCm = Math.max(0, Number(p.clearanceCm) || 0);
    } else if (p.type === 'max_distance') {
      if (!getObject(p.objectAId) || !getObject(p.objectBId) || p.objectAId === p.objectBId) return null;
      c.objectAId = p.objectAId; c.objectBId = p.objectBId;
      c.maxDistanceCm = Math.max(0, Number(p.maxDistanceCm) || 0);
    } else if (p.type === 'facing') {
      if (!getObject(p.objectAId) || !getObject(p.objectBId) || p.objectAId === p.objectBId) return null;
      c.objectAId = p.objectAId; c.objectBId = p.objectBId;
    } else if (p.type === 'centered_on_wall') {
      if (!getObject(p.objectId)) return null;
      c.objectId = p.objectId;
      c.wall = ['top', 'right', 'bottom', 'left'].indexOf(p.wall) !== -1 ? p.wall : 'bottom';
      c.toleranceCm = Math.max(0, Number(p.toleranceCm) || 5);
    } else {
      return null;
    }
    return change(function () {
      state.plan.constraints.push(c);
      return clone(c);
    });
  }

  function updateConstraint(id, patch) {
    var c = getConstraint(id);
    if (!c) return null;
    return change(function () {
      ['distanceCm', 'maxDistanceCm', 'clearanceCm', 'toleranceCm'].forEach(function (k) {
        if (patch[k] !== undefined && !isNaN(Number(patch[k]))) c[k] = Math.max(0, Number(patch[k]));
      });
      ['objectAId', 'objectBId', 'objectId'].forEach(function (k) {
        if (patch[k] && getObject(patch[k])) c[k] = patch[k];
      });
      if (patch.openingId && getOpening(patch.openingId)) c.openingId = patch.openingId;
      if (patch.side && ['top', 'right', 'bottom', 'left'].indexOf(patch.side) !== -1) c.side = patch.side;
      if (patch.wall && ['top', 'right', 'bottom', 'left'].indexOf(patch.wall) !== -1) c.wall = patch.wall;
      return clone(c);
    });
  }

  function removeConstraint(id) {
    if (!getConstraint(id)) return false;
    return change(function () {
      state.plan.constraints = state.plan.constraints.filter(function (c) { return c.id !== id; });
      return true;
    });
  }

  function highlight(ids, message) {
    state.highlight = {
      ids: Array.isArray(ids) ? ids.slice() : [],
      message: message || ''
    };
    emit();
    return state.highlight;
  }

  function clearHighlights() { return highlight([], ''); }

  /* -------------------------------------------------- lifecycle & export */

  function startPlan(plan, opts) {
    state.plan = normalizePlan(plan);
    state.baseline = clone(state.plan);
    state.selectedId = (opts && opts.selectFirst && state.plan.objects[0]) ? state.plan.objects[0].id : null;
    state.highlight = { ids: [], message: '' };
    state.ui.customForm = false;
    state.ui.constraintForm = false;
    state.view = 'app';
    past = []; future = [];
    save(); emit();
  }

  function createRoom(widthCm, heightCm) { startPlan(emptyPlan(widthCm, heightCm)); }

  function loadTemplate(key) {
    var tpl = RP.TEMPLATES[key];
    if (!tpl) return false;
    startPlan(planFromTemplate(tpl), { selectFirst: false });
    return true;
  }

  function loadDemoRoom() {
    startPlan(planFromTemplate(RP.DEMO_ROOM));
    state.selectedId = 'desk-1';
    save(); emit();
  }

  /** Reset restores the layout this room started from, not a global default. */
  function resetRoom() {
    return change(function () {
      state.plan = clone(state.baseline);
      state.selectedId = null;
      state.highlight = { ids: [], message: '' };
    });
  }

  function exportPlan() { return clone(state.plan); }

  function importPlan(data) {
    var plan = normalizePlan(data && data.plan ? data.plan : data);
    startPlan(plan);
    return clone(state.plan);
  }

  RP.store = {
    state: state,
    subscribe: subscribe,
    emit: emit,
    restore: restore,
    hasSaved: function () { return !!load(); },

    getObject: getObject,
    getOpening: getOpening,
    getConstraint: getConstraint,
    doorClearanceFor: doorClearanceFor,

    analyzeCollisions: analyzeCollisions,
    constraintStatus: constraintStatus,
    constraintText: constraintText,
    constraintsWithStatus: constraintsWithStatus,
    validateLayout: validateLayout,
    distancesFor: distancesFor,
    nearestObjectInfo: nearestObjectInfo,
    nearestWindowCm: nearestWindowCm,

    setView: setView,
    setSelected: setSelected,
    setTab: setTab,
    setUi: setUi,
    toggleLight: toggleLight,

    setRoomName: setRoomName,
    setRoomDimensions: setRoomDimensions,
    addObject: addObject,
    moveObject: moveObject,
    moveObjectClamped: moveObjectClamped,
    rotateObject: rotateObject,
    rotateStep: rotateStep,
    resizeObject: resizeObject,
    renameObject: renameObject,
    lockObject: lockObject,
    duplicateObject: duplicateObject,
    removeObject: removeObject,

    addOpening: addOpening,
    updateOpening: updateOpening,
    removeOpening: removeOpening,

    addConstraint: addConstraint,
    updateConstraint: updateConstraint,
    removeConstraint: removeConstraint,

    highlight: highlight,
    clearHighlights: clearHighlights,

    beginTransaction: beginTransaction,
    endTransaction: endTransaction,
    undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo,

    createRoom: createRoom,
    loadTemplate: loadTemplate,
    loadDemoRoom: loadDemoRoom,
    resetRoom: resetRoom,
    exportPlan: exportPlan,
    importPlan: importPlan
  };
})(window);
