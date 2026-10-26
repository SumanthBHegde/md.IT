import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, Input, MenuButton, SaveStatus, SegmentedControl, TreeItem, VersionItem, Wordmark } from './index';

describe('ui', () => {
  it('Wordmark is labelled md.IT', () => {
    render(<Wordmark />);
    expect(screen.getByLabelText('md.IT')).toBeInTheDocument();
  });

  it('SegmentedControl marks the current option and reports changes', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="View"
        value="split"
        onChange={onChange}
        options={[
          { value: 'split', label: 'Split', icon: 'columns' },
          { value: 'preview', label: 'Preview', icon: 'eye' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Split' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Preview' }));
    expect(onChange).toHaveBeenCalledWith('preview');
  });

  it('MenuButton opens, runs an item, and closes', async () => {
    const onSelect = vi.fn();
    render(<MenuButton label="Actions for Notes" items={[{ label: 'Rename', onSelect }, 'separator', { label: 'Delete', danger: true }]} />);
    const trigger = screen.getByRole('button', { name: 'Actions for Notes' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('MenuButton closes on Escape and on an outside click', async () => {
    render(
      <div>
        <p>outside</p>
        <MenuButton label="More" items={[{ label: 'Rename' }]} />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('MenuButton item clicks do not reach ancestors', async () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <MenuButton label="More" items={[{ label: 'Rename' }]} />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('Dialog is labelled by its title, focuses its first field, and closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Rename project" onClose={onClose}>
        <Input label="Name" defaultValue="OS" />
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Rename project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Input shows an error as an alert and marks the field invalid', () => {
    render(<Input label="Name" error="Name can’t be empty." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Name can’t be empty.');
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('TreeItem is focusable, named, and activates with Enter', () => {
    const onClick = vi.fn();
    render(<TreeItem kind="file" name="Threads.md" onClick={onClick} />);
    const item = screen.getByRole('treeitem', { name: 'Threads.md' });
    expect(item).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('SaveStatus names where work is saved', () => {
    render(<SaveStatus state="saved" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved locally');
  });

  it('VersionItem is a button showing the number, message, time and Current', async () => {
    const onClick = vi.fn();
    render(<VersionItem number={3} message="Tidy" time="2 hours ago" current onClick={onClick} />);
    const item = screen.getByRole('button', { name: /v3/ });
    expect(item).toHaveTextContent('v3');
    expect(item).toHaveTextContent('Tidy');
    expect(item).toHaveTextContent('2 hours ago');
    expect(item).toHaveTextContent('Current');
    await userEvent.click(item);
    expect(onClick).toHaveBeenCalled();
  });

  it('VersionItem without a message says so', () => {
    render(<VersionItem number={1} message={null} time="now" />);
    expect(screen.getByRole('button')).toHaveTextContent('No message');
    expect(screen.getByRole('button')).not.toHaveTextContent('Current');
  });
});
