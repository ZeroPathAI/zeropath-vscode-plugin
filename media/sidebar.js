// Sidebar JavaScript - This will be loaded as an external file
console.log('Sidebar.js loading...');

const vscode = acquireVsCodeApi();
let currentScans = [];
let currentIssues = [];
let filteredIssues = [];
let selectedScanId = null;
let expandedIssueId = null;
let searchTerm = '';

// Store patch data in memory instead of encoding it
const patchDataStore = new Map();

// Send ready message when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded');
    vscode.postMessage({ type: 'ready' });
});

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    console.log('Received message:', message);
    
    switch (message.type) {
        case 'loading':
            setLoading(message.loading);
            break;
        case 'loadingIssues':
            setLoadingIssues(message.loading);
            break;
        case 'scansLoaded':
            renderScans(message.scans);
            break;
        case 'issuesLoaded':
            renderIssues(message.issues, message.scanId);
            break;
        case 'error':
            showError(message.message);
            break;
        case 'patchLoading':
            setPatchLoading(message.loading, message.issueId);
            break;
        case 'patchApplied':
            updateIssueStatus(message.issueId);
            break;
    }
});

function loadScans(scanType) {
    console.log('loadScans called with:', scanType);
    const type = scanType || document.getElementById('scanTypeSelect').value;
    vscode.postMessage({ type: 'loadScans', scanType: type });
}

function selectScan(scanId, scanType) {
    console.log('selectScan called with:', scanId, scanType);
    selectedScanId = scanId;
    expandedIssueId = null;
    searchTerm = '';
    vscode.postMessage({ type: 'selectScan', scanId: scanId, scanType: scanType });
}

function showError(message) {
    const container = document.getElementById('issuesList') || document.getElementById('scansList');
    if (container) {
        // Use textContent and createElement instead of innerHTML
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        container.textContent = '';
        container.appendChild(errorDiv);
    }
}

function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Safe DOM creation helper
function createElement(tag, className, textContent) {
    const elem = document.createElement(tag);
    if (className) elem.className = className;
    if (textContent) elem.textContent = textContent;
    return elem;
}

// Render scans using DOM manipulation instead of innerHTML
function renderScans(scans) {
    currentScans = scans;
    const container = document.getElementById('scansList');
    if (!container) return;
    
    // Clear container
    container.textContent = '';
    
    if (!scans || scans.length === 0) {
        const emptyDiv = createElement('div', 'empty-state', 'No scans found. Check your credentials and repository.');
        container.appendChild(emptyDiv);
        return;
    }
    
    scans.forEach(scan => {
        const isFinished = scan.finished || scan.codeScanFinished || 
            scan.status === 'completed' || scan.status === 'finished';
        
        const scanItem = createElement('div', 'scan-item');
        scanItem.setAttribute('data-scan-id', scan.scanId);
        scanItem.setAttribute('data-scan-type', scan.codeScanType || 'FullScan');
        
        const scanHeader = createElement('div', 'scan-header');
        
        const scanTitle = createElement('div', 'scan-title', scan.scanId);
        scanHeader.appendChild(scanTitle);
        
        const statusDiv = createElement('div');
        const statusBadge = createElement('span', 'badge');
        statusBadge.textContent = isFinished ? '✓ Completed' : '⚡ Running';
        statusDiv.appendChild(statusBadge);
        
        const issueCount = createElement('span');
        issueCount.textContent = ' ' + (scan.issueCounts?.open || 0) + ' issues';
        statusDiv.appendChild(issueCount);
        
        scanHeader.appendChild(statusDiv);
        scanItem.appendChild(scanHeader);
        
        const scanMeta = createElement('div', 'scan-meta');
        scanMeta.textContent = 'Type: ' + (scan.codeScanType || 'Unknown') + ' | Created: ' + formatDate(scan.createdAt);
        scanItem.appendChild(scanMeta);
        
        container.appendChild(scanItem);
    });
}

