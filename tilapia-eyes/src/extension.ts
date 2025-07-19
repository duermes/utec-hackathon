import * as vscode from "vscode";
import {GoogleGenerativeAI} from "@google/generative-ai";
import * as path from "path";
import {WebSocket} from "ws";
import { GeminiVoiceAssistant }from "./geminiVoiceAssistant"

//================================================================================
//== FUNCIÓN DE ACTIVACIÓN: Registra todos los componentes de la extensión
//================================================================================
export function activate(context: vscode.ExtensionContext) {
  const assistant = new GeminiVoiceAssistant(context);

  // Registrar comandos para que puedan ser usados desde la paleta de comandos (Ctrl+Shift+P)
  context.subscriptions.push(
    vscode.commands.registerCommand("geminiVoice.startRecording", () =>
      assistant.startRecording()
    ),
    vscode.commands.registerCommand("geminiVoice.analyzeActiveFile", () =>
      assistant.analyzeActiveFileWithGemini()
    ),
    vscode.commands.registerCommand("geminiVoice.syncProject", () =>
      assistant.analyzeCurrentProject()
    )
  );

  // Registrar el proveedor que crea y maneja la vista en la barra lateral
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("geminiVoiceView", {
      resolveWebviewView(webviewView) {
        assistant.resolveWebviewView(webviewView);
      },
    })
  );
}

export function deactivate() {}
