import { SIMULATION_BASE_YEAR, nodeDurationYears } from '@/lib/deploymentEstimate';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface Node {
  id: string;
  label: string;
  type: string;
  category?: string;
  subtype?: string;
  trl_current?: string;
  trl_projected_5_10_years?: string;
  description?: string;
  references?: string[];
  // Simulation-specific fields
  initial_time?: number;
  time_remaining?: number;
  prob_of_success?: number;
  is_complete?: boolean;
}

interface Edge {
  id: string;
  source: string;
  target?: string;
  targets?: string[];
}

export interface SimulationTechTree {
  graph: {
    nodes: Node[];
    edges: Edge[];
  };
}

interface SimulationOutput {
  impactData: Record<string, Record<number, number>>;
  statusData: Record<string, Record<number, string>>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CURRENT_YEAR = SIMULATION_BASE_YEAR;
const MWH_TO_TWH = 1_000_000;
const CAPACITY_MW = 1000; // FIXED: Changed from 500 to 1000 to match Python
const CAPACITY_FACTOR = 0.9;
const DISCOUNT_RATE = 0.05;
const YEARS_OF_OPERATION = 60; // FIXED: Added to match Python

// TRL-dependent success probabilities - FIXED: Updated to match Python exactly
const TRL_PROB_MAP: Record<string, number> = {
  '1': 0.10,
  '2': 0.20,
  '2-3': 0.25,
  '3': 0.30,
  '3-4': 0.40,
  '4': 0.50,
  '4-5': 0.60,
  '5': 0.70,
  '5-6': 0.75,
  '6': 0.80,
  '6-7': 0.85,
  '7': 0.90,
  '7-8': 0.95,
  '8': 0.98,
  '9': 1.0,
};

// ============================================================================
// NUCLEAR SCHEDULER SIMULATION
// ============================================================================

class NuclearScheduler {
  private nodes: Map<string, Node>;
  private dependencies: Map<string, string[]>;
  private downstream: Map<string, Set<string>>;

  constructor(techTree: SimulationTechTree) {
    this.nodes = new Map();
    this.dependencies = new Map();
    this.downstream = new Map();

    // Build nodes map
    for (const node of techTree.graph.nodes) {
      this.nodes.set(node.id, node);
      this.dependencies.set(node.id, []);
      this.downstream.set(node.id, new Set());
    }

    // FIXED: Build dependency and downstream graphs - handle 'targets' array
    for (const edge of techTree.graph.edges) {
      const sourceId = edge.source;
      const targets = edge.targets ?? [edge.target];
      
      for (const targetId of targets) {
        if (targetId) {
          const deps = this.dependencies.get(targetId) || [];
          deps.push(sourceId);
          this.dependencies.set(targetId, deps);

          const down = this.downstream.get(sourceId) || new Set();
          down.add(targetId);
          this.downstream.set(sourceId, down);
        }
      }
    }
  }

  private getInitialProb(node: Node): number {
    // FIXED: Match Python's logic exactly
    let trlStr = node.trl_current || 'default';
    
    // Handle special formatting like "5-6 (Tokamaks); 2-3 (Stellarators)"
    if (trlStr.includes(' ')) {
      trlStr = trlStr.split(' ')[0];
    }
    if (trlStr.includes(';')) {
      trlStr = trlStr.split(';')[0].trim();
    }
    
    return TRL_PROB_MAP[trlStr] || 0.6; // Changed default from 0.5 to 0.6
  }

  private getDownstreamConcepts(nodeId: string): Set<string> {
    const concepts = new Set<string>();
    const visited = new Set<string>();
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.nodes.get(current);
      if (node && node.type === 'ReactorConcept') {
        concepts.add(current);
      }

      const downstream = this.downstream.get(current) || new Set();
      for (const child of downstream) {
        if (!visited.has(child)) {
          queue.push(child);
        }
      }
    }

    return concepts;
  }

