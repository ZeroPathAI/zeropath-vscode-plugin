import * as vscode from 'vscode';
import { ZeropathApiClient, getConfiguredCredentials, promptAndStoreCredentials } from './zeropathApi';
import { getWorkspaceRoot, getGitRemoteUrl, normalizeRepositoryUrl } from './gitUtils';
import { Issue, ScanItem, VcsProvider } from './zeropathTypes';

let cachedOrganizationId: string | undefined;

export function clearCredentialsCache(): void {
	cachedOrganizationId = undefined;
	console.log('🔄 Zeropath: Cleared credentials cache');
}

export async function buildClient(context: vscode.ExtensionContext): Promise<ZeropathApiClient | undefined> {
	const config = vscode.workspace.getConfiguration('zeropath');
	const baseUrl = config.get<string>('apiBaseUrl', 'https://zeropath.com');
	console.log('🎯 Zeropath: Building API client with base URL:', baseUrl);
	
	let creds = await getConfiguredCredentials(context.secrets);
	if (!creds) {
		console.log('⚠️ Zeropath: No credentials found, prompting user');
		const proceed = await vscode.window.showWarningMessage('Zeropath credentials not set. Configure now?', 'Yes', 'No');
		if (proceed === 'Yes') {
			creds = await promptAndStoreCredentials(context.secrets);
		}
	}
	if (!creds) { 
		console.log('❌ Zeropath: No credentials available, cannot build client');
		return undefined; 
	}
	console.log('✅ Zeropath: Client built with Token ID:', creds.clientId);
	return new ZeropathApiClient(baseUrl, creds);
}

export async function getOrganizationId(context: vscode.ExtensionContext, client?: ZeropathApiClient): Promise<string | undefined> {
	if (cachedOrganizationId) { 
		console.log('🏢 Zeropath: Using cached organization ID:', cachedOrganizationId);
		return cachedOrganizationId; 
	}
	
	const config = vscode.workspace.getConfiguration('zeropath');
	const configured = config.get<string>('organizationId');
	if (configured && configured.trim().length > 0) {
		cachedOrganizationId = configured.trim();
		console.log('🏢 Zeropath: Using configured organization ID:', cachedOrganizationId);
		return cachedOrganizationId;
	}
	
	console.log('🔍 Zeropath: No organization ID configured, fetching from API...');
	try {
		const c = client ?? await buildClient(context);
		if (!c) { 
			console.log('❌ Zeropath: Cannot fetch org ID - no client available');
			return undefined; 
		}
		const orgs = await c.listOrganizations();
		if (orgs && orgs.length > 0) {
			cachedOrganizationId = orgs[0].id;
			console.log('✅ Zeropath: Found organization:', orgs[0].name, 'ID:', cachedOrganizationId);
			await config.update('organizationId', cachedOrganizationId, vscode.ConfigurationTarget.Global);
			return cachedOrganizationId;
		} else {
			console.log('⚠️ Zeropath: No organizations found for this token');
		}
	} catch (e: any) {
		console.error('❌ Zeropath: Failed to list organizations:', e);
		vscode.window.showErrorMessage(`Failed to list organizations: ${e?.message ?? e}`);
	}
	return undefined;
}

