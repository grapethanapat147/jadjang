/// <reference types="vite/client" />

declare module "*.mjs?url" {
  const value: string;
  export default value;
}
