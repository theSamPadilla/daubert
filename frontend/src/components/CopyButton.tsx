import { useState } from 'react';
import { FaCopy, FaCheck } from 'react-icons/fa6';

interface CopyButtonProps {
  text: string;
  title?: string;
  className?: string;
  size?: number;
}

export function CopyButton({ text, title = 'Copy', className, size = 11 }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={className ?? 'shrink-0 mt-0.5 text-ink-faint hover:text-ink-muted transition-colors'}
      title={title}
    >
      {copied ? <FaCheck size={size} className="text-emerald-400" /> : <FaCopy size={size} />}
    </button>
  );
}
