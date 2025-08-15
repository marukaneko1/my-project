declare module "talib-wasm" {
  const initTalib: () => Promise<void>;
  const TALib: Record<string, any>;
  export default initTalib;
  export = TALib;
}