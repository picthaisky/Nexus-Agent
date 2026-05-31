# Implementation Plan: Cyber-Thai Command Center (Isometric Animation UI)

Concept: Transform the agent dashboard monitoring grid into an interactive, retro-futuristic **2.5D Isometric Command Office (Cyber-Thai themed)**. Agents are represented by unique, beautifully animated Cyber-Thai characters stationed at 3D desk terminals that react in real-time to backend WebSocket events.

---

## User Review Required

> [!IMPORTANT]
> - **Visual Toggling**: We will add a smooth neon tab selector at the top of the dashboard so you can seamlessly toggle between the traditional **"Agent Grid View"** and the new **"Isometric Office View"**.
> - **Sprite Representations**: Since there are no pre-existing sprite sheets in the workspace, we will construct highly detailed, vector-based animated SVGs with custom retro/neon styling to represent the six Thai-mythological agents.

---

## Proposed Changes

### Frontend Components

#### [NEW] [IsometricRoom.tsx](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/frontend/src/components/IsometricRoom.tsx)
Creates the 2.5D room layout.
- Uses a container with CSS transform: `rotateX(60deg) rotateZ(-45deg)` and `transform-style: preserve-3d` to establish the isometric plane.
- Renders a cyber-neon floor grid with traditional Thai pattern decorations styled in glowing lines.
- Places 6 `DeskStation` components at coordinates corresponding to:
  - Planner (Planner / เสนาบดีไซเบอร์)
  - Architect (Architect / พระวิศวกรรม)
  - Developer (Developer / วานรล้ำยุค)
  - UI Weaver (UI Weaver / นางอัปสรทอแสง)
  - Validator (Validator / ยักษ์ทวารบาล)
  - Optimizer (Optimizer / ฤาษีดิจิทัล)
- Implements auto-scaling (using CSS `transform: scale(...)`) so the room scales down perfectly to fit tablet and mobile screens.

#### [NEW] [DeskStation.tsx](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/frontend/src/components/DeskStation.tsx)
Represents the 3D workstation for each agent.
- Formed by 3D HTML planes (`face-top`, `face-front-left`, `face-front-right`) using CSS 3D transforms.
- Uses graded dark colors and neon cyan/gold borders for depth.
- Incorporates a 3D hologram screen standing upright on the desk.
- Reactive Styles:
  - **Coding/Processing**: Pulsing screen lighting.
  - **Success/Completed**: Pulses in glowing jade green.
  - **Error/Failure**: Flashes/pulses in emergency crimson red.

#### [NEW] [AgentAvatar.tsx](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/frontend/src/components/avatars/AgentAvatar.tsx)
Builds state-driven, themed characters standing upright on the desk:
- **Planner (เสนาบดีไซเบอร์)**: Dignified councillor wearing a golden crown and holding a glowing neon decree scroll.
- **Architect (พระวิศวกรรม)**: Multi-armed engineering god surrounded by orbiting blueprint/hologram rings.
- **Developer (วานรล้ำยุค / Hanuman)**: Cyber monkey with glowing cybernetic tail and head visor, typing on a holographic keyboard.
- **UI Weaver (นางอัปสรทอแสง)**: Ethereal dancer floating above a pink lotus, weaving glowing pixel ribbons.
- **Validator (ยักษ์ทวารบาล)**: Armored giant guardian wielding a massive digital gateway scanner shield.
- **Optimizer (ฤาษีดิจิทัล)**: Levitating digital hermit sitting cross-legged with a spinning gold infinity halo.
- **Animations**: CSS animations tailored to `microState`:
  - `idle`: Slow breathing.
  - `thinking` / `planning`: Hovering floating loops and scanning lines.
  - `coding` / `executing`: Fast-pulsing auras and typing gestures.
  - `error`: Flashing alerts and chaotic glitch effects.

#### [NEW] [FloatingSpeechBubble.tsx](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/frontend/src/components/FloatingSpeechBubble.tsx)
- Spawns dialogue boxes that float above the agent's head.
- Displays the current `status_message` using a typing (typewriter) or fade animation.
- Fades out after a few seconds of inactivity.

#### [NEW] [FloatingExpText.tsx](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/frontend/src/components/FloatingExpText.tsx)
- Renders green floating indicators like `+10 EXP` or `Task Completed` that drift upward and fade out when the agent completes work or gains experience.

#### [MODIFY] [Dashboard.tsx](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/frontend/src/components/Dashboard.tsx)
- Add a view mode state (`viewMode: 'grid' | 'isometric'`).
- Renders a futuristic mode toggle in the header or at the top of the center panel.
- Renders `IsometricRoom` or the traditional `AgentMonitorCell` grid based on selection.

#### [MODIFY] [index.css](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/frontend/src/index.css)
- Add CSS classes and keyframes for 3D preservation, isometric viewport, glowing shadows, floating speech bubbles, and agent sprite-like animations.

---

## Verification Plan

### Automated Tests
- Run `npm run build` inside the `frontend` directory to ensure complete TypeScript compilations and Vite bundle builds succeed.

### Manual Verification
- Launch the application locally and navigate to the dashboard.
- Toggle between **Grid View** and **Isometric Office View** to verify responsiveness.
- Run a dummy/live task via the command input bar and observe:
  - Agent micro-states changing animations in real-time.
  - Desks and screens flashing crimson red when an error occurs, or jade green on success.
  - Speech bubbles popping up with typewriter messages.
  - Floating EXP indicators rising above the heads of active agents.
