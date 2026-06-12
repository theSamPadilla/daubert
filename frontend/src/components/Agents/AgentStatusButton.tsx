'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaRobot } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';

type AgentStatus = 'loading' | 'connected' | 'disconnected' | 'error';

export function AgentStatusButton() {
  const router = useRouter();
  const [status, setStatus] = useState<AgentStatus>('loading');
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listOauthSessions()
      .then((sessions) => {
        if (cancelled) return;
        setCount(sessions.length);
        setStatus(sessions.length > 0 ? 'connected' : 'disconnected');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading' || status === 'error') return null;

  const connected = status === 'connected';

  return (
    <button
      onClick={() => router.push(connected ? '/account#agents' : '/account?connect=1#agents')}
      title={
        connected
          ? 'Manage your connected agents'
          : 'Connect your own AI agent to Daubert'
      }
      className={
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ' +
        (connected
          ? 'border-line-strong/60 bg-surface/40 text-ink-muted hover:text-white hover:border-brand-ink/40'
          : 'border-brand-ink/40 bg-brand/10 text-brand-ink hover:bg-brand/20')
      }
    >
      <FaRobot size={12} />
      <span
        className={
          'h-1.5 w-1.5 rounded-full ' +
          (connected ? 'bg-emerald-400' : 'bg-ink-faint')
        }
        aria-hidden
      />
      {connected
        ? count === 1
          ? 'Agent connected'
          : `${count} agents connected`
        : 'Connect agent'}
    </button>
  );
}
