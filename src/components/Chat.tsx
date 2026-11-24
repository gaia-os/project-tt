'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Send, Loader2, Trash2, Upload, Crosshair, Settings, Network } from 'lucide-react';
import DOMPurify from 'dompurify';
import {
  ChatKgSettings,
  ChatMention,
  ChatMessage,
  KgPaperDossier,
  KgToolUse,
} from '@/lib/types';
import { labelForTopic, TopicKey } from '@/lib/topicConfig';
import PaperDetails from './PaperDetails';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTechTree } from '@/hooks/useTechTree';
import { useTopics } from '@/hooks/useTopics';
import { createMentionMatcher, MentionMatcher } from '@/lib/chatMentions';
import {
  ChatScope,
  buildChatPayload,
  describeScopeSize,
  resolveChatScope,
} from '@/lib/chatContext';
import {
  DEFAULT_KG_SETTINGS,
  deleteThread,
  loadKgSettings,
  loadScroll,
  loadThread,
  saveKgSettings,
  saveScroll,
  saveThread,
} from '@/lib/chatThreadStorage';

type ChatMode = 'instant' | 'thinking';

interface ChatProps {
  topic: TopicKey;
  /**
   * What the assistant talks about: a pathway, a custom tree, a narrowed
   * view or the whole tree. Each has its own conversation. Without it the
   * chat covers the whole topic tree.
   */
  scope?: ChatScope | null;
  /** Entities bolded in the newest assistant answer (KG-linked by the service). */
  onMentionsChange?: (mentions: ChatMention[]) => void;
  /** A past answer's "N on tree" chip was clicked; defaults to onMentionsChange. */
  onShowMentions?: (mentions: ChatMention[]) => void;
}

// Paper-id citations like [IAEA-CN-28-H-10] emitted by the kg-service,
// renumbered to [1], [2], … and turned into clickable dossier links.
const CITE_RE = /\[(IAEA-CN-[\w.-]+|CN-[\w.-]+)\]/g;

function linkCitations(html: string): string {
  const numbers = new Map<string, number>();
  return html.replace(CITE_RE, (m, id) => {
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
    return `<span class="kg-cite" data-paperid="${id}">[${numbers.get(id)}]</span>`;
  });
}

const SUGGESTIONS: Record<'topic' | 'pathway' | 'custom' | 'view', [string, string][]> = {
  topic: [
    ['Explanation of Tech Tree', 'What is this Tech Tree about?'],
    ['Highest Impact', 'What are the enabling technologies with the highest impact?'],
    ['Highest TRL Technologies', 'Which technologies have the highest TRL?'],
    ['Investment Opportunities', 'What are the most promising investments?'],
  ],
  pathway: [
    ['Bottleneck', 'What is the main bottleneck on this path, and why?'],
    ['Riskiest step', 'Which step of this path is the riskiest?'],
    ['Plain summary', 'Summarise this path in plain terms.'],
    ['What to fund', 'Where would investment speed this path up most?'],
  ],
  custom: [
    ['Summary', 'Summarise this tree.'],
    ['Gaps', 'What important prerequisites are missing from this selection?'],
    ['Least mature', 'Which of these technologies are the least mature?'],
    ['Investment', 'Where should investment in this tree go first?'],
  ],
  view: [
    ['What am I seeing', 'Summarise the nodes I am looking at.'],
    ['Least mature', 'Which of these are the least mature?'],
    ['How they connect', 'How do these nodes depend on each other?'],
    ['Investment', 'Which of these are the most promising investments?'],
  ],
};

interface ThreadState {
  key: string;
  messages: ChatMessage[];
}

/** Small button under an assistant answer: replays its mention pop-up. */
function MentionGraphButton({
  mentions,
  matcher,
  onShow,
}: {
  mentions: ChatMention[];
  matcher: MentionMatcher | null;
  onShow?: (mentions: ChatMention[]) => void;
}) {
  const count = matcher ? matcher(mentions).nodes.length : 0;
  if (!count || !onShow) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onShow(mentions);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] text-gray-600 transition-colors hover:border-blue-400 hover:text-blue-600"
      title="Show these entities on the tree"
    >
      <Network className="h-3 w-3" aria-hidden />
      {count} on tree
    </button>
  );
}

