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
