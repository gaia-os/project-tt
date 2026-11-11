'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Info, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import NodeDetails, { NodeDetailsSubView } from './NodeDetails';
import Chat from './Chat';
import Simulations from './Simulations';
import { UiNode, TechTree } from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

interface TabPanelProps {
  selectedNode?: UiNode;
  techTree: TechTree | null;
  isPanelExpanded: boolean;
  onTogglePanel: () => void;
  topic: TopicKey;
  onNodeSelect?: (nodeId: string) => void;
  onShowNodeDetailsRef?: (fn: () => void) => void;
  onShowCompaniesViewRef?: (fn: () => void) => void;
}

type TabType = 'details' | 'chat' | 'simulations';

const TabPanel = ({
  selectedNode,
  techTree,
  isPanelExpanded,
  onTogglePanel,
  topic,
  onNodeSelect,
  onShowNodeDetailsRef,
  onShowCompaniesViewRef,
}: TabPanelProps) => {
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [nodeDetailsSubView, setNodeDetailsSubView] = useState<NodeDetailsSubView>('info');
  const previousNodeIdRef = useRef<string | undefined>(undefined);
  
  // tracks what sub-view should be applied on the next node selection
  const pendingSubViewRef = useRef<NodeDetailsSubView | null>(null);

  // Expose imperative callbacks to TechTree.
  // These set pendingSubViewRef then switch the active tab.
  // When the same node is already selected, TechTree calls both
  // showNodeDetailsTabRef and showCompaniesSubViewRef directly so the
  // sub-view is applied immediately via setNodeDetailsSubView below.
  useEffect(() => {
    if (onShowNodeDetailsRef) {
      onShowNodeDetailsRef(() => {
        pendingSubViewRef.current = 'info';
        setActiveTab('details');
        // Apply immediately in case selectedNode hasn't changed
        setNodeDetailsSubView('info');
      });
    }
  }, [onShowNodeDetailsRef]);

  useEffect(() => {
    if (onShowCompaniesViewRef) {
      onShowCompaniesViewRef(() => {
        pendingSubViewRef.current = 'companies';
        setActiveTab('details');
        // Apply immediately in case selectedNode hasn't changed
        setNodeDetailsSubView('companies');
      });
    }
  }, [onShowCompaniesViewRef]);

  // Auto-switch to details when a node is selected from the chat tab
  useEffect(() => {
    if (
      selectedNode &&
      activeTab === 'chat' &&
      previousNodeIdRef.current !== selectedNode.id
    ) {
      setActiveTab('details');
    }
    previousNodeIdRef.current = selectedNode?.id;
  }, [selectedNode, activeTab]);

  // When the selected node changes, consume any pending sub-view.
  // Only reset to 'info' when there is no pending sub-view queued.
  useEffect(() => {
    if (pendingSubViewRef.current !== null) {
      setNodeDetailsSubView(pendingSubViewRef.current);
      pendingSubViewRef.current = null;
    } else {
      // Only reset to 'info' on a genuine node change (not on initial mount
      // where previousNodeIdRef hasn't been set yet), and only when no
      // sub-view was explicitly requested.
      if (previousNodeIdRef.current !== undefined) {
        setNodeDetailsSubView('info');
      }
    }
  }, [selectedNode?.id]);

  return (
    <>
      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onTogglePanel}
        className={`fixed z-50 bg-white border border-gray-200 shadow-md hover:bg-gray-50 transition-all duration-300 ${
          isPanelExpanded
            ? 'top-4 right-4 md:top-4 md:right-[calc(50%-2.5rem)]'
            : 'top-4 right-4'
        }`}
        title={isPanelExpanded ? 'Collapse panel' : 'Expand panel'}
      >
        {isPanelExpanded ? (
          <ChevronRight className="h-5 w-5" />
        ) : (
          <ChevronLeft className="h-5 w-5" />
        )}
      </Button>

      {/* Panel container */}
      <div
        className={`fixed top-0 right-0 z-40 h-full w-full md:w-1/2 flex flex-col bg-white shadow-lg transition-all duration-300 ${
          isPanelExpanded ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TabType)}
          className="flex flex-col h-full"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="chat" className="flex items-center space-x-2">
              <MessageSquare size={16} />
              <span>Chat</span>
            </TabsTrigger>
            <TabsTrigger value="details" className="flex items-center space-x-2">
              <Info size={16} />
              <span>Node Details</span>
            </TabsTrigger>
            <TabsTrigger value="simulations" className="flex items-center space-x-2">
              <BarChart3 size={16} />
              <span>Simulations</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="flex-1 overflow-y-auto mt-0">
            <Chat topic={topic} />
          </TabsContent>

          <TabsContent value="details" className="flex-1 overflow-y-auto mt-0">
            <NodeDetails
              selectedNode={selectedNode}
              topic={topic}
              activeSubView={nodeDetailsSubView}
              onSubViewChange={setNodeDetailsSubView}
              onSelectNode={onNodeSelect}
            />
          </TabsContent>

          <TabsContent value="simulations" className="flex-1 overflow-y-auto mt-0">
            <Simulations topic={topic} techTree={techTree} onNodeSelect={onNodeSelect} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

export default TabPanel;