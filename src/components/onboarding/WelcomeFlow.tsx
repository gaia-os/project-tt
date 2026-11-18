'use client';

import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { labelForTopic, TopicKey, TopicSummary } from '@/lib/topicConfig';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { SectorStep } from './SectorStep';
import { TechnologyStep } from './TechnologyStep';

export type WelcomeStep = 'sector' | 'technology';

interface WelcomeFlowProps {
  initialStep: WelcomeStep;
  initialTopic: TopicKey;
  topics: TopicSummary[];
  lastTechnologyId: string | null;
  /** Closing without a choice (skip link, Esc). */
  onSkip: () => void;
  onChooseTechnology: (topic: TopicKey, technologyId: string) => void;
}

/**
 * First-run foyer: one full-viewport composition over the live tree.
 * Sector → technology stays in the same frame so the path feels continuous.
 */
export function WelcomeFlow({
  initialStep,
  initialTopic,
  topics,
  lastTechnologyId,
  onSkip,
  onChooseTechnology,
}: WelcomeFlowProps) {
  const [step, setStep] = useState<WelcomeStep>(initialStep);
  const [sector, setSector] = useState<TopicKey>(initialTopic);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onSkip();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="welcome-veil z-[80] bg-transparent" />
        <DialogPrimitive.Content className="fixed inset-0 z-[90] overflow-hidden focus:outline-none">
          <div className="welcome-ambient" aria-hidden />
          <div className="relative flex h-full w-full">
            {/* Quiet atmospheric side — the map shows through the veil. */}
            <div className="pointer-events-none absolute inset-0 md:left-[min(42rem,52%)]" />

            <div className="relative flex h-full w-full max-w-xl flex-col justify-between px-6 py-7 sm:px-10 sm:py-10 md:max-w-[34rem] lg:px-14">
              {step === 'sector' ? (
                <SectorStep
                  topics={topics}
                  currentTopic={sector}
                  onSkip={onSkip}
                  onSelectSector={(topic) => {
                    setSector(topic);
                    setStep('technology');
                  }}
                />
              ) : (
                <TechnologyStep
                  key={sector}
                  topic={sector}
                  sectorLabel={labelForTopic(topics, sector)}
                  lastTechnologyId={lastTechnologyId}
                  onBack={() => setStep('sector')}
                  onSkip={onSkip}
                  onSelectTechnology={(technologyId) =>
                    onChooseTechnology(sector, technologyId)
                  }
                />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
