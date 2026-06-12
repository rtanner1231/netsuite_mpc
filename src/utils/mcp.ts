import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { fileURLToPath } from "url";

export const getProjectRoot = async (server: Server): Promise<string> => {
    try {
        const result = await server.listRoots();
        if (result.roots && result.roots.length > 0) {
            return fileURLToPath(result.roots[0].uri);
        }
    } catch (error) {
        console.error("Failed to fetch roots from client, falling back to cwd:", error);
    }
    return process.cwd();
};
