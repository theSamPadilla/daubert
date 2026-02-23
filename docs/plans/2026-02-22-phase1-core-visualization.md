# Phase 1: Core Visualization MVP - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the core visualization foundation with Cytoscape.js graph rendering, basic UI layout, and file operations for loading/saving investigations.

**Architecture:** React app with TypeScript, Cytoscape.js for graph visualization, split-panel layout (canvas + sidebar), JSON file-based persistence. Mock data for initial rendering, no blockchain or AI integration yet.

**Tech Stack:** Vite, React 18, TypeScript, Cytoscape.js, Tailwind CSS

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`

**Step 1: Initialize Vite project with React + TypeScript**

Run:
```bash
npm create vite@latest . -- --template react-ts
```

Expected: Creates base project structure

**Step 2: Install dependencies**

Run:
```bash
npm install
npm install cytoscape @types/cytoscape
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Expected: Dependencies installed, tailwind config files created

**Step 3: Configure Tailwind CSS**

Modify `tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Modify `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 4: Create basic App component**

Modify `src/App.tsx`:
```tsx
function App() {
  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-xl font-semibold">Onchain Transaction Tracker</h1>
      </header>
      <div className="flex-1 flex">
        <div className="flex-1 bg-gray-900">
          <p className="p-4">Canvas area</p>
        </div>
        <div className="w-96 bg-gray-800 border-l border-gray-700">
          <p className="p-4">Side panel</p>
        </div>
      </div>
    </div>
  );
}

export default App;
```

**Step 5: Test the dev server**

Run: `npm run dev`
Expected: Dev server starts, browser shows basic layout with header, canvas area, and sidebar

**Step 6: Commit**

```bash
git add .
git commit -m "feat: initialize Vite + React + TypeScript project with Tailwind

- Set up Vite with React TypeScript template
- Configure Tailwind CSS
- Create basic split-panel layout structure

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Define Core Data Types

**Files:**
- Create: `src/types/investigation.ts`

**Step 1: Create type definitions**

Create `src/types/investigation.ts`:
```typescript
export interface Investigation {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  traces: Trace[];
  metadata: Record<string, any>;
}

export interface Trace {
  id: string;
  name: string;
  criteria: {
    type: 'time' | 'wallet-group' | 'custom';
    timeRange?: { start: string; end: string };
    wallets?: string[];
    description?: string;
  };
  visible: boolean;
  color?: string;
  nodes: WalletNode[];
  edges: TransactionEdge[];
  position?: { x: number; y: number };
  collapsed: boolean;
}

export interface WalletNode {
  id: string;
  label: string;
  address: string;
  chain: string;
  color?: string;
  notes: string;
  tags: string[];
  position: { x: number; y: number };
  parentTrace: string;
}

export interface TransactionEdge {
  id: string;
  from: string;
  to: string;
  txHash: string;
  chain: string;
  timestamp: string;
  amount: string;
  token: {
    address: string;
    symbol: string;
    decimals: number;
  };
  usdValue?: number;
  color?: string;
  label?: string;
  notes: string;
  tags: string[];
  blockNumber: number;
  crossTrace: boolean;
}
```

**Step 2: Verify types compile**

Run: `npm run build`
Expected: Build succeeds with no type errors

**Step 3: Commit**

```bash
git add src/types/investigation.ts
git commit -m "feat: add core data type definitions

Define Investigation, Trace, WalletNode, and TransactionEdge types
based on design document.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Mock Data

**Files:**
- Create: `src/data/mockInvestigation.ts`

**Step 1: Create mock investigation data**

