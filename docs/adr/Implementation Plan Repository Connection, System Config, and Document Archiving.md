# Implementation Plan: Repository Connection, System Config, and Document Archiving

We will expand the Nexus-Agent Command Center by implementing a unified **Workspace Config** interface on both the backend (FastAPI) and frontend (React) to support repository connections, skill/roster updates, and Markdown document archiving.

---

## User Review Required

> [!IMPORTANT]
> - **Roster Expansion**: Adding custom agents on the dashboard will dynamically register them in the `DashboardHub`. They will start in `IDLE` state and be available to receive status updates.
> - **Workspace Directory**: All cloned repositories will be stored under a workspace folder `repos/` to keep the project root clean. All archived Markdown documents will be stored under `docs/archive/`.

---

## Proposed Changes

### Backend Components

#### [MODIFY] [skill_vault.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/skill_vault.py)
- Add `delete_skill(self, skill_id: str)` to support deleting a skill by its ID, deleting its steps from `skill_steps` and its FTS entry from `skills_fts`.

#### [MODIFY] [dashboard_hub.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/dashboard_hub.py)
- Add methods to register, update, and remove agents dynamically:
  - `add_agent(self, agent_id: str, role: AgentRole, display_name: str)`
  - `update_agent(self, agent_id: str, display_name: str)`
  - `delete_agent(self, agent_id: str)`

#### [MODIFY] [entrypoint.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/entrypoint.py)
- Implement backend endpoints for:
  - **Git Repository**:
    - `POST /repo/connect`: Clones a GitHub repository URL and branch into `repos/<repo_name>`, sets it as active, builds the knowledge graph, and returns the AST summary.
    - `GET /repo/active`: Returns the current repository details.
  - **Skills Management**:
    - `GET /skills`: Lists all skills in the persistent vault.
    - `DELETE /skills/{skill_id}`: Deletes a skill by ID.
  - **Roster Management**:
    - `GET /dashboard/roster`: Returns current roster of agents.
    - `POST /dashboard/roster/add`: Registers a new agent.
    - `POST /dashboard/roster/update`: Updates an agent's display name.
    - `DELETE /dashboard/roster/{agent_id}`: Removes an agent.
  - **Markdown Document Archive**:
    - `POST /docs/archive`: Saves a Markdown document inside `docs/archive/`.
    - `GET /docs/archive`: Lists archived `.md` files.
    - `GET /docs/archive/{filename}`: Retrieves the content of an archived `.md` file.
    - `DELETE /docs/archive/{filename}`: Deletes an archived `.md` file.

### Frontend Components

#### [MODIFY] [Dashboard.tsx](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/frontend/src/components/Dashboard.tsx)
- Add a new tab `Workspace Controls` to the Center Section.
- Expose sub-tabs for:
  1. **Git Repository**: Input GitHub URL and branch, trigger clone and build graph.
  2. **Knowledge & Skills**: List all skills, display details, add new skills, edit/save skills, or delete them.
  3. **Agent Roster**: View agents, update display names, and register new agents with custom roles.
  4. **Archived Docs**: View all archived `.md` files, edit/create new Markdown documents with a split-screen preview, and delete them.

---

## Verification Plan

### Automated Tests
- Run `npm run build` inside the `frontend/` directory to verify TypeScript compilations.
- Run python entrypoint tests or check backend API endpoints using manual verification.

### Manual Verification
- Deploy the system.
- Navigate to "Workspace Controls" -> "Git Repository" and clone a test repo. Verify that the Knowledge Graph is built automatically.
- Create and edit a skill under "Knowledge & Skills" and verify it is visible in searches.
- Add a custom agent under "Agent Roster" and verify that they appear in the Grid and Isometric rooms.
- Create a Markdown document under "Archived Docs" and verify it writes to the backend disk and can be re-opened or deleted.
