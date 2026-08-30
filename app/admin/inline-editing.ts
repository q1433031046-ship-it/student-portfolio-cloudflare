export type InlineEditingKeyEvent = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
};

export function shouldFinishInlineEditing(event: InlineEditingKeyEvent) {
  return event.key === "Enter" && event.isComposing !== true && event.keyCode !== 229;
}
