import * as vscode from "vscode";
import {GoogleGenerativeAI} from "@google/generative-ai";
import * as path from "path";
import {WebSocket} from "ws";
import contentHTML from "./contentHTML";
import ProjectInfo from "./types";

export class GeminiVoiceAssistant {
  private genAI: GoogleGenerativeAI | null = null;
  private isRecording = false;
  // Propiedad para manejar la vista de la barra lateral
  private webviewView: vscode.WebviewView | null = null;
  private mcpSocket: WebSocket | null = null;
  private projectInfo: ProjectInfo | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.initializeGemini();
    this.connectToMCP();
  }

  private initializeGemini() {
    const config = vscode.workspace.getConfiguration("geminiVoice");
    const apiKey = config.get<string>("apiKey");
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      console.log("Cliente de Gemini inicializado con éxito.");
    } else {
      console.warn(
        "API Key de Gemini no encontrada. Por favor, configúrala en el panel."
      );
    }
    // Actualiza la vista por si el estado de la API key cambió
    this.updateApiKeyStatus();
  }

  //Guarda la API Key desde el panel
  public async saveApiKey(key: string) {
    if (!key) {
      vscode.window.showErrorMessage("La API Key no puede estar vacía.");
      return;
    }
    try {
      const config = vscode.workspace.getConfiguration("geminiVoice");
      // Guardamos la clave en la configuración GLOBAL del usuario
      await config.update("apiKey", key, vscode.ConfigurationTarget.Global);

      vscode.window.showInformationMessage(
        "API Key de Gemini guardada correctamente."
      );

      // Re-inicializamos Gemini con la nueva clave
      this.initializeGemini();
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo guardar la API Key: ${error}`);
    }
  }

  private updateApiKeyStatus() {
    if (this.webviewView) {
      const hasApiKey = !!this.genAI;
      this.webviewView.webview.postMessage({
        type: "apiKeyStatusUpdate",
        data: {hasApiKey},
      });
    }
  }

  private async connectToMCP() {
    const config = vscode.workspace.getConfiguration("geminiVoice");
    const endpoint = config.get<string>("mcpEndpoint");
    try {
      this.mcpSocket = new WebSocket(endpoint || "ws://localhost:3000");
      this.mcpSocket.on("open", () => {
        console.log("Conectado al servidor MCP");
        this.analyzeCurrentProject();
      });
      this.mcpSocket.on("message", (data) => {
        const response = JSON.parse(data.toString());
        this.handleMCPResponse(response);
      });
      this.mcpSocket.on("error", (error) => {
        console.error("Error de conexión MCP:", error);
        vscode.window.showWarningMessage(
          "No se pudo conectar al servidor MCP. El análisis de proyecto estará limitado."
        );
      });
    } catch (error) {
      console.error("Error al iniciar la conexión con MCP:", error);
    }
  }

  private handleMCPResponse(response: any) {
    if (response.type === "project_analysis") {
      this.projectInfo = response.data;
      this.updateWebview();
    }
  }

  //== Analiza el archivo activo directamente con Gemini
  public async analyzeActiveFileWithGemini() {
    if (!this.genAI) {
      vscode.window.showErrorMessage(
        "La API Key de Gemini no está configurada. Por favor, guárdala en el panel del asistente."
      );
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage(
        "Por favor, abre un archivo en el editor para analizarlo."
      );
      return;
    }

    const document = activeEditor.document;
    const fileContent = document.getText();
    const language = document.languageId;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Gemini está analizando tu código...",
        cancellable: false,
      },
      async (progress) => {
        try {
          const model = this.genAI!.getGenerativeModel({
            model: "gemini-2.0-flash",
          });

          const prompt = `
            Eres un asistente experto en análisis de código y un programador senior.
            Analiza el siguiente fragmento de código en lenguaje "${language}".

            Proporciona un análisis detallado que incluya:
            1.  **Resumen**: Una breve descripción de lo que hace el código.
            2.  **Posibles Errores o Bugs**: Identifica cualquier error lógico o de sintaxis.
            3.  **Sugerencias de Mejora**: Ofrece recomendaciones para mejorar la eficiencia, legibilidad y mantenibilidad.
            4.  **Buenas Prácticas**: Señala si se están siguiendo las convenciones del lenguaje.

            Aquí está el código:
            \`\`\`${language}
            ${fileContent}
            \`\`\`
          `;

          const result = await model.generateContent(prompt);
          const response = result.response.text();

          await this.handleGeminiResponse(
            response,
            `Análisis del archivo: ${path.basename(document.fileName)}`
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Error al contactar con Gemini: ${error}`
          );
        }
      }
    );
  }

  // --- Funciones de grabación de voz ---
  async startRecording() {
    if (this.isRecording) return;
    this.isRecording = true;
    vscode.window.showInformationMessage("🎤 Grabando audio...");
    // Aquí iría impplementación real de grabación de voz
    setTimeout(() => {
      if (this.isRecording) {
        this.processVoiceCommand(
          "Simulación de comando de voz: Analiza el proyecto."
        );
        this.stopRecording();
      }
    }, 5000);
  }

  stopRecording() {
    this.isRecording = false;
    vscode.window.showInformationMessage("⏹️ Grabación detenida");
  }

  private async processVoiceCommand(command: string) {
    if (!this.genAI) {
      vscode.window.showErrorMessage("API Key de Gemini no configurada");
      return;
    }
    try {
      const model = this.genAI.getGenerativeModel({model: "gemini-2.0-flash"});
      const context = this.buildContextForGemini();
      const prompt = `Contexto del proyecto: ${JSON.stringify(
        context,
        null,
        2
      )}\n\nComando del usuario: ${command}\n\nPor favor, analiza la solicitud y proporciona una respuesta específica basada en el contexto del proyecto. Si es necesario editar archivos, proporciona las modificaciones exactas.`;
      const result = await model.generateContent(prompt);
      const response = result.response.text();
      await this.handleGeminiResponse(response, command);
    } catch (error) {
      vscode.window.showErrorMessage(`Error con Gemini: ${error}`);
    }
  }

  private buildContextForGemini() {
    let projectRoot = "";
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else if (vscode.window.activeTextEditor) {
      projectRoot = path.dirname(
        vscode.window.activeTextEditor.document.uri.fsPath
      );
    }
    return {
      workspace: projectRoot,
      openFiles: vscode.window.visibleTextEditors.map((editor) => ({
        path: editor.document.fileName,
        language: editor.document.languageId,
        content: editor.document.getText(),
      })),
      projectInfo: this.projectInfo,
      activeFile: vscode.window.activeTextEditor?.document.fileName,
    };
  }

  private async handleGeminiResponse(
    response: string,
    originalCommand: string
  ) {
    if (!this.webviewView) {
      vscode.window.showInformationMessage(
        "La respuesta de Gemini está lista. Abra la vista del asistente para verla."
      );
      return;
    }
    this.webviewView.webview.postMessage({
      type: "gemini_response",
      data: {
        command: originalCommand,
        response: response,
        timestamp: new Date().toISOString(),
      },
    });
    await this.tryApplyChanges(response);
  }

  private async tryApplyChanges(response: string) {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/g;
    const matches = [...response.matchAll(codeBlockRegex)];
    for (const match of matches) {
      const language = match[1];
      const code = match[2];
      if (language && code) {
        const action = await vscode.window.showInformationMessage(
          `¿Aplicar cambios sugeridos en ${language}?`,
          "Aplicar",
          "Revisar",
          "Cancelar"
        );
        if (action === "Aplicar") await this.applyCodeChanges(code);
        else if (action === "Revisar")
          await this.showCodePreview(code, language);
      }
    }
  }

  private async applyCodeChanges(code: string) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        activeEditor.document.positionAt(0),
        activeEditor.document.positionAt(activeEditor.document.getText().length)
      );
      edit.replace(activeEditor.document.uri, fullRange, code);
      await vscode.workspace.applyEdit(edit);
      await activeEditor.document.save();
    }
  }

  private async showCodePreview(code: string, language: string) {
    const doc = await vscode.workspace.openTextDocument({
      content: code,
      language: language,
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  // Sincronización con el servidor MCP
  async analyzeCurrentProject() {
    let projectPath: string | undefined;
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      projectPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else if (vscode.window.activeTextEditor) {
      projectPath = path.dirname(
        vscode.window.activeTextEditor.document.uri.fsPath
      );
    }
    if (!projectPath) {
      vscode.window.showErrorMessage(
        "Para analizar un proyecto, abre una carpeta o un archivo."
      );
      return;
    }
    try {
      const projectData = {
        type: "analyze_project",
        data: {
          path: projectPath,
          includeFiles: true,
          includeDependencies: true,
          includeErrors: true,
        },
      };
      if (this.mcpSocket && this.mcpSocket.readyState === WebSocket.OPEN) {
        this.mcpSocket.send(JSON.stringify(projectData));
        vscode.window.setStatusBarMessage(
          "Sincronizando información del proyecto con MCP...",
          3000
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error al analizar el proyecto: ${error}`);
    }
  }

  //== MÉTODO CLAVE: Configura la vista de la barra lateral (WebviewView)
  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = {enableScripts: true};
    webviewView.webview.html = this.getWebviewContent();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "saveApiKey":
          await this.saveApiKey(message.key);
          break;
        case "startRecording":
          this.startRecording();
          break;
        case "stopRecording":
          this.stopRecording();
          break;
        case "analyzeActiveFile":
          this.analyzeActiveFileWithGemini();
          break;
        case "syncProject":
          this.analyzeCurrentProject();
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this.webviewView = null;
    });

    this.updateApiKeyStatus();
    this.updateWebview();
  }

  private updateWebview() {
    if (this.webviewView) {
      this.webviewView.webview.postMessage({
        type: "update_project_info",
        data: this.projectInfo,
      });
    }
  }

  //Contenido del Webview con la sección de API Key (HTML)
  private getWebviewContent(): string {
    return contentHTML;
  }
}
