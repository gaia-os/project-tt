'use client';

import { useMemo } from 'react';
import { TechTree } from '@/lib/types';
import {
  PATHWAY_MAX_NODES,
  Pathway,
  PathwayStep,
  buildPathway,
  buildPathwaySteps,
  pathwaySubtree,
} from '@/lib/pathway';

interface UsePathwayModeOptions {
  /** Tree to trace on; SMR callers pass it relevance-filtered. */
  sourceTree: TechTree | null;
  targetId: string | null | undefined;
  step: number;
}

export interface PathwayModeState {
  pathway: Pathway;
  /** Graph to lay out, or null when there are no prerequisites to show. */
  pathwayTree: TechTree | null;
  steps: PathwayStep[];
  stepIndex: number;
  currentStep: PathwayStep;
}

/** Guided pathway derived from URL state; null when no pathway is active. */
export function usePathwayMode({
  sourceTree,
  targetId,
  step,
}: UsePathwayModeOptions): PathwayModeState | null {
  const pathway = useMemo(
    () =>
      sourceTree && targetId
        ? buildPathway(sourceTree, targetId, { maxNodes: PATHWAY_MAX_NODES })
        : null,
    [sourceTree, targetId],
  );
  const pathwayTree = useMemo(
    () =>
      sourceTree && pathway && pathway.prerequisiteCount > 0
        ? pathwaySubtree(sourceTree, pathway)
        : null,
    [sourceTree, pathway],
  );
  const steps = useMemo(
    () => (pathway ? buildPathwaySteps(pathway) : []),
    [pathway],
  );

  const stepIndex = Math.min(Math.max(step, 0), Math.max(steps.length - 1, 0));
  const currentStep = steps[stepIndex];

  return useMemo(
    () =>
      pathway && currentStep
        ? { pathway, pathwayTree, steps, stepIndex, currentStep }
        : null,
    [pathway, pathwayTree, steps, stepIndex, currentStep],
  );
}
