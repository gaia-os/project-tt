import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { TOPICS, TopicKey } from '@/lib/topicConfig';
import { TechTree } from '@/lib/types';
import { SimulationMode, MODE_LABELS, McsData, DistributionData } from './simulations/mcsTypes';
import { DeterministicView } from './simulations/DeterministicView';
import { McsView } from './simulations/McsView';

interface SimulationData {
  impactData: Record<string, Record<string, number>>;
  statusData: Record<string, Record<string, string>>;
}

// Topics without an entry have no precomputed simulation outputs.
const TREE_FOLDER: Partial<Record<TopicKey, string>> = {
  nuclear: 'nuclear_tt',
  fossil_fuels: 'fossil_fuel_tt_v2',
};

const YEAR_OPTIONS = ['5', '10', '15', '20', '25', '30'];

const MODE_DESCRIPTIONS: Record<SimulationMode, string> = {
  deterministic: '',
  option1: 'Models sector-wide acceleration or slowdown by adjusting how quickly technologies move between TRL levels.',
  option2: 'Models localised technical bottlenecks — each technology could faces its own independent delays.',
  option3: 'Combined view — models both overall industry trends and individual technology risks simultaneously.',
};

interface Props {
  topic: TopicKey;
  techTree: TechTree | null;
  onNodeSelect?: (nodeId: string) => void;
}

const Simulations: React.FC<Props> = ({ topic, techTree, onNodeSelect }) => {
  const [mode, setMode] = useState<SimulationMode>('deterministic');

  // ── Deterministic ────────────────────────────────────────────────────────
  const [selectedYears, setSelectedYears] = useState('30');
  const [detData, setDetData] = useState<SimulationData | null>(null);
  const [detLoading, setDetLoading] = useState(true);
  const [detError, setDetError] = useState<string | null>(null);

  const hasSimulations = !!TREE_FOLDER[topic];

  useEffect(() => {
    if (mode !== 'deterministic' || !hasSimulations) return;
    setDetLoading(true);
    setDetError(null);
    fetch(`/investment-tech-tree/api/simulation?years=${selectedYears}&topic=${topic}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to fetch simulation data');
        return r.json();
      })
      .then(setDetData)
      .catch((e) => setDetError(e.message))
      .finally(() => setDetLoading(false));
  }, [selectedYears, topic, mode, hasSimulations]);

  // ── MCS ──────────────────────────────────────────────────────────────────
  const [mcsData, setMcsData] = useState<McsData | null>(null);
  const [mcsLoading, setMcsLoading] = useState(false);
  const [mcsError, setMcsError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'deterministic' || !hasSimulations) return;
    const base = `/investment-tech-tree/outputs/${TREE_FOLDER[topic]}`;

    setMcsLoading(true);
    setMcsError(null);
    setMcsData(null);

    (async () => {
      try {
        const [statsRes, distRes, riskRes] = await Promise.all([
          fetch(`${base}/stats_${mode}.json`),
          fetch(`${base}/distributions_${mode}.json`),
          fetch(`${base}/risk_assessment_${mode}.json`),
        ]);

        if (!statsRes.ok || !distRes.ok || !riskRes.ok)
          throw new Error(
            'One or more MCS files could not be loaded. ' +
              'Make sure the JSON files are in public/outputs/.',
          );

        const [stats, distributions, risk] = await Promise.all([
          statsRes.json(),
          distRes.json() as Promise<DistributionData>,
          riskRes.json(),
        ]);

        let sensitivity = null;
        if (mode === 'option3') {
          const sensRes = await fetch(`${base}/sensitivity.json`);
          if (sensRes.ok) sensitivity = await sensRes.json();
        }

        setMcsData({ stats, distributions, risk, sensitivity });
      } catch (e) {
        console.error('[MCS fetch] ERROR:', e);
        setMcsError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setMcsLoading(false);
      }
    })();
  }, [mode, topic, hasSimulations]);

  if (!hasSimulations) {
    return (
      <div className="p-6 bg-white">
        <h2 className="text-2xl font-bold text-gray-800 mb-3">Investment Simulation Results</h2>
        <p className="text-sm text-gray-500">
          Simulations are not yet available for {TOPICS[topic].label}.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white">
      <h2 className="text-2xl font-bold text-gray-800 mb-5">Investment Simulation Results</h2>

      {/* Mode selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Simulation Model:
        </label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as SimulationMode)}
          className="block w-80 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
          {(Object.keys(MODE_LABELS) as SimulationMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
        {mode !== 'deterministic' && (
          <p className="mt-2 text-sm text-gray-500">{MODE_DESCRIPTIONS[mode]}</p>
        )}
      </div>

      {/* Deterministic view */}
      {mode === 'deterministic' && (
        <DeterministicView
          selectedYears={selectedYears}
          onYearsChange={setSelectedYears}
          isLoading={detLoading}
          error={detError}
          data={detData}
          topic={topic}
          yearOptions={YEAR_OPTIONS}
          techTree={techTree}
          onNodeSelect={onNodeSelect}
        />
      )}

      {/* MCS view */}
      {mode !== 'deterministic' && (
        <>
          {mcsError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-red-800 font-semibold">Could not load MCS data</p>
              <p className="text-red-600 text-sm mt-1">{mcsError}</p>
            </div>
          )}
          {mcsLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <span className="ml-3 text-gray-600">Loading Monte Carlo results…</span>
            </div>
          )}
          {!mcsLoading && mcsData && (
            <McsView
              data={mcsData}
              mode={mode}
              techTree={techTree}
              onNodeSelect={onNodeSelect}
            />
          )}
        </>
      )}
    </div>
  );
};

export default Simulations;