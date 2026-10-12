/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Cal.com event path, e.g. `username/10min` */
  readonly VITE_CAL_LINK?: string;
  /** Optional Cal.com origin (default https://cal.com) */
  readonly VITE_CAL_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
