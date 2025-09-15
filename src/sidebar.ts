import * as vscode from 'vscode';
import { fetchIssuesForCurrentRepo, listScansForCurrentRepo, requestPatchForIssue } from './zeropathService';
import { ScanItem, Issue } from './zeropathTypes';
import { applyGitPatch } from './gitUtils';

export class ZeropathSidebarProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private _currentScans: ScanItem[] = [];
	private _currentIssues: Issue[] = [];
	private _selectedScanId?: string;
	private _shouldLoadScansOnReady: boolean = false;

	constructor(private readonly context: vscode.ExtensionContext) {}

	public async openScanViewPanel() {
		console.log('Zeropath: openScanViewPanel called, view exists:', !!this._view);
		
		// This method is called when the user clicks "View Scans" button
		// Ensure the sidebar is visible and load scans
		if (this._view) {
			console.log('Zeropath: View exists, triggering load');
			// Show the view if hidden
			this._view.show?.(true);
			// Send a message to the webview to trigger loading
			this.postMessage({ type: 'triggerLoadScans' });
			// Load scans
			await this.loadScans('Both');
		} else {
			console.log('Zeropath: View does not exist yet, setting flag for later');
			// If view doesn't exist yet, store a flag to load scans when ready
			this._shouldLoadScansOnReady = true;
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		console.log('Zeropath: resolveWebviewView called - VIEW CREATED');
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri]
		};

		// Set the initial HTML
		this.updateWebview();
		console.log('Zeropath: Webview HTML set');

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(async (message) => {
			console.log('Zeropath: Received message from webview:', message.type);
			await this.handleMessage(message);
		});
		
		// Update webview when it becomes visible
		webviewView.onDidChangeVisibility(() => {
			console.log('Zeropath: View visibility changed to:', webviewView.visible);
			if (webviewView.visible) {
				this.updateWebview();
				// Check if we should load scans when view becomes visible
				if (this._shouldLoadScansOnReady) {
					console.log('Zeropath: Loading scans on visibility change');
					this._shouldLoadScansOnReady = false;
					setTimeout(() => this.loadScans('Both'), 500);
				}
			}
		});
		
		// Check if we should load scans immediately
		if (this._shouldLoadScansOnReady && webviewView.visible) {
			console.log('Zeropath: Flag set to load scans on ready (view is visible)');
			this._shouldLoadScansOnReady = false;
			setTimeout(() => this.loadScans('Both'), 500);
		}
	}

	private async handleMessage(message: any) {
		console.log('Zeropath: handleMessage called with type:', message.type, 'full message:', message);
		switch (message.type) {
			case 'ready':
				console.log('Zeropath: Webview ready message received');
				// Check if we should auto-load scans
				if (this._shouldLoadScansOnReady) {
					console.log('Zeropath: Auto-loading scans on ready');
					this._shouldLoadScansOnReady = false;
					await this.loadScans('Both');
				}
				// Otherwise just show the UI without loading
				break;
			
			case 'loadScans':
				console.log('Zeropath: loadScans message received with scanType:', message.scanType);
				await this.loadScans(message.scanType);
				break;
			
			case 'selectScan':
				await this.selectScan(message.scanId, message.scanType);
				break;
			
			case 'requestPatch':
				await this.requestPatch(message.issueId);
				break;
			
			case 'applyPatch':
				console.log('Zeropath: applyPatch message received, diff length:', message.diff?.length);
				await this.applyPatch(message.diff, message.issueId);
				break;
			
			case 'openExternal':
				if (message.url) {
					vscode.env.openExternal(vscode.Uri.parse(message.url));
				}
				break;
			
			case 'configureCredentials':
				vscode.commands.executeCommand('zeropath.configureCredentials');
				break;
			}
	}

	private async loadScans(scanType: 'FullScan' | 'PrScan' | 'Both' = 'Both') {
		console.log('Zeropath: loadScans called with type:', scanType);
		try {
			this.postMessage({ type: 'loading', loading: true });
			
			console.log('Zeropath: Fetching scans from API...');
			const scans = await listScansForCurrentRepo(this.context, scanType);
			
			// Limit to top 5 newest scans
			const allScans = scans || [];
			console.log('Zeropath: Received', allScans.length, 'total scans');
			
			// Sort by createdAt (newest first) and take top 5
			this._currentScans = allScans
				.sort((a, b) => {
					const dateA = new Date(a.createdAt || 0).getTime();
					const dateB = new Date(b.createdAt || 0).getTime();
					return dateB - dateA; // Newest first
				})
				.slice(0, 5);
			
			console.log('Zeropath: Showing top', this._currentScans.length, 'newest scans');
			
			this.postMessage({ 
				type: 'scansLoaded', 
				scans: this._currentScans 
			});
			
			// Auto-select the first finished scan
			if (this._currentScans.length > 0) {
				const finishedScan = this._currentScans.find(s => 
					s.finished === true || 
					s.codeScanFinished === true || 
					s.status === 'completed' || 
					s.status === 'finished'
				);
				
				if (finishedScan) {
					console.log('Zeropath: Auto-selecting scan:', finishedScan.scanId);
					await this.selectScan(finishedScan.scanId, finishedScan.codeScanType as 'FullScan' | 'PrScan' || 'FullScan');
				}
			}
		} catch (error: any) {
			console.error('Zeropath: Error loading scans:', error);
			vscode.window.showErrorMessage(`Failed to load scans: ${error?.message || 'Unknown error'}`);
			this.postMessage({ 
				type: 'error', 
				message: `Failed to load scans: ${error?.message || 'Unknown error'}` 
			});
				} finally {
			this.postMessage({ type: 'loading', loading: false });
		}
	}

	private async selectScan(scanId: string, scanType: 'FullScan' | 'PrScan') {
		try {
			this._selectedScanId = scanId;
			this.postMessage({ type: 'loadingIssues', loading: true });
			
			const scan = { scanId, repositoryId: '' } as ScanItem;
			const issues = await fetchIssuesForCurrentRepo(this.context, scan, [scanType]);
			this._currentIssues = issues || [];
			
			this.postMessage({ 
				type: 'issuesLoaded', 
				issues: this._currentIssues,
				scanId: scanId
			});
		} catch (error: any) {
			vscode.window.showErrorMessage(`Failed to load issues: ${error?.message || 'Unknown error'}`);
			this.postMessage({ 
				type: 'error', 
				message: `Failed to load issues: ${error?.message || 'Unknown error'}` 
			});
		} finally {
			this.postMessage({ type: 'loadingIssues', loading: false });
		}
	}

	private async requestPatch(issueId: string) {
		try {
			this.postMessage({ type: 'patchLoading', loading: true, issueId });
			
			const success = await requestPatchForIssue(this.context, issueId);
			if (success) {
				vscode.window.showInformationMessage('Patch requested successfully! Refreshing issues...');
				
				// Reload issues to get updated patch status
				if (this._selectedScanId) {
					const scan = this._currentScans.find(s => s.scanId === this._selectedScanId);
					if (scan) {
						await this.selectScan(scan.scanId, scan.codeScanType as 'FullScan' | 'PrScan' || 'FullScan');
					}
				}
					} else {
				vscode.window.showErrorMessage('Failed to request patch');
					}
				} catch (error: any) {
					vscode.window.showErrorMessage(`Failed to request patch: ${error?.message || 'Unknown error'}`);
		} finally {
			this.postMessage({ type: 'patchLoading', loading: false, issueId });
		}
	}

	private async applyPatch(diff: string, issueId: string) {
				try {
					console.log('Zeropath: Applying patch, diff length:', diff?.length);
					const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
					if (!workspaceRoot) {
						vscode.window.showErrorMessage('No workspace folder found');
				return;
					}
					
					console.log('Zeropath: Calling applyGitPatch to workspace:', workspaceRoot);
			await applyGitPatch(workspaceRoot, diff);
					console.log('Zeropath: Patch applied successfully');
					vscode.window.showInformationMessage('Patch applied successfully!');
			
			// Update issue status in UI
			this.postMessage({ 
				type: 'patchApplied', 
				issueId 
			});
				} catch (error: any) {
					console.error('Zeropath: Failed to apply patch:', error);
					vscode.window.showErrorMessage(`Failed to apply patch: ${error?.message || 'Unknown error'}`);
				}
	}

	private postMessage(message: any) {
		console.log('Zeropath: postMessage called with:', message);
		if (this._view) {
			console.log('Zeropath: View exists, sending message to webview');
			this._view.webview.postMessage(message);
		} else {
			console.log('Zeropath: No view available to send message');
		}
	}

	private updateWebview() {
		if (!this._view) {
			return; 
		}
		
		this._view.webview.html = this.getHtml(this._view.webview);
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		
		// Get the local path to the script file
		const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js');
		const scriptUri = webview.asWebviewUri(scriptPath);

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
	<title>Zeropath Security</title>
			<style>
				:root { color-scheme: light dark; }
		body { 
			font-family: var(--vscode-font-family); 
			color: var(--vscode-foreground); 
					background: var(--vscode-sideBar-background); 
			padding: 0;
			margin: 0;
			font-size: 13px;
		}
		
		.container { padding: 10px; }
		
		.header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 15px;
			padding-bottom: 10px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		
		.header h2 {
					margin: 0; 
			font-size: 14px;
			font-weight: 600;
		}
		
		.controls {
			display: flex;
			gap: 8px;
			margin-bottom: 10px;
		}
		
		select, button {
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 2px;
					padding: 4px 8px; 
			font-size: 12px;
		}
		
		button {
			cursor: pointer;
		}
		
		button:hover {
			background: var(--vscode-list-hoverBackground);
		}
		
		button.primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
		}
		
		button.primary:hover {
			background: var(--vscode-button-hoverBackground);
		}
		
		button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		
		.section {
			margin-bottom: 20px;
		}
		
		.section-title {
			font-size: 12px;
			font-weight: 600;
			margin-bottom: 8px;
			text-transform: uppercase;
			color: var(--vscode-descriptionForeground);
		}
		
		.scan-item, .issue-item {
			padding: 8px;
			margin-bottom: 4px;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 2px;
			cursor: pointer;
		}
		
		.scan-item:hover, .issue-item:hover {
			background: var(--vscode-list-hoverBackground);
		}
		
		.scan-item.selected {
			background: var(--vscode-list-activeSelectionBackground);
			color: var(--vscode-list-activeSelectionForeground);
			border-left: 3px solid var(--vscode-focusBorder);
		}
		
		.scan-header, .issue-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 4px;
		}
		
		.scan-title, .issue-title {
			font-weight: 500;
			font-size: 12px;
			word-break: break-all;
		}
		
		.scan-meta, .issue-meta {
					font-size: 11px; 
			color: var(--vscode-descriptionForeground);
		}
		
		.badge {
			display: inline-block;
			padding: 2px 6px;
					border-radius: 3px; 
			font-size: 10px;
			font-weight: 600;
					text-transform: uppercase;
			margin-left: 4px;
		}
		
				.badge.severity-critical { background: #ff4444; color: white; }
				.badge.severity-high { background: #ff8800; color: white; }
				.badge.severity-medium { background: #ffbb00; color: black; }
				.badge.severity-low { background: #00aa00; color: white; }
				.badge.severity-info { background: #0088ff; color: white; }
				.badge.severity-unknown { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
				
		.badge.status-completed { background: #00aa00; color: white; }
		.badge.status-running { background: #ff8800; color: white; }
		.badge.status-failed { background: #ff4444; color: white; }
		
		.issue-actions {
			display: flex;
			gap: 4px;
			margin-top: 6px;
		}
		
		.issue-actions button {
			padding: 2px 8px;
					font-size: 11px; 
		}
		
		.empty-state {
			text-align: center;
			padding: 20px;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}
		
		.loading {
			opacity: 0.6;
		}
		
		.spinner {
			display: inline-block;
			width: 12px;
			height: 12px;
			border: 2px solid var(--vscode-foreground);
			border-radius: 50%;
			border-top-color: transparent;
			animation: spin 1s linear infinite;
		}
		
		@keyframes spin {
			to { transform: rotate(360deg); }
		}
		
		.issue-description {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			margin-top: 4px;
			padding: 4px;
			background: var(--vscode-textBlockQuote-background);
			border-left: 2px solid var(--vscode-textBlockQuote-border);
			white-space: pre-wrap;
			word-wrap: break-word;
			max-height: 100px;
			overflow-y: auto;
		}
		
		.collapsible {
			overflow: hidden;
			max-height: 0;
			transition: max-height 0.3s ease;
		}
		
		.collapsible.expanded {
			max-height: 500px;
		}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="header">
			<h2>🛡️ Zeropath Security</h2>
				</div>
				
					<div class="controls">
						<select id="scanTypeSelect">
				<option value="Both">All Scans</option>
				<option value="FullScan">Full Scans</option>
				<option value="PrScan">PR Scans</option>
						</select>
			<button class="primary">🔄 Refresh</button>
			<button title="Configure API Credentials">⚙️</button>
				</div>
				
		<div class="section">
			<div class="section-title">Scans</div>
			<div id="scansList">
				<div class="empty-state">Click the refresh button or "View Scans" to load scans</div>
						</div>
					</div>
					
		<div class="section">
			<div class="section-title">Issues</div>
			<div id="issuesList">
				<div class="empty-state">Select a scan to view issues</div>
						</div>
					</div>
				</div>
	
	<script src="${scriptUri}"></script>
		</body>
		</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
