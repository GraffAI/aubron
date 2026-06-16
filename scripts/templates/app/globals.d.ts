// Ambient declarations so `tsc --noEmit` accepts side-effect asset imports
// (e.g. `import "./globals.css"`). Next's bundler resolves these at build time;
// standalone typecheck just needs to know the modules exist.
declare module "*.css";
