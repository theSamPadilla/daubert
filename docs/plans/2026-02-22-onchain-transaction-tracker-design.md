# Onchain Transaction Tracker - Design Document

**Date**: 2026-02-22
**Status**: Draft
**Purpose**: Personal blockchain investigation tool with AI-assisted tracing

## Overview

A web-based transaction flow visualization tool for tracking and analyzing blockchain transactions across EVM-compatible chains. Uses node-based graph visualization with AI-assisted investigation capabilities.

## Core Principles

- **Prototype mentality** - Keep it simple, iterate quickly
- **Personal use** - No user auth, collaboration features
- **Manual control** - User decides what goes on canvas, AI assists with search
- **Flexible grouping** - Traces can be organized by time, wallet groups, or custom criteria

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Graph Visualization**: Cytoscape.js (compound nodes for trace grouping)
- **Styling**: Tailwind CSS
- **AI Providers**: Multi-provider (Gemini + Anthropic APIs)
- **Blockchain Data**: Etherscan-like APIs for EVM chains
- **Storage**: Local JSON files (one file per investigation)
- **Future**: SQLite migration for cross-investigation queries

## Supported Features

### Blockchain Support
- EVM-compatible chains (Ethereum, Polygon, Arbitrum, Base, etc.)
- All transaction types (native, ERC-20, ERC-721, ERC-1155)
- Initial focus on ERC-20 token transfers

### Investigation Features
- **Traces**: Collapsible groups of related transactions
  - Time-based segments
  - Wallet group-based
  - Custom criteria
  - Can connect across traces (cross-trace transactions)
  - Toggle visibility on/off
  - Named and color-coded

- **Rich Metadata**:
  - Transaction basics (hash, from/to, amount, timestamp)
  - Token information (symbol, decimals, contract)
  - USD values at time of transaction
  - Custom notes and tags
  - Wallet labels/identities
  - Custom color coding

### AI Capabilities
- **Query Assistant**: Answer questions about visible data
- **Autonomous Tracer**: Execute investigation tasks ("find connection between wallet A and B over 5 hops")
- **Pattern Detector**: Analyze and flag patterns (circular flows, wash trading, etc.)
- **Search Results**: Present transaction lists that user can click to add to canvas

## Data Model

### Investigation
```typescript
Investigation {
  id: string
  name: string
  description: string
  createdAt: Date
  traces: Trace[]
  metadata: Record<string, any>
}
```

### Trace
```typescript
Trace {
  id: string
  name: string                    // "J.S. Purchase Nov 2021"
  criteria: {
    type: 'time' | 'wallet-group' | 'custom'
    timeRange?: { start: Date, end: Date }
    wallets?: string[]
    description?: string
  }
  visible: boolean                // toggle on/off
  color?: string                  // trace container color
  nodes: WalletNode[]
  edges: TransactionEdge[]
  position?: { x: number, y: number }
  collapsed: boolean              // minimize to show just trace title
}
```

### WalletNode
```typescript
WalletNode {
  id: string                      // wallet address
  label: string                   // "JS Wallet", "Wintermute"
  address: string
  chain: string                   // 'ethereum', 'polygon', etc.
  color?: string
  notes: string
  tags: string[]
  position: { x: number, y: number }
  parentTrace: string             // trace ID (for Cytoscape compound nodes)
}
```

### TransactionEdge
```typescript
TransactionEdge {
  id: string                      // tx hash
  from: string                    // wallet node ID
  to: string                      // wallet node ID
  txHash: string
  chain: string
  timestamp: Date
  amount: string                  // token amount
  token: {
    address: string
    symbol: string
    decimals: number
  }
  usdValue?: number               // value at time of tx
  color?: string
  label?: string                  // custom label on arrow
  notes: string
  tags: string[]
  blockNumber: number
  crossTrace: boolean             // is this a cross-trace connection?
}
```

### Key Data Model Decisions
- Each trace contains its own nodes/edges
- Nodes can reference wallets that exist in multiple traces
- Cross-trace connections are edges where `from` and `to` belong to different parent traces
- Cytoscape compound nodes: traces are parents, wallets are children
- Collapsing a trace hides child nodes but shows trace container

## Component Architecture

### UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ Header: Investigation Name | File Menu | Chain Selector │
├──────────────────────────────┬──────────────────────────┤
│                              │                          │
│                              │  SIDE PANEL (400px)      │
│   CANVAS (Cytoscape)         ├──────────────────────────┤
│                              │  Contextual Details      │
│   - Graph visualization      │  (top section)           │
│   - Pan/Zoom controls        │                          │
│   - Minimap                  │  • Wallet details        │
│                              │  • Transaction details   │
│                              │  • Trace summary         │
│                              │  • Investigation stats   │
│                              │                          │
│                              ├──────────────────────────┤
│                              │  AI Chat                 │
│                              │  (bottom section)        │
│                              │                          │
│                              │  • Message history       │
│                              │  • Search results list   │
│                              │  • Click to add to graph │
│                              │                          │
└──────────────────────────────┴──────────────────────────┘
```

### Component Hierarchy

- `App`
  - `Header` - file operations, settings, chain selector
  - `MainView`
    - `GraphCanvas` - Cytoscape wrapper
      - `TraceContainer` - visual trace grouping
      - `WalletNode` - custom wallet rendering
      - `TransactionEdge` - custom edge rendering
    - `SidePanel`
      - `DetailsPanel` - contextual info (top)
        - `WalletDetails`
        - `TransactionDetails`
        - `TraceDetails`
        - `InvestigationStats`
      - `AIChat` - AI interface (bottom)
        - `MessageList`
        - `SearchResults` - clickable transaction list
        - `ChatInput`

### Key Interactions

- **Click wallet/edge/trace** → `DetailsPanel` updates with contextual info
- **AI returns search results** → shows in `SearchResults` as clickable list
- **Click transaction in results** → adds nodes/edges to `GraphCanvas`
- **Right-click node** → context menu (color picker, edit label, add notes)
- **Trace container** → collapse/expand, toggle visibility
- **File menu** → open/save investigation JSON, export options

## AI Integration

### Provider Abstraction

```typescript
interface AIProvider {
  name: 'gemini' | 'anthropic'
  sendMessage(messages: Message[], tools: Tool[]): Promise<AIResponse>
}
```

### AI Tools

The AI has access to these tools for blockchain investigation:

1. **search_transactions** - Query blockchain for transactions matching criteria
2. **get_wallet_history** - Fetch all activity for a wallet address
3. **trace_token_path** - Follow token through N hops of transfers
4. **analyze_pattern** - Detect patterns in current graph data
5. **get_token_price** - Fetch historical USD values for tokens

### AI → Canvas Flow

1. **User prompt**: "Find all USDC transfers from 0x3ddfa in Nov 2021"
2. **AI calls tool**: `search_transactions({ wallet: '0x3ddfa', token: 'USDC', dateRange: {...} })`
3. **Tool executes**: Queries Etherscan API → returns transaction list
4. **AI formats results**: Shows in `SearchResults` panel as clickable list
5. **User clicks transaction**:
   - Creates/updates `WalletNode` for from/to addresses
   - Creates `TransactionEdge`
   - Adds to active trace (or prompts to create new trace)
   - Updates Cytoscape graph
   - Auto-layouts new nodes

### Model Selection

- User can switch between Gemini and Anthropic in settings
- Default to Gemini for development (generous free tier)
- Provider abstraction allows adding more models later

## Blockchain API Integration

### API Strategy

- **Primary**: Etherscan API (free tier: 5 calls/sec)
- **Interface abstraction**: Can swap in Alchemy, Infura, or custom RPC
- **Caching**: Store API responses locally to avoid re-fetching
- **Multi-chain**: Support Etherscan-like APIs for each chain
  - Ethereum: etherscan.io
  - Polygon: polygonscan.com
  - Arbitrum: arbiscan.io
  - Base: basescan.org
  - etc.

### Data Sources

- Transaction history for wallet
- ERC-20 token transfers
- Token metadata (symbol, decimals)
- Historical token prices (CoinGecko API)
- Block timestamps

## File Format

### Investigation JSON Structure

```json
{
  "investigation": {
    "id": "uuid",
    "name": "JS Matter Investigation",
    "description": "Tracking NFT auction purchase flows",
    "createdAt": "2024-11-01T00:00:00Z",
    "metadata": {
      "chains": ["ethereum"],
      "primaryWallets": ["0x3ddfa"],
      "tags": ["nft", "auction"]
    },
    "traces": [
      {
        "id": "trace-1",
        "name": "J.S. Purchase Nov 2021",
        "criteria": {
          "type": "time",
          "timeRange": {
            "start": "2021-11-21T00:00:00Z",
            "end": "2021-11-27T23:59:59Z"
          }
        },
        "visible": true,
        "collapsed": false,
        "color": "#3b82f6",
        "position": { "x": 100, "y": 100 },
        "nodes": [
          {
            "id": "0x3ddfa",
            "label": "JS Wallet",
            "address": "0x3ddfa",
            "chain": "ethereum",
            "color": "#60a5fa",
            "notes": "Main buyer wallet",
            "tags": ["buyer"],
            "position": { "x": 150, "y": 150 },
            "parentTrace": "trace-1"
          }
        ],
        "edges": [
          {
            "id": "tx-hash-123",
            "from": "0x3ddfa",
            "to": "0xE0de",
            "txHash": "0xabc123...",
            "chain": "ethereum",
            "timestamp": "2021-11-21T15:30:00Z",
            "amount": "78395999",
            "token": {
              "address": "0x...",
              "symbol": "USDC",
              "decimals": 6
            },
            "usdValue": 78395999,
            "color": "#10b981",
            "label": "Purchase",
            "notes": "Large NFT purchase",
            "tags": ["purchase"],
            "blockNumber": 13662000,
            "crossTrace": false
          }
        ]
      }
    ]
  }
}
```

### File Operations

- **New Investigation**: Creates empty investigation with single trace
- **Open Investigation**: Load JSON file, render graph
- **Save Investigation**: Serialize current state to JSON
- **Export**: Options for PNG/SVG of canvas, CSV of transactions
- **Auto-save**: Optional periodic save to prevent data loss

## Implementation Phases

### Phase 1: Core Visualization (MVP)
- [ ] Project setup (Vite + React + TypeScript + Tailwind)
- [ ] Basic layout (canvas + side panel)
- [ ] Cytoscape.js integration
- [ ] Render nodes and edges from mock data
- [ ] Compound nodes for traces
- [ ] Click to select → show details in side panel
- [ ] File operations (open/save JSON)

### Phase 2: Manual Data Entry
- [ ] UI to create/edit wallets manually
- [ ] UI to create/edit transactions manually
- [ ] UI to create/edit traces
- [ ] Color picker for nodes/edges
- [ ] Add notes and tags
- [ ] Import from JSON/CSV

### Phase 3: Blockchain Integration
- [ ] Etherscan API client
- [ ] Fetch transaction history
- [ ] Fetch ERC-20 transfers
- [ ] Resolve token metadata
- [ ] Historical price lookup (CoinGecko)
- [ ] Multi-chain support

### Phase 4: AI Integration
- [ ] AI provider abstraction layer
- [ ] Gemini API integration
- [ ] Anthropic API integration
- [ ] Tool definitions for blockchain queries
- [ ] Chat UI with message history
- [ ] Search results → clickable transaction list
- [ ] Add transactions to canvas from AI results

### Phase 5: Advanced Features
- [ ] Auto-layout algorithms for traces
- [ ] Pattern detection (circular flows, etc.)
- [ ] Trace templates (common investigation patterns)
- [ ] Export to report formats
- [ ] SQLite migration for cross-investigation search

## Open Questions

- **Layout algorithm**: How should new nodes be positioned? Manual, force-directed, hierarchical?
- **Trace creation UX**: When AI finds transactions, auto-create trace or prompt user?
- **Color schemes**: Provide preset color palettes or just color picker?
- **Export formats**: What report formats are most useful? PDF with embedded graph?

## Success Criteria

A successful MVP allows the user to:
1. Create an investigation with multiple traces
2. Manually add wallets and transactions to canvas
3. Import transaction data from files
4. Use AI to search blockchain and present results
5. Click AI results to add to canvas
6. Annotate nodes/edges with notes, tags, colors
7. Save/load investigations as JSON files
8. Navigate complex graphs (pan, zoom, collapse traces)

## Future Enhancements

- **Collaborative features**: Share investigations, comments
- **Database backend**: SQLite for querying across investigations
- **Advanced AI**: Pattern learning, anomaly detection
- **Cross-chain bridging**: Track assets across chains
- **Smart contract analysis**: Decode contract interactions
- **Timeline view**: Alternative view showing transactions over time
- **Export to Chainalysis/TRM formats**: Interop with professional tools
