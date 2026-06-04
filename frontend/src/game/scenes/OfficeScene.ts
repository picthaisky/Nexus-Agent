import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import type { AgentRuntimeState, MicroState } from '../../types';
import { ExpFx } from '../../hooks/useAgentSocket';

// ─── Utilities ────────────────────────────────────────────────────────────────
const randBetween = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1) + a);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (x1: number, y1: number, x2: number, y2: number) =>
    Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

// ─── Grid constants ───────────────────────────────────────────────────────────
const GRID_W   = 30;   // expanded: 24 → 30 to fit specialist zones
const GRID_H   = 22;   // expanded: 18 → 22
const TILE_W   = 64;
const TILE_H   = 32;
const MOVE_SPD = 0.07;

// ─── Color palette (matches warm-wood corporate reference) ────────────────────
const P = {
    // Studio background
    BG:             0xf8f9fb,
    FLOOR_SHADOW:   0xd7dce3,

    // Floor tiles — zone-tinted
    FLOOR:          0xeeeeee,   // base grey tile
    FLOOR_LINE:     0xe0e0e0,   // very subtle grid line
    Z_DEV:          0xf5ede0,   // warm parquet (wood-hinted)
    Z_DESIGN:       0xedeef4,   // cool light carpet
    Z_MEET:         0xf0f2f0,   // neutral tile
    Z_LOUNGE:       0xf4dfbd,   // warm wood lounge
    Z_RISK:         0xffe2e2,   // alert-tinted monitoring deck
    Z_PANTRY:       0xf2f2f0,   // neutral

    // ── Warm wood desk system ──────────────────────────────────────────────
    WOOD_TOP:       0xd4956a,   // honey-oak surface (key element)
    WOOD_FRONT:     0xb8723e,   // front face (darker wood)
    WOOD_RIGHT:     0xc7834d,   // right face (medium wood)
    WOOD_EDGE:      0x9a5c2c,   // edge/trim

    // ── Dark ergonomic chair ──────────────────────────────────────────────
    CHAIR_SEAT:     0x1e1e1e,   // black leather seat
    CHAIR_BACK:     0x2a2a2a,   // charcoal backrest
    CHAIR_BASE:     0x3a3a3a,   // base/legs
    CHAIR_CUSHION:  0x232323,

    // ── Meeting table — white glass ───────────────────────────────────────
    TBL_TOP:        0xfafafa,
    TBL_SIDE:       0x9ca3af,
    MEET_CHAIR:     0x374151,

    // ── Warm lounge sofa system ──────────────────────────────────────────
    SOFA_SEAT:      0xe8dfd4,
    SOFA_BACK:      0xcab9a8,
    SOFA_ARM:       0xd8c7b7,

    // Coffee table (lounge) — white
    CTB_TOP:        0xf8f8f8,
    CTB_SIDE:       0xd0d0d0,

    // Whiteboard — clean white frame
    BOARD:          0xfafafa,
    BOARD_FRAME:    0x2563eb,   // blue frame

    // ── White ceramic plant pot (matches reference exactly) ───────────────
    POT:            0xf5f5f5,   // white ceramic
    POT_SHADOW:     0xe0e0e0,   // pot shadow
    LEAF_D:         0x2d7a3a,   // dark leaf
    LEAF_L:         0x3da34f,   // light leaf
    SOIL:           0x6b4423,

    // Coffee machine — light grey (matches reference, not dark steel)
    MACHINE:        0xe8e8e8,   // light grey body
    MACHINE_DARK:   0xc0c0c0,   // darker face

    // ── Glass partitions between zones ────────────────────────────────────
    GLASS:          0xcde4f0,   // blue-grey glass tint
    GLASS_FRAME:    0x94a3b8,   // aluminium frame
    WALL:           0xf8fafc,
    WALL_FRAME:     0xcbd5e1,
    SIGN_BG:        0x13233a,
    SERVER:         0x111827,
    SERVER_LIGHT:   0x38bdf8,

    // Status/role accents
    ALERT:          0xdc2626,
    WARN:           0xd97706,
    OK:             0x16a34a,

    // Avatar
    SUIT:           0x1e293b,
    SHIRT:          0xfafafa,
    SKIN:           0xfcd9b6,
    SKIN_SH:        0xf0bc94,
    HAIR:           0x1e1e2e,
};

// Role tie/accent colors — core + all 16 specialist agents
const ROLE_ACCENT: Record<string, number> = {
    // Core orchestration
    planner:         0x1d4ed8,
    architect:       0x0891b2,
    developer:       0x166534,
    ui_weaver:       0x7c3aed,
    validator:       0xb91c1c,
    optimizer:       0x92400e,
    player:          0x2563eb,
    // Specialist agents
    code_reviewer:   0x0284c7,
    debugger:        0xd97706,
    qa_tester:       0x6d28d9,
    db_architect:    0x0369a1,
    devops:          0x1d4ed8,
    data_analyst:    0x059669,
    project_mgr:     0x7c3aed,
    security:        0x9f1239,
    rag_agent:       0x0e7490,
    api_integration: 0x92400e,
};

const AGENT_DESKS: Record<string, { cartX: number; cartY: number }> = {
    // Core agents — original positions
    planner:         { cartX: 9,  cartY: 7  },
    architect:       { cartX: 11, cartY: 2  },
    developer:       { cartX: 15, cartY: 3  },
    ui_weaver:       { cartX: 18, cartY: 8  },
    validator:       { cartX: 16, cartY: 14 },
    optimizer:       { cartX: 4,  cartY: 13 },
    // Specialist agents — new zones (grid expanded to 30×22)
    code_reviewer:   { cartX: 13, cartY: 2  },  // Dev zone extension
    debugger:        { cartX: 13, cartY: 5  },  // Dev zone extension
    qa_tester:       { cartX: 4,  cartY: 18 },  // QA Lab
    db_architect:    { cartX: 15, cartY: 18 },  // DevOps Bay
    devops:          { cartX: 19, cartY: 18 },  // DevOps Bay
    data_analyst:    { cartX: 25, cartY: 3  },  // Analytics zone
    project_mgr:     { cartX: 27, cartY: 6  },  // Analytics zone
    security:        { cartX: 25, cartY: 12 },  // Security zone
    rag_agent:       { cartX: 27, cartY: 12 },  // Security zone
    api_integration: { cartX: 25, cartY: 16 },  // Security zone
};

const ZONES = {
    // Original 6 zones (preserved)
    lounge:      { x1: 1,  y1: 2,  x2: 6,  y2: 7,  floor: P.Z_LOUNGE,  accent: 0x9a5c2c },
    risk:        { x1: 1,  y1: 10, x2: 7,  y2: 16, floor: P.Z_RISK,    accent: P.ALERT },
    meeting:     { x1: 7,  y1: 8,  x2: 14, y2: 14, floor: P.Z_MEET,    accent: 0x166534 },
    dev:         { x1: 9,  y1: 1,  x2: 17, y2: 7,  floor: P.Z_DEV,    accent: 0x1d4ed8 },
    design:      { x1: 15, y1: 6,  x2: 22, y2: 12, floor: P.Z_DESIGN,  accent: 0x7c3aed },
    pantry:      { x1: 18, y1: 12, x2: 22, y2: 16, floor: P.Z_PANTRY,  accent: 0x92400e },
    // New specialist zones (grid expanded to 30×22)
    analytics:   { x1: 23, y1: 1,  x2: 29, y2: 9,  floor: 0xeef6ff,    accent: 0x0891b2 },
    security:    { x1: 23, y1: 10, x2: 29, y2: 17, floor: 0xfef2f2,    accent: 0x9f1239 },
    qalab:       { x1: 1,  y1: 17, x2: 10, y2: 21, floor: 0xf5f0ff,    accent: 0x6d28d9 },
    devops_bay:  { x1: 11, y1: 17, x2: 22, y2: 21, floor: 0xf0f9ff,    accent: 0x1d4ed8 },
};

interface AgentSpriteData {
    container:    Phaser.GameObjects.Container;
    body:         Phaser.GameObjects.Graphics;
    label:        Phaser.GameObjects.Text;
    bubble?:      Phaser.GameObjects.Container;
    interactHint?: Phaser.GameObjects.Container;
    progressBar?: Phaser.GameObjects.Graphics;  // live task progress bar
    cartPos:      { x: number; y: number };
    targetCart:   { x: number; y: number };
    wanderTimer:  number;
    currentState: MicroState;
    lastMsg:      string;
    // A* pathfinding
    path:         { x: number; y: number }[];
    pathIdx:      number;
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class OfficeScene extends Scene {

    private agentSprites: Map<string, AgentSpriteData> = new Map();
    private agentStates:  Record<string, AgentRuntimeState> = {};

    private playerCart   = { x: 13, y: 10 };
    private playerCont!:   Phaser.GameObjects.Container;
    private playerGfx!:    Phaser.GameObjects.Graphics;
    private cursors!:      Phaser.Types.Input.Keyboard.CursorKeys;
    private wasd!:         { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
    private eKey!:         Phaser.Input.Keyboard.Key;
    private eWasDown      = false;

    private walkable: boolean[][] = [];
    private nearbyId:  string | null = null;
    private lastNearby: string | null = null;

    // ── Zone activity lighting layers ────────────────────────────────────────
    private _zoneActivityLayers: Map<string, Phaser.GameObjects.Graphics> = new Map();

    // ── Permission bubble delay timers (waiting_for_human → 5s delay) ────────
    private _waitingTimers: Map<string, Phaser.Time.TimerEvent> = new Map();

    // ── Drag-to-pan state ─────────────────────────────────────────────────────
    private isPanning      = false;
    private panAnchorX     = 0;   // pointer screen-X when drag started
    private panAnchorY     = 0;   // pointer screen-Y when drag started
    private panScrollX     = 0;   // camera scrollX when drag started
    private panScrollY     = 0;   // camera scrollY when drag started
    private cameraFrozen   = false; // true = keep camera at panned position until player moves

    constructor() { super('OfficeScene'); }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    create() {
        this.cameras.main.setBackgroundColor('#f8f9fb');
        this.cameras.main.setZoom(0.66);
        this.buildWalkable();
        this.drawFloor();
        this.drawGlassPartitions();
        this.drawFurniture();
        this.spawnPlayer();
        this.setupInput();
        this.setupEvents();
        const sp = this.c2i(this.playerCart.x, this.playerCart.y);
        this.cameras.main.scrollX = sp.x - this.cameras.main.width  / 2;
        this.cameras.main.scrollY = sp.y - this.cameras.main.height / 2;
        EventBus.emit('current-scene-ready', this);

        // Clean up EventBus listeners when this scene is shut down or destroyed
        // to prevent stale handlers firing on a dead scene instance.
        this.events.once(Phaser.Core.Events.DESTROY, () => this._cleanupEventBus());
        this.events.once('shutdown',                  () => this._cleanupEventBus());
    }

    update(_t: number, dt: number) {
        // Guard: skip all frame logic while the scene is not fully active.
        // Phaser can call update() during shutdown, which causes null-access crashes
        // on Graphics/Container objects that are mid-way through destruction.
        if (!this.scene?.isActive() || !this.cameras?.main || !this.playerGfx?.active) return;

        this.movePlayer(dt);
        this.trackCamera();
        this.checkProximity();
        this.updateNPCs(dt);
        this.animateAvatars();
        this.updateZoneLighting();
        this.depthSort();
    }

    // ── Coordinate helpers ───────────────────────────────────────────────────

    c2i(cx: number, cy: number) {
        return { x: (cx - cy) * (TILE_W / 2), y: (cx + cy) * (TILE_H / 2) };
    }

    // ── Walkability ──────────────────────────────────────────────────────────

    private buildWalkable() {
        this.walkable = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(true));
        for (let x = 0; x < GRID_W; x++) { this.walkable[0][x] = this.walkable[GRID_H - 1][x] = false; }
        for (let y = 0; y < GRID_H; y++) { this.walkable[y][0] = this.walkable[y][GRID_W - 1] = false; }
        // Block all desk tiles (agent desks from AGENT_DESKS)
        for (const d of Object.values(AGENT_DESKS)) {
            this.sw(d.cartX, d.cartY, false);
            this.sw(d.cartX - 1, d.cartY, false);
            this.sw(d.cartX, d.cartY + 1, false);
        }
        // Meeting table
        for (let x = 8; x <= 12; x++) for (let y = 9; y <= 11; y++) this.sw(x, y, false);
        // Lounge sofas
        for (let x = 2; x <= 5; x++) for (let y = 3; y <= 5; y++) this.sw(x, y, false);
        // Risk deck
        for (let x = 2; x <= 5; x++) for (let y = 12; y <= 14; y++) this.sw(x, y, false);
        // Pantry counter
        for (let x = 19; x <= 21; x++) for (let y = 13; y <= 15; y++) this.sw(x, y, false);
        this.sw(21, 4, false); this.sw(22, 4, false); this.sw(21, 5, false);
        this.sw(18, 4, false); this.sw(19, 8, false); this.sw(13, 2, false);
        // New zone whiteboards/racks (block 1 tile each)
        this.sw(23, 4, false); // analytics whiteboard
        this.sw(28, 11, false); // security risk board
        this.sw(2, 20, false);  // QA whiteboard
        this.sw(22, 19, false); // DevOps server rack
    }

    private sw(x: number, y: number, v: boolean) {
        if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W) this.walkable[y][x] = v;
    }

