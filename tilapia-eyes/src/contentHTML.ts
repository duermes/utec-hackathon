const contentHTML = `<!DOCTYPE html>
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
                margin-bottom: 20px; 
                padding: 15px; 
                border: 1px solid var(--vscode-panel-border); 
                border-radius: 5px; 
            }
            h1, h2 { 
                margin-top: 0; 
                border-bottom: 1px solid var(--vscode-panel-border);
                padding-bottom: 8px;
            }
            .button { 
                background-color: var(--vscode-button-background); 
                color: var(--vscode-button-foreground); 
                border: none; 
                padding: 10px 15px; 
                margin: 5px 0; 
                border-radius: 3px; 
                cursor: pointer; 
                width: 100%; 
                text-align: left; 
                display: block;
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
            .api-key-input { 
                width: calc(100% - 22px); 
                padding: 8px; 
                margin-bottom: 10px; 
                border-radius: 3px; 
                border: 1px solid var(--vscode-input-border); 
                background-color: var(--vscode-input-background); 
                color: var(--vscode-input-foreground); 
            }
            .api-key-status { 
                padding: 10px; 
                background-color: var(--vscode-textBlockQuote-background); 
                border-left: 4px solid var(--vscode-focusBorder); 
                border-radius: 3px; 
            }
            .status { 
                font-weight: bold; 
                margin: 10px 0; 
            }
            .project-info { 
                font-size: 12px; 
                max-height: 150px; 
                overflow-y: auto; 
                background-color: var(--vscode-textBlockQuote-background); 
                padding: 10px; 
                border-radius: 3px; 
            }
            .response { 
                background-color: var(--vscode-textBlockQuote-background); 
                padding: 15px; 
                margin: 10px 0; 
                border-left: 4px solid var(--vscode-textBlockQuote-border); 
                white-space: pre-wrap; 
                word-wrap: break-word;
            }
            .error { color: var(--vscode-errorForeground); }
            .warning { color: var(--vscode-warningForeground); }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Gemini Assistant</h1>

            <div class="section">
                <h2>Configuración</h2>
                <div id="apiKeyForm">
                    <p>Introduce tu API Key de Google Gemini:</p>
                    <input type="password" id="apiKeyInput" class="api-key-input" placeholder="Pega tu API Key aquí">
                    <button id="saveApiKeyBtn" class="button">Guardar API Key</button>
                </div>
                <div id="apiKeyStatus" style="display: none;" class="api-key-status">
                    <p>✅ API Key configurada y activa.</p>
                </div>
            </div>
            
            <div class="section">
                <h2>Acciones Rápidas</h2>
                <button id="analyzeFileBtn" class="button">🤖 Analizar Archivo Actual</button>
                <button id="syncProjectBtn" class="button">🔄 Sincronizar Proyecto (MCP)</button>
            </div>

            <div class="section">
                <h2>Control por Voz</h2>
                <button id="recordBtn" class="button">🎤 Iniciar Grabación</button>
                <button id="stopBtn" class="button" disabled>⏹️ Detener</button>
                <div id="status" class="status">Listo para grabar</div>
            </div>

            <div class="section">
                <h2>Información del Proyecto (MCP)</h2>
                <div id="projectInfo" class="project-info"><p>Presiona "Sincronizar Proyecto" para cargar la información.</p></div>
            </div>

            <div class="section">
                <h2>Respuestas de Gemini</h2>
                <div id="responses"></div>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();

            const apiKeyForm = document.getElementById('apiKeyForm');
            const apiKeyStatus = document.getElementById('apiKeyStatus');
            const apiKeyInput = document.getElementById('apiKeyInput');
            const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');

            saveApiKeyBtn.addEventListener('click', () => {
                const key = apiKeyInput.value;
                if (key) {
                    vscode.postMessage({ command: 'saveApiKey', key: key });
                }
            });

            document.getElementById('analyzeFileBtn').addEventListener('click', () => vscode.postMessage({ command: 'analyzeActiveFile' }));
            document.getElementById('syncProjectBtn').addEventListener('click', () => vscode.postMessage({ command: 'syncProject' }));
            document.getElementById('recordBtn').addEventListener('click', () => vscode.postMessage({ command: 'startRecording' }));
            document.getElementById('stopBtn').addEventListener('click', () => vscode.postMessage({ command: 'stopRecording' }));

            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.type) {
                    case 'apiKeyStatusUpdate':
                        updateApiKeyView(message.data.hasApiKey);
                        break;
                    case 'update_project_info':
                        updateProjectInfo(message.data);
                        break;
                    case 'gemini_response':
                        addGeminiResponse(message.data);
                        break;
                }
            });

            function updateApiKeyView(hasKey) {
                if (hasKey) {
                    apiKeyForm.style.display = 'none';
                    apiKeyStatus.style.display = 'block';
                } else {
                    apiKeyForm.style.display = 'block';
                    apiKeyStatus.style.display = 'none';
                }
            }

            function updateProjectInfo(data) {
                const projectInfoDiv = document.getElementById('projectInfo');
                if (!data || (!data.files && !data.errors)) {
                    projectInfoDiv.innerHTML = '<p>No hay información del proyecto o no se pudo cargar.</p>';
                    return;
                }
                let html = '';
                if (data.files && data.files.length > 0) html += \`<p><strong>Archivos:</strong> \${data.files.length}</p>\`;
                if (data.errors && data.errors.length > 0) {
                    html += \`<p><strong>Errores Detectados:</strong> \${data.errors.length}</p>\`;
                    html += '<div class="errors">';
                    data.errors.slice(0, 5).forEach(error => {
                        html += \`<p class="\${error.severity}">📁 \${error.file}:\${error.line} - \${error.message}</p>\`;
                    });
                    html += '</div>';
                }
                projectInfoDiv.innerHTML = html || '<p>Análisis completado. No se encontraron errores o archivos relevantes.</p>';
            }

            function addGeminiResponse(data) {
                const responsesDiv = document.getElementById('responses');
                const responseEl = document.createElement('div');
                responseEl.className = 'response';
                
                const sanitizedCommand = document.createElement('div');
                sanitizedCommand.innerText = data.command;

                const sanitizedResponse = document.createElement('div');
                sanitizedResponse.innerText = data.response;

                responseEl.innerHTML = \`
                    <strong>Comando:</strong> \${sanitizedCommand.innerHTML}<br>
                    <strong>Respuesta de Gemini:</strong><br>
                    \${sanitizedResponse.innerHTML.replace(/\\n/g, '<br>')}
                    <br><small>\${new Date(data.timestamp).toLocaleString()}</small>
                \`;
                responsesDiv.insertBefore(responseEl, responsesDiv.firstChild);
            }
        </script>
    </body>
    </html>`;

export default contentHTML;
