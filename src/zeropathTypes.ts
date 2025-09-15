export type VcsProvider = 'github' | 'gitlab' | 'bitbucket' | 'generic';

export interface ResolveRepositoryResponse {
	repositoryId: string;
}

export interface ScanItem {
	name?: string;
	githubRepositoryId?: string;
	gitlabRepositoryId?: string;
	bitbucketRepositoryId?: string;
	status?: string;
	projectId?: string;
	applicationId?: string;
	scanId: string;
	prTargetBranch?: string;
	scanTargetBranch?: string;
	codeScanType?: 'FullScan' | 'PrScan' | string;
	prTriggeredURL?: string | null;
	isStaged?: boolean;
	codeScanFinished?: boolean;
	issueCounts?: {
		open?: number;
		patched?: number;
		falsePositive?: number;
		archived?: number;
		processing?: number;
	};
	finished?: boolean;
	createdAt?: string;
	updatedAt?: string;
	repositoryId: string;
	errorMessage?: string;
	trigger?: string;
	sastScan?: { id?: string; error?: string };
}

export interface ListScansResponse {
	codeScans: ScanItem[];
	totalCount: number;
}

export interface IssuePatch {
	id: string;
	prLink?: string | null;
	prTitle?: string | null;
	prDescription?: string | null;
	gitDiff?: string;
	pullRequestStatus?: string;
	validated?: string;
	createdAt?: string;
	updatedAt?: string;
}

export type IssueStatus = 'open' | 'patched' | 'falsePositive' | 'archived' | 'processing' | 'silenced' | 'closed';

export interface Issue {
	id: string;
	repositoryId: string;
	repositoryName?: string;
	status: IssueStatus;
	generatedTitle: string;
	generatedDescription: string;
	language?: string;
	vulnClass?: string;
	cwes?: string[];
	vulnCategory?: string;
	severity?: string;
	confidence?: number;
	score?: number;
	affectedFile?: string;
	sastCodeSegment?: string;
	startLine?: number;
	endLine?: number;
	startColumn?: number;
	endColumn?: number;
	isPrBlocked?: boolean;
	triagePhase?: string;
	validated?: 'CONFIRMED' | 'DISCONFIRMED' | 'UNKNOWN' | null;
	createdAt?: string;
	updatedAt?: string;
	naturalLanguageRuleViolation?: {
		id: string;
		ruleId: string;
		title: string;
		description: string;
		confidence: number;
		rule?: {
			id: string;
			name: string | null;
		} | null;
	} | null;
	codeScan?: {
		id?: string;
		scanTargetBranchCommitSha?: string;
	};
	falsePositiveReason?: string | null;
	patch?: IssuePatch | null;
}