  private calculateDiscountedMwh(deploymentYear: number): number {
    // FIXED: Match Python's calculation exactly - sum over 60 years of operation
    if (deploymentYear === Infinity) return 0;
    
    const annualMwh = CAPACITY_MW * CAPACITY_FACTOR * 24 * 365;
    let totalDiscountedMwh = 0;
    
    for (let i = 0; i < YEARS_OF_OPERATION; i++) {
      const year = deploymentYear + i;
      if (year > CURRENT_YEAR) {
        const yearsFromNow = year - CURRENT_YEAR;
        const discountFactor = Math.pow(1 + DISCOUNT_RATE, -yearsFromNow);
        totalDiscountedMwh += annualMwh * discountFactor;
      }
    }
    
    return totalDiscountedMwh;
  }

  // FIXED: Single version that returns both time AND cumulative probability
  private calculateNodeTotalTime(
    nodeId: string, 
    simNodes: Map<string, Node>,
    visited = new Set<string>()
  ): { time: number; prob: number } {
    // Prevent infinite recursion
    if (visited.has(nodeId)) {
      return { time: Infinity, prob: 0 };
    }
    
    const node = simNodes.get(nodeId);
    if (!node) return { time: 0, prob: 1.0 };

    visited.add(nodeId);

    const nodeTime = node.time_remaining || 0;
    const nodeProb = node.prob_of_success || 0.5;

    const prereqs = this.dependencies.get(nodeId) || [];
    
    if (prereqs.length === 0) {
      visited.delete(nodeId);
      return { time: nodeTime, prob: nodeProb };
    }

    let maxPrereqTime = 0;
    let combinedPrereqProb = 1.0;
    
    for (const prereqId of prereqs) {
      const result = this.calculateNodeTotalTime(prereqId, simNodes, visited);
      maxPrereqTime = Math.max(maxPrereqTime, result.time);
      combinedPrereqProb *= result.prob;
    }

    visited.delete(nodeId);
    
    return {
      time: nodeTime + maxPrereqTime,
      prob: nodeProb * combinedPrereqProb
    };
  }

  private calculatePathwayMwh(
    simNodes: Map<string, Node>,
    conceptIds: Set<string>
  ): number {
    let totalExpectedMwh = 0;

    for (const conceptId of conceptIds) {
      // FIXED: Use the new method that returns both time and cumulative probability
      const { time: timeToDeployTotal, prob: probOfSuccess } = 
        this.calculateNodeTotalTime(conceptId, simNodes);

      const deploymentYear = CURRENT_YEAR + timeToDeployTotal;
      const potentialMwh = this.calculateDiscountedMwh(deploymentYear);
      totalExpectedMwh += potentialMwh * probOfSuccess;
    }

    return totalExpectedMwh;
  }

