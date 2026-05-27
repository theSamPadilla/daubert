/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInvestigationLoader } from './useInvestigationLoader';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getInvestigation: jest.fn(),
    listScriptRuns: jest.fn().mockResolvedValue([]),
    updateTrace: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/contexts/CaseContext', () => ({
  useCaseContext: () => ({ setOnGraphUpdated: jest.fn() }),
}));

jest.mock('@/utils/normalizeInvestigation', () => ({
  normalizeInvestigation: (x: any) => x,
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('debounces auto-save: N investigation mutations within 1s = exactly one updateTrace per trace', async () => {
  const trace1 = { id: 't1', name: 'A', color: '#fff', visible: true, collapsed: false, criteria: {type:'custom'}, nodes:[], edges:[], groups:[], edgeBundles:[], position:{x:0,y:0} };
  const investigation = { id: 'i1', name: 'I', traces: [trace1] };

  // Resolve getInvestigation immediately so loading=false before we test debounce
  (apiClient.getInvestigation as jest.Mock).mockResolvedValue(investigation);

  let inv: any = investigation;
  const setInvestigation = (next: any) => { inv = next; };

  const { rerender, result } = renderHook(({ i }) =>
    useInvestigationLoader({
      activeInvestigationId: 'i1',
      investigation: i,
      setInvestigation,
    }),
    { initialProps: { i: investigation as any } }
  );

  // Wait for initial load to complete (loading → false)
  await waitFor(() => expect(result.current.loading).toBe(false));

  // Three rapid mutations
  rerender({ i: { ...inv, traces: [{ ...trace1, name: 'B' }] } });
  rerender({ i: { ...inv, traces: [{ ...trace1, name: 'C' }] } });
  rerender({ i: { ...inv, traces: [{ ...trace1, name: 'D' }] } });

  // Before debounce fires
  expect(apiClient.updateTrace).not.toHaveBeenCalled();

  // Advance past debounce
  await act(async () => { jest.advanceTimersByTime(1100); });
  await waitFor(() => expect(apiClient.updateTrace).toHaveBeenCalledTimes(1));
});

it('reloads when activeInvestigationId changes', async () => {
  (apiClient.getInvestigation as jest.Mock).mockResolvedValue({ id: 'i1', name: 'A', traces: [] });
  const setInvestigation = jest.fn();
  const { rerender } = renderHook(({ id }) =>
    useInvestigationLoader({ activeInvestigationId: id, investigation: null, setInvestigation }),
    { initialProps: { id: null as string | null } }
  );
  rerender({ id: 'i1' });
  await waitFor(() => expect(apiClient.getInvestigation).toHaveBeenCalledWith('i1'));
});

it('does NOT re-fire load when onBeforeLoad identity changes (ref pattern)', async () => {
  (apiClient.getInvestigation as jest.Mock).mockResolvedValue({ id: 'i1', traces: [] });
  const setInvestigation = jest.fn();
  const { rerender } = renderHook(({ cb }) =>
    useInvestigationLoader({
      activeInvestigationId: 'i1',
      investigation: null,
      setInvestigation,
      onBeforeLoad: cb,
    }),
    { initialProps: { cb: () => {} } }
  );
  // Force five re-renders with fresh callback identities
  for (let i = 0; i < 5; i++) rerender({ cb: () => {} });
  await waitFor(() => expect(apiClient.getInvestigation).toHaveBeenCalledTimes(1));
});
