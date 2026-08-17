// The canonical Playwright configuration already builds and serves the emitted
// Vite production bundle. This explicit entrypoint prevents callers from
// accidentally substituting a development server for release verification.
export { default } from './playwright.config';
