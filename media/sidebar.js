// Sidebar JavaScript - This will be loaded as an external file
console.log('Sidebar.js loading...');

const vscode = acquireVsCodeApi();
let currentScans = [];
let currentIssues = [];
let filteredIssues = [];
let selectedScanId = null;
let expandedIssueId = null;
let searchTerm = '';

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

function configureCredentials() {
    vscode.postMessage({ type: 'configureCredentials' });
}

function selectScan(scanId, scanType) {
    console.log('selectScan called with:', scanId, scanType);
    selectedScanId = scanId;
    
    // Update UI to show selected scan
    document.querySelectorAll('.scan-item').forEach(item => {
        const itemScanId = item.getAttribute('data-scan-id');
        item.classList.toggle('selected', itemScanId === scanId);
    });
    
    // Send message to extension
    vscode.postMessage({ 
        type: 'selectScan', 
        scanId: scanId,
        scanType: scanType
    });
}

function renderScans(scans) {
    console.log('renderScans called with', scans?.length || 0, 'scans');
    currentScans = scans;
    const container = document.getElementById('scansList');
    
    if (!container) {
        console.error('scansList container not found!');
        return;
    }
    
    if (!scans || scans.length === 0) {
        container.innerHTML = '<div class="empty-state">No scans found. Check your credentials and repository.</div>';
        return;
    }
    
    container.innerHTML = scans.map(scan => {
        const isFinished = scan.finished || scan.codeScanFinished || 
            scan.status === 'completed' || scan.status === 'finished';
        const isRunning = scan.status === 'running' || scan.status === 'processing';
        
        let statusBadge = '';
        if (isFinished) {
            statusBadge = '<span class="badge status-completed">✓</span>';
        } else if (isRunning) {
            statusBadge = '<span class="badge status-running">⚡</span>';
        } else if (scan.status === 'failed') {
            statusBadge = '<span class="badge status-failed">✗</span>';
        }
        
        const issueCount = scan.issueCounts?.open ? 
            '<span class="badge">' + scan.issueCounts.open + ' issues</span>' : '';
        
        // Use data attributes instead of onclick
        return '<div class="scan-item" data-scan-id="' + escapeHtml(scan.scanId) + '" ' +
            'data-scan-type="' + escapeHtml(scan.codeScanType || 'FullScan') + '">' +
            '<div class="scan-header">' +
                '<div class="scan-title">' + escapeHtml(scan.scanId) + '</div>' +
                '<div>' + statusBadge + ' ' + issueCount + '</div>' +
            '</div>' +
            '<div class="scan-meta">' +
                'Type: ' + escapeHtml(scan.codeScanType || 'Unknown') + ' | ' +
                'Created: ' + escapeHtml(formatDate(scan.createdAt)) +
            '</div>' +
        '</div>';
    }).join('');
}