Create `src/data/mockInvestigation.ts`:
```typescript
import { Investigation } from '../types/investigation';

export const mockInvestigation: Investigation = {
  id: 'inv-1',
  name: 'JS Matter Investigation',
  description: 'Tracking NFT auction purchase flows',
  createdAt: '2024-11-01T00:00:00Z',
  metadata: {},
  traces: [
    {
      id: 'trace-1',
      name: 'J.S. Purchase Nov 2021',
      criteria: {
        type: 'time',
        timeRange: {
          start: '2021-11-21T00:00:00Z',
          end: '2021-11-27T23:59:59Z',
        },
      },
      visible: true,
      collapsed: false,
      color: '#3b82f6',
      position: { x: 0, y: 0 },
      nodes: [
        {
          id: '0x3ddfa',
          label: 'JS Wallet',
          address: '0x3ddfa',
          chain: 'ethereum',
          color: '#60a5fa',
          notes: 'Main buyer wallet',
          tags: ['buyer'],
          position: { x: 100, y: 100 },
          parentTrace: 'trace-1',
        },
        {
          id: '0xE0de',
          label: 'Purchase Target',
          address: '0xE0de',
          chain: 'ethereum',
          color: '#34d399',
          notes: 'NFT seller',
          tags: ['seller'],
          position: { x: 300, y: 100 },
          parentTrace: 'trace-1',
        },
      ],
      edges: [
        {
          id: 'tx-1',
          from: '0x3ddfa',
          to: '0xE0de',
          txHash: '0xabc123',
          chain: 'ethereum',
          timestamp: '2021-11-21T15:30:00Z',
          amount: '78395999',
          token: {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            decimals: 6,
          },
          usdValue: 78395.999,
          color: '#10b981',
          label: 'Purchase',
          notes: 'Large NFT purchase',
          tags: ['purchase'],
          blockNumber: 13662000,
          crossTrace: false,
        },
      ],
    },
  ],
};
```

**Step 2: Verify imports work**

Modify `src/App.tsx` to import mock data:
```tsx
import { mockInvestigation } from './data/mockInvestigation';

function App() {
  console.log('Mock investigation:', mockInvestigation);
  // ... rest of component
}
```

**Step 3: Test in browser**

Run: `npm run dev`
Expected: Browser console shows mock investigation data

**Step 4: Commit**

```bash
git add src/data/mockInvestigation.ts src/App.tsx
git commit -m "feat: add mock investigation data

Create sample investigation with one trace, two wallets, and one
transaction for development and testing.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Build GraphCanvas Component

**Files:**
- Create: `src/components/GraphCanvas.tsx`
- Create: `src/hooks/useCytoscape.ts`

**Step 1: Create Cytoscape hook**

Create `src/hooks/useCytoscape.ts`:
```typescript
import { useEffect, useRef } from 'react';
import cytoscape, { Core } from 'cytoscape';
import { Investigation } from '../types/investigation';

export function useCytoscape(investigation: Investigation | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current || !investigation) return;

    // Initialize Cytoscape
    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'color': '#fff',
            'font-size': '12px',
            'width': '60px',
            'height': '60px',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': '10px',
            'color': '#fff',
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: ':parent',
          style: {
            'background-opacity': 0.2,
            'background-color': 'data(color)',
            'border-color': 'data(color)',
            'border-width': 2,
            'label': 'data(label)',
            'text-valign': 'top',
            'text-halign': 'center',
            'font-size': '14px',
            'font-weight': 'bold',
            'color': '#fff',
          },
        },
      ],
      layout: { name: 'preset' },
    });

    cyRef.current = cy;

    // Convert investigation data to Cytoscape elements
    const elements: any[] = [];

    investigation.traces.forEach((trace) => {
      if (!trace.visible) return;

      // Add parent node for trace
      elements.push({
        data: {
          id: trace.id,
          label: trace.name,
          color: trace.color || '#3b82f6',
        },
        position: trace.position || { x: 0, y: 0 },
      });

      // Add wallet nodes
      trace.nodes.forEach((node) => {
        elements.push({
          data: {
            id: node.id,
            parent: trace.id,
            label: node.label,
            color: node.color || '#60a5fa',
          },
          position: node.position,
        });
      });

      // Add transaction edges
      trace.edges.forEach((edge) => {
        elements.push({
          data: {
            id: edge.id,
            source: edge.from,
            target: edge.to,
            label: edge.label || `${edge.amount} ${edge.token.symbol}`,
            color: edge.color || '#10b981',
          },
        });
      });
    });

    cy.add(elements);
    cy.fit();

    return () => {
      cy.destroy();
    };
  }, [investigation]);

  return { containerRef, cy: cyRef.current };
}
```

**Step 2: Create GraphCanvas component**

Create `src/components/GraphCanvas.tsx`:
```tsx
import { Investigation } from '../types/investigation';
import { useCytoscape } from '../hooks/useCytoscape';

interface GraphCanvasProps {
  investigation: Investigation | null;
}

