'use client';

import { FaArrowUpRightFromSquare } from 'react-icons/fa6';

interface ChronologyEntry {
  /** @deprecated use sourceUrl. Still accepted for backward compatibility. */
  source?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  date: string;
  description: string;
  details?: string | null;
  sourceTraceId?: string;
  sourceEdgeId?: string;
}

interface ChronologyData {
  title?: string;
  entries: ChronologyEntry[];
}

interface ChronologyTableProps {
  data: ChronologyData;
}

export function ChronologyTable({ data }: ChronologyTableProps) {
  return (
    <div>
      {data.title && (
        <h2 className="text-xl font-bold text-white mb-4">{data.title}</h2>
      )}
      <div className="rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-32" />
            <col className="w-28" />
            <col />
            <col className="w-64" />
          </colgroup>
          <thead>
            <tr className="bg-gray-800/50 text-left text-gray-400">
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, i) => {
              const url = entry.sourceUrl ?? entry.source ?? null;
              const label = entry.sourceLabel ?? (url ? deriveSourceLabel(url) : null);
              return (
                <tr key={i} className="border-t border-gray-700/50 align-top">
                  <td className="px-4 py-3">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 text-xs font-mono"
                      >
                        {label ?? url}
                        <FaArrowUpRightFromSquare className="w-2.5 h-2.5 flex-shrink-0" />
                      </a>
                    ) : (
                      <span className="text-gray-500">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                    {entry.date}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {entry.description}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs break-words">
                    {entry.details || '--'}
                  </td>
                </tr>
              );
            })}
            {data.entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Pulls the last 0x-prefixed hex run (a tx/address hash) and returns "0x6ae5…".
// Falls back to host+path truncation when no hash is present.
function deriveSourceLabel(url: string): string {
  const matches = url.match(/0x[a-fA-F0-9]{8,}/g);
  if (matches && matches.length > 0) {
    return matches[matches.length - 1].slice(0, 6) + '…';
  }
  try {
    const u = new URL(url);
    const tail = u.pathname + u.search;
    return tail.length > 30 ? u.host + tail.slice(0, 30) + '…' : u.host + tail;
  } catch {
    return url.length > 32 ? url.slice(0, 32) + '…' : url;
  }
}
