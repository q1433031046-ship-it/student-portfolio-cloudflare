export type InlineEditingKeyEvent = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export function shouldFinishInlineEditing(event: InlineEditingKeyEvent) {
  return event.key === "Enter" && event.isComposing !== true && event.keyCode !== 229;
}

export function shouldFinishMultilineInlineEditing(event: InlineEditingKeyEvent) {
  return shouldFinishInlineEditing(event) && (event.ctrlKey === true || event.metaKey === true);
}
