/**
 * Markdown Table Parser
 *
 * Parses GFM-style markdown tables:
 *
 * | Header 1 | Header 2 | Header 3 |
 * |----------|----------|----------|
 * | Cell 1   | Cell 2   | Cell 3   |
 * | Cell 4   | Cell 5   | Cell 6   |
 */

export interface TableData {
    headers: string[];
    rows: string[][];
    rawText: string;
    alignments: ('left' | 'center' | 'right' | 'none')[];
}

/**
 * Parse all markdown tables from a text string
 */
export function parseMarkdownTable(text: string): TableData[] {
    const tables: TableData[] = [];

    // Split into lines
    const lines = text.split('\n');

    let i = 0;
    while (i < lines.length) {
        // Look for a potential header row (must contain pipes)
        const headerLine = lines[i];
        if (!isPotentialTableRow(headerLine)) {
            i++;
            continue;
        }

        // Check if next line is a separator row
        const separatorLine = lines[i + 1];
        if (!separatorLine || !isSeparatorRow(separatorLine)) {
            i++;
            continue;
        }

        // We found a table! Parse it
        const headers = parseTableRow(headerLine);
        const alignments = parseAlignments(separatorLine);

        // Collect data rows
        const rows: string[][] = [];
        let j = i + 2;
        const tableStartIndex = i;

        while (j < lines.length && isPotentialTableRow(lines[j])) {
            const row = parseTableRow(lines[j]);
            // Normalize row length to match headers
            while (row.length < headers.length) {
                row.push('');
            }
            rows.push(row.slice(0, headers.length));
            j++;
        }

        // Only consider it a valid table if it has at least one data row
        if (rows.length > 0) {
            const rawText = lines.slice(tableStartIndex, j).join('\n');
            tables.push({
                headers,
                rows,
                rawText,
                alignments,
            });
        }

        i = j;
    }

    return tables;
}

/**
 * Check if a line could be a table row (contains pipe characters)
 */
function isPotentialTableRow(line: string): boolean {
    if (!line || !line.includes('|')) {
        return false;
    }
    // Must have at least one pipe that's not at the very start/end only
    const trimmed = line.trim();
    const pipeCount = (trimmed.match(/\|/g) || []).length;
    return pipeCount >= 1;
}

/**
 * Check if a line is a separator row (e.g., |---|---|---|)
 */
function isSeparatorRow(line: string): boolean {
    if (!line || !line.includes('|')) {
        return false;
    }

    const trimmed = line.trim();

    // Remove leading/trailing pipes and split by pipe
    const cells = trimmed
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|');

    // Each cell must be a valid separator (dashes with optional colons)
    return cells.every(cell => {
        const cleaned = cell.trim();
        // Match patterns like: ---, :---, ---:, :---:
        return /^:?-{1,}:?$/.test(cleaned);
    });
}

/**
 * Parse a table row into cells
 */
function parseTableRow(line: string): string[] {
    const trimmed = line.trim();

    // Remove leading/trailing pipes
    let cleaned = trimmed;
    if (cleaned.startsWith('|')) {
        cleaned = cleaned.slice(1);
    }
    if (cleaned.endsWith('|')) {
        cleaned = cleaned.slice(0, -1);
    }

    // Split by pipes and trim each cell
    return cleaned.split('|').map(cell => cell.trim());
}

/**
 * Parse alignment from separator row
 */
function parseAlignments(separatorLine: string): ('left' | 'center' | 'right' | 'none')[] {
    const trimmed = separatorLine.trim();

    // Remove leading/trailing pipes
    let cleaned = trimmed;
    if (cleaned.startsWith('|')) {
        cleaned = cleaned.slice(1);
    }
    if (cleaned.endsWith('|')) {
        cleaned = cleaned.slice(0, -1);
    }

    return cleaned.split('|').map(cell => {
        const c = cell.trim();
        const hasLeftColon = c.startsWith(':');
        const hasRightColon = c.endsWith(':');

        if (hasLeftColon && hasRightColon) {
            return 'center';
        } else if (hasRightColon) {
            return 'right';
        } else if (hasLeftColon) {
            return 'left';
        }
        return 'none';
    });
}

/**
 * Convert table data back to a formatted string (for display without attachments)
 */
export function tableToFormattedText(table: TableData): string {
    const lines: string[] = [];

    // Header row
    lines.push(table.headers.map(h => `**${h}**`).join(' | '));

    // Data rows
    for (const row of table.rows) {
        lines.push(row.join(' | '));
    }

    return lines.join('\n');
}

/**
 * Detect if text contains tab-separated values (e.g., copied from Excel)
 * Returns true if the text looks like TSV data
 */
export function isTsvData(text: string): boolean {
    const lines = text.split('\n').filter(line => line.trim().length > 0);

    // Need at least 2 lines (header + data)
    if (lines.length < 2) {
        return false;
    }

    // Check if lines contain tabs
    const tabCounts = lines.map(line => (line.match(/\t/g) || []).length);

    // All lines should have at least one tab
    if (tabCounts.some(count => count === 0)) {
        return false;
    }

    // All lines should have the same number of tabs (same column count)
    const firstCount = tabCounts[0];
    if (!tabCounts.every(count => count === firstCount)) {
        return false;
    }

    // Should not already be a markdown table (no pipes except in cell content)
    // If all lines have pipes at similar positions, it's probably markdown
    const hasPipeStructure = lines.every(line => {
        const trimmed = line.trim();
        return trimmed.startsWith('|') || trimmed.endsWith('|');
    });

    if (hasPipeStructure) {
        return false;
    }

    return true;
}

/**
 * Convert tab-separated values to markdown table format
 * First row is treated as headers
 */
export function convertTsvToMarkdown(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inTsvBlock = false;
    let tsvLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hasTab = line.includes('\t');

        if (hasTab) {
            if (!inTsvBlock) {
                inTsvBlock = true;
                tsvLines = [];
            }
            tsvLines.push(line);
        } else {
            if (inTsvBlock && tsvLines.length >= 2) {
                // Convert accumulated TSV lines to markdown
                result.push(tsvBlockToMarkdown(tsvLines));
            } else if (inTsvBlock && tsvLines.length === 1) {
                // Single line with tabs - just keep as is
                result.push(tsvLines[0]);
            }
            inTsvBlock = false;
            tsvLines = [];
            result.push(line);
        }
    }

    // Handle TSV block at end of text
    if (inTsvBlock && tsvLines.length >= 2) {
        result.push(tsvBlockToMarkdown(tsvLines));
    } else if (inTsvBlock && tsvLines.length === 1) {
        result.push(tsvLines[0]);
    }

    return result.join('\n');
}

/**
 * Convert a block of TSV lines to markdown table format
 */
function tsvBlockToMarkdown(lines: string[]): string {
    const rows = lines
        .filter(line => line.trim().length > 0)
        .map(line => line.split('\t').map(cell => cell.trim()));

    if (rows.length < 1) {
        return lines.join('\n');
    }

    // First row is header
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Build markdown table
    const mdLines: string[] = [];

    // Header row
    mdLines.push('| ' + headers.join(' | ') + ' |');

    // Separator row
    mdLines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

    // Data rows
    for (const row of dataRows) {
        // Pad row to match header length
        while (row.length < headers.length) {
            row.push('');
        }
        mdLines.push('| ' + row.slice(0, headers.length).join(' | ') + ' |');
    }

    return mdLines.join('\n');
}
