'use client';

import { Building2, Globe2, MessageSquare, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExplorerViewMode } from '@/lib/types';

interface ViewModeSelectorProps {
  value: ExplorerViewMode;
  onChange: (value: ExplorerViewMode) => void;
}

const VIEW_OPTIONS: Array<{
  value: ExplorerViewMode;
  label: string;
  icon: typeof Network;
}> = [
  { value: 'technology', label: 'Technology', icon: Network },
  { value: 'company', label: 'Company', icon: Building2 },
  { value: 'world', label: 'World', icon: Globe2 },
  { value: 'chat', label: 'ChatView', icon: MessageSquare },
];

export function ViewModeSelector({ value, onChange }: ViewModeSelectorProps) {
  return (
    <div
      className="inline-flex rounded-lg border border-gray-200 bg-white/95 p-1 shadow-sm"
      role="group"
      aria-label="Explorer view"
    >
      {VIEW_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = value === option.value;

        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={isActive ? 'default' : 'ghost'}
            className="gap-2"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
