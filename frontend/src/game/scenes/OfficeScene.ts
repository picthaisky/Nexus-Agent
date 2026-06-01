import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import type { AgentRuntimeState, MicroState } from '../../types';
import { ExpFx } from '../../hooks/useAgentSocket';

// ─── Math utilities (avoids relying on global Phaser namespace) ───────────────
const randBetween = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1) + a);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const distBetween = (x1: number, y1: number, x2: number, y2: number) =>
    Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

// ─── Constants ────────────────────────────────────────────────────────────────

const GRID_W = 20;
const GRID_H = 16;
const TILE_W = 64;
const TILE_H = 32;
const MOVE_SPEED = 0.07;

// Fixed desk positions per agent role (cartesian)
const AGENT_DESKS: Record<string, { cartX: number; cartY: number }> = {
    planner:   { cartX: 3,  cartY: 2 },
    architect: { cartX: 6,  cartY: 2 },
    developer: { cartX: 3,  cartY: 5 },
    ui_weaver: { cartX: 12, cartY: 2 },
    validator: { cartX: 15, cartY: 2 },
    optimizer: { cartX: 12, cartY: 5 },
};

// Role-specific body colors
const ROLE_COLORS: Record<string, number> = {
    planner:   0xd4af37,
    architect: 0x1d83b8,
    developer: 0xc2783a,
    ui_weaver: 0xe879a0,
    validator: 0x36c987,
    optimizer: 0x9b59b6,
    player:    0x5fe1ff,
};

