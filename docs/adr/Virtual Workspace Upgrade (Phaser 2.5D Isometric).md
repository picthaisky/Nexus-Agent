# Virtual Workspace Upgrade (Phaser 2.5D Isometric)

I have completely stripped out the old HTML/CSS 3D DOM approach and replaced the core rendering engine of the `IsometricRoom` with **Phaser.js**! This brings the Nexus-Agent Dashboard to the same technological level as **Gather** and **SoWork**.

## Changes Made

### 1. Game Engine Integration
- **Phaser.js**: Installed the industry-standard HTML5 2D game engine.
- **React Wrapper (`PhaserGame.tsx`)**: Created a bridge component that mounts the Phaser Canvas and handles the React lifecycle (initialization and cleanup).
- **Event Bus**: Created `EventBus.ts` to push real-time WebSocket state updates (like `AgentRuntimeState` and `MicroState`) directly from React down into the active Phaser Scene.

### 2. True 2.5D Isometric Scene (`OfficeScene.ts`)
- **Cartesian to Isometric Math**: I implemented standard isometric projection math (`cartToIso`) to convert standard X/Y grid coordinates into 2.5D angled screen coordinates (with a 2:1 ratio).
- **Procedural Floor Grid**: Instead of relying on static CSS grids, the Phaser Scene dynamically draws an isometric tile floor using the WebGL/Canvas Graphics API (`Phaser.GameObjects.Graphics`).
- **Pan & Zoom Controls**: You can now click and drag directly on the game canvas to pan the camera, and use your mouse wheel to zoom in and out. The camera is clamped and handles scaling effortlessly thanks to Phaser's native camera system.

### 3. Procedural Agent Rendering
- **3D Cuboids in Canvas**: The agents are drawn as dynamic 3D isometric blocks using Phaser Graphics.
- **Dynamic Z-Sorting (Depth)**: Elements closer to the bottom of the screen overlap elements further away (`setDepth(iso.y)`), creating true 3D spatial depth just like SoWork.
- **Floating Labels & Speech Bubbles**: Phaser Text objects are anchored above the agents. Speech bubbles automatically disappear after 4 seconds.
- **Animations**: The `WALKING` micro-state now triggers a sine-wave bobbing animation calculated against `time.now`, creating a smooth footstep effect at 60 FPS.

## Next Steps for You
Currently, the system uses Procedural Graphics (drawing shapes using code) to prove the 2.5D engine works flawlessly. 
To achieve the exact **SoWork visual fidelity** (like the screenshot you shared with detailed desks, plants, and characters), all you need to do is:
1. Drop Isometric Sprite images (e.g., `desk.png`, `character.png`) into `frontend/public/assets/`.
2. Update `OfficeScene.ts` to use `this.add.image()` instead of `this.add.graphics()`.

You can now start the frontend (`npm run dev`) and watch the new Game Engine in action!