// Store patch data when rendering issues
function storePatchData(issueId, patch) {
    if (patch && patch.gitDiff) {
        patchDataStore.set(issueId, patch.gitDiff);
    }
}

// Apply patch using stored data
function applyPatchFromStore(issueId) {
    const diff = patchDataStore.get(issueId);
    if (diff) {
        console.log('Applying patch for issue:', issueId);
        console.log('Diff length:', diff.length);
        vscode.postMessage({ type: 'applyPatch', diff: diff, issueId: issueId });
    } else {
        console.error('No patch data found for issue:', issueId);
        showError('Patch data not found');
    }
}

// Render issues using DOM manipulation
function renderIssues(issues, scanId) {
    if (issues !== undefined) {
        currentIssues = issues;
    }
    
    const container = document.getElementById('issuesList');
    if (!container) return;
    
    // Clear container and patch store for new issues
    container.textContent = '';
    patchDataStore.clear();
    
    // Create search bar
    const searchDiv = createElement('div');
    searchDiv.style.marginBottom = '10px';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'issueSearchInput';
    searchInput.placeholder = 'Search issues...';
    searchInput.value = searchTerm;
    searchInput.style.cssText = 'width: 100%; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 2px;';
    
    searchDiv.appendChild(searchInput);
    container.appendChild(searchDiv);
    
    if (!currentIssues || currentIssues.length === 0) {
        const emptyDiv = createElement('div', 'empty-state', 'No issues found for this scan');
        container.appendChild(emptyDiv);
        return;
    }
    
    // Filter issues
    filteredIssues = currentIssues.filter(issue => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return (issue.generatedTitle || '').toLowerCase().includes(search) ||
               (issue.generatedDescription || '').toLowerCase().includes(search) ||
               (issue.affectedFile || '').toLowerCase().includes(search);
    });
    
    if (filteredIssues.length === 0) {
        const emptyDiv = createElement('div', 'empty-state', 'No issues match your search');
        container.appendChild(emptyDiv);
        return;
    }
    
    // Add issue count
    const countDiv = createElement('div');
    countDiv.style.cssText = 'margin-bottom: 8px; color: var(--vscode-descriptionForeground); font-size: 11px;';
    countDiv.textContent = 'Showing ' + filteredIssues.length + ' of ' + currentIssues.length + ' issues';
    container.appendChild(countDiv);
    
    // Render each issue
    filteredIssues.forEach(issue => {
        const patch = issue.patch || issue.vulnerabilityPatch;
        
        // Store patch data if available
        if (patch && patch.gitDiff) {
            storePatchData(issue.id, patch);
        }
        
        const issueItem = createElement('div', 'issue-item');
        issueItem.setAttribute('data-issue-id', issue.id);
        issueItem.style.cursor = 'pointer';
        
        const issueHeader = createElement('div', 'issue-header');
        
        const titleDiv = createElement('div');
        titleDiv.style.flex = '1';
        
        const issueTitle = createElement('div', 'issue-title');
        const isExpanded = expandedIssueId === issue.id;
        issueTitle.textContent = (isExpanded ? '▼ ' : '▶ ') + (issue.generatedTitle || 'Untitled');
        titleDiv.appendChild(issueTitle);
        
        issueHeader.appendChild(titleDiv);
        
        // Add badges
        const badgesDiv = createElement('div');
        badgesDiv.style.cssText = 'display: flex; gap: 5px; align-items: center;';
        
        // Severity badge
        const severityValue = String(issue.severity || 'unknown');
        const severityBadge = createElement('span', 'badge severity-' + severityValue.toLowerCase());
        severityBadge.textContent = severityValue;
        badgesDiv.appendChild(severityBadge);
        
        // Score badge
        if (issue.score !== undefined) {
            const scoreBadge = createElement('span', 'badge');
            scoreBadge.style.cssText = 'background: var(--vscode-terminal-ansiMagenta); color: var(--vscode-terminal-background);';
            scoreBadge.title = 'Risk Score';
            scoreBadge.textContent = String(issue.score);
            badgesDiv.appendChild(scoreBadge);
        }
        
        // Status badge
        if (issue.status) {
            const statusBadge = createElement('span', 'badge');
            statusBadge.textContent = issue.status;
            badgesDiv.appendChild(statusBadge);
        }
        
        // Add patch indicator or request button
        if (patch && patch.gitDiff) {
            const patchBadge = createElement('span', 'badge');
            patchBadge.style.cssText = 'background: var(--vscode-terminal-ansiGreen); color: var(--vscode-terminal-background);';
            patchBadge.textContent = '✓ Has Patch';
            badgesDiv.appendChild(patchBadge);
        } else {
            const requestBtn = document.createElement('button');
            requestBtn.className = 'primary';
            requestBtn.setAttribute('data-issue-id', issue.id);
            requestBtn.style.cssText = 'font-size: 11px; padding: 2px 8px;';
            requestBtn.textContent = 'Request Patch';
            requestBtn.onclick = (e) => {
                e.stopPropagation();
                requestPatch(issue.id);
            };
            badgesDiv.appendChild(requestBtn);
        }
        
        issueHeader.appendChild(badgesDiv);
        issueItem.appendChild(issueHeader);
        
        // Add file info
        const issueMeta = createElement('div', 'issue-meta');
        issueMeta.textContent = (issue.affectedFile || 'Unknown file') + 
            (issue.startLine ? ':' + issue.startLine : '');
        issueItem.appendChild(issueMeta);
        
        // Add expanded content if this issue is expanded
        if (isExpanded) {
            const expandedDiv = createElement('div', 'issue-expanded');
            expandedDiv.style.cssText = 'margin-top: 10px; padding: 10px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 3px;';
            
            // Dashboard link - styled as a small link instead of button
            if (issue.id) {
                const dashboardLinkDiv = createElement('div');
                dashboardLinkDiv.style.cssText = 'margin-bottom: 10px; font-size: 11px;';
                
                const dashboardLink = document.createElement('a');
                dashboardLink.href = '#';
                dashboardLink.style.cssText = 'color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer;';
                dashboardLink.textContent = '🔗 View in Dashboard';
                dashboardLink.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openExternal('https://zeropath.com/app/issues/' + issue.id);
                };
                dashboardLinkDiv.appendChild(dashboardLink);
                expandedDiv.appendChild(dashboardLinkDiv);
            }
            
            // Description section with better formatting
            if (issue.generatedDescription) {
                const descSection = createElement('div');
                descSection.style.cssText = 'margin-bottom: 15px; padding: 10px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); border-radius: 2px;';
                
                const descTitle = createElement('strong');
                descTitle.style.cssText = 'display: block; margin-bottom: 8px; color: var(--vscode-foreground);';
                descTitle.textContent = '📋 Description';
                descSection.appendChild(descTitle);
                
                const descContent = createElement('div');
                descContent.style.cssText = 'white-space: pre-wrap; font-size: 12px; line-height: 1.5; color: var(--vscode-foreground);';
                descContent.textContent = issue.generatedDescription;
                descSection.appendChild(descContent);
                
                expandedDiv.appendChild(descSection);
            }
            
            // Patch section if available
            if (patch && patch.gitDiff) {
                const patchContainer = createElement('div');
                patchContainer.style.cssText = 'margin-top: 15px; padding: 10px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); border-radius: 2px;';
                
                const patchTitle = createElement('strong');
                patchTitle.style.cssText = 'display: block; margin-bottom: 10px; color: var(--vscode-textLink-foreground);';
                patchTitle.textContent = '🔧 Available Patch';
                patchContainer.appendChild(patchTitle);
                
                // Patch description if available
                if (patch.prDescription || patch.description) {
                    const patchDescDiv = createElement('div');
                    patchDescDiv.style.cssText = 'margin-bottom: 10px;';
                    
                    const patchDescLabel = createElement('strong');
                    patchDescLabel.textContent = 'Fix Description:';
                    patchDescDiv.appendChild(patchDescLabel);
                    
                    const patchDescContent = createElement('div');
                    patchDescContent.style.cssText = 'white-space: pre-wrap; margin-top: 5px; font-size: 11px; line-height: 1.4; color: var(--vscode-descriptionForeground);';
                    patchDescContent.textContent = patch.prDescription || patch.description || '';
                    patchDescDiv.appendChild(patchDescContent);
                    
                    patchContainer.appendChild(patchDescDiv);
                }
                
                // Git diff preview
                const diffPreviewDiv = createElement('div');
                diffPreviewDiv.style.cssText = 'margin: 10px 0;';
                
                const diffTitle = createElement('strong');
                diffTitle.textContent = 'Diff Preview:';
                diffPreviewDiv.appendChild(diffTitle);
                
                const diffContent = createElement('pre');
                diffContent.style.cssText = 'background: var(--vscode-editor-background); padding: 8px; border-radius: 3px; overflow-x: auto; font-family: monospace; font-size: 11px; line-height: 1.4; margin-top: 5px; max-height: 200px; overflow-y: auto;';
                
                // Format diff with colors for added/removed lines
                const diffLines = patch.gitDiff.split('\n').slice(0, 30); // Show first 30 lines
                diffLines.forEach(line => {
                    const lineSpan = createElement('div');
                    if (line.startsWith('+')) {
                        lineSpan.style.color = 'var(--vscode-gitDecoration-addedResourceForeground, #00aa00)';
                    } else if (line.startsWith('-')) {
                        lineSpan.style.color = 'var(--vscode-gitDecoration-deletedResourceForeground, #ff4444)';
                    } else if (line.startsWith('@@')) {
                        lineSpan.style.color = 'var(--vscode-textLink-foreground)';
                    } else {
                        lineSpan.style.color = 'var(--vscode-foreground)';
                    }
                    lineSpan.textContent = line;
                    diffContent.appendChild(lineSpan);
                });
                
                if (patch.gitDiff.split('\n').length > 30) {
                    const moreLines = createElement('div');
                    moreLines.style.cssText = 'color: var(--vscode-descriptionForeground); font-style: italic; margin-top: 5px;';
                    moreLines.textContent = '... ' + (patch.gitDiff.split('\n').length - 30) + ' more lines ...';
                    diffContent.appendChild(moreLines);
                }
                
                diffPreviewDiv.appendChild(diffContent);
                patchContainer.appendChild(diffPreviewDiv);
                
                // Action buttons
                const patchActions = createElement('div');
                patchActions.style.cssText = 'margin-top: 10px; display: flex; gap: 8px;';
                
                const applyBtn = document.createElement('button');
                applyBtn.className = 'primary';
                applyBtn.textContent = '✓ Apply This Patch';
                applyBtn.onclick = (e) => {
                    e.stopPropagation();
                    applyPatchFromStore(issue.id);
                };
                patchActions.appendChild(applyBtn);
                
                if (patch.prLink) {
                    const prBtn = document.createElement('button');
                    prBtn.textContent = '🔗 View PR';
                    prBtn.onclick = (e) => {
                        e.stopPropagation();
                        openExternal(patch.prLink);
                    };
                    patchActions.appendChild(prBtn);
                }
                
                patchContainer.appendChild(patchActions);
                expandedDiv.appendChild(patchContainer);
            } else if (patch) {
                // Patch exists but no diff yet - show request patch button
                const patchPendingDiv = createElement('div');
                patchPendingDiv.style.cssText = 'margin-top: 10px; padding: 10px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textPreformat-foreground); border-radius: 2px;';
                
                const pendingText = createElement('div');
                pendingText.style.cssText = 'margin-bottom: 8px; color: var(--vscode-descriptionForeground);';
                pendingText.textContent = 'A patch is available but needs to be fetched.';
                patchPendingDiv.appendChild(pendingText);
                
                const requestBtn = document.createElement('button');
                requestBtn.className = 'primary';
                requestBtn.textContent = '📥 Request Patch';
                requestBtn.onclick = (e) => {
                    e.stopPropagation();
                    requestPatch(issue.id);
                };
                patchPendingDiv.appendChild(requestBtn);
                
                expandedDiv.appendChild(patchPendingDiv);
            }
            
            issueItem.appendChild(expandedDiv);
        }
        
        container.appendChild(issueItem);
    });
}