export function GraphCanvas({ investigation }: GraphCanvasProps) {
  const { containerRef } = useCytoscape(investigation);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
      />
    </div>
  );
}
```

**Step 3: Use GraphCanvas in App**

Modify `src/App.tsx`:
```tsx
import { useState } from 'react';
import { mockInvestigation } from './data/mockInvestigation';
import { GraphCanvas } from './components/GraphCanvas';
import { Investigation } from './types/investigation';

function App() {
  const [investigation, setInvestigation] = useState<Investigation | null>(mockInvestigation);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-xl font-semibold">
          {investigation?.name || 'Onchain Transaction Tracker'}
        </h1>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 bg-gray-900">
          <GraphCanvas investigation={investigation} />
        </div>
        <div className="w-96 bg-gray-800 border-l border-gray-700">
          <p className="p-4">Side panel</p>
        </div>
      </div>
    </div>
  );
}

export default App;
```

**Step 4: Test graph rendering**

Run: `npm run dev`
Expected: Browser shows Cytoscape graph with trace container, two wallet nodes, and connecting edge

**Step 5: Commit**

```bash
git add src/components/GraphCanvas.tsx src/hooks/useCytoscape.ts src/App.tsx
git commit -m "feat: add Cytoscape graph visualization

- Create useCytoscape hook for graph management
- Build GraphCanvas component
- Render traces as compound nodes with wallets and transactions
- Integrate into main App layout

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Build SidePanel Components

**Files:**
- Create: `src/components/SidePanel.tsx`
- Create: `src/components/DetailsPanel.tsx`
- Create: `src/components/AIChat.tsx`

**Step 1: Create DetailsPanel component**

Create `src/components/DetailsPanel.tsx`:
```tsx
interface DetailsPanelProps {
  selectedItem: any | null;
}

export function DetailsPanel({ selectedItem }: DetailsPanelProps) {
  if (!selectedItem) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        Select a wallet, transaction, or trace to view details
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase">Details</h3>
      <div className="text-sm">
        <p className="text-gray-400">Selected: {selectedItem.type}</p>
        <pre className="mt-2 text-xs text-gray-300 overflow-auto">
          {JSON.stringify(selectedItem, null, 2)}
        </pre>
      </div>
    </div>
  );
}
```

**Step 2: Create AIChat component**

Create `src/components/AIChat.tsx`:
```tsx
export function AIChat() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-4 overflow-y-auto">
        <p className="text-gray-400 text-sm">AI Chat - Coming in Phase 4</p>
      </div>
      <div className="border-t border-gray-700 p-4">
        <input
          type="text"
          placeholder="Ask AI to search transactions..."
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500"
          disabled
        />
      </div>
    </div>
  );
}
```

**Step 3: Create SidePanel component**

Create `src/components/SidePanel.tsx`:
```tsx
import { DetailsPanel } from './DetailsPanel';
import { AIChat } from './AIChat';

interface SidePanelProps {
  selectedItem: any | null;
}

export function SidePanel({ selectedItem }: SidePanelProps) {
  return (
    <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
      <div className="flex-1 border-b border-gray-700 overflow-y-auto">
        <DetailsPanel selectedItem={selectedItem} />
      </div>
      <div className="h-80 overflow-hidden">
        <AIChat />
      </div>
    </div>
  );
}
```

**Step 4: Use SidePanel in App**

Modify `src/App.tsx`:
```tsx
import { useState } from 'react';
import { mockInvestigation } from './data/mockInvestigation';
import { GraphCanvas } from './components/GraphCanvas';
import { SidePanel } from './components/SidePanel';
import { Investigation } from './types/investigation';

function App() {
  const [investigation, setInvestigation] = useState<Investigation | null>(mockInvestigation);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-xl font-semibold">
          {investigation?.name || 'Onchain Transaction Tracker'}
        </h1>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 bg-gray-900">
          <GraphCanvas investigation={investigation} />
        </div>
        <SidePanel selectedItem={selectedItem} />
      </div>
    </div>
  );
}

export default App;
```

**Step 5: Test side panel layout**

Run: `npm run dev`
Expected: Browser shows split panel with graph on left, details panel on top right, AI chat placeholder on bottom right

**Step 6: Commit**

