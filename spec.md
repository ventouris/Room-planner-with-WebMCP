# Room Planner: The specs

A prototype of a 2D room-layout tool where a user places furniture in a room and an AI agent can read and edit the exact same layout through WebMCP.

Core idea: the user sees the room, the agent gets the room as data. Nothing an agent does should happen "behind the scenes". If it moves a desk, the desk visually moves on the screen the person is looking at.

No 3D. Plain HTML/CSS/JS, so it's easy to open and read top to bottom.

NOTE AFTER COMPLETION: The code and the voice over of the video is AI generated, using different providers and models.

### Units and coordinates

Everything is in centimetres. Rotation is limited to 0/90/180/270° — at 90 and 270 an object's width and depth swap for
any collision or distance math. This is a prototype and real life scenarios will not be part of it. In specific, no arbitrary rotation, no non-rectangular rooms and no curved walls.

---

## Feature 1: Getting into a room

Before anything else, someone needs a room to work with. Give them a few ways in from a start screen.

**User story: create a room from scratch**
- As a first-time user, I want to type a width and height and get an empty room, so I can start placing my own furniture.
- Width and height in cm, in a 60–2000 range. Reject input outside that with a message, the user should know why nothing happened.
- Don't hand back a totally bare rectangle. An empty room should still come with a door and a window already placed on sensible walls, and one starter constraint (keep the door clear), so there's already something to react to instead of a blank canvas.

**User story: start from a template**
- As someone who doesn't want to place furniture one piece at a time, I want to pick "Bedroom" and get a real, laid-out room, so I can start adjusting instead of starting from zero.
- Ship at least three: Bedroom, Home office, Living room. Each should have its own room size, its own furniture, its own doors/windows, and a couple of constraints already attached, enough that opening it immediately shows something worth validating.
- Templates are starting points, not locked designs. Everything in a template needs to be exactly as editable as anything added by hand.

**User story: open a demo room**
- As someone demoing this to another person, I want one link that always opens the same known layout, so a demo script written once keeps working.

**User story: pick up where you left off**
- As a returning user, I want the app to remember my last layout, so closing the tab doesn't cost me the work.
- Persist to `localStorage`. If there's a saved layout, offer "continue where you left off" on the start screen; if the app is opened with no special parameters, it can skip the start screen and go straight back in.

---

## Feature 2: Furnishing the room

**User story: preset furniture**
- As a user, I want to click "Desk" and have a desk appear in the room, so I don't have to type dimensions for common furniture every time.
- Keep the preset library small for v1. Bed (single + double), desk, chair, sofa, dining table, wardrobe, bookshelf, nightstand covers most rooms. Clicking a preset adds it near an open corner; if several of the same preset get added in a row, stagger their starting position a little so they don't stack exactly on top of each other.

**User story: custom rectangle**
- As a user furnishing something that isn't in the preset list, I want to type a label, width and depth and get a rectangle with that name, so I'm not stuck mislabeling things that don't fit the presets.

---

## Feature 3: Moving things around

**User story: drag**
- As a user, I want to click and drag furniture around the floor plan, so arranging a room feels physical, not like filling out a form.
- Dragging should clamp the object to the room bounds, no dragging a wardrobe half through a wall. A whole drag gesture should count as one undo step, not one step per pixel moved.

**User story: keyboard**
- As a user who wants precise placement without fighting a mouse, I want to tab to an object and nudge it with arrow keys, so drag isn't the only way to move something.
- Arrow keys nudge by 1cm, Shift+arrow by 10cm. Give every object action a keyboard path: rotate, lock, duplicate, delete, deselect, not just move. This also matters for accessibility; nothing should require a pointer.

**User story: type the exact position**
- As a user who knows exactly where something should go, I want to type X, Y, width and height directly, so I don't have to eyeball a drag to land on "142cm from the left wall."
- The inspector for a selected object should show width, depth, X, Y, current rotation, and buttons for rotate / lock / duplicate / delete.

**User story: rotate**
- As a user, I want to rotate furniture in 90° steps, so a desk against side wall can face the right way.
- Rotation needs to affect every downstream calculation, collisions, distances, "against wall" checks, not just the on-screen drawing.

