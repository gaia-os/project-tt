'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Loader2, Trash2, Upload } from 'lucide-react';
import DOMPurify from 'dompurify';
import { ChatMessage, ChatHistory, KgPaperDossier } from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import PaperDetails from './PaperDetails';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTechTree } from '@/hooks/useTechTree';
import { chatContextTree } from '@/lib/smrFilters';

type ChatMode = 'instant' | 'thinking';

interface ChatProps {
  topic: TopicKey;
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

const Chat: React.FC<ChatProps> = ({ topic }) => {
  const { techTree } = useTechTree(topic);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [requestCount, setRequestCount] = useState(0);
  const [lastRequestTime, setLastRequestTime] = useState(0);
  const [rateLimitExceeded, setRateLimitExceeded] = useState(false);
  const [mode, setMode] = useState<ChatMode>('instant');
  const [citedPaper, setCitedPaper] = useState<KgPaperDossier | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const MAX_REQUESTS_PER_HOUR = 20;
  const MIN_REQUEST_INTERVAL = 3000;

  useEffect(() => {
    setMessages([]);
    try {
      const storageKey = `tech-tree-chat-history-${topic}`;
      const savedHistory = localStorage.getItem(storageKey);
      if (savedHistory) {
        const history: ChatHistory = JSON.parse(savedHistory);
        setMessages(history.messages);
        setTimeout(() => {
          const savedScrollPosition = localStorage.getItem(
            `tech-tree-chat-scroll-${topic}`,
          );
          if (savedScrollPosition && messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = parseInt(
              savedScrollPosition,
              10,
            );
          }
        }, 100);
      }

      const savedRequestCount = localStorage.getItem('tech-tree-request-count');
      const savedLastRequestTime = localStorage.getItem(
        'tech-tree-last-request-time',
      );
      if (savedRequestCount) setRequestCount(parseInt(savedRequestCount, 10));
      if (savedLastRequestTime)
        setLastRequestTime(parseInt(savedLastRequestTime, 10));
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  }, [topic]);

  useEffect(() => {
    if (messages.length > 0) {
      const history: ChatHistory = { messages, lastUpdated: Date.now() };
      try {
        const storageKey = `tech-tree-chat-history-${topic}`;
        localStorage.setItem(storageKey, JSON.stringify(history));
      } catch (error) {
        console.error('Error saving chat history:', error);
      }
    }
  }, [messages, topic]);

  useEffect(() => {
    try {
      localStorage.setItem('tech-tree-request-count', requestCount.toString());
      localStorage.setItem(
        'tech-tree-last-request-time',
        lastRequestTime.toString(),
      );
    } catch (error) {
      console.error('Error saving rate limiting data:', error);
    }
  }, [requestCount, lastRequestTime]);

  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.type === 'user') {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages]);

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

    if (!checkRateLimit()) {
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'assistant',
        content: rateLimitExceeded
          ? `Rate limit exceeded. You can make up to ${MAX_REQUESTS_PER_HOUR} requests per hour. Please try again later.`
          : `Please wait at least ${MIN_REQUEST_INTERVAL / 1000} seconds between requests.`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: input.trim() + (file ? ` [File: ${file.name}]` : ''),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setUploadStatus(file ? 'Processing PDF document...' : '');
    setRequestCount((prev) => prev + 1);
    setLastRequestTime(Date.now());
    setRateLimitExceeded(false);

    // Draft assistant message, filled progressively by the NDJSON stream.
    const draftId = (Date.now() + 1).toString();

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

      // Call server-side API route — API key never touches the browser
      const res = await fetch('/investment-tech-tree/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          context: chatContextTree(techTree),
          history: messages,
          topic,
          fileData,
          mode,
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to get response');
      }

      setMessages((prev) => [
        ...prev,
        { id: draftId, type: 'assistant', content: '', timestamp: Date.now() },
      ]);
      let draftText = '';
      let tools: string[] = [];
      const updateDraft = () =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === draftId
              ? { ...m, content: draftText, toolsUsed: [...tools] }
              : m,
          ),
        );

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
            text?: string;
            response?: string;
            error?: string;
            toolsUsed?: string[];
          };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === 'tool') {
            if (ev.name) tools.push(ev.name);
            setUploadStatus('Searching the knowledge graph…');
          } else if (ev.type === 'progress') {
            if (ev.text) setUploadStatus(ev.text);
          } else if (ev.type === 'delta') {
            draftText += ev.text ?? '';
            setUploadStatus('Writing answer…');
          } else if (ev.type === 'done') {
            tools = ev.toolsUsed ?? tools;
            if (ev.response) draftText = ev.response;
          } else if (ev.type === 'error') {
            throw new Error(ev.error || 'KG service error');
          }
          updateDraft();
        }
      }
      if (!draftText) draftText = 'No response received.';
      updateDraft();
    } catch (error) {
      console.error('Error sending message:', error);
      const errorText =
        error instanceof Error
          ? `Error: ${error.message}`
          : 'Sorry, there was an error processing your request. Please try again.';
      setMessages((prev) =>
        prev.some((m) => m.id === draftId)
          ? prev.map((m) =>
              m.id === draftId ? { ...m, content: errorText } : m,
            )
          : [
              ...prev,
              {
                id: draftId,
                type: 'assistant',
                content: errorText,
                timestamp: Date.now(),
              },
            ],
      );
    } finally {
      setIsLoading(false);
      setUploadStatus('');
      setFile(null);
    }
  };

  const clearHistory = () => {
    setMessages([]);
    const storageKey = `tech-tree-chat-history-${topic}`;
    localStorage.removeItem(storageKey);
    localStorage.removeItem(`tech-tree-chat-scroll-${topic}`);
  };

  const saveScrollPosition = () => {
    if (messagesContainerRef.current) {
      localStorage.setItem(
        `tech-tree-chat-scroll-${topic}`,
        messagesContainerRef.current.scrollTop.toString(),
      );
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

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold">Tech Tree Chat</CardTitle>
        <div className="flex items-center space-x-2">
          {rateLimitExceeded && (
            <Badge variant="destructive" className="text-xs">
              Rate Limited
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {requestCount}/{MAX_REQUESTS_PER_HOUR} requests per hour
          </Badge>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50"
              title="Clear Chat History"
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
              <p className="text-lg mb-4">Ask anything about the Tech Tree:</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {[
                  ['Explanation of Tech Tree', 'What is this Tech Tree about?'],
                  [
                    'Highest Impact',
                    'What are the enabling technologies with the highest impact?',
                  ],
                  [
                    'Highest TRL Technologies',
                    'Which technologies have the highest TRL?',
                  ],
                  [
                    'Investment Opportunities',
                    'What are the most promising investments?',
                  ],
                ].map(([label, question]) => (
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
                              ALLOWED_ATTR: ['class', 'href', 'target', 'rel', 'data-paperid'],
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
                  {message.toolsUsed?.length ? (
                    <details className="mt-2 text-xs text-gray-500">
                      <summary className="cursor-pointer hover:text-gray-700 select-none">
                        {message.toolsUsed.length} knowledge graph lookup
                        {message.toolsUsed.length === 1 ? '' : 's'}
                      </summary>
                      <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-gray-400 pl-3">
                        {message.toolsUsed.map((call, i) => (
                          <li key={i} className="break-all">{call}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <div
                    className={`text-xs mt-2 ${
                      message.type === 'user' ? 'text-slate-100' : 'text-gray-500'
                    }`}
                  >
                    {new Date(message.timestamp).toLocaleTimeString('de-DE', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
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
    </div>
  );
};

export default Chat;