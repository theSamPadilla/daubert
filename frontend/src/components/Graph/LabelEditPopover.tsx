import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { FaBold, FaItalic, FaLink } from 'react-icons/fa6';
import { LabelColorPicker } from '@/components/Common/LabelColorPicker';
import type { TraceLabel, LabelFontSize } from '@/types/investigation';

type LabelPatch = { text: string; color?: string; fontSize?: LabelFontSize };

interface Props {
  initialLabel: TraceLabel;
  position: { x: number; y: number }; // rendered coords on the graph
  onSave: (patch: LabelPatch) => void;
  onCancel: () => void;
}

const FONT_SIZE_OPTIONS: { value: LabelFontSize; label: string }[] = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

/**
 * Wrap the current textarea selection with prefix/suffix.
 * If no selection, insert prefix + placeholder + suffix at the caret.
 * Returns the new text string plus the selection range to restore inside the wrapped content.
 */
function computeWrapped(
  text: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string,
): { next: string; selStart: number; selEnd: number } {
  if (start !== end) {
    const selected = text.slice(start, end);
    const next = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    return { next, selStart: start + prefix.length, selEnd: start + prefix.length + selected.length };
  }
  // No selection — insert template at caret
  const insert = prefix + placeholder + suffix;
  const next = text.slice(0, start) + insert + text.slice(start);
  return {
    next,
    selStart: start + prefix.length,
    selEnd: start + prefix.length + placeholder.length,
  };
}

export function LabelEditPopover({ initialLabel, position, onSave, onCancel }: Props) {
  const [text, setText] = useState(initialLabel.text);
  const [color, setColor] = useState(initialLabel.color ?? '');
  const [fontSize, setFontSize] = useState<LabelFontSize>(initialLabel.fontSize ?? 'md');
  const wrapRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track current values in refs for the click-outside handler so it always sees fresh values.
  const textRef = useRef(text);
  textRef.current = text;
  const colorRef = useRef(color);
  colorRef.current = color;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  // Click-outside saves; Esc cancels.
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onSave({ text: textRef.current, color: colorRef.current || undefined, fontSize: fontSizeRef.current });
      }
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
  }, [onSave, onCancel]);

  const wrapSelection = (prefix: string, suffix: string, placeholder: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const { next, selStart, selEnd } = computeWrapped(text, start, end, prefix, suffix, placeholder);
    setText(next);
    // Restore focus + selection after React re-renders the textarea value.
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  };

  const handleSave = () => {
    onSave({ text, color: color || undefined, fontSize });
  };

  const toolbarBtnStyle: React.CSSProperties = {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 3,
    color: '#d1d5db',
    cursor: 'pointer',
    padding: '2px 6px',
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 24,
    height: 22,
  };

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
      {/* Toolbar: [B] [I] [Link] | [Color] [Size] */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <button
          type="button"
          title="Bold"
          style={{ ...toolbarBtnStyle, fontWeight: 700 }}
          onMouseDown={(e) => { e.preventDefault(); wrapSelection('**', '**', 'bold'); }}
        >
          <FaBold size={10} />
        </button>
        <button
          type="button"
          title="Italic"
          style={{ ...toolbarBtnStyle, fontStyle: 'italic' }}
          onMouseDown={(e) => { e.preventDefault(); wrapSelection('*', '*', 'italic'); }}
        >
          <FaItalic size={10} />
        </button>
        <button
          type="button"
          title="Link"
          style={toolbarBtnStyle}
          onMouseDown={(e) => { e.preventDefault(); wrapSelection('[', '](url)', 'text'); }}
        >
          <FaLink size={10} />
        </button>

        {/* Divider */}
        <div style={{ width: 1, height: 16, background: '#374151', margin: '0 2px', flexShrink: 0 }} />

        {/* Color picker */}
        <LabelColorPicker color={color} onChange={setColor} />

        {/* Font size dropdown */}
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as LabelFontSize)}
          style={{
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 3,
            color: '#d1d5db',
            fontSize: 11,
            padding: '1px 4px',
            height: 22,
            cursor: 'pointer',
          }}
          title="Font size"
        >
          {FONT_SIZE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
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
          boxSizing: 'border-box',
          resize: 'vertical',
        }}
        placeholder="Markdown supported. Esc to cancel."
      />

      {/* Preview */}
      <div
        style={{
          marginTop: 6,
          padding: 6,
          background: '#111827',
          borderRadius: 4,
          fontSize: 11,
          color: color || '#d1d5db',
          lineHeight: 1.35,
        }}
      >
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{text || '*preview*'}</ReactMarkdown>
      </div>

      {/* Footer: Cancel + Save */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 bg-surface-raised hover:bg-surface-raised/80 rounded text-sm"
          style={{ fontSize: 12 }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-1.5 bg-brand hover:bg-brand/90 rounded text-sm"
          style={{ fontSize: 12 }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