**User story: duplicate, rename, delete**
- As a user with two matching nightstands, I want to duplicate one instead of re-adding it from the preset list and repositioning by hand.
- Duplicate should offset the copy slightly so it doesn't land exactly on top of the original. Delete needs to also clean up any constraint that referenced the deleted object — no dangling rules pointing at something that no longer exists.

**User story: lock**
- As a user rearranging a room, I want to lock the bed so it can't move, so I can shuffle everything else without accidentally dragging the one piece I actually care about keeping put.
- Locking has to block every path that could move, rotate or resize the object, drag, keyboard, and any agent tool call, equally. A locked object should return a clear error to a mutation attempt, not fail silently and not succeed silently either.

---

## Feature 4: Doors and windows

**User story: add a door or window**
- As a user, I want to add a door to one wall and a window to another, so the room isn't just four blank walls.
- Pick a wall, an offset along it, and a width. Reasonable defaults: door ~90cm wide, window ~120cm wide.

**User story: move it along the wall**
- As a user, I want to drag a door or window along its wall to reposition it, so I don't have to delete and re-add it to fix a placement.

**User story: door swing and keep-clear zone**
- As a user, I want to see the floor space a door needs to open, so I don't put a chair right where the door would hit it.
- Doors don't strictly need an animated swing, but should show something, at minimum a quarter-circle swing arc and a shaded zone in front of the door that counts as blocked if furniture sits inside it. This needs to be a real, checkable zone, not just decoration. It should feed into collision detection.

---

## Feature 5: Keeping the layout valid

**User story: catch overlapping furniture**
- As a user, I want to see immediately when two things I've placed overlap, so I don't end up with a desk clipped into a wardrobe without noticing.
- Overlapping objects should get a visible warning right on the canvas, plus a plain-language line in an issues list ("Desk overlaps Chair").

**User story: catch furniture outside the room**
- As a user, I want dragging something half off the edge of the room to be visibly flagged, not silently allowed.

**User story: catch furniture blocking a door**
- As a user, I want to know if I've put something in a door's clearance zone, so I don't end up with a door that can't actually open.
- Roll all three checks up into one overall valid/invalid state shown somewhere persistent (a badge in the header is enough), and re-run the check after every single change, whether it came from a drag or from an agent's tool call. Don't auto-move anything to fix a problem, flag it and let the user or agent decide.

---

## Feature 6: Knowing how far apart things are

**User story: distance to each wall**
- As a user, I want to know how far the selected object is from each of the four walls, so I can center it or push it flush without guessing.

**User story: distance to the nearest object**
- As a user, I want to know what's closest to the thing I'm looking at and how far away, so I can judge whether there's enough space to walk through.

**User story: distance to the nearest window / to openings**
- As a user, I want to know how far an object is from a window, so a rule like "keep the desk near a window" has a real number behind it instead of a guess.
- Whatever numbers show up in the UI's inspector need to be exactly the numbers a distance-lookup tool returns to an agent, don't let the two drift apart.

---

## Feature 7: Rules for the layout (constraints)

This is what turns "a floor plan" into something an agent can check its own work against. A constraint is a rule attached to the room; the app reports whether it currently holds, and keeps checking after every change.

Constraint types to support:

- **min_distance**: keep at least N cm between two objects. ("Keep 80cm between the bed and the desk.")
- **max_distance**: keep two objects within N cm of each other, for cases like a nightstand that should stay near the bed rather than drift away.
- **near_window**: an object must be within N cm of a window.
- **against_wall**: an object has to be touching some wall (allow a small tolerance for "touching").
- **centered_on_wall**: an object has to touch one specific wall and sit centred along it, within a tolerance. Useful for something like a headboard that should be dead-center, not just anywhere on the wall.
- **keep_clear**: the door-clearance rule, generalized so the clearance depth is configurable per opening.
- **clearance_zone**: same idea as keep_clear, but for furniture: a strip on one side of an object that has to stay empty. Covers things like a wardrobe's door swing or the pull-out space in front of a desk chair, functional clearance that doesn't hinge on a door.
- **facing**: object A's "front" (derived from its rotation) has to point toward object B. For a chair that should face the desk it belongs to.

