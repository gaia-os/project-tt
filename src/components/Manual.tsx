'use client';

import { Compass, Info, LayoutGrid, MousePointerClick } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ManualProps {
  /** Opens the guided technology picker. */
  onChooseTechnology?: () => void;
}

export const Manual = ({ onChooseTechnology }: ManualProps) => {
  return (
    <Card className="m-4 border-gray-200 shadow-none">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-gray-800">
          Getting started
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {onChooseTechnology && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/80 p-4">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <Compass className="h-5 w-5 text-blue-600" aria-hidden />
              Follow a technology
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Pick a deployment concept and walk through the prerequisites,
              milestones and enabling technologies it depends on.
            </p>
            <Button className="mt-3" size="sm" onClick={onChooseTechnology}>
              Choose a technology
            </Button>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-base font-semibold text-gray-800">
            Explore the map
          </h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" aria-hidden />
              <span>
                <strong>Info icon</strong> on a node shows its readiness,
                description and references here.
              </span>
            </li>
            <li className="flex gap-2">
              <LayoutGrid className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" aria-hidden />
              <span>
                <strong>Grid icon</strong> shows only that node and its direct
                connections.
              </span>
            </li>
            <li className="flex gap-2">
              <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" aria-hidden />
              <span>
                <strong>Zoom</strong> with the mouse wheel, <strong>pan</strong>{' '}
                by dragging, and use the fit-view control to see every node.
              </span>
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
