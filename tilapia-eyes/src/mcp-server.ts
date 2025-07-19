import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

class VSCodeWorkspaceMCP {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'vscode-workspace-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    // Listar herramientas disponibles
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'read_file',
            description: 'Lee el contenido de un archivo del workspace',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Ruta del archivo desde la raíz del workspace',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'write_file',
            description: 'Escribe contenido a un archivo del workspace',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Ruta del archivo desde la raíz del workspace',
                },
                content: {
                  type: 'string',
                  description: 'Contenido a escribir',
                },
              },
              required: ['path', 'content'],
            },
          },
          {
            name: 'list_files',
            description: 'Lista archivos en el workspace',
            inputSchema: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'string',
                  description: 'Patrón de archivos (ej: "**/*.ts")',
                  default: '**/*',
                },
              },
            },
          },
        ],
      };
    });

    // Manejar llamadas a herramientas
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'read_file':
            return await this.readFile(args.path);
          case 'write_file':
            return await this.writeFile(args.path, args.content);
          case 'list_files':
            return await this.listFiles(args.pattern);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Herramienta desconocida: ${name}`);
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error ejecutando ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private getWorkspacePath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No hay workspace abierto');
    }
    return workspaceFolder.uri.fsPath;
  }

  private resolveWorkspacePath(relativePath: string): string {
    const workspacePath = this.getWorkspacePath();
    const fullPath = path.resolve(workspacePath, relativePath);
    
    if (!fullPath.startsWith(workspacePath)) {
      throw new Error('Ruta fuera del workspace no permitida');
    }
    
    return fullPath;
  }

  private async readFile(relativePath: string) {
    try {
      const fullPath = this.resolveWorkspacePath(relativePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      
      return {
        content: [
          {
            type: 'text',
            text: `📄 Contenido de ${relativePath}:\n\n${content}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`No se pudo leer el archivo ${relativePath}: ${error}`);
    }
  }

  private async writeFile(relativePath: string, content: string) {
    try {
      const fullPath = this.resolveWorkspacePath(relativePath);
      
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(fullPath, content, 'utf-8');
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ Archivo ${relativePath} escrito exitosamente`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`No se pudo escribir el archivo ${relativePath}: ${error}`);
    }
  }

  private async listFiles(pattern: string = '**/*') {
    try {
      const workspacePath = this.getWorkspacePath();
      
      const files = await glob(pattern, {
        cwd: workspacePath,
        ignore: '**/node_modules/**',
        nodir: true,
      });

      return {
        content: [
          {
            type: 'text',
            text: `📂 Archivos encontrados (${files.length}):\n\n${files.join('\n')}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Error listando archivos: ${error}`);
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('🚀 VSCode Workspace MCP server iniciado');
  }
}

export async function startMCPServer(): Promise<VSCodeWorkspaceMCP> {
  const mcpServer = new VSCodeWorkspaceMCP();
  await mcpServer.run();
  return mcpServer;
}

if (require.main === module) {
  const server = new VSCodeWorkspaceMCP();
  server.run().catch(console.error);
}