```bash
git add src/components/SidePanel.tsx src/components/DetailsPanel.tsx src/components/AIChat.tsx src/App.tsx
git commit -m "feat: add side panel with details and AI chat sections

- Create DetailsPanel for contextual information
- Create AIChat placeholder component
- Create SidePanel container with split layout
- Integrate into main App

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Click Selection

**Files:**
- Modify: `src/hooks/useCytoscape.ts`
- Modify: `src/components/GraphCanvas.tsx`

**Step 1: Add click handler to useCytoscape**

Modify `src/hooks/useCytoscape.ts`:
```typescript
import { useEffect, useRef } from 'react';
import cytoscape, { Core } from 'cytoscape';
import { Investigation } from '../types/investigation';

export function useCytoscape(
  investigation: Investigation | null,
  onSelectItem?: (item: any) => void
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current || !investigation) return;

    // ... (previous initialization code)

    // Add click handlers
    cy.on('tap', 'node', (event) => {
      const node = event.target;
      const data = node.data();

      // Check if it's a wallet node or trace parent
      const isParent = node.isParent();

      if (isParent) {
        // Trace selected
        const trace = investigation.traces.find((t) => t.id === data.id);
        onSelectItem?.({ type: 'trace', data: trace });
      } else {
        // Wallet node selected
        const trace = investigation.traces.find((t) => t.id === data.parent);
        const walletNode = trace?.nodes.find((n) => n.id === data.id);
        onSelectItem?.({ type: 'wallet', data: walletNode });
      }
    });

    cy.on('tap', 'edge', (event) => {
      const edge = event.target;
      const data = edge.data();

      // Find the transaction
      let transaction = null;
      for (const trace of investigation.traces) {
        const tx = trace.edges.find((e) => e.id === data.id);
        if (tx) {
          transaction = tx;
          break;
        }
      }

      onSelectItem?.({ type: 'transaction', data: transaction });
    });

    // Click on background to deselect
    cy.on('tap', (event) => {
      if (event.target === cy) {
        onSelectItem?.(null);
      }
    });

    return () => {
      cy.destroy();
    };
  }, [investigation, onSelectItem]);

  return { containerRef, cy: cyRef.current };
}
```

**Step 2: Pass onSelectItem to GraphCanvas**

Modify `src/components/GraphCanvas.tsx`:
```tsx
import { Investigation } from '../types/investigation';
import { useCytoscape } from '../hooks/useCytoscape';

interface GraphCanvasProps {
  investigation: Investigation | null;
  onSelectItem?: (item: any) => void;
}

export function GraphCanvas({ investigation, onSelectItem }: GraphCanvasProps) {
  const { containerRef } = useCytoscape(investigation, onSelectItem);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
```

**Step 3: Wire up selection in App**

Modify `src/App.tsx`:
```tsx
// ... imports

function App() {
  const [investigation, setInvestigation] = useState<Investigation | null>(mockInvestigation);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-xl font-semibold">
          {investigation?.name || 'Onchain Transaction Tracker'}
        </h1>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 bg-gray-900">
          <GraphCanvas
            investigation={investigation}
            onSelectItem={setSelectedItem}
          />
        </div>
        <SidePanel selectedItem={selectedItem} />
      </div>
    </div>
  );
}

export default App;
```

**Step 4: Test click selection**

Run: `npm run dev`
Expected:
- Click on wallet node → side panel shows wallet details
- Click on edge → side panel shows transaction details
- Click on trace container → side panel shows trace details
- Click on background → side panel shows "Select..." message

**Step 5: Commit**

```bash
git add src/hooks/useCytoscape.ts src/components/GraphCanvas.tsx src/App.tsx
git commit -m "feat: add click selection for graph elements

- Handle click events on nodes, edges, and trace containers
- Pass selection state to side panel
- Update DetailsPanel to show selected item info

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add File Operations

**Files:**
- Create: `src/utils/fileOperations.ts`
- Create: `src/components/Header.tsx`
- Modify: `src/App.tsx`

**Step 1: Create file operations utilities**

Create `src/utils/fileOperations.ts`:
```typescript
import { Investigation } from '../types/investigation';

export function saveInvestigation(investigation: Investigation) {
  const json = JSON.stringify(investigation, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${investigation.name.replace(/\s+/g, '-').toLowerCase()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function loadInvestigation(): Promise<Investigation> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';

    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = event.target?.result as string;
          const investigation = JSON.parse(json) as Investigation;
          resolve(investigation);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };

    input.click();
  });
}

export function createNewInvestigation(): Investigation {
  return {
    id: crypto.randomUUID(),
    name: 'New Investigation',
    description: '',
    createdAt: new Date().toISOString(),
    traces: [
      {
        id: crypto.randomUUID(),
        name: 'New Trace',
        criteria: { type: 'custom' },
        visible: true,
        collapsed: false,
        nodes: [],
        edges: [],
        position: { x: 0, y: 0 },
      },
    ],
    metadata: {},
  };
}
```

