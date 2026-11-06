interface CodeSource {
  token: string;
  kind: 'working-tree' | 'revision';
  revision: string;
  contentHash: string;
}

interface SemanticSpan {
  line: number;
  start: number;
  length: number;
  type: string;
  modifiers: string[];
}

interface SemanticHighlightRequest {
  project: string;
  path: string;
  source: CodeSource;
}

interface SemanticHighlightResult {
  ok: boolean;
  source: CodeSource;
  spans: SemanticSpan[];
  reason?: string;
}

export type { CodeSource, SemanticHighlightRequest, SemanticHighlightResult, SemanticSpan };
