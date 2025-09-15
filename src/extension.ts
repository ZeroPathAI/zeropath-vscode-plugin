import * as vscode from 'vscode';
// Focusing on credentials, scan listing, issues, and patch application
import { ZeropathApiClient, getConfiguredCredentials, promptAndStoreCredentials } from './zeropathApi';
import { getWorkspaceRoot, getGitRemoteUrl, normalizeRepositoryUrl, applyGitPatch } from './gitUtils';
import { Issue, ScanItem, VcsProvider } from './zeropathTypes';
import { ZeropathSidebarProvider } from './sidebar';
import { ZeropathViewProvider } from './view';
import { listScansForCurrentRepo, fetchIssuesForCurrentRepo } from './zeropathService';

// No diagnostics or local scans for this use-case

export function activate(context: vscode.ExtensionContext) {
	console.log('Zeropath Security Extension activated');

	// Create the sidebar provider
	const sidebarProvider = new ZeropathSidebarProvider(context);
	
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'zeropathView', 
			sidebarProvider, 
			{ 
				webviewOptions: { 
					retainContextWhenHidden: true 
				} 
			}
		)
	);

	// Disable the TreeDataProvider for zeropathView to allow the WebviewView to render
	// const treeProvider = new ZeropathViewProvider(context);
	// context.subscriptions.push(vscode.window.registerTreeDataProvider('zeropathView', treeProvider));

	const commands = [
		vscode.commands.registerCommand('zeropath.openSetup', async () => {
			// Just directly call the configure credentials command
			await vscode.commands.executeCommand('zeropath.configureCredentials');
		}),
		vscode.commands.registerCommand('zeropath.configureCredentials', async () => {
			const creds = await getConfiguredCredentials(context.secrets);
			if (creds) {
				const replace = await vscode.window.showInformationMessage('Zeropath credentials already set. Replace?', 'Yes', 'No');
				if (replace !== 'Yes') { return; }
			}
			
			// Show a more informative message
			vscode.window.showInformationMessage('Configure Zeropath Security credentials. You can get your API tokens from https://zeropath.com');
			
			const stored = await promptAndStoreCredentials(context.secrets);
			if (stored) {
				// Clear cache when new credentials are saved
				const { clearCredentialsCache } = await import('./zeropathService');
				clearCredentialsCache();
				
				// Clear organization ID from config so it gets re-fetched with new credentials  
				const config = vscode.workspace.getConfiguration('zeropath');
				await config.update('organizationId', undefined, vscode.ConfigurationTarget.Global);
				
				// Prompt VCS selection and save to settings
				const vcsPick = await vscode.window.showQuickPick([
					{ label: 'GitHub', value: 'github' },
					{ label: 'GitLab', value: 'gitlab' },
					{ label: 'Bitbucket', value: 'bitbucket' },
					{ label: 'Generic', value: 'generic' }
				], { placeHolder: 'Select your primary VCS' });
				if (vcsPick) {
					const config = vscode.workspace.getConfiguration('zeropath');
					await config.update('vcs', vcsPick.value, vscode.ConfigurationTarget.Global);
				}
				vscode.window.showInformationMessage('Zeropath credentials saved successfully! You can now use the "View Scans & Issues" button to browse scans.');
				
				// Credentials saved successfully
				}
		}),
		// Only the commands needed for credential config, listing scans, showing issues, and applying patches
		vscode.commands.registerCommand('zeropath.listScans', async () => {
			const scanTypeChoice = await vscode.window.showQuickPick([
				{ label: 'Full scans', value: 'FullScan' },
				{ label: 'PR scans', value: 'PrScan' },
				{ label: 'Both', value: 'Both' }
			], { placeHolder: 'Which scans would you like to list?' });
			if (!scanTypeChoice) { return; }
			const scans = await listScansForCurrentRepo(context, scanTypeChoice.value as any);
			if (!scans) return;
			const pick = await vscode.window.showQuickPick(scans.map(s => ({
				label: s.scanId,
				description: `${s.codeScanType ?? ''} ${s.status ?? ''}`.trim(),
				detail: `${s.createdAt ?? ''}`,
				scan: s
			})), { placeHolder: 'Select a scan to view issues' });
			if (pick) {
				await vscode.commands.executeCommand('zeropath.showIssues', pick.scan);
			}
		}),
		vscode.commands.registerCommand('zeropath.showIssues', async (scan?: ScanItem) => {
			let codeScanTypes: Array<'FullScan' | 'PrScan'> | undefined = undefined;
			if (!scan) {
				const scanTypeChoice = await vscode.window.showQuickPick([
					{ label: 'Full scans', value: 'FullScan' },
					{ label: 'PR scans', value: 'PrScan' },
					{ label: 'Both', value: 'Both' }
				], { placeHolder: 'Filter issues by scan type?' });
				if (!scanTypeChoice) { return; }
				if (scanTypeChoice.value === 'Both') {
					codeScanTypes = ['FullScan', 'PrScan'];
				} else {
					codeScanTypes = [scanTypeChoice.value as 'FullScan' | 'PrScan'];
				}
			}
			const issues = await fetchIssuesForCurrentRepo(context, scan, codeScanTypes);
			if (!issues) return;
			const pick = await vscode.window.showQuickPick(issues.map(i => ({
				label: i.generatedTitle,
				description: `severity:${i.severity ?? '-'} status:${i.status}`,
				detail: `${i.affectedFile ?? ''}:${i.startLine ?? ''}`,
				issue: i
			})), { placeHolder: 'Select an issue to view/apply patch' });
			if (pick) {
				const i = pick.issue as Issue;
				if (i.patch && i.patch.prLink) {
					const open = await vscode.window.showInformationMessage('This issue has a PR. Open it?', 'Open PR', 'Cancel');
					if (open === 'Open PR') {
						vscode.env.openExternal(vscode.Uri.parse(i.patch.prLink!));
					}
					return;
				}
				if (i.patch && i.patch.gitDiff) {
					const apply = await vscode.window.showInformationMessage('Apply patch locally?', 'Apply', 'Cancel');
					if (apply === 'Apply') {
						const root = await getWorkspaceRoot();
						if (!root) { vscode.window.showErrorMessage('No workspace folder'); return; }
						try {
							await applyGitPatch(root, i.patch.gitDiff);
							vscode.window.showInformationMessage('Patch applied.');
						} catch (e: any) {
							vscode.window.showErrorMessage(`Failed to apply patch: ${e?.message ?? e}`);
						}
					}
				} else {
					vscode.window.showInformationMessage('No patch available for this issue.');
				}
			}
		}),
		vscode.commands.registerCommand('zeropath.applyPatch', async () => {
			const diff = await vscode.window.showInputBox({
				prompt: 'Paste git diff to apply',
				placeHolder: 'diff --git a/.. b/..',
				ignoreFocusOut: true,
				password: false,
				validateInput: (value: string) => value.trim().length < 10 ? 'Please paste a valid diff' : undefined
			});
			if (!diff) { return; }
			const root = await getWorkspaceRoot();
			if (!root) { vscode.window.showErrorMessage('No workspace folder'); return; }
			try {
				await applyGitPatch(root, diff);
				vscode.window.showInformationMessage('Patch applied.');
			} catch (e: any) {
				vscode.window.showErrorMessage(`Failed to apply patch: ${e?.message ?? e}`);
			}
		}),
		vscode.commands.registerCommand('zeropath.openIssuePanel', async (issue?: Issue) => {
			if (issue) {
				// This should open the issue in the sidebar's issue panel
				vscode.commands.executeCommand('workbench.view.extension.zeropath');
				// The sidebar provider will handle opening the issue panel
			}
		}),
		vscode.commands.registerCommand('zeropath.openScanView', async () => {
			try {
				console.log('Zeropath: openScanView command triggered');
				
				// First ensure the sidebar view is visible
				await vscode.commands.executeCommand('workbench.view.extension.zeropath');
				console.log('Zeropath: Sidebar view opened');
				
				// Small delay to ensure the view is ready
				await new Promise(resolve => setTimeout(resolve, 300));
				
				// Now trigger scan loading
				await sidebarProvider.openScanViewPanel();
				console.log('Zeropath: Scan loading triggered');
			} catch (error) {
				console.error('Zeropath: Error in openScanView command:', error);
				vscode.window.showErrorMessage(`Failed to open scan view: ${error}`);
			}
		})
	];

	context.subscriptions.push(...commands);
}

export function deactivate() {}