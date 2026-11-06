export interface EditorDemand {
  request: () => void;
  keepWarm: () => void;
}

export function createEditorDemand(launch: (askLicense: boolean) => void): EditorDemand {
  let wanted = false;
  return {
    request: () => {
      wanted = true;
      launch(true);
    },
    keepWarm: () => {
      if (wanted) launch(false);
    },
  };
}
