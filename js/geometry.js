/* Room Planner — geometry helpers.
   Everything here is pure: it takes plain data in centimetres and returns
   numbers. Both the UI and the WebMCP tools call into these, so the agent and
   the human always reason about the same room. */
(function (global) {
  'use strict';

  var RP = global.RP || (global.RP = {});

  /** Footprint after rotation: 90/270 swap width and depth. */
  function footprint(obj) {
    if (obj.rotation === 90 || obj.rotation === 270) {
      return { w: obj.heightCm, h: obj.widthCm };
    }
    return { w: obj.widthCm, h: obj.heightCm };
  }

  /** Axis-aligned rectangle an object actually occupies. */
  function rectOf(obj) {
    var fp = footprint(obj);
    return { x: obj.xCm, y: obj.yCm, w: fp.w, h: fp.h };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** Shortest edge-to-edge distance; 0 when the rectangles overlap. */
  function rectDistance(a, b) {
    var dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
    var dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
    if (dx === 0 && dy === 0) return 0;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function wallDistances(obj, room) {
    var r = rectOf(obj);
    return {
      top: Math.round(r.y),
      right: Math.round(room.widthCm - (r.x + r.w)),
      bottom: Math.round(room.heightCm - (r.y + r.h)),
      left: Math.round(r.x)
    };
  }

  function isAgainstWall(obj, room, toleranceCm) {
    var t = toleranceCm === undefined ? 3 : toleranceCm;
    var d = wallDistances(obj, room);
    return d.top <= t || d.right <= t || d.bottom <= t || d.left <= t;
  }

  function isOutOfBounds(obj, room) {
    var r = rectOf(obj);
    return r.x < 0 || r.y < 0 || r.x + r.w > room.widthCm || r.y + r.h > room.heightCm;
  }

  /** An opening is a zero-thickness segment on a wall, expressed as a rect. */
  function openingRect(op, room) {
    if (op.wall === 'top') return { x: op.offsetCm, y: 0, w: op.widthCm, h: 0 };
    if (op.wall === 'bottom') return { x: op.offsetCm, y: room.heightCm, w: op.widthCm, h: 0 };
    if (op.wall === 'left') return { x: 0, y: op.offsetCm, w: 0, h: op.widthCm };
    return { x: room.widthCm, y: op.offsetCm, w: 0, h: op.widthCm };
  }

  /** The strip in front of an opening that should stay empty. */
  function keepClearRect(op, room, clearanceCm) {
    var c = Math.max(0, clearanceCm);
    if (op.wall === 'top') return { x: op.offsetCm, y: 0, w: op.widthCm, h: c };
    if (op.wall === 'bottom') return { x: op.offsetCm, y: room.heightCm - c, w: op.widthCm, h: c };
    if (op.wall === 'left') return { x: 0, y: op.offsetCm, w: c, h: op.widthCm };
    return { x: room.widthCm - c, y: op.offsetCm, w: c, h: op.widthCm };
  }

  function distanceToOpening(obj, op, room) {
    return rectDistance(rectOf(obj), openingRect(op, room));
  }

  /** The side an object's "front" points to, derived from its rotation. */
  var FRONT_SIDES = ['bottom', 'left', 'top', 'right'];
  function frontSide(obj) {
    var i = [0, 90, 180, 270].indexOf(obj.rotation);
    return FRONT_SIDES[i === -1 ? 0 : i];
  }

  /** The strip that extends outward from one side of a rect, e.g. the swing
      space in front of a wardrobe door or the leg room in front of a desk. */
  function sideRect(rect, side, depthCm) {
    var d = Math.max(0, depthCm);
    if (side === 'top') return { x: rect.x, y: rect.y - d, w: rect.w, h: d };
    if (side === 'bottom') return { x: rect.x, y: rect.y + rect.h, w: rect.w, h: d };
    if (side === 'left') return { x: rect.x - d, y: rect.y, w: d, h: rect.h };
    return { x: rect.x + rect.w, y: rect.y, w: d, h: rect.h };
  }

  /** True when targetRect sits beyond subjRect's given side and overlaps its span. */
  function isFacing(subjRect, side, targetRect) {
    if (side === 'top') {
      return targetRect.y + targetRect.h <= subjRect.y &&
        targetRect.x < subjRect.x + subjRect.w && targetRect.x + targetRect.w > subjRect.x;
    }
    if (side === 'bottom') {
      return targetRect.y >= subjRect.y + subjRect.h &&
        targetRect.x < subjRect.x + subjRect.w && targetRect.x + targetRect.w > subjRect.x;
    }
    if (side === 'left') {
      return targetRect.x + targetRect.w <= subjRect.x &&
        targetRect.y < subjRect.y + subjRect.h && targetRect.y + targetRect.h > subjRect.y;
    }
    return targetRect.x >= subjRect.x + subjRect.w &&
      targetRect.y < subjRect.y + subjRect.h && targetRect.y + targetRect.h > subjRect.y;
  }

  function touchesWall(obj, room, wall, toleranceCm) {
    var t = toleranceCm === undefined ? 3 : toleranceCm;
    return wallDistances(obj, room)[wall] <= t;
  }

  /** Signed offset (cm) of an object's centre from the midpoint of the given wall. */
  function centerOffsetOnWall(obj, wall, room) {
    var r = rectOf(obj);
    if (wall === 'top' || wall === 'bottom') return (r.x + r.w / 2) - room.widthCm / 2;
    return (r.y + r.h / 2) - room.heightCm / 2;
  }

  /** Longest wall run an opening can slide along. */
  function wallLength(wall, room) {
    return (wall === 'top' || wall === 'bottom') ? room.widthCm : room.heightCm;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  RP.geometry = {
    footprint: footprint,
    rectOf: rectOf,
    rectsOverlap: rectsOverlap,
    rectDistance: rectDistance,
    wallDistances: wallDistances,
    isAgainstWall: isAgainstWall,
    isOutOfBounds: isOutOfBounds,
    openingRect: openingRect,
    keepClearRect: keepClearRect,
    distanceToOpening: distanceToOpening,
    wallLength: wallLength,
    clamp: clamp,
    frontSide: frontSide,
    sideRect: sideRect,
    isFacing: isFacing,
    touchesWall: touchesWall,
    centerOffsetOnWall: centerOffsetOnWall
  };
})(window);
