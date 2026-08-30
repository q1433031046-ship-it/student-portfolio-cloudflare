export type UploadStatus = "uploading" | "failed";

export type ActiveUpload = {
  id: string;
  filename: string;
  targetView: string;
  targetId?: string;
  progress: number;
  status: UploadStatus;
  error?: string;
};

export type ActiveUploadMap = ReadonlyMap<string, ActiveUpload>;

export type UploadAction =
  | { type: "start"; upload: Omit<ActiveUpload, "progress" | "status" | "error"> }
  | { type: "progress"; id: string; progress: number }
  | { type: "fail"; id: string; error: string }
  | { type: "finish" | "dismiss"; id: string };

export function createActiveUploadMap(): ActiveUploadMap {
  return new Map();
}

export function activeUploadReducer(state: ActiveUploadMap, action: UploadAction): ActiveUploadMap {
  const next = new Map(state);
  if (action.type === "start") {
    next.set(action.upload.id, { ...action.upload, progress: 0, status: "uploading" });
  } else if (action.type === "progress") {
    const upload = next.get(action.id);
    if (upload) next.set(action.id, { ...upload, progress: clampProgress(action.progress), status: "uploading", error: undefined });
  } else if (action.type === "fail") {
    const upload = next.get(action.id);
    if (upload) next.set(action.id, { ...upload, status: "failed", error: action.error });
  } else {
    next.delete(action.id);
  }
  return next;
}

export function hasBlockingUploads(state: ActiveUploadMap) {
  return Array.from(state.values()).some((upload) => upload.status === "uploading");
}

export function failedUploads(state: ActiveUploadMap) {
  return Array.from(state.values()).filter((upload) => upload.status === "failed");
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