Each constraint should show up in a small list with a plain-language description, a satisfied/violated indicator, and a one-line status detail ("62 cm apart · minimum 80 cm"), not just true/false. Deleting furniture referenced by a constraint should remove the constraint too.

---

## Feature 8: Not losing work

**User story: undo / redo**
- As a user, I want undo/redo to cover everything, moves, rotations, adding/removing objects, constraint and opening changes, so experimenting with a layout doesn't feel risky.

**User story: autosave**
- As a user, I want the app to remember my layout across refreshes without me doing anything, so closing the laptop mid-edit doesn't cost me anything.
- Persist room, furniture, openings, constraints, locks and UI state (which tab, light on/off) to `localStorage` after each change.

**User story: export / import JSON**
- As a user, I want to save my layout as a file and load it back later (or hand it to someone else), so a layout isn't trapped in one browser's storage.
- Import needs to validate what it's given. A slightly malformed file shouldn't crash the app; missing fields should get sane defaults and unrecognized data should just be dropped.

**User story: reset**
- As a user who's made a mess trying things out, I want a "Reset" that goes back to how this room started, the template or the room as created, not some unrelated global default.

---

## Feature 9: Making it feel like an actual room

**User story: a picture of the plan**
- As a user, I want a clean image of just the floor plan, no toolbar, no sidebar, that I can save or share, so the layout isn't stuck inside the app.
- Support at least a PNG export, ideally an SVG export too for anyone who wants a vector version. This needs to work as something an agent can trigger as well, not just a button a human clicks, and it should render as a real standalone image file with no dependency on this page's CSS to look right elsewhere.
- Also worth having a screenshot-friendly mode (a URL flag that renders just the plan, filling the window) so any generic screenshot tool can capture it without app chrome getting in the way, and consider a small CLI utility for headless capture, useful for anyone scripting demos or regression screenshots.

**User story: light and shadow, toggleable**
- As a user, I want the room to visually suggest which way is "outside," so the plan reads as a room and not a diagram of rectangles. Make it a toggle, sometimes a flat, no-shadow view is more useful for clarity.

**User story: works on a phone**
- As a user on a phone or tablet, I want the canvas to be the main thing on screen, with the furniture list and inspector reachable below it, instead of a cramped copy of the desktop three-column layout.

---

## Feature 10: Letting an agent work in the same room

This is the actual point of the project.

**User story: a full tool surface, not a toy one**
- As an agent, I want to read the room's exact geometry and mutate it with the same precision a human has through the inspector, so "move the desk near the window but keep 80cm from the bed" is something I can actually solve, not just describe.
- Read tools should cover: room dimensions, openings, objects (all + one by id), constraints with status, collisions, distances, and an overall validate call. Mutation tools should cover: room resize, add/move/rotate/resize/rename/remove/duplicate/lock for objects, add/update/remove for openings, add/update/remove for constraints, plus a way to highlight objects on screen and clear that highlight. A capture-the-floorplan tool belongs here too, so an agent can hand back a picture of its own result.
- Every mutation tool should re-check collisions and constraints before replying and return the fresh validity result along with whatever changed. An agent shouldn't have to call a mutation and then remember to separately call validate every time, though a standalone validate call should still exist for a final check.

**User story: register wherever a host will take it**
- As the app, I want to work whether or not the browser I'm running in actually has WebMCP support yet, so this isn't dead on arrival anywhere except one specific browser.
- Try the real WebMCP entry point first; fall back to a local bridge that keeps every tool callable from plain JS if no host is present. Somewhere visible in the UI (a small status chip is enough) should show which mode it's running in, so it's obvious during a demo whether a real host picked the tools up.

**User story: locked furniture is off-limits to the agent too**
- As a user, I want a lock I set to actually mean something, so telling an agent "don't move the bed" isn't the only thing standing between the bed and getting moved anyway.
- The lock check needs to live in one shared place both the UI and the WebMCP tools call into, not duplicated logic that could drift apart and leave a loophole.

