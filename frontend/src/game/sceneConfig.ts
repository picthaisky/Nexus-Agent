/**
 * Corporate diorama generation parameters.
 * These are assembled into a single DALL-E 3 prompt by the /scene/generate endpoint.
 */

export const visualStyle = `
Highly detailed 3D isometric corporate diorama, premium technical visualization,
clean white studio background, realistic scale, global illumination, soft shadows,
subtle ambient occlusion, high-end consulting slide illustration.
`.trim();

export const sceneObjects = `
Realistic corporate office and industrial objects: desks, laptops, monitors,
server racks, glass boards, printed reports, paper documents, binders,
floating spreadsheet panels, dashboard screens, warning icons, workflow cards.
`.trim();

export const colorSystem = `
Color palette: clean white, polished steel, soft grey, muted blue,
with strong red accents only for alerts, risks, and critical indicators.
`.trim();

export const negativePrompt = `
No cartoon style, no pixel art, no game UI, no cyberpunk neon,
no dark background, no low-poly objects, no watermark, no blurry details.
`.trim();

export const SCENE_DEFAULTS = {
  visual_style:    visualStyle,
  scene_objects:   sceneObjects,
  color_system:    colorSystem,
  negative_prompt: negativePrompt,
  size:            "1792x1024" as const,
  quality:         "hd" as const,
};

export interface SceneGenerateResponse {
  url: string;
  revised_prompt: string | null;
  model: string;
  size: string;
  quality: string;
}