    private ok(cx: number, cy: number): boolean {
        const tx = Math.round(cx), ty = Math.round(cy);
        if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return false;
        return this.walkable[ty][tx];
    }

    // ── Floor ────────────────────────────────────────────────────────────────

    private drawFloor() {
        // Base grey tile floor
        const base = this.add.graphics().setDepth(-200);
        for (let x = 0; x < GRID_W; x++) {
            for (let y = 0; y < GRID_H; y++) {
                const p = this.c2i(x, y);
                base.fillStyle(P.FLOOR, 1);
                base.lineStyle(0.4, P.FLOOR_LINE, 0.7);
                this.diamond(base, p.x, p.y);
            }
        }

        // Zone tint layers
        for (const zone of Object.values(ZONES)) {
            const g = this.add.graphics().setDepth(-150);
            for (let x = zone.x1; x <= zone.x2; x++) {
                for (let y = zone.y1; y <= zone.y2; y++) {
                    const p = this.c2i(x, y);
                    g.fillStyle(zone.floor, 1);
                    g.lineStyle(0.3, zone.accent, 0.12);
                    this.diamond(g, p.x, p.y);
                }
            }
            this.drawZoneRim(zone);
        }

        // Original zone labels
        this.zoneLabel('Lounge',              2.5, 2.1, 0x334155);
        this.zoneLabel('Risk Monitoring Area',3.5, 10.2, P.ALERT);
        this.zoneLabel('Planner / Coordinator',8.6, 7.1, 0x1d4ed8);
        this.zoneLabel('Meeting Room',        9.2, 8.1, 0x166534);
        this.zoneLabel('Architect',           10.6, 1.1, 0x0891b2);
        this.zoneLabel('Developer',           15.1, 1.7, 0x166534);
        this.zoneLabel('UI Reviewer',         18.2, 6.2, 0x7c3aed);
        this.zoneLabel('Validator',           16.2, 13.1, P.ALERT);
        this.zoneLabel('Pantry',              20.2, 12.1, 0x92400e);
        // New specialist zone labels
        this.zoneLabel('Analytics',           24.5, 1.2, 0x0891b2);
        this.zoneLabel('Security',            24.5, 10.2, 0x9f1239);
        this.zoneLabel('QA Lab',              2.5, 17.2, 0x6d28d9);
        this.zoneLabel('DevOps Bay',          13.5, 17.2, 0x1d4ed8);
        // Specialist desk name tags
        this.zoneLabel('Code Reviewer',       12.6, 1.1, 0x0284c7);
        this.zoneLabel('Debugger',            12.6, 4.1, 0xd97706);
        this.zoneLabel('Data Analyst',        24.5, 2.5, 0x059669);
        this.zoneLabel('Project Manager',     26.5, 5.5, 0x7c3aed);
        this.zoneLabel('Security Auditor',    24.5, 11.2, 0x9f1239);
        this.zoneLabel('RAG Agent',           26.5, 11.2, 0x0e7490);
        this.zoneLabel('API Integration',     24.5, 15.2, 0x92400e);
        this.zoneLabel('QA Tester',           3.5, 17.5, 0x6d28d9);
        this.zoneLabel('DB Architect',        14.5, 17.5, 0x0369a1);
        this.zoneLabel('DevOps',              18.5, 17.5, 0x1d4ed8);
    }