function renderIssues(issues, scanId) {
    if (issues !== undefined) {
        currentIssues = issues;
    }
    
    // Apply search filter
    filteredIssues = currentIssues;
    if (searchTerm && searchTerm.trim()) {
        const search = searchTerm.toLowerCase();
        filteredIssues = currentIssues.filter(issue => {
            return (issue.generatedTitle || '').toLowerCase().includes(search) ||
                   (issue.generatedDescription || '').toLowerCase().includes(search) ||
                   (issue.affectedFile || '').toLowerCase().includes(search) ||
                   (issue.vulnClass || '').toLowerCase().includes(search) ||
                   (issue.severity || '').toString().toLowerCase().includes(search) ||
                   (issue.status || '').toLowerCase().includes(search);
        });
    }
    
    const container = document.getElementById('issuesList');
    
    // Add search bar
    let searchBar = '<div style="margin-bottom: 10px;">' +
        '<input type="text" id="issueSearchInput" placeholder="Search issues..." value="' + escapeHtml(searchTerm) + '" ' +
        'style="width: 100%; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); ' +
        'border: 1px solid var(--vscode-input-border); border-radius: 2px;"/>' +
        '</div>';
    
    if (!currentIssues || currentIssues.length === 0) {
        container.innerHTML = searchBar + '<div class="empty-state">No issues found for this scan</div>';
        return;
    }
    
    if (filteredIssues.length === 0) {
        container.innerHTML = searchBar + '<div class="empty-state">No issues match your search</div>';
        return;
    }
    
    // Sort issues by score (highest first), then by severity as fallback
    const severityOrder = { 'Critical': 5, 'High': 4, 'Medium': 3, 'Low': 2, 'Info': 1 };
    filteredIssues.sort((a, b) => {
        // First sort by score if available
        if (a.score !== undefined && b.score !== undefined) {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
        } else if (a.score !== undefined) {
            return -1; // a has score, b doesn't, a comes first
        } else if (b.score !== undefined) {
            return 1; // b has score, a doesn't, b comes first
        }
        
        // Then by severity
        const aSev = severityOrder[a.severity] || a.severity || 0;
        const bSev = severityOrder[b.severity] || b.severity || 0;
        if (bSev !== aSev) {
            return bSev - aSev;
        }
        
        // Finally by confidence if available
        const aConf = a.confidence || 0;
        const bConf = b.confidence || 0;
        return bConf - aConf;
    });
    
    container.innerHTML = searchBar + 
        '<div style="margin-bottom: 8px; color: var(--vscode-descriptionForeground); font-size: 11px;">' +
        'Showing ' + filteredIssues.length + ' of ' + currentIssues.length + ' issues' +
        '</div>' +
        filteredIssues.map(issue => {
        // Ensure severity is a string
        const severityValue = String(issue.severity || 'unknown');
        const severity = severityValue.toLowerCase();
        const severityBadge = '<span class="badge severity-' + severity + '">' + 
            escapeHtml(severityValue) + '</span>';
        
        // Score badge (if available)
        const scoreBadge = issue.score !== undefined ? 
            '<span class="badge" style="background: var(--vscode-terminal-ansiMagenta); color: var(--vscode-terminal-background);" title="Risk Score">' + 
            escapeHtml(String(issue.score)) + '</span>' : '';
        
        // Determine status badge
        const statusBadge = issue.status ? 
            '<span class="badge">' + escapeHtml(issue.status) + '</span>' : '';
        
        // Get patch from either patch or vulnerabilityPatch field
        const patch = issue.patch || issue.vulnerabilityPatch;
        
        // Check if issue is unpatchable
        const isUnpatchable = issue.status === 'unpatchable' || 
            issue.unpatchable === true || 
            issue.patchability === 'unpatchable';
        
        // Check if issue has been patched
        const isPatched = issue.status === 'patched' || 
            issue.status === 'closed' || 
            patch?.applied === true;
        
        let actions = '';
        // Show status badges and quick actions
        if (isUnpatchable) {
            actions += '<span class="badge" style="background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground);">Unpatchable</span>';
        } else if (isPatched) {
            actions += '<span class="badge" style="background: var(--vscode-terminal-ansiGreen); color: var(--vscode-terminal-background);">✓ Patched</span>';
        } else if (patch?.gitDiff) {
            // If there's a patch available, show a badge (full patch view is in expanded section)
            actions += '<span class="badge" style="background: var(--vscode-textLink-foreground); color: var(--vscode-editor-background);">Patch Available</span>';
        } else if (issue.status === 'open' || !patch) {
            // Only show request patch button if no patch exists
            actions += '<button class="primary" data-issue-id="' + 
                escapeHtml(issue.id) + '" style="font-size: 11px; padding: 2px 8px;">Request Patch</button>';
        }
        
        // Check if this issue is expanded
        const isExpanded = expandedIssueId === issue.id;
        
        // Build expanded details section
        let expandedContent = '';
        if (isExpanded) {
            expandedContent = '<div class="issue-details" style="margin-top: 10px; padding: 10px; background: var(--vscode-editor-background); border-radius: 3px;">';
            
            // Dashboard link
            if (issue.id) {
                const dashboardUrl = 'https://zeropath.com/app/issues/' + issue.id;
                expandedContent += '<div style="margin-bottom: 10px;">';
                expandedContent += '<button data-url="' + escapeHtml(dashboardUrl) + '" style="background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);">🔗 View in Dashboard</button>';
                expandedContent += '</div>';
            }
            
            // Full description
            if (issue.generatedDescription) {
                expandedContent += '<div style="margin-bottom: 10px;">';
                expandedContent += '<strong>Description:</strong><br/>';
                expandedContent += '<div style="white-space: pre-wrap; font-family: monospace; font-size: 11px; margin-top: 5px;">' + 
                    escapeHtml(issue.generatedDescription) + '</div>';
                expandedContent += '</div>';
            }
            
            // Score, Severity and Confidence
            expandedContent += '<div style="margin-bottom: 5px;">';
            if (issue.score !== undefined) {
                expandedContent += '<strong>Score:</strong> ' + escapeHtml(String(issue.score)) + ' ';
            }
            if (issue.severity !== undefined) {
                expandedContent += '<strong>Severity:</strong> ' + escapeHtml(String(issue.severity)) + '/10 ';
            }
            if (issue.confidence !== undefined) {
                expandedContent += '<strong>Confidence:</strong> ' + escapeHtml(String(issue.confidence)) + '/10';
            }
            expandedContent += '</div>';
            
            // Vulnerability class and category
            if (issue.vulnClass || issue.vulnCategory) {
                expandedContent += '<div><strong>Type:</strong> ' + 
                    escapeHtml((issue.vulnClass || '') + (issue.vulnClass && issue.vulnCategory ? ' / ' : '') + (issue.vulnCategory || '')) + '</div>';
            }
            
            // Rule information
            if (issue.ruleId || issue.ruleName) {
                expandedContent += '<div><strong>Rule:</strong> ' + 
                    escapeHtml(issue.ruleName || issue.ruleId || 'Unknown') + '</div>';
            }
            
            // CWEs
            if (issue.cwes && issue.cwes.length > 0) {
                expandedContent += '<div><strong>CWEs:</strong> ' + 
                    escapeHtml(issue.cwes.join(', ')) + '</div>';
            }
            
            // Code snippet if available
            if (issue.sastCodeSegment || issue.codeSnippet || issue.affectedCode) {
                const code = issue.sastCodeSegment || issue.codeSnippet || issue.affectedCode;
                expandedContent += '<div style="margin-top: 10px;">';
                expandedContent += '<strong>Affected Code:</strong>';
                expandedContent += '<pre style="background: var(--vscode-textCodeBlock-background); padding: 8px; margin-top: 5px; border-radius: 3px; overflow-x: auto;">' +
                    '<code>' + escapeHtml(code) + '</code></pre>';
                expandedContent += '</div>';
            }
            
            // Line range
            if (issue.startLine) {
                expandedContent += '<div><strong>Location:</strong> Line ' + issue.startLine;
                if (issue.endLine && issue.endLine !== issue.startLine) {
                    expandedContent += ' - ' + issue.endLine;
                }
                expandedContent += '</div>';
            }
            
            // Patch section if available
            if (patch) {
                expandedContent += '<div style="margin-top: 15px; padding: 10px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); border-radius: 2px;">';
                expandedContent += '<h4 style="margin: 0 0 10px 0; color: var(--vscode-textLink-foreground);">🔧 Available Patch</h4>';
                
                // Patch description
                if (patch.prDescription || patch.description) {
                    expandedContent += '<div style="margin-bottom: 10px;">';
                    expandedContent += '<strong>Fix Description:</strong><br/>';
                    expandedContent += '<div style="white-space: pre-wrap; margin-top: 5px; font-size: 11px; line-height: 1.4;">' + 
                        escapeHtml(patch.prDescription || patch.description) + '</div>';
                    expandedContent += '</div>';
                }
                
                // Git diff preview
                if (patch.gitDiff) {
                    expandedContent += '<div style="margin-bottom: 10px;">';
                    expandedContent += '<strong>Changes Preview:</strong>';
                    expandedContent += '<pre style="background: var(--vscode-editor-background); padding: 8px; margin-top: 5px; border-radius: 3px; overflow-x: auto; font-size: 11px; max-height: 300px; overflow-y: auto;">';
                    
                    // Format the diff with colors
                    const diffLines = patch.gitDiff.split('\n');
                    expandedContent += '<code>' + diffLines.map(line => {
                        if (line.startsWith('+') && !line.startsWith('+++')) {
                            return '<span style="color: var(--vscode-terminal-ansiGreen);">' + escapeHtml(line) + '</span>';
                        } else if (line.startsWith('-') && !line.startsWith('---')) {
                            return '<span style="color: var(--vscode-terminal-ansiRed);">' + escapeHtml(line) + '</span>';
                        } else if (line.startsWith('@@')) {
                            return '<span style="color: var(--vscode-terminal-ansiCyan);">' + escapeHtml(line) + '</span>';
                        } else if (line.startsWith('diff ') || line.startsWith('index ')) {
                            return '<span style="color: var(--vscode-terminal-ansiBrightBlack);">' + escapeHtml(line) + '</span>';
                        }
                        return escapeHtml(line);
                    }).join('\n') + '</code>';
                    expandedContent += '</pre>';
                    expandedContent += '</div>';
                    
                    // Apply patch button - encode the diff properly
                    // Use btoa to convert to base64, handling unicode properly
                    const diffEncoded = btoa(unescape(encodeURIComponent(patch.gitDiff)));
                    expandedContent += '<div style="margin-top: 10px;">';
                    expandedContent += '<button class="primary" data-issue-id="' + escapeHtml(issue.id) + 
                        '" data-diff="' + diffEncoded + '" style="margin-right: 8px;">✓ Apply This Patch</button>';
                    
                    if (patch.prLink) {
                        expandedContent += '<button data-url="' + escapeHtml(patch.prLink) + '">View PR</button>';
                    }
                    expandedContent += '</div>';
                }
                
                expandedContent += '</div>';
            }
            
            expandedContent += '</div>';
        }
        
        return '<div class="issue-item" data-issue-id="' + escapeHtml(issue.id) + '" style="cursor: pointer;">' +
            '<div class="issue-header">' +
                '<div style="flex: 1;">' +
                    '<div class="issue-title">' + 
                        (isExpanded ? '▼ ' : '▶ ') +
                        escapeHtml(issue.generatedTitle || 'Untitled') + 
                    '</div>' +
                '</div>' +
                '<div style="display: flex; gap: 5px; align-items: center;">' +
                    scoreBadge +
                    severityBadge +
                    statusBadge +
                '</div>' +
            '</div>' +
            '<div class="issue-meta">' +
                escapeHtml(issue.affectedFile || 'Unknown file') + 
                (issue.startLine ? ':' + issue.startLine : '') +
            '</div>' +
            (actions && !isExpanded ? '<div class="issue-actions" style="margin-top: 8px;">' + actions + '</div>' : '') +
            expandedContent +
        '</div>';
    }).join('');
}

