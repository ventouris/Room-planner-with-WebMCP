# Room Planner — WebMCP Hackathon Submission

## Elevator pitch

"Move the desk toward the window for the light, stay 80 cm from the bed, don't block the door." WebMCP lets the agent check that in centimetres, not pixels, then show you the floor plan.

## Why this use case is a strong fit for WebMCP

Room layout runs on exact numbers: clearances, collisions, door swings, wall centering. People misjudge these by eye, and an agent working from a screenshot misjudges them the same way. WebMCP gives the agent the data the page already uses to draw the room, including coordinates in centimetres, object sizes, openings, and constraint states. With that, the agent answers a question like "do these two objects overlap if I rotate one 90 degrees" by computing it rather than guessing.

## How it creates a better user experience

The floor plan is the only state. The SVG canvas draws it and the WebMCP tools change it, both through the same update path, so an agent move, rotation, or new constraint animates on screen the way a manual drag does. You watch the change instead of reading a description of it, and you can undo it with Cmd+Z like any other edit. You can lock a piece of furniture and the agent cannot move it. Collision and constraint checks rerun after every tool call, so the validity badge in the app and the agent's reply stay in agreement.

## What people and agents can do together that was hard before

Without structured tools, an agent driving a layout app either guesses from a screenshot, which has no real units and misses a 3 cm clearance error, or leaves every placement to the person. Now the work splits. "Move the desk toward the window, keep 80 cm from the bed, and don't block the door" is a request the agent can carry out, check against the numbers, and show you, while you watch and take the mouse whenever you want. Locked objects keep specific pieces under your control while the agent handles the rest.

## Inspiration

Most layout tools give the person and the assistant different information. The person sees a plan drawn to scale. The assistant sees a screenshot and guesses from it. That is how you get a wardrobe door that cannot open, a walkway 12 cm too narrow, or a desk that looks centred but sits a few centimetres to one side. I wanted the agent to work from the same measurements a designer would use, and I wanted the person to watch it work and step in whenever they want. WebMCP is how the agent gets the model the page draws from instead of a picture of it.

## What it does

Room Planner is a 2D layout tool in plain HTML, CSS, and JavaScript. You create a room by size or from a template, add furniture from presets or as custom rectangles, and arrange it by dragging, by typing exact coordinates, or with the keyboard. It puts doors and windows on any wall, flags collisions, out-of-bounds objects, and blocked door clearances, and lets you add rules such as "keep 80 cm between the bed and the wall" that turn green or red as you edit. Measurements are in centimetres and the plan persists to `localStorage`.

The page also registers 26 WebMCP tools: 8 that read and validate the plan, 17 that change it or highlight objects on it, and 1 that captures a clean image of the floor plan. An agent reads the geometry, makes a change, and gets the new validation result in one round trip, and every change it makes animates on the canvas like a human edit. Locked objects stay put for the agent too, so "rearrange the room but leave the bed" works as asked.

## How I built it

Room Planner is plain HTML, CSS, and JavaScript with no build step and no dependencies. The floor plan is one JavaScript object that everything reads from. An SVG renderer draws it, and the WebMCP tools change it, both through the same update and validation code, so an agent edit and a hand edit are the same operation underneath. The geometry, including footprints, overlaps, distances, and clearances, is plain functions working in centimetres. The WebMCP layer registers on `navigator.modelContext` or `document.modelContext` when a host is present and falls back to a built-in shim otherwise, so the tools behave the same either way.

I used several AI models and providers while building this, each on the parts it handled best, from writing code to checking the geometry to finding edge cases.

## Challenges I ran into

Rotation math caused the most rework. `xCm` and `yCm` mark the top-left corner before rotation, but at 90 and 270 degrees width and depth swap for collision and distance checks. Getting that consistent across the renderer, the geometry module, and the tool schemas took several passes.

Keeping the agent and the UI in sync was subtler. Any mutation that bypassed the shared update code could leave a layout that passed the validity badge while breaking a constraint. I routed every WebMCP tool through the same store mutations the UI uses.

WebMCP itself is experimental. Neither the spec's `document.modelContext` nor the browser's `navigator.modelContext` is widely available, so I wrote a shim, a simulated host, and a console bridge that all call the same `execute` functions.

Exporting a clean SVG took some care. It renders correctly outside the page only after every CSS class is inlined and every `oklch()` colour is converted to sRGB, with the capture clipped to the plan and no app chrome.

## Accomplishments that I'm proud of

I am a perfectionist, and I have lost whole evenings to a single floor plan. There is always a constraint you cannot see coming, or a sequence of moves that checks out at every step and then wrecks something you fixed earlier. Chatting with an agent that could actually reason about the geometry while I watched the plan take shape on screen was the best part of building this.

## What I learned

Grounding did more for reliability than autonomy did. Once the agent had exact geometry, ordinary requests started working, and once every change animated on the canvas, people trusted the agent because they could see and undo what it did. Returning the validation result with every mutation removed most of the "did that work?" follow-up calls. Building against an unshipped spec is workable when the shim and the simulated host share code with the real path.

## What's next for the room planner?

- A 3D preview beside the 2D plan, from the same model.
- More constraint types: sight lines, traffic flow, natural-light scoring, accessibility clearances.
- Multi-room plans with shared walls and doorways.
- Agent-proposed layouts, such as "give me three arrangements that seat six people," with the person picking one to refine.