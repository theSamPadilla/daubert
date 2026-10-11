// Keep LABELS and KEY_INPUT in sync with
// frontend/src/components/Workspace/activityFormat.ts (the activity log UI).

export const LABELS: Record<string, string> = {
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
  record_file_notes: 'Recorded file notes',
  get_file_notes: 'Read file notes',
};

/** The input field that best identifies what a call was about, in order of preference. */
export const KEY_INPUT: Record<string, string[]> = {
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

/** Human label for a tool; unknown tools fall back to the name with spaces. */
export function toolLabel(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, ' ');
}
