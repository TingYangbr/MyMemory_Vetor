/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API quando o front não usa proxy (ex.: `http://127.0.0.1:4000`). */
  readonly VITE_API_BASE?: string;
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
