import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { Issue, ListScansResponse, ResolveRepositoryResponse, VcsProvider } from './zeropathTypes';

export interface ZeropathCredentials {
	clientId: string;
	clientSecret: string;
}

export class ZeropathApiClient {
	private http: AxiosInstance;

	constructor(private baseUrl: string, private credentials: ZeropathCredentials) {
		this.http = axios.create({
			baseURL: baseUrl,
			timeout: 30000,
		});
		
		// Add request interceptor for logging
		this.http.interceptors.request.use(
			(config) => {
				console.log('🔵 Zeropath API Request:', {
					method: config.method?.toUpperCase(),
					url: `${config.baseURL}${config.url}`,
					headers: {
						...config.headers,
						// Mask the secret for security
						'X-ZeroPath-API-Token-Secret': config.headers?.['X-ZeroPath-API-Token-Secret'] ? '***HIDDEN***' : undefined
					},
					data: config.data
				});
				return config;
			},
			(error) => {
				console.error('🔴 Zeropath API Request Error:', error);
				return Promise.reject(error);
			}
		);
		
		// Add response interceptor for logging
		this.http.interceptors.response.use(
			(response) => {
				console.log('🟢 Zeropath API Response:', {
					status: response.status,
					statusText: response.statusText,
					url: response.config.url,
					data: response.data
				});
				return response;
			},
			(error) => {
				console.error('🔴 Zeropath API Response Error:', {
					status: error.response?.status,
					statusText: error.response?.statusText,
					url: error.config?.url,
					data: error.response?.data,
					message: error.message
				});
				return Promise.reject(error);
			}
		);
	}

	private authHeaders() {
		return {
			'X-ZeroPath-API-Token-Id': this.credentials.clientId,
			'X-ZeroPath-API-Token-Secret': this.credentials.clientSecret,
			'Content-Type': 'application/json',
		};
	}

	async listOrganizations(searchQuery?: string): Promise<Array<{ id: string; name: string; role?: string }>> {
		console.log('📋 Calling listOrganizations with:', { searchQuery });
		const res = await this.http.post('/api/v1/orgs/list', { searchQuery }, { headers: this.authHeaders() });
		console.log('✅ Organizations found:', res.data?.length || 0);
		return res.data;
	}

	async resolveRepositoryByUrl(args: {
		repositoryUrl: string;
		vcs: VcsProvider;
		organizationId?: string;
	}): Promise<ResolveRepositoryResponse> {
		console.log('🔍 Calling resolveRepositoryByUrl with:', args);
		const res = await this.http.post('/api/v1/repositories/resolve-by-url', {
			repositoryUrl: args.repositoryUrl,
			vcs: args.vcs,
			...(args.organizationId ? { organizationId: args.organizationId } : {}),
		}, { headers: this.authHeaders() });
		console.log('✅ Repository resolved:', res.data?.repositoryId ? `ID: ${res.data.repositoryId}` : 'NOT FOUND');
		return res.data;
	}

	async listScans(args: {
		organizationId?: string;
		repositoryIds?: string[];
		scanId?: string;
		scanType?: 'FullScan' | 'PrScan';
		page?: number;
		pageSize?: number;
		returnAll?: boolean;
		showEphemeral?: boolean;
		sortBy?: 'createdAt' | 'updatedAt';
		sortOrder?: 'asc' | 'desc';
	}): Promise<ListScansResponse> {
		const payload = {
			organizationId: args.organizationId,
			repositoryIds: args.repositoryIds,
			scanId: args.scanId,
			scanType: args.scanType,
			page: args.page ?? 1,
			pageSize: args.pageSize ?? 10,
			returnAll: args.returnAll ?? false,
			showEphemeral: args.showEphemeral ?? false,
			sortBy: args.sortBy ?? 'createdAt',
			sortOrder: args.sortOrder ?? 'desc',
		};
		console.log('📊 Calling listScans with:', payload);
		const res = await this.http.post('/api/v1/scans/list', payload, { headers: this.authHeaders() });
		console.log('✅ Scans found:', res.data?.codeScans?.length || 0);
		return res.data;
	}

	async searchIssues(args: {
		organizationId?: string;
		repositoryIds?: string[];
		scanId?: string;
		codeScanTypes?: Array<'FullScan' | 'PrScan'>;
		types?: Array<'open' | 'patched' | 'falsePositive' | 'archived' | 'processing' | 'closed'>;
		returnAll?: boolean;
		page?: number;
		pageSize?: number;
		getCounts?: boolean;
		ruleId?: string;
	}): Promise<{ issues: Issue[]; totalCount: number; }>
	{
		const payload = {
			organizationId: args.organizationId,
			repositoryIds: args.repositoryIds,
			scanId: args.scanId,
			codeScanTypes: args.codeScanTypes ?? ['FullScan'],
			types: args.types ?? ['open'],
			returnAll: args.returnAll ?? true,
			page: args.page ?? 1,
			pageSize: args.pageSize ?? 50,
			getCounts: args.getCounts ?? true,
			ruleId: args.ruleId,
		};
		console.log('🔍 Calling searchIssues with:', payload);
		const res = await this.http.post('/api/v1/issues/search', payload, { headers: this.authHeaders() });
		console.log('✅ Issues found:', res.data?.issues?.length || 0, 'Total count:', res.data?.totalCount || 0);
		return res.data;
	}

	async requestPatch(args: { issueId: string; organizationId?: string }): Promise<{ ok: boolean | null }>{
		console.log('🔧 Calling requestPatch with:', args);
		const res = await this.http.post('/api/v1/issues/generate-patch', {
			issueId: args.issueId,
			organizationId: args.organizationId,
		}, { headers: this.authHeaders() });
		console.log('✅ Patch request result:', res.data);
		return res.data;
	}
}

export async function getConfiguredCredentials(secretStorage: vscode.SecretStorage): Promise<ZeropathCredentials | undefined> {
	const clientId = await secretStorage.get('zeropath.clientId');
	const clientSecret = await secretStorage.get('zeropath.clientSecret');
	if (clientId && clientSecret) {
		return { clientId, clientSecret };
	}
	return undefined;
}

export async function promptAndStoreCredentials(secretStorage: vscode.SecretStorage): Promise<ZeropathCredentials | undefined> {
	const clientId = await vscode.window.showInputBox({
		prompt: 'Enter Zeropath API Token Id',
		placeHolder: 'Your API Token ID from https://zeropath.com',
		ignoreFocusOut: true,
		password: false,
		validateInput: (value) => {
			if (!value || value.trim().length === 0) {
				return 'API Token ID is required';
			}
			return undefined;
		}
	});
	if (!clientId) { return undefined; }
	const clientSecret = await vscode.window.showInputBox({
		prompt: 'Enter Zeropath API Token Secret',
		placeHolder: 'Your API Token Secret (will be stored securely)',
		ignoreFocusOut: true,
		password: true,
		validateInput: (value) => {
			if (!value || value.trim().length === 0) {
				return 'API Token Secret is required';
			}
			return undefined;
		}
	});
	if (!clientSecret) { return undefined; }
	await secretStorage.store('zeropath.clientId', clientId.trim());
	await secretStorage.store('zeropath.clientSecret', clientSecret.trim());
	return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}


