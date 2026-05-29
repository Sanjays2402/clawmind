'use client';
import { useState } from 'react';
import { ChatShell } from '@/components/ChatShell';

export default function ChatPage() {
  const [thread, setThread] = useState<string | null>(null);
  return <ChatShell threadId={thread} onThread={setThread} />;
}
