const LABELS: Record<string, string> = {
  web_search: 'Web search',
  get_case_data: 'Read case data',
  get_case: 'Read case',
  get_investigation: 'Read investigation',
  list_investigations: 'Listed investigations',
  create_investigation: 'Created investigation',
  import_transactions: 'Imported transactions',
  get_skill: 'Loaded skill',
  execute_script: 'Ran script',
  list_script_runs: 'Listed past scripts',
  query_labeled_entities: 'Looked up labeled entities',
  create_production: 'Created production',
  read_production: 'Read production',
  update_production: 'Updated production',
  get_declaration_library: 'Read declaration library',
  get_declarants: 'Read declarants',
  list_data_room_files: 'Listed data room files',
  read_data_room_file: 'Read data room file',
  add_label: 'Added label',
  update_label: 'Updated label',
  delete_label: 'Deleted label',
  move_label: 'Moved label',
  tether_label: 'Tethered label',
};

/** The input field that best identifies what a call was about, in order of preference. */
const KEY_INPUT: Record<string, string[]> = {
  web_search: ['query'],
  get_investigation: ['address', 'investigationId'],
  create_investigation: ['name'],
  import_transactions: ['traceId'],
  get_skill: ['name'],
  execute_script: ['name'],
  query_labeled_entities: ['address', 'search'],
  create_production: ['name'],
  read_production: ['productionId'],
  update_production: ['productionId'],
  read_data_room_file: ['fileId'],
  add_label: ['text'],
  update_label: ['labelId'],
  delete_label: ['labelId'],
  move_label: ['labelId'],
  tether_label: ['labelId'],
};

const KEY_INPUT_MAX = 80;

export function actionLabel(action: string): string {
  return LABELS[action] ?? action.replace(/_/g, ' ');
}

export function keyInput(action: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  for (const key of KEY_INPUT[action] ?? []) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim()) {
      return v.length > KEY_INPUT_MAX ? `${v.slice(0, KEY_INPUT_MAX - 3)}...` : v;
    }
  }
  return null;
}

export function sourceLabel(entry: { source: 'chat' | 'mcp'; agent: string | null }): string {
  if (entry.source === 'chat') return 'Daubert chat';
  return entry.agent ?? 'External agent';
}