const Chat: React.FC<ChatProps> = ({
  topic,
  scope = null,
  onMentionsChange,
  onShowMentions,
}) => {
  const { techTree } = useTechTree(topic);
  // Shared label index for the "N on tree" chips under past answers.
  const mentionMatcher = useMemo(
    () => (techTree ? createMentionMatcher(techTree) : null),
    [techTree],
  );
  const { topics } = useTopics();
  const topicLabel = labelForTopic(topics, topic);
  // "Use whole tree" for one particular scope; resets when the scope changes.
  const [wholeTreeFor, setWholeTreeFor] = useState<string | null>(null);
  const scopeId = scope ? `${scope.threadKey}|${scope.refinement?.label ?? ''}` : null;
  const wholeTree = useMemo(
    () =>
      techTree
        ? resolveChatScope({
            topic,
            topicLabel,
            techTree,
            draft: null,
            pathway: null,
            custom: null,
            view: null,
          })
        : null,
    [topic, topicLabel, techTree],
  );
  const usingWholeTree = !scope || (scopeId !== null && wholeTreeFor === scopeId);
  const activeScope = usingWholeTree ? wholeTree : scope;
  const threadKey = activeScope?.threadKey ?? topic;

  const [thread, setThread] = useState<ThreadState>(() => ({
    key: threadKey,
    messages: loadThread(threadKey),
  }));
  const threadKeyRef = useRef(thread.key);
  // Set when a thread is loaded, so loading it does not count as a change.
  const loadedRef = useRef<ChatMessage[] | null>(thread.messages);
  const messages = thread.messages;

  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [requestCount, setRequestCount] = useState(0);
  const [lastRequestTime, setLastRequestTime] = useState(0);
  const [rateLimitExceeded, setRateLimitExceeded] = useState(false);
  const [mode, setMode] = useState<ChatMode>('instant');
  const [citedPaper, setCitedPaper] = useState<KgPaperDossier | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kgSettings, setKgSettings] = useState<ChatKgSettings>(
    () => loadKgSettings() ?? DEFAULT_KG_SETTINGS,
  );
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [switchingModel, setSwitchingModel] = useState(false);
  const [modelError, setModelError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const MAX_REQUESTS_PER_HOUR = 20;
  const MIN_REQUEST_INTERVAL = 3000;

  // Each context has its own conversation: switching loads it.
  useEffect(() => {
    if (threadKeyRef.current === threadKey) return;
    const loaded = loadThread(threadKey);
    threadKeyRef.current = threadKey;
    loadedRef.current = loaded;
    setThread({ key: threadKey, messages: loaded });
  }, [threadKey]);

  useEffect(() => {
    const savedScrollPosition = loadScroll(thread.key);
    const timer = window.setTimeout(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      container.scrollTop =
        savedScrollPosition ?? (thread.messages.length ? container.scrollHeight : 0);
    }, 100);
    return () => window.clearTimeout(timer);
    // Only when another conversation is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.key]);

  useEffect(() => {
    if (thread.messages === loadedRef.current) return;
    saveThread(thread.key, thread.messages);
  }, [thread]);

  // Report which entities the newest answer mentions so the canvas can show
  // them. Compared by value — streaming updates recreate the arrays.
  const mentionsKeyRef = useRef('');
  useEffect(() => {
    if (!onMentionsChange) return;
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.type === 'assistant');
    const next = lastAssistant?.mentions ?? [];
    const key = JSON.stringify(next);
    if (key !== mentionsKeyRef.current) {
      mentionsKeyRef.current = key;
      onMentionsChange(next);
    }
  }, [messages, onMentionsChange]);

  useEffect(() => {
    try {
      const savedRequestCount = localStorage.getItem('tech-tree-request-count');
      const savedLastRequestTime = localStorage.getItem('tech-tree-last-request-time');
      if (savedRequestCount) setRequestCount(parseInt(savedRequestCount, 10));
      if (savedLastRequestTime) setLastRequestTime(parseInt(savedLastRequestTime, 10));
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('tech-tree-request-count', requestCount.toString());
      localStorage.setItem('tech-tree-last-request-time', lastRequestTime.toString());
    } catch (error) {
      console.error('Error saving rate limiting data:', error);
    }
  }, [requestCount, lastRequestTime]);

  useEffect(() => {
    saveKgSettings(kgSettings);
  }, [kgSettings]);

  // First visit (nothing stored yet): seed the reasoning toggle from the
  // server's KG_REASONING_DISPLAY default.
  useEffect(() => {
    fetch('/investment-tech-tree/api/chat')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || loadKgSettings() || typeof d.reasoningDefault !== 'boolean')
          return;
        setKgSettings((s) => ({ ...s, reasoning: d.reasoningDefault }));
      })
      .catch(() => {});
  }, []);

  const updateKgSettings = (patch: Partial<ChatKgSettings>) =>
    setKgSettings((s) => ({ ...s, ...patch }));

  // The active LLM lives on the kg-service (one container for all chats):
  // read the selectable models and current pick when the dialog opens.
  useEffect(() => {
    if (!settingsOpen) return;
    setModelError('');
    fetch('/investment-tech-tree/api/kg/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setLlmModels(Array.isArray(d.models) ? d.models : []);
        if (typeof d.current === 'string') setCurrentModel(d.current);
      })
      .catch(() => setModelError('Could not load the model list.'));
  }, [settingsOpen]);

  const switchModel = (model: string) => {
    if (!model || model === currentModel || switchingModel) return;
    setSwitchingModel(true);
    setModelError('');
    fetch('/investment-tech-tree/api/kg/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          setModelError(d.error ?? 'Model switch failed.');
          return;
        }
        if (typeof d.current === 'string') setCurrentModel(d.current);
      })
      .catch(() => setModelError('Model switch failed.'))
      .finally(() => setSwitchingModel(false));
  };

  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.type === 'user') {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages]);

  /**
   * Changes a conversation. A reply that is still streaming when the
   * visitor switches context keeps going to the conversation it belongs to:
   * into state while that one is shown, else into storage when `persist`.
   */
  const updateThread = useCallback(
    (key: string, update: (messages: ChatMessage[]) => ChatMessage[], persist = true) => {
      if (threadKeyRef.current === key) {
        setThread((current) =>
          current.key === key ? { key, messages: update(current.messages) } : current,
        );
      } else if (persist) {
        saveThread(key, update(loadThread(key)));
      }
    },
    [],
  );

  const checkRateLimit = (): boolean => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    if (lastRequestTime < oneHourAgo) {
      setRequestCount(0);
      setLastRequestTime(now);
      return true;
    }
    if (requestCount >= MAX_REQUESTS_PER_HOUR) {
      setRateLimitExceeded(true);
      return false;
    }
    if (now - lastRequestTime < MIN_REQUEST_INTERVAL) return false;
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type !== 'application/pdf') {
        alert('Please select a PDF file');
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) {
        alert('File size must be less than 10MB');
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() && !file) return;
    const key = thread.key;

    if (!checkRateLimit()) {
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'assistant',
        content: rateLimitExceeded
          ? `Rate limit exceeded. You can make up to ${MAX_REQUESTS_PER_HOUR} requests per hour. Please try again later.`
          : `Please wait at least ${MIN_REQUEST_INTERVAL / 1000} seconds between requests.`,
        timestamp: Date.now(),
      };
      updateThread(key, (prev) => [...prev, errorMessage]);
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: input.trim() + (file ? ` [File: ${file.name}]` : ''),
      timestamp: Date.now(),
      ...(activeScope?.refinement
        ? { context: { label: `${activeScope.refinement.label} · ${describeScopeSize(activeScope)}` } }
        : {}),
    };
    const history = messages;

    updateThread(key, (prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setUploadStatus(file ? 'Processing PDF document...' : '');
    setRequestCount((prev) => prev + 1);
    setLastRequestTime(Date.now());
    setRateLimitExceeded(false);

    // Draft assistant message, filled progressively by the NDJSON stream.
    const draftId = (Date.now() + 1).toString();
    let draftText = '';
    let tools: (string | KgToolUse)[] = [];
    let suggestions: string[] = [];
    let mentions: ChatMention[] = [];
    let started = false;
    const writeDraft = (persist: boolean) =>
      updateThread(
        key,
        (prev) =>
          prev.some((m) => m.id === draftId)
            ? prev.map((m) =>
                m.id === draftId
                  ? {
                      ...m,
                      content: draftText,
                      toolsUsed: [...tools],
                      suggestions: [...suggestions],
                      mentions: [...mentions],
                    }
                  : m,
              )
            : [
                ...prev,
                {
                  id: draftId,
                  type: 'assistant' as const,
                  content: draftText,
                  toolsUsed: [...tools],
                  suggestions: [...suggestions],
                  mentions: [...mentions],
                  timestamp: Date.now(),
                },
              ],
        persist,
      );

    try {
      // Convert file to base64 on the client if present
      let fileData: { base64: string; mimeType: string; fileName: string } | null = null;
      if (file) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () =>
            resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        fileData = { base64, mimeType: file.type, fileName: file.name };
      }

      const payload = activeScope
        ? buildChatPayload(activeScope)
        : { context: { nodes: [], edges: [] } };

      // Call server-side API route — API key never touches the browser
      const res = await fetch('/investment-tech-tree/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          context: payload.context,
          ...(payload.scope ? { scope: payload.scope } : {}),
          history,
          topic,
          fileData,
          mode,
          // Reasons cost a few extra tokens — skip when the lookup list
          // they're shown under is hidden anyway.
          reasoning: kgSettings.reasoning && kgSettings.showLookups,
          suggestions: kgSettings.suggestions,
          timeoutMs: kgSettings.timeoutSec * 1000,
          maxToolRoundsInstant: kgSettings.instantLimit,
          maxToolRoundsThinking: kgSettings.thinkingLimit,
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to get response');
      }

      started = true;
      writeDraft(false);

      // NDJSON stream: tool calls, progress notes, text deltas, done/error.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: {
            type?: string;
            name?: string;
            reason?: string | null;
            text?: string;
            response?: string;
            error?: string;
            toolsUsed?: (string | KgToolUse)[];
            suggestions?: string[];
            items?: ChatMention[];
          };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === 'tool') {
            if (ev.name) tools.push({ call: ev.name, reason: ev.reason });
            setUploadStatus('Searching the knowledge graph…');
          } else if (ev.type === 'progress') {
            if (ev.text) setUploadStatus(ev.text);
          } else if (ev.type === 'delta') {
            draftText += ev.text ?? '';
            setUploadStatus('Writing answer…');
          } else if (ev.type === 'entities') {
            mentions = Array.isArray(ev.items)
              ? ev.items.filter(
                  (item): item is ChatMention =>
                    !!item && typeof item.text === 'string',
                )
              : [];
          } else if (ev.type === 'done') {
            tools = ev.toolsUsed ?? tools;
            suggestions = ev.suggestions ?? suggestions;
            if (ev.response) draftText = ev.response;
          } else if (ev.type === 'error') {
            throw new Error(ev.error || 'KG service error');
          }
          writeDraft(false);
        }
      }
      if (!draftText) draftText = 'No response received.';
      writeDraft(true);
    } catch (error) {
      console.error('Error sending message:', error);
      draftText =
        error instanceof Error
          ? `Error: ${error.message}`
          : 'Sorry, there was an error processing your request. Please try again.';
      if (!started) tools = [];
      writeDraft(true);
    } finally {
      setIsLoading(false);
      setUploadStatus('');
      setFile(null);
    }
  };

  const clearHistory = () => {
    deleteThread(thread.key);
    loadedRef.current = [];
    setThread({ key: thread.key, messages: loadedRef.current });
  };

  const saveScrollPosition = () => {
    if (messagesContainerRef.current) {
      saveScroll(thread.key, messagesContainerRef.current.scrollTop);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleSuggestedQuestion = (question: string) => {
    setInput(question);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const suggestionKind: keyof typeof SUGGESTIONS = !activeScope
    ? 'topic'
    : activeScope.kind === 'pathway'
      ? 'pathway'
      : activeScope.kind === 'custom' || activeScope.kind === 'draft'
        ? 'custom'
        : activeScope.refinement
          ? 'view'
          : 'topic';
  const isNarrowed = !!scope && (scope.kind !== 'topic' || !!scope.refinement);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="truncate text-lg font-semibold" title={activeScope?.title}>
            {activeScope && activeScope.kind !== 'topic' ? activeScope.title : 'Tech Tree Chat'}
          </CardTitle>
          {activeScope && activeScope.kind !== 'topic' && (
            <p className="text-xs text-gray-500">
              {activeScope.kind === 'pathway'
                ? 'Conversation about this pathway'
                : activeScope.kind === 'draft'
                  ? 'Conversation about the tree you are building'
                  : 'Conversation about your tree'}
            </p>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {rateLimitExceeded && (
            <Badge variant="destructive" className="text-xs">
              Rate Limited
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {requestCount}/{MAX_REQUESTS_PER_HOUR} requests per hour
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100"
            title="Knowledge graph settings"
          >
            <Settings size={18} />
          </Button>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50"
              title="Clear this conversation"
            >
              <Trash2 size={18} />
            </Button>
          )}
        </div>
      </CardHeader>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
        onScroll={saveScrollPosition}
      >
        {messages.length === 0 ? (
          <Card>
            <CardContent className="text-center text-gray-500 mt-8">
              <p className="text-lg mb-4">
                {suggestionKind === 'topic'
                  ? 'Ask anything about the Tech Tree:'
                  : `Ask about ${activeScope?.refinement?.label ?? activeScope?.title ?? 'this selection'}:`}
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {SUGGESTIONS[suggestionKind].map(([label, question]) => (
                  <Badge
                    key={label}
                    variant="outline"
                    className="cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => handleSuggestedQuestion(question)}
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.type === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <Card
                className={`max-w-[80%] ${
                  message.type === 'user'
                    ? 'bg-slate-600 text-white border-slate-600'
                    : 'bg-gray-100 text-gray-900 border'
                }`}
              >
                <CardContent
                  className={`p-4 ${
                    message.type === 'user' ? 'p-3' : 'p-4 pl-6'
                  }`}
                >
                  <div className="break-words">
                    {message.type === 'assistant' ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            linkCitations(
                              message.content
                                .replace(/^```html\s*/i, '')
                                .replace(/```[\s\n]*$/, ''),
                            ),
                            {
                              ALLOWED_TAGS: [
                                'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li',
                                'strong', 'em', 'table', 'thead', 'tbody',
                                'tr', 'td', 'th', 'code', 'pre', 'br', 'a',
                                'span',
                              ],
                              ALLOWED_ATTR: ['class', 'href', 'target', 'rel', 'data-paperid', 'data-entity'],
                            },
                          ),
                        }}
                        onClick={(e) => {
                          const pid = (e.target as HTMLElement).dataset?.paperid;
                          if (pid) {
                            fetch(
                              `/investment-tech-tree/api/kg/paper/${encodeURIComponent(pid)}?topic=${topic}`,
                            )
                              .then((r) => (r.ok ? r.json() : null))
                              .then((d) => d && setCitedPaper(d))
                              .catch(() => {});
                          }
                        }}
                        className="prose prose-sm max-w-none [&_table]:overflow-x-auto [&_table]:block [&_table]:w-full [&_table]:border-collapse [&_table]:border [&_table]:border-gray-300 [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2 [&_td]:whitespace-nowrap [&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-gray-50 [&_th]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:mb-3 [&_ol]:text-gray-700 [&_li]:mb-1 [&_a]:text-blue-600 [&_a]:hover:underline [&_.kg-cite]:text-indigo-600 [&_.kg-cite]:font-semibold [&_.kg-cite]:cursor-pointer [&_.kg-cite]:hover:underline"
                      />
                    ) : (
                      <div className="whitespace-pre-wrap">
                        {message.content}
                      </div>
                    )}
                  </div>
                  {message.toolsUsed?.length && kgSettings.showLookups ? (
                    <details className="mt-2 text-xs text-gray-500">
                      <summary className="cursor-pointer hover:text-gray-700 select-none">
                        {message.toolsUsed.length} knowledge graph lookup
                        {message.toolsUsed.length === 1 ? '' : 's'}
                      </summary>
                      <ul className="mt-1 space-y-1 font-mono text-[11px] text-gray-400 pl-3">
                        {message.toolsUsed.map((toolUse, i) => {
                          const label =
                            typeof toolUse === 'string' ? toolUse : toolUse.call;
                          const reason =
                            typeof toolUse === 'string' ? null : toolUse.reason;
                          return (
                            <li key={i} className="break-all">
                              {label}
                              {reason ? (
                                <span className="block pl-3 font-sans italic text-gray-500">
                                  ↳ {reason}
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  ) : null}
                  {kgSettings.suggestions &&
                  message.type === 'assistant' &&
                  message.suggestions?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.suggestions.map((q) => (
                        <Badge
                          key={q}
                          variant="outline"
                          className="cursor-pointer font-normal hover:bg-gray-200 transition-colors"
                          onClick={() => handleSuggestedQuestion(q)}
                        >
                          {q}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <div
                    className={`text-xs mt-2 flex items-center justify-between gap-2 ${
                      message.type === 'user' ? 'text-slate-100' : 'text-gray-500'
                    }`}
                  >
                    <span>
                      {message.context && (
                        <span className="mr-1.5 inline-flex items-center gap-1">
                          <Crosshair className="h-3 w-3" aria-hidden />
                          {message.context.label} ·
                        </span>
                      )}
                      {new Date(message.timestamp).toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {message.type === 'assistant' && message.mentions?.length ? (
                      <MentionGraphButton
                        mentions={message.mentions}
                        matcher={mentionMatcher}
                        onShow={onShowMentions ?? onMentionsChange}
                      />
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <Card className="bg-gray-100 border">
              <CardContent className="p-3">
                <div className="flex items-center space-x-2">
                  <Loader2 size={16} className="animate-spin text-gray-500" />
                  <span className="text-gray-500">
                    {uploadStatus ||
                      (mode === 'thinking' ? 'Deep analysis...' : 'Analysing...')}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4">
        {activeScope && (
          <div
            className={`mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-1.5 text-xs ${
              isNarrowed && !usingWholeTree
                ? 'border-blue-200 bg-blue-50 text-blue-900'
                : 'border-gray-200 bg-gray-50 text-gray-700'
            }`}
            data-testid="chat-context"
          >
            <Crosshair className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              Talking about{' '}
              <strong className="font-semibold">
                {activeScope.title}
                {activeScope.refinement ? ` › ${activeScope.refinement.label}` : ''}
              </strong>{' '}
              · {describeScopeSize(activeScope)}
            </span>
            {isNarrowed && scopeId && (
              <button
                type="button"
                onClick={() => setWholeTreeFor(usingWholeTree ? null : scopeId)}
                className="shrink-0 font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                {usingWholeTree ? `Back to ${scope?.title}` : 'Use whole tree'}
              </button>
            )}
          </div>
        )}
        {file && (
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-600 bg-gray-50 p-2 rounded">
            <Upload size={14} />
            <span className="flex-1">
              {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFile(null)}
              className="h-6 px-2"
            >
              Remove
            </Button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question or upload a PDF for analysis..."
              className="w-full resize-none pr-32 max-h-32"
              rows={1}
              disabled={isLoading || rateLimitExceeded}
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ChatMode)}
                disabled={isLoading}
                className="h-8 text-xs border border-gray-200 rounded px-1 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
                title="Response mode"
              >
                <option value="instant">Instant</option>
                <option value="thinking">Deep Analysis</option>
              </select>
              <label htmlFor="file-upload-chat">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="p-1 h-8 w-8 cursor-pointer"
                  disabled={isLoading}
                  onClick={() =>
                    document.getElementById('file-upload-chat')?.click()
                  }
                >
                  <Upload size={18} />
                </Button>
              </label>
              <input
                id="file-upload-chat"
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                type="submit"
                size="sm"
                disabled={
                  (!input.trim() && !file) || isLoading || rateLimitExceeded
                }
                className="p-1 h-8 w-8"
              >
                <Send size={18} />
              </Button>
            </div>
          </div>
        </form>
        <p className="text-xs text-gray-500 mt-2">
          Press Enter to send, Shift+Enter for new line. PDF files up to 10MB
          supported.
        </p>
      </div>
      {citedPaper && (
        <PaperDetails
          dossier={citedPaper}
          topic={topic}
          onClose={() => setCitedPaper(null)}
        />
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm p-5">
          <DialogHeader>
            <DialogTitle>Knowledge graph</DialogTitle>
            <DialogDescription>
              Saved on this browser and applied to every new message.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 space-y-4 text-sm text-gray-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={kgSettings.showLookups}
                onChange={(e) =>
                  updateKgSettings({ showLookups: e.target.checked })
                }
                className="h-4 w-4 accent-indigo-600"
              />
              <span>Show knowledge graph lookups</span>
            </label>
            <label
              className={`flex items-center gap-2 ${
                kgSettings.showLookups ? 'cursor-pointer' : 'opacity-50'
              }`}
            >
              <input
                type="checkbox"
                checked={kgSettings.reasoning}
                disabled={!kgSettings.showLookups}
                onChange={(e) =>
                  updateKgSettings({ reasoning: e.target.checked })
                }
                className="h-4 w-4 accent-indigo-600"
              />
              <span>Show the reason under each lookup</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={kgSettings.suggestions}
                onChange={(e) =>
                  updateKgSettings({ suggestions: e.target.checked })
                }
                className="h-4 w-4 accent-indigo-600"
              />
              <span>Suggest follow-up questions after each answer</span>
            </label>
            <div className="space-y-3 border-t border-gray-200 pt-3">
              <label className="flex items-center justify-between gap-3">
                <span>Lookup timeout (seconds)</span>
                <input
                  type="number"
                  min={10}
                  max={190}
                  value={kgSettings.timeoutSec}
                  onChange={(e) =>
                    updateKgSettings({ timeoutSec: Number(e.target.value) })
                  }
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Max lookups — instant</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={kgSettings.instantLimit}
                  onChange={(e) =>
                    updateKgSettings({ instantLimit: Number(e.target.value) })
                  }
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Max lookups — deep analysis</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={kgSettings.thinkingLimit}
                  onChange={(e) =>
                    updateKgSettings({ thinkingLimit: Number(e.target.value) })
                  }
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </label>
            </div>
            <div className="space-y-2 border-t border-gray-200 pt-3">
              <label className="flex items-center justify-between gap-3">
                <span>Chat model</span>
                {llmModels.length > 0 ? (
                  <select
                    value={currentModel}
                    onChange={(e) => switchModel(e.target.value)}
                    disabled={switchingModel || !currentModel}
                    aria-label="Chat model"
                    className="max-w-48 truncate border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-50"
                  >
                    {llmModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-gray-400">
                    {modelError ? 'Unavailable' : 'Loading…'}
                  </span>
                )}
              </label>
              {switchingModel && (
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Loader2 size={12} className="animate-spin" />
                  Switching model — offloading the current one and loading the
                  new model. This can take a while.
                </p>
              )}
              {modelError && <p className="text-xs text-red-600">{modelError}</p>}
              <p className="text-xs text-gray-400">
                Applies to the shared knowledge-graph service, for all
                conversations.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Chat;
