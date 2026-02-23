# Onchain Transaction Tracker

A web-based blockchain transaction flow visualization tool for tracking and analyzing transactions across EVM-compatible chains.

## Features (Phase 1 - MVP)

- 🎨 Interactive graph visualization using Cytoscape.js
- 📊 Trace-based organization (time-based, wallet-group-based)
- 🔍 Click to inspect wallets, transactions, and traces
- 💾 Save/load investigations as JSON files
- 🎯 Compound nodes for trace grouping

## Tech Stack

- React 18 + TypeScript
- Vite
- Cytoscape.js
- Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open http://localhost:5173

### Build

```bash
npm run build
npm run preview
```

## Usage

1. **View Mock Data**: App starts with sample investigation data
2. **Explore Graph**:
   - Click wallet nodes to see details
   - Click transaction edges to see transfer info
   - Click trace containers to see stats
3. **File Operations**:
   - **New**: Create empty investigation
   - **Open**: Load investigation from JSON file
   - **Save**: Download current investigation as JSON

## Project Structure

```
src/
├── components/
│   ├── GraphCanvas.tsx      # Cytoscape graph wrapper
│   ├── SidePanel.tsx        # Side panel container
│   ├── DetailsPanel.tsx     # Contextual details viewer
│   ├── AIChat.tsx           # AI chat placeholder
│   └── Header.tsx           # Top navigation with file menu
├── hooks/
│   └── useCytoscape.ts      # Cytoscape initialization and events
├── types/
│   └── investigation.ts     # Core data types
├── utils/
│   └── fileOperations.ts    # Save/load utilities
├── data/
│   └── mockInvestigation.ts # Sample data
└── App.tsx                  # Main app component
```

## Coming Next

- **Phase 2**: Manual data entry UI
- **Phase 3**: Blockchain API integration
- **Phase 4**: AI-assisted investigation
- **Phase 5**: Advanced pattern detection

## Design Document

See [docs/plans/2026-02-22-onchain-transaction-tracker-design.md](docs/plans/2026-02-22-onchain-transaction-tracker-design.md)

## License

MIT
