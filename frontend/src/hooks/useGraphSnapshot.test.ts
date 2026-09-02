/** @jest-environment jsdom */
import { renderHook, waitFor, act } from '@testing-library/react';
import { useGraphSnapshot } from './useGraphSnapshot';
import { resolveAddressClassifications } from '@/hooks/useAddressClassifications';
import type { Investigation } from '@/types/investigation';

// This test is about ONE thing: that useGraphSnapshot threads a
// classification lookup into the off-screen GraphCanvas it mounts, so an
// exported exhibit image agrees with the live graph (see cytoscapeSync.ts).
// `resolveAddressClassifications` itself — the lookup/drain sequence — is
// exercised in useAddressClassifications.test.ts; mocking it here decouples
// this test from that network round trip, and from the real GraphCanvas's
// rAF-driven "wait for the canvas to be ready" poll, which this test has no
// need to drive to completion.
jest.mock('@/hooks/useAddressClassifications', () => ({
  resolveAddressClassifications: jest.fn(),
}));

/** Captured on every render of the mocked GraphCanvas below. */
let lastProps: Record<string, unknown> | null = null;

jest.mock('@/components/Graph/GraphCanvas', () => {
  const ReactLib = require('react');
  const GraphCanvas = ReactLib.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    lastProps = props;
    ReactLib.useImperativeHandle(ref, () => ({
      unselectAll: () => {},
      exportImage: async () => {},
      exportPngDataUrl: async () => 'data:image/png;base64,stub',
      setEdgeArc: () => {},
      requestEditLabel: () => {},
    }));
    return ReactLib.createElement('canvas', { width: 10, height: 10 });
  });
  return { GraphCanvas };
});

function investigation(): Investigation {
  return {
    id: 'i1',
    name: 'I',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
    traces: [
      {
        id: 't1',
        name: 't1',
        criteria: { type: 'custom' },
        visible: true,
        collapsed: false,
        nodes: [
          {
            id: 'n1',
            label: '0xaaa',
            address: '0xaaa',
            chain: 'ethereum',
            notes: '',
            tags: [],
            position: { x: 0, y: 0 },
            parentTrace: 't1',
          },
        ],
        edges: [],
      },
    ],
  } as unknown as Investigation;
}

beforeEach(() => {
  jest.clearAllMocks();
  lastProps = null;
});

it('threads a classification lookup into the off-screen GraphCanvas so exports match the live graph', async () => {
  const stubLookup = jest.fn().mockReturnValue({ addressType: 'contract', tokenStandard: 'erc20' });
  (resolveAddressClassifications as jest.Mock).mockResolvedValue(stubLookup);

  const { result } = renderHook(() => useGraphSnapshot());

  // Fire-and-forget: this test only cares that the mount receives the
  // resolved lookup, not that the (rAF-polled, jsdom-flaky) capture-to-PNG
  // pipeline runs to completion.
  act(() => {
    void result.current.snapshot(investigation(), 'dark');
  });

  await waitFor(() => expect(lastProps).not.toBeNull());
  expect(resolveAddressClassifications).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'i1' }),
  );
  expect(lastProps!.lookupClassification).toBe(stubLookup);

  act(() => {
    result.current.dispose();
  });
});