**User story: the agent can point at things**
- As an agent that's just made a recommendation, I want a way to draw the person's attention to the specific pieces involved, so "here's what I did and why" isn't a wall of text they have to cross-reference against the picture themselves.
- A highlight tool that outlines given objects/openings and shows a short message above the room, plus a way to clear it.

**User story: testable without a WebMCP browser**
- As a developer without access to a browser that ships WebMCP yet, I want a way to exercise the exact same registration path the real thing will use, so I'm not shipping code that's only ever run through the fallback path.
- Support installing a stand-in host via a URL flag for local testing, separate from the production fallback bridge, so the "real" registration branch gets exercised even without a WebMCP-capable browser on hand.

---

## Suggested demo room + prompt

Room around 420×360cm, with a double bed, a wardrobe, a desk and a chair already placed, one door and one window. Ask an agent:

> Move the desk closer to the window, keep at least 80 cm between the desk and the bed, and don't block the door.

A good run should read the room, the openings, the objects and the distances, reason about a candidate spot, move the desk, then validate, and the desk should visibly slide across the plan on screen while the validity badge updates. This one prompt touches nearly everything above at once (reads, geometry reasoning, a constraint, a mutation, validation, a visible UI change), which is why it's worth building the demo room specifically so this prompt makes sense against it.

That prompt is deliberately easy, one desk, one rule, one obvious move. It's a good first demo because it's easy to follow along with. It's not a good demonstration of why any of this matters.

---

## A harder prompt, to show the whole range

This one is meant to be the opposite: a single message that creates a room from nothing, furnishes it, and hands over a pile of rules that all depend on each other. Nobody should be able to hold this whole thing in their head and place furniture correctly on the first try, that's the point. A person doing this by dragging rectangles would place something, eyeball it, place the next thing, realize it breaks a rule from three steps ago, and start over. An agent can just read the room as numbers, work the constraints like a system, and check its own answer before saying it's done.

The prompt, exactly as someone might type it:

> Set up a new room, 450 by 380 centimetres. Put a door on the left wall, about 40cm in from the top corner, 100cm wide, and a window on the wall directly across from it, wide enough to let in a good amount of light, say 150cm.
>
> Now furnish it: a double bed, two nightstands (one on each side of the bed), a desk, a chair, a wardrobe, and a bookshelf. Here's what has to be true when you're done:
>
> - The bed goes against the wall facing the door, centered on that wall. I don't want it obviously off to one side, keep it within about 15cm of dead-center.
> - Each nightstand needs to stay within 50cm of the bed, but the nightstands and the bed can't overlap each other.
> - The desk should be close enough to the window to actually get daylight, within 120cm, but at least 100cm away from the bed, because I don't want the desk chair banging into the bed frame when someone pushes back from the desk.
> - Speaking of the chair: it needs to be pulled up to the desk and actually facing it, not facing off into the room.
> - The wardrobe has to be against a wall, but not the same wall as the door, and it needs at least 60cm of open floor in front of it so the doors can swing open without hitting anything.
> - Whatever wall has space left over, put the bookshelf there, against the wall, out of the way.
> - The door itself needs 90cm of completely clear floor in front of it at all times, nothing blocking it, ever, including anything you just placed.
> - Nothing in the room should overlap anything else, and nothing should be poking outside the room.
>
> Once every single one of those is actually true, not just close, lock the bed in place so it can't get bumped by mistake, highlight the desk and the chair with a short note explaining why you put them where you did, and send me a picture of the finished layout.

That's a room, two openings, six objects, and something like nine interlocking rules (distance, clearance, centering, facing, wall assignment, all at once) resolved from one message. Working this out requires figuring out which wall is "directly across" from the door, which wall is left over once the wardrobe claims one, and juggling four separate numeric constraints that all touch the same two or three objects, none of which is something you can eyeball on a drag. It's exactly the shape of problem `get_room` / `get_openings` / `get_objects` / `get_distances` / `move_object` / `rotate_object` / `add_constraint` / `validate_layout` were built to solve together, called in a loop until every rule actually passes, not just the ones that were checked last.
