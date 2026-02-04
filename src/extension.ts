import * as vscode from 'vscode';
import { getWorkspaceWebview } from './views/workspace';
import { getListWebview } from './views/list';
import {
    getContrastColor,
    lightenOrDarkenColor,
    transparency,
    mixColors,
    hexToRgb
} from './helpers';
import {
    applyColorCustomizations,
    readConfig,
    deleteWindowReference,
    moveWorkspace,
    saveWindowReference,
    saveWindowGroup,
    deleteWindowGroup,
    loadWindowReferences,
    loadWindowGroups,
    loadWorkspaceConfig,
    saveToWorkspaceConfig,
    saveAllWorkspaceSettings,
    saveWorkspaceToGroup,
    renameWindowGroup
} from './workspaces';

export type WindowSettings = {
    windowName: string;
    mainColor: string;
    mainColorContrast?: string;
    isActivityBarColored: boolean;
    isTitleBarColored: boolean;
    isStatusBarColored: boolean;
    isWindowNameColored: boolean;
    isActiveItemsColored: boolean;
    setWindowTitle: boolean;
}

export type WindowReference = {
    directory: string;
}

export type WindowGroup = {
    name: string;
    windows: WindowReference[];
}

let workspaceStatusbar : vscode.StatusBarItem;
let isInitializing = true;

// All color customization keys managed by this extension
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

export async function activate(context: vscode.ExtensionContext) {
    // Check if we have a workspace file (.code-workspace)
    let currentWorkspace: string;
    if (vscode.workspace.workspaceFile) {
        // Use the workspace file path if it exists
        currentWorkspace = vscode.workspace.workspaceFile.fsPath;
    } else {
        // Otherwise use the first workspace folder
        currentWorkspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    }
    
    if (!currentWorkspace) {
        return;
    }
    // console.log('[DEBUG] Reading initial config for workspace:', currentWorkspace);
    let currentConfig = await readConfig(currentWorkspace);
    // console.log('[DEBUG] Initial config read:', JSON.stringify(currentConfig, null, 2));
    
    // Check if we need to save default values
    const userSettings = vscode.workspace.getConfiguration('windowColor');
    const existingSettings = userSettings.get<Record<string, any>>('workspaceSettings') || {};
    const normalizedPath = currentWorkspace.replace(/\\/g, '/').replace(/\/$/, '');
    const hasWorkspaceSettings = !!existingSettings[normalizedPath];

    if (!hasWorkspaceSettings) {
        // Save all defaults atomically in a single write
        await saveAllWorkspaceSettings(currentWorkspace, {
            name: currentConfig.windowName,
            mainColor: currentConfig.mainColor,
            isStatusBarColored: currentConfig.isStatusBarColored,
            isWindowNameColored: currentConfig.isWindowNameColored,
            isActiveItemsColored: currentConfig.isActiveItemsColored,
            setWindowTitle: currentConfig.setWindowTitle,
            isActivityBarColored: currentConfig.isActivityBarColored,
            isTitleBarColored: currentConfig.isTitleBarColored,
        });

        // Re-read config after saving defaults to ensure consistency
        currentConfig = await readConfig(currentWorkspace);
    }

    // listStatusbar = vscode.window.createStatusBarItem(
    //     vscode.StatusBarAlignment.Left,
    //     Infinity
    // );

    // updateListStatusbar(listStatusbar, currentConfig);
    // listStatusbar.command = 'set-window-color-name.openList';
    // listStatusbar.show();

    // context.subscriptions.push(listStatusbar);

    // Create a status bar item with low priority to appear farthest to the left
    workspaceStatusbar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        Infinity
    );

    updateWorkspaceStatusbar(workspaceStatusbar, currentConfig);
    workspaceStatusbar.command = 'set-window-color-name.openSettings';
    workspaceStatusbar.show();

    // Ensure the status bar item is available immediately on launch
    context.subscriptions.push(workspaceStatusbar);

    // createListCommand(context);
    createWindowSettingsCommand(context);
    createRemoveColorsCommand(context);

    // Initialize window title on activation
    updateWindowTitle(currentConfig);

    // Apply color customizations AFTER all configurations are saved
    // This ensures the settings.json exists with all values before applying colors
    // console.log('[DEBUG] Applying initial color customizations');
    const initialCustomizations = generateColorCustomizations(currentConfig);
    // console.log('[DEBUG] Initial color customizations generated:', JSON.stringify(initialCustomizations, null, 2));
    await applyColorCustomizations(initialCustomizations);
    // console.log('[DEBUG] Initial color customizations applied');

    // Mark initialization as complete
    isInitializing = false;

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('windowColor') && !isInitializing) {
                // console.log('[DEBUG] Configuration change detected, isInitializing:', isInitializing);
                const updatedConfig = await readConfig(currentWorkspace);
                // console.log('[DEBUG] Updated config after change:', JSON.stringify(updatedConfig, null, 2));
                const updatedCustomizations = generateColorCustomizations(updatedConfig);
                // console.log('[DEBUG] Updated color customizations generated:', JSON.stringify(updatedCustomizations, null, 2));
                await applyColorCustomizations(updatedCustomizations);
                // console.log('[DEBUG] Updated color customizations applied');
                updateWorkspaceStatusbar(workspaceStatusbar, updatedConfig);
                updateWindowTitle(updatedConfig);
            } else {
                // console.log('[DEBUG] Configuration change ignored - affectsWindowColor:', e.affectsConfiguration('windowColor'), 'isInitializing:', isInitializing);
            }
        })
    );
}

