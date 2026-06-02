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
const GRID_W   = 20;
const GRID_H   = 16;
const TILE_W   = 64;
const TILE_H   = 32;
const MOVE_SPD = 0.07;

// ─── Color palette (matches warm-wood corporate reference) ────────────────────
const P = {
    // Studio background
    BG:             0xf8f9fb,

    // Floor tiles — zone-tinted
    FLOOR:          0xeeeeee,   // base grey tile
    FLOOR_LINE:     0xe0e0e0,   // very subtle grid line
    Z_DEV:          0xf5ede0,   // warm parquet (wood-hinted)
    Z_DESIGN:       0xedeef4,   // cool light carpet
    Z_MEET:         0xf0f2f0,   // neutral tile
    Z_LOUNGE:       0xfaf2e4,   // warm
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

    // ── ORANGE sofa (key reference element) ──────────────────────────────
    SOFA_SEAT:      0xe07b39,   // orange — as in reference
    SOFA_BACK:      0xc96b2a,   // darker orange
    SOFA_ARM:       0xd47430,   // armrest

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

// Role tie/accent colors
const ROLE_ACCENT: Record<string, number> = {
    planner:   0x1d4ed8,
    architect: 0x0891b2,
    developer: 0x166534,
    ui_weaver: 0x7c3aed,
    validator: 0xb91c1c,
    optimizer: 0x92400e,
    player:    0x2563eb,
};

const AGENT_DESKS: Record<string, { cartX: number; cartY: number }> = {
    planner:   { cartX: 3,  cartY: 2 },
    architect: { cartX: 6,  cartY: 2 },
    developer: { cartX: 3,  cartY: 5 },
    ui_weaver: { cartX: 12, cartY: 2 },
    validator: { cartX: 15, cartY: 2 },
    optimizer: { cartX: 12, cartY: 5 },
};

const ZONES = {
    dev:     { x1: 1,  y1: 1,  x2: 9,  y2: 7,  floor: P.Z_DEV,    accent: 0x1d4ed8 },
    design:  { x1: 10, y1: 1,  x2: 18, y2: 7,  floor: P.Z_DESIGN,  accent: 0x7c3aed },
    meeting: { x1: 5,  y1: 8,  x2: 14, y2: 13, floor: P.Z_MEET,    accent: 0x166534 },
    lounge:  { x1: 1,  y1: 8,  x2: 4,  y2: 13, floor: P.Z_LOUNGE,  accent: 0xe07b39 },
    pantry:  { x1: 15, y1: 8,  x2: 18, y2: 13, floor: P.Z_PANTRY,  accent: 0x92400e },
};

interface AgentSpriteData {
    container:    Phaser.GameObjects.Container;
    body:         Phaser.GameObjects.Graphics;
    label:        Phaser.GameObjects.Text;
    bubble?:      Phaser.GameObjects.Container;
    interactHint?: Phaser.GameObjects.Container;
    cartPos:      { x: number; y: number };
    targetCart:   { x: number; y: number };
    wanderTimer:  number;
    currentState: MicroState;
    lastMsg:      string;
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class OfficeScene extends Scene {

    private agentSprites: Map<string, AgentSpriteData> = new Map();
    private agentStates:  Record<string, AgentRuntimeState> = {};

    private playerCart   = { x: 9.5, y: 10.5 };
    private playerCont!:   Phaser.GameObjects.Container;
    private playerGfx!:    Phaser.GameObjects.Graphics;
    private cursors!:      Phaser.Types.Input.Keyboard.CursorKeys;
    private wasd!:         { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
    private eKey!:         Phaser.Input.Keyboard.Key;
    private eWasDown      = false;

    private walkable: boolean[][] = [];
    private nearbyId:  string | null = null;
    private lastNearby: string | null = null;

    constructor() { super('OfficeScene'); }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    create() {
        this.cameras.main.setBackgroundColor('#f8f9fb');
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
    }

    update(_t: number, dt: number) {
        this.movePlayer(dt);
        this.trackCamera();
        this.checkProximity();
        this.updateNPCs(dt);
        this.animateAvatars();
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
        for (const d of Object.values(AGENT_DESKS)) { this.sw(d.cartX, d.cartY, false); this.sw(d.cartX - 1, d.cartY, false); }
        for (let x = 9; x <= 10; x++) for (let y = 9; y <= 10; y++) this.sw(x, y, false);
        this.sw(2, 10, false); this.sw(2, 11, false);
        this.sw(17, 3, false); this.sw(17, 9, false);
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
        }

        // Zone label markers (small, understated)
        this.zoneLabel('Developer Zone',  ZONES.dev.x1    + 2, ZONES.dev.y1,    0x1d4ed8);
        this.zoneLabel('Design Zone',     ZONES.design.x1 + 2, ZONES.design.y1, 0x7c3aed);
        this.zoneLabel('Meeting Room',    ZONES.meeting.x1+ 2, ZONES.meeting.y1,0x166534);
        this.zoneLabel('Lounge',          ZONES.lounge.x1,     ZONES.lounge.y1, 0xe07b39);
        this.zoneLabel('Pantry',          ZONES.pantry.x1,     ZONES.pantry.y1, 0x92400e);
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
        const hex = '#' + color.toString(16).padStart(6, '0');
        this.add.text(p.x, p.y - 16, text, {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '8px',
            color: hex,
        }).setOrigin(0.5).setDepth(-90).setAlpha(0.75);
    }

    // ── Glass Partitions ─────────────────────────────────────────────────────

    private drawGlassPartitions() {
        // Vertical glass wall between Dev and Design zones (x=9-10 column, y=1..7)
        for (let y = 1; y <= 7; y++) {
            this.drawGlassPanel(9, y, 10, y);
        }
        // Partial glass around meeting room entrance
        for (let x = 5; x <= 14; x++) {
            this.drawGlassPanel(x, 8, x, 8);
        }
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

    // ── Furniture ────────────────────────────────────────────────────────────

    private drawFurniture() {
        // Desks per agent
        for (const [role, pos] of Object.entries(AGENT_DESKS)) {
            const accent = ROLE_ACCENT[role] ?? 0x94a3b8;
            this.drawDesk(pos.cartX, pos.cartY, accent);
        }

        // Meeting table + chairs
        this.drawMeetingTable(9.5, 9.5);
        for (const [dx, dy] of [[-1.5,0],[1.5,0],[0,-1.5],[0,1.5],[-1,-1],[1,1]] as const) {
            this.drawMeetingChair(9.5 + dx, 9.5 + dy);
        }

        // ORANGE sofa (lounge) — matches reference
        this.drawSofa(2, 10.5);
        this.drawCoffeeTable(3, 11);

        // Whiteboard
        this.drawWhiteboard(17, 2);

        // Plants with white ceramic pots
        for (const [px, py] of [[8.5,6.5],[1.5,1.5],[18.5,7.5],[4.5,13.5]] as const) {
            this.drawPlant(px, py);
        }

        // Coffee machine — light grey (matches reference)
        this.drawCoffeeMachine(16, 9);

        // Risk board
        this.drawRiskBoard(15, 5);

        // Bookshelf in design zone
        this.drawBookshelf(18, 3);
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

    private drawAvatar(
        gfx: Phaser.GameObjects.Graphics,
        accent: number,
        state: MicroState,
        t: number,
        isPlayer = false,
    ) {
        gfx.clear();
        const s = t / 1000;
        let bob = 0, aRdx = 0, aLdx = 0, lLdy = 0, lRdy = 0;

        switch (state) {
            case 'idle':             bob = Math.sin(s * 0.9) * 1.2; break;
            case 'thinking': case 'planning': case 'designing':
                bob = Math.sin(s * 0.7) * 0.8; aRdx = -6 + Math.sin(s * 1.8) * 1.5; break;
            case 'coding': case 'executing': case 'optimizing': case 'testing':
                bob = Math.sin(s * 3.5) * 0.6;
                aRdx = Math.sin(s * 5.5) * 3.5; aLdx = Math.cos(s * 5.5) * 3.5; break;
            case 'walking':
                bob = Math.abs(Math.sin(s * 3.5)) * -1.5;
                lLdy = Math.sin(s * 4.5) * 4.5; lRdy = -Math.sin(s * 4.5) * 4.5; break;
            case 'waiting_for_human': bob = Math.sin(s * 0.4) * 1.5; break;
            case 'completed':  bob = Math.sin(s * 6) * 1.8; break;
            case 'error':      bob = (Math.floor(s * 4) % 2 === 0) ? -0.8 : 0.8; break;
        }

        const b = bob;
        const isActive = state !== 'idle';

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

        // Tie (role color)
        gfx.fillStyle(accent, 0.9);
        gfx.beginPath();
        gfx.moveTo(0, -40+b); gfx.lineTo(-2, -34+b); gfx.lineTo(0, -22+b); gfx.lineTo(2, -34+b);
        gfx.closePath(); gfx.fillPath();

        // Activity lapel pin
        if (isActive) {
            gfx.fillStyle(this.stateAccent(state), 0.9);
            gfx.fillCircle(-4, -36 + b, 2);
        }

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
        this.input.on('wheel', (_p: unknown, _g: unknown, _dx: number, dy: number) => {
            this.cameras.main.setZoom(clamp(this.cameras.main.zoom - dy * 0.001, 0.3, 2.5));
        });
    }

    private setupEvents() {
        EventBus.on('update-agents', (agents: Record<string, AgentRuntimeState>) => {
            this.agentStates = agents; this.syncAgents(agents);
        });
        EventBus.on('exp-effects', (fx: ExpFx[]) => this.spawnExpFx(fx));
    }

    // ── Update ───────────────────────────────────────────────────────────────

    private movePlayer(_dt: number) {
        const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
        const down  = this.cursors.down.isDown  || this.wasd.down.isDown;
        const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
        const right = this.cursors.right.isDown || this.wasd.right.isDown;
        if (!up && !down && !left && !right) return;

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

    private updateNPCs(dt: number) {
        for (const [id, d] of this.agentSprites) {
            const agent = this.agentStates[id]; if (!agent) continue;
            d.wanderTimer -= dt;
            const desk = AGENT_DESKS[id] ?? { cartX: 5, cartY: 5 };
            const zone = id === 'planner' || id === 'developer' ? ZONES.dev
                : id === 'ui_weaver' || id === 'validator' || id === 'optimizer' ? ZONES.design
                : ZONES.meeting;

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
        const pt = this.c2i(cx, cy);
        const sc = { x: d.cartPos.x, y: d.cartPos.y };
        d.targetCart = { x: cx, y: cy };
        const dur = randBetween(1200, 2200); let el = 0;
        this.tweens.add({
            targets: d.container, x: pt.x, y: pt.y, duration: dur, ease: 'Sine.easeInOut',
            onUpdate: (_: unknown, __: unknown, ___: string, ____: number, _____: number, dt: number) => {
                el = Math.min(el + dt, dur); const pr = el / dur;
                d.cartPos = { x: sc.x + (cx - sc.x) * pr, y: sc.y + (cy - sc.y) * pr };
            },
            onComplete: () => { d.cartPos = { x: cx, y: cy }; },
        });
    }

    private animateAvatars() {
        const t = this.time.now;
        this.drawAvatar(this.playerGfx, ROLE_ACCENT.player, 'idle', t, true);
        for (const [id, d] of this.agentSprites) {
            const agent = this.agentStates[id];
            const acc   = ROLE_ACCENT[id] ?? ROLE_ACCENT[agent?.role ?? ''] ?? 0x64748b;
            this.drawAvatar(d.body, acc, agent?.current_micro_state ?? 'idle', t, false);
        }
    }

    private depthSort() {
        const p = this.c2i(this.playerCart.x, this.playerCart.y);
        this.playerCont.setDepth(p.y + 1);
        for (const d of this.agentSprites.values()) d.container.setDepth(d.container.y);
    }

    // ── Agent sync ───────────────────────────────────────────────────────────

    private syncAgents(agents: Record<string, AgentRuntimeState>) {
        const ids = new Set(Object.keys(agents));
        for (const [id, d] of this.agentSprites) {
            if (!ids.has(id)) { d.container.destroy(); this.agentSprites.delete(id); }
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

                con.add([body, plateBg, roleTagBg, nameText, roleText, hint]);

                this.agentSprites.set(id, {
                    container: con, body, label: nameText, interactHint: hint,
                    cartPos: { x: desk.cartX, y: desk.cartY },
                    targetCart: { x: desk.cartX, y: desk.cartY },
                    wanderTimer: randBetween(2000, 6000),
                    currentState: agent.current_micro_state, lastMsg: '',
                });
            }

            const sd = this.agentSprites.get(id)!;
            sd.currentState = agent.current_micro_state;

            // Speech bubble — clean white card with accent left border
            const msg = agent.status_message?.trim();
            const show = msg && msg !== sd.lastMsg &&
                !['Task completed', 'Task failed', 'Completed', ''].includes(msg);

            if (show) {
                sd.bubble?.destroy(); sd.bubble = undefined;
                sd.lastMsg = msg!;
                const truncated = msg!.length > 72 ? msg!.slice(0, 69) + '…' : msg!;
                const sa = this.stateAccent(agent.current_micro_state);
                const isErr = agent.current_micro_state === 'error';

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
                this.time.delayedCall(5000, () => {
                    if (sd.bubble === bub) {
                        this.tweens.add({
                            targets: bub, alpha: 0, y: bub.y - 6, duration: 350,
                            onComplete: () => { bub.destroy(); if (sd.bubble === bub) sd.bubble = undefined; },
                        });
                    }
                });
            }
            idx++;
        }
    }

    // ── EXP effects ──────────────────────────────────────────────────────────

    private spawnExpFx(effects: ExpFx[]) {
        for (const fx of effects) {
            const d = this.agentSprites.get(fx.agent_id); if (!d) continue;
            const t = this.add.text(d.container.x, d.container.y - 55, `+${fx.delta} pts`, {
                fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px',
                fontStyle: 'bold', color: '#d97706',
                stroke: '#ffffff', strokeThickness: 2,
            }).setOrigin(0.5).setDepth(d.container.y + 100);
            this.tweens.add({ targets: t, y: t.y - 45, alpha: 0, duration: 1400, ease: 'Power2', onComplete: () => t.destroy() });
        }
    }
}