  public runSimulation(yearsToSimulate: number = 20): SimulationOutput {
    const simNodes = new Map<string, Node>();
    for (const [id, node] of this.nodes.entries()) {
        simNodes.set(id, { ...node });
    }

    // Initialize simulation parameters
    for (const node of simNodes.values()) {
        const initialTime = nodeDurationYears(node);

        node.initial_time = initialTime > 0 ? initialTime : 0.1;
        node.time_remaining = initialTime;
        node.prob_of_success = this.getInitialProb(node);
        node.is_complete = initialTime <= 0;
    }

    const impactTable: Record<string, Record<number, number>> = {};
    const statusTable: Record<string, Record<number, string>> = {};

    for (const node of this.nodes.values()) {
        if (node.type === 'Milestone' || node.type === 'EnablingTechnology') {
        impactTable[node.label] = {};
        statusTable[node.label] = {};
        }
    }

    console.log('🎯 Starting simulation:', {
        startYear: CURRENT_YEAR,
        endYear: CURRENT_YEAR + yearsToSimulate,
        yearsToSimulate
    });

    // Run year-by-year simulation
    for (let year = CURRENT_YEAR; year < CURRENT_YEAR + yearsToSimulate; year++) {
        // Update node status and progress
        for (const [nodeId, node] of simNodes.entries()) {
        if (node.type !== 'Milestone' && node.type !== 'EnablingTechnology') {
            continue;
        }

        const prereqs = this.dependencies.get(nodeId) || [];
        const isActive = prereqs.every(
            (pid) => simNodes.get(pid)?.is_complete || false
        );

        if (node.is_complete) {
            statusTable[node.label][year] = 'Completed';
            continue;
        }

        if (isActive) {
            statusTable[node.label][year] = 'Active';
            if ((node.time_remaining || 0) > 0) {
            node.time_remaining = (node.time_remaining || 0) - 1;
            const riskReductionPerYear =
                (1 - this.getInitialProb(node)) / (node.initial_time || 1);
            node.prob_of_success = (node.prob_of_success || 0) + riskReductionPerYear;
            }
            if ((node.time_remaining || 0) <= 0) {
            node.is_complete = true;
            node.prob_of_success = 1.0;
            }
        } else {
            statusTable[node.label][year] = 'Pending';
        }
        }

        // FIXED: Calculate impact only for Active nodes (not Completed)
        for (const [nodeId, node] of simNodes.entries()) {
        if (node.type !== 'Milestone' && node.type !== 'EnablingTechnology') {
            continue;
        }
        
        // Only calculate for Active nodes
        if (node.is_complete) continue;
        if (statusTable[node.label][year] !== 'Active') continue;

        const affectedConcepts = this.getDownstreamConcepts(nodeId);
        if (affectedConcepts.size === 0) continue;

        // Calculate baseline MWh with current state
        const baselineMwh = this.calculatePathwayMwh(simNodes, affectedConcepts);

        // Create temporary scenario where this node completes 1 year faster AND risk reduces
        const tempNodes = new Map<string, Node>();
        for (const [id, n] of simNodes.entries()) {
            tempNodes.set(id, { ...n });
        }

        const tempNode = tempNodes.get(nodeId)!;
        
        // Simulate acceleration: reduce time by 1 year AND improve probability
        if ((tempNode.time_remaining || 0) > 0) {
            tempNode.time_remaining = (tempNode.time_remaining || 0) - 1;
            const riskReductionPerYear =
            (1 - this.getInitialProb(tempNode)) / (tempNode.initial_time || 1);
            tempNode.prob_of_success = Math.min(1.0, (tempNode.prob_of_success || 0) + riskReductionPerYear);
        }

        // Calculate accelerated MWh
        const acceleratedMwh = this.calculatePathwayMwh(tempNodes, affectedConcepts);

        // Impact is the difference
        const impactTwh = (acceleratedMwh - baselineMwh) / MWH_TO_TWH;
        
        // Only store significant positive impacts
        if (impactTwh > 0.001) {
            impactTable[node.label][year] = impactTwh;
        }
        }
    }

    // DEBUG: Log final year ranges
    const impactYears = new Set<number>();
    const statusYears = new Set<number>();
    
    Object.values(impactTable).forEach(techData => {
        Object.keys(techData).forEach(year => impactYears.add(parseInt(year)));
    });
    
    Object.values(statusTable).forEach(techData => {
        Object.keys(techData).forEach(year => statusYears.add(parseInt(year)));
    });

    const sortedImpactYears = Array.from(impactYears).sort((a, b) => a - b);
    const sortedStatusYears = Array.from(statusYears).sort((a, b) => a - b);

    console.log('📈 Simulation results:', {
        impactYears: {
        first: sortedImpactYears[0],
        last: sortedImpactYears[sortedImpactYears.length - 1],
        count: sortedImpactYears.length
        },
        statusYears: {
        first: sortedStatusYears[0],
        last: sortedStatusYears[sortedStatusYears.length - 1],
        count: sortedStatusYears.length
        }
    });

    return {
        impactData: impactTable,
        statusData: statusTable,
    };
    }
}

// ============================================================================
// EXPORTED FUNCTION
// ============================================================================

export function runSimulation(techTree: SimulationTechTree, years: number): SimulationOutput {
  const scheduler = new NuclearScheduler(techTree);
  return scheduler.runSimulation(years);
}