**Step 2: Create Header component**

Create `src/components/Header.tsx`:
```tsx
import { Investigation } from '../types/investigation';

interface HeaderProps {
  investigation: Investigation | null;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
}

export function Header({ investigation, onNew, onOpen, onSave }: HeaderProps) {
  return (
    <header className="bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
      <h1 className="text-xl font-semibold">
        {investigation?.name || 'Onchain Transaction Tracker'}
      </h1>

      <div className="flex gap-2">
        <button
          onClick={onNew}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
        >
          New
        </button>
        <button
          onClick={onOpen}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
        >
          Open
        </button>
        <button
          onClick={onSave}
          disabled={!investigation}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm transition-colors"
        >
          Save
        </button>
      </div>
    </header>
  );
}
```

**Step 3: Wire up file operations in App**

Modify `src/App.tsx`:
```tsx
import { useState } from 'react';
import { mockInvestigation } from './data/mockInvestigation';
import { GraphCanvas } from './components/GraphCanvas';
import { SidePanel } from './components/SidePanel';
import { Header } from './components/Header';
import { Investigation } from './types/investigation';
import { saveInvestigation, loadInvestigation, createNewInvestigation } from './utils/fileOperations';

function App() {
  const [investigation, setInvestigation] = useState<Investigation | null>(mockInvestigation);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const handleNew = () => {
    if (confirm('Create new investigation? Unsaved changes will be lost.')) {
      setInvestigation(createNewInvestigation());
      setSelectedItem(null);
    }
  };

  const handleOpen = async () => {
    try {
      const loaded = await loadInvestigation();
      setInvestigation(loaded);
      setSelectedItem(null);
    } catch (error) {
      console.error('Failed to load investigation:', error);
      alert('Failed to load investigation file');
    }
  };

  const handleSave = () => {
    if (investigation) {
      saveInvestigation(investigation);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <Header
        investigation={investigation}
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
      />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 bg-gray-900">
          <GraphCanvas
            investigation={investigation}
            onSelectItem={setSelectedItem}
          />
        </div>
        <SidePanel selectedItem={selectedItem} />
      </div>
    </div>
  );
}

export default App;
```

**Step 4: Test file operations**

Run: `npm run dev`

Test sequence:
1. Click "Save" → downloads JSON file
2. Click "New" → creates empty investigation
3. Click "Open" → file picker opens, select saved file → loads investigation
4. Verify graph re-renders with loaded data

Expected: All file operations work correctly

**Step 5: Commit**

```bash
git add src/utils/fileOperations.ts src/components/Header.tsx src/App.tsx
git commit -m "feat: add file operations (new, open, save)

- Implement save investigation to JSON file
- Implement load investigation from JSON file
- Create new investigation utility
- Add Header component with file menu buttons
- Wire up file operations in App

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Improve DetailsPanel Formatting

**Files:**
- Modify: `src/components/DetailsPanel.tsx`

**Step 1: Add type-specific detail views**

Modify `src/components/DetailsPanel.tsx`:
```tsx
import { WalletNode, TransactionEdge, Trace } from '../types/investigation';

interface DetailsPanelProps {
  selectedItem: any | null;
}

