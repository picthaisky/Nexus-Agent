import { AUTO, Game, Scale } from 'phaser';
import { OfficeScene } from './scenes/OfficeScene';

//  Find out more information about the Game Config at:
//  https://newdocs.phaser.io/docs/3.70.0/Phaser.Types.Core.GameConfig
const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    parent: 'game-container',
    backgroundColor: '#070b14',
    scale: {
        mode: Scale.RESIZE,
        autoCenter: Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
    },
    scene: [
        OfficeScene
    ]
};

const StartGame = (parent: string) => {
    return new Game({ ...config, parent });
}

export default StartGame;
