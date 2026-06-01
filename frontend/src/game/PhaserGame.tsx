import React, { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import StartGame from './main';
import { EventBus } from './EventBus';

export interface IRefPhaserGame {
    game: Phaser.Game | null;
    scene: Phaser.Scene | null;
}

export const PhaserGame = forwardRef<IRefPhaserGame, any>(function PhaserGame (props, ref) {
    const game = useRef<Phaser.Game | null>(null!);

    useLayoutEffect(() => {
        if (game.current === null) {
            game.current = StartGame("game-container");

            if (typeof ref === 'function') {
                ref({ game: game.current, scene: null });
            } else if (ref) {
                ref.current = { game: game.current, scene: null };
            }
        }

        // Force Phaser Scale Manager to re-measure when container resizes
        const container = document.getElementById('game-container');
        let observer: ResizeObserver | null = null;
        if (container && typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => {
                game.current?.scale?.refresh();
            });
            observer.observe(container);
        }

        return () => {
            observer?.disconnect();
            if (game.current) {
                game.current.destroy(true);
                game.current = null;
            }
        };
    }, [ref]);

    useEffect(() => {
        EventBus.on('current-scene-ready', (currentScene: Phaser.Scene) => {
            if (typeof ref === 'function') {
                ref({ game: game.current, scene: currentScene });
            } else if (ref) {
                ref.current = { game: game.current, scene: currentScene };
            }
        });
        
        return () => {
            EventBus.removeListener('current-scene-ready');
        }
    }, [ref]);

    return (
        <div id="game-container" className="w-full h-full"></div>
    );
});
