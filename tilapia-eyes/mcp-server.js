const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

class MCPServer {
  constructor() {
    this.wss = new WebSocket.Server({ port: 3000 });
    this.setupServer();
  }

  setupServer() {
    console.log("🚀 Servidor MCP iniciado en puerto 3000");

    this.wss.on("connection", (ws) => {
      console.log("Cliente conectado");

      ws.on("message", async (message) => {
        try {
          const data = JSON.parse(message.toString());
          await this.handleMessage(ws, data);
        } catch (error) {
          console.error("Error procesando mensaje:", error);
          ws.send(
            JSON.stringify({
              type: "error",
              message: error.message,
            })
          );
        }
      });

      ws.on("close", () => {
        console.log("Cliente desconectado");
      });
    });
  }

  async handleMessage(ws, data) {
    switch (data.type) {
      case "analyze_project":
        await this.analyzeProject(ws, data.data);
        break;
      case "get_file_content":
        await this.getFileContent(ws, data.data);
        break;
      case "update_file":
        await this.updateFile(ws, data.data);
        break;
      case "run_command":
        await this.runCommand(ws, data.data);
        break;
      default:
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Tipo de mensaje desconocido: ${data.type}`,
          })
        );
    }
  }

  async analyzeProject(ws, projectData) {
    try {
      console.log(`Analizando proyecto: ${projectData.path}`);

      const analysis = {
        files: [],
        structure: {},
        errors: [],
        dependencies: {},
        gitInfo: {},
        metrics: {},
      };

      // Análizar estructura de archivos
      if (projectData.includeFiles) {
        analysis.files = await this.getProjectFiles(projectData.path);
      }

      // Obtener información de dependencias
      if (projectData.includeDependencies) {
        analysis.dependencies = await this.getDependencies(projectData.path);
      }

      // Ejecutar linters y detectar errores
      if (projectData.includeErrors) {
        analysis.errors = await this.detectErrors(projectData.path);
      }

      // Información de Git
      analysis.gitInfo = await this.getGitInfo(projectData.path);

      // Métricas del proyecto
      analysis.metrics = await this.getProjectMetrics(projectData.path);

      // Estructura de carpetas
      analysis.structure = await this.getDirectoryStructure(projectData.path);

      ws.send(
        JSON.stringify({
          type: "project_analysis",
          data: analysis,
        })
      );
    } catch (error) {
      console.error("Error en análisis de proyecto:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: `Error analizando proyecto: ${error.message}`,
        })
      );
    }
  }

  async getProjectFiles(projectPath, maxFiles = 100) {
    const files = [];
    const excludePatterns = [
      /node_modules/,
      /\.git/,
      /dist/,
      /build/,
      /\.env/,
      /\.log$/,
      /\.(jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot)$/i,
    ];

    const scanDirectory = (dir, relativePath = "") => {
      if (files.length >= maxFiles) return;

      try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          if (files.length >= maxFiles) break;

          const fullPath = path.join(dir, item);
          const relativeFilePath = path.join(relativePath, item);

          // Excluir archivos/carpetas no deseados
          if (
            excludePatterns.some((pattern) => pattern.test(relativeFilePath))
          ) {
            continue;
          }

          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            scanDirectory(fullPath, relativeFilePath);
          } else if (stat.isFile() && stat.size < 50000) {
            // Max 50KB por archivo
            try {
              const content = fs.readFileSync(fullPath, "utf-8");
              const language = this.detectLanguage(item);

              files.push({
                path: relativeFilePath,
                content:
                  content.length > 2000
                    ? content.substring(0, 2000) + "...[truncated]"
                    : content,
                language,
                size: stat.size,
                lastModified: stat.mtime.toISOString(),
              });
            } catch (readError) {
              // Ignorar archivos que no se pueden leer
              console.warn(`No se pudo leer: ${fullPath}`);
            }
          }
        }
      } catch (error) {
        console.warn(`No se pudo acceder al directorio: ${dir}`);
      }
    };

    scanDirectory(projectPath);
    return files;
  }

  detectLanguage(filename) {
    const ext = path.extname(filename).toLowerCase();
    const langMap = {
      ".js": "javascript",
      ".mjs": "javascript",
      ".jsx": "javascriptreact",
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".py": "python",
      ".java": "java",
      ".cpp": "cpp",
      ".cc": "cpp",
      ".cxx": "cpp",
      ".c": "c",
      ".h": "c",
      ".hpp": "cpp",
      ".cs": "csharp",
      ".php": "php",
      ".rb": "ruby",
      ".go": "go",
      ".rs": "rust",
      ".html": "html",
      ".htm": "html",
      ".css": "css",
      ".scss": "scss",
      ".sass": "sass",
      ".less": "less",
      ".json": "json",
      ".xml": "xml",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".md": "markdown",
      ".sql": "sql",
      ".sh": "shell",
      ".bash": "shell",
      ".zsh": "shell",
      ".ps1": "powershell",
      ".dockerfile": "dockerfile",
      ".r": "r",
      ".swift": "swift",
      ".kt": "kotlin",
      ".scala": "scala",
      ".dart": "dart",
    };

    // Casos especiales por nombre de archivo
    const filenameMap = {
      dockerfile: "dockerfile",
      makefile: "makefile",
      rakefile: "ruby",
      gemfile: "ruby",
    };

    const lowerName = filename.toLowerCase();
    return filenameMap[lowerName] || langMap[ext] || "text";
  }

  async getDependencies(projectPath) {
    const dependencies = {
      package: {},
      requirements: [],
      gemfile: [],
      composer: {},
      cargo: {},
      gomod: [],
    };

    try {
      // package.json (Node.js)
      const packageJsonPath = path.join(projectPath, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf-8")
        );
        dependencies.package = {
          dependencies: packageJson.dependencies || {},
          devDependencies: packageJson.devDependencies || {},
          scripts: packageJson.scripts || {},
        };
      }

      // requirements.txt (Python)
      const requirementsPath = path.join(projectPath, "requirements.txt");
      if (fs.existsSync(requirementsPath)) {
        dependencies.requirements = fs
          .readFileSync(requirementsPath, "utf-8")
          .split("\n")
          .filter((line) => line.trim() && !line.startsWith("#"));
      }

      // Gemfile (Ruby)
      const gemfilePath = path.join(projectPath, "Gemfile");
      if (fs.existsSync(gemfilePath)) {
        dependencies.gemfile = fs
          .readFileSync(gemfilePath, "utf-8")
          .split("\n");
      }

      // composer.json (PHP)
      const composerPath = path.join(projectPath, "composer.json");
      if (fs.existsSync(composerPath)) {
        const composer = JSON.parse(fs.readFileSync(composerPath, "utf-8"));
        dependencies.composer = {
          require: composer.require || {},
          "require-dev": composer["require-dev"] || {},
        };
      }

      // Cargo.toml (Rust)
      const cargoPath = path.join(projectPath, "Cargo.toml");
      if (fs.existsSync(cargoPath)) {
        const cargoContent = fs.readFileSync(cargoPath, "utf-8");
        dependencies.cargo = { content: cargoContent };
      }
    } catch (error) {
      console.error("Error obteniendo dependencias:", error);
    }

    return dependencies;
  }

  async detectErrors(projectPath) {
    const errors = [];

    try {
      // Detectar errores de sintaxis básicos para diferentes lenguajes
      const files = await this.getProjectFiles(projectPath, 50);

      for (const file of files) {
        try {
          switch (file.language) {
            case "javascript":
            case "typescript":
              await this.checkJSErrors(projectPath, file, errors);
              break;
            case "python":
              await this.checkPythonErrors(projectPath, file, errors);
              break;
            case "json":
              await this.checkJSONErrors(file, errors);
              break;
          }
        } catch (error) {
          console.warn(`Error verificando ${file.path}:`, error.message);
        }
      }
    } catch (error) {
      console.error("Error detectando errores:", error);
    }

    return errors;
  }

  async checkJSErrors(projectPath, file, errors) {
    try {
      // Buscar patrones comunes de errores
      const content = file.content;
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        // Detectar console.log olvidados
        if (line.includes("console.log") && !line.includes("//")) {
          errors.push({
            file: file.path,
            line: index + 1,
            column: line.indexOf("console.log"),
            message:
              "console.log detectado - considera removerlo en producción",
            severity: "warning",
            type: "code_smell",
          });
        }

        // Detectar variables no utilizadas (patrón simple)
        const unusedVarMatch = line.match(/^(\s*)(let|const|var)\s+(\w+)/);
        if (unusedVarMatch) {
          const varName = unusedVarMatch[3];
          const restOfFile = lines.slice(index + 1).join("\n");
          if (!restOfFile.includes(varName)) {
            errors.push({
              file: file.path,
              line: index + 1,
              column: unusedVarMatch.index,
              message: `Variable '${varName}' definida pero no utilizada`,
              severity: "warning",
              type: "unused_variable",
            });
          }
        }

        // Detectar funciones vacías
        if (
          line.trim() === "function" ||
          (line.includes("function") && line.includes("{}"))
        ) {
          errors.push({
            file: file.path,
            line: index + 1,
            message: "Función vacía detectada",
            severity: "info",
            type: "empty_function",
          });
        }
      });
    } catch (error) {
      console.error("Error en checkJSErrors:", error);
    }
  }

  async checkPythonErrors(projectPath, file, errors) {
    try {
      const content = file.content;
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        // Detectar imports no utilizados
        const importMatch = line.match(/^import\s+(\w+)/);
        if (importMatch) {
          const importName = importMatch[1];
          const restOfFile = lines.slice(index + 1).join("\n");
          if (!restOfFile.includes(importName)) {
            errors.push({
              file: file.path,
              line: index + 1,
              message: `Import '${importName}' no utilizado`,
              severity: "warning",
              type: "unused_import",
            });
          }
        }

        // Detectar print statements
        if (line.includes("print(") && !line.includes("#")) {
          errors.push({
            file: file.path,
            line: index + 1,
            message: "print() detectado - considera usar logging",
            severity: "info",
            type: "code_smell",
          });
        }
      });
    } catch (error) {
      console.error("Error en checkPythonErrors:", error);
    }
  }

  async checkJSONErrors(file, errors) {
    try {
      JSON.parse(file.content);
    } catch (error) {
      errors.push({
        file: file.path,
        line: 1,
        message: `JSON inválido: ${error.message}`,
        severity: "error",
        type: "syntax_error",
      });
    }
  }

  async getGitInfo(projectPath) {
    const gitInfo = {
      isRepository: false, // Añadimos un indicador
      branch: "",
      lastCommit: "",
      status: "",
      remotes: [],
    };

    try {
      // 1. Comprobar si existe la carpeta .git
      const gitFolderPath = path.join(projectPath, ".git");
      if (!fs.existsSync(gitFolderPath)) {
        // Si no existe, no es un repo de Git. Devolvemos la información vacía.
        return gitInfo;
      }

      gitInfo.isRepository = true;

      // Opciones para execSync para evitar que los errores se impriman en la consola
      const execOptions = {
        cwd: projectPath, // 2. Usar cwd en lugar de process.chdir
        encoding: "utf-8",
        stdio: "pipe", // 3. Silenciar la salida de error (stderr)
      };

      // Branch actual
      try {
        gitInfo.branch = execSync(
          "git branch --show-current",
          execOptions
        ).trim();
      } catch (e) {
        // Puede fallar si no hay commits, etc.
        gitInfo.branch = "HEAD"; // Un fallback común
      }

      // Último commit
      try {
        const lastCommit = execSync(
          'git log -1 --pretty=format:"%h - %s (%an, %ar)"',
          execOptions
        );
        gitInfo.lastCommit = lastCommit.trim();
      } catch (e) {
        /* No hay commits */
      }

      // Status
      try {
        const status = execSync("git status --porcelain", execOptions);
        gitInfo.status = status.trim();
      } catch (e) {
        /* Error obteniendo status */
      }

      // Remotes
      try {
        const remotes = execSync("git remote -v", execOptions);
        gitInfo.remotes = remotes.trim().split("\n");
      } catch (e) {
        /* No hay remotes */
      }
    } catch (error) {
      // Este catch ahora solo se activará por errores inesperados, no por comandos de git fallidos.
      console.warn(
        "Error inesperado obteniendo información de Git:",
        error.message
      );
    }

    return gitInfo;
  }

  async getProjectMetrics(projectPath) {
    const metrics = {
      totalFiles: 0,
      totalLines: 0,
      languageDistribution: {},
      largestFiles: [],
      complexity: "low",
    };

    try {
      const files = await this.getProjectFiles(projectPath, 500);

      metrics.totalFiles = files.length;

      files.forEach((file) => {
        const lines = file.content.split("\n").length;
        metrics.totalLines += lines;

        // Distribución por lenguaje
        if (!metrics.languageDistribution[file.language]) {
          metrics.languageDistribution[file.language] = 0;
        }
        metrics.languageDistribution[file.language]++;

        // Archivos más grandes
        if (file.size > 1000) {
          metrics.largestFiles.push({
            path: file.path,
            size: file.size,
            lines: lines,
          });
        }
      });

      // Ordenar archivos por tamaño
      metrics.largestFiles.sort((a, b) => b.size - a.size);
      metrics.largestFiles = metrics.largestFiles.slice(0, 10);

      // Determinar complejidad básica
      if (metrics.totalFiles > 100 || metrics.totalLines > 10000) {
        metrics.complexity = "high";
      } else if (metrics.totalFiles > 50 || metrics.totalLines > 5000) {
        metrics.complexity = "medium";
      }
    } catch (error) {
      console.error("Error calculando métricas:", error);
    }

    return metrics;
  }

  async getDirectoryStructure(projectPath, maxDepth = 3) {
    const structure = {};

    const buildStructure = (dir, currentDepth = 0) => {
      if (currentDepth >= maxDepth) return null;

      try {
        const items = fs.readdirSync(dir);
        const result = {};

        for (const item of items) {
          // Excluir carpetas comunes que no son relevantes
          if (
            ["node_modules", ".git", "dist", "build", ".vscode"].includes(item)
          ) {
            continue;
          }

          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            const subStructure = buildStructure(fullPath, currentDepth + 1);
            if (subStructure) {
              result[item] = {
                type: "directory",
                children: subStructure,
              };
            } else {
              result[item] = { type: "directory" };
            }
          } else {
            result[item] = {
              type: "file",
              size: stat.size,
              modified: stat.mtime.toISOString(),
            };
          }
        }

        return result;
      } catch (error) {
        return null;
      }
    };

    structure.root = buildStructure(projectPath);
    return structure;
  }

  async getFileContent(ws, data) {
    try {
      const filePath = path.resolve(data.path);
      const content = fs.readFileSync(filePath, "utf-8");

      ws.send(
        JSON.stringify({
          type: "file_content",
          data: {
            path: data.path,
            content: content,
            language: this.detectLanguage(path.basename(filePath)),
          },
        })
      );
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: `Error leyendo archivo: ${error.message}`,
        })
      );
    }
  }

  async updateFile(ws, data) {
    try {
      const filePath = path.resolve(data.path);
      fs.writeFileSync(filePath, data.content, "utf-8");

      ws.send(
        JSON.stringify({
          type: "file_updated",
          data: {
            path: data.path,
            success: true,
          },
        })
      );
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: `Error actualizando archivo: ${error.message}`,
        })
      );
    }
  }

  async runCommand(ws, data) {
    try {
      const result = execSync(data.command, {
        cwd: data.workingDirectory || process.cwd(),
        encoding: "utf-8",
        timeout: 30000, // 30 segundos de timeout
      });

      ws.send(
        JSON.stringify({
          type: "command_result",
          data: {
            command: data.command,
            output: result,
            success: true,
          },
        })
      );
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "command_result",
          data: {
            command: data.command,
            output: error.message,
            success: false,
            error: error.message,
          },
        })
      );
    }
  }
}

// Iniciar el servidor
const server = new MCPServer();

// Manejo de señales para cierre graceful
process.on("SIGINT", () => {
  console.log("\n🛑 Cerrando servidor MCP...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Cerrando servidor MCP...");
  process.exit(0);
});
