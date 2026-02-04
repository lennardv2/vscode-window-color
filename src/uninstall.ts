import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Must match MANAGED_COLOR_KEYS in extension.ts
const MANAGED_COLOR_KEYS = [
    "titleBar.activeBackground", "titleBar.activeForeground",
    "titleBar.inactiveBackground", "titleBar.inactiveForeground",
    "statusBarItem.warningBackground", "statusBarItem.warningForeground",
    "statusBarItem.warningHoverBackground", "statusBarItem.warningHoverForeground",
    "statusBarItem.remoteBackground", "statusBarItem.remoteForeground",
    "statusBarItem.remoteHoverBackground", "statusBarItem.remoteHoverForeground",
    "statusBar.background", "statusBar.foreground", "statusBar.border",
    "statusBar.debuggingBackground", "statusBar.debuggingForeground", "statusBar.debuggingBorder",
    "statusBar.noFolderBackground", "statusBar.noFolderForeground", "statusBar.noFolderBorder",
    "statusBar.prominentBackground", "statusBar.prominentForeground",
    "statusBar.prominentHoverBackground", "statusBar.prominentHoverForeground",
    "focusBorder", "progressBar.background",
    "textLink.foreground", "textLink.activeForeground",
    "selection.background", "list.highlightForeground", "list.focusAndSelectionOutline",
    "button.background", "button.foreground", "button.hoverBackground",
    "tab.activeBorderTop", "pickerGroup.foreground",
    "list.activeSelectionBackground", "panelTitle.activeBorder",
    "activityBar.background", "activityBar.foreground", "activityBar.activeBorder",
    "activityBar.inactiveForeground", "activityBarBadge.foreground", "activityBarBadge.background",
];

function stripJsonComments(text: string): string {
    let result = '';
    let i = 0;
    let inString = false;
    let stringChar = '';

    while (i < text.length) {
        if (inString) {
            if (text[i] === '\\') {
                result += text[i] + (text[i + 1] || '');
                i += 2;
                continue;
            }
            if (text[i] === stringChar) {
                inString = false;
            }
            result += text[i];
            i++;
        } else {
            if (text[i] === '"' || text[i] === "'") {
                inString = true;
                stringChar = text[i];
                result += text[i];
                i++;
            } else if (text[i] === '/' && text[i + 1] === '/') {
                // Skip to end of line
                while (i < text.length && text[i] !== '\n') { i++; }
            } else if (text[i] === '/' && text[i + 1] === '*') {
                // Skip to end of block comment
                i += 2;
                while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { i++; }
                i += 2;
            } else {
                result += text[i];
                i++;
            }
        }
    }

    // Remove trailing commas before } or ]
    return result.replace(/,(\s*[}\]])/g, '$1');
}

function readJsonFile(filePath: string): any | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(stripJsonComments(content));
    } catch {
        return null;
    }
}

function writeJsonFile(filePath: string, data: any): void {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf-8');
    } catch {
        // Silently fail — file might be read-only or on a remote filesystem
    }
}

function removeExtensionKeys(settings: Record<string, any>): boolean {
    let modified = false;

    // Remove managed color keys from workbench.colorCustomizations
    const colorCustomizations = settings['workbench.colorCustomizations'];
    if (colorCustomizations && typeof colorCustomizations === 'object') {
        for (const key of MANAGED_COLOR_KEYS) {
            if (key in colorCustomizations) {
                delete colorCustomizations[key];
                modified = true;
            }
        }
        if (Object.keys(colorCustomizations).length === 0) {
            delete settings['workbench.colorCustomizations'];
        }
    }

    // Remove window.title if present at workspace level
    if ('window.title' in settings) {
        delete settings['window.title'];
        modified = true;
    }

    // Remove all windowColor.* keys
    for (const key of Object.keys(settings)) {
        if (key.startsWith('windowColor.')) {
            delete settings[key];
            modified = true;
        }
    }

    return modified;
}

function cleanWorkspaceFile(filePath: string): void {
    const data = readJsonFile(filePath);
    if (!data) { return; }

    let modified = false;

    if (filePath.endsWith('.code-workspace')) {
        // .code-workspace: settings are in data.settings
        if (data.settings && typeof data.settings === 'object') {
            modified = removeExtensionKeys(data.settings);
        }
    } else {
        // .vscode/settings.json: settings are at top level
        modified = removeExtensionKeys(data);
    }

    if (modified) {
        writeJsonFile(filePath, data);
    }
}

function findUserSettingsPaths(): string[] {
    const home = os.homedir();
    const extPath = __dirname;
    const candidates: string[] = [];

    // VS Code Server (remote SSH)
    if (extPath.includes('.vscode-server')) {
        candidates.push(path.join(home, '.vscode-server', 'data', 'User', 'settings.json'));
    }

    if (process.platform === 'linux') {
        candidates.push(
            path.join(home, '.config', 'Code', 'User', 'settings.json'),
            path.join(home, '.config', 'Code - Insiders', 'User', 'settings.json'),
            path.join(home, '.config', 'Cursor', 'User', 'settings.json'),
            path.join(home, '.config', 'VSCodium', 'User', 'settings.json'),
        );
    } else if (process.platform === 'darwin') {
        const appSupport = path.join(home, 'Library', 'Application Support');
        candidates.push(
            path.join(appSupport, 'Code', 'User', 'settings.json'),
            path.join(appSupport, 'Code - Insiders', 'User', 'settings.json'),
            path.join(appSupport, 'Cursor', 'User', 'settings.json'),
            path.join(appSupport, 'VSCodium', 'User', 'settings.json'),
        );
    } else if (process.platform === 'win32') {
        const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        candidates.push(
            path.join(appdata, 'Code', 'User', 'settings.json'),
            path.join(appdata, 'Code - Insiders', 'User', 'settings.json'),
            path.join(appdata, 'Cursor', 'User', 'settings.json'),
            path.join(appdata, 'VSCodium', 'User', 'settings.json'),
        );
    }

    return candidates.filter(p => fs.existsSync(p));
}

function main(): void {
    const userSettingsPaths = findUserSettingsPaths();

    // Collect all known workspace paths from every user settings file found
    const workspacePaths = new Set<string>();

    for (const settingsPath of userSettingsPaths) {
        const settings = readJsonFile(settingsPath);
        if (!settings) { continue; }

        // Gather workspace paths from windowColor.workspaceSettings
        const wsSettings = settings['windowColor.workspaceSettings'];
        if (wsSettings && typeof wsSettings === 'object') {
            for (const key of Object.keys(wsSettings)) {
                workspacePaths.add(key);
            }
        }

        // Gather workspace paths from windowColor.workspaces
        const wsRefs = settings['windowColor.workspaces'];
        if (Array.isArray(wsRefs)) {
            for (const ref of wsRefs) {
                if (ref?.directory) { workspacePaths.add(ref.directory); }
            }
        }

        // Clean windowColor.* from user settings
        let modified = false;
        for (const key of Object.keys(settings)) {
            if (key.startsWith('windowColor.')) {
                delete settings[key];
                modified = true;
            }
        }
        if (modified) {
            writeJsonFile(settingsPath, settings);
        }
    }

    // Clean each workspace's settings file
    for (const wsPath of workspacePaths) {
        if (wsPath.endsWith('.code-workspace')) {
            cleanWorkspaceFile(wsPath);
        } else {
            cleanWorkspaceFile(path.join(wsPath, '.vscode', 'settings.json'));
        }
    }
}

main();
