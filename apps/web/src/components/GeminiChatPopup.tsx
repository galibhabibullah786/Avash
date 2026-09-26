import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../features/chat/useChat';
import './GeminiChatPopup.css';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
}

export function GeminiChatPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: 'Hi there! I am Aavash AI. How can I help you today?', sender: 'bot' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { mutate: sendMessage, isPending: isTyping } = useChat();

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, isOpen]);

  const toggleChat = () => setIsOpen((prev) => !prev);

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputValue.trim(),
      sender: 'user',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');

    const historyPayload = messages.map(m => ({ text: m.text, sender: m.sender })).concat([{ text: userMessage.text, sender: 'user' }]);

    sendMessage(
      { messages: historyPayload },
      {
        onSuccess: (data) => {
          const botMessage: Message = {
            id: Date.now().toString(),
            text: data.text,
            sender: 'bot',
          };
          setMessages((prev) => [...prev, botMessage]);
        },
        onError: () => {
          const errorMessage: Message = {
            id: Date.now().toString(),
            text: "Sorry, I'm having trouble connecting to the server.",
            sender: 'bot',
          };
          setMessages((prev) => [...prev, errorMessage]);
        }
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  };

  return (
    <div className="gemini-popup">
      {!isOpen && (
        <button
          className="gemini-fab"
          onClick={toggleChat}
          aria-label="Open Chat"
        >
          {/* Gemini Sparkle Icon */}
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11.9995 0L13.8824 8.11762L21.9995 10L13.8824 11.8824L11.9995 20L10.1171 11.8824L1.99951 10L10.1171 8.11762L11.9995 0Z" fill="currentColor" />
            <path d="M19.4995 16L20.2526 19.2474L23.4995 20L20.2526 20.7526L19.4995 24L18.7469 20.7526L15.4995 20L18.7469 19.2474L19.4995 16Z" fill="currentColor" />
          </svg>
        </button>
      )}

      {isOpen && (
        <div className="gemini-chat-window">
          <div className="gemini-header">
            <div className="gemini-header-title">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.9995 0L13.8824 8.11762L21.9995 10L13.8824 11.8824L11.9995 20L10.1171 11.8824L1.99951 10L10.1171 8.11762L11.9995 0Z" fill="currentColor" />
              </svg>
              Aavash AI Assistant
            </div>
            <button className="gemini-close-btn" onClick={toggleChat} aria-label="Close Chat">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div className="gemini-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`gemini-message ${msg.sender}`}>
                {msg.text}
              </div>
            ))}
            {isTyping && (
              <div className="gemini-message bot gemini-typing">
                <div className="gemini-dot"></div>
                <div className="gemini-dot"></div>
                <div className="gemini-dot"></div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="gemini-input-area" onSubmit={handleSendMessage}>
            <input
              type="text"
              className="gemini-input"
              placeholder="Ask Gemini..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="submit"
              className="gemini-send-btn"
              disabled={!inputValue.trim()}
              aria-label="Send message"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
