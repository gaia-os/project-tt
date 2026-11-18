import { cn } from '@/lib/utils';

export interface TrlBand {
  label: string;
  fillClass: string;
  textClass: string;
}

export function trlBand(trl: number): TrlBand {
  if (trl <= 3) {
    return { label: 'Research', fillClass: 'bg-amber-500', textClass: 'text-amber-700' };
  }
  if (trl <= 6) {
    return { label: 'Development', fillClass: 'bg-blue-500', textClass: 'text-blue-700' };
  }
  return { label: 'Deployment', fillClass: 'bg-emerald-500', textClass: 'text-emerald-700' };
}

interface TrlMeterProps {
  trl: number | null;
  /** Raw value such as "4-5", shown instead of the parsed integer. */
  trlLabel?: string | null;
  className?: string;
}

/** Nine-segment Technology Readiness Level bar. */
export function TrlMeter({ trl, trlLabel, className }: TrlMeterProps) {
  if (trl === null) {
    return (
      <p className={cn('text-xs text-gray-500', className)}>
        Readiness not rated
      </p>
    );
  }

  const band = trlBand(trl);
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-gray-800">
          TRL {trlLabel ?? trl}
        </span>
        <span className={band.textClass}>{band.label}</span>
      </div>
      <div
        className="flex gap-0.5"
        role="meter"
        aria-label="Technology readiness level"
        aria-valuemin={1}
        aria-valuemax={9}
        aria-valuenow={trl}
      >
        {Array.from({ length: 9 }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              index < trl ? band.fillClass : 'bg-gray-200',
            )}
          />
        ))}
      </div>
    </div>
  );
}