function setLoading(loading) {
    const scansList = document.getElementById('scansList');
    if (loading && scansList) {
        scansList.textContent = '';
        const loadingDiv = createElement('div', 'empty-state');
        const spinner = createElement('span', 'spinner');
        loadingDiv.appendChild(spinner);
        loadingDiv.appendChild(document.createTextNode(' Loading scans...'));
        scansList.appendChild(loadingDiv);
    }
}

function setLoadingIssues(loading) {
    const issuesList = document.getElementById('issuesList');
    if (loading && issuesList) {
        issuesList.textContent = '';
        const loadingDiv = createElement('div', 'empty-state');
        const spinner = createElement('span', 'spinner');
        loadingDiv.appendChild(spinner);
        loadingDiv.appendChild(document.createTextNode(' Loading issues...'));
        issuesList.appendChild(loadingDiv);
    }
}

function setPatchLoading(loading, issueId) {
    const buttons = document.querySelectorAll(`button[data-issue-id="${issueId}"]`);
    buttons.forEach(button => {
        button.disabled = loading;
        if (loading) {
            button.textContent = '';
            const spinner = createElement('span', 'spinner');
            button.appendChild(spinner);
            button.appendChild(document.createTextNode(' Requesting...'));
        } else {
            button.textContent = 'Request Patch';
        }
    });
}

