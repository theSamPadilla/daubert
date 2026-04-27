'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { useState, useEffect, useCallback } from 'react';
import {
  FaBold,
  FaItalic,
  FaUnderline,
  FaHeading,
  FaList,
  FaListOl,
  FaRotateLeft,
  FaRotateRight,
  FaQuoteRight,
} from 'react-icons/fa6';
import { CitationPicker } from './CitationPicker';

interface ReportEditorProps {
  content: string;
  editable: boolean;
  onChange?: (html: string) => void;
}

function ToolbarButton({
  onClick,
  isActive,
  children,
  title,
}: {
  onClick: () => void;
  isActive?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        isActive
          ? 'bg-blue-900/50 text-blue-300'
          : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, onInsertCitation }: { editor: ReturnType<typeof useEditor>; onInsertCitation?: () => void }) {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 bg-gray-700/50 border-b border-gray-600 rounded-t-lg flex-wrap">
      {/* Bold / Italic / Underline */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold (Ctrl+B)"
      >
        <FaBold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic (Ctrl+I)"
      >
        <FaItalic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="Underline (Ctrl+U)"
      >
        <FaUnderline className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="w-px h-4 bg-gray-600 mx-1" />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        title="Heading 2"
      >
        <span className="flex items-center gap-0.5">
          <FaHeading className="h-3.5 w-3.5" />
          <span className="text-[10px] font-bold">2</span>
        </span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive('heading', { level: 3 })}
        title="Heading 3"
      >
        <span className="flex items-center gap-0.5">
          <FaHeading className="h-3 w-3" />
          <span className="text-[10px] font-bold">3</span>
        </span>
      </ToolbarButton>

      <div className="w-px h-4 bg-gray-600 mx-1" />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="Bullet List"
      >
        <FaList className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="Numbered List"
      >
        <FaListOl className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="w-px h-4 bg-gray-600 mx-1" />

      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo (Ctrl+Z)"
      >
        <FaRotateLeft className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo (Ctrl+Shift+Z)"
      >
        <FaRotateRight className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="w-px h-4 bg-gray-600 mx-1" />
      <ToolbarButton
        onClick={() => onInsertCitation?.()}
        title="Insert Citation"
      >
        <FaQuoteRight className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}

export function ReportEditor({
  content,
  editable,
  onChange,
}: ReportEditorProps) {
  const [showCitationPicker, setShowCitationPicker] = useState(false);

  const handleUpdate = useCallback(
    ({ editor }: { editor: any }) => {
      onChange?.(editor.getHTML());
    },
    [onChange],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
    ],
    content,
    editable,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class: [
          'prose prose-sm prose-invert max-w-none outline-none min-h-[200px] p-4',
          'prose-headings:text-white',
          'prose-p:text-gray-300',
          'prose-strong:text-white',
          'prose-ul:text-gray-300',
          'prose-ol:text-gray-300',
          'prose-li:text-gray-300',
          'prose-a:text-blue-400',
          'prose-blockquote:border-blue-500',
          'prose-blockquote:text-gray-400',
        ].join(' '),
      },
    },
  });

  // Sync editable state
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  // Sync content from props when not editing (e.g. during agent streaming)
  useEffect(() => {
    if (editor && !editable) {
      const currentHtml = editor.getHTML();
      if (currentHtml !== content) {
        editor.commands.setContent(content, { emitUpdate: false });
      }
    }
  }, [editor, content, editable]);

  const handleInsertCitation = useCallback(
    (citation: { type: string; label: string; url: string }) => {
      if (!editor || editor.isDestroyed) return;
      const escapeAttr = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeLabel = escapeAttr(citation.label);
      const safeUrl = escapeAttr(citation.url);
      editor.chain().focus().insertContent(
        `<span class="citation" data-cite-type="${citation.type}" data-cite-label="${safeLabel}" data-cite-url="${safeUrl}" title="${safeLabel}">[*]</span> `
      ).run();
      setShowCitationPicker(false);
    },
    [editor],
  );

  if (!editor) return null;

  return (
    <>
      <div
        className={`report-editor ${
          editable
            ? 'ring-2 ring-blue-500/50 rounded-lg border border-gray-600 overflow-hidden'
            : ''
        }`}
      >
        <style>{`.report-editor .citation { color: #60a5fa; font-size: 0.75em; vertical-align: super; background: rgba(59, 130, 246, 0.1); padding: 0 2px; border-radius: 2px; cursor: default; }`}</style>
        {editable && <Toolbar editor={editor} onInsertCitation={() => setShowCitationPicker(true)} />}
        <div className={editable ? 'p-3' : ''}>
          <EditorContent editor={editor} />
        </div>
      </div>
      {showCitationPicker && (
        <CitationPicker
          onInsert={handleInsertCitation}
          onClose={() => setShowCitationPicker(false)}
        />
      )}
    </>
  );
}
