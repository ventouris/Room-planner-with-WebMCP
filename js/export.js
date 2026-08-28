/* Room Planner — floor-plan image export.

   Turns the live SVG into a standalone image an agent can hand back to a
   person: a self-contained .svg, or a rasterised .png. The on-screen plan is
   styled with CSS classes and oklch() colours, so exporting means resolving
   every computed style onto the element itself and converting the colours to
   plain sRGB — otherwise the file only renders correctly inside this page. */
(function (global) {
  'use strict';

  var RP = global.RP || (global.RP = {});
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* Only the properties that can actually change how a static plan looks, and
     only on the elements they apply to — otherwise every node picks up a dozen
     browser defaults and the file triples in size. */
  var PAINT_PROPS = [
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
    'stroke-linecap', 'stroke-linejoin',
    'opacity', 'filter'
  ];
  var TEXT_PROPS = [
    'font-family', 'font-size', 'font-weight', 'font-style',
    'letter-spacing', 'text-anchor', 'dominant-baseline'
  ];
  var STOP_PROPS = ['stop-color', 'stop-opacity'];

  /* Values equal to these are the renderer's own defaults — writing them out
     changes nothing. */
  var DEFAULTS = {
    'fill': 'rgb(0, 0, 0)', 'fill-opacity': '1', 'fill-rule': 'nonzero',
    'stroke': 'none', 'stroke-opacity': '1', 'stroke-width': '1',
    'stroke-dasharray': 'none', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter',
    'opacity': '1', 'filter': 'none',
    'font-size': '16', 'font-weight': '400', 'font-style': 'normal',
    'letter-spacing': 'normal', 'text-anchor': 'start', 'dominant-baseline': 'auto',
    'stop-color': 'rgb(0, 0, 0)', 'stop-opacity': '1'
  };

  /* Containers and filter primitives inherit nothing worth freezing. */
  var STRUCTURAL = { svg: 1, defs: 1, filter: 1, fegaussianblur: 1, lineargradient: 1, title: 1, desc: 1 };

  function propsFor(el) {
    var tag = (el.localName || '').toLowerCase();
    if (tag === 'stop') return STOP_PROPS;
    if (STRUCTURAL[tag]) return [];
    if (tag === 'text' || tag === 'tspan') return PAINT_PROPS.concat(TEXT_PROPS);
    return PAINT_PROPS;
  }

  /* Colours carrying alpha fold into the matching *-opacity property. */
  var ALPHA_TARGET = { fill: 'fill-opacity', stroke: 'stroke-opacity', 'stop-color': 'stop-opacity' };

  var colorCache = {};

  function srgb(c) {
    var v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  /** oklch(L C H[ / A]) → { color: 'rgb(r, g, b)', alpha }. */
  function oklchToRgb(str) {
    var m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i.exec(str.trim());
    if (!m) return null;
    var L = m[1].indexOf('%') !== -1 ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    var C = m[2].indexOf('%') !== -1 ? parseFloat(m[2]) / 100 * 0.4 : parseFloat(m[2]);
    var H = parseFloat(m[3]) * Math.PI / 180;
    var alpha = m[4] === undefined ? 1 : (m[4].indexOf('%') !== -1 ? parseFloat(m[4]) / 100 : parseFloat(m[4]));

    var a = C * Math.cos(H), b = C * Math.sin(H);
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    var l = l_ * l_ * l_, mm = m_ * m_ * m_, s = s_ * s_ * s_;

    return {
      color: 'rgb(' +
        srgb(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s) + ', ' +
        srgb(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s) + ', ' +
        srgb(-0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s) + ')',
      alpha: alpha
    };
  }

  /** Normalise any computed colour into an SVG-safe colour plus alpha. */
  function normalizeColor(value) {
    if (colorCache[value]) return colorCache[value];
    var out = { color: value, alpha: 1 };
    if (/^oklch\(/i.test(value)) {
      out = oklchToRgb(value) || out;
    } else {
      var rgba = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value);
      if (rgba && rgba[4] !== undefined) {
        var a = rgba[4].indexOf('%') !== -1 ? parseFloat(rgba[4]) / 100 : parseFloat(rgba[4]);
        out = { color: 'rgb(' + rgba[1] + ', ' + rgba[2] + ', ' + rgba[3] + ')', alpha: a };
      }
    }
    colorCache[value] = out;
    return out;
  }

  function cleanLength(value) {
    return typeof value === 'string' ? value.replace(/px\b/g, '') : value;
  }

  /** Copy computed styles from the live tree onto the clone, element by element. */
  function inlineStyles(src, dst) {
    var computed = global.getComputedStyle(src);
    var pending = {};

    propsFor(src).forEach(function (prop) {
      var value = computed.getPropertyValue(prop);
      if (!value) return;

      if (ALPHA_TARGET[prop] && value !== 'none' && value.indexOf('url(') !== 0) {
        var normalized = normalizeColor(value);
        value = normalized.color;
        if (normalized.alpha < 1) pending[ALPHA_TARGET[prop]] = normalized.alpha;
      }
      if (prop === 'filter') value = value.replace(/["']/g, '');
      if (prop === 'stroke-width' || prop === 'font-size' ||
          prop === 'letter-spacing' || prop === 'stroke-dasharray') {
        value = cleanLength(value);
      }
      if (DEFAULTS[prop] === value) return;

      dst.setAttribute(prop, value);
    });

    /* A colour's own alpha multiplies whatever opacity was already there. */
    Object.keys(pending).forEach(function (prop) {
      var existing = parseFloat(dst.getAttribute(prop));
      var base = isNaN(existing) ? 1 : existing;
      dst.setAttribute(prop, String(Math.round(base * pending[prop] * 1000) / 1000));
    });

    ['class', 'tabindex', 'role', 'style', 'data-id', 'aria-label'].forEach(function (attr) {
      dst.removeAttribute(attr);
    });

    var srcKids = src.children, dstKids = dst.children;
    for (var i = 0; i < srcKids.length && i < dstKids.length; i++) {
      inlineStyles(srcKids[i], dstKids[i]);
    }
  }

  function planNode() {
    var node = document.getElementById('plan');
    if (!node) throw new Error('The floor plan is not on screen yet.');
    return node;
  }

  /**
   * Serialise the current floor plan as a standalone SVG document.
   * @param {{background?: 'paper'|'transparent', title?: string}} [options]
   */
  function serializeSvg(options) {
    var opts = options || {};
    var src = planNode();
    var width = Number(src.getAttribute('width'));
    var height = Number(src.getAttribute('height'));
    var clone = src.cloneNode(true);

    inlineStyles(src, clone);

    /* Invisible hit targets have no business in an exported image. */
    Array.prototype.slice.call(clone.querySelectorAll('[stroke="transparent"]')).forEach(function (n) {
      n.parentNode.removeChild(n);
    });

    clone.setAttribute('xmlns', SVGNS);
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    clone.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    clone.removeAttribute('id');

    if (opts.background !== 'transparent') {
      var paper = global.getComputedStyle(document.body).getPropertyValue('--paper').trim() || '#faf7f1';
      var bg = document.createElementNS(SVGNS, 'rect');
      bg.setAttribute('x', 0); bg.setAttribute('y', 0);
      bg.setAttribute('width', width); bg.setAttribute('height', height);
      bg.setAttribute('fill', normalizeColor(paper).color);
      clone.insertBefore(bg, clone.firstChild);
    }

    var plan = RP.store.state.plan;
    var title = document.createElementNS(SVGNS, 'title');
    title.textContent = opts.title || (plan.name + ' — ' + plan.room.widthCm + ' × ' + plan.room.heightCm + ' cm');
    clone.insertBefore(title, clone.firstChild);

    return {
      svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone),
      width: width,
      height: height
    };
  }

  /** Rasterise the serialised SVG through an offscreen canvas. */
  function toPng(options) {
    var opts = options || {};
    var scale = Math.max(0.25, Math.min(4, Number(opts.scale) || 2));
    var out = serializeSvg(opts);

    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(out.width * scale);
          canvas.height = Math.round(out.height * scale);
          var ctx = canvas.getContext('2d');
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.drawImage(img, 0, 0);
          resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
        } catch (err) { reject(err); }
      };
      img.onerror = function () { reject(new Error('Could not rasterise the floor plan.')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg);
    });
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'floorplan';
  }

  function triggerDownload(dataUrl, filename) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Capture the floor plan.
   * @param {{format?:'png'|'svg', scale?:number, background?:'paper'|'transparent',
   *          download?:boolean, filename?:string}} [options]
   */
  function capture(options) {
    var opts = options || {};
    var format = opts.format === 'svg' ? 'svg' : 'png';
    var plan = RP.store.state.plan;
    var filename = opts.filename || (slug(plan.name) + '.' + format);

    var work = format === 'svg'
      ? Promise.resolve(serializeSvg(opts)).then(function (out) {
          return {
            dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg),
            width: out.width,
            height: out.height,
            text: out.svg
          };
        })
      : toPng(opts);

    return work.then(function (out) {
      var result = {
        format: format,
        widthPx: out.width,
        heightPx: out.height,
        byteLength: out.text ? out.text.length : Math.round((out.dataUrl.length - out.dataUrl.indexOf(',') - 1) * 3 / 4),
        filename: filename,
        roomCm: { widthCm: plan.room.widthCm, heightCm: plan.room.heightCm }
      };
      if (opts.download) {
        triggerDownload(out.dataUrl, filename);
        result.downloaded = true;
        return result;
      }
      result.dataUrl = out.dataUrl;
      return result;
    });
  }

  RP.exporter = {
    serializeSvg: serializeSvg,
    toPng: toPng,
    capture: capture
  };
})(window);
