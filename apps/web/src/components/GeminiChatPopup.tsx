import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../features/chat/useChat';
import { useSession } from '../features/auth/SessionProvider';
import './GeminiChatPopup.css';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
}

export function GeminiChatPopup() {
  const { accessToken } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: 'স্বাগতম! আমি আভাস এআই সহকারী। ডেঙ্গুর লক্ষণ বা প্রতিরোধ বিষয়ে আপনাকে কীভাবে সাহায্য করতে পারি?', sender: 'bot' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [sessionId, setSessionId] = useState<string>(() => {
    try {
      const existing = sessionStorage.getItem('avash_chat_session_id');
      if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) {
        return existing;
      }
      const newId = crypto.randomUUID();
      sessionStorage.setItem('avash_chat_session_id', newId);
      return newId;
    } catch {
      return crypto.randomUUID();
    }
  });
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
      {
        messages: historyPayload,
        sessionId,
        accessToken: accessToken ?? undefined,
      },
      {
        onSuccess: (data) => {
          if (data.sessionId && data.sessionId !== sessionId) {
            setSessionId(data.sessionId);
            try {
              sessionStorage.setItem('avash_chat_session_id', data.sessionId);
            } catch {
              // Ignore storage errors
            }
          }
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
            text: "দুঃখিত, সার্ভারের সাথে সংযোগ স্থাপনে সমস্যা হচ্ছে। অনুগ্রহ করে একটু পর আবার চেষ্টা করুন।",
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
          aria-label="চ্যাটবট খুলুন"
        >
          {/* Gemini Sparkle Icon */}
          <img src="/icons/gemini.svg" alt="Gemini" style={{ width: "40px" }} />
        </button>
      )}

      {isOpen && (
        <div className="gemini-chat-window">
          <div className="gemini-header">
            <div className="gemini-header-title">
              <img src="/icons/gemini-2.svg" alt="Gemini" style={{ width: "27px", height: "27px" }} aria-hidden="true" />
              আভাস এআই সহকারী
            </div>
            <button className="gemini-close-btn" onClick={toggleChat} aria-label="চ্যাটবট বন্ধ করুন">
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
              placeholder="ডেঙ্গু সম্পর্কে যেকোনো প্রশ্ন লিখুন..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="submit"
              className="gemini-send-btn"
              disabled={!inputValue.trim()}
              aria-label="বার্তা পাঠান"
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
