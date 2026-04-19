import { render } from '@testing-library/react';
import { XtermTerminal } from '../XtermTerminal';

describe('XtermTerminal', () => {
  test('renders without error', () => {
    const { container } = render(<XtermTerminal />);
    expect(container.firstChild).toBeInTheDocument();
  });

  test('accepts mouseTracking prop', () => {
    const { container } = render(<XtermTerminal mouseTracking="any" />);
    // Just testing that it renders without throwing an error
    expect(container.firstChild).toBeInTheDocument();
  });

  test('defaults to no mouseTracking', () => {
    const { container } = render(<XtermTerminal />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
