import { Badge } from './Badge';
import { cx } from './cx';

export interface VersionItemProps {
  number: number;
  message?: string | null;
  time: string;
  current?: boolean;
  onClick?: () => void;
}

/** One saved version in a history list. Ported as a real button (P-083; the bundle renders a focusable div). */
export function VersionItem({ number, message, time, current, onClick }: VersionItemProps) {
  return (
    <button type="button" className={cx('md-version', current && 'is-current')} onClick={onClick}>
      <span className="md-version-num">v{number}</span>
      <span className="md-version-body">
        <span className="md-version-msg">{message || <em>No message</em>}</span>
        <span className="md-version-meta">{time}</span>
      </span>
      {current && <Badge tone="accent">Current</Badge>}
    </button>
  );
}
