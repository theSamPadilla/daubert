import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { createRoot, Root } from 'react-dom/client';

export function LabelOverlay({ text }: { text: string }) {
  return (
    <div className="label-markdown">
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          p: ({ node, ...props }) => <p {...props} style={{ margin: 0 }} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const roots = new WeakMap<HTMLElement, Root>();

export function renderLabelMarkdownInto(el: HTMLElement, text: string) {
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  root.render(<LabelOverlay text={text} />);
}