async function createWindowSettingsWebview(context: vscode.ExtensionContext, directory: string) {
    const panel = vscode.window.createWebviewPanel(
        'windowSettings',
        'Window Settings',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    async function updateWebview() {
        const args = await readConfig(directory);
        const packageJson = require('../package.json');
        panel.webview.html = getWorkspaceWebview(args, packageJson.version);
    }

    panel.onDidChangeViewState(async () => {
        if (panel.visible) {
            await updateWebview();
        }
    });

    panel.webview.onDidReceiveMessage(
        async (message) => {
            if (message.command === 'setProps') {
                let editingIsCurrentWorkspace = directory === vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                let newProps: WindowSettings = message.props;
                
                // Apply colors immediately for instant feedback (don't await)
                // console.log('[DEBUG] Applying colors from webview message with props:', JSON.stringify(newProps, null, 2));
                const webviewCustomizations = generateColorCustomizations(newProps);
                // console.log('[DEBUG] Webview color customizations generated:', JSON.stringify(webviewCustomizations, null, 2));
                applyColorCustomizations(webviewCustomizations);
                // console.log('[DEBUG] Webview color customizations applied');
                
                if (editingIsCurrentWorkspace) {
                    updateWorkspaceStatusbar(workspaceStatusbar, newProps);
                    updateWindowTitle(newProps);
                }
                
                // Save all settings atomically in a single write to avoid race conditions
                await saveAllWorkspaceSettings(directory, {
                    name: newProps.windowName,
                    mainColor: newProps.mainColor,
                    isActivityBarColored: newProps.isActivityBarColored,
                    isTitleBarColored: newProps.isTitleBarColored,
                    isStatusBarColored: newProps.isStatusBarColored,
                    isWindowNameColored: newProps.isWindowNameColored,
                    isActiveItemsColored: newProps.isActiveItemsColored,
                    setWindowTitle: newProps.setWindowTitle
                });

                // Save workspace reference
                await saveWindowReference({ directory });
            }
        },
        undefined,
        context.subscriptions
    );

    await updateWebview();
}

function createWindowSettingsCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('set-window-color-name.openSettings', async () => {
        // Check if we have a workspace file (.code-workspace)
        let currentWorkspace: string;
        if (vscode.workspace.workspaceFile) {
            // Use the workspace file path if it exists
            currentWorkspace = vscode.workspace.workspaceFile.fsPath;
        } else {
            // Otherwise use the first workspace folder
            currentWorkspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        }
        await createWindowSettingsWebview(context, currentWorkspace);
    });
    context.subscriptions.push(disposable);
}

function createRemoveColorsCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('set-window-color-name.removeColors', async () => {
        await removeAllColorCustomizations();
        vscode.window.showInformationMessage('Window Color & Name: All color customizations have been removed from this workspace.');
    });
    context.subscriptions.push(disposable);
}

async function removeAllColorCustomizations(): Promise<void> {
    const config = vscode.workspace.getConfiguration();

    // Remove managed color keys from workbench.colorCustomizations
    const existingCustomizations = config.get<any>("workbench.colorCustomizations") || {};
    const cleaned = { ...existingCustomizations };
    for (const key of MANAGED_COLOR_KEYS) {
        delete cleaned[key];
    }

    // If the object is now empty, remove it entirely; otherwise update
    if (Object.keys(cleaned).length === 0) {
        await config.update("workbench.colorCustomizations", undefined, vscode.ConfigurationTarget.Workspace);
    } else {
        await config.update("workbench.colorCustomizations", cleaned, vscode.ConfigurationTarget.Workspace);
    }

    // Remove window.title if it was set by this extension
    const windowConfig = vscode.workspace.getConfiguration('window');
    const inspected = windowConfig.inspect('title');
    if (inspected?.workspaceValue !== undefined) {
        await windowConfig.update('title', undefined, vscode.ConfigurationTarget.Workspace);
    }
}

function updateWorkspaceStatusbar(item: vscode.StatusBarItem, args: WindowSettings): void {
    item.text = `${args.windowName}`;
    if (args.isWindowNameColored || args.isStatusBarColored) {
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground'); // Use warning color for contrast
        item.color = new vscode.ThemeColor('statusBarItem.warningForeground'); // Use warning foreground color for contrast
    } else {
        item.backgroundColor = undefined;
        item.color = undefined;
    }
    item.tooltip = `Project: ${args.windowName}\nColor: ${args.mainColor}`;
}

let originalWindowTitle: string | undefined;

