import * as vscode from "vscode";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { WebSocket } from "ws";

interface ProjectInfo {
  files: Array<{
    path: string;
    content: string;
    language: string;
  }>;
  structure: any;
  errors: Array<{
    file: string;
    line: number;
    message: string;
    severity: string;
  }>;
  dependencies: any;
}

class GeminiVoiceAssistant {
  private genAI: GoogleGenerativeAI | null = null;
  private isRecording = false;
  private webviewPanel: vscode.WebviewPanel | null = null;
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
      });
    } catch (error) {
      console.error("Error al conectar con MCP:", error);
    }
  }

  private handleMCPResponse(response: any) {
    if (response.type === "project_analysis") {
      this.projectInfo = response.data;
      this.updateWebview();
    }
  }

  async startRecording() {
    if (this.isRecording) return;

    this.isRecording = true;
    vscode.window.showInformationMessage("🎤 Grabando audio...");

    try {
      // Implementación de grabación de audio
      const audioBuffer = await this.captureAudio();
      console.log("aqui1");
      const transcript = await this.transcribeAudio(audioBuffer);
      console.log("aqui2");


      if (transcript) {
      console.log("aqui3");

        await this.processVoiceCommand(transcript);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error en la grabación: ${error}`);
    } finally {
      this.isRecording = false;
    }
  }

  stopRecording() {
    this.isRecording = false;
    vscode.window.showInformationMessage("⏹️ Grabación detenida");
  }

  private async captureAudio(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const record = require("node-record-lpcm16");
      const chunks: Buffer[] = [];

      const recording = record.record({
        sampleRateHertz: 16000,
        threshold: 0,
        verbose: false,
        recordProgram: "rec", // or 'sox' on some systems
        silence: "1.0s",
      });

      recording.stream().on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      recording.stream().on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      recording.stream().on("error", (err: Error) => {
        reject(err);
      });

      // Auto-stop after 10 seconds
      setTimeout(() => {
        recording.stop();
      }, 10000);
    });
  }

  private async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    // Aquí integrarías un servicio de transcripción
    // Por ejemplo, Google Speech-to-Text, Azure Speech, etc.
    // Para este ejemplo, simularemos la transcripción

    try {
      // Simulación de transcripción - reemplazar con servicio real
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return "Analiza los errores en el archivo main.py y sugiere correcciones";
    } catch (error) {
      throw new Error("Error en la transcripción");
    }
  }

  private async processVoiceCommand(command: string) {
    if (!this.genAI) {
      vscode.window.showErrorMessage("API Key de Gemini no configurada");
      return;
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-pro" });

      const context = this.buildContextForGemini();
      const prompt = `
        Contexto del proyecto: ${JSON.stringify(context, null, 2)}
        
        Comando del usuario: ${command}
        
        Por favor, analiza la solicitud y proporciona una respuesta específica basada en el contexto del proyecto.
        Si es necesario editar archivos, proporciona las modificaciones exactas.
      `;

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
    // Crear panel de webview para mostrar la respuesta
    if (!this.webviewPanel) {
      this.createWebviewPanel();
    }

    // Actualizar el webview con la respuesta
    this.webviewPanel?.webview.postMessage({
      type: "gemini_response",
      data: {
        command: originalCommand,
        response: response,
        timestamp: new Date().toISOString(),
      },
    });

    // Intentar aplicar cambios automáticamente si es posible
    await this.tryApplyChanges(response);
  }

  private async tryApplyChanges(response: string) {
    // Analizar la respuesta de Gemini para cambios de código
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

        if (action === "Aplicar") {
          await this.applyCodeChanges(code, language);
        } else if (action === "Revisar") {
          await this.showCodePreview(code, language);
        }
      }
    }
  }

  private async applyCodeChanges(code: string, language: string) {
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
    await vscode.window.showTextDocument(doc);
  }

  async analyzeCurrentProject() {
    let projectPath: string | undefined;
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      projectPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else if (vscode.window.activeTextEditor) {
      // Si no hay workspace, usa el directorio del archivo activo
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
      } else {
        // El análisis local también necesita una ruta raíz
        const uri = vscode.Uri.file(projectPath);
        const folderName = path.basename(projectPath);
        await this.performLocalAnalysis({ uri, name: folderName, index: 0 });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error al analizar el proyecto: ${error}`);
    }
  }

  private async performLocalAnalysis(projectRoot: {
    uri: vscode.Uri;
    name: string;
    index: number;
  }) {
    const files: any[] = [];
    const errors: any[] = [];

    // Obtener archivos del "proyecto" (sea un workspace o una carpeta de archivo)
    const filePattern = new vscode.RelativePattern(projectRoot, "**/*");
    const foundFiles = await vscode.workspace.findFiles(
      filePattern,
      "**/node_modules/**"
    );

    for (const file of foundFiles.slice(0, 50)) {
      // Limitar a 50 archivos
      try {
        const content = await vscode.workspace.fs.readFile(file);
        const text = Buffer.from(content).toString("utf8");

        files.push({
          path: vscode.workspace.asRelativePath(file, false), // Usar 'false' para que funcione fuera de un workspace
          content: text.length > 1000 ? text.substring(0, 1000) + "..." : text,
          language: this.getLanguageFromExtension(file.fsPath),
        });
      } catch (error) {
        console.error(`Error leyendo archivo ${file.fsPath}:`, error);
      }
    }

    // Obtener diagnósticos (errores)
    vscode.languages.getDiagnostics().forEach(([uri, diagnostics]) => {
      diagnostics.forEach((diagnostic) => {
        errors.push({
          file: vscode.workspace.asRelativePath(uri, false),
          line: diagnostic.range.start.line + 1,
          message: diagnostic.message,
          severity: this.getSeverityString(diagnostic.severity),
        });
      });
    });

    this.projectInfo = {
      files,
      structure: { type: "local_analysis" },
      errors,
      dependencies: {},
    };

    this.updateWebview();
  }

  private getLanguageFromExtension(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: { [key: string]: string } = {
      ".js": "javascript",
      ".ts": "typescript",
      ".py": "python",
      ".java": "java",
      ".cpp": "cpp",
      ".c": "c",
      ".html": "html",
      ".css": "css",
      ".json": "json",
      ".md": "markdown",
    };
    return langMap[ext] || "text";
  }

  private getSeverityString(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return "error";
      case vscode.DiagnosticSeverity.Warning:
        return "warning";
      case vscode.DiagnosticSeverity.Information:
        return "info";
      case vscode.DiagnosticSeverity.Hint:
        return "hint";
      default:
        return "unknown";
    }
  }

  createWebviewPanel() {
    this.webviewPanel = vscode.window.createWebviewPanel(
      "geminiVoiceView",
      "Gemini Voice Assistant",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.webviewPanel.webview.html = this.getWebviewContent();

    this.webviewPanel.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "startRecording":
          this.startRecording();
          break;
        case "stopRecording":
          this.stopRecording();
          break;
        case "analyzeProject":
          this.analyzeCurrentProject();
          break;
      }
    });

    this.webviewPanel.onDidDispose(() => {
      this.webviewPanel = null;
    });
  }

  private updateWebview() {
    if (this.webviewPanel) {
      this.webviewPanel.webview.postMessage({
        type: "update_project_info",
        data: this.projectInfo,
      });
    }
  }

  private getWebviewContent(): string {
    return `<!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Gemini Voice Assistant</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                margin: 0;
                padding: 20px;
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
            }
            .section {
                margin-bottom: 30px;
                padding: 15px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 5px;
            }
            .button {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 10px 20px;
                margin: 5px;
                border-radius: 3px;
                cursor: pointer;
            }
            .button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            .button.recording {
                background-color: #ff4444;
                animation: pulse 1s infinite;
            }
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
            }
            .status {
                font-weight: bold;
                margin: 10px 0;
            }
            .project-info {
                font-size: 12px;
                max-height: 200px;
                overflow-y: auto;
            }
            .response {
                background-color: var(--vscode-textBlockQuote-background);
                padding: 15px;
                margin: 10px 0;
                border-left: 4px solid var(--vscode-textBlockQuote-border);
                white-space: pre-wrap;
            }
            .error {
                color: var(--vscode-errorForeground);
            }
            .warning {
                color: var(--vscode-warningForeground);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎤 Gemini Voice Assistant</h1>
            
            <div class="section">
                <h2>Control de Audio</h2>
                <button id="recordBtn" class="button">🎤 Iniciar Grabación</button>
                <button id="stopBtn" class="button" disabled>⏹️ Detener</button>
                <div id="status" class="status">Listo para grabar</div>
            </div>

            <div class="section">
                <h2>Análisis del Proyecto</h2>
                <button id="analyzeBtn" class="button">🔍 Analizar Proyecto</button>
                <div id="projectInfo" class="project-info"></div>
            </div>

            <div class="section">
                <h2>Respuestas de Gemini</h2>
                <div id="responses"></div>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let isRecording = false;

            document.getElementById('recordBtn').addEventListener('click', () => {
                if (!isRecording) {
                    vscode.postMessage({ command: 'startRecording' });
                    startRecordingUI();
                }
            });

            document.getElementById('stopBtn').addEventListener('click', () => {
                if (isRecording) {
                    vscode.postMessage({ command: 'stopRecording' });
                    stopRecordingUI();
                }
            });

            document.getElementById('analyzeBtn').addEventListener('click', () => {
                vscode.postMessage({ command: 'analyzeProject' });
            });

            function startRecordingUI() {
                isRecording = true;
                document.getElementById('recordBtn').disabled = true;
                document.getElementById('stopBtn').disabled = false;
                document.getElementById('recordBtn').classList.add('recording');
                document.getElementById('status').textContent = 'Grabando...';
            }

            function stopRecordingUI() {
                isRecording = false;
                document.getElementById('recordBtn').disabled = false;
                document.getElementById('stopBtn').disabled = true;
                document.getElementById('recordBtn').classList.remove('recording');
                document.getElementById('status').textContent = 'Procesando...';
            }

            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.type) {
                    case 'update_project_info':
                        updateProjectInfo(message.data);
                        break;
                    case 'gemini_response':
                        addGeminiResponse(message.data);
                        stopRecordingUI();
                        document.getElementById('status').textContent = 'Listo para grabar';
                        break;
                }
            });

            function updateProjectInfo(data) {
                const projectInfoDiv = document.getElementById('projectInfo');
                if (!data) {
                    projectInfoDiv.innerHTML = '<p>No hay información del proyecto disponible</p>';
                    return;
                }

                let html = '';
                if (data.files && data.files.length > 0) {
                    html += \`<p><strong>Archivos:</strong> \${data.files.length}</p>\`;
                }
                if (data.errors && data.errors.length > 0) {
                    html += \`<p><strong>Errores:</strong> \${data.errors.length}</p>\`;
                    html += '<div class="errors">';
                    data.errors.slice(0, 5).forEach(error => {
                        html += \`<p class="\${error.severity}">📁 \${error.file}:\${error.line} - \${error.message}</p>\`;
                    });
                    html += '</div>';
                }
                
                projectInfoDiv.innerHTML = html;
            }

            function addGeminiResponse(data) {
                const responsesDiv = document.getElementById('responses');
                const responseEl = document.createElement('div');
                responseEl.className = 'response';
                responseEl.innerHTML = \`
                    <strong>Comando:</strong> \${data.command}<br>
                    <strong>Respuesta:</strong><br>
                    \${data.response}
                    <br><small>\${new Date(data.timestamp).toLocaleString()}</small>
                \`;
                responsesDiv.insertBefore(responseEl, responsesDiv.firstChild);
            }
        </script>
    </body>
    </html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const assistant = new GeminiVoiceAssistant(context);

  // Registrar comandos
  const startRecording = vscode.commands.registerCommand(
    "geminiVoice.startRecording",
    () => {
      assistant.startRecording();
    }
  );

  const stopRecording = vscode.commands.registerCommand(
    "geminiVoice.stopRecording",
    () => {
      assistant.stopRecording();
    }
  );

  const analyzeProject = vscode.commands.registerCommand(
    "geminiVoice.analyzeProject",
    () => {
      assistant.analyzeCurrentProject();
    }
  );

  // Registrar provider de vista
  const provider = vscode.window.registerWebviewViewProvider(
    "geminiVoiceView",
    {
      resolveWebviewView(webviewView) {
        assistant.createWebviewPanel();
      },
    }
  );

  context.subscriptions.push(
    startRecording,
    stopRecording,
    analyzeProject,
    provider
  );
}

export function deactivate() {}
