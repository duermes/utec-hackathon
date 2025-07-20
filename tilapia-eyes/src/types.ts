export default interface ProjectInfo {
  files: Array<{path: string; content: string; language: string}>;
  structure: any;
  errors: Array<{
    file: string;
    line: number;
    message: string;
    severity: string;
  }>;
  dependencies: any;
}
