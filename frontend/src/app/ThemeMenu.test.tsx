import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDatabase, getSetting, setSetting, SETTINGS } from '../store';
import { ICONS } from '../ui';
import { ThemeMenu } from './ThemeMenu';

beforeEach(clearDatabase);

const iconPath = () => screen.getByRole('button', { name: 'Theme' }).querySelector('path')?.getAttribute('d');

describe('ThemeMenu', () => {
  it('shows a sun in the light theme and a moon in the dark one', async () => {
    render(<ThemeMenu />);
    expect(iconPath()).toBe(ICONS.sun[0]![0]);
    await setSetting(SETTINGS.theme, 'dark');
    await waitFor(() => expect(iconPath()).toBe(ICONS.moon[0]![0]));
  });

  it('offers the three choices and stores the one picked', async () => {
    render(<ThemeMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByRole('menuitem', { name: 'Match system theme' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Light theme' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Dark theme' }));
    await waitFor(async () => expect(await getSetting(SETTINGS.theme, null)).toBe('dark'));
  });
});
