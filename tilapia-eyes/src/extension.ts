// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'tilapia-eyes.mainPanel',
    'Tilapia Eyes',
    vscode.ViewColumn.One,
    {
      enableScripts: true
    }
  );

  panel.webview.html = getWebviewContent();

  /*
  - capacidades
  > editar 
  > describir 
  > corregir
  */
}

function getWebviewContent(): string {
  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Hola</title>
    </head>
    <body>
      <h1>👋 Bienvenido al Panel Web</h1>
      <p>Este panel se abrió automáticamente al activar la extensión.</p>
    </body>
    </html>
  `;
}

// This method is called when your extension is deactivated
export function deactivate() {}