// Zone bounding boxes [minX, minY, maxX, maxY] in cart coords
const ZONES = {
    dev:     { x1: 1,  y1: 1,  x2: 9,  y2: 7,  floor: 0x112030, stroke: 0x1d83b8 },
    design:  { x1: 10, y1: 1,  x2: 18, y2: 7,  floor: 0x16122e, stroke: 0x9b59b6 },
    meeting: { x1: 5,  y1: 8,  x2: 14, y2: 13, floor: 0x0f2218, stroke: 0x36c987 },
    lounge:  { x1: 1,  y1: 8,  x2: 4,  y2: 13, floor: 0x221a0e, stroke: 0xd4af37 },
    pantry:  { x1: 15, y1: 8,  x2: 18, y2: 13, floor: 0x221610, stroke: 0xc2783a },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentSpriteData {
    container: Phaser.GameObjects.Container;
    body: Phaser.GameObjects.Graphics;
    label: Phaser.GameObjects.Text;
    bubble?: Phaser.GameObjects.Text;
    interactHint?: Phaser.GameObjects.Text;
    cartPos: { x: number; y: number };
    targetCart: { x: number; y: number };
    wanderTimer: number;
    currentState: MicroState;
    lastBubbleMsg: string;  // track last shown message to avoid re-showing same text
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class OfficeScene extends Scene {

    // Agent NPCs
    private agentSprites: Map<string, AgentSpriteData> = new Map();
    private agentStates: Record<string, AgentRuntimeState> = {};

    // Player
    private playerCart = { x: 9.5, y: 10.5 };
    private playerContainer!: Phaser.GameObjects.Container;
    private playerGfx!: Phaser.GameObjects.Graphics;
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private wasd!: {
        up: Phaser.Input.Keyboard.Key;
        down: Phaser.Input.Keyboard.Key;
        left: Phaser.Input.Keyboard.Key;
        right: Phaser.Input.Keyboard.Key;
    };
    private eKey!: Phaser.Input.Keyboard.Key;
    private eKeyWasDown = false;

    // Walkability map
    private walkable: boolean[][] = [];

    // Proximity tracking
    private nearbyAgentId: string | null = null;
    private lastProximityId: string | null = null;

    // Furniture graphics layer (for depth sorting)
    private furnitureObjects: Array<{ gfx: Phaser.GameObjects.Graphics; depthY: number }> = [];

    constructor() {
        super('OfficeScene');
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────────────

    create() {
        this.cameras.main.setBackgroundColor('#070b14');

        this.buildWalkableMap();
        this.drawOfficeLayout();
        this.spawnPlayer();
        this.setupInput();
        this.setupEventBus();

        // Set initial camera to show player spawn area
        const spawnIso = this.cartToIso(this.playerCart.x, this.playerCart.y);
        this.cameras.main.scrollX = spawnIso.x - this.cameras.main.width / 2;
        this.cameras.main.scrollY = spawnIso.y - this.cameras.main.height / 2;

        EventBus.emit('current-scene-ready', this);
    }

    update(_time: number, delta: number) {
        this.handlePlayerMovement(delta);
        this.updateCamera();
        this.checkProximity();
        this.updateNPCBehavior(delta);
        this.updateAvatarAnimations();
        this.updateDepthSorting();
    }

    // ─── Coordinate Math ────────────────────────────────────────────────────────

    cartToIso(cartX: number, cartY: number): { x: number; y: number } {
        return {
            x: (cartX - cartY) * (TILE_W / 2),
            y: (cartX + cartY) * (TILE_H / 2),
        };
    }

    // ─── Walkable Map ────────────────────────────────────────────────────────────

    private buildWalkableMap() {
        // Start all tiles as walkable
        this.walkable = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(true));

        // Outer boundary
        for (let x = 0; x < GRID_W; x++) {
            this.walkable[0][x] = false;
            this.walkable[GRID_H - 1][x] = false;
        }
        for (let y = 0; y < GRID_H; y++) {
            this.walkable[y][0] = false;
            this.walkable[y][GRID_W - 1] = false;
        }

        // Block desk tiles (1 tile behind desk)
        for (const desk of Object.values(AGENT_DESKS)) {
            this.setWalkable(desk.cartX, desk.cartY, false);
            this.setWalkable(desk.cartX - 1, desk.cartY, false);
        }

        // Meeting table (center 2x2)
        for (let x = 9; x <= 10; x++) {
            for (let y = 9; y <= 10; y++) {
                this.setWalkable(x, y, false);
            }
        }

        // Sofa
        this.setWalkable(2, 10, false);
        this.setWalkable(2, 11, false);

        // Whiteboard
        this.setWalkable(17, 3, false);

        // Plants (decorative, passable)
        // Coffee machine
        this.setWalkable(17, 9, false);
    }

    private setWalkable(x: number, y: number, val: boolean) {
        if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W) {
            this.walkable[y][x] = val;
        }
    }

    private isWalkable(cartX: number, cartY: number): boolean {
        const tx = Math.round(cartX);
        const ty = Math.round(cartY);
        if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return false;
        return this.walkable[ty][tx];
    }

    // ─── Office Layout ──────────────────────────────────────────────────────────

    private drawOfficeLayout() {
        // 1. Base dark floor (full grid) — slightly visible grid lines
        const base = this.add.graphics();
        base.setDepth(-200);
        for (let x = 0; x < GRID_W; x++) {
            for (let y = 0; y < GRID_H; y++) {
                const iso = this.cartToIso(x, y);
                base.fillStyle(0x0d1a2e, 1);
                base.lineStyle(1, 0x1a3050, 0.8);
                this.drawDiamond(base, iso.x, iso.y, TILE_W / 2, TILE_H / 2);
            }
        }

        // 2. Zone floors — distinct tints per zone
        for (const zone of Object.values(ZONES)) {
            const gfx = this.add.graphics();
            gfx.setDepth(-100);
            for (let x = zone.x1; x <= zone.x2; x++) {
                for (let y = zone.y1; y <= zone.y2; y++) {
                    const iso = this.cartToIso(x, y);
                    gfx.fillStyle(zone.floor, 1);
                    gfx.lineStyle(1, zone.stroke, 0.5);
                    this.drawDiamond(gfx, iso.x, iso.y, TILE_W / 2, TILE_H / 2);
                }
            }
        }

        // 3. Zone label signs
        this.addZoneLabel('DEV ZONE',     ZONES.dev.x1 + 2, ZONES.dev.y1, 0x5fe1ff);
        this.addZoneLabel('DESIGN ZONE',  ZONES.design.x1 + 2, ZONES.design.y1, 0xc47eff);
        this.addZoneLabel('MEETING ROOM', ZONES.meeting.x1 + 2, ZONES.meeting.y1, 0x5cff9d);
        this.addZoneLabel('LOUNGE',       ZONES.lounge.x1, ZONES.lounge.y1, 0xffd480);
        this.addZoneLabel('PANTRY',       ZONES.pantry.x1, ZONES.pantry.y1, 0xff9970);

        // 4. Furniture
        this.drawFurnitureObjects();
    }

    private drawDiamond(gfx: Phaser.GameObjects.Graphics, cx: number, cy: number, hw: number, hh: number) {
        gfx.beginPath();
        gfx.moveTo(cx, cy - hh);
        gfx.lineTo(cx + hw, cy);
        gfx.lineTo(cx, cy + hh);
        gfx.lineTo(cx - hw, cy);
        gfx.closePath();
        gfx.fillPath();
        gfx.strokePath();
    }

    private addZoneLabel(text: string, cartX: number, cartY: number, color: number) {
        const iso = this.cartToIso(cartX, cartY);
        const hex = '#' + color.toString(16).padStart(6, '0');
        const label = this.add.text(iso.x, iso.y - 20, text, {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: hex,
        }).setOrigin(0.5).setDepth(-50).setAlpha(0.7);
        return label;
    }

    // ─── Furniture ──────────────────────────────────────────────────────────────

    private drawFurnitureObjects() {
        // Agent desks (one per agent)
        for (const [role, pos] of Object.entries(AGENT_DESKS)) {
            const color = ROLE_COLORS[role] ?? 0x1a243d;
            this.drawDesk(pos.cartX, pos.cartY, color);
        }

        // Meeting table (large oval at center of meeting room)
        this.drawMeetingTable(9.5, 9.5);

        // Meeting chairs
        const chairOffsets = [
            [-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5],
            [-1, -1], [1, 1],
        ];
        for (const [dx, dy] of chairOffsets) {
            this.drawChair(9.5 + dx, 9.5 + dy);
        }

        // Sofa in lounge
        this.drawSofa(2, 10.5);

        // Coffee table in lounge
        this.drawCoffeeTable(3, 11);

        // Whiteboard in design zone
        this.drawWhiteboard(17, 2);

        // Plants (decorative)
        this.drawPlant(8.5, 6.5);
        this.drawPlant(1.5, 1.5);
        this.drawPlant(18.5, 7.5);
        this.drawPlant(4.5, 13.5);

        // Coffee machine in pantry
        this.drawCoffeeMachine(16, 9);
    }

    private drawDesk(cartX: number, cartY: number, roleColor: number) {
        const iso = this.cartToIso(cartX, cartY);
        const gfx = this.add.graphics();
        const depthY = iso.y;
        gfx.setDepth(depthY - 1);

        const w = 42, h = 22, z = 16;

        // Top face
        gfx.fillStyle(this.blend(roleColor, 0x1a243d, 0.7), 1);
        gfx.beginPath();
        gfx.moveTo(iso.x,     iso.y - z - h);
        gfx.lineTo(iso.x + w, iso.y - z);
        gfx.lineTo(iso.x,     iso.y - z + h);
        gfx.lineTo(iso.x - w, iso.y - z);
        gfx.closePath(); gfx.fillPath();
        gfx.lineStyle(1, roleColor, 0.5); gfx.strokePath();

        // Monitor on desk
        const mx = iso.x + 8, my = iso.y - z - 8;
        gfx.fillStyle(0x1a2540, 1);
        gfx.fillRect(mx - 7, my - 12, 14, 10);
        gfx.fillStyle(this.blend(roleColor, 0x5fe1ff, 0.5), 0.9);
        gfx.fillRect(mx - 5, my - 10, 10, 7);

        // Left side of desk
        gfx.fillStyle(0x101829, 1);
        gfx.beginPath();
        gfx.moveTo(iso.x - w, iso.y - z);
        gfx.lineTo(iso.x,     iso.y - z + h);
        gfx.lineTo(iso.x,     iso.y + h);
        gfx.lineTo(iso.x - w, iso.y);
        gfx.closePath(); gfx.fillPath();

        // Right side of desk
        gfx.fillStyle(0x1a2a42, 1);
        gfx.beginPath();
        gfx.moveTo(iso.x,     iso.y - z + h);
        gfx.lineTo(iso.x + w, iso.y - z);
        gfx.lineTo(iso.x + w, iso.y);
        gfx.lineTo(iso.x,     iso.y + h);
        gfx.closePath(); gfx.fillPath();
    }

    private drawMeetingTable(cartX: number, cartY: number) {
        const iso = this.cartToIso(cartX, cartY);
        const gfx = this.add.graphics();
        gfx.setDepth(iso.y - 5);

        const rW = 70, rH = 35, z = 10;

        // Table top (ellipse-ish with diamond)
        gfx.fillStyle(0x0d2b1a, 1);
        gfx.lineStyle(2, 0x36c987, 0.6);
        gfx.beginPath();
        gfx.moveTo(iso.x,      iso.y - z - rH);
        gfx.lineTo(iso.x + rW, iso.y - z);
        gfx.lineTo(iso.x,      iso.y - z + rH);
        gfx.lineTo(iso.x - rW, iso.y - z);
        gfx.closePath(); gfx.fillPath(); gfx.strokePath();

        // Table legs (left side)
        gfx.fillStyle(0x0a2214, 1);
        gfx.beginPath();
        gfx.moveTo(iso.x - rW, iso.y - z);
        gfx.lineTo(iso.x,      iso.y - z + rH);
        gfx.lineTo(iso.x,      iso.y + rH);
        gfx.lineTo(iso.x - rW, iso.y);
        gfx.closePath(); gfx.fillPath();
    }

    private drawChair(cartX: number, cartY: number) {
        const iso = this.cartToIso(cartX, cartY);
        const gfx = this.add.graphics();
        gfx.setDepth(iso.y - 10);

        const z = 8;
        gfx.fillStyle(0x1a2e1a, 1);
        gfx.lineStyle(1, 0x36c987, 0.4);
        gfx.beginPath();
        gfx.moveTo(iso.x,      iso.y - z - 10);
        gfx.lineTo(iso.x + 18, iso.y - z);
        gfx.lineTo(iso.x,      iso.y - z + 10);
        gfx.lineTo(iso.x - 18, iso.y - z);
        gfx.closePath(); gfx.fillPath(); gfx.strokePath();
    }

    private drawSofa(cartX: number, cartY: number) {
        const iso = this.cartToIso(cartX, cartY);
        const gfx = this.add.graphics();
        gfx.setDepth(iso.y - 1);

        const w = 28, h = 40, z = 18;
        // Seat
        gfx.fillStyle(0x3d2b00, 1);
        gfx.beginPath();
        gfx.moveTo(iso.x,     iso.y - z - h);
        gfx.lineTo(iso.x + w, iso.y - z);
        gfx.lineTo(iso.x,     iso.y - z + h);
        gfx.lineTo(iso.x - w, iso.y - z);
        gfx.closePath(); gfx.fillPath();

        // Back rest
        gfx.fillStyle(0x5a4010, 1);
        gfx.fillRect(iso.x - w, iso.y - z - h - 12, w * 2, 14);
        gfx.lineStyle(1, 0xd4af37, 0.4);
        gfx.strokeRect(iso.x - w, iso.y - z - h - 12, w * 2, 14);
    }

    private drawCoffeeTable(cartX: number, cartY: number) {
        const iso = this.cartToIso(cartX, cartY);
        const gfx = this.add.graphics();
        gfx.setDepth(iso.y - 5);

        const z = 6;
        gfx.fillStyle(0x2a1d00, 1);
        gfx.lineStyle(1, 0xd4af37, 0.4);
        gfx.beginPath();
        gfx.moveTo(iso.x,      iso.y - z - 12);
        gfx.lineTo(iso.x + 22, iso.y - z);
        gfx.lineTo(iso.x,      iso.y - z + 12);
        gfx.lineTo(iso.x - 22, iso.y - z);
        gfx.closePath(); gfx.fillPath(); gfx.strokePath();
    }

    private drawWhiteboard(cartX: number, cartY: number) {
        const iso = this.cartToIso(cartX, cartY);
        const gfx = this.add.graphics();
        gfx.setDepth(iso.y - 2);

        // Board face
        gfx.fillStyle(0x1a1a2e, 1);
        gfx.lineStyle(2, 0xc47eff, 0.7);
        gfx.fillRect(iso.x - 30, iso.y - 60, 60, 45);
        gfx.strokeRect(iso.x - 30, iso.y - 60, 60, 45);

        // Lines on board (pseudo-content)
        gfx.lineStyle(1, 0x9b59b6, 0.5);
        for (let i = 0; i < 3; i++) {
            gfx.beginPath();
            gfx.moveTo(iso.x - 24, iso.y - 52 + i * 10);
            gfx.lineTo(iso.x + 20, iso.y - 52 + i * 10);
            gfx.strokePath();
        }
        // Stand
        gfx.fillStyle(0x333, 1);
        gfx.fillRect(iso.x - 3, iso.y - 15, 6, 15);
    }

    private drawPlant(cartX: number, cartY: number) {
        const iso = this.cartToIso(cartX, cartY);
        const gfx = this.add.graphics();
        gfx.setDepth(iso.y - 2);

        // Pot
        gfx.fillStyle(0x4a2c10, 1);
        gfx.fillRect(iso.x - 7, iso.y - 14, 14, 14);
        // Leaves (oval)
        gfx.fillStyle(0x1a5c1a, 0.9);
        gfx.fillEllipse(iso.x, iso.y - 22, 24, 20);
        gfx.fillStyle(0x237a23, 0.7);
        gfx.fillEllipse(iso.x + 8, iso.y - 26, 16, 14);
        gfx.fillEllipse(iso.x - 8, iso.y - 26, 16, 14);
    }

    private drawCoffeeMachine(cartX: number, cartY: number) {
        const iso = this.cartToIso(cartX, cartY);
        const gfx = this.add.graphics();
        gfx.setDepth(iso.y - 2);

        // Body
        gfx.fillStyle(0x2a1a10, 1);
        gfx.lineStyle(1, 0xc2783a, 0.6);
        gfx.fillRect(iso.x - 10, iso.y - 36, 20, 30);
        gfx.strokeRect(iso.x - 10, iso.y - 36, 20, 30);

        // Glowing indicator
        gfx.fillStyle(0xff6600, 0.9);
        gfx.fillCircle(iso.x + 5, iso.y - 30, 3);

        // Screen
        gfx.fillStyle(0x1a0a00, 1);
        gfx.fillRect(iso.x - 7, iso.y - 32, 10, 8);
        gfx.fillStyle(0xc2783a, 0.5);
        gfx.fillRect(iso.x - 5, iso.y - 30, 6, 4);
    }

    // ─── Humanoid Avatar Drawing ─────────────────────────────────────────────────

    private drawHumanoidAvatar(
        gfx: Phaser.GameObjects.Graphics,
        roleColor: number,
        state: MicroState,
        animTime: number,
        isPlayer = false,
    ) {
        gfx.clear();

        const t = animTime / 1000;
        const activityColor = this.getMicroStateColor(state);

        // Bobbing offsets
        let bodyBob = 0;
        let armR_dy = 0;
        let armL_dy = 0;
        let legL_dy = 0;
        let legR_dy = 0;

        switch (state) {
            case 'idle':
                bodyBob = Math.sin(t * 1.2) * 1.5;
                break;
            case 'thinking':
            case 'planning':
            case 'designing':
                bodyBob = Math.sin(t * 0.8) * 1;
                armR_dy = -8 + Math.sin(t * 2) * 2; // arm up (thinking)
                break;
            case 'coding':
            case 'executing':
            case 'optimizing':
            case 'testing':
                bodyBob = Math.sin(t * 4) * 0.8;
                armR_dy = Math.sin(t * 6) * 4; // typing
                armL_dy = Math.cos(t * 6) * 4;
                break;
            case 'walking':
                bodyBob = Math.abs(Math.sin(t * 4)) * -2;
                legL_dy = Math.sin(t * 5) * 5;
                legR_dy = -Math.sin(t * 5) * 5;
                break;
            case 'waiting_for_human':
                bodyBob = Math.sin(t * 0.5) * 2;
                break;
            case 'completed':
                bodyBob = Math.sin(t * 8) * 2; // excited bounce
                break;
            case 'error':
                bodyBob = (Math.floor(t * 4) % 2 === 0) ? -1 : 1;
                break;
        }

        const baseY = bodyBob;
        const skinTone = isPlayer ? 0xffe0c0 : 0xffd4a0;

        // Shadow under feet
        gfx.fillStyle(0x000000, 0.25);
        gfx.fillEllipse(0, 4, 18, 6);

        // Legs
        const legColor = isPlayer ? 0x1a5a7a : 0x2a2a3a;
        gfx.fillStyle(legColor, 1);
        gfx.fillRect(-6, -20 + legL_dy + baseY, 5, 14);
        gfx.fillRect(1,  -20 + legR_dy + baseY, 5, 14);

        // Body
        const bodyColor = state === 'error'
            ? (Math.floor(t * 4) % 2 === 0 ? 0xaa1111 : roleColor)
            : roleColor;
        gfx.fillStyle(bodyColor, 1);
        gfx.fillRect(-7, -42 + baseY, 14, 22);

        // Activity glow strip on chest
        gfx.fillStyle(activityColor, 0.5);
        gfx.fillRect(-4, -38 + baseY, 8, 4);

        // Arms
        gfx.fillStyle(roleColor, 0.9);
        gfx.fillRect(-12, -40 + armL_dy + baseY, 5, 14);
        gfx.fillRect(7,   -40 + armR_dy + baseY, 5, 14);

        // Neck
        gfx.fillStyle(skinTone, 1);
        gfx.fillRect(-3, -46 + baseY, 6, 6);

        // Head
        gfx.fillStyle(skinTone, 1);
        gfx.fillEllipse(0, -55 + baseY, 16, 18);

        // Hair / hat (role color)
        gfx.fillStyle(isPlayer ? 0x00aaff : roleColor, 1);
        gfx.fillEllipse(0, -61 + baseY, 14, 10);

        // Eyes
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(-4, -55 + baseY, 2);
        gfx.fillCircle(4,  -55 + baseY, 2);

        // Player indicator (glowing dot above head)
        if (isPlayer) {
            gfx.fillStyle(0xffd700, 0.9);
            gfx.fillCircle(-3, -72 + baseY, 3);
            gfx.fillCircle(3,  -72 + baseY, 3);
            gfx.fillCircle(0,  -75 + baseY, 3);
        }

        // Completed sparkles
        if (state === 'completed') {
            for (let i = 0; i < 4; i++) {
                const angle = t * 2 + i * (Math.PI / 2);
                const rx = Math.cos(angle) * 14;
                const ry = Math.sin(angle) * 8 - 65 + baseY;
                gfx.fillStyle(0x5cff9d, 0.8);
                gfx.fillCircle(rx, ry, 2);
            }
        }
    }

    private getMicroStateColor(state: MicroState): number {
        switch (state) {
            case 'idle': return 0x1d83b8;
            case 'thinking':
            case 'planning':
            case 'designing': return 0x5fe1ff;
            case 'coding':
            case 'executing':
            case 'optimizing':
            case 'testing': return 0xc2783a;
            case 'completed': return 0x36c987;
            case 'waiting_for_human': return 0xd4af37;
            case 'error': return 0xd94d4d;
            case 'walking': return 0x5fe1ff;
            default: return 0x888888;
        }
    }

    // ─── Player ──────────────────────────────────────────────────────────────────

    private spawnPlayer() {
        const iso = this.cartToIso(this.playerCart.x, this.playerCart.y);
        this.playerContainer = this.add.container(iso.x, iso.y);
        this.playerContainer.setDepth(iso.y + 1);

        this.playerGfx = this.add.graphics();
        this.playerContainer.add(this.playerGfx);

        const label = this.add.text(0, -78, '[ YOU ]', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#5fe1ff',
            stroke: '#000',
            strokeThickness: 2,
        }).setOrigin(0.5);
        this.playerContainer.add(label);

        // Initial draw
        this.drawHumanoidAvatar(this.playerGfx, ROLE_COLORS.player, 'idle', 0, true);
    }

    // ─── Input ───────────────────────────────────────────────────────────────────

    private setupInput() {
        this.cursors = this.input.keyboard!.createCursorKeys();
        this.wasd = {
            up:    this.input.keyboard!.addKey('W'),
            down:  this.input.keyboard!.addKey('S'),
            left:  this.input.keyboard!.addKey('A'),
            right: this.input.keyboard!.addKey('D'),
        };
        this.eKey = this.input.keyboard!.addKey('E');

        // Zoom via scroll wheel
        this.input.on('wheel', (_p: unknown, _go: unknown, _dx: number, deltaY: number) => {
            const newZoom = this.cameras.main.zoom - deltaY * 0.001;
            this.cameras.main.setZoom(clamp(newZoom, 0.3, 2.5));
        });
    }

    // ─── EventBus ────────────────────────────────────────────────────────────────

    private setupEventBus() {
        EventBus.on('update-agents', (agents: Record<string, AgentRuntimeState>) => {
            this.agentStates = agents;
            this.syncAgents(agents);
        });
        EventBus.on('exp-effects', (effects: ExpFx[]) => {
            this.spawnExpEffects(effects);
        });
    }

    // ─── Update Handlers ─────────────────────────────────────────────────────────

    private handlePlayerMovement(_delta: number) {
        const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
        const down  = this.cursors.down.isDown  || this.wasd.down.isDown;
        const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
        const right = this.cursors.right.isDown || this.wasd.right.isDown;

        if (!up && !down && !left && !right) return;

        let dx = 0, dy = 0;

        // Isometric axes: up = NW (-x,-y), down = SE (+x,+y), left = SW (-x,+y), right = NE (+x,-y)
        if (up)    { dx -= MOVE_SPEED; dy -= MOVE_SPEED; }
        if (down)  { dx += MOVE_SPEED; dy += MOVE_SPEED; }
        if (left)  { dx -= MOVE_SPEED; dy += MOVE_SPEED; }
        if (right) { dx += MOVE_SPEED; dy -= MOVE_SPEED; }

        // Normalize diagonal
        if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

        const nx = this.playerCart.x + dx;
        const ny = this.playerCart.y + dy;

        // Collision — try axes separately on block
        const canX = this.isWalkable(nx, this.playerCart.y);
        const canY = this.isWalkable(this.playerCart.x, ny);
        const canXY = this.isWalkable(nx, ny);

        if (canXY) {
            this.playerCart.x = nx;
            this.playerCart.y = ny;
        } else if (canX) {
            this.playerCart.x = nx;
        } else if (canY) {
            this.playerCart.y = ny;
        }

        const iso = this.cartToIso(this.playerCart.x, this.playerCart.y);
        this.playerContainer.setPosition(iso.x, iso.y);
    }

    private updateCamera() {
        const iso = this.cartToIso(this.playerCart.x, this.playerCart.y);
        const cam = this.cameras.main;
        const targetX = iso.x - (cam.width / cam.zoom) / 2;
        const targetY = iso.y - (cam.height / cam.zoom) / 2;
        cam.scrollX += (targetX - cam.scrollX) * 0.08;
        cam.scrollY += (targetY - cam.scrollY) * 0.08;
    }

    private checkProximity() {
        let closestId: string | null = null;
        let closestDist = 2.5;

        for (const [id, data] of this.agentSprites.entries()) {
            const dist = distBetween(
                this.playerCart.x, this.playerCart.y,
                data.cartPos.x, data.cartPos.y,
            );
            if (dist < closestDist) {
                closestDist = dist;
                closestId = id;
            }
        }

        this.nearbyAgentId = closestId;

        // Show/hide interact hints on NPC
        for (const [id, data] of this.agentSprites.entries()) {
            const isNear = id === closestId;
            if (data.interactHint) {
                data.interactHint.setVisible(isNear);
            }
        }

        // Emit proximity change to React
        if (closestId !== this.lastProximityId) {
            this.lastProximityId = closestId;
            EventBus.emit('agent-proximity', closestId);
        }

        // E key interaction
        // JustDown equivalent: fire once per press
        const eDown = this.eKey.isDown;
        if (eDown && !this.eKeyWasDown && this.nearbyAgentId) {
            EventBus.emit('agent-interact', this.nearbyAgentId);
        }
        this.eKeyWasDown = eDown;
    }

    private updateNPCBehavior(delta: number) {
        for (const [id, data] of this.agentSprites.entries()) {
            const agent = this.agentStates[id];
            if (!agent) continue;

            data.wanderTimer -= delta;

            const desk = AGENT_DESKS[id] ?? AGENT_DESKS[agent.role] ?? { cartX: 5, cartY: 5 };

            if (agent.current_micro_state === 'walking' || agent.current_micro_state === 'idle') {
                if (data.wanderTimer <= 0) {
                    data.wanderTimer = randBetween(6000, 12000);

                    // Pick wander target within the agent's zone
                    const zone = id === 'planner' || id === 'architect' || id === 'developer'
                        ? ZONES.dev
                        : id === 'ui_weaver' || id === 'validator' || id === 'optimizer'
                        ? ZONES.design
                        : ZONES.meeting;

                    let tx: number, ty: number;
                    let attempts = 0;
                    do {
                        tx = randBetween(zone.x1, zone.x2);
                        ty = randBetween(zone.y1, zone.y2);
                        attempts++;
                    } while (!this.walkable[ty]?.[tx] && attempts < 20);

                    if (this.walkable[ty]?.[tx]) {
                        this.tweenNPCTo(id, data, tx, ty);
                    }
                }
            } else if (agent.current_micro_state === 'planning') {
                // Walk to meeting room
                if (data.wanderTimer <= 0) {
                    data.wanderTimer = randBetween(8000, 14000);
                    const mx = randBetween(6, 13);
                    const my = randBetween(9, 12);
                    if (this.walkable[my]?.[mx]) {
                        this.tweenNPCTo(id, data, mx, my);
                    }
                }
            } else {
                // Active work state → go back to desk
                if (Math.abs(data.cartPos.x - desk.cartX) > 1 || Math.abs(data.cartPos.y - desk.cartY) > 1) {
                    if (data.wanderTimer <= 0) {
                        data.wanderTimer = randBetween(1000, 3000);
                        this.tweenNPCTo(id, data, desk.cartX, desk.cartY);
                    }
                }
            }
        }
    }

    private tweenNPCTo(_id: string, data: AgentSpriteData, cartX: number, cartY: number) {
        const isoTarget = this.cartToIso(cartX, cartY);
        const startCart = { x: data.cartPos.x, y: data.cartPos.y };
        data.targetCart = { x: cartX, y: cartY };
        const duration = randBetween(1200, 2200);
        let elapsed = 0;

        this.tweens.add({
            targets: data.container,
            x: isoTarget.x,
            y: isoTarget.y,
            duration,
            ease: 'Sine.easeInOut',
            onUpdate: (_tween: unknown, _targets: unknown, _key: string, _current: number, _prev: number, delta: number) => {
                elapsed = Math.min(elapsed + delta, duration);
                const prog = elapsed / duration;
                data.cartPos = {
                    x: startCart.x + (cartX - startCart.x) * prog,
                    y: startCart.y + (cartY - startCart.y) * prog,
                };
            },
            onComplete: () => {
                data.cartPos = { x: cartX, y: cartY };
            },
        });
    }

    private updateAvatarAnimations() {
        const t = this.time.now;

        // Redraw player avatar
        this.drawHumanoidAvatar(this.playerGfx, ROLE_COLORS.player, 'idle', t, true);

        // Redraw NPC avatars
        for (const [id, data] of this.agentSprites.entries()) {
            const agent = this.agentStates[id];
            const roleColor = ROLE_COLORS[id] ?? ROLE_COLORS[agent?.role ?? ''] ?? 0x888888;
            const state = agent?.current_micro_state ?? 'idle';
            this.drawHumanoidAvatar(data.body, roleColor, state, t, false);
        }
    }

    private updateDepthSorting() {
        // Player depth
        const playerIso = this.cartToIso(this.playerCart.x, this.playerCart.y);
        this.playerContainer.setDepth(playerIso.y + 1);

        // NPC depth
        for (const data of this.agentSprites.values()) {
            data.container.setDepth(data.container.y);
        }
    }

    // ─── Agent NPC Sync ──────────────────────────────────────────────────────────

    private syncAgents(agents: Record<string, AgentRuntimeState>) {
        const currentIds = new Set(Object.keys(agents));

        // Remove departed agents
        for (const [id, data] of this.agentSprites.entries()) {
            if (!currentIds.has(id)) {
                data.container.destroy();
                this.agentSprites.delete(id);
            }
        }

        let index = 0;
        for (const [id, agent] of Object.entries(agents)) {
            const desk = AGENT_DESKS[id] ?? AGENT_DESKS[agent.role];
            const startCart = desk ?? { cartX: (index % 3) * 3 + 2, cartY: Math.floor(index / 3) * 3 + 2 };

            if (!this.agentSprites.has(id)) {
                const iso = this.cartToIso(startCart.cartX, startCart.cartY);
                const container = this.add.container(iso.x, iso.y);
                container.setDepth(iso.y);

                const body = this.add.graphics();

                const label = this.add.text(0, -82, agent.display_name, {
                    fontFamily: 'monospace',
                    fontSize: '10px',
                    color: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 2,
                    backgroundColor: '#00000066',
                    padding: { x: 4, y: 2 },
                }).setOrigin(0.5);

                const interactHint = this.add.text(0, -95, '[ E ] Talk', {
                    fontFamily: 'monospace',
                    fontSize: '9px',
                    color: '#5fe1ff',
                    stroke: '#000',
                    strokeThickness: 2,
                }).setOrigin(0.5).setVisible(false);

                container.add([body, label, interactHint]);

                this.agentSprites.set(id, {
                    container,
                    body,
                    label,
                    interactHint,
                    cartPos: { x: startCart.cartX, y: startCart.cartY },
                    targetCart: { x: startCart.cartX, y: startCart.cartY },
                    wanderTimer: randBetween(2000, 6000),
                    currentState: agent.current_micro_state,
                    lastBubbleMsg: '',
                });
            }

            const spriteData = this.agentSprites.get(id)!;
            spriteData.currentState = agent.current_micro_state;

            // Update label — show micro_state badge
            const stateEmoji: Record<string, string> = {
                idle: '💤', thinking: '💭', planning: '📋', coding: '💻',
                executing: '⚡', testing: '🔍', optimizing: '🔧',
                completed: '✅', error: '❌', waiting_for_human: '⏳',
                designing: '🎨', walking: '🚶',
            };
            const badge = stateEmoji[agent.current_micro_state] ?? '';
            spriteData.label.setText(`${badge} ${agent.display_name}`);

            // Speech bubble: show when message changes and is non-empty
            const msg = agent.status_message?.trim();
            const shouldShow = msg &&
                msg !== spriteData.lastBubbleMsg &&
                !['Task completed', 'Task failed', 'Completed', ''].includes(msg);

            if (shouldShow) {
                // Destroy existing bubble first
                if (spriteData.bubble) {
                    spriteData.bubble.destroy();
                    spriteData.bubble = undefined;
                }
                spriteData.lastBubbleMsg = msg!;

                const truncated = msg!.length > 80 ? msg!.slice(0, 77) + '…' : msg!;
                const stateColor = this.getMicroStateColor(agent.current_micro_state);
                const hexColor = '#' + stateColor.toString(16).padStart(6, '0');

                const bubble = this.add.text(0, -112, truncated, {
                    fontFamily: 'sans-serif',
                    fontSize: '9px',
                    color: '#000000',
                    backgroundColor: hexColor + 'ee',
                    padding: { x: 5, y: 3 },
                    wordWrap: { width: 110 },
                }).setOrigin(0.5).setAlpha(0);

                spriteData.container.add(bubble);
                spriteData.bubble = bubble;

                // Fade in
                this.tweens.add({ targets: bubble, alpha: 1, duration: 300, ease: 'Power2' });

                // Auto-dismiss after 5s with fade out
                this.time.delayedCall(5000, () => {
                    if (spriteData.bubble === bubble) {
                        this.tweens.add({
                            targets: bubble,
                            alpha: 0,
                            y: bubble.y - 8,
                            duration: 400,
                            onComplete: () => {
                                bubble.destroy();
                                if (spriteData.bubble === bubble) spriteData.bubble = undefined;
                            },
                        });
                    }
                });
            }

            index++;
        }
    }

    // ─── EXP Effects ─────────────────────────────────────────────────────────────

    private spawnExpEffects(expEffects: ExpFx[]) {
        for (const fx of expEffects) {
            const data = this.agentSprites.get(fx.agent_id);
            if (!data) continue;

            const text = this.add.text(data.container.x, data.container.y - 60, `+${fx.delta} EXP`, {
                fontFamily: 'monospace',
                fontSize: '14px',
                fontStyle: 'bold',
                color: '#5fe1ff',
                stroke: '#000000',
                strokeThickness: 3,
            }).setOrigin(0.5).setDepth(data.container.y + 100);

            this.tweens.add({
                targets: text,
                y: data.container.y - 110,
                alpha: 0,
                duration: 1500,
                ease: 'Power2',
                onComplete: () => text.destroy(),
            });
        }
    }

    // ─── Utility ──────────────────────────────────────────────────────────────────

    /** Blend two hex colors by weight (0 = all colorA, 1 = all colorB) */
    private blend(colorA: number, colorB: number, weight: number): number {
        const rA = (colorA >> 16) & 0xff, gA = (colorA >> 8) & 0xff, bA = colorA & 0xff;
        const rB = (colorB >> 16) & 0xff, gB = (colorB >> 8) & 0xff, bB = colorB & 0xff;
        const r = Math.round(rA + (rB - rA) * weight);
        const g = Math.round(gA + (gB - gA) * weight);
        const b = Math.round(bA + (bB - bA) * weight);
        return (r << 16) | (g << 8) | b;
    }
}
