'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Send, Upload } from 'lucide-react';
import { useTechTree } from '@/hooks/useTechTree';
import { chatContextTree } from '@/lib/smrFilters';
import { TopicKey } from '@/lib/topicConfig';
import DOMPurify from 'dompurify';
import { Badge } from '@/components/ui/badge';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface AiAssistantPanelProps {
  topic: TopicKey;
}

const AiAssistantPanel: React.FC<AiAssistantPanelProps> = ({ topic }) => {
  const { techTree } = useTechTree(topic);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.type === 'user') {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleSuggestedQuestion = (question: string) => {
    setMessage(question);
    textareaRef.current?.focus();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!message.trim() && !file) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: message.trim() + (file ? ` [File: ${file.name}]` : ''),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Convert file to base64 on the client if present
      let fileData: { base64: string; mimeType: string } | null = null;
      if (file) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () =>
            resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        fileData = { base64, mimeType: file.type };
      }

      // Call server-side API route — API key never touches the browser
      const res = await fetch('/investment-tech-tree/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          context: chatContextTree(techTree),
          history: messages,
          topic,
          fileData,
          mode: 'instant',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to get response');
      }

      const data = await res.json();

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: data.response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      setMessage('');
      setFile(null);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get AI response'}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.length === 0 ? (
          <Card>
            <CardContent className="text-center text-gray-500 mt-8">
              <p className="text-lg mb-4">AI Assistant for Tech Tree Editing</p>
              <p className="text-sm text-gray-600 max-w-md mx-auto mb-4">
                Upload a document with evidence (e.g., a research paper) for
                analysis, or use one of the prompts below to get started.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {[
                  [
                    'Analyze document for new tech',
                    'Analyze the attached document for new "EnablingTechnology" nodes.',
                  ],
                  [
                    'Update TRL from paper',
                    'Based on the attached paper, suggest updates to the TRL of existing nodes.',
                  ],
                  [
                    'Suggest new edges',
                    'Identify any missing dependencies or connections based on this document.',
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
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.type === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <Card
                className={`max-w-[80%] ${
                  msg.type === 'user'
                    ? 'bg-slate-600 text-white border-slate-600'
                    : 'bg-gray-100 text-gray-900 border'
                }`}
              >
                <CardContent
                  className={`p-4 ${msg.type === 'user' ? 'p-3' : 'p-4 pl-6'}`}
                >
                  <div className="break-words">
                    {msg.type === 'assistant' ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            msg.content
                              .replace(/^```html\s*/i, '')
                              .replace(/```[\s\n]*$/, ''),
                            {
                              ALLOWED_TAGS: [
                                'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li',
                                'strong', 'em', 'table', 'thead', 'tbody',
                                'tr', 'td', 'th', 'code', 'pre', 'br', 'a',
                              ],
                              ALLOWED_ATTR: ['class', 'href', 'target', 'rel'],
                            },
                          ),
                        }}
                        className="prose prose-sm max-w-none [&_table]:overflow-x-auto [&_table]:block [&_table]:w-full [&_table]:border-collapse [&_table]:border [&_table]:border-gray-300 [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2 [&_td]:whitespace-nowrap [&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-gray-50 [&_th]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:mb-3 [&_ol]:text-gray-700 [&_li]:mb-1 [&_a]:text-blue-600 [&_a]:hover:underline"
                      />
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}
                  </div>
                  <div
                    className={`text-xs mt-2 ${
                      msg.type === 'user' ? 'text-slate-100' : 'text-gray-500'
                    }`}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString('de-DE', {
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
                  <span className="text-gray-500">Analyzing...</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4">
        {file && (
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-600 bg-gray-50 p-2 rounded">
            <Upload size={14} />
            <span className="flex-1">{file.name}</span>
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
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about the tech tree or request suggestions..."
              className="w-full resize-none pr-24 max-h-32"
              rows={1}
              disabled={isLoading}
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1">
              <label htmlFor="file-upload">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="p-1 h-8 w-8 cursor-pointer"
                  disabled={isLoading}
                  onClick={() =>
                    document.getElementById('file-upload')?.click()
                  }
                >
                  <Upload size={18} />
                </Button>
              </label>
              <input
                id="file-upload"
                type="file"
                accept=".txt,.pdf,.doc,.docx"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                type="submit"
                size="sm"
                disabled={(!message.trim() && !file) || isLoading}
                className="p-1 h-8 w-8"
              >
                <Send size={18} />
              </Button>
            </div>
          </div>
        </form>
        <p className="text-xs text-gray-500 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
};

export default AiAssistantPanel;