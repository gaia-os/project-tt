'use client';

import React from 'react';
import { TopicKey, labelForTopic, titleizeLabel } from '@/lib/topicConfig';
import { CustomTree } from '@/lib/customTrees';
import { useTopics } from '@/hooks/useTopics';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Database } from 'lucide-react';

interface KnowledgeBaseSelectorProps {
  topic: TopicKey;
  onTopicChange: (value: TopicKey) => void;
  /** Saved custom trees, offered next to the topics (technology view). */
  customTrees?: CustomTree[];
  activeCustomTreeId?: string | null;
  onOpenCustomTree?: (tree: CustomTree) => void;
}

const TREE_VALUE_PREFIX = 'tree:';

export const KnowledgeBaseSelector: React.FC<KnowledgeBaseSelectorProps> = ({
  topic,
  onTopicChange,
  customTrees = [],
  activeCustomTreeId = null,
  onOpenCustomTree,
}) => {
  const { topics } = useTopics();

  // Ensure the active topic is always selectable even before the list loads.
  const items = topics.length
    ? topics
    : [{ id: topic, label: titleizeLabel(topic) }];

  const showTrees = !!onOpenCustomTree && customTrees.length > 0;
  const activeTree = activeCustomTreeId
    ? customTrees.find((tree) => tree.id === activeCustomTreeId)
    : undefined;
  const value = activeTree ? `${TREE_VALUE_PREFIX}${activeTree.id}` : topic;

  const handleChange = (next: string) => {
    if (next.startsWith(TREE_VALUE_PREFIX)) {
      const tree = customTrees.find(
        (candidate) => candidate.id === next.slice(TREE_VALUE_PREFIX.length),
      );
      if (tree) onOpenCustomTree?.(tree);
      return;
    }
    onTopicChange(next as TopicKey);
  };

  return (
    <div>
      <div className="bg-white border-2 border-gray-300 rounded-xl shadow-lg p-4 backdrop-blur-sm bg-opacity-90 w-fit">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-gray-800 p-2 rounded-lg">
            <Database className="h-5 w-5 text-white" />
          </div>
          <h3 className="text-sm font-bold text-gray-800 tracking-wide">
            SELECT TECH TREE
          </h3>
        </div>
        <Select value={value} onValueChange={handleChange}>
          <SelectTrigger className="w-full max-w-[16rem] h-10 bg-white border-gray-300 hover:border-gray-500 focus:ring-2 focus:ring-gray-400 transition-all shadow-sm font-medium">
            <SelectValue placeholder="Select tech tree" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {showTrees && <SelectLabel>Tech trees</SelectLabel>}
              {items.map((topicItem) => (
                <SelectItem
                  key={topicItem.id}
                  value={topicItem.id}
                  className="font-medium hover:bg-gray-100 cursor-pointer"
                >
                  {topicItem.label}
                </SelectItem>
              ))}
            </SelectGroup>
            {showTrees && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>My trees</SelectLabel>
                  {customTrees.map((tree) => (
                    <SelectItem
                      key={tree.id}
                      value={`${TREE_VALUE_PREFIX}${tree.id}`}
                      className="cursor-pointer hover:bg-gray-100"
                    >
                      {tree.name}
                      <span className="ml-1.5 text-xs text-gray-500">
                        · {labelForTopic(topics, tree.topic)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
