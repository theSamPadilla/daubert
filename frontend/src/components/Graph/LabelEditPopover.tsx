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
 * If no selection but the textarea has content, wrap the entire content
 * (so clicking Bold on existing text bolds that text rather than inserting a new tag).
 * If no selection and no content, insert prefix + placeholder + suffix at the caret.
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
  // No selection but text exists → wrap the whole thing.
  if (start === end && text.length > 0) {
    start = 0;
    end = text.length;
  }
  if (start !== end) {
    const selected = text.slice(start, end);
    const next = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    return { next, selStart: start + prefix.length, selEnd: start + prefix.length + selected.length };
  }
  // No selection and empty textarea — insert template at caret
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

  // Shared chrome classes — canvas-token treatment so the popover stays dark over the canvas.
  const toolbarBtnClass =
    'flex items-center justify-center w-[26px] h-[26px] rounded-lg border border-canvas-line bg-canvas-fill text-canvas-ink p-0 cursor-pointer transition-colors hover:bg-white/10';
  const selectClass =
    'h-[26px] px-1.5 rounded-lg border border-canvas-line bg-canvas-fill text-canvas-ink text-[11px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';
  const colorGroupClass =
    'flex items-center gap-1.5 px-2 h-[26px] rounded-lg border border-canvas-line bg-canvas-fill';

  return (
    <div
      ref={wrapRef}
      className="absolute z-30 w-[380px] rounded-xl border border-canvas-line bg-canvas/90 backdrop-blur text-canvas-ink p-3 shadow-2xl"
      style={{
        left: position.x,
        top: position.y + 20,
      }}
    >
      {/* Toolbar — three groups separated by dividers:
          1) inline markdown   (B / I / Link)
          2) colors            (text + background, each labeled by an icon)
          3) typography/shape  (size + shape dropdowns) */}
      <div className="flex items-center gap-1 mb-2.5 flex-wrap">
        <button
          type="button"
          title="Bold"
          className={`${toolbarBtnClass} font-bold`}
          onMouseDown={(e) => { e.preventDefault(); wrapSelection('**', '**', 'bold'); }}
        >
          <FaBold size={11} />
        </button>
        <button
          type="button"
          title="Italic"
          className={`${toolbarBtnClass} italic`}
          onMouseDown={(e) => { e.preventDefault(); wrapSelection('*', '*', 'italic'); }}
        >
          <FaItalic size={11} />
        </button>
        <button
          type="button"
          title="Link"
          className={toolbarBtnClass}
          onMouseDown={(e) => { e.preventDefault(); wrapSelection('[', '](url)', 'text'); }}
        >
          <FaLink size={11} />
        </button>

        <div className="w-px h-[18px] bg-canvas-line mx-1 shrink-0" />

        {/* Text color: "A" glyph + swatch grouped together */}
        <div className={colorGroupClass} title="Text color">
          <FaFont size={10} className="text-canvas-muted" />
          <LabelColorPicker color={color} onChange={setColor} />
        </div>

        {/* Background color: fill-bucket glyph + swatch grouped together */}
        <div className={colorGroupClass} title="Background color">
          <FaFillDrip size={10} className="text-canvas-muted" />
          <LabelColorPicker color={bgColor} onChange={setBgColor} />
        </div>

        <div className="w-px h-[18px] bg-canvas-line mx-1 shrink-0" />

        {/* Font size dropdown */}
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as LabelFontSize)}
          className={selectClass}
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
          className="flex items-center gap-0.5 p-0.5 h-[26px] rounded-lg border border-canvas-line bg-canvas-fill"
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
                className={`flex items-center justify-center w-[22px] h-5 rounded p-0 cursor-pointer transition-colors ${active ? 'bg-white/15' : 'bg-transparent'}`}
              >
                <span
                  className={`block w-[14px] h-2.5 transition-colors ${active ? 'bg-canvas-ink' : 'bg-canvas-muted'}`}
                  style={{ borderRadius: o.borderRadius }}
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
        className="w-full min-h-[90px] box-border resize-y rounded-lg border border-canvas-line bg-canvas-fill text-canvas-ink text-xs font-mono p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 placeholder:text-canvas-muted"
        placeholder="Markdown supported. Esc to cancel."
      />

      {/* Preview header */}
      <div className="mt-2.5 mb-1 text-[10px] font-semibold uppercase tracking-wide text-canvas-muted">
        Preview
      </div>

      {/* Preview — applies the chosen text + bg color so the user can verify pairings.
          bgColor/color are user content; fallbacks use canvas tokens. */}
      <div
        className="px-2.5 py-2 rounded-lg border border-canvas-line text-[11px] leading-snug min-h-[28px]"
        style={{
          background: bgColor || 'var(--canvas-fill)',
          color: color || 'var(--canvas-ink)',
        }}
      >
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{text || '*preview*'}</ReactMarkdown>
      </div>

      {/* Footer: [Delete] (left)   [Cancel] [Save] (right) */}
      <div className="flex items-center gap-1.5 mt-3">
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
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
            deleteArmed
              ? 'border-red-500 bg-red-900/40 text-red-200'
              : 'border-canvas-line bg-canvas-fill text-canvas-muted hover:text-red-300'
          }`}
        >
          <FaTrash size={10} />
          {deleteArmed ? 'Confirm delete' : 'Delete'}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded-lg border border-canvas-line text-canvas-muted hover:text-canvas-ink hover:bg-canvas-fill transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-1.5 text-xs rounded-lg bg-brand text-white hover:bg-brand-strong transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