function updateIssueStatus(issueId) {
    const issue = currentIssues.find(i => i.id === issueId);
    if (issue) {
        issue.status = 'patched';
        renderIssues(undefined, selectedScanId);
    }
}

function configureCredentials() {
    vscode.postMessage({ type: 'configureCredentials' });
}

function requestPatch(issueId) {
    // Implementation would go here
}

function openExternal(url) {
    vscode.postMessage({ type: 'openExternal', url: url });
}

// Export functions for global access
window.loadScans = loadScans;
window.selectScan = selectScan;
window.renderScans = renderScans;
window.renderIssues = renderIssues;
window.requestPatch = requestPatch;
window.applyPatchFromStore = applyPatchFromStore;
window.openExternal = openExternal;
window.formatDate = formatDate;
window.configureCredentials = configureCredentials;

// Handle dropdown change events
document.addEventListener('change', (e) => {
    if (e.target.id === 'scanTypeSelect') {
        loadScans(e.target.value);
    }
});

// Handle search input
document.addEventListener('input', (e) => {
    if (e.target.id === 'issueSearchInput') {
        searchTerm = e.target.value;
        renderIssues(undefined, selectedScanId);
    }
});

// Handle scan/issue selection clicks
document.addEventListener('click', (e) => {
    const target = e.target;
    
    // Check if clicked on scan item or its children
    const scanItem = target.closest('.scan-item');
    if (scanItem) {
        const scanId = scanItem.getAttribute('data-scan-id');
        const scanType = scanItem.getAttribute('data-scan-type');
        selectScan(scanId, scanType);
        return;
    }
    
    // Check if clicked on issue item or its children
    const issueItem = target.closest('.issue-item');
    if (issueItem && !target.closest('button')) {
        const issueId = issueItem.getAttribute('data-issue-id');
        expandedIssueId = expandedIssueId === issueId ? null : issueId;
        renderIssues(undefined, selectedScanId);
        return;
    }
    
    // Handle button clicks
    if (target.tagName === 'BUTTON') {
        const url = target.getAttribute('data-url');
        if (url) {
            openExternal(url);
            return;
        }
        
        if (target.textContent.includes('Refresh')) {
            loadScans();
        } else if (target.textContent === '⚙️' || target.title === 'Configure API Credentials') {
            configureCredentials();
        }
    }
});

console.log('Sidebar.js loaded successfully');
