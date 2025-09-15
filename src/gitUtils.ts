import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function getWorkspaceRoot(): Promise<string | undefined> {
	if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
		return vscode.workspace.workspaceFolders[0].uri.fsPath;
	}
	return undefined;
}

export async function getGitRemoteUrl(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execAsync('git remote get-url origin', { cwd });
		return stdout.trim();
	} catch (_e) {
		return undefined;
	}
}

export function normalizeRepositoryUrl(url: string): string {
	// Convert SSH URLs like git@github.com:org/repo.git to https://github.com/org/repo
	if (url.startsWith('git@')) {
		const match = url.match(/^git@([^:]+):(.+)$/);
		if (match) {
			const host = match[1];
			let path = match[2];
			if (path.endsWith('.git')) path = path.slice(0, -4);
			return `https://${host}/${path}`;
		}
	}
	// Strip .git suffix
	if (url.endsWith('.git')) {
		url = url.slice(0, -4);
	}
	return url;
}

export async function applyGitPatch(cwd: string, gitDiff: string): Promise<void> {
	// Use 'git apply -p0' by default; if it fails, try with -3 for 3-way
	const tryApply = async (args: string[]) => {
		await new Promise<void>((resolve, reject) => {
			const child = exec(`git apply ${args.join(' ')}`, { cwd }, (error) => {
				if (error) reject(error);
				else resolve();
			});
			child.stdin?.write(gitDiff);
			child.stdin?.end();
		});
	};

	try {
		await tryApply(['-p0', '--index']);
	} catch (_e) {
		await tryApply(['-3']);
	}
}