function updateWindowTitle(args: WindowSettings): void {
    const config = vscode.workspace.getConfiguration('window');

    // Save the user's original title before we overwrite it (only once)
    if (originalWindowTitle === undefined) {
        const inspected = config.inspect('title');
        // Use the workspace value if set, otherwise undefined (VS Code will use its own default)
        originalWindowTitle = inspected?.workspaceValue as string | undefined ?? '';
    }

    try {
        if (args.setWindowTitle) {
            config.update('title', args.windowName, vscode.ConfigurationTarget.Workspace);
        } else {
            // Restore: remove workspace-level override so VS Code falls back to user/default
            config.update('title', originalWindowTitle || undefined, vscode.ConfigurationTarget.Workspace);
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to update window title: ${error.message}`);
    }
}

function generateColorCustomizations(args: WindowSettings): any {
    // console.log('[DEBUG] Generating color customizations for:', JSON.stringify(args, null, 2));
    const contrastColor = getContrastColor(args.mainColor);
    // console.log('[DEBUG] Contrast color calculated:', contrastColor);

    const semiTransparentContrast = `${contrastColor}90`;

    const customizations: any = {
        "workbench.colorCustomizations": {
            
        }
    };

    if (args.isTitleBarColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "titleBar.activeBackground": args.mainColor,
            "titleBar.activeForeground": contrastColor,
            "titleBar.inactiveBackground": args.mainColor,
            "titleBar.inactiveForeground": semiTransparentContrast,
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "titleBar.activeBackground": null,
            "titleBar.activeForeground": null,
            "titleBar.inactiveBackground": null,
            "titleBar.inactiveForeground": null,
        };
    }

    if (args.isWindowNameColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            // "statusBar.background": args.mainColor,
            // "statusBar.foreground": contrastColor,

            "statusBarItem.warningBackground": args.mainColor,
            "statusBarItem.warningForeground": contrastColor,
            "statusBarItem.warningHoverBackground": args.mainColor,
            "statusBarItem.warningHoverForeground": semiTransparentContrast,

            // "statusBarItem.hoverBackground": args.mainColor,
            // "statusBarItem.hoverForeground": semiTransparentContrast,
            "statusBarItem.remoteBackground": args.mainColor,
            "statusBarItem.remoteForeground": contrastColor,
            "statusBarItem.remoteHoverBackground": args.mainColor,
            "statusBarItem.remoteHoverForeground": semiTransparentContrast,
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "statusBarItem.warningBackground": null,
            "statusBarItem.warningForeground": null,
            "statusBarItem.warningHoverBackground": null,
            "statusBarItem.warningHoverForeground": null,
            "statusBarItem.remoteBackground": null,
            "statusBarItem.remoteForeground": null,
            "statusBarItem.remoteHoverBackground": null,
            "statusBarItem.remoteHoverForeground": null,
        };
    }

    if (args.isStatusBarColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "statusBar.background": args.mainColor,
            "statusBar.foreground": contrastColor,
            "statusBarItem.warningBackground": args.mainColor,
            "statusBarItem.warningForeground": contrastColor,
            "statusBarItem.warningHoverBackground": args.mainColor,
            "statusBarItem.warningHoverForeground": semiTransparentContrast,
            "statusBar.border": args.mainColor,
            "statusBar.debuggingBackground": args.mainColor,
            "statusBar.debuggingForeground": contrastColor,
            "statusBar.debuggingBorder": args.mainColor,
            "statusBar.noFolderBackground": args.mainColor,
            "statusBar.noFolderForeground": contrastColor,
            "statusBar.noFolderBorder": args.mainColor,
            "statusBar.prominentBackground": args.mainColor,
            "statusBar.prominentForeground": contrastColor,
            "statusBar.prominentHoverBackground": args.mainColor,
            "statusBar.prominentHoverForeground": semiTransparentContrast,

            "statusBarItem.remoteBackground": lightenOrDarkenColor(args.mainColor, 5),
            "statusBarItem.remoteForeground": contrastColor,
            "statusBarItem.remoteHoverBackground": lightenOrDarkenColor(args.mainColor, 10),
            "statusBarItem.remoteHoverForeground": semiTransparentContrast,
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "statusBar.background": null,
            "statusBar.foreground": null,
            // Don't clear warning colors if window name is colored - they're needed for workspace name
            ...(args.isWindowNameColored ? {} : {
                "statusBarItem.warningBackground": null,
                "statusBarItem.warningForeground": null,
                "statusBarItem.warningHoverBackground": null,
                "statusBarItem.warningHoverForeground": null,
            }),
            "statusBar.border": null,
            "statusBar.debuggingBackground": null,
            "statusBar.debuggingForeground": null,
            "statusBar.debuggingBorder": null,
            "statusBar.noFolderBackground": null,
            "statusBar.noFolderForeground": null,
            "statusBar.noFolderBorder": null,
            "statusBar.prominentBackground": null,
            "statusBar.prominentForeground": null,
            "statusBar.prominentHoverBackground": null,
            "statusBar.prominentHoverForeground": null,
            // Don't clear remote colors if window name is colored - they're needed for workspace name
            ...(args.isWindowNameColored ? {} : {
                "statusBarItem.remoteBackground": null,
                "statusBarItem.remoteForeground": null,
                "statusBarItem.remoteHoverBackground": null,
                "statusBarItem.remoteHoverForeground": null,
            }),
        };
    }

    if (args.isActiveItemsColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            // Only set status bar items if they're not already handled by window name or status bar coloring
            ...(!args.isWindowNameColored && !args.isStatusBarColored ? {
                "statusBarItem.warningBackground": args.mainColor,
                "statusBarItem.warningForeground": contrastColor,
                "statusBarItem.warningHoverBackground": args.mainColor,
                "statusBarItem.warningHoverForeground": semiTransparentContrast,
                "statusBarItem.remoteBackground": args.mainColor,
                "statusBarItem.remoteForeground": contrastColor,
                "statusBarItem.remoteHoverBackground": args.mainColor,
                "statusBarItem.remoteHoverForeground": semiTransparentContrast,
            } : {}),
            "focusBorder": transparency(args.mainColor, 0.6),
            "progressBar.background": args.mainColor,
            "textLink.foreground": lightenOrDarkenColor(args.mainColor, 25),
            "textLink.activeForeground": lightenOrDarkenColor(args.mainColor, 30),
            "selection.background": lightenOrDarkenColor(args.mainColor, -5),
            "list.highlightForeground": lightenOrDarkenColor(args.mainColor, 0),
            "list.focusAndSelectionOutline": transparency(args.mainColor, 0.6),
            "button.background": args.mainColor,
            "button.foreground": contrastColor,
            "button.hoverBackground": lightenOrDarkenColor(args.mainColor, 5),
            "tab.activeBorderTop": lightenOrDarkenColor(args.mainColor, 5),
            "pickerGroup.foreground": lightenOrDarkenColor(args.mainColor, 5),
            "list.activeSelectionBackground": transparency(args.mainColor, 0.3),
            "panelTitle.activeBorder": lightenOrDarkenColor(args.mainColor, 5),
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            // Only clear status bar items if they're not handled by other sections
            ...(!args.isWindowNameColored && !args.isStatusBarColored ? {
                "statusBarItem.warningBackground": null,
                "statusBarItem.warningForeground": null,
                "statusBarItem.warningHoverBackground": null,
                "statusBarItem.warningHoverForeground": null,
                "statusBarItem.remoteBackground": null,
                "statusBarItem.remoteForeground": null,
                "statusBarItem.remoteHoverBackground": null,
                "statusBarItem.remoteHoverForeground": null,
            } : {}),
            // Only clear status bar background if status bar coloring is not enabled
            ...(!args.isStatusBarColored ? {
                "statusBar.background": null,
                "statusBar.foreground": null,
                "statusBar.border": null,
                "statusBar.debuggingBackground": null,
                "statusBar.debuggingForeground": null,
                "statusBar.debuggingBorder": null,
                "statusBar.noFolderBackground": null,
                "statusBar.noFolderForeground": null,
                "statusBar.noFolderBorder": null,
                "statusBar.prominentBackground": null,
                "statusBar.prominentForeground": null,
                "statusBar.prominentHoverBackground": null,
                "statusBar.prominentHoverForeground": null,
            } : {}),
            "focusBorder": null,
            "progressBar.background": null,
            "textLink.foreground": null,
            "textLink.activeForeground": null,
            "selection.background": null,
            "list.highlightForeground": null,
            "list.focusAndSelectionOutline": null,
            "button.background": null,
            "button.foreground": null,
            "button.hoverBackground": null,
            "tab.activeBorderTop": null,
            "pickerGroup.foreground": null,
            "list.activeSelectionBackground": null,
            "panelTitle.activeBorder": null,
        };
    }

    if (args.isActivityBarColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "activityBar.background": args.mainColor,
            "activityBar.foreground": contrastColor,
            "activityBar.activeBorder": args.isActiveItemsColored ? args.mainColor : contrastColor,
            "activityBar.inactiveForeground": semiTransparentContrast,
            "activityBarBadge.foreground": args.isActiveItemsColored ? contrastColor : (contrastColor === "#ffffff" ? "#000000" : "#ffffff"),
            "activityBarBadge.background": args.isActiveItemsColored ? args.mainColor : (contrastColor === "#ffffff" ? lightenOrDarkenColor(args.mainColor, 75) : lightenOrDarkenColor(args.mainColor, -75)),
        };
    } else if (args.isActiveItemsColored) {
        // If only active items is colored but not activity bar, still color the badge and border
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "activityBar.background": null,
            "activityBar.foreground": null,
            "activityBar.activeBorder": args.mainColor,
            "activityBar.inactiveForeground": null,
            "activityBarBadge.foreground": contrastColor,
            "activityBarBadge.background": args.mainColor,
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "activityBar.background": null,
            "activityBar.foreground": null,
            "activityBar.activeBorder": null,
            "activityBar.inactiveForeground": null,
            "activityBarBadge.foreground": null,
            "activityBarBadge.background": null,
        };
    }

    // console.log('[DEBUG] Final customizations generated:', JSON.stringify(customizations, null, 2));
    return customizations;
}

export function deactivate() {
    // Note: deactivate is called on every VS Code shutdown, not just uninstall.
    // Users who want to fully clean up should use the "Remove Window Colors" command
    // before uninstalling. The color customizations persist in .vscode/settings.json
    // by design so they survive restarts.
}