# Room Planner

A 2D room layout tool made with plain HTML, CSS and JavaScript. No build step, no framework, no dependencies. Just open `index.html` and it runs.

> The human sees the room. The agent understands the room as structured geometry.

The layout is drawn as SVG using real centimetres, and the same plan is given to AI agents through **WebMCP**. This means an agent can read the geometry, move furniture, check clearances and check the rules, while the person watching the screen sees every change happen live.

---

## Run it

```bash
# any static server works
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from the file system also works, since all scripts are classic scripts, not ES modules.

Deep links for demos:

| URL | Opens |
| --- | --- |
| `index.html` | Start screen, or your last saved layout |
| `index.html?room=demo` | The demo room from the spec (420 × 360 cm) |
| `index.html?room=bedroom` | Bedroom template |
| `index.html?room=office` | Home office template |
| `index.html?room=living` | Living room template |
| `index.html?view=plan` | The floor plan alone, filling the window (add `&background=transparent`) |

---

## Files

```
index.html          markup for the start screen and the workspace
css/styles.css      the whole visual system and responsive layouts
js/geometry.js      pure geometry: footprints, overlaps, distances, clearances
js/presets.js       furniture presets, room templates, the demo room
js/store.js         plan state, mutations, validation, undo/redo, persistence
js/ui.js            SVG rendering, dragging, keyboard editing, panels
js/export.js        floor plan image export (standalone SVG or PNG)
js/webmcp.js        the WebMCP tool surface, plus a shim for browsers without WebMCP
js/main.js          boot, start screen, view switching
tools/floorplan-shot.mjs   CLI: headless render of a plan to PNG or SVG
spec.md             the product spec this build follows
```

There is one plan object that holds everything, and it is the single source of truth. The UI draws it, the WebMCP tools change it, and both paths go through the same update system. That is why an edit made by an agent and an edit made by a person look the same on screen.

---

## What you can do

* Create a room by size, or start from the bedroom, office or living room templates
* Add furniture from nine presets, or make a custom rectangle
* Drag furniture, or type its exact position in the inspector
* Rotate in 90° steps, lock, duplicate, rename, delete
* Add doors and windows to any wall, and drag them along the wall
* See collisions, objects outside the room, and blocked door clearances
* Add four kinds of rules (constraints) and watch them turn green or red as you edit
* Read wall, window and neighbour distances for the selected object
* Undo and redo (⌘Z / ⇧⌘Z), export and import as JSON, save the plan as a PNG image, reset to the starting layout
* Everything is saved to `localStorage`, so a refresh keeps your room

**Keyboard:** Tab to a piece of furniture, then use arrow keys to move it 1 cm at a time (hold Shift for 10 cm), `R` to rotate, `L` to lock, `D` to duplicate, `⌫` to delete, `Esc` to deselect. Dragging is never the only way to do something.

---

## WebMCP

When the page loads, it registers 26 tools, trying in this order:

1. `navigator.modelContext`, the WebMCP entry point a browser gives
2. `document.modelContext`, the form used in the product spec
3. a built in shim, so the tools still work even with no WebMCP host present

The chip in the top bar shows which one it landed on: **"26 agent tools"** when a real host picked them up, **"Agent bridge only"** when it is running on the shim.

### Read tools

| Tool | Returns |
| --- | --- |
| `get_room` | Room name and dimensions in cm |
| `get_openings` | Doors and windows: wall, offset, width |
| `get_objects` | Every object: position, footprint, rotation, locked |
| `get_object` | One object by id |
| `get_constraints` | Constraints with `satisfied` and a readable detail |
| `get_collisions` | Overlaps, out of bounds objects, blocked door clearances |
| `get_distances` | Wall, object, opening and nearest window distances |
| `validate_layout` | `{ valid, collisions, violations }` |

### Mutation tools

`set_room_dimensions` · `add_object` · `move_object` · `rotate_object` ·
`resize_object` · `rename_object` · `remove_object` · `duplicate_object` ·
`lock_object` · `add_opening` · `update_opening` · `remove_opening` ·
`add_constraint` · `update_constraint` · `remove_constraint` ·
`highlight_objects` · `clear_highlights` · `capture_floorplan`

Every mutation tool checks collisions and constraints again and sends back the fresh `validation` result along with what changed, so an agent can move something and check it in the same round trip. Locked objects cannot be moved, not even by the agent, which is what makes "rearrange the room but don't move the bed" actually work.

`highlight_objects` is how the agent points at the screen: it outlines the objects and shows the person a short message above the room.

### Calling the tools without a WebMCP host

The page also gives a plain JavaScript bridge, so a browser automation agent (or you, in the console) can use it anywhere:

```js
await roomPlanner.listTools();                  // name, description, inputSchema
await roomPlanner.callTool('get_objects');
await roomPlanner.callTool('move_object', { objectId: 'desk-1', xCm: 180, yCm: 40 });
await roomPlanner.callTool('validate_layout');
roomPlanner.getPlan();                          // the whole plan as JSON
```

### Testing the tools

WebMCP is not widely shipped yet, so the page normally falls back to its own shim ("Agent bridge only" in the top bar). There are three ways to try it.

**In the console**, the fastest check. Everything below runs against the same `execute` functions the WebMCP tools use:

```js
await roomPlanner.listTools()
await roomPlanner.callTool('move_object', { objectId: 'desk-1', xCm: 180, yCm: 40 })
```

**Against a simulated host**, `index.html?mcp=simulate` installs a stand in `navigator.modelContext` before the tools register, so the real registration path runs instead of the shim. The chip turns blue and reads "26 agent tools", and `window.mcpHost` holds exactly what a host receives:

```js
mcpHost.listTools()                          // names, descriptions, inputSchema
await mcpHost.callTool('get_room', {})       // { content: [...], structuredContent: {...} }
```

Note the shape: a host gets MCP style results with a `content` array and `structuredContent`, and `isError: true` on failure. The `roomPlanner` bridge unwraps that into a plain object to make it easier to use.

**From a real host**, check `navigator.modelContext` in the console of the browser you want to use. If it exists, this page registers there on its own, with no code change needed.

### Coordinates

Everything is in centimetres, with the origin at the room's top left corner. `xCm` and `yCm` are the object's top left corner before rotation. At 90° and 270° the width and depth swap for collision and distance math. An opening's `offsetCm` is measured from the top or left end of its wall.

---

## Screenshots of the floor plan

An agent can ask the page for a picture of the plan on its own, with no app chrome or sidebars, and save it locally. There are three ways to do this, depending on what is driving the browser.

### 1. From the page: `capture_floorplan`

```js
await roomPlanner.callTool('capture_floorplan', { format: 'png', scale: 2 })
// → { format, widthPx, heightPx, byteLength, filename, roomCm, dataUrl }
```

`format: 'svg'` returns a standalone SVG instead, about 6 KB, with every CSS class turned into inline attributes and every `oklch()` colour converted to sRGB, so it renders correctly outside this page. `background: 'transparent'` removes the paper backdrop.

The `dataUrl` is the image, and it can be large, so if you only want the file saved to disk in a real browser, pass `download: true` and the browser saves it while the reply stays small. In headless Chrome, use the CLI below instead, since a headless browser has nowhere to download to.

### 2. From the command line: `tools/floorplan-shot.mjs`

The full "open it headless, make my changes, save the picture" flow, with no npm install needed. It drives Chrome over the DevTools protocol using Node 22+'s built in WebSocket:

```bash
# just render a room
node tools/floorplan-shot.mjs --room demo --out plan.png