    private diamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number,
                    hw = TILE_W / 2, hh = TILE_H / 2) {
        g.beginPath();
        g.moveTo(cx, cy - hh); g.lineTo(cx + hw, cy);
        g.lineTo(cx, cy + hh); g.lineTo(cx - hw, cy);
        g.closePath(); g.fillPath(); g.strokePath();
    }

    private zoneLabel(text: string, cx: number, cy: number, color: number) {
        const p   = this.c2i(cx, cy);
        const w = clamp(text.length * 5.4 + 18, 50, 124);
        const bg = this.add.graphics();
        bg.fillStyle(P.SIGN_BG, 0.95);
        bg.lineStyle(1, color, 0.55);
        bg.fillRoundedRect(-w / 2, -9, w, 18, 3);
        bg.strokeRoundedRect(-w / 2, -9, w, 18, 3);
        bg.fillStyle(color, 1);
        bg.fillRect(-w / 2, -9, 4, 18);
        const label = this.add.text(0, 0, text, {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '8px',
            fontStyle: 'bold',
            color: '#ffffff',
        }).setOrigin(0.5);
        const con = this.add.container(p.x, p.y - 36, [bg, label]).setDepth(p.y + 80);
        con.setAlpha(0.94);
    }

    private drawZoneRim(zone: { x1: number; y1: number; x2: number; y2: number; accent: number }) {
        const top = this.c2i(zone.x1, zone.y1);
        const right = this.c2i(zone.x2, zone.y1);
        const bottom = this.c2i(zone.x2, zone.y2);
        const left = this.c2i(zone.x1, zone.y2);
        const pts = [
            { x: top.x, y: top.y - TILE_H / 2 },
            { x: right.x + TILE_W / 2, y: right.y },
            { x: bottom.x, y: bottom.y + TILE_H / 2 },
            { x: left.x - TILE_W / 2, y: left.y },
        ];
        const g = this.add.graphics().setDepth(-145);

        g.fillStyle(P.FLOOR_SHADOW, 0.45);
        g.beginPath();
        g.moveTo(pts[1].x, pts[1].y);
        g.lineTo(pts[2].x, pts[2].y);
        g.lineTo(pts[2].x, pts[2].y + 13);
        g.lineTo(pts[1].x, pts[1].y + 13);
        g.closePath(); g.fillPath();
        g.beginPath();
        g.moveTo(pts[2].x, pts[2].y);
        g.lineTo(pts[3].x, pts[3].y);
        g.lineTo(pts[3].x, pts[3].y + 13);
        g.lineTo(pts[2].x, pts[2].y + 13);
        g.closePath(); g.fillPath();

        g.lineStyle(2, zone.accent, 0.34);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        g.lineTo(pts[1].x, pts[1].y);
        g.lineTo(pts[2].x, pts[2].y);
        g.lineTo(pts[3].x, pts[3].y);
        g.closePath(); g.strokePath();
    }

    // ── Glass Partitions ─────────────────────────────────────────────────────

    private drawGlassPartitions() {
        for (let x = 9; x <= 17; x += 2) this.drawGlassPanel(x, 1, x + 1, 1);
        for (let y = 6; y <= 12; y++) this.drawGlassPanel(15, y, 15, y);
        for (let x = 7; x <= 14; x++) if (x < 9 || x > 11) this.drawGlassPanel(x, 8, x, 8);
        for (let x = 1; x <= 6; x += 2) this.drawGlassPanel(x, 2, x + 1, 2);
        for (let y = 10; y <= 16; y += 2) this.drawGlassPanel(7, y, 7, y + 1);
        this.drawWallPanel(13.8, 1.4, 94, 56, 0x1d4ed8, 'analytics');
        this.drawWallPanel(20.2, 6.6, 82, 62, 0x7c3aed, 'kanban');
        this.drawWallPanel(9.8, 8.2, 118, 58, 0x166534, 'charts');
        this.drawWallPanel(16.7, 13.0, 88, 50, P.ALERT, 'kanban');
    }

    private drawGlassPanel(x1: number, y1: number, x2: number, y2: number) {
        const p1 = this.c2i(x1, y1), p2 = this.c2i(x2, y2);
        const g = this.add.graphics().setDepth(-70);
        // Glass fill
        g.fillStyle(P.GLASS, 0.18);
        g.beginPath();
        g.moveTo(p1.x, p1.y - TILE_H / 2 - 22);
        g.lineTo(p2.x + TILE_W / 2, p2.y - 22);
        g.lineTo(p2.x + TILE_W / 2, p2.y);
        g.lineTo(p1.x, p1.y - TILE_H / 2);
        g.closePath(); g.fillPath();
        // Aluminium frame top line
        g.lineStyle(1, P.GLASS_FRAME, 0.5);
        g.beginPath();
        g.moveTo(p1.x - 2, p1.y - TILE_H / 2 - 22);
        g.lineTo(p2.x + TILE_W / 2 + 2, p2.y - 22);
        g.strokePath();
    }

    private drawWallPanel(cx: number, cy: number, w: number, h: number, accent: number, mode: 'analytics' | 'kanban' | 'charts') {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 48);

        g.fillStyle(0x000000, 0.05);
        g.fillRect(p.x - w / 2 + 5, p.y - h - 9, w, h);
        g.fillStyle(P.WALL, 0.98);
        g.lineStyle(1.5, P.WALL_FRAME, 0.85);
        g.fillRect(p.x - w / 2, p.y - h - 12, w, h);
        g.strokeRect(p.x - w / 2, p.y - h - 12, w, h);
        g.fillStyle(accent, 0.12);
        g.fillRect(p.x - w / 2 + 3, p.y - h - 9, w - 6, 8);

        if (mode === 'kanban') {
            const colors = [0xfef3c7, 0xdbeafe, 0xfce7f3, 0xdcfce7, 0xffedd5];
            for (let i = 0; i < 12; i++) {
                const x = p.x - w / 2 + 10 + (i % 4) * 17;
                const y = p.y - h + 5 + Math.floor(i / 4) * 14;
                g.fillStyle(colors[i % colors.length], 1);
                g.lineStyle(0.4, 0xcbd5e1, 0.55);
                g.fillRect(x, y, 12, 9);
                g.strokeRect(x, y, 12, 9);
            }
            return;
        }

        if (mode === 'charts') {
            g.lineStyle(1, 0x94a3b8, 0.45);
            for (let i = 0; i < 4; i++) {
                g.beginPath();
                g.moveTo(p.x - w / 2 + 9, p.y - h + 6 + i * 10);
                g.lineTo(p.x + w / 2 - 9, p.y - h + 6 + i * 10);
                g.strokePath();
            }
            for (let i = 0; i < 6; i++) {
                const bh = 8 + i * 4;
                g.fillStyle(i % 2 ? 0x16a34a : accent, 0.55);
                g.fillRect(p.x - w / 2 + 16 + i * 12, p.y - 17 - bh, 7, bh);
            }
            return;
        }

        g.lineStyle(1, accent, 0.65);
        g.beginPath();
        for (let i = 0; i < 7; i++) {
            const x = p.x - w / 2 + 12 + i * 11;
            const y = p.y - 26 - Math.sin(i * 0.9) * 12 - i * 2;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokePath();
        g.fillStyle(0x2563eb, 0.18); g.fillCircle(p.x - 18, p.y - 43, 13);
        g.lineStyle(3, accent, 0.75); g.strokeCircle(p.x - 18, p.y - 43, 13);
        g.fillStyle(0xf59e0b, 0.75); g.fillRect(p.x + 12, p.y - 54, 28, 6);
        g.fillStyle(0x16a34a, 0.75); g.fillRect(p.x + 12, p.y - 42, 38, 6);
        g.fillStyle(0xdc2626, 0.75); g.fillRect(p.x + 12, p.y - 30, 20, 6);
    }

    private drawPresentationScreen(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 16);
        g.fillStyle(0xffffff, 0.98);
        g.lineStyle(1.5, 0x94a3b8, 0.85);
        g.fillRect(p.x - 46, p.y - 74, 92, 54);
        g.strokeRect(p.x - 46, p.y - 74, 92, 54);
        g.fillStyle(0xdbeafe, 1);
        g.fillRect(p.x - 40, p.y - 66, 48, 26);
        g.fillStyle(0x2563eb, 0.75);
        for (let i = 0; i < 5; i++) g.fillRect(p.x - 36 + i * 8, p.y - 42 - i * 4, 5, 8 + i * 4);
        g.lineStyle(1, 0xef4444, 0.7);
        g.beginPath(); g.moveTo(p.x + 14, p.y - 60); g.lineTo(p.x + 38, p.y - 36); g.strokePath();
        g.fillStyle(0x94a3b8, 1);
        g.fillRect(p.x - 3, p.y - 20, 6, 18);
        g.fillRect(p.x - 14, p.y - 3, 28, 3);
    }

    private drawLoungeMediaWall(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 14);
        g.fillStyle(0x4b5563, 1);
        g.fillRect(p.x - 34, p.y - 50, 68, 34);
        g.fillStyle(0x0f172a, 1);
        g.fillRect(p.x - 30, p.y - 46, 60, 26);
        g.fillStyle(0x38bdf8, 0.28);
        g.fillRect(p.x - 27, p.y - 43, 54, 20);
        g.fillStyle(0xffffff, 0.18);
        g.fillRect(p.x - 24, p.y - 40, 20, 5);
        g.fillStyle(P.WOOD_FRONT, 1);
        g.fillRect(p.x - 38, p.y - 14, 76, 10);
        g.fillStyle(P.WOOD_TOP, 1);
        g.fillRect(p.x - 34, p.y - 20, 68, 6);
    }

    private drawServerRack(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 18);
        g.fillStyle(0x000000, 0.09);
        g.fillEllipse(p.x, p.y + 2, 42, 12);
        g.fillStyle(P.SERVER, 1);
        g.lineStyle(1.5, 0x0f172a, 0.9);
        g.fillRoundedRect(p.x - 18, p.y - 86, 36, 82, 3);
        g.strokeRoundedRect(p.x - 18, p.y - 86, 36, 82, 3);
        for (let i = 0; i < 8; i++) {
            const y = p.y - 78 + i * 9;
            g.fillStyle(0x1f2937, 1);
            g.fillRect(p.x - 14, y, 28, 6);
            g.fillStyle(P.SERVER_LIGHT, 0.9);
            g.fillCircle(p.x + 9, y + 3, 1.5);
            g.fillStyle(i % 3 === 0 ? P.ALERT : 0x16a34a, 0.8);
            g.fillCircle(p.x + 13, y + 3, 1.3);
        }
    }

    private drawPantryCounter(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 7);
        g.fillStyle(P.WOOD_FRONT, 1);
        g.fillRect(p.x - 48, p.y - 38, 96, 32);
        g.fillStyle(P.WOOD_TOP, 1);
        g.fillRect(p.x - 52, p.y - 45, 104, 10);
        g.lineStyle(0.8, P.WOOD_EDGE, 0.55);
        for (let i = 0; i < 4; i++) g.strokeRect(p.x - 46 + i * 24, p.y - 34, 22, 27);
        g.fillStyle(0xf8fafc, 1);
        g.lineStyle(0.8, 0xcbd5e1, 0.8);
        g.fillRect(p.x + 38, p.y - 84, 28, 70);
        g.strokeRect(p.x + 38, p.y - 84, 28, 70);
        g.fillStyle(0xe2e8f0, 1);
        g.fillRect(p.x + 41, p.y - 50, 22, 2);
        g.fillStyle(0x94a3b8, 1);
        g.fillRect(p.x + 58, p.y - 70, 3, 10);
    }

    private drawCafeTable(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 3);
        g.fillStyle(0x000000, 0.06);
        g.fillEllipse(p.x, p.y + 3, 56, 18);
        g.fillStyle(0xf8fafc, 1);
        g.lineStyle(0.7, 0xcbd5e1, 0.9);
        g.fillEllipse(p.x, p.y - 11, 42, 20);
        g.strokeEllipse(p.x, p.y - 11, 42, 20);
        g.fillStyle(P.WOOD_EDGE, 1);
        g.fillRect(p.x - 3, p.y - 9, 6, 16);
        for (const [ox, oy] of [[-30, -5], [31, -4], [0, 18]] as const) {
            g.fillStyle(0x334155, 1);
            g.fillEllipse(p.x + ox, p.y + oy, 20, 9);
            g.fillStyle(0x475569, 1);
            g.fillRect(p.x + ox - 6, p.y + oy - 16, 12, 12);
        }
    }

    private drawRiskMonitoringDeck(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 24);

        g.fillStyle(0x991b1b, 0.18);
        g.lineStyle(2, P.ALERT, 0.65);
        g.beginPath();
        g.moveTo(p.x - 110, p.y + 2);
        g.lineTo(p.x - 12, p.y + 52);
        g.lineTo(p.x + 110, p.y - 4);
        g.lineTo(p.x + 8, p.y - 58);
        g.closePath(); g.fillPath(); g.strokePath();

        g.fillStyle(0x111827, 1);
        g.fillRoundedRect(p.x - 96, p.y - 112, 192, 74, 4);
        g.lineStyle(1.2, P.ALERT, 0.75);
        g.strokeRoundedRect(p.x - 96, p.y - 112, 192, 74, 4);
        g.fillStyle(P.ALERT, 0.92);
        g.fillRect(p.x - 96, p.y - 112, 192, 13);

        this.add.text(p.x - 88, p.y - 105, 'RISK MONITORING AREA', {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '8px',
            fontStyle: 'bold',
            color: '#ffffff',
        }).setDepth(p.y + 40);

        const screenColors = [0x0f172a, 0x172554, 0x111827];
        for (let i = 0; i < 3; i++) {
            const x = p.x - 86 + i * 61;
            g.fillStyle(screenColors[i], 1);
            g.fillRect(x, p.y - 92, 54, 42);
            g.lineStyle(0.7, 0x334155, 0.8);
            g.strokeRect(x, p.y - 92, 54, 42);
            g.lineStyle(1, i === 0 ? P.ALERT : i === 1 ? 0x38bdf8 : 0x16a34a, 0.8);
            g.beginPath();
            for (let k = 0; k < 6; k++) {
                const px = x + 7 + k * 8;
                const py = p.y - 60 - Math.sin(k + i) * 11 - k * 1.5;
                if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.strokePath();
        }

        g.fillStyle(P.WOOD_FRONT, 1);
        g.fillRoundedRect(p.x - 62, p.y - 36, 124, 28, 3);
        g.fillStyle(0x1f2937, 1);
        for (let i = 0; i < 3; i++) g.fillRect(p.x - 48 + i * 36, p.y - 52, 28, 18);
        for (const [label, value, ox] of [['IDENTIFIED', '23', -70], ['AT RISK', '13', 0], ['RESOLVED', '10', 70]] as const) {
            g.fillStyle(0x1f2937, 0.96);
            g.fillRoundedRect(p.x + ox - 30, p.y + 12, 60, 34, 2);
            g.lineStyle(0.7, 0x475569, 0.8);
            g.strokeRoundedRect(p.x + ox - 30, p.y + 12, 60, 34, 2);
            this.add.text(p.x + ox, p.y + 20, label, {
                fontFamily: 'Inter, system-ui, sans-serif', fontSize: '5px', color: '#cbd5e1',
            }).setOrigin(0.5).setDepth(p.y + 40);
            this.add.text(p.x + ox, p.y + 35, value, {
                fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', fontStyle: 'bold', color: '#ffffff',
            }).setOrigin(0.5).setDepth(p.y + 40);
        }
    }

    // ── Furniture ────────────────────────────────────────────────────────────

    private drawFurniture() {
        for (const [role, pos] of Object.entries(AGENT_DESKS)) {
            const accent = ROLE_ACCENT[role] ?? 0x94a3b8;
            this.drawDesk(pos.cartX, pos.cartY, accent);
            this.drawErgonomicChair(pos.cartX + 0.55, pos.cartY + 0.85);
        }

        this.drawDesk(13.4, 4.6, ROLE_ACCENT.developer);
        this.drawErgonomicChair(14, 5.35);
        this.drawDesk(18.8, 9.6, ROLE_ACCENT.ui_weaver);
        this.drawErgonomicChair(19.4, 10.4);

        // Meeting table + chairs
        this.drawMeetingTable(10.2, 10.6);
        for (const [dx, dy] of [[-1.8,0],[1.8,0],[0,-1.7],[0,1.7],[-1.2,-1.1],[1.2,1.1]] as const) {
            this.drawMeetingChair(10.2 + dx, 10.6 + dy);
        }
        this.drawPresentationScreen(8.1, 8.5);

        // Lounge cluster
        this.drawSofa(3.1, 4.8);
        this.drawSofa(4.7, 3.5);
        this.drawCoffeeTable(3.8, 5.2);
        this.drawLoungeMediaWall(2.3, 3.2);

        // Developer and design support objects
        this.drawWhiteboard(12.4, 2.1);
        this.drawServerRack(21.6, 4.8);
        this.drawBookshelf(21.4, 8.6);

        // Plants with white ceramic pots
        for (const [px, py] of [[7.5,7.1],[1.4,2.4],[6.2,7.2],[17.2,6.3],[22.1,12.4],[13.6,15.0],[21.8,16.0]] as const) {
            this.drawPlant(px, py);
        }

        // Pantry area
        this.drawPantryCounter(20, 14.1);
        this.drawCoffeeMachine(19.2, 13.2);
        this.drawCafeTable(21.2, 15.1);

        // Risk monitoring area
        this.drawRiskMonitoringDeck(3.9, 13.1);
        this.drawRiskBoard(6.4, 11.1);

        // ── New specialist zones furniture ────────────────────────────────
        // Analytics zone plants + whiteboard
        this.drawWhiteboard(23.5, 4.5);
        this.drawPlant(28.8, 1.5);
        this.drawPlant(23.5, 8.5);

        // Security zone risk board
        this.drawRiskBoard(28.5, 11.5);
        this.drawPlant(23.5, 16.8);

        // QA Lab whiteboard + chairs
        this.drawWhiteboard(2.1, 20.8);
        this.drawPlant(9.5, 20.5);

        // DevOps Bay server rack + plants
        this.drawServerRack(22.5, 19.1);
        this.drawPlant(11.2, 20.5);
        this.drawPlant(20.5, 20.5);
    }

    /** Warm-wood desk with proper isometric box + monitor */
    private drawDesk(cx: number, cy: number, roleAccent: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 1);
        const W = 44, H = 22, Z = 17;

        // Ambient shadow under desk
        g.fillStyle(0x000000, 0.06);
        g.beginPath();
        g.moveTo(p.x - W - 2, p.y + 2);
        g.lineTo(p.x + 2,     p.y + H + 2);
        g.lineTo(p.x + W + 2, p.y + 2);
        g.lineTo(p.x + 2,     p.y - H + 2);
        g.closePath(); g.fillPath();

        // ── Left face (dark wood) ──
        g.fillStyle(P.WOOD_FRONT, 1);
        g.beginPath();
        g.moveTo(p.x - W, p.y - Z);
        g.lineTo(p.x,     p.y - Z + H);
        g.lineTo(p.x,     p.y + H);
        g.lineTo(p.x - W, p.y);
        g.closePath(); g.fillPath();
        g.lineStyle(0.5, P.WOOD_EDGE, 0.5); g.strokePath();

        // ── Right face (medium wood) ──
        g.fillStyle(P.WOOD_RIGHT, 1);
        g.beginPath();
        g.moveTo(p.x,     p.y - Z + H);
        g.lineTo(p.x + W, p.y - Z);
        g.lineTo(p.x + W, p.y);
        g.lineTo(p.x,     p.y + H);
        g.closePath(); g.fillPath();
        g.lineStyle(0.5, P.WOOD_EDGE, 0.4); g.strokePath();

        // ── Top face (honey oak) ──
        g.fillStyle(P.WOOD_TOP, 1);
        g.beginPath();
        g.moveTo(p.x,     p.y - Z - H);
        g.lineTo(p.x + W, p.y - Z);
        g.lineTo(p.x,     p.y - Z + H);
        g.lineTo(p.x - W, p.y - Z);
        g.closePath(); g.fillPath();
        g.lineStyle(1, roleAccent, 0.35); g.strokePath();

        // Wood grain lines on top (subtle)
        g.lineStyle(0.4, P.WOOD_EDGE, 0.18);
        for (let i = 1; i < 4; i++) {
            const frac = i / 4;
            g.beginPath();
            g.moveTo(p.x - W + W * 2 * frac, p.y - Z - H + H * 2 * frac - H);
            g.lineTo(p.x + W * frac,          p.y - Z + H * frac - H * frac);
            g.strokePath();
        }

        // Role-colored front-edge accent strip
        g.lineStyle(2, roleAccent, 0.4);
        g.beginPath();
        g.moveTo(p.x - W, p.y - Z); g.lineTo(p.x, p.y - Z + H);
        g.strokePath();

        // ── Monitor (thin bezel, large screen) ──
        const mx = p.x + 7, my = p.y - Z - 7;
        g.fillStyle(0x1e1e1e, 1);                          // thin black bezel
        g.fillRect(mx - 11, my - 16, 22, 16);
        g.fillStyle(0x1e3a5f, 0.9);                        // dark blue screen
        g.fillRect(mx - 9,  my - 14, 18, 12);
        g.fillStyle(0x2563eb, 0.35);                       // screen glow
        g.fillRect(mx - 9,  my - 14, 18, 12);
        g.fillStyle(0xffffff, 0.12);                       // screen glare
        g.fillRect(mx - 8,  my - 13, 6, 3);
        g.fillStyle(0x333333, 1);                          // monitor stand
        g.fillRect(mx - 2,  my,      4,  5);
        g.fillRect(mx - 6,  my + 4,  12, 2);

        // ── Keyboard ──
        g.fillStyle(0xf0f0f0, 1); g.lineStyle(0.5, 0xd0d0d0, 0.8);
        g.fillRect(mx - 9, my + 2, 14, 4); g.strokeRect(mx - 9, my + 2, 14, 4);

        // ── Paper stack on desk ──
        g.fillStyle(0xffffff, 1); g.lineStyle(0.5, 0xe0e0e0, 0.9);
        g.fillRect(p.x - 18, p.y - Z - 3, 11, 8); g.strokeRect(p.x - 18, p.y - Z - 3, 11, 8);
        g.lineStyle(0.5, 0xb0b8c0, 0.6);
        for (let i = 0; i < 3; i++) {
            g.beginPath(); g.moveTo(p.x - 16, p.y - Z + i * 2);
            g.lineTo(p.x - 9,  p.y - Z + i * 2); g.strokePath();
        }
    }

    /** Dark ergonomic chair with visible backrest */
    private drawErgonomicChair(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 12);

        // Chair base shadow
        g.fillStyle(0x000000, 0.08);
        g.fillEllipse(p.x, p.y + 2, 22, 8);

        // ── Seat (isometric diamond, black leather) ──
        g.fillStyle(P.CHAIR_SEAT, 1);
        g.lineStyle(0.5, P.CHAIR_BASE, 0.6);
        g.beginPath();
        g.moveTo(p.x,      p.y - 8 - 12);
        g.lineTo(p.x + 20, p.y - 8);
        g.lineTo(p.x,      p.y - 8 + 12);
        g.lineTo(p.x - 20, p.y - 8);
        g.closePath(); g.fillPath(); g.strokePath();

        // Seat cushion highlight
        g.fillStyle(0xffffff, 0.06);
        g.beginPath();
        g.moveTo(p.x - 8, p.y - 8 - 5);
        g.lineTo(p.x + 8, p.y - 8 + 1);
        g.lineTo(p.x,     p.y - 8 + 5);
        g.lineTo(p.x - 8, p.y - 8 - 1);
        g.closePath(); g.fillPath();

        // ── Backrest ──
        g.fillStyle(P.CHAIR_BACK, 1);
        g.fillRect(p.x - 10, p.y - 8 - 32, 20, 22);
        g.lineStyle(0.5, 0x111111, 0.4);
        g.strokeRect(p.x - 10, p.y - 8 - 32, 20, 22);

        // Backrest top curve (headrest)
        g.fillStyle(P.CHAIR_CUSHION, 1);
        g.fillRect(p.x - 7, p.y - 8 - 36, 14, 6);
        g.fillStyle(0xffffff, 0.07);
        g.fillRect(p.x - 5, p.y - 8 - 34, 5, 2);

        // Armrests (two small flat rectangles left+right)
        g.fillStyle(P.CHAIR_BASE, 1);
        g.fillRect(p.x - 16, p.y - 8 - 16, 6, 8);
        g.fillRect(p.x + 10, p.y - 8 - 16, 6, 8);

        // 5-star base (two crossed lines)
        g.lineStyle(1.5, P.CHAIR_BASE, 0.7);
        g.beginPath(); g.moveTo(p.x - 10, p.y + 2); g.lineTo(p.x + 10, p.y + 2); g.strokePath();
        g.beginPath(); g.moveTo(p.x, p.y - 5); g.lineTo(p.x, p.y + 8); g.strokePath();
        g.fillStyle(P.CHAIR_BASE, 1); g.fillCircle(p.x, p.y + 4, 3);
    }

    /** Warm wood desk for meeting room chairs */
    private drawMeetingChair(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 10);

        g.fillStyle(P.MEET_CHAIR, 1);
        g.lineStyle(0.5, 0x263040, 0.6);
        g.beginPath();
        g.moveTo(p.x,      p.y - 8 - 10);
        g.lineTo(p.x + 18, p.y - 8);
        g.lineTo(p.x,      p.y - 8 + 10);
        g.lineTo(p.x - 18, p.y - 8);
        g.closePath(); g.fillPath(); g.strokePath();

        g.fillStyle(0x2e3e50, 1);
        g.fillRect(p.x - 8, p.y - 8 - 22, 16, 12);
        g.lineStyle(0.5, 0x1e2e3e, 0.4);
        g.strokeRect(p.x - 8, p.y - 8 - 22, 16, 12);
    }

    /** White glass meeting table */
    private drawMeetingTable(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 5);
        const rW = 70, rH = 35, Z = 10;

        // Shadow
        g.fillStyle(0x000000, 0.07);
        g.beginPath();
        g.moveTo(p.x - rW, p.y - Z + 4); g.lineTo(p.x, p.y - Z + rH + 4);
        g.lineTo(p.x, p.y + rH + 4);     g.lineTo(p.x - rW, p.y + 4);
        g.closePath(); g.fillPath();

        // Side
        g.fillStyle(P.TBL_SIDE, 1);
        g.beginPath();
        g.moveTo(p.x - rW, p.y - Z); g.lineTo(p.x, p.y - Z + rH);
        g.lineTo(p.x, p.y + rH);     g.lineTo(p.x - rW, p.y);
        g.closePath(); g.fillPath();

        // Top
        g.fillStyle(P.TBL_TOP, 0.97);
        g.lineStyle(1.5, P.TBL_SIDE, 0.7);
        g.beginPath();
        g.moveTo(p.x,      p.y - Z - rH); g.lineTo(p.x + rW, p.y - Z);
        g.lineTo(p.x,      p.y - Z + rH); g.lineTo(p.x - rW, p.y - Z);
        g.closePath(); g.fillPath(); g.strokePath();

        // Glass reflection
        g.fillStyle(0xffffff, 0.25);
        g.beginPath();
        g.moveTo(p.x - 22, p.y - Z - rH + 5); g.lineTo(p.x + 8, p.y - Z - 7);
        g.lineTo(p.x - 2,  p.y - Z + 5);       g.lineTo(p.x - 32, p.y - Z - 9);
        g.closePath(); g.fillPath();

        // Top surface accent line (green meeting accent)
        g.lineStyle(1, 0x16a34a, 0.3);
        g.beginPath(); g.moveTo(p.x - rW, p.y - Z); g.lineTo(p.x + rW, p.y - Z); g.strokePath();
    }

    /** ORANGE sofa — key reference element */
    private drawSofa(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 1);
        const W = 30, H = 42, Z = 20;

        // Shadow
        g.fillStyle(0x000000, 0.08);
        g.beginPath();
        g.moveTo(p.x, p.y + 2); g.lineTo(p.x + W + 2, p.y - H + 2);
        g.lineTo(p.x, p.y - H * 2 + 2); g.lineTo(p.x - W - 2, p.y - H + 2);
        g.closePath(); g.fillPath();

        // ── Left side face ──
        g.fillStyle(P.SOFA_BACK, 1);
        g.beginPath();
        g.moveTo(p.x - W, p.y - Z); g.lineTo(p.x, p.y - Z + H);
        g.lineTo(p.x, p.y + H);     g.lineTo(p.x - W, p.y);
        g.closePath(); g.fillPath();
        g.lineStyle(0.5, 0xb05e20, 0.4); g.strokePath();

        // ── Seat top (orange) ──
        g.fillStyle(P.SOFA_SEAT, 1);
        g.lineStyle(0.5, P.SOFA_BACK, 0.5);
        g.beginPath();
        g.moveTo(p.x,     p.y - Z - H); g.lineTo(p.x + W, p.y - Z);
        g.lineTo(p.x,     p.y - Z + H); g.lineTo(p.x - W, p.y - Z);
        g.closePath(); g.fillPath(); g.strokePath();

        // Seat cushion seam
        g.lineStyle(1, P.SOFA_BACK, 0.45);
        g.beginPath(); g.moveTo(p.x, p.y - Z - H); g.lineTo(p.x, p.y - Z + H); g.strokePath();

        // Orange highlight on seat
        g.fillStyle(0xffffff, 0.1);
        g.beginPath();
        g.moveTo(p.x - 14, p.y - Z - H + 4); g.lineTo(p.x + 8, p.y - Z - 2);
        g.lineTo(p.x,      p.y - Z + 4);      g.lineTo(p.x - 22, p.y - Z - 4);
        g.closePath(); g.fillPath();

        // ── Back cushion ──
        g.fillStyle(P.SOFA_BACK, 1);
        g.fillRect(p.x - W, p.y - Z - H - 18, W * 2, 20);
        g.lineStyle(0.5, 0xb05e20, 0.4);
        g.strokeRect(p.x - W, p.y - Z - H - 18, W * 2, 20);

        // Back cushion orange highlight
        g.fillStyle(P.SOFA_SEAT, 0.4);
        g.fillRect(p.x - W + 2, p.y - Z - H - 16, W * 2 - 4, 16);

        // Armrests
        g.fillStyle(P.SOFA_ARM, 1);
        g.fillRect(p.x - W - 5, p.y - Z - H - 16, 6, 28);
        g.fillRect(p.x + W - 1, p.y - Z - H - 16, 6, 28);
    }

    /** White coffee table */
    private drawCoffeeTable(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 5);
        const Z = 6;

        g.fillStyle(P.CTB_SIDE, 1);
        g.beginPath();
        g.moveTo(p.x - 24, p.y - Z); g.lineTo(p.x, p.y - Z + 13);
        g.lineTo(p.x, p.y + 13);    g.lineTo(p.x - 24, p.y);
        g.closePath(); g.fillPath();

        g.fillStyle(P.CTB_TOP, 1);
        g.lineStyle(0.5, P.CTB_SIDE, 0.8);
        g.beginPath();
        g.moveTo(p.x,      p.y - Z - 13); g.lineTo(p.x + 24, p.y - Z);
        g.lineTo(p.x,      p.y - Z + 13); g.lineTo(p.x - 24, p.y - Z);
        g.closePath(); g.fillPath(); g.strokePath();

        // Coffee cups
        for (const [ox, oy] of [[-6, -3], [6, -1]] as const) {
            g.fillStyle(0xffffff, 1); g.lineStyle(0.5, 0xdddddd, 0.8);
            g.fillCircle(p.x + ox, p.y - Z + oy, 3.5);
            g.strokeCircle(p.x + ox, p.y - Z + oy, 3.5);
            g.fillStyle(0x6b3b2a, 0.9); g.fillCircle(p.x + ox, p.y - Z + oy, 2.5);
        }
    }

    /** Clean whiteboard with blue frame */
    private drawWhiteboard(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 2);

        // Board face
        g.fillStyle(0xfafafa, 1);
        g.fillRect(p.x - 34, p.y - 66, 68, 50);
        g.lineStyle(2, P.BOARD_FRAME, 0.8);
        g.strokeRect(p.x - 34, p.y - 66, 68, 50);

        // Content — structured flow diagram
        g.lineStyle(1, 0x93c5fd, 0.5);
        for (let i = 0; i < 4; i++) {
            g.beginPath();
            g.moveTo(p.x - 28, p.y - 60 + i * 9);
            g.lineTo(p.x + 22, p.y - 60 + i * 9);
            g.strokePath();
        }
        // Blue boxes
        g.fillStyle(0x2563eb, 0.15); g.lineStyle(0.5, 0x2563eb, 0.6);
        g.fillRect(p.x - 28, p.y - 62, 16, 9); g.strokeRect(p.x - 28, p.y - 62, 16, 9);
        g.fillRect(p.x + 5,  p.y - 62, 14, 9); g.strokeRect(p.x + 5,  p.y - 62, 14, 9);
        // Arrow
        g.lineStyle(1, P.BOARD_FRAME, 0.55);
        g.beginPath(); g.moveTo(p.x - 12, p.y - 58); g.lineTo(p.x + 5, p.y - 58); g.strokePath();

        // Stand
        g.fillStyle(0xaaaaaa, 1);
        g.fillRect(p.x - 3, p.y - 16, 6, 16);
        g.fillRect(p.x - 10, p.y - 2, 20, 2);
    }

    /** Plant with white ceramic pot — matches reference exactly */
    private drawPlant(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 2);

        // Pot shadow
        g.fillStyle(0x000000, 0.07);
        g.fillEllipse(p.x, p.y + 2, 18, 6);

        // White ceramic pot
        g.fillStyle(P.POT, 1);
        g.lineStyle(0.5, P.POT_SHADOW, 0.7);
        g.fillRect(p.x - 8, p.y - 15, 16, 15);
        g.strokeRect(p.x - 8, p.y - 15, 16, 15);

        // Pot rim highlight
        g.fillStyle(0xffffff, 0.4);
        g.fillRect(p.x - 7, p.y - 15, 14, 2);

        // Soil
        g.fillStyle(P.SOIL, 1);
        g.fillEllipse(p.x, p.y - 14, 14, 5);

        // Leaf body
        g.fillStyle(P.LEAF_D, 1);
        g.fillEllipse(p.x, p.y - 26, 24, 20);

        // Lighter top leaves
        g.fillStyle(P.LEAF_L, 0.85);
        g.fillEllipse(p.x + 9, p.y - 31, 16, 14);
        g.fillEllipse(p.x - 9, p.y - 31, 16, 14);

        // Leaf highlight (sunlight)
        g.fillStyle(0xffffff, 0.1);
        g.fillEllipse(p.x - 4, p.y - 28, 9, 6);
    }

    /** Light grey coffee machine */
    private drawCoffeeMachine(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 2);

        // Body (light grey, not dark)
        g.fillStyle(P.MACHINE, 1);
        g.lineStyle(0.5, P.MACHINE_DARK, 0.6);
        g.fillRect(p.x - 12, p.y - 38, 24, 32);
        g.strokeRect(p.x - 12, p.y - 38, 24, 32);

        // Lighter front panel
        g.fillStyle(0xfafafa, 0.8);
        g.fillRect(p.x - 9, p.y - 35, 10, 26);

        // Display screen (small)
        g.fillStyle(0x1e293b, 1);
        g.fillRect(p.x - 7, p.y - 33, 8, 6);
        g.fillStyle(0x3b82f6, 0.6);
        g.fillRect(p.x - 5, p.y - 31, 4, 2);

        // LED indicator (blue, subtle)
        g.fillStyle(0x3b82f6, 0.85);
        g.fillCircle(p.x + 7, p.y - 32, 2.5);

        // Drip tray
        g.fillStyle(P.MACHINE_DARK, 1);
        g.fillRect(p.x - 10, p.y - 8, 20, 3);

        // Cup
        g.fillStyle(0xffffff, 1); g.lineStyle(0.5, 0xdddddd, 0.7);
        g.fillCircle(p.x, p.y - 13, 4);
        g.strokeCircle(p.x, p.y - 13, 4);
    }

    /** Risk monitoring board with red alert cards */
    private drawRiskBoard(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 1);

        g.fillStyle(0xfff1f2, 1);
        g.fillRect(p.x - 26, p.y - 52, 52, 42);
        g.lineStyle(1.5, P.ALERT, 0.75);
        g.strokeRect(p.x - 26, p.y - 52, 52, 42);

        // Red header
        g.fillStyle(P.ALERT, 0.9);
        g.fillRect(p.x - 26, p.y - 52, 52, 9);

        // Status cards
        for (const [ox, oy, col] of [[-20,-41,P.ALERT],[2,-41,P.WARN],[-20,-24,P.WARN],[2,-24,P.OK]] as const) {
            g.fillStyle(col, 0.2); g.lineStyle(0.5, col, 0.7);
            g.fillRect(p.x + ox, p.y + oy, 18, 13);
            g.strokeRect(p.x + ox, p.y + oy, 18, 13);
        }
    }

    /** Bookshelf — white with coloured book spines */
    private drawBookshelf(cx: number, cy: number) {
        const p = this.c2i(cx, cy);
        const g = this.add.graphics().setDepth(p.y - 2);

        // Frame (white)
        g.fillStyle(0xf5f5f5, 1);
        g.lineStyle(0.5, 0xd0d0d0, 0.7);
        g.fillRect(p.x - 24, p.y - 68, 48, 56);
        g.strokeRect(p.x - 24, p.y - 68, 48, 56);

        // Shelves
        g.lineStyle(1, 0xd0d0d0, 0.7);
        for (let i = 0; i < 3; i++) {
            g.beginPath();
            g.moveTo(p.x - 24, p.y - 50 + i * 14);
            g.lineTo(p.x + 24, p.y - 50 + i * 14);
            g.strokePath();
        }

        // Book spines (coloured)
        const bookColors = [0x1d4ed8, 0xdc2626, 0x166534, 0xd97706, 0x7c3aed, 0x0891b2, 0x374151, 0x92400e];
        let bx = p.x - 21;
        for (let shelf = 0; shelf < 3; shelf++) {
            let x = bx;
            for (let b = 0; b < 6; b++) {
                const col = bookColors[(shelf * 6 + b) % bookColors.length];
                g.fillStyle(col, 0.85);
                g.fillRect(x, p.y - 62 + shelf * 14, 5, 11);
                x += 6;
            }
        }
    }

    // ── Avatar (corporate suit) ──────────────────────────────────────────────

    /** States that indicate the agent is working at their desk (triggers sitting pose). */
    private static readonly DESK_STATES: ReadonlySet<MicroState> = new Set([
        'coding', 'executing', 'optimizing', 'testing',
        'designing', 'thinking', 'planning',
    ]);

    /** Animation family for a given state — mirrors Pixel Agents toolUtils approach. */
    private static _toolFamily(state: MicroState): 'typing' | 'reading' | 'active' | 'idle' {
        switch (state) {
            case 'coding':
            case 'executing':
            case 'optimizing':   return 'typing';
            case 'thinking':
            case 'planning':
            case 'designing':    return 'reading';
            case 'testing':
            case 'waiting_for_human': return 'active';
            default:             return 'idle';
        }
    }

    private drawAvatar(
        gfx: Phaser.GameObjects.Graphics,
        accent: number,
        state: MicroState,
        t: number,
        isPlayer = false,
        sitting  = false,    // true = draw seated-at-desk pose
    ) {
        gfx.clear();
        const s = t / 1000;
        let bob = 0, aRdx = 0, aLdx = 0, lLdy = 0, lRdy = 0;

        switch (state) {
            case 'idle':             bob = Math.sin(s * 0.9) * 1.2; break;
            case 'thinking': case 'planning': case 'designing':
                bob = Math.sin(s * 0.7) * 0.8;
                aRdx = sitting ? 0 : (-6 + Math.sin(s * 1.8) * 1.5);
                break;
            case 'coding': case 'executing': case 'optimizing': case 'testing':
                bob = Math.sin(s * 3.5) * 0.6;
                if (!sitting) { aRdx = Math.sin(s * 5.5) * 3.5; aLdx = Math.cos(s * 5.5) * 3.5; }
                break;
            case 'walking':
                bob = Math.abs(Math.sin(s * 3.5)) * -1.5;
                lLdy = Math.sin(s * 4.5) * 4.5; lRdy = -Math.sin(s * 4.5) * 4.5;
                break;
            case 'waiting_for_human': bob = Math.sin(s * 0.4) * 1.5; break;
            case 'completed':  bob = Math.sin(s * 6) * 1.8; break;
            case 'error':      bob = (Math.floor(s * 4) % 2 === 0) ? -0.8 : 0.8; break;
        }

        const b = bob;
        const family   = OfficeScene._toolFamily(state);
        const isTyping = sitting && family === 'typing';
        const isReading = sitting && family === 'reading';  // thinking/planning/designing
        const isActive = state !== 'idle';

        // ── SITTING POSE ──────────────────────────────────────────────────────
        if (sitting) {
            // ─ Chair backrest (behind character, drawn first) ─
            gfx.fillStyle(P.CHAIR_BACK, 1);
            gfx.fillRect(-9, -50 + b, 18, 22);
            gfx.lineStyle(0.5, 0x111111, 0.35);
            gfx.strokeRect(-9, -50 + b, 18, 22);
            // Headrest
            gfx.fillStyle(P.CHAIR_CUSHION, 1);
            gfx.fillRect(-6, -54 + b, 12, 6);
            gfx.fillStyle(0xffffff, 0.07);
            gfx.fillRect(-4, -53 + b, 4, 2);

            // ─ Armrests (flanking the body) ─
            gfx.fillStyle(P.CHAIR_BASE, 1);
            gfx.fillRect(-16, -34 + b, 6, 6);
            gfx.fillRect( 10, -34 + b, 6, 6);

            // ─ Chair seat (visible below body) ─
            gfx.fillStyle(P.CHAIR_SEAT, 0.9);
            gfx.beginPath();
            gfx.moveTo(  0, -26 + b - 8);
            gfx.lineTo( 13, -26 + b);
            gfx.lineTo(  0, -26 + b + 8);
            gfx.lineTo(-13, -26 + b);
            gfx.closePath(); gfx.fillPath();
            gfx.lineStyle(0.5, P.CHAIR_BASE, 0.5); gfx.strokePath();

            // ─ Ground shadow (small — feet tucked under) ─
            gfx.fillStyle(0x000000, 0.07); gfx.fillEllipse(0, 6, 10, 4);

            // ─ Thighs (horizontal, extending outward from hips) ─
            gfx.fillStyle(P.SUIT, 1);
            gfx.fillRect(-10, -24 + b, 7, 4);  // left thigh
            gfx.fillRect(  3, -24 + b, 7, 4);  // right thigh

            // ─ Shins (vertical, dropping from knees) ─
            gfx.fillRect(-10, -20 + b, 4, 13); // left shin
            gfx.fillRect(  6, -20 + b, 4, 13); // right shin

            // ─ Shoes ─
            gfx.fillStyle(0x111827, 1);
            gfx.fillRect(-11, -7 + b, 5, 3);
            gfx.fillRect(  6, -7 + b, 5, 3);

            // ─ Body (same as standing) ─
            const suitCol = state === 'error' ? (Math.floor(s * 4) % 2 === 0 ? P.ALERT : P.SUIT) : P.SUIT;
            gfx.fillStyle(suitCol, 1); gfx.fillRect(-7, -40 + b, 14, 16);
            gfx.fillStyle(P.SHIRT, 1); gfx.fillRect(-2, -40 + b, 4, 14);

            // Lapels
            gfx.fillStyle(P.SUIT, 1);
            const lL: [number,number][] = [[-2,-40+b],[-7,-36+b],[-7,-26+b],[-2,-28+b]];
            gfx.beginPath(); lL.forEach(([x,y], i) => i===0 ? gfx.moveTo(x,y) : gfx.lineTo(x,y));
            gfx.closePath(); gfx.fillPath();
            const lR: [number,number][] = [[2,-40+b],[7,-36+b],[7,-26+b],[2,-28+b]];
            gfx.beginPath(); lR.forEach(([x,y], i) => i===0 ? gfx.moveTo(x,y) : gfx.lineTo(x,y));
            gfx.closePath(); gfx.fillPath();

            // Tie
            gfx.fillStyle(accent, 0.9);
            gfx.beginPath();
            gfx.moveTo(0,-40+b); gfx.lineTo(-2,-35+b); gfx.lineTo(0,-27+b); gfx.lineTo(2,-35+b);
            gfx.closePath(); gfx.fillPath();

            // Activity pin
            if (isActive) { gfx.fillStyle(this.stateAccent(state), 0.9); gfx.fillCircle(-4, -36 + b, 2); }

            // ─ Arms — 3 distinct poses by tool family ─
            if (isTyping) {
                // TYPING: fast alternating keyboard-tap hands
                const tap = Math.sin(s * 7) * 2;
                gfx.fillStyle(P.SUIT, 0.95);
                gfx.fillRect(-14, -36 + b, 12, 4);
                gfx.fillRect(  2, -36 + b, 12, 4);
                gfx.fillStyle(P.SHIRT, 0.8);
                gfx.fillRect(-14, -36 + b, 3, 3);
                gfx.fillRect( 11, -36 + b, 3, 3);
                gfx.fillStyle(P.SKIN, 1);
                gfx.fillEllipse(-8, -32 + tap + b, 5, 4);
                gfx.fillEllipse( 8, -32 - tap + b, 5, 4);
            } else if (isReading) {
                // READING: left elbow on desk, right hand resting on document
                const nod = Math.sin(s * 1.2) * 1.5;  // slow thinking nod
                // Small document on desk in front of agent
                gfx.fillStyle(0xffffff, 0.85);
                gfx.fillRect(-6, -28 + b, 12, 8);
                gfx.lineStyle(0.5, 0xd0d0d0, 0.7);
                gfx.strokeRect(-6, -28 + b, 12, 8);
                gfx.lineStyle(0.4, 0xaab4c0, 0.5);
                for (let li = 0; li < 3; li++) {
                    gfx.beginPath(); gfx.moveTo(-4, -26 + b + li * 2); gfx.lineTo(4, -26 + b + li * 2); gfx.strokePath();
                }
                // Left arm: forward-bent elbow on desk
                gfx.fillStyle(P.SUIT, 0.95);
                gfx.fillRect(-13, -38 + b, 5, 12);  // upper arm down
                gfx.fillRect(-13, -26 + b, 10, 4);  // forearm horizontal (elbow on desk)
                gfx.fillStyle(P.SHIRT, 0.8);
                gfx.fillRect(-13, -26 + b, 3, 3);
                gfx.fillStyle(P.SKIN, 1);
                gfx.fillEllipse(-4, -24 + nod + b, 5, 5);  // hand near chin (nodding)
                // Right arm: resting on document
                gfx.fillStyle(P.SUIT, 0.95);
                gfx.fillRect( 8, -38 + b, 5, 12);
                gfx.fillRect( 2, -28 + b, 10, 4);
                gfx.fillStyle(P.SHIRT, 0.8);
                gfx.fillRect( 9, -28 + b, 3, 3);
                gfx.fillStyle(P.SKIN, 1);
                gfx.fillEllipse( 7, -26 + b, 5, 4);  // hand on document
            } else {
                // DEFAULT: arms resting on armrests
                gfx.fillStyle(P.SUIT, 0.95);
                gfx.fillRect(-12, -38 + b, 5, 8);
                gfx.fillRect(  7, -38 + b, 5, 8);
                gfx.fillStyle(P.SHIRT, 0.8);
                gfx.fillRect(-12, -31 + b, 5, 3);
                gfx.fillRect(  7, -31 + b, 5, 3);
                gfx.fillStyle(P.SKIN, 1);
                gfx.fillEllipse(-9, -27 + b, 5, 5);
                gfx.fillEllipse(10, -27 + b, 5, 5);
            }

        } else {
            // ── STANDING POSE (original) ─────────────────────────────────────

            // Ground shadow
            gfx.fillStyle(0x000000, 0.10); gfx.fillEllipse(0, 5, 16, 5);

            // Trousers
            gfx.fillStyle(P.SUIT, 1);
            gfx.fillRect(-5, -18 + lLdy + b, 4, 13);
            gfx.fillRect( 1, -18 + lRdy + b, 4, 13);

            // Shoes
            gfx.fillStyle(0x111827, 1);
            gfx.fillRect(-6, -6 + lLdy + b, 5, 3);
            gfx.fillRect( 1, -6 + lRdy + b, 5, 3);

            // Jacket body
            const suitCol = state === 'error' ? (Math.floor(s * 4) % 2 === 0 ? P.ALERT : P.SUIT) : P.SUIT;
            gfx.fillStyle(suitCol, 1); gfx.fillRect(-7, -40 + b, 14, 22);

            // White shirt centre
            gfx.fillStyle(P.SHIRT, 1); gfx.fillRect(-2, -40 + b, 4, 18);

            // Lapels
            gfx.fillStyle(P.SUIT, 1);
            const lapelL: [number,number][] = [[-2,-40+b],[-7,-36+b],[-7,-20+b],[-2,-22+b]];
            gfx.beginPath(); lapelL.forEach(([x,y], i) => i===0 ? gfx.moveTo(x,y) : gfx.lineTo(x,y));
            gfx.closePath(); gfx.fillPath();
            const lapelR: [number,number][] = [[2,-40+b],[7,-36+b],[7,-20+b],[2,-22+b]];
            gfx.beginPath(); lapelR.forEach(([x,y], i) => i===0 ? gfx.moveTo(x,y) : gfx.lineTo(x,y));
            gfx.closePath(); gfx.fillPath();

            // Tie
            gfx.fillStyle(accent, 0.9);
            gfx.beginPath();
            gfx.moveTo(0, -40+b); gfx.lineTo(-2, -34+b); gfx.lineTo(0, -22+b); gfx.lineTo(2, -34+b);
            gfx.closePath(); gfx.fillPath();

            // Activity lapel pin
            if (isActive) { gfx.fillStyle(this.stateAccent(state), 0.9); gfx.fillCircle(-4, -36 + b, 2); }

            // Arms
            gfx.fillStyle(P.SUIT, 0.95);
            gfx.fillRect(-12, -38 + aLdx + b, 5, 13);
            gfx.fillRect( 7,  -38 + aRdx + b, 5, 13);

            // Shirt cuffs
            gfx.fillStyle(P.SHIRT, 0.8);
            gfx.fillRect(-12, -27 + aLdx + b, 5, 3);
            gfx.fillRect( 7,  -27 + aRdx + b, 5, 3);

            // Hands
            gfx.fillStyle(P.SKIN, 1);
            gfx.fillEllipse(-9, -23 + aLdx + b, 5, 5);
            gfx.fillEllipse(10, -23 + aRdx + b, 5, 5);
        }

        // ── Head (same for both poses) ────────────────────────────────────────

        // Neck
        gfx.fillStyle(P.SKIN, 1); gfx.fillRect(-3, -44 + b, 6, 5);

        // Head
        gfx.fillStyle(P.SKIN, 1); gfx.fillEllipse(0, -52 + b, 15, 17);

        // Ears
        gfx.fillStyle(P.SKIN_SH, 1);
        gfx.fillEllipse(-8, -52 + b, 4, 5);
        gfx.fillEllipse( 8, -52 + b, 4, 5);

        // Hair
        const hairCol = isPlayer ? accent : P.HAIR;
        gfx.fillStyle(hairCol, 1);
        gfx.beginPath();
        gfx.arc(0, -54 + b, 8, Math.PI, 0, false);
        gfx.lineTo(8, -54 + b); gfx.closePath(); gfx.fillPath();

        // Eyes
        gfx.fillStyle(0x1e293b, 1);
        gfx.fillEllipse(-3.5, -52 + b, 2.5, 2.5);
        gfx.fillEllipse( 3.5, -52 + b, 2.5, 2.5);
        gfx.fillStyle(0xffffff, 0.7);
        gfx.fillCircle(-3, -53 + b, 0.8);
        gfx.fillCircle( 4, -53 + b, 0.8);

        // Player badge
        if (isPlayer) {
            gfx.fillStyle(accent, 0.9); gfx.fillEllipse(0, -70 + b, 8, 8);
            gfx.fillStyle(0xffffff, 0.9); gfx.fillEllipse(0, -70 + b, 4, 4);
        }

        // Completion sparkles
        if (state === 'completed') {
            for (let i = 0; i < 4; i++) {
                const a = s * 1.8 + i * (Math.PI / 2);
                gfx.fillStyle(0xd97706, 0.7);
                gfx.fillCircle(Math.cos(a) * 12, Math.sin(a) * 7 - 64 + b, 1.5);
            }
        }
    }

    private stateAccent(state: MicroState): number {
        switch (state) {
            case 'idle': return 0x94a3b8;
            case 'thinking': case 'planning': case 'designing': return 0x2563eb;
            case 'coding': case 'executing': case 'optimizing': case 'testing': return 0x0891b2;
            case 'completed': return P.OK;
            case 'waiting_for_human': return P.WARN;
            case 'error': return P.ALERT;
            default: return 0x94a3b8;
        }
    }

    // ── Matrix spawn/despawn effect (Pixel Agents inspired) ─────────────────

    /** Digital-rain effect when an agent first appears. 16 staggered columns of
     *  falling neon dots, lasting 300 ms total. Container starts hidden and fades in. */
    private _playSpawnEffect(container: Phaser.GameObjects.Container, sx: number, sy: number) {
        container.setAlpha(0);
        const COLS = 16;
        const DURATION = 300;
        const fx = this.add.graphics().setDepth(sy + 50);
        const col = 0x5fe1ff;

        for (let c = 0; c < COLS; c++) {
            const delay = (c / COLS) * DURATION * 0.6;
            this.time.delayedCall(delay, () => {
                if (!fx.active) return;
                const cx = sx - 40 + c * 5;
                for (let row = 0; row < 8; row++) {
                    const alpha = 0.8 - row * 0.09;
                    fx.fillStyle(col, Math.max(0, alpha));
                    fx.fillRect(cx, sy - 80 + row * 10, 3, 8);
                }
            });
        }
        // Fade in container + destroy effect after full duration
        this.tweens.add({ targets: container, alpha: 1, duration: DURATION * 0.5, delay: DURATION * 0.4 });
        this.time.delayedCall(DURATION + 50, () => { if (fx.active) fx.destroy(); });
    }

    /** Quick shrink-out + digital rain despawn. */
    private _playDespawnEffect(container: Phaser.GameObjects.Container, onDone: () => void) {
        const DURATION = 250;
        this.tweens.add({
            targets: container, alpha: 0, scaleY: 0.1,
            duration: DURATION, ease: 'Power2',
            onComplete: onDone,
        });
    }

    // ── Zone activity lighting ───────────────────────────────────────────────

    /** Update pulsing overlay on each zone based on whether any agent is active there. */
    private updateZoneLighting() {
        const t = this.time.now / 1000;
        for (const [name, zone] of Object.entries(ZONES)) {
            // Count non-idle agents in this zone
            let active = 0;
            for (const [id] of this.agentSprites) {
                const agentZone = this._agentZone(id);
                if (agentZone !== zone) continue;
                const state = this.agentStates[id]?.current_micro_state ?? 'idle';
                if (state !== 'idle' && state !== 'walking') active++;
            }

            if (active === 0) {
                // No active agents: remove overlay if present
                const existing = this._zoneActivityLayers.get(name);
                if (existing?.active) existing.setAlpha(0);
                continue;
            }

            // Pulse: 0.5 Hz sine, amplitude 0.08–0.18
            const pulse = 0.08 + 0.1 * Math.abs(Math.sin(t * Math.PI));
            let layer = this._zoneActivityLayers.get(name);
            if (!layer || !layer.active) {
                layer = this.add.graphics().setDepth(-140);
                this._zoneActivityLayers.set(name, layer);
                for (let x = zone.x1; x <= zone.x2; x++) {
                    for (let y = zone.y1; y <= zone.y2; y++) {
                        const p = this.c2i(x, y);
                        layer.fillStyle(zone.accent, 1);
                        layer.lineStyle(0, zone.accent, 0);
                        this.diamond(layer, p.x, p.y);
                    }
                }
            }
            layer.setAlpha(pulse);
        }
    }

    // ── A* Pathfinding ───────────────────────────────────────────────────────

    /** Simple A* on the cartesian walkable grid. Returns array of steps to walk.
     *  Uses Manhattan distance heuristic; suitable for the small 30×22 grid. */
    private _astar(fx: number, fy: number, tx: number, ty: number): { x: number; y: number }[] {
        const startX = Math.round(fx), startY = Math.round(fy);
        const goalX  = Math.round(tx),  goalY  = Math.round(ty);

        if (startX === goalX && startY === goalY) return [];
        if (!this.ok(goalX, goalY)) return [];

        type Node = { x: number; y: number; g: number; f: number; parent: Node | null };
        const open: Node[]   = [];
        const closed          = new Set<string>();
        const key = (x: number, y: number) => `${x},${y}`;

        const start: Node = { x: startX, y: startY, g: 0, f: Math.abs(goalX - startX) + Math.abs(goalY - startY), parent: null };
        open.push(start);

        const DIRS = [[1,0],[-1,0],[0,1],[0,-1]] as const;
        let iterations = 0;
        const MAX_ITER = 400;

        while (open.length > 0 && iterations++ < MAX_ITER) {
            open.sort((a, b) => a.f - b.f);
            const cur = open.shift()!;
            if (cur.x === goalX && cur.y === goalY) {
                // Reconstruct path
                const path: { x: number; y: number }[] = [];
                let node: Node | null = cur;
                while (node) { path.unshift({ x: node.x, y: node.y }); node = node.parent; }
                return path.slice(1); // exclude start position
            }
            closed.add(key(cur.x, cur.y));
            for (const [dx, dy] of DIRS) {
                const nx = cur.x + dx, ny = cur.y + dy;
                if (!this.ok(nx, ny) || closed.has(key(nx, ny))) continue;
                const g = cur.g + 1;
                const existing = open.find(n => n.x === nx && n.y === ny);
                if (existing) {
                    if (g < existing.g) { existing.g = g; existing.f = g + Math.abs(goalX - nx) + Math.abs(goalY - ny); existing.parent = cur; }
                } else {
                    open.push({ x: nx, y: ny, g, f: g + Math.abs(goalX - nx) + Math.abs(goalY - ny), parent: cur });
                }
            }
        }
        return []; // no path found
    }

    // ── Player spawn ─────────────────────────────────────────────────────────

    private spawnPlayer() {
        const p = this.c2i(this.playerCart.x, this.playerCart.y);
        this.playerCont = this.add.container(p.x, p.y).setDepth(p.y + 1);
        this.playerGfx  = this.add.graphics();
        this.playerCont.add(this.playerGfx);

        const bg = this.add.graphics();
        bg.fillStyle(0x1d4ed8, 0.92); bg.fillRoundedRect(-20, -84, 40, 14, 3);
        this.playerCont.add(bg);
        this.playerCont.add(this.add.text(0, -77, 'YOU', {
            fontFamily: 'Inter, system-ui, sans-serif', fontSize: '8px',
            fontStyle: 'bold', color: '#ffffff',
        }).setOrigin(0.5));

        this.drawAvatar(this.playerGfx, ROLE_ACCENT.player, 'idle', 0, true);
    }

    // ── Input ────────────────────────────────────────────────────────────────

    private setupInput() {
        this.cursors = this.input.keyboard!.createCursorKeys();
        this.wasd = {
            up:    this.input.keyboard!.addKey('W'),
            down:  this.input.keyboard!.addKey('S'),
            left:  this.input.keyboard!.addKey('A'),
            right: this.input.keyboard!.addKey('D'),
        };
        this.eKey = this.input.keyboard!.addKey('E');

        // ── Scroll-wheel zoom — snaps to integer-friendly levels for crisp pixels ──
        // Pixel Agents approach: integer DPR baking prevents subpixel blurring.
        const ZOOM_STEPS = [0.35, 0.5, 0.66, 0.85, 1.0, 1.25, 1.5, 2.0, 2.5];
        this.input.on('wheel', (_p: unknown, _g: unknown, _dx: number, dy: number) => {
            const cur  = this.cameras.main.zoom;
            const dir  = dy > 0 ? -1 : 1;  // scroll down = zoom out
            const idx  = ZOOM_STEPS.findIndex(z => z >= cur - 0.01);
            const next = dir > 0
                ? ZOOM_STEPS[Math.min(idx + 1, ZOOM_STEPS.length - 1)]
                : ZOOM_STEPS[Math.max(idx - 1, 0)];
            this.cameras.main.setZoom(next);
        });

        // ── Drag-to-pan (left button or middle button) ────────────────────────
        // Left-click drag pans the camera; releasing freezes it until WASD is used.
        this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
            if (ptr.leftButtonDown() || ptr.middleButtonDown()) {
                this.isPanning    = true;
                this.panAnchorX   = ptr.x;
                this.panAnchorY   = ptr.y;
                this.panScrollX   = this.cameras.main.scrollX;
                this.panScrollY   = this.cameras.main.scrollY;
                this.game.canvas.style.cursor = 'grabbing';
            }
        });

        this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
            if (!this.isPanning) return;
            const zoom = this.cameras.main.zoom;
            this.cameras.main.scrollX = this.panScrollX - (ptr.x - this.panAnchorX) / zoom;
            this.cameras.main.scrollY = this.panScrollY - (ptr.y - this.panAnchorY) / zoom;
        });

        this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => {
            if (this.isPanning && (ptr.leftButtonReleased() || ptr.middleButtonReleased())) {
                this.isPanning    = false;
                this.cameraFrozen = true;   // hold position until player moves
                this.game.canvas.style.cursor = 'grab';
            }
        });

        // Also cancel panning if pointer leaves the canvas
        this.input.on('pointerupoutside', () => {
            this.isPanning    = false;
            this.cameraFrozen = true;
            this.game.canvas.style.cursor = 'grab';
        });

        // Default cursor = grab hand (signals "draggable")
        this.game.canvas.style.cursor = 'grab';
    }

    // Store bound handler refs so they can be removed precisely on cleanup
    private _onUpdateAgents = (agents: Record<string, AgentRuntimeState>) => {
        if (!this.scene?.isActive('OfficeScene')) return;   // guard: scene already destroyed
        this.agentStates = agents;
        this.syncAgents(agents);
    };
    private _onExpEffects = (fx: ExpFx[]) => {
        if (!this.scene?.isActive('OfficeScene')) return;
        this.spawnExpFx(fx);
    };

    // ── Agent thought bubbles (cloud-style, auto-dismiss 3 s) ───────────────
    private _onAgentThought = (payload: { agentId: string; thought: string }) => {
        if (!this.scene?.isActive('OfficeScene')) return;
        const d = this.agentSprites.get(payload.agentId);
        if (!d?.container?.active || !this.add) return;

        const thought = payload.thought.length > 60 ? payload.thought.slice(0, 57) + '…' : payload.thought;
        const cloud = this.add.graphics();
        // Cloud shape: rounded rect with small bumps on bottom
        cloud.fillStyle(0xffffff, 0.92);
        cloud.lineStyle(0.8, 0x94a3b8, 0.6);
        cloud.fillRoundedRect(-44, -152, 88, 20, 6);
        cloud.strokeRoundedRect(-44, -152, 88, 20, 6);
        // Tail bumps
        cloud.fillEllipse(-8, -133, 8, 8);
        cloud.fillEllipse(0,  -131, 6, 6);
        cloud.fillEllipse(8,  -130, 5, 5);
        const cloudTxt = this.add.text(0, -142, thought, {
            fontFamily: 'Inter, system-ui, sans-serif', fontSize: '6px',
            color: '#374151', fontStyle: 'italic',
            wordWrap: { width: 80 },
        }).setOrigin(0.5);
        const thoughtBub = this.add.container(0, 0, [cloud, cloudTxt]).setAlpha(0);
        d.container.add(thoughtBub);
        this.tweens.add({ targets: thoughtBub, alpha: 1, duration: 200 });
        this.time.delayedCall(3000, () => {
            if (!thoughtBub.active) return;
            this.tweens.add({
                targets: thoughtBub, alpha: 0, y: thoughtBub.y - 8, duration: 300,
                onComplete: () => thoughtBub.destroy(),
            });
        });
    };

    // ── Task progress events ─────────────────────────────────────────────────
    private _onTaskStep = (payload: { agentId: string; step: number; total: number }) => {
        if (!this.scene?.isActive('OfficeScene')) return;
        const d = this.agentSprites.get(payload.agentId);
        if (!d?.progressBar || !d.container?.active) return;
        const BAR_W = 32;
        const pct   = Math.min(1, payload.step / Math.max(1, payload.total));
        d.progressBar.clear();
        // Background track
        d.progressBar.fillStyle(0xd1d5db, 0.6);
        d.progressBar.fillRoundedRect(-16, -98, BAR_W, 3, 1.5);
        // Fill
        const fillCol = pct >= 1 ? P.OK : 0x5fe1ff;
        d.progressBar.fillStyle(fillCol, 1);
        d.progressBar.fillRoundedRect(-16, -98, Math.round(BAR_W * pct), 3, 1.5);
    };

    private _onTaskDone = (agentId: string) => {
        if (!this.scene?.isActive('OfficeScene')) return;
        const d = this.agentSprites.get(agentId);
        if (!d?.progressBar) return;
        // Full green briefly, then fade out
        this._onTaskStep({ agentId, step: 1, total: 1 });
        this.time.delayedCall(2000, () => d.progressBar?.clear());
    };

    private setupEvents() {
        EventBus.on('update-agents',   this._onUpdateAgents);
        EventBus.on('exp-effects',     this._onExpEffects);
        EventBus.on('task-step',       this._onTaskStep);
        EventBus.on('task-done',       this._onTaskDone);
        EventBus.on('agent-thought',   this._onAgentThought);
    }

    /** Remove all EventBus listeners owned by this scene instance. */
    private _cleanupEventBus() {
        EventBus.removeListener('update-agents',  this._onUpdateAgents);
        EventBus.removeListener('exp-effects',    this._onExpEffects);
        EventBus.removeListener('task-step',      this._onTaskStep);
        EventBus.removeListener('task-done',      this._onTaskDone);
        EventBus.removeListener('agent-thought',  this._onAgentThought);
        // Cancel all pending waiting timers
        this._waitingTimers.forEach(t => t.destroy());
        this._waitingTimers.clear();
        // Reset drag cursor if canvas still exists
        try { if (this.game?.canvas) this.game.canvas.style.cursor = 'default'; } catch { /* ignore */ }
    }

    // ── Update ───────────────────────────────────────────────────────────────

    private movePlayer(_dt: number) {
        const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
        const down  = this.cursors.down.isDown  || this.wasd.down.isDown;
        const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
        const right = this.cursors.right.isDown || this.wasd.right.isDown;
        if (!up && !down && !left && !right) return;

        // Player moved → unfreeze camera so it follows again
        this.cameraFrozen = false;

        let dx = 0, dy = 0;
        if (up)    { dx -= MOVE_SPD; dy -= MOVE_SPD; }
        if (down)  { dx += MOVE_SPD; dy += MOVE_SPD; }
        if (left)  { dx -= MOVE_SPD; dy += MOVE_SPD; }
        if (right) { dx += MOVE_SPD; dy -= MOVE_SPD; }
        if (dx && dy) { dx *= 0.707; dy *= 0.707; }

        const nx = this.playerCart.x + dx, ny = this.playerCart.y + dy;
        if      (this.ok(nx, ny))                       { this.playerCart.x = nx; this.playerCart.y = ny; }
        else if (this.ok(nx, this.playerCart.y))        { this.playerCart.x = nx; }
        else if (this.ok(this.playerCart.x, ny))        { this.playerCart.y = ny; }

        const p = this.c2i(this.playerCart.x, this.playerCart.y);
        this.playerCont.setPosition(p.x, p.y);
    }

    private trackCamera() {
        // While dragging or camera is frozen at a panned position, don't follow player.
        // Camera unfreezes as soon as the player presses a movement key.
        if (this.isPanning || this.cameraFrozen) return;

        const p = this.c2i(this.playerCart.x, this.playerCart.y);
        const cam = this.cameras.main;
        cam.scrollX += (p.x - cam.width  / cam.zoom / 2 - cam.scrollX) * 0.08;
        cam.scrollY += (p.y - cam.height / cam.zoom / 2 - cam.scrollY) * 0.08;
    }

    private checkProximity() {
        let best: string | null = null, bestD = 2.5;
        for (const [id, d] of this.agentSprites) {
            const dd = dist(this.playerCart.x, this.playerCart.y, d.cartPos.x, d.cartPos.y);
            if (dd < bestD) { bestD = dd; best = id; }
        }
        this.nearbyId = best;
        for (const [id, d] of this.agentSprites) d.interactHint?.setVisible(id === best);
        if (best !== this.lastNearby) { this.lastNearby = best; EventBus.emit('agent-proximity', best); }
        const eD = this.eKey.isDown;
        if (eD && !this.eWasDown && this.nearbyId) EventBus.emit('agent-interact', this.nearbyId);
        this.eWasDown = eD;
    }

    /** Map each agent id to its home wander zone */
    private _agentZone(id: string) {
        switch (id) {
            case 'planner':         return ZONES.meeting;
            case 'architect':
            case 'developer':
            case 'code_reviewer':
            case 'debugger':        return ZONES.dev;
            case 'ui_weaver':       return ZONES.design;
            case 'validator':       return ZONES.pantry;
            case 'optimizer':       return ZONES.risk;
            case 'data_analyst':
            case 'project_mgr':     return ZONES.analytics;
            case 'security':
            case 'rag_agent':
            case 'api_integration': return ZONES.security;
            case 'qa_tester':       return ZONES.qalab;
            case 'db_architect':
            case 'devops':          return ZONES.devops_bay;
            default:                return ZONES.meeting;
        }
    }

    private updateNPCs(dt: number) {
        for (const [id, d] of this.agentSprites) {
            const agent = this.agentStates[id]; if (!agent) continue;
            d.wanderTimer -= dt;
            const desk = AGENT_DESKS[id] ?? { cartX: 5, cartY: 5 };
            const zone = this._agentZone(id);

            if (agent.current_micro_state === 'walking' || agent.current_micro_state === 'idle') {
                if (d.wanderTimer <= 0) {
                    d.wanderTimer = randBetween(6000, 12000);
                    let tx: number, ty: number, att = 0;
                    do { tx = randBetween(zone.x1, zone.x2); ty = randBetween(zone.y1, zone.y2); att++; }
                    while (!this.walkable[ty]?.[tx] && att < 20);
                    if (this.walkable[ty]?.[tx]) this.tweenTo(id, d, tx, ty);
                }
            } else if (agent.current_micro_state === 'planning') {
                if (d.wanderTimer <= 0) {
                    d.wanderTimer = randBetween(8000, 14000);
                    const mx = randBetween(6, 13), my = randBetween(9, 12);
                    if (this.walkable[my]?.[mx]) this.tweenTo(id, d, mx, my);
                }
            } else {
                if (Math.abs(d.cartPos.x - desk.cartX) > 1 || Math.abs(d.cartPos.y - desk.cartY) > 1) {
                    if (d.wanderTimer <= 0) { d.wanderTimer = randBetween(1000, 3000); this.tweenTo(id, d, desk.cartX, desk.cartY); }
                }
            }
        }
    }

    private tweenTo(_id: string, d: AgentSpriteData, cx: number, cy: number) {
        // Use A* to find a collision-free path, then follow it step by step.
        const path = this._astar(d.cartPos.x, d.cartPos.y, cx, cy);
        if (path.length === 0) return;

        d.path    = path;
        d.pathIdx = 0;
        d.targetCart = { x: cx, y: cy };
        this._walkNextStep(d);
    }

    /** Walk one step along d.path then schedule the next. */
    private _walkNextStep(d: AgentSpriteData) {
        if (d.pathIdx >= d.path.length) return;
        const step = d.path[d.pathIdx++];
        const pt   = this.c2i(step.x, step.y);
        const sc   = { x: d.cartPos.x, y: d.cartPos.y };
        const dur  = randBetween(280, 420); // per-tile duration (smooth gait)
        let el = 0;
        this.tweens.add({
            targets: d.container, x: pt.x, y: pt.y, duration: dur, ease: 'Linear',
            onUpdate: (_: unknown, __: unknown, ___: string, ____: number, _____: number, delta: number) => {
                el = Math.min(el + delta, dur); const pr = el / dur;
                d.cartPos = { x: sc.x + (step.x - sc.x) * pr, y: sc.y + (step.y - sc.y) * pr };
            },
            onComplete: () => {
                d.cartPos = { x: step.x, y: step.y };
                this._walkNextStep(d);
            },
        });
    }

    private animateAvatars() {
        const t = this.time.now;
        // Player never sits (keyboard-controlled, always standing)
        this.drawAvatar(this.playerGfx, ROLE_ACCENT.player, 'idle', t, true, false);

        for (const [id, d] of this.agentSprites) {
            const agent = this.agentStates[id];
            const acc   = ROLE_ACCENT[id] ?? ROLE_ACCENT[agent?.role ?? ''] ?? 0x64748b;
            const state = agent?.current_micro_state ?? 'idle';

            // Sitting = agent is in a desk-work state AND within 1.5 tiles of their home desk
            const desk    = AGENT_DESKS[id];
            const atDesk  = desk
                ? Math.abs(d.cartPos.x - desk.cartX) < 1.5 && Math.abs(d.cartPos.y - desk.cartY) < 1.5
                : false;
            const sitting = atDesk && OfficeScene.DESK_STATES.has(state);

            this.drawAvatar(d.body, acc, state, t, false, sitting);
        }
    }

    private depthSort() {
        if (!this.playerCont?.active) return;
        const p = this.c2i(this.playerCart.x, this.playerCart.y);
        this.playerCont.setDepth(p.y + 1);
        for (const d of this.agentSprites.values()) {
            if (d.container?.active) d.container.setDepth(d.container.y);
        }
    }

    // ── Agent sync ───────────────────────────────────────────────────────────

    private syncAgents(agents: Record<string, AgentRuntimeState>) {
        // Guard: bail if this.add is not available (scene not fully initialised or destroyed)
        if (!this.add) return;

        const ids = new Set(Object.keys(agents));
        for (const [id, d] of this.agentSprites) {
            if (!ids.has(id)) {
                // Matrix despawn before destroying
                this._playDespawnEffect(d.container, () => {
                    d.container.destroy();
                    this.agentSprites.delete(id);
                });
            }
        }

        let idx = 0;
        for (const [id, agent] of Object.entries(agents)) {
            const desk = AGENT_DESKS[id] ?? { cartX: (idx % 3) * 3 + 2, cartY: Math.floor(idx / 3) * 3 + 2 };

            if (!this.agentSprites.has(id)) {
                const p   = this.c2i(desk.cartX, desk.cartY);
                const con = this.add.container(p.x, p.y).setDepth(p.y);
                const acc = ROLE_ACCENT[id] ?? 0x64748b;
                const accHex = '#' + acc.toString(16).padStart(6, '0');
                const body   = this.add.graphics();

                // White corporate nameplate
                const plateBg = this.add.graphics();
                plateBg.fillStyle(0xffffff, 0.96);
                plateBg.lineStyle(1, acc, 0.75);
                plateBg.fillRoundedRect(-37, -92, 74, 17, 3);
                plateBg.strokeRoundedRect(-37, -92, 74, 17, 3);
                plateBg.fillStyle(acc, 1); plateBg.fillCircle(-28, -84, 3);

                const shortName = agent.display_name.split(' / ')[0];
                const nameText  = this.add.text(0, -84, shortName, {
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: '8px', fontStyle: 'bold', color: '#1e293b',
                }).setOrigin(0.5);

                const roleTxt = (agent.display_name.includes('/') ? agent.display_name.split('/ ')[1] : agent.role).toUpperCase();
                const roleTagBg = this.add.graphics();
                roleTagBg.fillStyle(acc, 0.1); roleTagBg.fillRoundedRect(-28, -79, 56, 10, 2);
                const roleText = this.add.text(0, -74, roleTxt, {
                    fontFamily: 'Inter, system-ui, sans-serif', fontSize: '6px', color: accHex,
                }).setOrigin(0.5);

                // Interact hint
                const hintBg = this.add.graphics();
                hintBg.fillStyle(0x1d4ed8, 0.92); hintBg.fillRoundedRect(-30, -108, 60, 14, 3);
                const hintTxt = this.add.text(0, -101, '[ E ]  Profile', {
                    fontFamily: 'Inter, system-ui, sans-serif', fontSize: '7px', color: '#ffffff',
                }).setOrigin(0.5);
                const hint = this.add.container(0, 0, [hintBg, hintTxt]).setVisible(false);

                // ─ Progress bar (hidden by default) ─
                const progressBar = this.add.graphics();
                con.add([body, plateBg, roleTagBg, nameText, roleText, hint, progressBar]);

                this.agentSprites.set(id, {
                    container: con, body, label: nameText, interactHint: hint, progressBar,
                    cartPos: { x: desk.cartX, y: desk.cartY },
                    targetCart: { x: desk.cartX, y: desk.cartY },
                    wanderTimer: randBetween(2000, 6000),
                    currentState: agent.current_micro_state, lastMsg: '',
                    path: [], pathIdx: 0,
                });

                // ─ Matrix spawn effect (0.3s digital rain on first appearance) ─
                this._playSpawnEffect(con, p.x, p.y);
            }

            const sd = this.agentSprites.get(id)!;
            sd.currentState = agent.current_micro_state;

            // ── P1.5: Permission bubble delay ───────────────────────────────
            // For waiting_for_human: delay 5 s before showing bubble (avoids noise
            // on fast tool executions). For all other states: show immediately.
            const isWaiting = agent.current_micro_state === 'waiting_for_human';
            const msg = agent.status_message?.trim();
            const show = msg && msg !== sd.lastMsg &&
                !['Task completed', 'Task failed', 'Completed', ''].includes(msg);

            if (show && isWaiting) {
                sd.lastMsg = msg!;
                // Cancel any existing timer, then set 5 s delay
                const existingTimer = this._waitingTimers.get(id);
                if (existingTimer) existingTimer.destroy();
                const timer = this.time.delayedCall(5000, () => {
                    this._waitingTimers.delete(id);
                    if (!sd.container?.active || !this.add) return;
                    if (agent.current_micro_state !== 'waiting_for_human') return; // state changed
                    this._showBubble(sd, `⏸ ${msg!}`, agent.current_micro_state);
                });
                this._waitingTimers.set(id, timer);
                idx++; continue;
            }

            if (show && !isWaiting) {
                // Cancel pending waiting timer (state changed away)
                const t = this._waitingTimers.get(id);
                if (t) { t.destroy(); this._waitingTimers.delete(id); }

                sd.bubble?.destroy(); sd.bubble = undefined;
                sd.lastMsg = msg!;

                // Guard: container may have been destroyed if the scene is shutting down
                if (!sd.container?.active || !this.add) { idx++; continue; }

                this._showBubble(sd, msg!, agent.current_micro_state);
            }
            idx++;
        }
    }

    // ── Speech bubble helper ─────────────────────────────────────────────────

    /** Show a status bubble above the agent. Auto-dismisses after 5 s. */
    private _showBubble(sd: AgentSpriteData, msg: string, state: MicroState) {
        if (!sd.container?.active || !this.add) return;
        sd.bubble?.destroy(); sd.bubble = undefined;

        const truncated = msg.length > 72 ? msg.slice(0, 69) + '…' : msg;
        const sa     = this.stateAccent(state);
        const isErr  = state === 'error';

        const bbg = this.add.graphics();
        bbg.fillStyle(isErr ? 0xfff1f2 : 0xffffff, 0.97);
        bbg.lineStyle(0.5, 0xe2e8f0, 0.8);
        bbg.fillRoundedRect(-57, -135, 114, 26, 3);
        bbg.strokeRoundedRect(-57, -135, 114, 26, 3);
        bbg.fillStyle(sa, 1);
        bbg.fillRoundedRect(-57, -135, 3, 26, { tl: 3, bl: 3, tr: 0, br: 0 });

        const btxt = this.add.text(-48, -122, truncated, {
            fontFamily: 'Inter, system-ui, sans-serif', fontSize: '7px', color: '#374151',
            wordWrap: { width: 104 },
        }).setOrigin(0, 0.5);

        const bub = this.add.container(0, 0, [bbg, btxt]).setAlpha(0);
        sd.container.add(bub); sd.bubble = bub;
        this.tweens.add({ targets: bub, alpha: 1, duration: 250 });
        this.time.delayedCall(4000, () => {
            if (sd.bubble === bub) {
                this.tweens.add({
                    targets: bub, alpha: 0, y: bub.y - 6, duration: 350,
                    onComplete: () => { bub.destroy(); if (sd.bubble === bub) sd.bubble = undefined; },
                });
            }
        });
    }

    // ── EXP effects ──────────────────────────────────────────────────────────

    private spawnExpFx(effects: ExpFx[]) {
        if (!this.add) return;
        for (const fx of effects) {
            const d = this.agentSprites.get(fx.agent_id); if (!d || !d.container?.active) continue;
            const t = this.add.text(d.container.x, d.container.y - 55, `+${fx.delta} pts`, {
                fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px',
                fontStyle: 'bold', color: '#d97706',
                stroke: '#ffffff', strokeThickness: 2,
            }).setOrigin(0.5).setDepth(d.container.y + 100);
            this.tweens.add({ targets: t, y: t.y - 45, alpha: 0, duration: 1400, ease: 'Power2', onComplete: () => t.destroy() });
        }
    }
}
