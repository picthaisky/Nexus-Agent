/**
 * Corporate diorama generation parameters.
 * These are assembled into a single DALL-E 3 prompt by the /scene/generate endpoint.
 */

export const visualStyle = `
Ultra high quality 3D isometric office map diorama, orthographic camera,
premium architectural visualization, realistic miniature office materials,
clean white studio background, global illumination, soft shadows, subtle ambient occlusion,
crisp labels, high-end consulting slide illustration, 1792x1024 composition.
`.trim();

export const sceneObjects = `
Realistic segmented corporate office: lounge with sofas, architect station,
planner/coordinator table, developer zone, UI reviewer design zone, meeting room,
validator desk, pantry, server rack, glass partitions, whiteboards, sticky notes,
risk monitoring area with red warning dashboard, laptops, monitors, reports, binders,
black floating room labels reading Architect, Developer, Planner / Coordinator,
UI Reviewer, Validator, Lounge, Meeting Room, Pantry, and Risk Monitoring Area.
`.trim();

export const colorSystem = `
Color palette: clean white, polished steel, soft grey, muted blue,
with strong red accents only for alerts, risks, and critical indicators.
`.trim();

export const negativePrompt = `
No cartoon style, no pixel art, no flat vector UI, no game UI, no cyberpunk neon,
no dark background, no low-poly objects, no watermark, no blurry details, no fisheye lens.
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