function setLoading(loading) {
    console.log('setLoading called with:', loading);
    const scansList = document.getElementById('scansList');
    if (loading && scansList) {
        scansList.innerHTML = '<div class="empty-state"><span class="spinner"></span> Loading scans...</div>';
    }
}

function setLoadingIssues(loading) {
    const issuesList = document.getElementById('issuesList');
    if (loading && issuesList) {
        issuesList.innerHTML = '<div class="empty-state"><span class="spinner"></span> Loading issues...</div>';
    }
}

function setPatchLoading(loading, issueId) {
    const button = document.getElementById('patch-btn-' + issueId);
    if (button) {
        button.disabled = loading;
        if (loading) {
            button.innerHTML = '<span class="spinner"></span> Requesting...';
        } else {
            button.innerHTML = 'Request Patch';
        }
    }
}

function updateIssueStatus(issueId) {
    const issue = currentIssues.find(i => i.id === issueId);
    if (issue) {
        issue.status = 'patched';
        renderIssues(currentIssues, selectedScanId);
    }
}

function showError(message) {
    console.error('Error:', message);
    // Show error in UI
    vscode.postMessage({ type: 'error', message: message });
}

function requestPatch(issueId) {
    vscode.postMessage({ type: 'requestPatch', issueId: issueId });
}

