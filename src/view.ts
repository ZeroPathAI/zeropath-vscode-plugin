import * as vscode from 'vscode';
import { Issue, ScanItem } from './zeropathTypes';
import { fetchIssuesForCurrentRepo, listScansForCurrentRepo } from './zeropathService';

export class ZeropathViewProvider implements vscode.TreeDataProvider<TreeNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private state: {
		loading: boolean;
		error?: string;
		scans: ScanItem[];
	} = { loading: false, scans: [] };

	constructor(private readonly context: vscode.ExtensionContext) {}

	refresh(scans: ScanItem[] | Error | 'loading') {
		if (scans === 'loading') {
			this.state.loading = true;
			this.state.error = undefined;
			this.state.scans = [];
		} else if (scans instanceof Error) {
			this.state.loading = false;
			this.state.error = scans.message;
			this.state.scans = [];
		} else {
			this.state.loading = false;
			this.state.error = undefined;
			this.state.scans = scans;
		}
		this._onDidChangeTreeData.fire();
	}

	async loadScans(): Promise<void> {
		this.refresh('loading');
		try {
			const scans = await listScansForCurrentRepo(this.context, 'FullScan');
			this.refresh(scans ?? []);
		} catch (e: any) {
			this.refresh(new Error(e?.message ?? String(e)));
		}
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TreeNode): Thenable<TreeNode[]> {
		if (element) {
			if (element instanceof ScanNode) {
				return (async () => {
					try {
						const issues = await fetchIssuesForCurrentRepo(this.context, element.scan, ['FullScan']);
						if (!issues || issues.length === 0) { return [new MessageNode('No issues')]; }
						return issues.map(i => new IssueNode(i));
					} catch (e: any) {
						return [new MessageNode(`Error loading issues: ${e?.message ?? e}`)];
					}
				})();
			}
			return Promise.resolve([]);
		}
		if (this.state.loading) {
			return Promise.resolve([new MessageNode('Loading scans...')]);
		}
		if (this.state.error) {
			return Promise.resolve([new MessageNode(`Error: ${this.state.error}`)]);
		}
		if (this.state.scans.length === 0) {
			return Promise.resolve([new MessageNode('No scans found. Click "View Scans" button above to browse and manage scans.')]);
		}
		return Promise.resolve(this.state.scans.map(s => new ScanNode(s)));
	}
}

abstract class TreeNode extends vscode.TreeItem {}

class MessageNode extends TreeNode {
	constructor(message: string) {
		super(message, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'message';
		this.iconPath = new vscode.ThemeIcon('info');
	}
}

class ScanNode extends TreeNode {
	constructor(public readonly scan: ScanItem) {
		super(scan.scanId, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = `${scan.codeScanType ?? ''} ${scan.status ?? ''}`.trim();
		this.tooltip = `${scan.createdAt ?? ''}`;
		this.contextValue = 'scan';
		this.iconPath = new vscode.ThemeIcon('shield');
	}
}

class IssueNode extends TreeNode {
	constructor(public readonly issue: Issue) {
		super(issue.generatedTitle, vscode.TreeItemCollapsibleState.None);
		this.description = `severity:${issue.severity ?? '-'} ${issue.affectedFile ?? ''}${issue.startLine ? ':' + issue.startLine : ''}`;
		this.tooltip = `${issue.status}`;
		this.contextValue = 'issue';
		this.iconPath = new vscode.ThemeIcon('warning');
		this.command = {
			command: 'zeropath.openIssuePanel',
			title: 'View Issue',
			arguments: [issue]
		};
	}
}


