'use client';

import { LABEL_COLORS, NODE_LABELS } from '@/lib/types';
import { nodeRoleLabel } from '@/lib/nodeRoles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface LegendProps {
  /** Explain aggregate nodes and folded branches while either is shown. */
  showAggregates?: boolean;
}

export const Legend = ({ showAggregates = false }: LegendProps) => {
  return (
    <Card
      className="w-fit"
      style={{ backgroundColor: 'rgba(255, 255, 255, 0.8)' }}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold">Legend</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {NODE_LABELS.filter((label) => label !== 'Milestone').map((label) => (
          <div key={label} className="flex items-center space-x-2">
            <span className={`w-4 h-4 rounded bg-${LABEL_COLORS[label]}`}></span>
            <span className="text-sm">{nodeRoleLabel(label)}</span>
          </div>
        ))}
        {showAggregates && (
          <>
            <div className="flex items-center space-x-2 pt-1 border-t border-gray-200 mt-1">
              <span
                className="w-4 h-4 rounded border border-gray-500 bg-white"
                style={{
                  boxShadow:
                    '2px 2px 0 -1px #fff, 2px 2px 0 0 #6b7280, 4px 4px 0 -1px #fff, 4px 4px 0 0 #6b7280',
                }}
              ></span>
              <span className="text-sm">Aggregate · click to unfold</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gray-900 px-1 text-[9px] font-semibold text-white">
                +3
              </span>
              <span className="text-sm">Folded prerequisites</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