function applyPatchFromBase64(diffBase64, issueId) {
    try {
        console.log('Decoding patch for issue:', issueId);
        // Decode the base64 string back to the original diff
        const diff = decodeURIComponent(escape(atob(diffBase64)));
        console.log('Decoded diff length:', diff.length);
        console.log('First 100 chars of diff:', diff.substring(0, 100));
        vscode.postMessage({ type: 'applyPatch', diff: diff, issueId: issueId });
    } catch (error) {
        console.error('Failed to decode patch:', error);
        showError('Failed to decode patch: ' + error.message);
    }
}

function openExternal(url) {
    vscode.postMessage({ type: 'openExternal', url: url });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function escapeJs(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch {
        return dateStr;
    }
}

// Make functions globally available
window.loadScans = loadScans;
window.configureCredentials = configureCredentials;
window.selectScan = selectScan;
window.renderScans = renderScans;
window.renderIssues = renderIssues;
window.requestPatch = requestPatch;
window.applyPatchFromBase64 = applyPatchFromBase64;
window.openExternal = openExternal;
window.escapeHtml = escapeHtml;
window.escapeJs = escapeJs;
window.formatDate = formatDate;

// Global click handler using event delegation
document.addEventListener('click', (e) => {
    const target = e.target;
    
    // Handle scan item clicks
    const scanItem = target.closest('.scan-item');
    if (scanItem) {
        const scanId = scanItem.getAttribute('data-scan-id');
        const scanType = scanItem.getAttribute('data-scan-type');
        if (scanId) {
            selectScan(scanId, scanType);
        }
        return;
    }
    
    // Handle issue item clicks for expansion
    const issueItem = target.closest('.issue-item');
    if (issueItem && !target.closest('button') && !target.closest('.issue-actions')) {
        const issueId = issueItem.getAttribute('data-issue-id');
        if (issueId) {
            // Toggle expansion
            expandedIssueId = expandedIssueId === issueId ? null : issueId;
            // Re-render issues with expanded state
            renderIssues(currentIssues, selectedScanId);
        }
        return;
    }
    
    // Handle button clicks by checking button text or data attributes
    if (target.tagName === 'BUTTON') {
        // Any button with a URL (dashboard, PR, etc.)
        const url = target.getAttribute('data-url');
        if (url) {
            openExternal(url);
            return;
        }
        
        // Refresh button
        if (target.textContent.includes('Refresh')) {
            loadScans();
        }
        // Configure button
        else if (target.textContent === '⚙️' || target.title === 'Configure API Credentials') {
            configureCredentials();
        }
        // Request Patch button
        else if (target.textContent.includes('Request Patch')) {
            const issueId = target.getAttribute('data-issue-id');
            if (issueId) {
                requestPatch(issueId);
            }
        }
        // Apply Patch button
        else if (target.textContent.includes('Apply') && target.getAttribute('data-diff')) {
            const issueId = target.getAttribute('data-issue-id');
            const diffBase64 = target.getAttribute('data-diff');
            if (issueId && diffBase64) {
                console.log('Applying patch for issue:', issueId);
                applyPatchFromBase64(diffBase64, issueId);
            }
        }
    }
});

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
        const cursorPosition = e.target.selectionStart;
        renderIssues(); // Re-render with filter
        
        // Restore focus and cursor position
        const searchInput = document.getElementById('issueSearchInput');
        if (searchInput) {
            searchInput.focus();
            searchInput.setSelectionRange(cursorPosition, cursorPosition);
        }
    }
});

console.log('Sidebar.js loaded successfully');
console.log('Event delegation configured for all clicks');
