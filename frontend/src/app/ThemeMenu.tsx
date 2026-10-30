import { SETTINGS, useSettingState } from '../store';
import { MenuButton, type MenuItem } from '../ui';
import { useResolvedTheme, type ThemeChoice } from './theme';

export function ThemeMenu() {
  const [theme, setTheme] = useSettingState<ThemeChoice>(SETTINGS.theme, 'system');
  const shown = useResolvedTheme();
  const item = (value: ThemeChoice, label: string): MenuItem => ({
    label,
    icon: theme === value ? 'check' : undefined,
    onSelect: () => setTheme(value),
  });
  return (
    <MenuButton
      icon={shown === 'dark' ? 'moon' : 'sun'}
      label="Theme"
      items={[item('system', 'Match system theme'), item('light', 'Light theme'), item('dark', 'Dark theme')]}
    />
  );
}
