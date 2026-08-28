/* Room Planner — rendering and direct manipulation.

   The plan is drawn as SVG so every object stays a real DOM node: focusable,
   labelled, and easy to highlight when an agent points at it. */
(function (global) {
  'use strict';

  var RP = global.RP || (global.RP = {});
  var G = RP.geometry;
  var store = RP.store;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var els = {};
  var view = { scale: 1, ox: 72, oy: 48, w: 0, h: 0 };
  var drag = null;
  var openingDrag = null;
  var openingsSignature = '';
  var optionsSignature = '';
  var toastTimer = null;

  /* ------------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

  function svg(tag, attrs, parent) {
    var node = document.createElementNS(SVGNS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === null || attrs[k] === undefined) return;
        node.setAttribute(k, attrs[k]);
      });
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function html(tag, attrs, parent) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function icon(paths, attrs, parent) {
    var node = svg('svg', Object.assign({ viewBox: '0 0 24 24', class: 'ic', 'aria-hidden': 'true' }, attrs || {}), parent);
    paths.forEach(function (d) {
      if (typeof d === 'string') svg('path', { d: d }, node);
      else svg(d.tag, d.attrs, node);
    });
    return node;
  }

  var ICONS = {
    warn: ['M12 3l10 18H2z', 'M12 9v5', 'M12 17h.01'],
    lock: [{ tag: 'rect', attrs: { x: 5, y: 11, width: 14, height: 9, rx: 2 } }, 'M8 11V7a4 4 0 0 1 8 0v4'],
    check: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 9 } }, 'M8 12l3 3 5-6'],
    alert: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 9 } }, 'M12 8v5', 'M12 16h.01'],
    close: ['M6 6l12 12M18 6L6 18'],
    plus: ['M12 5v14M5 12h14']
  };

  function setValue(input, value) {
    if (!input) return;
    if (document.activeElement === input) return;
    var v = String(value);
    if (input.value !== v) input.value = v;
  }

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 2600);
  }

  /* ---------------------------------------------------------- projection */

  function computeView() {
    var room = store.state.plan.room;
    var wrap = els.canvasWrap;
    var compact = wrap.clientWidth < 560;
    var pad = compact
      ? { left: 40, top: 28, right: 28, bottom: 34 }
      : { left: 72, top: 48, right: 60, bottom: 58 };
    var availW = Math.max(80, wrap.clientWidth - pad.left - pad.right - 8);
    var availH = Math.max(80, wrap.clientHeight - pad.top - pad.bottom - 8);
    var scale = G.clamp(Math.min(availW / room.widthCm, availH / room.heightCm), 0.06, 4);
    view = {
      scale: scale,
      ox: pad.left,
      oy: pad.top,
      compact: compact,
      w: pad.left + room.widthCm * scale + pad.right,
      h: pad.top + room.heightCm * scale + pad.bottom
    };
    return view;
  }

  function px(cm) { return cm * view.scale; }
  function toPxX(cm) { return view.ox + cm * view.scale; }
  function toPxY(cm) { return view.oy + cm * view.scale; }

  function openingSegment(op) {
    var room = store.state.plan.room;
    var a = op.offsetCm, b = op.offsetCm + op.widthCm;
    if (op.wall === 'top') return { x1: toPxX(a), y1: toPxY(0), x2: toPxX(b), y2: toPxY(0) };
    if (op.wall === 'bottom') return { x1: toPxX(a), y1: toPxY(room.heightCm), x2: toPxX(b), y2: toPxY(room.heightCm) };
    if (op.wall === 'left') return { x1: toPxX(0), y1: toPxY(a), x2: toPxX(0), y2: toPxY(b) };
    return { x1: toPxX(room.widthCm), y1: toPxY(a), x2: toPxX(room.widthCm), y2: toPxY(b) };
  }

  /* ------------------------------------------------------------- canvas  */

  function renderCanvas() {
    var st = store.state;
    var plan = st.plan;
    var room = plan.room;
    computeView();

    var root = els.plan;
    while (root.firstChild) root.removeChild(root.firstChild);
    root.setAttribute('width', Math.round(view.w));
    root.setAttribute('height', Math.round(view.h));
    root.setAttribute('viewBox', '0 0 ' + Math.round(view.w) + ' ' + Math.round(view.h));

    /* defs: window light + soft shadows */
    var defs = svg('defs', null, root);
    [['lightTop', 0, 0, 0, 1], ['lightBottom', 0, 1, 0, 0], ['lightLeft', 0, 0, 1, 0], ['lightRight', 1, 0, 0, 0]]
      .forEach(function (g) {
        var grad = svg('linearGradient', { id: g[0], x1: g[1], y1: g[2], x2: g[3], y2: g[4] }, defs);
        svg('stop', { offset: '0%', 'stop-color': 'oklch(0.93 0.06 92)', 'stop-opacity': '0.55' }, grad);
        svg('stop', { offset: '100%', 'stop-color': 'oklch(0.93 0.06 92)', 'stop-opacity': '0' }, grad);
      });
    var filter = svg('filter', { id: 'softShadow', x: '-60%', y: '-60%', width: '220%', height: '220%' }, defs);
    svg('feGaussianBlur', { stdDeviation: view.compact ? 2.4 : 3.2 }, filter);

    /* floor */
    var floor = svg('rect', {
      x: view.ox, y: view.oy, width: px(room.widthCm), height: px(room.heightCm),
      rx: 2, class: 'room-floor'
    }, root);
    floor.addEventListener('pointerdown', function () { store.setSelected(null); });

    /* window light + the direction furniture shadows fall */
    var windows = plan.openings.filter(function (o) { return o.type === 'window'; });
    var primaryWindow = windows[0] || null;
    var lightOn = st.lightEnabled && !!primaryWindow;
    var shadow = { x: 0, y: 0 };
    if (lightOn) {
      var seg = openingSegment(primaryWindow);
      var depth = 0.62;
      var dist = view.compact ? 7 : 11;
      var cone;
      if (primaryWindow.wall === 'top') {
        cone = { x: Math.min(seg.x1, seg.x2), y: view.oy, w: Math.abs(seg.x2 - seg.x1), h: px(room.heightCm) * depth, id: 'lightTop' };
        shadow.y = dist;
      } else if (primaryWindow.wall === 'bottom') {
        var hb = px(room.heightCm) * depth;
        cone = { x: Math.min(seg.x1, seg.x2), y: view.oy + px(room.heightCm) - hb, w: Math.abs(seg.x2 - seg.x1), h: hb, id: 'lightBottom' };
        shadow.y = -dist;
      } else if (primaryWindow.wall === 'left') {
        cone = { x: view.ox, y: Math.min(seg.y1, seg.y2), w: px(room.widthCm) * depth, h: Math.abs(seg.y2 - seg.y1), id: 'lightLeft' };
        shadow.x = dist;
      } else {
        var wr = px(room.widthCm) * depth;
        cone = { x: view.ox + px(room.widthCm) - wr, y: Math.min(seg.y1, seg.y2), w: wr, h: Math.abs(seg.y2 - seg.y1), id: 'lightRight' };
        shadow.x = -dist;
      }
      svg('rect', {
        x: cone.x, y: cone.y, width: cone.w, height: cone.h,
        fill: 'url(#' + cone.id + ')', 'pointer-events': 'none'
      }, root);
    }

    if (!view.compact) renderDimensions(root, room);
    renderOpenings(root, plan);
    renderObjects(root, plan, lightOn, shadow);
  }

  function renderDimensions(root, room) {
    var x0 = view.ox, x1 = view.ox + px(room.widthCm);
    var y0 = view.oy, y1 = view.oy + px(room.heightCm);
    var by = y1 + 16;
    svg('line', { x1: x0, y1: by, x2: x1, y2: by, class: 'dim-line' }, root);
    svg('line', { x1: x0, y1: by - 4, x2: x0, y2: by + 4, class: 'dim-line' }, root);
    svg('line', { x1: x1, y1: by - 4, x2: x1, y2: by + 4, class: 'dim-line' }, root);
    var wt = svg('text', { x: (x0 + x1) / 2, y: by + 16, 'text-anchor': 'middle', class: 'dim-text' }, root);
    wt.textContent = room.widthCm + ' cm';

    var lx = x0 - 14;
    svg('line', { x1: lx, y1: y0, x2: lx, y2: y1, class: 'dim-line' }, root);
    svg('line', { x1: lx - 4, y1: y0, x2: lx + 4, y2: y0, class: 'dim-line' }, root);
    svg('line', { x1: lx - 4, y1: y1, x2: lx + 4, y2: y1, class: 'dim-line' }, root);
    var hx = x0 - 28, hy = (y0 + y1) / 2;
    var ht = svg('text', {
      x: hx, y: hy, 'text-anchor': 'middle', class: 'dim-text',
      transform: 'rotate(-90 ' + hx + ' ' + hy + ')'
    }, root);
    ht.textContent = room.heightCm + ' cm';
  }

  function renderOpenings(root, plan) {
    var st = store.state;
    plan.openings.forEach(function (op) {
      var seg = openingSegment(op);
      var isDoor = op.type === 'door';
      var g = svg('g', {
        class: 'op' + (st.highlight.ids.indexOf(op.id) !== -1 ? ' is-highlighted' : ''),
        'data-id': op.id
      }, root);

      /* clearance zone sits under everything else for this opening */
      if (isDoor) {
        var zone = G.keepClearRect(op, plan.room, store.doorClearanceFor(op));
        svg('rect', {
          x: toPxX(zone.x), y: toPxY(zone.y), width: px(zone.w), height: px(zone.h), class: 'op-clear'
        }, g);
      }

      /* punch the wall open, then draw the leaf or glazing */
      svg('line', {
        x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
        class: 'op-cut', 'stroke-width': view.compact ? 6 : 8
      }, g);

      if (isDoor) {
        var r = Math.abs(seg.x2 - seg.x1) + Math.abs(seg.y2 - seg.y1);
        var d;
        if (op.wall === 'left') d = 'M ' + seg.x1 + ' ' + seg.y1 + ' L ' + (seg.x1 + r) + ' ' + seg.y1 + ' A ' + r + ' ' + r + ' 0 0 1 ' + seg.x1 + ' ' + (seg.y1 + r);
        else if (op.wall === 'right') d = 'M ' + seg.x1 + ' ' + seg.y1 + ' L ' + (seg.x1 - r) + ' ' + seg.y1 + ' A ' + r + ' ' + r + ' 0 0 0 ' + seg.x1 + ' ' + (seg.y1 + r);
        else if (op.wall === 'top') d = 'M ' + seg.x1 + ' ' + seg.y1 + ' L ' + seg.x1 + ' ' + (seg.y1 + r) + ' A ' + r + ' ' + r + ' 0 0 0 ' + (seg.x1 + r) + ' ' + seg.y1;
        else d = 'M ' + seg.x1 + ' ' + seg.y1 + ' L ' + seg.x1 + ' ' + (seg.y1 - r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + (seg.x1 + r) + ' ' + seg.y1;
        svg('path', { d: d, class: 'op-swing' }, g);
      }

      var hit = svg('line', {
        x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, class: 'op-hit',
        style: 'cursor:' + (op.wall === 'top' || op.wall === 'bottom' ? 'ew-resize' : 'ns-resize') + ';touch-action:none;'
      }, g);
      hit.addEventListener('pointerdown', function (e) { startOpeningDrag(e, op.id); });

      svg('line', {
        x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
        class: isDoor ? 'op-door' : 'op-window'
      }, g);

      if (!view.compact) {
        var label = isDoor ? 'Door' : 'Window';
        var lx, ly, anchor;
        if (op.wall === 'top') { lx = (seg.x1 + seg.x2) / 2; ly = seg.y1 + 16; anchor = 'middle'; }
        else if (op.wall === 'bottom') { lx = (seg.x1 + seg.x2) / 2; ly = seg.y1 - 10; anchor = 'middle'; }
        else if (op.wall === 'left') { lx = seg.x1 + 10; ly = (seg.y1 + seg.y2) / 2 + 4; anchor = 'start'; }
        else { lx = seg.x1 - 10; ly = (seg.y1 + seg.y2) / 2 + 4; anchor = 'end'; }
        var t = svg('text', { x: lx, y: ly, 'text-anchor': anchor, class: 'op-label' }, g);
        t.textContent = label;
      }
    });
  }

  function renderObjects(root, plan, lightOn, shadow) {
    var st = store.state;
    var collisions = store.analyzeCollisions().ids;
    var clearanceZones = plan.constraints.filter(function (c) { return c.type === 'clearance_zone'; });
    var facingSubjects = {};
    plan.constraints.forEach(function (c) { if (c.type === 'facing') facingSubjects[c.objectAId] = true; });

    plan.objects.forEach(function (obj) {
      var fp = G.footprint(obj);
      var x = toPxX(obj.xCm), y = toPxY(obj.yCm);
      var w = Math.max(px(fp.w), 3), h = Math.max(px(fp.h), 3);
      var selected = obj.id === st.selectedId;
      var highlighted = st.highlight.ids.indexOf(obj.id) !== -1;
      var colliding = !!collisions[obj.id];

      var classes = ['obj'];
      if (selected) classes.push('is-selected');
      if (highlighted) classes.push('is-highlighted');
      if (colliding) classes.push('is-colliding');
      if (obj.locked) classes.push('is-locked');
      if (drag && drag.id === obj.id) classes.push('is-dragging');

      var g = svg('g', {
        class: classes.join(' '),
        'data-id': obj.id,
        tabindex: '0',
        role: 'button',
        'aria-label': obj.label + ', ' + fp.w + ' by ' + fp.h + ' centimetres, at x ' + obj.xCm + ', y ' + obj.yCm +
          (obj.locked ? ', locked' : '') + (colliding ? ', colliding' : '')
      }, root);

      /* functional clearance zones sit under the object itself */
      clearanceZones.forEach(function (c) {
        if (c.objectId !== obj.id) return;
        var zone = G.sideRect(G.rectOf(obj), c.side, c.clearanceCm);
        svg('rect', {
          x: toPxX(zone.x), y: toPxY(zone.y), width: px(zone.w), height: px(zone.h), class: 'op-clear'
        }, g);
      });

      if (lightOn) {
        svg('rect', {
          x: x + shadow.x, y: y + shadow.y, width: w, height: h,
          rx: view.compact ? 6 : 8, class: 'obj-shadow'
        }, g);
      }
      if (selected || highlighted) {
        svg('rect', { x: x, y: y, width: w, height: h, rx: 8, class: 'obj-halo' }, g);
      }
      svg('rect', { x: x, y: y, width: w, height: h, rx: view.compact ? 6 : 8, class: 'obj-box' }, g);

      if (facingSubjects[obj.id]) {
        var side = G.frontSide(obj);
        var nx = side === 'left' ? x : side === 'right' ? x + w : x + w / 2;
        var ny = side === 'top' ? y : side === 'bottom' ? y + h : y + h / 2;
        svg('circle', { cx: nx, cy: ny, r: 4, class: 'obj-front' }, g);
      }

      var cx = x + w / 2, cy = y + h / 2;
      var showLabel = w >= 30 && h >= 15;
      var showDims = w >= 44 && h >= 34 && !view.compact;
      if (showLabel) {
        var maxChars = Math.max(3, Math.floor((w - 6) / 5.9));
        var label = obj.label.length > maxChars ? obj.label.slice(0, Math.max(1, maxChars - 1)) + '…' : obj.label;
        var t = svg('text', { x: cx, y: showDims ? cy - 1 : cy + 4, class: 'obj-label' }, g);
        t.textContent = label;
      }
      if (showDims) {
        var d = svg('text', { x: cx, y: cy + 12, class: 'obj-dims' }, g);
        d.textContent = fp.w + '×' + fp.h + ' cm';
      }
      if (obj.locked && w > 26 && h > 26) {
        badge(g, ICONS.lock, x + w - 17, y + h - 17, '#6b6455');
      }
      if (colliding && w > 26 && h > 26) {
        badge(g, ICONS.warn, x + w - 17, y + 4, 'oklch(0.55 0.19 25)');
      }

      g.addEventListener('pointerdown', function (e) { startObjectDrag(e, obj.id); });
      g.addEventListener('keydown', function (e) { onObjectKeyDown(e, obj.id); });
      g.addEventListener('focus', function () {
        if (store.state.selectedId !== obj.id) store.setSelected(obj.id);
      });
    });
  }

  function badge(parent, paths, x, y, color) {
    var g = svg('g', {
      transform: 'translate(' + x + ' ' + y + ') scale(0.55)',
      class: 'obj-badge', stroke: color, 'pointer-events': 'none'
    }, parent);
    paths.forEach(function (p) {
      if (typeof p === 'string') svg('path', { d: p }, g);
      else svg(p.tag, p.attrs, g);
    });
    return g;
  }

  /* ---------------------------------------------------------- dragging   */

  function startObjectDrag(e, id) {
    var obj = store.getObject(id);
    if (!obj) return;
    store.setSelected(id);
    if (obj.locked) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    drag = { id: id, startX: e.clientX, startY: e.clientY, origX: obj.xCm, origY: obj.yCm, moved: false };
    store.beginTransaction();
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  function onDragMove(e) {
    if (!drag) return;
    e.preventDefault();
    var dx = (e.clientX - drag.startX) / view.scale;
    var dy = (e.clientY - drag.startY) / view.scale;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 0.5) return;
    drag.moved = true;
    store.moveObjectClamped(drag.id, drag.origX + dx, drag.origY + dy, { history: false });
  }

  function endDrag() {
    if (!drag) return;
    drag = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    store.endTransaction();
    render();
  }

  function startOpeningDrag(e, id) {
    var op = store.getOpening(id);
    if (!op) return;
    e.preventDefault();
    e.stopPropagation();
    openingDrag = { id: id, startX: e.clientX, startY: e.clientY, origOffset: op.offsetCm, wall: op.wall };
    store.beginTransaction();
    window.addEventListener('pointermove', onOpeningDragMove);
    window.addEventListener('pointerup', endOpeningDrag);
    window.addEventListener('pointercancel', endOpeningDrag);
  }

  function onOpeningDragMove(e) {
    if (!openingDrag) return;
    e.preventDefault();
    var horizontal = openingDrag.wall === 'top' || openingDrag.wall === 'bottom';
    var delta = (horizontal ? e.clientX - openingDrag.startX : e.clientY - openingDrag.startY) / view.scale;
    store.updateOpening(openingDrag.id, { offsetCm: openingDrag.origOffset + delta }, { history: false });
  }

  function endOpeningDrag() {
    if (!openingDrag) return;
    openingDrag = null;
    window.removeEventListener('pointermove', onOpeningDragMove);
    window.removeEventListener('pointerup', endOpeningDrag);
    window.removeEventListener('pointercancel', endOpeningDrag);
    store.endTransaction();
    render();
  }

  function onObjectKeyDown(e, id) {
    var obj = store.getObject(id);
    if (!obj) return;
    var step = e.shiftKey ? 10 : 1;
    var handled = true;
    switch (e.key) {
      case 'ArrowLeft': store.moveObjectClamped(id, obj.xCm - step, obj.yCm); break;
      case 'ArrowRight': store.moveObjectClamped(id, obj.xCm + step, obj.yCm); break;
      case 'ArrowUp': store.moveObjectClamped(id, obj.xCm, obj.yCm - step); break;
      case 'ArrowDown': store.moveObjectClamped(id, obj.xCm, obj.yCm + step); break;
      case 'r': case 'R': store.rotateStep(id); break;
      case 'l': case 'L': store.lockObject(id, !obj.locked); break;
      case 'd': case 'D': store.duplicateObject(id); break;
      case 'Delete': case 'Backspace': store.removeObject(id); break;
      case 'Enter': case ' ': store.setSelected(id); break;
      case 'Escape': store.setSelected(null); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      refocusSelected();
    }
  }

  function refocusSelected() {
    var id = store.state.selectedId;
    if (!id) return;
    var node = els.plan.querySelector('.obj[data-id="' + cssEscape(id) + '"]');
    if (node && document.activeElement !== node) node.focus({ preventScroll: true });
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* ------------------------------------------------------------- header  */

  function renderHeader() {
    var st = store.state;
    setValue(els.roomName, st.plan.name);
    els.roomDims.textContent = st.plan.room.widthCm + ' × ' + st.plan.room.heightCm + ' cm';

    var result = store.validateLayout();
    var problems = result.collisions.length + result.violations.length;
    els.validBadge.classList.toggle('is-invalid', !result.valid);
    els.validLabel.textContent = result.valid
      ? 'Layout valid'
      : problems + (problems === 1 ? ' issue' : ' issues');

    els.btnLight.classList.toggle('is-on', st.lightEnabled);
    els.btnLightLabel.textContent = st.lightEnabled ? 'Window light on' : 'Window light off';
    els.btnUndo.disabled = !store.canUndo();
    els.btnRedo.disabled = !store.canRedo();
  }

  function renderLibrary() {
    var active = store.state.plan.template;
    Array.prototype.forEach.call(els.libTemplates.querySelectorAll('.tpl-row'), function (b) {
      b.classList.toggle('is-active', b.dataset.template === active);
    });
    els.customForm.hidden = !store.state.ui.customForm;
    els.btnCustomToggle.textContent = store.state.ui.customForm ? 'Cancel' : '+ Custom rectangle';
  }

  function buildPresets() {
    RP.PRESETS.forEach(function (p) {
      var btn = html('button', { class: 'preset', type: 'button', title: 'Add ' + p.label }, els.presetList);
      var thumb = html('span', { class: 'preset-thumb' }, btn);
      var s = Math.min(24 / p.w, 24 / p.h);
      var i = html('i', null, thumb);
      i.style.width = Math.max(Math.round(p.w * s), 6) + 'px';
      i.style.height = Math.max(Math.round(p.h * s), 6) + 'px';
      var text = html('span', { class: 'preset-text' }, btn);
      html('span', { class: 'preset-name', text: p.label }, text);
      html('span', { class: 'preset-dims', text: p.w + '×' + p.h + ' cm' }, text);
      var add = html('span', { class: 'preset-add' }, btn);
      icon(ICONS.plus, { width: 13, height: 13 }, add);
      btn.addEventListener('click', function () {
        var obj = store.addObject({ type: p.type, label: p.label, widthCm: p.w, heightCm: p.h });
        toast(obj.label + ' added');
      });
    });
  }

  /* ----------------------------------------------------------- inspector */

  function renderInspector() {
    var obj = store.getObject(store.state.selectedId);
    els.inspectorEmpty.hidden = !!obj;
    els.inspectorBody.hidden = !obj;
    els.summaryRow.hidden = !obj;
    els.summaryNote.hidden = !!obj;

    if (!obj) return;
    var room = store.state.plan.room;
    var fp = G.footprint(obj);

    setValue(els.inspLabel, obj.label);
    setValue(els.inspWidth, obj.widthCm);
    setValue(els.inspHeight, obj.heightCm);
    setValue(els.inspX, obj.xCm);
    setValue(els.inspY, obj.yCm);
    els.inspRotation.textContent = obj.rotation + '°';
    els.btnLockLabel.textContent = obj.locked ? 'Unlock' : 'Lock position';

    var walls = G.wallDistances(obj, room);
    els.roTop.textContent = walls.top + ' cm';
    els.roRight.textContent = walls.right + ' cm';
    els.roBottom.textContent = walls.bottom + ' cm';
    els.roLeft.textContent = walls.left + ' cm';
    var win = store.nearestWindowCm(obj.id);
    els.roWindow.textContent = win === null ? '—' : win + ' cm';
    var near = store.nearestObjectInfo(obj.id);
    els.roObject.textContent = near ? near.label + ', ' + near.distanceCm + ' cm' : '—';

    els.sumLabel.textContent = obj.label;
    els.sumSize.textContent = fp.w + ' × ' + fp.h + ' cm';
    els.sumPos.textContent = 'x ' + obj.xCm + ', y ' + obj.yCm;
    els.sumRot.textContent = obj.rotation + '°';
    els.sumLocked.textContent = obj.locked ? 'yes' : 'no';

    var editable = !obj.locked;
    [els.inspWidth, els.inspHeight, els.inspX, els.inspY].forEach(function (input) {
      input.disabled = !editable;
    });
  }

  /* -------------------------------------------------------------- tabs   */

  function renderTabs() {
    var st = store.state;
    els.app.dataset.tab = st.tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      var on = t.dataset.tab === st.tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    els.panelSummary.hidden = st.tab !== 'inspector';
    els.panelOpenings.hidden = st.tab !== 'openings';
    els.panelConstraints.hidden = st.tab !== 'constraints';

    var result = store.validateLayout();
    var count = result.collisions.length + result.violations.length;
    els.constraintsBadge.textContent = count ? ' (' + count + ')' : '';
  }

  /* --------------------------------------------------------- openings UI */

  function renderOpeningsPanel() {
    var openings = store.state.plan.openings;
    var signature = openings.map(function (o) { return o.id + ':' + o.type; }).join('|');

    if (signature !== openingsSignature) {
      openingsSignature = signature;
      els.openingsList.innerHTML = '';
      openings.forEach(function (op) { els.openingsList.appendChild(buildOpeningRow(op)); });
      if (!openings.length) {
        html('p', { class: 'muted-note', text: 'No doors or windows yet — add one below.' }, els.openingsList);
      }
    }
    openings.forEach(function (op) {
      var row = els.openingsList.querySelector('[data-opening="' + cssEscape(op.id) + '"]');
      if (!row) return;
      var wall = row.querySelector('.op-wall');
      var offset = row.querySelector('.op-offset');
      var width = row.querySelector('.op-width');
      if (document.activeElement !== wall) wall.value = op.wall;
      setValue(offset, op.offsetCm);
      setValue(width, op.widthCm);
    });
  }

  function buildOpeningRow(op) {
    var row = html('div', { class: 'opening-row', 'data-opening': op.id });
    html('span', { class: 'opening-type', text: op.type === 'door' ? 'Door' : 'Window' }, row);

    var wallField = html('label', { class: 'mini-field', text: 'Wall' }, row);
    var wall = html('select', { class: 'op-wall' }, wallField);
    ['top', 'right', 'bottom', 'left'].forEach(function (w) {
      var o = html('option', { value: w, text: w.charAt(0).toUpperCase() + w.slice(1) }, wall);
      if (w === op.wall) o.selected = true;
    });
    wall.addEventListener('change', function () { store.updateOpening(op.id, { wall: wall.value }); });

    var offsetField = html('label', { class: 'mini-field', text: 'Offset' }, row);
    var offsetRow = html('span', { class: 'field-row' }, offsetField);
    var offset = html('input', { type: 'number', class: 'mono op-offset', inputmode: 'numeric' }, offsetRow);
    offset.value = op.offsetCm;
    html('span', { class: 'unit', text: 'cm' }, offsetRow);
    offset.addEventListener('change', function () { store.updateOpening(op.id, { offsetCm: offset.value }); });

    var widthField = html('label', { class: 'mini-field', text: 'Width' }, row);
    var widthRow = html('span', { class: 'field-row' }, widthField);
    var width = html('input', { type: 'number', class: 'mono op-width', inputmode: 'numeric' }, widthRow);
    width.value = op.widthCm;
    html('span', { class: 'unit', text: 'cm' }, widthRow);
    width.addEventListener('change', function () { store.updateOpening(op.id, { widthCm: width.value }); });

    var remove = html('button', { class: 'icon-btn', type: 'button', title: 'Remove', 'aria-label': 'Remove ' + op.type }, row);
    icon(ICONS.close, { width: 12, height: 12 }, remove);
    remove.addEventListener('click', function () { store.removeOpening(op.id); });
    return row;
  }

  /* ------------------------------------------------------- constraints UI */

  function renderConstraintsPanel() {
    var st = store.state;
    var collisions = store.analyzeCollisions().messages;
    els.collisionBlock.hidden = collisions.length === 0;
    els.collisionList.innerHTML = '';
    collisions.forEach(function (m) {
      var row = html('div', { class: 'collision-row' }, els.collisionList);
      icon(ICONS.warn, { width: 14, height: 14 }, row);
      html('span', { text: m }, row);
    });

    els.constraintsList.innerHTML = '';
    var constraints = store.constraintsWithStatus();
    if (!constraints.length) {
      html('p', { class: 'muted-note', text: 'No constraints yet. Constraints are the rules an agent checks its work against.' }, els.constraintsList);
    }
    constraints.forEach(function (c) {
      var row = html('div', { class: 'constraint-row ' + (c.satisfied ? 'is-ok' : 'is-bad') }, els.constraintsList);
      icon(c.satisfied ? ICONS.check : ICONS.alert, { width: 16, height: 16 }, row);
      var text = html('div', { class: 'constraint-text' }, row);
      html('div', { class: 'constraint-title', text: c.text }, text);
      html('div', { class: 'constraint-detail', text: c.detail }, text);
      var rm = html('button', { class: 'icon-btn bare', type: 'button', title: 'Remove constraint', 'aria-label': 'Remove constraint' }, row);
      icon(ICONS.close, { width: 12, height: 12 }, rm);
      rm.addEventListener('click', function () { store.removeConstraint(c.id); });
    });

    var hasObjects = st.plan.objects.length > 0;
    els.btnConstraintToggle.hidden = !hasObjects;
    els.noObjectsNote.hidden = hasObjects;
    els.constraintForm.hidden = !st.ui.constraintForm;
    els.btnConstraintToggle.textContent = st.ui.constraintForm ? 'Cancel' : '+ Add constraint';
    if (st.ui.constraintForm) syncConstraintForm();
  }

  function syncConstraintForm() {
    var st = store.state;
    var objects = st.plan.objects;
    var openings = st.plan.openings;
    var signature = objects.map(function (o) { return o.id + ':' + o.label; }).join('|') + '#' +
      openings.map(function (o) { return o.id + ':' + o.type + ':' + o.wall; }).join('|');

    if (signature !== optionsSignature) {
      optionsSignature = signature;
      fillSelect(els.cfA, objects.map(function (o) { return { value: o.id, label: o.label }; }));
      fillSelect(els.cfB, objects.map(function (o) { return { value: o.id, label: o.label }; }));
      fillSelect(els.cfOpening, openings.map(function (o) {
        return { value: o.id, label: (o.type === 'door' ? 'Door' : 'Window') + ' · ' + o.wall + ' wall' };
      }));
      if (objects[1]) els.cfB.value = objects[1].id;
    }

    var type = els.cfType.value;
    var hasA = ['min_distance', 'near_window', 'against_wall', 'max_distance', 'facing', 'clearance_zone', 'centered_on_wall'].indexOf(type) !== -1;
    var hasB = ['min_distance', 'max_distance', 'facing'].indexOf(type) !== -1;
    els.cfAWrap.hidden = !hasA;
    els.cfBWrap.hidden = !hasB;
    els.cfDistanceWrap.hidden = type !== 'min_distance';
    els.cfMaxWrap.hidden = !(type === 'near_window' || type === 'max_distance');
    els.cfOpeningWrap.hidden = type !== 'keep_clear';
    els.cfClearanceWrap.hidden = !(type === 'keep_clear' || type === 'clearance_zone');
    els.cfSideWrap.hidden = type !== 'clearance_zone';
    els.cfWallWrap.hidden = type !== 'centered_on_wall';
    els.cfToleranceWrap.hidden = type !== 'centered_on_wall';
    els.cfALabel.textContent = type === 'facing' ? 'Should face' : 'Object';
    els.cfBLabel.textContent = type === 'facing' ? 'Toward' : 'And';
  }

  function fillSelect(select, options) {
    var previous = select.value;
    select.innerHTML = '';
    options.forEach(function (o) {
      html('option', { value: o.value, text: o.label }, select);
    });
    if (previous && options.some(function (o) { return o.value === previous; })) select.value = previous;
  }

  /* ---------------------------------------------------------- agent bits */

  function renderAgent() {
    var h = store.state.highlight;
    var on = h.ids.length > 0;
    els.agentBanner.hidden = !on;
    if (on) {
      els.agentBannerText.textContent = h.message ||
        (h.ids.length + (h.ids.length === 1 ? ' item is' : ' items are') + ' highlighted by the agent.');
    }
  }

  function setAgentStatus(status) {
    if (!els.agentChip) return;
    els.agentChip.classList.toggle('is-off', !status.connected);
    els.agentChipText.textContent = status.connected
      ? status.toolCount + ' agent tools'
      : 'Agent bridge only';
    els.agentChip.title = status.detail;
  }

  /* -------------------------------------------------------------- render */

  var scheduled = false;
  function render() {
    if (store.state.view !== 'app') return;
    renderHeader();
    renderLibrary();
    renderCanvas();
    renderInspector();
    renderTabs();
    renderOpeningsPanel();
    renderConstraintsPanel();
    renderAgent();
  }

  /* Coalesce bursts of changes into one paint. rAF alone is not enough: an
     agent can drive this page while it sits in a background tab, where rAF is
     throttled, so a timer backs it up. */
  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    var run = function () {
      if (!scheduled) return;
      scheduled = false;
      render();
    };
    requestAnimationFrame(run);
    setTimeout(run, 32);
  }

  /* ---------------------------------------------------------------- wire */

  function cacheEls() {
    els = {
      app: $('app'), start: $('start-screen'), toast: $('toast'),
      roomName: $('room-name'), roomDims: $('room-dims'),
      validBadge: $('valid-badge'), validLabel: $('valid-label'),
      agentChip: $('agent-chip'), agentChipText: $('agent-chip-text'),
      btnLight: $('btn-light'), btnLightLabel: $('btn-light-label'),
      btnUndo: $('btn-undo'), btnRedo: $('btn-redo'),
      btnExport: $('btn-export'), btnImport: $('btn-import'), importFile: $('import-file'),
      btnPng: $('btn-png'),
      btnReset: $('btn-reset'), btnHome: $('btn-home'),
      libTemplates: $('lib-templates'), presetList: $('preset-list'),
      btnCustomToggle: $('btn-custom-toggle'), customForm: $('custom-form'),
      customLabel: $('custom-label'), customWidth: $('custom-width'), customHeight: $('custom-height'),
      btnCustomAdd: $('btn-custom-add'),
      canvasWrap: $('canvas-wrap'), plan: $('plan'),
      agentBanner: $('agent-banner'), agentBannerText: $('agent-banner-text'),
      btnClearHighlights: $('btn-clear-highlights'),
      inspectorEmpty: $('inspector-empty'), inspectorBody: $('inspector-body'),
      inspLabel: $('insp-label'), inspWidth: $('insp-width'), inspHeight: $('insp-height'),
      inspX: $('insp-x'), inspY: $('insp-y'), inspRotation: $('insp-rotation'),
      btnRotate: $('btn-rotate'), btnLock: $('btn-lock'), btnLockLabel: $('btn-lock-label'),
      btnDuplicate: $('btn-duplicate'), btnDelete: $('btn-delete'),
      roTop: $('ro-top'), roRight: $('ro-right'), roBottom: $('ro-bottom'), roLeft: $('ro-left'),
      roWindow: $('ro-window'), roObject: $('ro-object'),
      constraintsBadge: $('constraints-badge'),
      panelSummary: $('panel-summary'), panelOpenings: $('panel-openings'), panelConstraints: $('panel-constraints'),
      summaryRow: $('summary-row'), summaryNote: $('summary-note'),
      sumLabel: $('sum-label'), sumSize: $('sum-size'), sumPos: $('sum-pos'), sumRot: $('sum-rot'), sumLocked: $('sum-locked'),
      openingsList: $('openings-list'), btnAddDoor: $('btn-add-door'), btnAddWindow: $('btn-add-window'),
      collisionBlock: $('collision-block'), collisionList: $('collision-list'),
      constraintsList: $('constraints-list'), btnConstraintToggle: $('btn-constraint-toggle'),
      noObjectsNote: $('no-objects-note'), constraintForm: $('constraint-form'),
      cfType: $('cf-type'), cfA: $('cf-a'), cfB: $('cf-b'), cfAWrap: $('cf-a-wrap'), cfBWrap: $('cf-b-wrap'),
      cfALabel: $('cf-a-label'), cfBLabel: $('cf-b-label'),
      cfDistance: $('cf-distance'), cfDistanceWrap: $('cf-distance-wrap'),
      cfMax: $('cf-max'), cfMaxWrap: $('cf-max-wrap'),
      cfOpening: $('cf-opening'), cfOpeningWrap: $('cf-opening-wrap'),
      cfClearance: $('cf-clearance'), cfClearanceWrap: $('cf-clearance-wrap'),
      cfSide: $('cf-side'), cfSideWrap: $('cf-side-wrap'),
      cfWall: $('cf-wall'), cfWallWrap: $('cf-wall-wrap'),
      cfTolerance: $('cf-tolerance'), cfToleranceWrap: $('cf-tolerance-wrap'),
      btnConstraintAdd: $('btn-constraint-add')
    };
  }

  function bindEvents() {
    els.roomName.addEventListener('change', function () { store.setRoomName(els.roomName.value); });
    els.btnLight.addEventListener('click', function () { store.toggleLight(); });
    els.btnUndo.addEventListener('click', function () { store.undo(); });
    els.btnRedo.addEventListener('click', function () { store.redo(); });
    els.btnReset.addEventListener('click', function () { store.resetRoom(); toast('Layout reset'); });
    els.btnHome.addEventListener('click', function () { store.setView('start'); RP.showView(); });

    els.btnExport.addEventListener('click', exportJson);
    els.btnPng.addEventListener('click', exportPng);
    els.btnImport.addEventListener('click', function () { els.importFile.click(); });
    els.importFile.addEventListener('change', importJson);

    Array.prototype.forEach.call(els.libTemplates.querySelectorAll('.tpl-row'), function (b) {
      b.addEventListener('click', function () {
        store.loadTemplate(b.dataset.template);
        toast(RP.TEMPLATES[b.dataset.template].label + ' template loaded');
      });
    });

    els.btnCustomToggle.addEventListener('click', function () {
      store.setUi({ customForm: !store.state.ui.customForm });
      if (store.state.ui.customForm) els.customLabel.focus();
    });
    els.btnCustomAdd.addEventListener('click', function () {
      var obj = store.addObject({
        type: 'custom',
        label: (els.customLabel.value || 'Custom item').trim() || 'Custom item',
        widthCm: els.customWidth.value,
        heightCm: els.customHeight.value
      });
      store.setUi({ customForm: false });
      toast(obj.label + ' added');
    });

    els.btnClearHighlights.addEventListener('click', function () { store.clearHighlights(); });

    els.inspLabel.addEventListener('change', function () {
      store.renameObject(store.state.selectedId, els.inspLabel.value);
    });
    els.inspWidth.addEventListener('change', function () {
      store.resizeObject(store.state.selectedId, els.inspWidth.value, null);
    });
    els.inspHeight.addEventListener('change', function () {
      store.resizeObject(store.state.selectedId, null, els.inspHeight.value);
    });
    els.inspX.addEventListener('change', function () {
      store.moveObject(store.state.selectedId, els.inspX.value, null);
    });
    els.inspY.addEventListener('change', function () {
      store.moveObject(store.state.selectedId, null, els.inspY.value);
    });
    els.btnRotate.addEventListener('click', function () { store.rotateStep(store.state.selectedId); });
    els.btnLock.addEventListener('click', function () {
      var obj = store.getObject(store.state.selectedId);
      if (obj) store.lockObject(obj.id, !obj.locked);
    });
    els.btnDuplicate.addEventListener('click', function () { store.duplicateObject(store.state.selectedId); });
    els.btnDelete.addEventListener('click', function () { store.removeObject(store.state.selectedId); });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { store.setTab(t.dataset.tab); });
    });

    els.btnAddDoor.addEventListener('click', function () { store.addOpening({ type: 'door', wall: 'bottom', offsetCm: 20, widthCm: 90 }); });
    els.btnAddWindow.addEventListener('click', function () { store.addOpening({ type: 'window', wall: 'right', offsetCm: 20, widthCm: 120 }); });

    els.btnConstraintToggle.addEventListener('click', function () {
      store.setUi({ constraintForm: !store.state.ui.constraintForm });
    });
    els.cfType.addEventListener('change', syncConstraintForm);
    els.btnConstraintAdd.addEventListener('click', function () {
      var type = els.cfType.value;
      var params = { type: type };
      if (type === 'min_distance') {
        params.objectAId = els.cfA.value; params.objectBId = els.cfB.value; params.distanceCm = els.cfDistance.value;
      } else if (type === 'near_window') {
        params.objectId = els.cfA.value; params.maxDistanceCm = els.cfMax.value;
      } else if (type === 'against_wall') {
        params.objectId = els.cfA.value;
      } else if (type === 'keep_clear') {
        params.openingId = els.cfOpening.value; params.clearanceCm = els.cfClearance.value;
      } else if (type === 'clearance_zone') {
        params.objectId = els.cfA.value; params.side = els.cfSide.value; params.clearanceCm = els.cfClearance.value;
      } else if (type === 'max_distance') {
        params.objectAId = els.cfA.value; params.objectBId = els.cfB.value; params.maxDistanceCm = els.cfMax.value;
      } else if (type === 'facing') {
        params.objectAId = els.cfA.value; params.objectBId = els.cfB.value;
      } else if (type === 'centered_on_wall') {
        params.objectId = els.cfA.value; params.wall = els.cfWall.value; params.toleranceCm = els.cfTolerance.value;
      }
      var created = store.addConstraint(params);
      if (created) {
        store.setUi({ constraintForm: false });
        toast('Constraint added');
      } else {
        toast('Pick two different objects for that constraint');
      }
    });

    window.addEventListener('resize', scheduleRender);
    document.addEventListener('keydown', onGlobalKeyDown);
  }

  function onGlobalKeyDown(e) {
    if (store.state.view !== 'app') return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    var mod = e.metaKey || e.ctrlKey;

    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
      return;
    }
    if (typing) return;
    if (e.key === 'Escape') { store.setSelected(null); return; }
    if (!store.state.selectedId) return;
    if (document.activeElement && document.activeElement.classList &&
        document.activeElement.classList.contains('obj')) return; /* handled per-object */
    onObjectKeyDown(e, store.state.selectedId);
  }

  function exportJson() {
    var plan = store.exportPlan();
    var blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Layout exported');
  }

  function exportPng() {
    RP.exporter.capture({ format: 'png', scale: 2, download: true })
      .then(function (result) { toast('Saved ' + result.filename); })
      .catch(function (err) { toast('Could not save the image: ' + err.message); });
  }

  function importJson(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        store.importPlan(JSON.parse(reader.result));
        RP.showView();
        toast('Layout imported');
      } catch (err) {
        toast('That file is not a valid layout JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  RP.ui = {
    init: function () {
      cacheEls();
      buildPresets();
      bindEvents();
      store.subscribe(scheduleRender);
    },
    render: render,
    scheduleRender: scheduleRender,
    toast: toast,
    setAgentStatus: setAgentStatus
  };
})(window);
