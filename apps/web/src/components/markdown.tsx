import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders agent-written markdown with North's serif body and mono labels (see `.prose-north` in globals.css). */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose-north" data-testid="artifact-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
