/**
 * The Host entry dsh resolves through this package's `main`. It re-exports the Host half, which is also what the tests
 * import, so there is one public surface rather than two.
 */
export * from './host/index.js';
