export const MAP_MUTATION_ACTIONS = Object.freeze([
  "add-child", "duplicate-node", "delete-node", "link", "tidy", "undo", "redo",
  "rename-map", "modal-save", "move", "move-confirm", "move-up", "move-down",
  "toggle-size-mode", "edit-selected",
]);

export function canMutateMapState(state) {
  return Boolean(state?.map && !state?.view?.read && !state?.previewOnly);
}

export function canPersistViewState(state) {
  return Boolean(state?.map && !state?.previewOnly);
}
