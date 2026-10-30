import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyParts, withShortcut } from './shortcuts';

afterEach(() => vi.unstubAllGlobals());

const onPlatform = (platform: string) => vi.stubGlobal('navigator', { platform });

describe('shortcuts', () => {
  it('names keys for Windows and Linux', () => {
    onPlatform('Win32');
    expect(keyParts('Mod-Shift-x')).toEqual(['Ctrl', 'Shift', 'X']);
    expect(keyParts('Mod-Alt-1')).toEqual(['Ctrl', 'Alt', '1']);
  });

  it('names keys for a Mac', () => {
    onPlatform('MacIntel');
    expect(keyParts('Mod-b')).toEqual(['⌘', 'B']);
    expect(keyParts('Mod-Alt-1')).toEqual(['⌘', '⌥', '1']);
  });

  it('adds the shortcut to a tooltip only when there is one', () => {
    onPlatform('Win32');
    expect(withShortcut('Bold', 'bold')).toBe('Bold (Ctrl+B)');
    expect(withShortcut('Table', 'table')).toBe('Table');
  });
});
