export declare const policy: { readPaths: string[]; writePaths: string[]; mentions: string[]; commandRegexes: string[] };
export declare function matchGuard(tool: string, input?: Record<string, unknown>, projectDir?: string): string | undefined;
