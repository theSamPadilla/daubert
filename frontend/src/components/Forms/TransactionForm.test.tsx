/**
 * @jest-environment jsdom
 *
 * Tests for the trace-fallback on submit: when an investigation has no traces
 * left (the user deleted all of them), saving a transaction has to create one
 * first rather than silently dropping the edge.
 *
 * What we care about:
 * - No traces: submitting calls onCreateTrace, then onSave with the returned
 *   trace id — never with ''.
 * - No traces, onCreateTrace resolves undefined: onSave is not called and an
 *   error message renders instead.
 * - No traces, onCreateTrace rejects: onSave is not called, an error message
 *   renders, and the form is left usable (submit button not stuck disabled) —
 *   the actual regression guard for the bug where a rejection left `saving`
 *   stuck at true forever.
 * - A trace already exists: onCreateTrace is not called and the existing
 *   trace id is passed through unchanged (regression guard on the normal path).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { TransactionForm } from './TransactionForm';
import type { Trace } from '../../types/investigation';

function makeTrace(id: string): Trace {
  return {
    id,
    name: id,
    criteria: { type: 'custom' },
    visible: true,
    nodes: [],
    edges: [],
    collapsed: false,
    position: { x: 0, y: 0 },
  };
}

const prefill = { from: '0xFromAddress', to: '0xToAddress', amount: '1' };

it('creates a trace before saving when none exist, and never saves with an empty trace id', async () => {
  const onCreateTrace = jest.fn().mockResolvedValue('new-trace-1');
  const onSave = jest.fn();

  const { container } = render(
    <TransactionForm
      traces={[]}
      allWallets={[]}
      onSave={onSave}
      onCancel={jest.fn()}
      onCreateTrace={onCreateTrace}
      prefill={prefill}
    />
  );

  expect(screen.getByText('No traces yet. One will be created when you save.')).toBeTruthy();

  fireEvent.submit(container.querySelector('form')!);

  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onCreateTrace).toHaveBeenCalledTimes(1);

  const [traceIdArg, dataArg] = onSave.mock.calls[0];
  expect(traceIdArg).toBe('new-trace-1');
  expect(traceIdArg).not.toBe('');
  expect(dataArg.from).toBe('0xFromAddress');
  expect(dataArg.to).toBe('0xToAddress');
});

it('shows an error and does not save when trace creation fails', async () => {
  const onCreateTrace = jest.fn().mockResolvedValue(undefined);
  const onSave = jest.fn();

  const { container } = render(
    <TransactionForm
      traces={[]}
      allWallets={[]}
      onSave={onSave}
      onCancel={jest.fn()}
      onCreateTrace={onCreateTrace}
      prefill={prefill}
    />
  );

  fireEvent.submit(container.querySelector('form')!);

  expect(
    await screen.findByText('Could not create a trace. Check your connection and try again.')
  ).toBeTruthy();
  expect(onSave).not.toHaveBeenCalled();
});

it('resets saving and leaves the form usable when trace creation rejects', async () => {
  const onCreateTrace = jest.fn().mockRejectedValue(new Error('network'));
  const onSave = jest.fn();

  render(
    <TransactionForm
      traces={[]}
      allWallets={[]}
      onSave={onSave}
      onCancel={jest.fn()}
      onCreateTrace={onCreateTrace}
      prefill={prefill}
    />
  );

  const saveButton = screen.getByRole('button', { name: /save/i });
  fireEvent.submit(saveButton.closest('form')!);

  expect(
    await screen.findByText('Could not create a trace. Check your connection and try again.')
  ).toBeTruthy();
  expect(onSave).not.toHaveBeenCalled();

  await waitFor(() => expect((saveButton as HTMLButtonElement).disabled).toBe(false));
});

it('does not create a trace when one already exists', async () => {
  const trace = makeTrace('trace-1');
  const onCreateTrace = jest.fn();
  const onSave = jest.fn();

  const { container } = render(
    <TransactionForm
      traces={[trace]}
      allWallets={[]}
      onSave={onSave}
      onCancel={jest.fn()}
      onCreateTrace={onCreateTrace}
      prefill={prefill}
    />
  );

  fireEvent.submit(container.querySelector('form')!);

  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onCreateTrace).not.toHaveBeenCalled();
  expect(onSave.mock.calls[0][0]).toBe('trace-1');
});
