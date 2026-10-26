import type { ReactNode } from 'react';
import { OutlinePanel, StatsPanel } from '../outline';
import type { Analysis } from '../renderer';
import { SettingsPanel, type RenderingSettings } from '../settings';
import { SegmentedControl, type SegmentedOption } from '../ui';

export type PanelTab = 'outline' | 'stats' | 'settings' | 'history';

const TABS: ReadonlyArray<SegmentedOption<PanelTab>> = [
  { value: 'outline', label: 'Outline' },
  { value: 'stats', label: 'Stats' },
  { value: 'settings', label: 'Settings' },
  { value: 'history', label: 'History' },
];

export interface SidePanelProps {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  /** null when no document is ready, or the tab doesn't need it. */
  analysis: Analysis | null;
  onHeading: (line: number) => void;
  rendering: RenderingSettings;
  onRenderingChange: (patch: Partial<RenderingSettings>) => void;
  onRenderingReset: () => void;
  /** The History tab's content (P-081). */
  history: ReactNode;
}

export function SidePanel({ tab, onTab, analysis, onHeading, rendering, onRenderingChange, onRenderingReset, history }: SidePanelProps) {
  const current: PanelTab = TABS.some((option) => option.value === tab) ? tab : 'outline';
  return (
    <aside className="ws-panel" aria-label="Document panel">
      <div className="ws-panel-head">
        <SegmentedControl label="Panel" value={current} onChange={onTab} options={TABS} />
      </div>
      <div className="ws-panel-body">
        {current === 'outline' && <OutlinePanel headings={analysis?.headings ?? null} onSelect={onHeading} />}
        {current === 'stats' && <StatsPanel stats={analysis?.stats ?? null} />}
        {current === 'settings' && <SettingsPanel value={rendering} onChange={onRenderingChange} onReset={onRenderingReset} />}
        {current === 'history' && history}
      </div>
    </aside>
  );
}
