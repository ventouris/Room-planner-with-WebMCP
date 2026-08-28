/* Room Planner — furniture presets, room templates and the demo room. */
(function (global) {
  'use strict';

  var RP = global.RP || (global.RP = {});

  var PRESETS = [
    { key: 'single_bed',   type: 'bed',        label: 'Single Bed',   w: 90,  h: 200 },
    { key: 'double_bed',   type: 'bed',        label: 'Double Bed',   w: 160, h: 200 },
    { key: 'desk',         type: 'desk',       label: 'Desk',         w: 120, h: 60  },
    { key: 'chair',        type: 'chair',      label: 'Chair',        w: 50,  h: 50  },
    { key: 'sofa',         type: 'sofa',       label: 'Sofa',         w: 200, h: 90  },
    { key: 'dining_table', type: 'table',      label: 'Dining Table', w: 140, h: 80  },
    { key: 'wardrobe',     type: 'wardrobe',   label: 'Wardrobe',     w: 120, h: 60  },
    { key: 'bookshelf',    type: 'bookshelf',  label: 'Bookshelf',    w: 80,  h: 30  },
    { key: 'nightstand',   type: 'nightstand', label: 'Nightstand',   w: 45,  h: 45  }
  ];

  var TEMPLATES = {
    bedroom: {
      key: 'bedroom',
      label: 'Bedroom',
      name: 'Bedroom layout',
      room: { widthCm: 360, heightCm: 320 },
      objects: [
        { id: 'bed-1',        type: 'bed',        label: 'Double Bed', xCm: 100, yCm: 0,   widthCm: 160, heightCm: 200, rotation: 0, locked: false },
        { id: 'nightstand-1', type: 'nightstand', label: 'Nightstand', xCm: 45,  yCm: 0,   widthCm: 45,  heightCm: 45,  rotation: 0, locked: false },
        { id: 'nightstand-2', type: 'nightstand', label: 'Nightstand', xCm: 270, yCm: 0,   widthCm: 45,  heightCm: 45,  rotation: 0, locked: false },
        { id: 'wardrobe-1',   type: 'wardrobe',   label: 'Wardrobe',   xCm: 120, yCm: 260, widthCm: 120, heightCm: 60,  rotation: 0, locked: false }
      ],
      openings: [
        { id: 'door-1',   type: 'door',   wall: 'left',  offsetCm: 110, widthCm: 90 },
        { id: 'window-1', type: 'window', wall: 'right', offsetCm: 40,  widthCm: 140 }
      ],
      constraints: [
        { id: 'c1', type: 'against_wall', objectId: 'wardrobe-1' },
        { id: 'c2', type: 'keep_clear', openingId: 'door-1', clearanceCm: 80 }
      ]
    },
    office: {
      key: 'office',
      label: 'Home office',
      name: 'Home office layout',
      room: { widthCm: 300, heightCm: 280 },
      objects: [
        { id: 'desk-1',      type: 'desk',      label: 'Desk',      xCm: 90,  yCm: 0,   widthCm: 120, heightCm: 60, rotation: 0,  locked: false },
        { id: 'chair-1',     type: 'chair',     label: 'Chair',     xCm: 125, yCm: 70,  widthCm: 50,  heightCm: 50, rotation: 0,  locked: false },
        { id: 'bookshelf-1', type: 'bookshelf', label: 'Bookshelf', xCm: 0,   yCm: 150, widthCm: 80,  heightCm: 30, rotation: 90, locked: false }
      ],
      openings: [
        { id: 'door-1',   type: 'door',   wall: 'bottom', offsetCm: 90, widthCm: 90 },
        { id: 'window-1', type: 'window', wall: 'right',  offsetCm: 60, widthCm: 120 }
      ],
      constraints: [
        { id: 'c1', type: 'min_distance', objectAId: 'chair-1', objectBId: 'bookshelf-1', distanceCm: 60 },
        { id: 'c2', type: 'near_window', objectId: 'desk-1', maxDistanceCm: 100 },
        { id: 'c3', type: 'against_wall', objectId: 'bookshelf-1' },
        { id: 'c4', type: 'keep_clear', openingId: 'door-1', clearanceCm: 80 }
      ]
    },
    living: {
      key: 'living',
      label: 'Living room',
      name: 'Living room layout',
      room: { widthCm: 500, heightCm: 400 },
      objects: [
        { id: 'sofa-1',         type: 'sofa',      label: 'Sofa',         xCm: 150, yCm: 310, widthCm: 200, heightCm: 90, rotation: 0,  locked: false },
        { id: 'coffee-table-1', type: 'custom',    label: 'Coffee Table', xCm: 200, yCm: 240, widthCm: 100, heightCm: 50, rotation: 0,  locked: false },
        { id: 'bookshelf-1',    type: 'bookshelf', label: 'Bookshelf',    xCm: 470, yCm: 40,  widthCm: 80,  heightCm: 30, rotation: 90, locked: false }
      ],
      openings: [
        { id: 'door-1',   type: 'door',   wall: 'left', offsetCm: 160, widthCm: 90 },
        { id: 'window-1', type: 'window', wall: 'top',  offsetCm: 150, widthCm: 200 }
      ],
      constraints: [
        { id: 'c1', type: 'min_distance', objectAId: 'sofa-1', objectBId: 'coffee-table-1', distanceCm: 15 },
        { id: 'c2', type: 'against_wall', objectId: 'bookshelf-1' },
        { id: 'c3', type: 'keep_clear', openingId: 'door-1', clearanceCm: 80 }
      ]
    }
  };

  /* The room from §23 of the spec — the one the demo prompt is written for. */
  var DEMO_ROOM = {
    key: null,
    label: 'Demo room',
    name: 'Bedroom layout',
    room: { widthCm: 420, heightCm: 360 },
    objects: [
      { id: 'bed-1',      type: 'bed',      label: 'Double Bed', xCm: 240, yCm: 150, widthCm: 160, heightCm: 200, rotation: 0,  locked: false },
      { id: 'wardrobe-1', type: 'wardrobe', label: 'Wardrobe',   xCm: 360, yCm: 10,  widthCm: 120, heightCm: 60,  rotation: 90, locked: false },
      { id: 'desk-1',     type: 'desk',     label: 'Desk',       xCm: 35,  yCm: 280, widthCm: 120, heightCm: 60,  rotation: 0,  locked: false },
      { id: 'chair-1',    type: 'chair',    label: 'Chair',      xCm: 175, yCm: 290, widthCm: 50,  heightCm: 50,  rotation: 0,  locked: false }
    ],
    openings: [
      { id: 'door-1',   type: 'door',   wall: 'left', offsetCm: 40,  widthCm: 90 },
      { id: 'window-1', type: 'window', wall: 'top',  offsetCm: 170, widthCm: 140 }
    ],
    constraints: [
      { id: 'c1', type: 'min_distance', objectAId: 'bed-1', objectBId: 'desk-1', distanceCm: 80 },
      { id: 'c2', type: 'near_window', objectId: 'desk-1', maxDistanceCm: 100 },
      { id: 'c3', type: 'against_wall', objectId: 'wardrobe-1' },
      { id: 'c4', type: 'keep_clear', openingId: 'door-1', clearanceCm: 90 }
    ]
  };

  RP.PRESETS = PRESETS;
  RP.TEMPLATES = TEMPLATES;
  RP.DEMO_ROOM = DEMO_ROOM;
  RP.DEFAULT_DOOR_CLEARANCE_CM = 80;

  RP.findPreset = function (key) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].key === key || PRESETS[i].type === key) return PRESETS[i];
    }
    return null;
  };
})(window);
