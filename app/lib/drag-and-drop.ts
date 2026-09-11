export type ContainerLike = {
  contains(node: Node | null): boolean;
};

/**
 * Whether a dragleave really left the drop target.
 *
 * dragleave also fires when the pointer crosses onto a child element, which
 * would flash the drop highlight off and straight back on. A null related
 * target means the pointer left the window, which does count as leaving.
 */
export function isLeavingDropTarget(
  container: ContainerLike | null,
  relatedTarget: Node | null,
): boolean {
  if (!container) {
    return true;
  }
  if (!relatedTarget) {
    return true;
  }
  return !container.contains(relatedTarget);
}
