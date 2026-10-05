'use client';

export interface Chip {
  id: string;
  text: string;
  state: 'live' | 'cached' | 'closed' | 'off';
  title: string; // where the data came from, shown on hover
}

// Small, always-visible labels for the data behind the current render (docs/SPEC.md → Data-source labels).
// Each chip reflects the source actually used (live / cached / market closed); data not in use has no chip.
export function SourceChips({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="chips" aria-label="Data sources">
      {chips.map(c => (
        <span key={c.id} className={`chip ${c.state}`} title={c.title}>
          <span className="dot" />
          {c.text}
        </span>
      ))}
    </div>
  );
}
