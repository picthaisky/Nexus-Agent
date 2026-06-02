/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Legacy names (kept for backward-compat)
  readonly VITE_API_BASE?: string;
  readonly VITE_WS_BASE?: string;
  readonly VITE_REQUIRE_AUTH?: string;

  // Active names used in source code
  /** Full URL to the Nexus-Agent backend, e.g. https://nexus.example.com  (no trailing slash).
   *  If unset, relative paths are used (works when Vite/nginx proxies the backend). */
  readonly VITE_NEXUS_API_URL?: string;

  /** WebSocket URL override, e.g. wss://nexus.example.com/ws/dashboard.
   *  If unset, derived automatically from location.protocol + location.host. */
  readonly VITE_NEXUS_WS_URL?: string;

  /** Optional HD bitmap used as the primary Isometric Office scene. */
  readonly VITE_OFFICE_MAP_IMAGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
