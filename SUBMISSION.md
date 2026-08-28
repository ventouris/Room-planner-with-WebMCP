# Room Planner — WebMCP Hackathon Submission

## Why this use case is a strong fit for WebMCP

Planning a room layout needs exact numbers, like clearances, collisions, door swings, and wall centering. People often get these wrong just by looking, and an agent looking at a screenshot has the same problem. WebMCP fixes this by giving the agent the same structured data that the page uses to draw the room: exact coordinates in centimeters, object sizes, openings, and constraint states, instead of pixels it has to guess. This means the agent does not only describe a room, it can really reason about it. A question like "will these two objects overlap if I rotate this one 90 degrees" becomes a real geometry check, not a guess.

## How it creates a better user experience

Everything happens on screen, nothing hidden. The plan is the single source of truth. The SVG canvas draws it, and the WebMCP tools change it, and both use the same update system, so when an agent moves, rotates, or adds a constraint, it animates on the floor plan just like a manual drag would. The person does not need to trust a text description of the change, they see it happen, and they can undo it (Cmd+Z) like any other edit. They can also lock a piece of furniture so the agent cannot touch it. Collision and constraint checks run again after every tool call, so the app's own validity badge and the agent's answer always match.

## What people and agents can do together that was difficult before

Before structured tools, an agent driving a layout app had two bad options: guess from a screenshot (which is fragile, has no real units, and cannot catch a 3 cm clearance mistake), or the person had to place every object by hand. Now the two can really share the work. A request like "move the desk toward the window, keep 80 cm from the bed, and do not block the door" is something the agent can do and check with numbers, then show a picture of the result. Meanwhile the person watches it happen live and can take the mouse anytime to adjust something themselves. Locked objects let the person keep control over specific pieces even while giving the rest of the work to the agent. This is real shared editing of one grounded model, not an agent blindly using a human's interface.

## How WebMCP was implemented

When the page loads, js/webmcp.js creates 26 tools (11 for reading and validating, 14 for changing things, and 1 for capturing an image). It registers them in this order: first it tries navigator.modelContext, then document.modelContext, then falls back to a built in local version so the tools still work through window.roomPlanner.callTool(...) even with no WebMCP host around. Registration follows the standard format:

```js
document.modelContext.registerTool({
  name: "move_object",
  description: "Move an object to an absolute position...",
  inputSchema: { /* JSON Schema */ },
  execute: async (input) => { /* mutate the shared plan, return content + structuredContent */ }
});
```

Every tool that changes something runs the collision and constraint check again and sends back the new result along with what changed. This way an agent can move something and check it in one step, instead of doing a call and then checking separately.

## About the development

This app was built using different AI models and providers together. Each one was used for what it does best, from writing code to checking logic and testing ideas, to help build a more solid and well tested app.
