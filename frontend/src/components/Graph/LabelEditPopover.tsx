import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { FaBold, FaItalic, FaLink, FaTrash, FaFont, FaFillDrip } from 'react-icons/fa6';
import { LabelColorPicker } from '@/components/Common/LabelColorPicker';
import type { TraceLabel, LabelFontSize, LabelShape } from '@/types/investigation';

type LabelPatch = { text: string; color?: string; bgColor?: string; fontSize?: LabelFontSize; shape?: LabelShape };

interface Props {
  initialLabel: TraceLabel;
  position: { x: number; y: number }; // rendered coords on the graph
  onSave: (patch: LabelPatch) => void;
  onCancel: () => void;
  onDelete: () => void;
}

const FONT_SIZE_OPTIONS: { value: LabelFontSize; label: string }[] = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

// Each shape button renders a small preview of the resulting wrapper shape so
// the icon IS the label — no text/tooltip required to identify which is which.
const SHAPE_OPTIONS: { value: LabelShape; label: string; borderRadius: string }[] = [
  { value: 'rectangle', label: 'Rectangle', borderRadius: '0' },
  { value: 'rounded', label: 'Rounded', borderRadius: '3px' },
  { value: 'pill', label: 'Pill', borderRadius: '999px' },
  { value: 'ellipse', label: 'Ellipse', borderRadius: '50%' },
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

export function LabelEditPopover({ initialLabel, position, onSave, onCancel, onDelete }: Props) {
  const [text, setText] = useState(initialLabel.text);
  const [color, setColor] = useState(initialLabel.color ?? '');
  const [bgColor, setBgColor] = useState(initialLabel.bgColor ?? '');
  const [fontSize, setFontSize] = useState<LabelFontSize>(initialLabel.fontSize ?? 'md');
  const [shape, setShape] = useState<LabelShape>(initialLabel.shape ?? 'rounded');
  // Delete confirm: first click arms; click again within ~3s confirms; otherwise resets.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const deleteResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track current values in refs for the click-outside handler so it always sees fresh values.
  const textRef = useRef(text);
  textRef.current = text;
  const colorRef = useRef(color);
  colorRef.current = color;
  const bgColorRef = useRef(bgColor);
  bgColorRef.current = bgColor;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const shapeRef = useRef(shape);
  shapeRef.current = shape;

  // Click-outside saves; Esc cancels.
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onSave({
          text: textRef.current,
          color: colorRef.current || undefined,
          bgColor: bgColorRef.current || undefined,
          fontSize: fontSizeRef.current,
          shape: shapeRef.current,
        });
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
    onSave({ text, color: color || undefined, bgColor: bgColor || undefined, fontSize, shape });
  };

  const handleDeleteClick = () => {
    if (deleteArmed) {
      if (deleteResetTimeoutRef.current) clearTimeout(deleteResetTimeoutRef.current);
      onDelete();
      return;
    }
    setDeleteArmed(true);
    deleteResetTimeoutRef.current = setTimeout(() => setDeleteArmed(false), 3000);
  };

  useEffect(() => () => {
    if (deleteResetTimeoutRef.current) clearTimeout(deleteResetTimeoutRef.current);
  }, []);

  const toolbarBtnStyle: React.CSSProperties = {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 4,
    color: '#d1d5db',
    cursor: 'pointer',
    padding: 0,
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    transition: 'background 0.12s, border-color 0.12s',
  };

  const selectStyle: React.CSSProperties = {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 4,
    color: '#d1d5db',
    fontSize: 11,
    padding: '0 6px',
    height: 26,
    cursor: 'pointer',
    transition: 'border-color 0.12s',
  };

  const dividerStyle: React.CSSProperties = {
    width: 1,
    height: 18,
    background: '#374151',
    margin: '0 4px',
    flexShrink: 0,
  };

  // Color group: an icon + a color swatch grouped into a single bordered unit
  // so each picker reads as one labeled control rather than a bare circle.
  const colorGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 8px',
    height: 26,
    border: '1px solid #374151',
    borderRadius: 4,
    background: '#1f2937',
  };

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y + 20,
        zIndex: 50,
        width: 380,
        background: '#0b1220',
        border: '1px solid #4b5563',
        borderRadius: 8,
        padding: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
      }}
    >
      {/* Toolbar — three groups separated by dividers:
          1) inline markdown   (B / I / Link)
          2) colors            (text + background, each labeled by an icon)
          3) typography/shape  (size + shape dropdowns) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          title="Bold"
          style={{ ...toolbarBtnStyle, fontWeight: 700 }}
          onMouseDown={(e) => { e.preventDefault(); wrapSelection('**', '**', 'bold'); }}
        >
          <FaBold size={11} />
        </button>
        <button
          type="button"
          title="Italic"
          style={{ ...toolbarBtnStyle, fontStyle: 'italic' }}
          onMouseDown={(e) => { e.preventDefault(); wrapSelection('*', '*', 'italic'); }}
        >
          <FaItalic size={11} />
        </button>
        <button
          type="button"
          title="Link"
          style={toolbarBtnStyle}
          onMouseDown={(e) => { e.preventDefault(); wrapSelection('[', '](url)', 'text'); }}
        >
          <FaLink size={11} />
        </button>

        <div style={dividerStyle} />

        {/* Text color: "A" glyph + swatch grouped together */}
        <div style={colorGroupStyle} title="Text color">
          <FaFont size={10} color="#9ca3af" />
          <LabelColorPicker color={color} onChange={setColor} />
        </div>

        {/* Background color: fill-bucket glyph + swatch grouped together */}
        <div style={colorGroupStyle} title="Background color">
          <FaFillDrip size={10} color="#9ca3af" />
          <LabelColorPicker color={bgColor} onChange={setBgColor} />
        </div>

        <div style={dividerStyle} />

        {/* Font size dropdown */}
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as LabelFontSize)}
          style={selectStyle}
          title="Font size"
        >
          {FONT_SIZE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Shape — inline row of preview swatches; each button renders the actual shape */}
        <div
          role="radiogroup"
          aria-label="Shape"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: 2,
            height: 26,
            border: '1px solid #374151',
            borderRadius: 4,
            background: '#1f2937',
          }}
        >
          {SHAPE_OPTIONS.map((o) => {
            const active = shape === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={active}
                title={o.label}
                onClick={() => setShape(o.value)}
                style={{
                  width: 22,
                  height: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: active ? '#374151' : 'transparent',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'background 0.12s',
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 10,
                    background: active ? '#f3f4f6' : '#9ca3af',
                    borderRadius: o.borderRadius,
                    display: 'block',
                    transition: 'background 0.12s',
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          width: '100%',
          minHeight: 90,
          background: '#111827',
          color: '#f3f4f6',
          border: '1px solid #374151',
          borderRadius: 6,
          padding: 8,
          fontSize: 12,
          fontFamily: 'ui-monospace,SFMono-Regular,monospace',
          boxSizing: 'border-box',
          resize: 'vertical',
          outline: 'none',
        }}
        placeholder="Markdown supported. Esc to cancel."
      />

      {/* Preview header */}
      <div
        style={{
          marginTop: 10,
          marginBottom: 4,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: '#6b7280',
        }}
      >
        Preview
      </div>

      {/* Preview — applies the chosen text + bg color so the user can verify pairings */}
      <div
        style={{
          padding: '8px 10px',
          background: bgColor || '#111827',
          border: '1px solid #1f2937',
          borderRadius: 6,
          fontSize: 11,
          color: color || '#d1d5db',
          lineHeight: 1.4,
          minHeight: 28,
        }}
      >
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{text || '*preview*'}</ReactMarkdown>
      </div>

      {/* Footer: [Delete] (left)   [Cancel] [Save] (right) */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center' }}>
        <button
          type="button"
          onClick={handleDeleteClick}
          onMouseLeave={() => {
            if (deleteArmed) {
              if (deleteResetTimeoutRef.current) clearTimeout(deleteResetTimeoutRef.current);
              setDeleteArmed(false);
            }
          }}
          title={deleteArmed ? 'Click again to confirm' : 'Delete label'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 6,
            border: deleteArmed ? '1px solid #ef4444' : '1px solid #374151',
            background: deleteArmed ? '#7f1d1d' : '#1f2937',
            color: deleteArmed ? '#fecaca' : '#d1d5db',
            cursor: 'pointer',
            transition: 'background 0.12s, border-color 0.12s, color 0.12s',
          }}
        >
          <FaTrash size={10} />
          {deleteArmed ? 'Confirm delete' : 'Delete'}
        </button>
        <div style={{ flex: 1 }} />
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
