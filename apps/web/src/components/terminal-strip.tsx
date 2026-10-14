/** The thin terminal log at the top of public pages: what the agents are doing right now. */
export function TerminalStrip({ lines }: { lines: readonly string[] }) {
  const last = lines[lines.length - 1] ?? ">";
  return (
    <div className="terminal px-4 py-2" aria-label="Agent activity">
      {lines.slice(0, -1).map((line, i) => (
        <div key={i} className="text-gray-55">
          {line}
        </div>
      ))}
      <div className="cursor-blink">{last} </div>
    </div>
  );
}
