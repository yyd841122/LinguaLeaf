import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ReadingView } from '../src/ReadingView';

it('renders the reading placeholder through the component seam', () => {
  render(<ReadingView />);
  const reading = screen.getByRole('region', { name: '阅读' });
  expect(within(reading).getByRole('heading', { name: '阅读' })).toBeVisible();
  expect(within(reading).getByText('尚未打开书。')).toBeVisible();
});