export async function listScansForCurrentRepo(context: vscode.ExtensionContext, scanType: 'FullScan' | 'PrScan' | 'Both' = 'FullScan'): Promise<ScanItem[] | undefined> {
	const client = await buildClient(context);
	if (!client) { return undefined; }
	const organizationId = await getOrganizationId(context, client);
	if (!organizationId) {
		vscode.window.showErrorMessage('Zeropath organization not found. Set `zeropath.organizationId` or ensure your token has an organization.');
		return undefined;
	}
	const root = await getWorkspaceRoot();
	if (!root) { vscode.window.showErrorMessage('No workspace folder found'); return undefined; }
	const remote = await getGitRemoteUrl(root);
	if (!remote) { vscode.window.showErrorMessage('Could not determine git remote URL (origin)'); return undefined; }
	const normalized = normalizeRepositoryUrl(remote);
	const config = vscode.workspace.getConfiguration('zeropath');
	const vcs = config.get<string>('vcs', 'github') as VcsProvider;
	const defaultScanType = config.get<string>('defaultScanType', 'FullScan') as 'FullScan' | 'PrScan';

	console.log('🎯 Zeropath: Starting scan list operation');
	console.log('📍 Git Remote URL:', remote);
	console.log('🔗 Normalized URL:', normalized);
	console.log('📦 VCS Provider:', vcs);
	console.log('🏢 Organization ID:', organizationId);
	
	let resolved;
	try {
		resolved = await client.resolveRepositoryByUrl({ repositoryUrl: normalized, vcs, organizationId });
		console.log('🎯 Zeropath: Repository resolution result:', {
			repositoryId: resolved?.repositoryId,
			fullResponse: resolved
		});
	} catch (error: any) {
		const errorMsg = error?.response?.data?.message || error?.message || 'Unknown error';
		console.error('Zeropath: Failed to resolve repository', error);
		vscode.window.showErrorMessage(`Failed to resolve repository: ${errorMsg}. URL: ${normalized}, VCS: ${vcs}`);
		return undefined;
	}
	
	if (!resolved || !resolved.repositoryId) {
		vscode.window.showErrorMessage(`Repository not found in Zeropath. URL: ${normalized}, VCS: ${vcs}. Please ensure this repository is configured in Zeropath.`);
		return undefined;
	}
	const typesToQuery: Array<'FullScan' | 'PrScan'> = scanType === 'Both' ? ['FullScan', 'PrScan'] : [scanType ?? defaultScanType];
	const results: ScanItem[] = [];
	for (const t of typesToQuery) {
		try {
			console.log(`Zeropath: Listing ${t} scans for repository ${resolved.repositoryId}`);
			const { codeScans } = await client.listScans({ repositoryIds: [resolved.repositoryId], organizationId, scanType: t, returnAll: true, pageSize: 50 });
			console.log(`Zeropath: Found ${codeScans.length} ${t} scans`);
			results.push(...codeScans);
		} catch (error: any) {
			const errorMsg = error?.response?.data?.message || error?.message || 'Unknown error';
			console.error(`Zeropath: Failed to list ${t} scans`, error);
			vscode.window.showErrorMessage(`Failed to list ${t} scans: ${errorMsg}`);
		}
	}
		console.log(`📈 Zeropath: Total scans found: ${results.length}`);
	if (results.length > 0) {
		console.log('📄 First few scans:', results.slice(0, 3).map(s => ({
			scanId: s.scanId,
			type: s.codeScanType,
			status: s.status,
			createdAt: s.createdAt
		})));
	}
	return results;
}

