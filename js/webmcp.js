/* Room Planner — WebMCP surface.

   Every tool here reads and writes the same plan the canvas renders, so an
   agent's edits are immediately visible to the person watching the screen.

   Registration order:
     1. `navigator.modelContext` — the WebMCP entry point browsers expose.
     2. `document.modelContext`  — the form used in the product spec.
     3. a local shim, so the tools still exist (and stay callable through
        `window.roomPlanner`) when no WebMCP host is present. */
(function (global) {
  'use strict';

  var RP = global.RP || (global.RP = {});
  var store = RP.store;

  /* --------------------------------------------------------- result shape */

  function ok(data) {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      structuredContent: data
    };
  }

  function fail(message) {
    return {
      content: [{ type: 'text', text: message }],
      structuredContent: { error: message },
      isError: true
    };
  }

  /** Mutations answer with what changed *and* the fresh validation result. */
  function okWithValidation(data) {
    return ok(Object.assign({}, data, { validation: store.validateLayout() }));
  }

  function requireObject(id) {
    var obj = store.getObject(id);
    if (obj) return obj;
    var known = store.state.plan.objects.map(function (o) { return o.id; });
    throw new Error('No object with id "' + id + '". Known ids: ' + (known.length ? known.join(', ') : '(none)'));
  }

  /* ---------------------------------------------------------------- tools */

  var ROTATION = { type: 'number', enum: [0, 90, 180, 270], description: 'Rotation in degrees.' };
  var OBJECT_ID = { type: 'string', description: 'Id of a furniture object, e.g. "desk-1".' };

  function buildTools() {
    return [
      /* ---------------------------------------------------------- reads */
      {
        name: 'get_room',
        description: 'Get the room dimensions in centimetres. Coordinates start at the top-left corner of the room.',
        inputSchema: { type: 'object', properties: {} },
        execute: function () {
          var plan = store.state.plan;
          return ok({ name: plan.name, widthCm: plan.room.widthCm, heightCm: plan.room.heightCm });
        }
      },
      {
        name: 'get_openings',
        description: 'List the doors and windows, with the wall each sits on, its offset along that wall, and its width in centimetres.',
        inputSchema: { type: 'object', properties: {} },
        execute: function () { return ok(store.exportPlan().openings); }
      },
      {
        name: 'get_objects',
        description: 'List every furniture object with its position, footprint, rotation and locked flag.',
        inputSchema: { type: 'object', properties: {} },
        execute: function () { return ok(store.exportPlan().objects); }
      },
      {
        name: 'get_object',
        description: 'Get one furniture object by id.',
        inputSchema: { type: 'object', properties: { objectId: OBJECT_ID }, required: ['objectId'] },
        execute: function (input) { return ok(Object.assign({}, requireObject(input.objectId))); }
      },
      {
        name: 'get_constraints',
        description: 'List the layout constraints, each with a human-readable description and whether it is currently satisfied.',
        inputSchema: { type: 'object', properties: {} },
        execute: function () { return ok(store.constraintsWithStatus()); }
      },
      {
        name: 'get_collisions',
        description: 'List overlapping furniture, objects outside the room bounds, and objects blocking a door clearance zone.',
        inputSchema: { type: 'object', properties: {} },
        execute: function () { return ok(store.analyzeCollisions().messages); }
      },
      {
        name: 'get_distances',
        description: 'Distances for one object: to each wall, to every other object (nearest first), to each opening, and to the nearest window.',
        inputSchema: { type: 'object', properties: { objectId: OBJECT_ID }, required: ['objectId'] },
        execute: function (input) {
          requireObject(input.objectId);
          return ok(store.distancesFor(input.objectId));
        }
      },
      {
        name: 'validate_layout',
        description: 'Check the whole layout: returns valid plus the current collisions and constraint violations.',
        inputSchema: { type: 'object', properties: {} },
        execute: function () { return ok(store.validateLayout()); }
      },

      /* ------------------------------------------------------ mutations */
      {
        name: 'set_room_dimensions',
        description: 'Resize the room. Furniture keeps its coordinates, so shrinking a room can push objects out of bounds.',
        inputSchema: {
          type: 'object',
          properties: { widthCm: { type: 'number' }, heightCm: { type: 'number' } },
          required: ['widthCm', 'heightCm']
        },
        execute: function (input) {
          return okWithValidation({ room: store.setRoomDimensions(input.widthCm, input.heightCm) });
        }
      },
      {
        name: 'add_object',
        description: 'Add a piece of furniture. Known types (bed, desk, chair, sofa, table, wardrobe, bookshelf, nightstand) fill in default dimensions when width and depth are omitted. Position defaults to a free-ish spot near the top-left.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'bed | desk | chair | sofa | table | wardrobe | bookshelf | nightstand | custom' },
            label: { type: 'string' },
            xCm: { type: 'number' }, yCm: { type: 'number' },
            widthCm: { type: 'number' }, heightCm: { type: 'number', description: 'Depth in centimetres.' },
            rotation: ROTATION
          },
          required: ['type']
        },
        execute: function (input) { return okWithValidation({ object: store.addObject(input) }); }
      },
      {
        name: 'move_object',
        description: 'Move an object to an absolute position (top-left corner, in centimetres) and re-validate the layout.',
        inputSchema: {
          type: 'object',
          properties: { objectId: OBJECT_ID, xCm: { type: 'number' }, yCm: { type: 'number' } },
          required: ['objectId', 'xCm', 'yCm']
        },
        execute: function (input) {
          requireObject(input.objectId);
          var res = store.moveObject(input.objectId, input.xCm, input.yCm);
          if (!res.ok) return fail(res.reason);
          return okWithValidation({ object: store.getObject(input.objectId) });
        }
      },
      {
        name: 'rotate_object',
        description: 'Rotate an object to 0, 90, 180 or 270 degrees. At 90 and 270 its width and depth swap.',
        inputSchema: {
          type: 'object',
          properties: { objectId: OBJECT_ID, rotation: ROTATION },
          required: ['objectId', 'rotation']
        },
        execute: function (input) {
          requireObject(input.objectId);
          var res = store.rotateObject(input.objectId, input.rotation);
          if (!res.ok) return fail(res.reason);
          return okWithValidation({ object: store.getObject(input.objectId) });
        }
      },
      {
        name: 'resize_object',
        description: 'Change an object width and/or depth in centimetres.',
        inputSchema: {
          type: 'object',
          properties: { objectId: OBJECT_ID, widthCm: { type: 'number' }, heightCm: { type: 'number' } },
          required: ['objectId']
        },
        execute: function (input) {
          requireObject(input.objectId);
          var res = store.resizeObject(input.objectId, input.widthCm, input.heightCm);
          if (!res.ok) return fail(res.reason);
          return okWithValidation({ object: store.getObject(input.objectId) });
        }
      },
      {
        name: 'rename_object',
        description: 'Rename an object. The label is what the person sees on the canvas.',
        inputSchema: {
          type: 'object',
          properties: { objectId: OBJECT_ID, label: { type: 'string' } },
          required: ['objectId', 'label']
        },
        execute: function (input) {
          requireObject(input.objectId);
          store.renameObject(input.objectId, input.label);
          return ok({ object: Object.assign({}, store.getObject(input.objectId)) });
        }
      },
      {
        name: 'remove_object',
        description: 'Remove an object from the room. Constraints that referenced it are removed too.',
        inputSchema: { type: 'object', properties: { objectId: OBJECT_ID }, required: ['objectId'] },
        execute: function (input) {
          requireObject(input.objectId);
          store.removeObject(input.objectId);
          return okWithValidation({ removed: input.objectId });
        }
      },
      {
        name: 'duplicate_object',
        description: 'Duplicate an object, offset 20 cm down and right, and return the copy.',
        inputSchema: { type: 'object', properties: { objectId: OBJECT_ID }, required: ['objectId'] },
        execute: function (input) {
          requireObject(input.objectId);
          return okWithValidation({ object: store.duplicateObject(input.objectId) });
        }
      },
      {
        name: 'lock_object',
        description: 'Lock or unlock an object. A locked object cannot be moved, rotated or resized — by the agent or by dragging.',
        inputSchema: {
          type: 'object',
          properties: { objectId: OBJECT_ID, locked: { type: 'boolean' } },
          required: ['objectId', 'locked']
        },
        execute: function (input) {
          requireObject(input.objectId);
          store.lockObject(input.objectId, input.locked);
          return ok({ object: Object.assign({}, store.getObject(input.objectId)) });
        }
      },
      {
        name: 'add_opening',
        description: 'Add a door or a window to one of the four walls. offsetCm is measured from the top or left end of that wall.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['door', 'window'] },
            wall: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] },
            offsetCm: { type: 'number' },
            widthCm: { type: 'number' }
          },
          required: ['type', 'wall']
        },
        execute: function (input) { return okWithValidation({ opening: store.addOpening(input) }); }
      },
      {
        name: 'update_opening',
        description: 'Move or resize a door or window.',
        inputSchema: {
          type: 'object',
          properties: {
            openingId: { type: 'string' },
            wall: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] },
            offsetCm: { type: 'number' },
            widthCm: { type: 'number' }
          },
          required: ['openingId']
        },
        execute: function (input) {
          if (!store.getOpening(input.openingId)) return fail('No opening with id "' + input.openingId + '".');
          var patch = {};
          if (input.wall) patch.wall = input.wall;
          if (input.offsetCm !== undefined) patch.offsetCm = input.offsetCm;
          if (input.widthCm !== undefined) patch.widthCm = input.widthCm;
          return okWithValidation({ opening: store.updateOpening(input.openingId, patch) });
        }
      },
      {
        name: 'remove_opening',
        description: 'Remove a door or window, along with any keep-clear constraint attached to it.',
        inputSchema: { type: 'object', properties: { openingId: { type: 'string' } }, required: ['openingId'] },
        execute: function (input) {
          if (!store.getOpening(input.openingId)) return fail('No opening with id "' + input.openingId + '".');
          store.removeOpening(input.openingId);
          return okWithValidation({ removed: input.openingId });
        }
      },
      {
        name: 'add_constraint',
        description: 'Add a layout rule. min_distance needs objectAId, objectBId and distanceCm; near_window needs objectId and maxDistanceCm; against_wall needs objectId; keep_clear needs openingId and clearanceCm; clearance_zone needs objectId, side and clearanceCm — a functional clearance on one side of a piece of furniture (wardrobe door swing, desk chair pull-out, drawer access) rather than a door; max_distance needs objectAId, objectBId and maxDistanceCm — keeps two objects near each other, e.g. a nightstand near a bed; facing needs objectAId and objectBId — objectA\'s front (derived from its rotation: 0°=bottom, 90°=left, 180°=top, 270°=right) must point toward objectB, e.g. a chair facing a desk; centered_on_wall needs objectId, wall and toleranceCm — the object must touch that wall and sit centred along it.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['min_distance', 'near_window', 'against_wall', 'keep_clear', 'clearance_zone', 'max_distance', 'facing', 'centered_on_wall'] },
            objectAId: { type: 'string' }, objectBId: { type: 'string' },
            objectId: { type: 'string' }, openingId: { type: 'string' },
            side: { type: 'string', enum: ['top', 'right', 'bottom', 'left'], description: 'Which side of the object the clearance_zone extends from.' },
            wall: { type: 'string', enum: ['top', 'right', 'bottom', 'left'], description: 'Which wall the object should be centered on.' },
            distanceCm: { type: 'number' }, maxDistanceCm: { type: 'number' }, clearanceCm: { type: 'number' },
            toleranceCm: { type: 'number', description: 'Allowed off-centre slack for centered_on_wall, in centimetres.' }
          },
          required: ['type']
        },
        execute: function (input) {
          var created = store.addConstraint(input);
          if (!created) return fail('Could not create that constraint — check the referenced ids and that the two objects differ.');
          return okWithValidation({ constraint: created });
        }
      },
      {
        name: 'update_constraint',
        description: 'Change the values on an existing constraint.',
        inputSchema: {
          type: 'object',
          properties: {
            constraintId: { type: 'string' },
            distanceCm: { type: 'number' }, maxDistanceCm: { type: 'number' }, clearanceCm: { type: 'number' }, toleranceCm: { type: 'number' },
            objectAId: { type: 'string' }, objectBId: { type: 'string' },
            objectId: { type: 'string' }, openingId: { type: 'string' },
            side: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] },
            wall: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] }
          },
          required: ['constraintId']
        },
        execute: function (input) {
          if (!store.getConstraint(input.constraintId)) return fail('No constraint with id "' + input.constraintId + '".');
          var patch = Object.assign({}, input);
          delete patch.constraintId;
          return okWithValidation({ constraint: store.updateConstraint(input.constraintId, patch) });
        }
      },
      {
        name: 'remove_constraint',
        description: 'Remove a layout constraint.',
        inputSchema: { type: 'object', properties: { constraintId: { type: 'string' } }, required: ['constraintId'] },
        execute: function (input) {
          if (!store.getConstraint(input.constraintId)) return fail('No constraint with id "' + input.constraintId + '".');
          store.removeConstraint(input.constraintId);
          return okWithValidation({ removed: input.constraintId });
        }
      },
      {
        name: 'highlight_objects',
        description: 'Draw attention to objects or openings on the canvas and show the person a short message explaining why.',
        inputSchema: {
          type: 'object',
          properties: {
            objectIds: { type: 'array', items: { type: 'string' }, description: 'Object or opening ids.' },
            message: { type: 'string', description: 'Shown above the room, e.g. "These three items drive the layout."' }
          },
          required: ['objectIds']
        },
        execute: function (input) { return ok(store.highlight(input.objectIds, input.message)); }
      },
      {
        name: 'clear_highlights',
        description: 'Clear the highlight banner and outlines.',
        inputSchema: { type: 'object', properties: {} },
        execute: function () { store.clearHighlights(); return ok({ cleared: true }); }
      },

      /* ------------------------------------------------------- capture */
      {
        name: 'capture_floorplan',
        description: 'Render the floor plan on its own — no app chrome — as a PNG or a standalone SVG, and return it as a data URL the caller can save to a file. Pass download:true to have the browser save it instead, which keeps the (large) data URL out of the reply.',
        inputSchema: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['png', 'svg'], description: 'Default png.' },
            scale: { type: 'number', description: 'PNG pixel density, 0.25–4. Default 2.' },
            background: { type: 'string', enum: ['paper', 'transparent'], description: 'Default paper.' },
            download: { type: 'boolean', description: 'Save via the browser instead of returning the image data.' },
            filename: { type: 'string' }
          }
        },
        execute: function (input) {
          return RP.exporter.capture(input || {}).then(function (result) { return ok(result); });
        }
      }
    ];
  }

  /* ----------------------------------------------------------------- shim */

  function createShim() {
    var registry = [];
    var target = {
      __roomPlannerShim: true,
      registerTool: function (tool) {
        registry = registry.filter(function (t) { return t.name !== tool.name; });
        registry.push(tool);
        notify();
        return { unregister: function () { target.unregisterTool(tool.name); } };
      },
      unregisterTool: function (name) {
        registry = registry.filter(function (t) { return t.name !== name; });
        notify();
      },
      provideContext: function (context) {
        registry = (context && context.tools) ? context.tools.slice() : [];
        notify();
      },
      listTools: function () {
        return registry.map(function (t) {
          return { name: t.name, description: t.description, inputSchema: t.inputSchema };
        });
      },
      callTool: function (name, args) {
        var tool = registry.filter(function (t) { return t.name === name; })[0];
        if (!tool) return Promise.reject(new Error('Unknown tool "' + name + '".'));
        return Promise.resolve().then(function () { return tool.execute(args || {}); });
      },
      get tools() { return registry.slice(); }
    };

    function notify() {
      try {
        global.dispatchEvent(new CustomEvent('modelcontextchange', {
          detail: { tools: target.listTools() }
        }));
      } catch (e) { /* older browsers */ }
    }

    return target;
  }

  function findHost() {
    try {
      if (global.navigator && global.navigator.modelContext) {
        return { mc: global.navigator.modelContext, path: 'navigator.modelContext' };
      }
    } catch (e) { /* ignore */ }
    try {
      if (global.document && global.document.modelContext) {
        return { mc: global.document.modelContext, path: 'document.modelContext' };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function install() {
    var tools = buildTools();

    /* Wrap execute so a thrown error becomes a readable tool error rather
       than an unhandled rejection inside the host. */
    var wrapped = tools.map(function (tool) {
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: function (input) {
          return Promise.resolve()
            .then(function () { return tool.execute(input || {}); })
            .catch(function (err) { return fail(err && err.message ? err.message : String(err)); });
        }
      };
    });

    var host = findHost();
    var shimmed = false;
    if (!host) {
      var shim = createShim();
      try { Object.defineProperty(global.document, 'modelContext', { value: shim, configurable: true }); }
      catch (e) { try { global.document.modelContext = shim; } catch (e2) { /* ignore */ } }
      try { if (!global.navigator.modelContext) global.navigator.modelContext = shim; } catch (e) { /* ignore */ }
      host = { mc: shim, path: 'document.modelContext (local shim)' };
      shimmed = true;
    }

    var registered = [];
    if (typeof host.mc.registerTool === 'function') {
      wrapped.forEach(function (t) {
        try { host.mc.registerTool(t); registered.push(t.name); }
        catch (e) { console.warn('[room-planner] could not register tool', t.name, e); }
      });
    } else if (typeof host.mc.provideContext === 'function') {
      try { host.mc.provideContext({ tools: wrapped }); registered = wrapped.map(function (t) { return t.name; }); }
      catch (e) { console.warn('[room-planner] provideContext failed', e); }
    }

    /* A plain JS bridge, so a browser-automation agent can drive the page
       even when the tab has no WebMCP host attached. */
    global.roomPlanner = {
      version: 1,
      transport: host.path,
      listTools: function () {
        return wrapped.map(function (t) {
          return { name: t.name, description: t.description, inputSchema: t.inputSchema };
        });
      },
      callTool: function (name, args) {
        var tool = wrapped.filter(function (t) { return t.name === name; })[0];
        if (!tool) return Promise.reject(new Error('Unknown tool "' + name + '". Try roomPlanner.listTools().'));
        return tool.execute(args || {}).then(function (res) {
          return res && res.structuredContent !== undefined ? res.structuredContent : res;
        });
      },
      getPlan: function () { return store.exportPlan(); },
      validate: function () { return store.validateLayout(); },
      /* Shortcut for automation: same result as the capture_floorplan tool. */
      captureFloorplan: function (options) { return RP.exporter.capture(options || {}); }
    };

    RP.webmcp = {
      tools: wrapped,
      transport: host.path,
      connected: !shimmed,
      toolCount: registered.length || wrapped.length
    };

    if (RP.ui && RP.ui.setAgentStatus) {
      RP.ui.setAgentStatus({
        connected: !shimmed,
        toolCount: RP.webmcp.toolCount,
        detail: (shimmed
          ? 'No WebMCP host detected. ' + wrapped.length + ' tools are still callable via window.roomPlanner.callTool(name, args).'
          : 'Registered ' + registered.length + ' tools on ' + host.path + '.')
      });
    }

    console.info('[room-planner] ' + RP.webmcp.toolCount + ' WebMCP tools on ' + host.path +
      ' — try: await roomPlanner.callTool("validate_layout")');
  }

  RP.installWebMCP = install;
})(window);