# make changes first, then capture the result
node tools/floorplan-shot.mjs --room demo \
  --call move_object '{"objectId":"desk-1","xCm":180,"yCm":40}' \
  --call highlight_objects '{"objectIds":["desk-1"],"message":"Moved into the light"}' \
  --save-plan after.json --out desk-by-the-window.png

# start from a saved layout, export vector
node tools/floorplan-shot.mjs --plan after.json --format svg --out plan.svg
```

Each `--call` is a WebMCP tool call applied in order, and the run prints the validation result of each one, so a bad move is visible right away:

```
· move_object → 0 collision(s), 1 violation(s)
```

The capture is clipped to the plan itself and rendered by the real browser, so web fonts and shadows come out exactly as they look on screen. `--scale 2` (the default) gives a retina image, `--window 1600x1000` sets how large the plan is drawn, and `--background transparent` gives an RGBA PNG. `--help` lists everything.

### 3. Any screenshot tool: `?view=plan`

`index.html?view=plan` renders the floor plan alone, filling the window, so anything that can photograph a page, like Playwright or `chrome --headless --screenshot`, gets a clean image with no extra work:

```bash
chrome --headless --screenshot=plan.png --window-size=1400,900 \
  "index.html?view=plan&room=demo"
```

Because the layout is saved to `localStorage`, an agent can also make its changes in a normal tab, then point that same tab at `?view=plan` and screenshot it. The room comes back exactly as it was left.

There is also an **Image** button in the top bar, which saves the current plan as a PNG.

---

## Demo script

Open `index.html?room=demo` and ask the agent:

> Move the desk closer to the window, keep at least 80 cm between the desk and the bed, and don't block the door.

A good run reads `get_room`, `get_openings`, `get_objects` and `get_distances`, thinks about a good spot, calls `move_object`, then `validate_layout`. The desk visibly slides across the floor plan while the badge in the top bar flips back to "Layout valid". `capture_floorplan` then hands back a picture of the result.

---

## Design source

The behaviour follows `spec.md`, the product spec this build was written against. The desktop, tablet and mobile layouts here are one responsive document, not three separate pages.
