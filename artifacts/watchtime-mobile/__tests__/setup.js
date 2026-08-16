// setupFiles runs before the Jest framework is installed, so Jest globals
// like beforeAll are not available here. Patch console.error immediately.
const originalError = console.error.bind(console);
console.error = (...args) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Warning:') || args[0].includes('act('))
  ) {
    return;
  }
  originalError(...args);
};
