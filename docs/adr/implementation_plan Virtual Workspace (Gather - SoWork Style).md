# Implementation Plan: Virtual Workspace (Gather/SoWork Style)

## Background & Rationale
The current CSS 3D Transform approach creates a "cyberpunk UI" feel but falls short of delivering a true "Virtual Workspace" experience like **Gather** or **SoWork**. 

Based on research into Gather's tech stack, they rely on a **Custom HTML5 Canvas-based Engine** (built with TypeScript) rather than pure HTML/CSS DOM elements. This allows for rich tilemaps, sprite animations, collision detection, and a true RPG-like spatial environment. Similar platforms (like SoWork) utilize engines like **Phaser.js**, **PixiJS**, or **Three.js** to achieve 2D/2.5D interactive worlds.

To achieve your goal, we must migrate the `IsometricRoom` from CSS DOM manipulation to a **WebGL/Canvas Game Engine**.

## Open Questions

> [!IMPORTANT]
> **Which visual style and engine do you prefer?**
> 
> **Option A: Gather Style (Top-Down 2D Pixel Art)**
> - **Tech Stack:** `Phaser.js` (HTML5 Game Framework)
> - **Look & Feel:** Retro 16-bit RPG (Pokemon/Stardew Valley style). 
> - **Pros:** Extremely fast to develop, lightweight, very charming, easy to find free tilemap assets.
> 
> **Option B: SoWork Style (2.5D Isometric)**
> - **Tech Stack:** `Phaser.js` (Isometric Mode) or `PixiJS`
> - **Look & Feel:** The camera is angled (like The Sims or Rollercoaster Tycoon).
> - **Pros:** Looks more modern and detailed than Gather, matches your original 3D request closer.
> - **Cons:** Harder to align assets, isometric math is more complex.
> 
> **Option C: True 3D (Spatial 3D Office)**
> - **Tech Stack:** `React Three Fiber` (Three.js)
> - **Look & Feel:** Full 3D environment where you can rotate the camera freely.
> - **Pros:** The most realistic and immersive.
> - **Cons:** Heaviest on performance, requires actual 3D models (.gltf/.obj) instead of 2D images.

*(Recommended: **Option A (Phaser 2D)** or **Option B (Phaser Isometric)** are the best fit for a web dashboard that needs to remain snappy while looking like Gather/SoWork).*

## Proposed Changes

Assuming we proceed with **Phaser.js (Option A or B)**, the changes will be:

### 1. Dependencies
#### [MODIFY] `frontend/package.json`
- Add `phaser` and `@phaserjs/react` to integrate the game engine seamlessly with our React dashboard.

### 2. Game Assets
#### [NEW] `frontend/public/assets/`
- Download/Generate necessary spritesheets (Agent characters walking up/down/left/right).
- Create a Tilemap (`office_map.json`) and tileset image for the floor, walls, and desks.

### 3. Phaser Game Logic
#### [NEW] `frontend/src/game/`
- `PhaserGame.ts`: The core Phaser configuration.
- `scenes/OfficeScene.ts`: The main scene where the tilemap is loaded, agents are spawned as sprites, and animations are handled.
- `AgentSprite.ts`: A custom Phaser Sprite class to handle the agent's micro-state (walking, coding, error).

### 4. React Integration
#### [MODIFY] `frontend/src/components/IsometricRoom.tsx` (Rename to `VirtualWorkspace.tsx`)
- Rip out the old CSS 3D DOM elements.
- Mount the `<PhaserGame>` React component.
- Use an Event Emitter or React Refs to pass real-time WebSocket data (`agents`, `expEffects`) from React down into the active Phaser `OfficeScene` so the sprites update dynamically.

## Verification Plan
### Manual Verification
1. Start the Vite dev server (`npm run dev`).
2. Verify the Canvas renders the office environment.
3. Use the Live System Logs or trigger a backend task to change an agent's state.
4. Verify the Phaser sprite visually responds to the WebSocket event (e.g., starts playing a walking animation or a status bubble appears above the sprite).