export async function fetchIssuesForCurrentRepo(context: vscode.ExtensionContext, scan?: ScanItem, codeScanTypes?: Array<'FullScan' | 'PrScan'>): Promise<Issue[] | undefined> {
	try {
		const client = await buildClient(context);
		if (!client) { 
			console.error('❌ Zeropath: No client available for fetching issues');
			return undefined; 
		}
		
		const organizationId = await getOrganizationId(context, client);
		if (!organizationId) {
			console.error('❌ Zeropath: No organization ID available');
			vscode.window.showErrorMessage('Zeropath organization not found. Set `zeropath.organizationId` or ensure your token has an organization.');
			return undefined;
		}
		
		const root = await getWorkspaceRoot();
		if (!root) { 
			console.error('❌ Zeropath: No workspace folder found');
			vscode.window.showErrorMessage('No workspace folder found'); 
			return undefined; 
		}
		
		const remote = await getGitRemoteUrl(root);
		if (!remote) { 
			console.error('❌ Zeropath: Could not determine git remote URL');
			vscode.window.showErrorMessage('Could not determine git remote URL (origin)'); 
			return undefined; 
		}
		
		const normalized = normalizeRepositoryUrl(remote);
		const config = vscode.workspace.getConfiguration('zeropath');
		const vcs = config.get<string>('vcs', 'github') as VcsProvider;
		const defaultScanType = config.get<string>('defaultScanType', 'FullScan') as 'FullScan' | 'PrScan';

		console.log('🔍 Zeropath: Fetching issues for repository', { 
			remote, 
			normalized, 
			vcs, 
			organizationId, 
			scanId: scan?.scanId,
			codeScanTypes: codeScanTypes ?? [defaultScanType]
		});
		
		let resolved;
		try {
			resolved = await client.resolveRepositoryByUrl({ repositoryUrl: normalized, vcs, organizationId });
			console.log('✅ Repository resolved:', resolved?.repositoryId ? `ID: ${resolved.repositoryId}` : 'NOT FOUND');
		} catch (error: any) {
			const errorMsg = error?.response?.data?.message || error?.message || 'Unknown error';
			console.error('❌ Zeropath: Failed to resolve repository', error);
			vscode.window.showErrorMessage(`Failed to resolve repository: ${errorMsg}. URL: ${normalized}, VCS: ${vcs}`);
			return undefined;
		}
		
		if (!resolved || !resolved.repositoryId) {
			console.error('❌ Repository not found in Zeropath:', { normalized, vcs });
			vscode.window.showErrorMessage(`Repository not found in Zeropath. URL: ${normalized}, VCS: ${vcs}. Please ensure this repository is configured in Zeropath.`);
			return undefined;
		}
		
		try {
			const searchParams = {
				organizationId,
				repositoryIds: [resolved.repositoryId],
				scanId: scan?.scanId,
				codeScanTypes: codeScanTypes ?? [defaultScanType],
				types: ['open'] as Array<'open' | 'patched' | 'falsePositive' | 'archived' | 'processing' | 'closed'>,
				returnAll: true,
				pageSize: 100,
			};
			
			console.log('🔍 Searching issues with params:', searchParams);
			const { issues } = await client.searchIssues(searchParams);
			console.log(`✅ Found ${issues?.length || 0} issues`);
			return issues;
			
		} catch (error: any) {
			const errorMsg = error?.response?.data?.message || error?.message || 'Unknown error';
			console.error('❌ Zeropath: Failed to search issues', error);
			vscode.window.showErrorMessage(`Failed to search issues: ${errorMsg}`);
			return undefined;
		}
		
	} catch (error: any) {
		console.error('❌ Zeropath: Unexpected error in fetchIssuesForCurrentRepo', error);
		vscode.window.showErrorMessage(`Unexpected error fetching issues: ${error?.message || 'Unknown error'}`);
		return undefined;
	}
}

export async function requestPatchForIssue(context: vscode.ExtensionContext, issueId: string): Promise<boolean> {
	try {
		const client = await buildClient(context);
		if (!client) { 
			console.error('❌ Zeropath: No client available for patch request');
			vscode.window.showErrorMessage('Failed to request patch: No API client available');
			return false; 
		}
		
		const organizationId = await getOrganizationId(context, client);
		if (!organizationId) {
			console.error('❌ Zeropath: No organization ID available for patch request');
			vscode.window.showErrorMessage('Failed to request patch: No organization ID available');
			return false;
		}
		
		console.log('🔧 Zeropath: Requesting patch for issue:', issueId, 'org:', organizationId);
		const res = await client.requestPatch({ issueId, organizationId });
		console.log('✅ Patch request result:', res);
		return Boolean(res?.ok);
		
	} catch (error: any) {
		const errorMsg = error?.response?.data?.message || error?.message || 'Unknown error';
		console.error('❌ Zeropath: Failed to request patch', error);
		vscode.window.showErrorMessage(`Failed to request patch: ${errorMsg}`);
		return false;
	}
}
