import '@testing-library/jest-dom';

// structuredClone was added in Node 17; polyfill it for Node 16 (CRA's Jest env)
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
