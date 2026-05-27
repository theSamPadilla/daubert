import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

interface Props {
  initialText: string;
  position: { x: number; y: number }; // rendered coords on the graph
  onSave: (text: string) => void;
  onCancel: () => void;
}

export function LabelEditPopover({ initialText, position, onSave, onCancel }: Props) {
  const [text, setText] = useState(initialText);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-outside saves; Esc cancels.
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onSave(text);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [text, onSave, onCancel]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y + 20,
        zIndex: 50,
        width: 320,
        background: '#0b1220',
        border: '1px solid #4b5563',
        borderRadius: 6,
        padding: 8,
        boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
      }}
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          width: '100%',
          minHeight: 80,
          background: '#111827',
          color: '#f3f4f6',
          border: '1px solid #374151',
          borderRadius: 4,
          padding: 6,
          fontSize: 12,
          fontFamily: 'ui-monospace,SFMono-Regular,monospace',
        }}
        placeholder="Markdown supported. Esc to cancel, click outside to save."
      />
      <div
        style={{
          marginTop: 6,
          padding: 6,
          background: '#111827',
          borderRadius: 4,
          fontSize: 11,
          color: '#d1d5db',
        }}
      >
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{text || '*preview*'}</ReactMarkdown>
      </div>
    </div>
  );
}
