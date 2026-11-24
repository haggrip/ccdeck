// Naming a board card in place, asked for from outside the card.
//
// The board's card draws no control of its own (V4: the head is the name and
// the state, nothing between them), so its field opens from two gestures the
// deck already uses for a name: a double-click on the card's name, which the
// card answers itself, and F2 on the selected card, which the deck's key
// handler hears (use-deck-shortcuts.ts) and passes to the card through here.
// A window event, so the handler needs no reference to a card React Flow
// mounts and unmounts as the board moves.
export const CARD_RENAME_EVENT = "ccdeck:rename-card";

/** Ask the card for agent `id` to open its name field. Answers whether a
 *  card took it: a subagent's card, or one not on the board, does not. */
export function requestCardRename(id: string, target: EventTarget | undefined = globalThis.window): boolean {
  // A page with no event target to speak through (a test's stand-in window)
  // has no card to take the ask.
  if (typeof target?.dispatchEvent !== "function" || typeof CustomEvent !== "function") return false;
  const ask = new CustomEvent<{ id: string; taken: boolean }>(CARD_RENAME_EVENT, { detail: { id, taken: false } });
  target.dispatchEvent(ask);
  return ask.detail.taken;
}

/** Listen for asks naming `id`; `start` opens the field. Answers the
 *  unsubscribe. */
export function onCardRename(id: string, start: () => void, target: EventTarget | undefined = globalThis.window): () => void {
  if (typeof target?.addEventListener !== "function") return () => {};
  const hear = (e: Event) => {
    const detail = (e as CustomEvent<{ id: string; taken: boolean }>).detail;
    if (!detail || detail.id !== id) return;
    detail.taken = true;
    start();
  };
  target.addEventListener(CARD_RENAME_EVENT, hear);
  return () => target.removeEventListener(CARD_RENAME_EVENT, hear);
}
