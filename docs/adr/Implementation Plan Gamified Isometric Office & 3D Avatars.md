# Implementation Plan: Gamified Isometric Office & 3D Avatars

This plan outlines the steps to upgrade the `Nexus-Agent` Dashboard into a fully interactive, gamified 2.5D Isometric environment with moving avatars and real-time WebSocket integration.

## Context Discovery
I have reviewed the backend (`nexus_agent/core/state.py`, `observability.py`, `dashboard_hub.py`, etc.). The good news is that **95% of the backend infrastructure you requested (WebSockets, AgentMetrics, DashboardEvent JSON schema, thread-safe emit) is already implemented and working**! 

We only need to make minor tweaks to the backend (adding the `WALKING` state) and focus our primary effort on the **Frontend React Components and CSS**.

## Proposed Changes

### 1. Backend Updates (Python)
- **[MODIFY] `nexus_agent/core/state.py`**:
  - Add `WALKING = "walking"` to the `AgentMicroState` Enum.
- *Note: `observability.py` and `dashboard_hub.py` already perfectly match your requirements (real-time metrics tracking and WebSocket broadcasting).*

### 2. Frontend 3D Isometric Components (React/Tailwind)
- **[MODIFY] `IsometricRoom.tsx`**:
  - **Floor Depth**: Add pseudo-elements or nested divs to create left/right thickness (depth) and edge highlights.
  - **Pan & Zoom**: Implement mouse drag (pan) and wheel (zoom) using state variables (`translateX`, `translateY`, `scale`) applied to the main container.
- **[NEW] `IsometricDesk.tsx`**:
  - A true cuboid component made of 3 faces (Top, Left, Right) using CSS 3D transforms (`rotateX`, `rotateZ`, `skew`).
  - Add glowing cyan/magenta accents.

### 3. Frontend Agent Avatars (React/CSS)
- **[MODIFY] `AgentAvatar.tsx`**:
  - **Billboarding**: Apply reverse isometric transforms so the avatar always faces the camera directly.
  - **Animations by State**:
    - `PLANNING`: Rotating hologram effect.
    - `CODING`: Rapidly moving code-lines/screen.
    - `OPTIMIZING`: Floating up and down with a green aura.
    - `WALKING`: Bouncing/walking CSS keyframes moving between coordinates.
    - `ERROR`: Pulsing red emergency light.
- **[NEW] `FloatingSpeechBubble.tsx`**:
  - Renders the `status_message` in a cyberpunk-styled bubble above the avatar.
- **[NEW] `FloatingExpText.tsx`**:
  - Triggers a `+100 EXP` floating text animation when an agent completes a task (driven by the `exp_gained` WebSocket event).

### 4. WebSocket Integration
- **[MODIFY] `useAgentSocket.ts`**:
  - Ensure it correctly parses the `exp_gained` events and triggers the EXP floating text system.
- **[MODIFY] `Dashboard.tsx`**:
  - Provide the updated state and effects down to the `IsometricRoom`.

## Verification Plan
1. **Compile**: Run `npm run build` to ensure all React components are typed correctly.
2. **Backend**: Start the FastAPI server to ensure the `WALKING` state enum doesn't break any Pydantic models.
3. **UI/UX Test**: Manually test the Pan/Zoom functionality and verify that the 3D Cuboids render correctly without Z-index clipping.

> [!IMPORTANT]
> **User Review Required**:
> Are you okay with me implementing the interactive Pan/Zoom using simple React State and standard DOM events (onMouseMove, onWheel) rather than introducing a heavy 3D library like Three.js? (This keeps the app lightweight and uses pure CSS 3D transforms as requested).
