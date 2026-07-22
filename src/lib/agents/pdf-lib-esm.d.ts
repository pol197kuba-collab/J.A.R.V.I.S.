// Type shim for importing pdf-lib's fully-bundled ESM dist directly.
// See producer.server.ts for why the bundled file is imported instead of
// the bare "pdf-lib" entry (tslib CJS-interop crash in the deployed SSR
// bundle). The dist file carries no types of its own; its API is identical
// to the package root, so re-export the package's declarations.
declare module "pdf-lib/dist/pdf-lib.esm.js" {
  export * from "pdf-lib";
}
