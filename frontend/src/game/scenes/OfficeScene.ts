import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import type { AgentRuntimeState, MicroState } from '../../types';
import { ExpFx } from '../../hooks/useAgentSocket';

interface IsometricPosition {
    x: number;
    y: number;
    z: number;
}

export class OfficeScene extends Scene {
    private agentSprites: Map<string, {
        container: Phaser.GameObjects.Container,
        body: Phaser.GameObjects.Graphics,
        label: Phaser.GameObjects.Text,
        bubble?: Phaser.GameObjects.Text,
        targetPos: { isoX: number, isoY: number }
    }> = new Map();

    private tileWidth = 64;
    private tileHeight = 32; // Standard 2:1 isometric ratio
    private gridWidth = 10;
    private gridHeight = 10;
    private isDragging = false;
    private dragStart = { x: 0, y: 0 };
    private cameraStart = { x: 0, y: 0 };

    constructor() {
        super('OfficeScene');
    }

    create() {
        this.cameras.main.setBackgroundColor('#070b14');

        // Draw the isometric floor grid
        this.drawFloorGrid();

        // Setup camera
        this.cameras.main.setZoom(1);
        this.cameras.main.centerOn(0, 0);

        // Input handling for Pan & Zoom
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            this.isDragging = true;
            this.dragStart = { x: pointer.x, y: pointer.y };
            this.cameraStart = { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY };
        });

        this.input.on('pointerup', () => {
            this.isDragging = false;
        });

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (this.isDragging) {
                const dx = pointer.x - this.dragStart.x;
                const dy = pointer.y - this.dragStart.y;
                this.cameras.main.scrollX = this.cameraStart.x - dx / this.cameras.main.zoom;
                this.cameras.main.scrollY = this.cameraStart.y - dy / this.cameras.main.zoom;
            }
        });

        this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number, deltaZ: number) => {
            const newZoom = this.cameras.main.zoom - deltaY * 0.001;
            this.cameras.main.setZoom(Phaser.Math.Clamp(newZoom, 0.3, 3));
        });

        // Listen for React updates
        EventBus.on('update-agents', (agents: Record<string, AgentRuntimeState>) => {
            this.syncAgents(agents);
        });

        EventBus.on('exp-effects', (expEffects: ExpFx[]) => {
            this.spawnExpEffects(expEffects);
        });

        EventBus.emit('current-scene-ready', this);
    }

    // Convert Cartesian coordinates to Isometric Screen Coordinates
    cartToIso(cartX: number, cartY: number): { x: number, y: number } {
        return {
            x: (cartX - cartY) * (this.tileWidth / 2),
            y: (cartX + cartY) * (this.tileHeight / 2)
        };
    }

    private drawFloorGrid() {
        const floor = this.add.graphics();
        floor.lineStyle(1, 0x1d83b8, 0.4);

        for (let x = 0; x < this.gridWidth; x++) {
            for (let y = 0; y < this.gridHeight; y++) {
                const iso = this.cartToIso(x, y);
                
                // Floor tile
                floor.fillStyle(0x0f1626, 0.8);
                floor.beginPath();
                floor.moveTo(iso.x, iso.y - this.tileHeight / 2);
                floor.lineTo(iso.x + this.tileWidth / 2, iso.y);
                floor.lineTo(iso.x, iso.y + this.tileHeight / 2);
                floor.lineTo(iso.x - this.tileWidth / 2, iso.y);
                floor.closePath();
                floor.fillPath();
                floor.strokePath();

                // Draw some procedural desks at specific intervals
                if (x % 3 === 2 && y % 3 === 2) {
                    this.drawIsometricDesk(iso.x, iso.y);
                }
            }
        }
    }

    private drawIsometricDesk(isoX: number, isoY: number) {
        const desk = this.add.graphics();
        desk.setDepth(isoY - 1); // Desks are slightly behind the agent standing there

        const w = 40;
        const h = 20; // depth
        const z = 15; // height
        
        // Desk top
        desk.fillStyle(0x1a243d, 1);
        desk.beginPath();
        desk.moveTo(isoX, isoY - z - h);
        desk.lineTo(isoX + w, isoY - z);
        desk.lineTo(isoX, isoY - z + h);
        desk.lineTo(isoX - w, isoY - z);
        desk.fillPath();
        
        // Desk left side
        desk.fillStyle(0x131b2e, 1);
        desk.beginPath();
        desk.moveTo(isoX - w, isoY - z);
        desk.lineTo(isoX, isoY - z + h);
        desk.lineTo(isoX, isoY + h);
        desk.lineTo(isoX - w, isoY);
        desk.fillPath();

        // Desk right side
        desk.fillStyle(0x233152, 1);
        desk.beginPath();
        desk.moveTo(isoX, isoY - z + h);
        desk.lineTo(isoX + w, isoY - z);
        desk.lineTo(isoX + w, isoY);
        desk.lineTo(isoX, isoY + h);
        desk.fillPath();
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

    private syncAgents(agents: Record<string, AgentRuntimeState>) {
        const currentIds = new Set(Object.keys(agents));
        
        // Remove dead agents
        for (const [id, data] of this.agentSprites.entries()) {
            if (!currentIds.has(id)) {
                data.container.destroy();
                this.agentSprites.delete(id);
            }
        }

        // Add or Update agents
        let index = 0;
        for (const [id, agent] of Object.entries(agents)) {
            const color = this.getMicroStateColor(agent.current_micro_state);
            
            // Fixed positions for now based on roster order
            const cartX = (index % 3) * 3 + 2;
            const cartY = Math.floor(index / 3) * 3 + 2;
            const iso = this.cartToIso(cartX, cartY);

            if (!this.agentSprites.has(id)) {
                // Spawn new agent
                const container = this.add.container(iso.x, iso.y);
                container.setDepth(iso.y); // Y-sorting for 2.5D depth

                // Draw 3D Isometric box for agent
                const body = this.add.graphics();
                
                const label = this.add.text(0, -50, agent.display_name, {
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    color: '#ffffff',
                    backgroundColor: '#000000',
                    padding: { x: 4, y: 2 }
                }).setOrigin(0.5);

                container.add([body, label]);
                this.agentSprites.set(id, { container, body, label, targetPos: { isoX: iso.x, isoY: iso.y } });
            }

            const spriteData = this.agentSprites.get(id)!;
            
            // Redraw body with current color
            spriteData.body.clear();
            const bw = 24;
            const bh = 40;
            
            // Top face
            spriteData.body.fillStyle(Phaser.Display.Color.IntegerToColor(color).lighten(20).color, 0.9);
            spriteData.body.beginPath();
            spriteData.body.moveTo(0, -bh - bw/2);
            spriteData.body.lineTo(bw, -bh);
            spriteData.body.lineTo(0, -bh + bw/2);
            spriteData.body.lineTo(-bw, -bh);
            spriteData.body.fillPath();

            // Right face
            spriteData.body.fillStyle(color, 0.9);
            spriteData.body.beginPath();
            spriteData.body.moveTo(0, -bh + bw/2);
            spriteData.body.lineTo(bw, -bh);
            spriteData.body.lineTo(bw, 0);
            spriteData.body.lineTo(0, bw/2);
            spriteData.body.fillPath();

            // Left face
            spriteData.body.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(20).color, 0.9);
            spriteData.body.beginPath();
            spriteData.body.moveTo(0, -bh + bw/2);
            spriteData.body.lineTo(-bw, -bh);
            spriteData.body.lineTo(-bw, 0);
            spriteData.body.lineTo(0, bw/2);
            spriteData.body.fillPath();
            
            spriteData.label.setText(`[${agent.current_micro_state.toUpperCase()}]\n${agent.display_name}`);
            
            if (agent.status_message && !spriteData.bubble) {
                const bubble = this.add.text(0, -80, agent.status_message, {
                    fontFamily: 'sans-serif',
                    fontSize: '10px',
                    color: '#000',
                    backgroundColor: '#fff',
                    padding: { x: 6, y: 4 },
                    wordWrap: { width: 100 }
                }).setOrigin(0.5);
                spriteData.container.add(bubble);
                spriteData.bubble = bubble;

                this.time.delayedCall(4000, () => {
                    if (spriteData.bubble) {
                        spriteData.bubble.destroy();
                        spriteData.bubble = undefined;
                    }
                });
            }

            if (agent.current_micro_state === 'walking') {
                // Bobbing animation
                spriteData.body.y = Math.sin(this.time.now / 100) * 4;
            } else {
                spriteData.body.y = 0;
            }

            index++;
        }
    }

    private spawnExpEffects(expEffects: ExpFx[]) {
        for (const fx of expEffects) {
            const spriteData = this.agentSprites.get(fx.agent_id);
            if (!spriteData) continue;

            const text = this.add.text(spriteData.targetPos.isoX, spriteData.targetPos.isoY - 60, `+${fx.delta} EXP`, {
                fontFamily: 'sans-serif',
                fontSize: '14px',
                fontStyle: 'bold',
                color: '#5fe1ff',
                stroke: '#000000',
                strokeThickness: 3
            }).setOrigin(0.5);

            text.setDepth(spriteData.targetPos.isoY + 100); // Always on top

            this.tweens.add({
                targets: text,
                y: spriteData.targetPos.isoY - 100,
                alpha: 0,
                duration: 1500,
                ease: 'Power2',
                onComplete: () => text.destroy()
            });
        }
    }

    update() {
        // Continuous updates if needed
    }
}
