/* 
Interaction functions for vs code extensions API
*/

function requestWriteText(startLine: number, endLine: number, text: string): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const document = editor.document;
  const start = new vscode.Position(startLine, 0);
  const end = new vscode.Position(endLine, 0);
  const range = new vscode.Range(start, end);

  editor.edit((editBuilder) => {
    editBuilder.replace(range, text);
  });
}

function requestReadText(startLine: number, endLine: number): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return "";
  }

  const document = editor.document;
  const start = new vscode.Position(startLine, 0);
  const end = new vscode.Position(endLine, 0);
  const range = new vscode.Range(start, end);

  return document.getText(range);
}

function requestGetErrors() : string {
    const editor = vscode.window.activeTextEditor;
    // TODO: hacer algo si no hay editor activo?

    const uri = editor.document.uri;
    const diagnostics = vscode.languages.getDiagnostics(uri);

    if (diagnostics.length === 0) {
      return "No hay errores en el archivo actual.";
    } else {
        let errors : string[];
        
        diagnostics.forEach(d => {
            errors.push(`[ ${d.severity}] ${d.message} en línea ${d.range.start.line + 1}`);
        });
    }
}