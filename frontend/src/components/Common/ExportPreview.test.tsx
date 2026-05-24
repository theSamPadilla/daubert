/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import { ExportPreview } from './ExportPreview';

describe('ExportPreview', () => {
  it('caches per-theme — generate is invoked once per theme even when re-rendered with same theme', async () => {
    const generate = jest.fn().mockResolvedValue('data:image/png;base64,xxx');
    const { rerender } = render(<ExportPreview theme="dark" generate={generate} />);
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    rerender(<ExportPreview theme="dark" generate={generate} />);
    await waitFor(() => screen.getByAltText('Export preview'));
    expect(generate).toHaveBeenCalledTimes(1); // cache hit, no re-call
  });
});
