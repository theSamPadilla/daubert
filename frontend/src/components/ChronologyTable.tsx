'use client';

import { FaArrowUpRightFromSquare } from 'react-icons/fa6';

interface ChronologyEntry {
  source: string | null;
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
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800/50 text-left text-gray-400">
              <th className="px-4 py-3 w-48">Source</th>
              <th className="px-4 py-3 w-28">Date</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 w-64">Details</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, i) => (
              <tr key={i} className="border-t border-gray-700/50 align-top">
                <td className="px-4 py-3">
                  {entry.source ? (
                    <a
                      href={entry.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 break-all text-xs font-mono"
                    >
                      {truncateUrl(entry.source)}
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
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {entry.details || '--'}
                </td>
              </tr>
            ))}
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

function truncateUrl(url: string, max = 40): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    if (path.length > max) return u.host + path.slice(0, max) + '...';
    return u.host + path;
  } catch {
    return url.length > max ? url.slice(0, max) + '...' : url;
  }
}