function WalletDetails({ wallet }: { wallet: WalletNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Wallet</h4>
        <p className="text-sm font-semibold">{wallet.label}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Address</h4>
        <p className="text-xs font-mono text-gray-300 break-all">{wallet.address}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Chain</h4>
        <p className="text-sm text-gray-300">{wallet.chain}</p>
      </div>
      {wallet.tags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Tags</h4>
          <div className="flex flex-wrap gap-1">
            {wallet.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-gray-700 rounded text-xs">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
      {wallet.notes && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Notes</h4>
          <p className="text-sm text-gray-300">{wallet.notes}</p>
        </div>
      )}
    </div>
  );
}

function TransactionDetails({ transaction }: { transaction: TransactionEdge }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Transaction</h4>
        <p className="text-sm font-semibold">
          {transaction.amount} {transaction.token.symbol}
        </p>
        {transaction.usdValue && (
          <p className="text-xs text-gray-400 mt-1">
            ${transaction.usdValue.toLocaleString()}
          </p>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Hash</h4>
        <p className="text-xs font-mono text-gray-300 break-all">{transaction.txHash}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">From → To</h4>
        <p className="text-xs font-mono text-gray-300">{transaction.from}</p>
        <p className="text-xs text-gray-500 my-1">↓</p>
        <p className="text-xs font-mono text-gray-300">{transaction.to}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Timestamp</h4>
        <p className="text-sm text-gray-300">
          {new Date(transaction.timestamp).toLocaleString()}
        </p>
      </div>
      {transaction.tags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Tags</h4>
          <div className="flex flex-wrap gap-1">
            {transaction.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-gray-700 rounded text-xs">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
      {transaction.notes && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Notes</h4>
          <p className="text-sm text-gray-300">{transaction.notes}</p>
        </div>
      )}
    </div>
  );
}

function TraceDetails({ trace }: { trace: Trace }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Trace</h4>
        <p className="text-sm font-semibold">{trace.name}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Type</h4>
        <p className="text-sm text-gray-300 capitalize">{trace.criteria.type}</p>
      </div>
      {trace.criteria.timeRange && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Time Range</h4>
          <p className="text-xs text-gray-300">
            {new Date(trace.criteria.timeRange.start).toLocaleDateString()}
          </p>
          <p className="text-xs text-gray-500">to</p>
          <p className="text-xs text-gray-300">
            {new Date(trace.criteria.timeRange.end).toLocaleDateString()}
          </p>
        </div>
      )}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Stats</h4>
        <p className="text-sm text-gray-300">{trace.nodes.length} wallets</p>
        <p className="text-sm text-gray-300">{trace.edges.length} transactions</p>
      </div>
    </div>
  );
}

export function DetailsPanel({ selectedItem }: DetailsPanelProps) {
  if (!selectedItem) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        Select a wallet, transaction, or trace to view details
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">
        {selectedItem.type} Details
      </h3>

      {selectedItem.type === 'wallet' && <WalletDetails wallet={selectedItem.data} />}
      {selectedItem.type === 'transaction' && <TransactionDetails transaction={selectedItem.data} />}
      {selectedItem.type === 'trace' && <TraceDetails trace={selectedItem.data} />}
    </div>
  );
}
```

**Step 2: Test detail views**

Run: `npm run dev`

Test sequence:
1. Click wallet node → see formatted wallet details
2. Click transaction edge → see formatted transaction details with amount, hash, timestamps
3. Click trace container → see trace stats and criteria

Expected: All detail views show formatted, readable information

**Step 3: Commit**

```bash
git add src/components/DetailsPanel.tsx
git commit -m "feat: improve details panel with formatted views

- Add WalletDetails component with address, chain, tags, notes
- Add TransactionDetails component with amounts, hash, timestamps
- Add TraceDetails component with stats and criteria
- Format dates, numbers, and addresses for readability

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Add README and Documentation

**Files:**
- Create: `README.md`
- Create: `.env.example`

**Step 1: Create README**

Create `README.md`:
```markdown
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
```

**Step 2: Create .env.example**

Create `.env.example`:
```bash
# API Keys (for future phases)
# VITE_ETHERSCAN_API_KEY=your_etherscan_key
# VITE_GEMINI_API_KEY=your_gemini_key
# VITE_ANTHROPIC_API_KEY=your_anthropic_key
```

**Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: add README and environment template

- Document features, tech stack, and usage
- Add project structure overview
- Create .env.example for future API keys

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 1 Complete

**Summary:**
- ✅ Project setup with Vite + React + TypeScript + Tailwind
- ✅ Core data types defined
- ✅ Cytoscape.js graph visualization working
- ✅ Split-panel layout (canvas + side panel)
- ✅ Click selection with contextual details
- ✅ File operations (new, open, save)
- ✅ Mock data for development
- ✅ Documentation

**Next Steps:**
- Phase 2: Manual data entry UI
- Phase 3: Blockchain API integration
- Phase 4: AI integration
- Phase 5: Advanced features

**Test the MVP:**
```bash
npm run dev
```

You should see a working graph visualization with the JS Matter mock investigation, clickable elements showing details, and functional file operations.
