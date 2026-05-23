import type { TransactionEdge } from '@/types/investigation';
import { MultiTxDetails } from '../MultiTxDetails';

interface AggregatedEdgeDetailsProps {
  edges: TransactionEdge[];
  fromLabel: string;
  toLabel: string;
  traceId: string;
  onArcEdge?: (delta: number | null) => void;
  onUpdateTransaction?: (traceId: string, txId: string, updates: Partial<TransactionEdge>) => void;
  onDeleteTransaction?: (traceId: string, txId: string) => void;
}

export function AggregatedEdgeDetails({ edges, fromLabel, toLabel, traceId, onArcEdge, onUpdateTransaction, onDeleteTransaction }: AggregatedEdgeDetailsProps) {
  const currentColor = edges[0]?.color || '#10b981';
  const handleColorChange = onUpdateTransaction
    ? (color: string) => {
        edges.forEach((e) => onUpdateTransaction(traceId, e.id, { color }));
      }
    : undefined;
  const handleDeleteTransaction = onDeleteTransaction
    ? (txId: string) => onDeleteTransaction(traceId, txId)
    : undefined;
  return (
    <MultiTxDetails
      edges={edges}
      staticTitle={`${fromLabel} → ${toLabel}`}
      headerKind="aggregated"
      tokenChip={null}
      onArcEdge={onArcEdge}
      color={currentColor}
      onColorChange={handleColorChange}
      onDeleteTransaction={handleDeleteTransaction}
    />
  );
}
