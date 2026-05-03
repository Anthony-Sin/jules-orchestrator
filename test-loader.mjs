export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'react') {
    const code = `
let stateVals = [];
let stateIdx = 0;

export function resetReactMocks() {
  stateVals = [];
  stateIdx = 0;
}

export function resetReactMocksForRender() {
  stateIdx = 0;
}

export function useState(initial) {
  const currentIdx = stateIdx++;
  if (stateVals[currentIdx] === undefined) {
    stateVals[currentIdx] = typeof initial === 'function' ? initial() : initial;
  }
  const setVal = (val) => {
    stateVals[currentIdx] = typeof val === 'function' ? val(stateVals[currentIdx]) : val;
  };
  return [stateVals[currentIdx], setVal];
}

export function useEffect(fn, deps) {}
export function useCallback(fn, deps) { return fn; }
export function useRef(initial) { return { current: initial }; }
export function useMemo(fn, deps) { return fn(); }

export default {
  useState, useEffect, useCallback, useRef, useMemo, resetReactMocks, resetReactMocksForRender
};
`;
    return {
      format: 'module',
      shortCircuit: true,
      url: 'data:text/javascript,' + encodeURIComponent(code),
    };
  }

  // Intercept the store dependency
  if (specifier.includes('../state/store.js') && context.parentURL && context.parentURL.includes('dashboard-controller')) {
    const code = `
export const store = {
  get: () => {},
  set: () => {}
};
globalThis.mockConfig = { source: 'NOT SET' };
export function getConfig() { return globalThis.mockConfig; }
export function setConfig(k, v) {
  if (globalThis.onSetConfig) globalThis.onSetConfig(k, v);
}
globalThis.mockSessions = [];
export function getSessions() { return globalThis.mockSessions; }
export function removeSession() {}
export function upsertSession() {}
    `;
    return {
      format: 'module',
      shortCircuit: true,
      url: 'data:text/javascript,' + encodeURIComponent(code),
    };
  }

  // Intercept the jules-api dependency
  if (specifier.includes('../state/jules-api.js') && context.parentURL && context.parentURL.includes('dashboard-controller')) {
    const code = `
export async function getAllActivities() { return []; }
export async function sendMessage(id, msg) {
    if (globalThis.onSendMessage) globalThis.onSendMessage(id, msg);
}
export async function listSources() { return []; }
export async function listAllSessions() { return []; }
export async function approvePlan(id) {
    if (globalThis.onApprovePlan) globalThis.onApprovePlan(id);
}
    `;
    return {
      format: 'module',
      shortCircuit: true,
      url: 'data:text/javascript,' + encodeURIComponent(code),
    };
  }

  // Intercept the julesorchestrator dependency
  if (specifier.includes('../jules_lead_orchestrator/julesorchestrator.js') && context.parentURL && context.parentURL.includes('dashboard-controller')) {
    const code = `
export async function dispatchLeadOrchestrator(msg, count, desc) {
  if (globalThis.onDispatchLeadOrchestrator) {
      return globalThis.onDispatchLeadOrchestrator(msg, count, desc);
  }
  return { sessionId: 'mock-session' };
}
    `;
    return {
      format: 'module',
      shortCircuit: true,
      url: 'data:text/javascript,' + encodeURIComponent(code),
    };
  }

  return nextResolve(specifier, context);
}
