import type { Core } from 'cytoscape';

/**
 * Minimal fake of Cytoscape's Core + collection + element APIs, modelling
 * only the surface that `syncCytoscape` actually touches:
 *
 *   cy.elements() → collection.remove()
 *   cy.nodes()    → collection.forEach
 *   cy.edges()    → collection.forEach
 *   cy.getElementById(id) → element with .length / .data() / .position / .move / .remove
 *   cy.add({ group, data, position? }) → registers element + records call
 *
 * On returned elements:
 *   .data()                → returns full data record
 *   .data(key)             → returns single value
 *   .data(key, val)        → mutates data (used to update fields)
 *   .position(pos?)        → get/set position
 *   .move({ parent })      → reparent (recorded for assertions)
 *   .remove()              → drop from internal map (and cascade connected
 *                            edges to mirror Cytoscape's auto-cascade)
 */

export interface FakeElement {
  id: string;
  group: 'nodes' | 'edges';
  length: 1;
  data: jest.Mock;
  position: jest.Mock;
  move: jest.Mock;
  remove: jest.Mock;
  removeData: jest.Mock;
  __data: Record<string, any>;
  __position?: { x: number; y: number };
  __removed: boolean;
  __moveCalls: Array<{ parent: string | null }>;
}

export interface FakeCollection {
  length: number;
  forEach: (fn: (el: FakeElement) => void) => void;
  filter: (fn: (el: FakeElement) => boolean) => FakeCollection;
  remove: jest.Mock;
}

export type FakeCy = Core & {
  __elements: Map<string, FakeElement>;
  __addCalls: Array<{ group: 'nodes' | 'edges'; data: any; position?: any }>;
  add: jest.Mock;
  getElementById: jest.Mock;
  nodes: jest.Mock;
  edges: jest.Mock;
  elements: jest.Mock;
};

function makeCollection(items: FakeElement[]): FakeCollection {
  const live = items.filter((e) => !e.__removed);
  return {
    length: live.length,
    forEach: (fn) => live.forEach(fn),
    filter: (fn) => makeCollection(live.filter(fn)),
    remove: jest.fn(() => {
      live.forEach((el) => el.remove());
    }),
  };
}

function makeFakeElement(
  id: string,
  group: 'nodes' | 'edges',
  data: Record<string, any>,
  position: { x: number; y: number } | undefined,
  registry: Map<string, FakeElement>,
): FakeElement {
  const el: FakeElement = {
    id,
    group,
    length: 1,
    __data: { ...data },
    __position: position ? { ...position } : undefined,
    __removed: false,
    __moveCalls: [],
    data: jest.fn(),
    position: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
    removeData: jest.fn(),
  };

  el.data.mockImplementation((key?: string, val?: any) => {
    if (key === undefined) return el.__data;
    if (val === undefined) return el.__data[key];
    el.__data[key] = val;
    return el;
  });

  el.position.mockImplementation((pos?: { x: number; y: number }) => {
    if (pos === undefined) return el.__position;
    el.__position = { ...pos };
    return el;
  });

  el.move.mockImplementation((opts: { parent?: string | null }) => {
    el.__moveCalls.push({ parent: opts.parent ?? null });
    if (opts.parent !== undefined) el.__data.parent = opts.parent;
    return el;
  });

  el.remove.mockImplementation(() => {
    if (el.__removed) return el;
    el.__removed = true;
    // Cascade-remove edges connected to a removed node, mirroring Cytoscape.
    if (el.group === 'nodes') {
      registry.forEach((other) => {
        if (other.group === 'edges' && !other.__removed) {
          if (other.__data.source === el.id || other.__data.target === el.id) {
            other.__removed = true;
          }
        }
      });
    }
    return el;
  });

  el.removeData.mockImplementation((key: string) => {
    delete el.__data[key];
    return el;
  });

  return el;
}

export function makeFakeCy(): FakeCy {
  const elements = new Map<string, FakeElement>();
  const addCalls: Array<{ group: 'nodes' | 'edges'; data: any; position?: any }> = [];

  const add = jest.fn((spec: { group: 'nodes' | 'edges'; data: any; position?: any }) => {
    addCalls.push({ group: spec.group, data: spec.data, position: spec.position });
    const el = makeFakeElement(spec.data.id, spec.group, spec.data, spec.position, elements);
    elements.set(spec.data.id, el);
    return el;
  });

  const getElementById = jest.fn((id: string) => {
    const el = elements.get(id);
    if (el && !el.__removed) return el;
    return { length: 0 };
  });

  const allLive = () => [...elements.values()].filter((e) => !e.__removed);

  const cy = {
    __elements: elements,
    __addCalls: addCalls,
    add,
    getElementById,
    nodes: jest.fn(() => makeCollection(allLive().filter((e) => e.group === 'nodes'))),
    edges: jest.fn(() => makeCollection(allLive().filter((e) => e.group === 'edges'))),
    elements: jest.fn(() => makeCollection(allLive())),
  };

  return cy as unknown as FakeCy;
}
