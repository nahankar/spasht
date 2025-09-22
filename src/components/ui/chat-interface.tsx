'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isInterrupted?: boolean;
}

interface ChatInterfaceProps {
  messages: ChatMessage[];
  className?: string;
}

// Component for expandable message content - moved outside to prevent recreation
const MessageContent = ({ 
  content, 
  messageId, 
  expandedMessages, 
  setExpandedMessages 
}: { 
  content: string; 
  messageId: string;
  expandedMessages: Set<string>;
  setExpandedMessages: React.Dispatch<React.SetStateAction<Set<string>>>;
}) => {
  const isExpanded = expandedMessages.has(messageId);
  const isLongMessage = content.length > 80; // Reduced threshold
  
  // Removed debug logging to prevent console spam
  
  if (!isLongMessage) {
    return <p className="text-sm whitespace-pre-wrap">{content}</p>;
  }
  
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`🔍 SHOW MORE DEBUG: Show more clicked for ${messageId}, toggling expansion`);
    setExpandedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
        console.log(`🔍 SHOW MORE DEBUG: State update for ${messageId}: expanded -> collapsed`);
      } else {
        newSet.add(messageId);
        console.log(`🔍 SHOW MORE DEBUG: State update for ${messageId}: collapsed -> expanded`);
      }
      return newSet;
    });
  }, [messageId, setExpandedMessages]); // Stable dependencies
  
  return (
    <div>
      <p className="text-sm whitespace-pre-wrap">
        {isExpanded ? content : `${content.substring(0, 80)}...`}
      </p>
      <button
        type="button"
        onClick={handleToggle}
        className="text-xs opacity-70 hover:opacity-100 mt-1 underline cursor-pointer text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 block"
        style={{ display: 'block', zIndex: 10 }}
      >
        {isExpanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
};

export function ChatInterface({ messages, className = '' }: ChatInterfaceProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const formatTime = (timestamp: Date) => {
    // Use a consistent format that works the same on server and client
    const hours = timestamp.getHours().toString().padStart(2, '0');
    const minutes = timestamp.getMinutes().toString().padStart(2, '0');
    const seconds = timestamp.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  // Global state to preserve expansion state across re-renders
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex-shrink-0 bg-gray-50 border-b border-gray-200 px-4 py-3">
        <h3 className="text-lg font-medium text-gray-900">Conversation</h3>
        <p className="text-sm text-gray-500">Real-time chat with Nova Sonic</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>Start a conversation by clicking the microphone button</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-sm lg:max-w-lg xl:max-w-2xl px-4 py-2 rounded-lg relative ${
                  message.type === 'user'
                    ? 'bg-blue-500 text-white'
                    : message.isInterrupted
                    ? 'bg-red-100 text-red-800 border border-red-200'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {/* Message content */}
                <MessageContent 
                  content={message.content} 
                  messageId={message.id}
                  expandedMessages={expandedMessages}
                  setExpandedMessages={setExpandedMessages}
                />
                
                {/* Timestamp */}
                <div
                  className={`text-xs mt-1 ${
                    message.type === 'user'
                      ? 'text-blue-100'
                      : message.isInterrupted
                      ? 'text-red-500'
                      : 'text-gray-500'
                  }`}
                >
                  {formatTime(message.timestamp)}
                  {message.isInterrupted && (
                    <span className="ml-2 font-medium">⚠️ Interrupted</span>
                  )}
                </div>

                {/* Message type indicator */}
                <div
                  className={`absolute -bottom-2 ${
                    message.type === 'user' ? '-right-2' : '-left-2'
                  } w-4 h-4 rounded-full border-2 border-white ${
                    message.type === 'user'
                      ? 'bg-blue-500'
                      : message.isInterrupted
                      ? 'bg-red-500'
                      : 'bg-gray-400'
                  }`}
                >
                  <div className="w-full h-full rounded-full flex items-center justify-center">
                    {message.type === 'user' ? (
                      <span className="text-white text-xs font-bold">U</span>
                    ) : (
                      <span className="text-white text-xs font-bold">AI</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Status indicator */}
      <div className="flex-shrink-0 bg-gray-50 border-t border-gray-200 px-4 py-2">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{messages.length} messages</span>
          <span>Last updated: {messages.length > 0 ? formatTime(messages[messages.length - 1].timestamp) : '--:--:--'}</span>
        </div>
      </div>
    </div>
  );
}

export default ChatInterface;
