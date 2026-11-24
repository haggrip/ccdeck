// The words on an item's kind chip, for the Status pane's brief items and its
// live Todo list alike (StatusPane.tsx, StatusTodo.tsx), kept here so neither
// imports the other.
export const KIND_MSGS = {
  approve: "brief.kind.approve", merge: "brief.kind.merge", review: "brief.kind.review", reply: "brief.kind.reply",
  decide: "brief.kind.decide", todo: "brief.kind.todo", fix: "brief.kind.fix", "follow-up": "brief.kind.followUp",
  feedback: "brief.kind.feedback", talk: "brief.kind.talk", answer: "brief.kind.answer", failed: "brief.kind.failed",
  read: "brief.kind.read", note: "brief.kind.note",
} as const;
export type KindWithChip = keyof typeof KIND_MSGS;
