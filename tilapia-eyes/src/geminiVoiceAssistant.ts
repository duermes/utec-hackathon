// src/geminiVoiceAssistant.ts

import * as vscode from "vscode";
import { GoogleGenAI, Content, Model } from "@google/genai";
import * as path from "path";
import { WebSocket } from "ws";
import { SpeechClient, protos } from "@google-cloud/speech";
interface ProjectInfo {
  files: Array<{ path: string; content: string; language: string }>;
  structure: any;
  errors: Array<{
    file: string;
    line: number;
    message: string;
    severity: string;
  }>;
  dependencies: any;
}

export class GeminiVoiceAssistant {
  private ai: GoogleGenAI | null = null;
  private chatModel: Model | null = null;
  private isRecording = false;
  private webviewView: vscode.WebviewView | null = null;
  private mcpSocket: WebSocket | null = null;
  private projectInfo: ProjectInfo | null = null;

  private speechClient: SpeechClient | null = null;
  private chatHistory: Content[] = [];
  private currentRecordingPath: string | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.initializeGemini();
    this.initializeSpeechClient();
    this.connectToMCP();
  }

  private initializeGemini() {
    const config = vscode.workspace.getConfiguration("geminiVoice");
    const apiKey = config.get<string>("apiKey");
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
      console.log("Cliente de Gemini inicializado con éxito.");
    } else {
      console.warn("API Key de Gemini no encont}rada.");
    }
    this.updateApiKeyStatus();
  }

  private initializeSpeechClient() {
    try {
      this.speechClient = new SpeechClient();
      console.log("Cliente de Speech-to-Text inicializado.");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `No se pudo inicializar el cliente de Speech-to-Text: ${errorMessage}. Asegúrate de haber configurado la autenticación de Google Cloud.`
      );
    }
  }

  public async saveApiKey(key: string) {
    if (!key) {
      vscode.window.showErrorMessage("La API Key no puede estar vacía.");
      return;
    }
    try {
      const config = vscode.workspace.getConfiguration("geminiVoice");
      await config.update("apiKey", key, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        "API Key de Gemini guardada correctamente."
      );
      this.initializeGemini();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `No se pudo guardar la API Key: ${errorMessage}`
      );
    }
  }

  private updateApiKeyStatus() {
    if (this.webviewView) {
      this.webviewView.webview.postMessage({
        type: "apiKeyStatusUpdate",
        data: { hasApiKey: !!this.ai },
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
      this.mcpSocket.on("message", (data: any) => {
        const response = JSON.parse(data.toString());
        this.handleMCPResponse(response);
      });
      this.mcpSocket.on("error", (error: Error) => {
        console.error("Error de conexión MCP:", error);
        vscode.window.showWarningMessage(
          "No se pudo conectar al servidor MCP."
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

  public async analyzeActiveFileWithGemini() {
    if (!this.ai || !this.chatModel) {
      vscode.window.showErrorMessage(
        "La API Key de Gemini no está configurada."
      );
      return;
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage(
        "Por favor, abre un archivo para analizarlo."
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
      async () => {
        try {
          const prompt = `Eres un asistente experto en análisis de código. Analiza el siguiente código en lenguaje "${language}". Proporciona un resumen, posibles errores, sugerencias de mejora y buenas prácticas.\n\nCódigo:\n\`\`\`${language}\n${fileContent}\n\`\`\``;
          const result = await this.ai?.models.generateContent({model: "gemini-2.0-flash", contents: [{ role: "system", parts: [{ text: prompt }] }] });
          const responseText = result?.text || "No se obtuvo respuesta de Gemini.";
          
          await this.handleGeminiResponse(
            responseText,
            `Análisis del archivo: ${path.basename(document.fileName)}`
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Error al contactar con Gemini: ${errorMessage}`
          );
        }
      }
    );
  }

  // The recording is now handled inside the Webview.
  // These methods are triggered by messages from the webview.
  public startRecording() {
    if (this.isRecording) return;
    this.isRecording = true;
    this.webviewView?.webview.postMessage({ type: "startRecording" });
  }

  public stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.webviewView?.webview.postMessage({ type: "stopRecording" });
  }

  // This method will be called when the webview sends the audio data.
  public async processAudio(audioAsDataURL: string) {
    if (!this.speechClient) {
      vscode.window.showErrorMessage(
        "El cliente de Speech-to-Text no está inicializado."
      );
      return;
    }

    vscode.window.showInformationMessage("⏹️ Procesando audio...");

    try {
      // Convert Data URL to Buffer
      const base64Data = audioAsDataURL.split(",")[1];
      const audioBuffer = Buffer.from(base64Data, "base64");

      if (!audioBuffer || audioBuffer.length === 0) {
        vscode.window.showErrorMessage("No se pudo capturar audio.");
        this.updateWebviewWithTranscription("No se capturó audio", true);
        return;
      }

      console.log(`Audio capturado: ${audioBuffer.length} bytes`);
      await this.transcribeAudio(audioBuffer);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error al procesar la grabación:", error);
      vscode.window.showErrorMessage(
        `Error al procesar el audio: ${errorMessage}`
      );
    }
  }

  private async transcribeAudio(audioBuffer: Buffer) {
    if (!this.speechClient) {
      throw new Error("Cliente de Speech-to-Text no disponible");
    }

    try {
      console.log(`Transcribiendo audio: ${audioBuffer.length} bytes`);

      const request: protos.google.cloud.speech.v1.IRecognizeRequest = {
        audio: {
          content: audioBuffer.toString("base64"),
        },
        config: {
          encoding: "MP3",
          sampleRateHertz: 16000,
          languageCode: "es-ES",
          enableAutomaticPunctuation: true,
          model: "latest_long",
          useEnhanced: true,
        },
      };

      this.updateWebviewWithTranscription("Transcribiendo...", false);

      console.log("Enviando audio a Google Speech-to-Text...");
      const [response] = await this.speechClient.recognize(request);

      if (!response.results || response.results.length === 0) {
        console.warn("No se obtuvieron resultados de transcripción");
        vscode.window.showWarningMessage(
          "No se pudo transcribir el audio. Inténtalo de nuevo."
        );
        this.updateWebviewWithTranscription("No se detectó audio claro", true);
        return;
      }

      const transcript = response.results
        .map((result) => result.alternatives?.[0]?.transcript || "")
        .filter((text) => text.length > 0)
        .join(" ")
        .trim();

      console.log(`Transcripción obtenida: "${transcript}"`);

      if (transcript && transcript.length > 0) {
        this.updateWebviewWithTranscription(transcript, true);
        await this.processVoiceCommand(transcript);
      } else {
        vscode.window.showWarningMessage(
          "No se detectó ningún texto en el audio."
        );
        this.updateWebviewWithTranscription("No se detectó texto", true);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error en la transcripción:", error);

      let userMessage = `Error al transcribir audio: ${errorMessage}`;
      if (errorMessage.includes("quota")) {
        userMessage =
          "Error: Cuota de Google Speech-to-Text excedida. Inténtalo más tarde.";
      } else if (errorMessage.includes("authentication")) {
        userMessage =
          "Error: Problema de autenticación con Google Cloud. Verifica tu configuración.";
      } else if (errorMessage.includes("invalid")) {
        userMessage =
          "Error: El formato de audio no es válido. Inténtalo de nuevo.";
      }

      vscode.window.showErrorMessage(userMessage);
      this.updateWebviewWithTranscription("Error en transcripción", true);
    }
  }

  private updateWebviewWithTranscription(transcript: string, isFinal: boolean) {
    if (this.webviewView) {
      this.webviewView.webview.postMessage({
        type: "transcription_update",
        data: { transcript, isFinal },
      });
    }
  }

  private async processVoiceCommand(command: string) {
    if (!this.chatModel) {
      vscode.window.showErrorMessage("API Key de Gemini no configurada.");
      return;
    }
    if (!command) return;

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Gemini procesando: "${command}"`,
        cancellable: false,
      },
      async () => {
        try {
          const context = this.buildContextForGemini();
          const prompt = `Contexto del proyecto: ${JSON.stringify(
            context,
            null,
            2
          )}\n\nComando del usuario: "${command}"\n\nAnaliza la solicitud y proporciona una respuesta específica. Si necesitas editar archivos, proporciona las modificaciones exactas en bloques de código.`;

          const userContent: Content = {
            role: "user",
            parts: [{ text: prompt }],
          };
          this.chatHistory.push(userContent);

          const chatResult = await this.ai?.models.generateContentStream({ model: "gemini-2.0-flash", contents: this.chatHistory });

          let fullResponse = "";
          this.updateWebviewWithGeminiStream("", command, true);

          if (chatResult) {
            for await (const chunk of chatResult) {
              const chunkText = typeof chunk.text === "string" ? chunk.text : (typeof chunk.text === "function" ? chunk.text : "");
              fullResponse += chunkText;
              this.updateWebviewWithGeminiStream(chunkText, command, false);
            }
          } else {
            vscode.window.showErrorMessage("No se pudo obtener respuesta de Gemini.");
          }

          const modelContent: Content = {
            role: "model",
            parts: [{ text: fullResponse }],
          };
          this.chatHistory.push(modelContent);

          await this.tryApplyChanges(fullResponse);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Error con Gemini: ${errorMessage}`);
        }
      }
    );
  }

  private updateWebviewWithGeminiStream(
    chunk: string,
    command: string,
    isNew: boolean
  ) {
    if (this.webviewView) {
      this.webviewView.webview.postMessage({
        type: "gemini_stream_chunk",
        data: { chunk, command, isNew, timestamp: new Date().toISOString() },
      });
    }
  }

  private buildContextForGemini() {
    let projectRoot = "";
    if (vscode.workspace.workspaceFolders?.length) {
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
        "La respuesta de Gemini está lista."
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
      const language = match[1] || "";
      const code = match[2];
      if (code) {
        const action = await vscode.window.showInformationMessage(
          `Gemini sugiere aplicar cambios de código. ¿Qué deseas hacer?`,
          { modal: true },
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
      language,
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  public async analyzeCurrentProject() {
    let projectPath: string | undefined;
    if (vscode.workspace.workspaceFolders?.length) {
      projectPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    if (!projectPath) {
      vscode.window.showErrorMessage(
        "Abre una carpeta para analizar un proyecto."
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
      if (this.mcpSocket?.readyState === WebSocket.OPEN) {
        this.mcpSocket.send(JSON.stringify(projectData));
        vscode.window.setStatusBarMessage(
          "Sincronizando proyecto con MCP...",
          3000
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Error al analizar el proyecto: ${errorMessage}`
      );
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    const wasmUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "node_modules",
        "vmsg",
        "vmsg.wasm"
      )
    );

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "node_modules"),
      ],
    };

    webviewView.webview.html = this.getWebviewContent(wasmUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "saveApiKey":
          await this.saveApiKey(message.key);
          break;
        case "startRecording": // These are now just for UI updates
          this.startRecording();
          break;
        case "stopRecording": // These are now just for UI updates
          this.stopRecording();
          break;
        case "audioReady": // New message from webview with audio data
          this.processAudio(message.data);
          break;
        case "recordingError":
          vscode.window.showErrorMessage(
            `Error de grabación: ${message.error}`
          );
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

  private getWebviewContent(wasmUri: vscode.Uri): string {
    const vmsgUri = this.webviewView?.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "node_modules",
        "vmsg",
        "vmsg.js"
      )
    );

    return `<!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Gemini Voice Assistant</title>
        <style>
            body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background-color: var(--vscode-editor-background); padding: 20px; margin: 0; }
            .section { margin-bottom: 20px; padding: 15px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background-color: var(--vscode-panel-background); }
            h1, h2 { margin-top: 0; border-bottom: 2px solid var(--vscode-panel-border); padding-bottom: 8px; color: var(--vscode-foreground); }
            h1 { font-size: 1.5em; }
            h2 { font-size: 1.2em; }
            .button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 12px 16px; margin: 5px 0; border-radius: 6px; cursor: pointer; width: 100%; text-align: center; display: block; font-size: 14px; font-weight: 500; transition: background-color 0.2s; }
            .button:hover { background-color: var(--vscode-button-hoverBackground); }
            .button:disabled { opacity: 0.5; cursor: not-allowed; }
            .button.recording { background-color: #dc3545; animation: pulse 1.5s infinite; }
            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.8; } 100% { opacity: 1; } }
            .api-key-input { width: calc(100% - 22px); padding: 10px; margin-bottom: 10px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); }
            .api-key-status { padding: 12px; background-color: var(--vscode-textBlockQuote-background); border-left: 4px solid var(--vscode-charts-green); border-radius: 4px; margin-bottom: 10px; }
            .status, .transcription { font-weight: 500; margin: 10px 0; padding: 8px; }
            .transcription { background-color: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-focusBorder); border-radius: 4px; min-height: 24px; font-style: italic; }
            .response { background-color: var(--vscode-textBlockQuote-background); padding: 15px; margin: 10px 0; border-left: 4px solid var(--vscode-textBlockQuote-border); border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; font-family: var(--vscode-editor-font-family); line-height: 1.5; }
            .info-box { background-color: var(--vscode-textBlockQuote-background); border-left: 4px solid var(--vscode-charts-blue); padding: 10px; margin: 10px 0; border-radius: 4px; font-size: 0.9em; }
        </style>
    </head>
    <body>
        <h1>🎤 Gemini Voice Assistant</h1>
        
        <div class="section">
            <h2>⚙️ Configuración</h2>
            <div id="apiKeyForm">
                <p>Introduce tu API Key de Google Gemini:</p>
                <input type="password" id="apiKeyInput" class="api-key-input" placeholder="Pega tu API Key aquí">
                <button id="saveApiKeyBtn" class="button">💾 Guardar API Key</button>
                <div class="info-box">💡 <strong>Tip:</strong> Obtén tu API Key gratuita en <a href="https://makersuite.google.com/app/apikey" style="color: var(--vscode-textLink-foreground);">Google AI Studio</a></div>
            </div>
            <div id="apiKeyStatus" style="display: none;" class="api-key-status"><p>✅ <strong>API Key configurada y activa.</strong></p></div>
        </div>
        
        <div class="section">
            <h2>🎙️ Control por Voz</h2>
            <button id="recordBtn" class="button">🎤 Iniciar Grabación</button>
            <div id="status" class="status">✅ Listo para grabar</div>
            <div id="transcription" class="transcription">La transcripción aparecerá aquí...</div>
            <div class="info-box">ℹ️ La grabación se realiza en el navegador. No se necesitan dependencias externas.</div>
        </div>
        
        <div class="section">
            <h2>🤖 Respuestas de Gemini</h2>
            <div id="responses"><p style="color: var(--vscode-descriptionForeground); font-style: italic;">Las conversaciones aparecerán aquí...</p></div>
        </div>
        
        <script type="module">
            import vmsg from "${vmsgUri}";
            const vscode = acquireVsCodeApi();
            const recordBtn = document.getElementById('recordBtn');
            const statusDiv = document.getElementById('status');
            const transcriptionDiv = document.getElementById('transcription');
            const responsesDiv = document.getElementById('responses');
            const apiKeyForm = document.getElementById('apiKeyForm');
            const apiKeyStatus = document.getElementById('apiKeyStatus');
            
            let currentResponseEl = null;
            let isRecording = false;

            const recorder = new vmsg.Recorder({
                wasmURL: "${wasmUri}"
            });

            async function initRecorder() {
                try {
                    await recorder.initAudio();
                    await recorder.initWorker();
                } catch (e) {
                    console.error(e);
                    statusDiv.textContent = '❌ Error al iniciar grabadora. Revisa los permisos del micrófono.';
                    vscode.postMessage({ command: 'recordingError', error: e.message });
                }
            }
            
            initRecorder();

            document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
                const key = document.getElementById('apiKeyInput').value.trim();
                if (key) vscode.postMessage({ command: 'saveApiKey', key: key });
            });

            recordBtn.addEventListener('click', async () => {
                if (isRecording) {
                    // Stop recording
                    try {
                        const blob = await recorder.stopRecording();
                        isRecording = false;
                        recordBtn.disabled = false;
                        recordBtn.classList.remove('recording');
                        recordBtn.textContent = '🎤 Iniciar Grabación';
                        statusDiv.textContent = '🟡 Procesando...';
                        
                        const reader = new FileReader();
                        reader.onload = () => {
                            vscode.postMessage({ command: 'audioReady', data: reader.result });
                        };
                        reader.readAsDataURL(blob);

                    } catch (e) {
                        console.error(e);
                        statusDiv.textContent = '❌ Error al detener la grabación.';
                        vscode.postMessage({ command: 'recordingError', error: e.message });
                    }
                } else {
                    // Start recording
                    try {
                        await recorder.startRecording();
                        isRecording = true;
                        recordBtn.disabled = false;
                        recordBtn.classList.add('recording');
                        recordBtn.textContent = '⏹️ Detener Grabación';
                        statusDiv.textContent = '🔴 Grabando audio...';
                        transcriptionDiv.textContent = '🎙️ Habla ahora...';
                    } catch (e) {
                        console.error(e);
                        statusDiv.textContent = '❌ Error al iniciar la grabación.';
                        vscode.postMessage({ command: 'recordingError', error: e.message });
                    }
                }
            });

            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.type) {
                    case 'apiKeyStatusUpdate':
                        apiKeyForm.style.display = message.data.hasApiKey ? 'none' : 'block';
                        apiKeyStatus.style.display = message.data.hasApiKey ? 'block' : 'none';
                        recordBtn.disabled = !message.data.hasApiKey;
                        break;
                    case 'transcription_update':
                        transcriptionDiv.textContent = message.data.transcript;
                        if (message.data.isFinal) {
                            statusDiv.textContent = '✅ Transcripción completa';
                        }
                        break;
                    case 'gemini_stream_chunk':
                        if (message.data.isNew) {
                            if (responsesDiv.querySelector('p')) responsesDiv.innerHTML = '';
                            const responseContainer = document.createElement('div');
                            responseContainer.className = 'response';
                            responseContainer.innerHTML = \`<strong>Tú:</strong> <span style="font-style: italic;">\${message.data.command}</span><hr><strong>Gemini:</strong>\`;
                            currentResponseEl = document.createElement('div');
                            responseContainer.appendChild(currentResponseEl);
                            responsesDiv.prepend(responseContainer);
                        }
                        if (currentResponseEl) {
                            currentResponseEl.innerHTML += message.data.chunk.replace(/\\n/g, '<br>');
                        }
                        break;
                }
            });
        </script>
    </body>
    </html>`;
  }
}
