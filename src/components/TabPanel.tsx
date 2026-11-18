'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Info, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import NodeDetails, { NodeDetailsSubView } from './NodeDetails';
import Chat from './Chat';
import Simulations from './Simulations';
import { UiNode, TechTree } from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import { ExplorerPanel } from '@/lib/explorerUrlState';
import { ChatScope } from '@/lib/chatContext';
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
  onShowChatRef?: (fn: () => void) => void;
  /** Reopens the welcome flow from the empty details panel. */
  onChooseTechnology?: () => void;
  /** URL `panel` value; null means details. */
  panel?: ExplorerPanel | null;
  onPanelChange?: (panel: ExplorerPanel) => void;
  /** What the chat talks about (pathway, custom tree, view…). */
  chatScope?: ChatScope | null;
}

type TabType = ExplorerPanel;

const TabPanel = ({
  selectedNode,
  techTree,
  isPanelExpanded,
  onTogglePanel,
  topic,
  onNodeSelect,
  onShowNodeDetailsRef,
  onShowCompaniesViewRef,
  onShowChatRef,
  onChooseTechnology,
  panel = null,
  onPanelChange,
  chatScope = null,
}: TabPanelProps) => {
  const [activeTab, setActiveTab] = useState<TabType>(panel ?? 'details');
  const [nodeDetailsSubView, setNodeDetailsSubView] = useState<NodeDetailsSubView>('info');
  const previousNodeIdRef = useRef<string | undefined>(undefined);
  const pendingSubViewRef = useRef<NodeDetailsSubView | null>(null);

  useEffect(() => {
    setActiveTab(panel ?? 'details');
  }, [panel]);

  useEffect(() => {
    if (onShowNodeDetailsRef) {
      onShowNodeDetailsRef(() => {
        pendingSubViewRef.current = 'info';
        setActiveTab('details');
        onPanelChange?.('details');
        setNodeDetailsSubView('info');
      });
    }
  }, [onShowNodeDetailsRef, onPanelChange]);

  useEffect(() => {
    if (onShowCompaniesViewRef) {
      onShowCompaniesViewRef(() => {
        pendingSubViewRef.current = 'companies';
        setActiveTab('details');
        onPanelChange?.('details');
        setNodeDetailsSubView('companies');
      });
    }
  }, [onShowCompaniesViewRef, onPanelChange]);

  useEffect(() => {
    onShowChatRef?.(() => {
      setActiveTab('chat');
      onPanelChange?.('chat');
    });
  }, [onShowChatRef, onPanelChange]);

  useEffect(() => {
    if (
      selectedNode &&
      activeTab === 'chat' &&
      previousNodeIdRef.current !== selectedNode.id
    ) {
      setActiveTab('details');
      onPanelChange?.('details');
    }
    previousNodeIdRef.current = selectedNode?.id;
  }, [selectedNode, activeTab, onPanelChange]);

  useEffect(() => {
    if (pendingSubViewRef.current !== null) {
      setNodeDetailsSubView(pendingSubViewRef.current);
      pendingSubViewRef.current = null;
    } else if (previousNodeIdRef.current !== undefined) {
      setNodeDetailsSubView('info');
    }
  }, [selectedNode?.id]);

  const handleTabChange = (value: string) => {
    const next = value as TabType;
    setActiveTab(next);
    onPanelChange?.(next);
  };

  return (
    <>
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
        aria-label={isPanelExpanded ? 'Collapse panel' : 'Expand panel'}
      >
        {isPanelExpanded ? (
          <ChevronRight className="h-5 w-5" />
        ) : (
          <ChevronLeft className="h-5 w-5" />
        )}
      </Button>

      <div
        className={`fixed top-0 right-0 z-40 h-full w-full md:w-1/2 flex flex-col bg-white shadow-lg transition-all duration-300 ${
          isPanelExpanded ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex flex-col h-full"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details" className="flex items-center space-x-2">
              <Info size={16} />
              <span>Node Details</span>
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex items-center space-x-2">
              <MessageSquare size={16} />
              <span>Chat</span>
            </TabsTrigger>
            <TabsTrigger value="simulations" className="flex items-center space-x-2">
              <BarChart3 size={16} />
              <span>Simulations</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="flex-1 overflow-y-auto mt-0">
            <Chat topic={topic} scope={chatScope} />
          </TabsContent>

          <TabsContent value="details" className="flex-1 overflow-y-auto mt-0">
            <NodeDetails
              selectedNode={selectedNode}
              topic={topic}
              activeSubView={nodeDetailsSubView}
              onSubViewChange={setNodeDetailsSubView}
              onSelectNode={onNodeSelect}
              onChooseTechnology={onChooseTechnology}
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
